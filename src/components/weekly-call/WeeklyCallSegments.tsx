import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useTeamMember } from '@/contexts/TeamMemberContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Trophy, Plus, AlertTriangle, Lightbulb, CheckSquare, Star, X } from 'lucide-react';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { WeeklyRecapCard } from '@/components/weekly-sync/WeeklyRecapCard';
import { useTasks } from '@/hooks/useTasks';
import { CreativeApproval } from '@/components/creative/CreativeApproval';
import { useClient } from '@/hooks/useClients';
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
  return (
    <div className="w-full max-w-5xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-xs text-muted-foreground">
          Rolling window anchored to call start ({anchorDate(call).toLocaleDateString()})
        </div>
        <RangePicker value={range} onChange={setRange} />
      </div>
      <WeeklyRecapCard clientId={clientId} sinceDate={since} compact windowLabel={`Last ${range} days`} />
      <Card className="p-4"><NotesBlock callId={callId} clientId={clientId} kind="scorecard_note" label="Scorecard commentary" /></Card>
    </div>
  );
}

export function CreativeReviewSegment({ callId, clientId, call }: { callId: string; clientId: string; call: any }) {
  const { data: client } = useClient(clientId);
  return (
    <div className="w-full max-w-6xl mx-auto space-y-4">
      <div className="text-xs text-muted-foreground">
        Review any creatives still pending approval. Approve, request revisions, reject, or comment inline.
      </div>
      <CreativeApproval clientId={clientId} clientName={client?.name || 'client'} />
      <Card className="p-4"><NotesBlock callId={callId} clientId={clientId} kind="creative_note" label="Creative notes" /></Card>
    </div>
  );
}

export function PipelineSegment({ callId, clientId }: { callId: string; clientId: string }) {
  // Deprecated: removed from default agenda. Kept as a no-op stub for backwards compat.
  return null;
}

export function TasksSegment({ callId, clientId, call }: { callId: string; clientId: string; call: any }) {
  const { currentMember } = useTeamMember();
  const { data: tasks = [] } = useTasks(clientId);
  const [title, setTitle] = useState('');
  const [range, setRange] = useState<RangeDays>(7);
  const since = new Date(sinceISO(anchorDate(call), range)).getTime();
  const completedThisWeek = tasks.filter((t: any) => t.status === 'completed' && t.completed_at && new Date(t.completed_at).getTime() >= since);
  const openImportant = tasks.filter((t: any) => t.status !== 'completed').slice(0, 8);

  const addTask = async () => {
    if (!title.trim()) return;
    const { data: task } = await (supabase as any).from('tasks').insert({
      client_id: clientId,
      title: title.trim(),
      status: 'todo',
      stage: 'to-do',
      priority: 'medium',
      created_by: currentMember?.id ?? null,
    }).select('id').single();
    if (task?.id) {
      await (supabase as any).from('client_weekly_call_tasks').insert({ call_id: callId, task_id: task.id, action: 'created' });
    }
    setTitle('');
    toast.success('Task created');
  };

  return (
    <div className="w-full max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-4">
      <div className="md:col-span-2 flex items-center justify-between">
        <div className="text-xs text-muted-foreground">
          Completed window anchored to call start ({anchorDate(call).toLocaleDateString()})
        </div>
        <RangePicker value={range} onChange={setRange} />
      </div>
      <Card className="p-4">
        <div className="text-sm font-semibold mb-2">Completed in last {range} days ({completedThisWeek.length})</div>
        {completedThisWeek.length === 0 ? (
          <div className="text-xs text-muted-foreground italic">Nothing marked complete yet.</div>
        ) : (
          <ul className="space-y-1 text-sm">
            {completedThisWeek.map((t: any) => (
              <li key={t.id} className="flex items-center gap-2"><CheckSquare className="w-3.5 h-3.5 text-primary" />{t.title}</li>
            ))}
          </ul>
        )}
      </Card>
      <Card className="p-4 space-y-3">
        <div className="text-sm font-semibold">Open tasks</div>
        <ul className="space-y-1 text-sm">
          {openImportant.map((t: any) => (
            <li key={t.id} className="flex items-center justify-between border-b border-border/40 pb-1 last:border-0">
              <span className="truncate">{t.title}</span>
              <Badge variant="outline" className="text-[10px]">{t.stage}</Badge>
            </li>
          ))}
          {openImportant.length === 0 && <li className="text-xs text-muted-foreground italic">No open tasks.</li>}
        </ul>
        <div className="pt-2 border-t space-y-2">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Add task for this week</div>
          <div className="flex gap-2">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addTask()} placeholder="New task…" />
            <Button onClick={addTask}><Plus className="w-4 h-4" /></Button>
          </div>
        </div>
      </Card>
    </div>
  );
}

export function WrapupSegment({ call, clientId, onFinish }: { call: any; clientId: string; onFinish: () => void }) {
  const { currentMember } = useTeamMember();
  const [drafts, setDrafts] = useState<string[]>(['']);
  const [creating, setCreating] = useState(false);

  const update = (i: number, v: string) => setDrafts((p) => p.map((x, idx) => (idx === i ? v : x)));
  const remove = (i: number) => setDrafts((p) => p.filter((_, idx) => idx !== i));
  const addRow = () => setDrafts((p) => [...p, '']);

  const approveAll = async () => {
    const clean = drafts.map((t) => t.trim()).filter(Boolean);
    if (!clean.length) { toast.error('Add at least one task'); return; }
    setCreating(true);
    try {
      for (const title of clean) {
        const { data: task } = await (supabase as any).from('tasks').insert({
          client_id: clientId,
          title,
          status: 'todo',
          stage: 'to-do',
          priority: 'medium',
          created_by: currentMember?.id ?? null,
        }).select('id').single();
        if (task?.id) {
          await (supabase as any).from('client_weekly_call_tasks').insert({ call_id: call.id, task_id: task.id, action: 'created' });
        }
      }
      setDrafts(['']);
      toast.success(`Created ${clean.length} task${clean.length === 1 ? '' : 's'}`);
    } catch (e: any) {
      toast.error(e?.message || 'Failed to create tasks');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="w-full max-w-3xl mx-auto space-y-4">
      <Card className="p-4 space-y-3">
        <div className="text-sm font-semibold">Tasks to create from this call</div>
        <div className="text-xs text-muted-foreground">Add each task discussed. Approve to create them all at once before finishing.</div>
        <div className="space-y-2">
          {drafts.map((t, i) => (
            <div key={i} className="flex gap-2">
              <Input value={t} onChange={(e) => update(i, e.target.value)} placeholder={`Task ${i + 1}…`} />
              {drafts.length > 1 && (
                <Button variant="ghost" size="icon" onClick={() => remove(i)} aria-label="Remove"><X className="w-4 h-4" /></Button>
              )}
            </div>
          ))}
        </div>
        <div className="flex gap-2 justify-between">
          <Button variant="outline" size="sm" onClick={addRow}><Plus className="w-4 h-4 mr-1" />Add row</Button>
          <Button onClick={approveAll} disabled={creating}>
            <CheckSquare className="w-4 h-4 mr-2" />{creating ? 'Creating…' : 'Approve & create all'}
          </Button>
        </div>
      </Card>

      <Card className="p-4 text-xs text-muted-foreground">
        This call is auto-recorded, transcribed, and summarized. You'll find the recap under <span className="font-medium text-foreground">Past calls</span> once it finishes.
      </Card>

      <div className="flex justify-center">
        <Button size="lg" onClick={onFinish}>Finish call</Button>
      </div>
    </div>
  );
}