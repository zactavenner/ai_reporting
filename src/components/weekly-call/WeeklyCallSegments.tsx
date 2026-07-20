import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useTeamMember } from '@/contexts/TeamMemberContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Trophy, Plus, AlertTriangle, Lightbulb, ExternalLink, Settings2, DollarSign, PhoneCall, Users, CalendarCheck, Percent } from 'lucide-react';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { WeeklyRecapCard } from '@/components/weekly-sync/WeeklyRecapCard';
import { CreativeApproval } from '@/components/creative/CreativeApproval';
import { useClient } from '@/hooks/useClients';
import { TaskBoardView } from '@/components/tasks/TaskBoardView';
import { useClientSettings } from '@/hooks/useClientSettings';
import { useSheetMetrics } from '@/hooks/useSheetMetrics';
import { useMetaDailySummary } from '@/hooks/useMetaAds';
import { toast } from 'sonner';

// ─── Range window helpers (anchored to when the call was started) ─────────
export type RangeDays = 7 | 14 | 30;

function anchorDate(call: { started_at?: string | null; week_of?: string | null } | null | undefined): Date {
  if (call?.started_at) return new Date(call.started_at);
  if (call?.week_of) return new Date(call.week_of);
  return new Date();
}

function sinceISO(anchor: Date, days: RangeDays): string {
  const d = new Date(anchor);
  d.setDate(d.getDate() - days);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function ymd(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function sheetWindow(call: { started_at?: string | null; week_of?: string | null } | null | undefined, days: RangeDays) {
  const anchor = anchorDate(call);
  const from = new Date(anchor);
  from.setDate(from.getDate() - days);
  return { from: ymd(from), to: ymd(anchor) };
}

function parseSheetUrl(url?: string | null): { sheetId: string; gid?: string } | null {
  if (!url) return null;
  const idMatch = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (!idMatch) return null;
  const gidMatch = url.match(/[#?&]gid=(\d+)/);
  return { sheetId: idMatch[1], gid: gidMatch?.[1] };
}

function buildSheetUrl(sheetId?: string | null, gid?: string | null): string {
  if (!sheetId) return '';
  return `https://docs.google.com/spreadsheets/d/${sheetId}/edit${gid ? `#gid=${gid}` : ''}`;
}

function embedSheetUrl(url: string): string {
  const parsed = parseSheetUrl(url);
  if (parsed) return `https://docs.google.com/spreadsheets/d/${parsed.sheetId}/preview${parsed.gid ? `?gid=${parsed.gid}` : ''}`;
  return url.includes('/pubhtml') || url.includes('output=') || url.includes('widget=')
    ? url
    : url.replace(/\/edit.*$/, '/preview').replace(/\/view.*$/, '/preview');
}

function fmtMoney(n: number | null | undefined) {
  const v = Number(n || 0);
  if (Math.abs(v) >= 1000000) return `$${(v / 1000000).toFixed(1)}M`;
  if (Math.abs(v) >= 1000) return `$${(v / 1000).toFixed(1)}K`;
  return v.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

function fmtInt(n: number | null | undefined) {
  return Math.round(Number(n || 0)).toLocaleString();
}

function fmtPct(n: number | null | undefined) {
  return `${Number(n || 0).toFixed(1)}%`;
}

function RangePicker({ value, onChange }: { value: RangeDays; onChange: (v: RangeDays) => void }) {
  return (
    <ToggleGroup
      type="single"
      value={String(value)}
      onValueChange={(v) => v && onChange(Number(v) as RangeDays)}
      size="sm"
      className="justify-start"
    >
      <ToggleGroupItem value="7">7d</ToggleGroupItem>
      <ToggleGroupItem value="14">14d</ToggleGroupItem>
      <ToggleGroupItem value="30">30d</ToggleGroupItem>
    </ToggleGroup>
  );
}

interface Item {
  id: string;
  call_id: string;
  kind: string;
  member_name: string | null;
  text: string | null;
  meta: any;
  created_at: string;
}

function useCallItems(callId: string, kinds: string[]) {
  const [items, setItems] = useState<Item[]>([]);
  useEffect(() => {
    let active = true;
    (async () => {
      const { data } = await (supabase as any)
        .from('client_weekly_call_items')
        .select('*')
        .eq('call_id', callId)
        .in('kind', kinds)
        .order('created_at');
      if (active) setItems((data as any) || []);
    })();
    const ch = supabase
      .channel(`cwci-${callId}-${kinds.join('-')}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'client_weekly_call_items', filter: `call_id=eq.${callId}` },
        (p) => {
          const n = p.new as Item;
          if (kinds.includes(n.kind)) setItems((prev) => [...prev, n]);
        }
      )
      .subscribe();
    return () => {
      active = false;
      supabase.removeChannel(ch);
    };
  }, [callId, kinds.join('-')]);
  return items;
}

async function addItem(callId: string, clientId: string, kind: string, text: string, member: any, meta: any = {}) {
  await (supabase as any).from('client_weekly_call_items').insert({
    call_id: callId,
    client_id: clientId,
    kind,
    member_id: member?.id ?? null,
    member_name: member?.name ?? 'Team',
    text,
    meta,
  });
}

// ─── Simple list-with-input segment ────────────────────────────────────────
function ListSegment({
  callId, clientId, kind, placeholder, icon: Icon,
}: {
  callId: string; clientId: string; kind: string;
  placeholder: string; icon: any;
}) {
  const { currentMember } = useTeamMember();
  const items = useCallItems(callId, [kind]);
  const [text, setText] = useState('');
  const submit = async () => {
    if (!text.trim()) return;
    await addItem(callId, clientId, kind, text.trim(), currentMember);
    setText('');
  };
  return (
    <div className="w-full max-w-4xl mx-auto space-y-4">
      <div className="flex gap-2">
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder={placeholder}
          className="text-lg h-12"
        />
        <Button onClick={submit} size="lg"><Plus className="w-4 h-4 mr-1" />Add</Button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {items.map((w) => (
          <Card key={w.id} className="p-4 border-l-4 border-l-primary">
            <div className="flex gap-2 items-start">
              <Icon className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
              <div>
                <div className="text-xs text-muted-foreground">{w.member_name}</div>
                <div className="text-base">{w.text}</div>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

export function WinsSegment(p: { callId: string; clientId: string }) {
  return <ListSegment callId={p.callId} clientId={p.clientId} kind="win" placeholder="A quick win from this week…" icon={Trophy} />;
}
export function BlockersSegment(p: { callId: string; clientId: string }) {
  return <ListSegment callId={p.callId} clientId={p.clientId} kind="blocker" placeholder="What's blocking us? Who owns unblocking?" icon={AlertTriangle} />;
}
export function IdeasSegment(p: { callId: string; clientId: string }) {
  return <ListSegment callId={p.callId} clientId={p.clientId} kind="idea" placeholder="Idea to test next week…" icon={Lightbulb} />;
}

// ─── Notes-only segment (auto-saved textarea backed by a single item row) ──
function NotesBlock({ callId, clientId, kind, label }: { callId: string; clientId: string; kind: string; label: string }) {
  const { currentMember } = useTeamMember();
  const items = useCallItems(callId, [kind]);
  const existing = items[items.length - 1];
  const [val, setVal] = useState('');
  useEffect(() => { setVal(existing?.text || ''); }, [existing?.id]);
  const save = async () => {
    if (!val.trim()) return;
    if (existing) {
      await (supabase as any).from('client_weekly_call_items').update({ text: val }).eq('id', existing.id);
    } else {
      await addItem(callId, clientId, kind, val, currentMember);
    }
    toast.success('Notes saved');
  };
  return (
    <div className="space-y-2">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <Textarea value={val} onChange={(e) => setVal(e.target.value)} onBlur={save} rows={4} placeholder="Notes…" />
    </div>
  );
}

export function ScorecardSegment({ callId, clientId, call }: { callId: string; clientId: string; call: any }) {
  const [range, setRange] = useState<RangeDays>(7);
  const since = sinceISO(anchorDate(call), range);
  const windowRange = useMemo(() => sheetWindow(call, range), [call?.started_at, call?.week_of, range]);
  const { data: settings } = useClientSettings(clientId);
  const [sheetUrl, setSheetUrl] = useState<string>('');
  const [editingUrl, setEditingUrl] = useState(false);
  const [tmpUrl, setTmpUrl] = useState('');
  const mappingRaw = (settings as any)?.metrics_sheet_mapping as Record<string, any> | undefined;
  const mapping: Record<string, string> | undefined = mappingRaw?.columns && typeof mappingRaw.columns === 'object'
    ? (mappingRaw.columns as Record<string, string>)
    : undefined;
  const parsedSheet = parseSheetUrl(sheetUrl);
  const metrics = useSheetMetrics(clientId, parsedSheet?.sheetId, parsedSheet?.gid, windowRange.from, windowRange.to, mapping);
  const meta = useMetaDailySummary(clientId, windowRange.from, windowRange.to);
  const agg = metrics.data?.aggregated;
  const adSpend = Number(meta.data?.spend || agg?.totalAdSpend || 0);
  const totalLeads = Number(agg?.totalLeads || meta.data?.leads || 0);
  const totalCalls = Number(agg?.totalCalls || 0);
  const showedCalls = Number(agg?.showedCalls || 0);
  const cpl = totalLeads > 0 ? adSpend / totalLeads : Number(agg?.costPerLead || 0);
  const costPerCall = totalCalls > 0 ? adSpend / totalCalls : Number(agg?.costPerCall || 0);
  const costPerShow = showedCalls > 0 ? adSpend / showedCalls : Number(agg?.costPerShow || 0);
  useEffect(() => {
    (async () => {
      const [{ data: clientSettings }, { data: weeklySettings }] = await Promise.all([
        (supabase as any)
          .from('client_settings')
          .select('kpi_google_sheet_url, metrics_sheet_id, metrics_sheet_gid')
          .eq('client_id', clientId)
          .maybeSingle(),
        (supabase as any)
        .from('client_weekly_call_settings')
        .select('scorecard_sheet_url')
        .eq('client_id', clientId)
          .maybeSingle(),
      ]);
      const reportingSheet = buildSheetUrl(clientSettings?.metrics_sheet_id, clientSettings?.metrics_sheet_gid);
      const nextUrl = reportingSheet || clientSettings?.kpi_google_sheet_url || weeklySettings?.scorecard_sheet_url || '';
      setSheetUrl(nextUrl);
      setTmpUrl(nextUrl);
    })();
  }, [clientId]);
  const saveUrl = async () => {
    const trimmed = tmpUrl.trim();
    const parsed = parseSheetUrl(trimmed);
    await (supabase as any)
      .from('client_settings')
      .upsert({
        client_id: clientId,
        kpi_google_sheet_url: trimmed || null,
        metrics_sheet_id: parsed?.sheetId || null,
        metrics_sheet_gid: parsed?.gid || null,
        metrics_source_default: parsed ? 'sheet' : 'database',
      }, { onConflict: 'client_id' });
    await (supabase as any)
      .from('client_weekly_call_settings')
      .upsert({ client_id: clientId, scorecard_sheet_url: trimmed || null }, { onConflict: 'client_id' });
    setSheetUrl(trimmed);
    setEditingUrl(false);
    toast.success('Reporting sheet saved');
  };
  return (
    <div className="w-full max-w-6xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-xs text-muted-foreground">
          Rolling window anchored to call start ({anchorDate(call).toLocaleDateString()})
        </div>
        <div className="flex items-center gap-2">
          {sheetUrl && (
            <Button size="sm" variant="outline" asChild>
              <a href={sheetUrl} target="_blank" rel="noreferrer"><ExternalLink className="w-3.5 h-3.5 mr-1" />Open sheet</a>
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => setEditingUrl((v) => !v)}>
            <Settings2 className="w-3.5 h-3.5" />
          </Button>
          <RangePicker value={range} onChange={setRange} />
        </div>
      </div>
      {editingUrl && (
        <div className="flex gap-2">
          <Input value={tmpUrl} onChange={(e) => setTmpUrl(e.target.value)} placeholder="Paste Google Sheet URL (share link)" />
          <Button size="sm" onClick={saveUrl}>Save</Button>
        </div>
      )}
      <WeeklyRecapCard clientId={clientId} sinceDate={since} compact windowLabel={`Last ${range} days`} />
      <Card className="p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Sheet stats</div>
            <div className="text-sm text-muted-foreground">{windowRange.from} → {windowRange.to}</div>
          </div>
          {metrics.data?.sheetTitle && <div className="text-xs text-muted-foreground truncate max-w-[260px]">{metrics.data.sheetTitle}</div>}
        </div>
        {metrics.isLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-lg" />)}
          </div>
        ) : metrics.error ? (
          <div className="text-sm text-destructive">Could not load sheet stats: {(metrics.error as any)?.message}</div>
        ) : agg ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: 'Ad Spend', value: fmtMoney(adSpend), icon: DollarSign },
              { label: 'Leads', value: fmtInt(totalLeads), icon: Users },
              { label: 'Calls', value: fmtInt(totalCalls), icon: PhoneCall },
              { label: 'Showed', value: fmtInt(showedCalls), icon: CalendarCheck },
              { label: 'CPL', value: fmtMoney(cpl), icon: Percent },
              { label: 'Cost / Call', value: fmtMoney(costPerCall), icon: Percent },
              { label: 'Cost / Show', value: fmtMoney(costPerShow), icon: Percent },
              { label: 'Funded', value: fmtInt(agg.fundedInvestors), icon: Users },
            ].map((item) => (
              <div key={item.label} className="rounded-lg border bg-card p-3">
                <div className="flex items-center gap-2 text-xs text-muted-foreground"><item.icon className="h-3.5 w-3.5" />{item.label}</div>
                <div className="mt-1 text-xl font-semibold tabular-nums">{item.value}</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-sm text-muted-foreground">Connect the client reporting Google Sheet to show sheet stats here.</div>
        )}
      </Card>
      {sheetUrl && (
        <Card className="p-0 overflow-hidden">
          <iframe
            src={embedSheetUrl(sheetUrl)}
            title="Scorecard sheet"
            className="w-full"
            style={{ height: 560, border: 0 }}
            loading="lazy"
          />
        </Card>
      )}
      <Card className="p-4"><NotesBlock callId={callId} clientId={clientId} kind="scorecard_note" label="Scorecard commentary" /></Card>
    </div>
  );
}

export function CreativeReviewSegment({ callId, clientId, call }: { callId: string; clientId: string; call: any }) {
  const { data: client } = useClient(clientId);
  return (
    <div className="w-full max-w-6xl mx-auto space-y-4">
      <div className="text-xs text-muted-foreground">
        Pending creatives only. Approve, request revisions, reject, or comment inline.
      </div>
      <CreativeApproval clientId={clientId} clientName={client?.name || 'client'} defaultTab="pending" />
      <Card className="p-4"><NotesBlock callId={callId} clientId={clientId} kind="creative_note" label="Creative notes" /></Card>
    </div>
  );
}

export function PipelineSegment({ callId, clientId }: { callId: string; clientId: string }) {
  // Deprecated: removed from default agenda. Kept as a no-op stub for backwards compat.
  return null;
}

export function TasksSegment({ callId, clientId, call }: { callId: string; clientId: string; call: any }) {
  return (
    <div className="w-full max-w-[1400px] mx-auto space-y-2">
      <div className="text-xs text-muted-foreground">Client-visible task board. Hidden and agency-review tasks are excluded.</div>
      <TaskBoardView clientId={clientId} isPublicView />
    </div>
  );
}

export function WrapupSegment({ call, clientId, onFinish }: { call: any; clientId: string; onFinish: () => void }) {
  // Deprecated: agenda no longer includes a wrap-up segment; the sticky Finish button
  // in the runner handles ending the call and kicks off recording finalize.
  return null;
}

export function RecapSegment({ callId, clientId }: { callId: string; clientId: string }) {
  return (
    <div className="w-full max-w-4xl mx-auto space-y-3">
      <div className="text-xs text-muted-foreground">
        Type the recap and any action items below. Anything here is saved into this call and folded into the auto-generated summary + proposed tasks. When the timer hits 0 the call auto-finishes — no overtime on this step.
      </div>
      <Card className="p-4">
        <NotesBlock callId={callId} clientId={clientId} kind="recap_note" label="Recap notes & action items" />
      </Card>
    </div>
  );
}