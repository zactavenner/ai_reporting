import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useTeamMember } from '@/contexts/TeamMemberContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Trophy, Plus, AlertTriangle, Lightbulb, CheckSquare, Star, X, ExternalLink, Settings2 } from 'lucide-react';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { WeeklyRecapCard } from '@/components/weekly-sync/WeeklyRecapCard';
import { useTasks } from '@/hooks/useTasks';
import { CreativeApproval } from '@/components/creative/CreativeApproval';
import { useClient } from '@/hooks/useClients';
import { TaskBoardView } from '@/components/tasks/TaskBoardView';
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
  const [sheetUrl, setSheetUrl] = useState<string>('');
  const [editingUrl, setEditingUrl] = useState(false);
  const [tmpUrl, setTmpUrl] = useState('');
  useEffect(() => {
    (async () => {
      const { data } = await (supabase as any)
        .from('client_weekly_call_settings')
        .select('scorecard_sheet_url')
        .eq('client_id', clientId)
        .maybeSingle();
      setSheetUrl(data?.scorecard_sheet_url || '');
      setTmpUrl(data?.scorecard_sheet_url || '');
    })();
  }, [clientId]);
  const saveUrl = async () => {
    await (supabase as any)
      .from('client_weekly_call_settings')
      .upsert({ client_id: clientId, scorecard_sheet_url: tmpUrl.trim() || null });
    setSheetUrl(tmpUrl.trim());
    setEditingUrl(false);
    toast.success('Scorecard sheet saved');
  };
  const embedUrl = (u: string) => {
    if (!u) return '';
    // Force embed mode on Google Sheets share links
    return u.includes('/pubhtml') || u.includes('output=') || u.includes('widget=')
      ? u
      : u.replace(/\/edit.*$/, '/preview').replace(/\/view.*$/, '/preview');
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
      {sheetUrl && (
        <Card className="p-0 overflow-hidden">
          <iframe
            src={embedUrl(sheetUrl)}
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