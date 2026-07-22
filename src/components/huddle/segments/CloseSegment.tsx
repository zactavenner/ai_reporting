import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useTeamMember } from '@/contexts/TeamMemberContext';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Copy, Check, Clock, ListChecks, CalendarClock, SkipForward, Loader2 } from 'lucide-react';
import { buildSummary, copyText } from '@/lib/huddle/summary';
import type { AgendaSegment } from '@/lib/huddle/types';
import type { HuddleRecord } from '@/hooks/useHuddle';

interface Props {
  huddle: HuddleRecord;
  agenda: AgendaSegment[];
}

function fmtDur(seconds: number): string {
  const s = Math.max(0, Math.round(seconds || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

interface ClientRow { client_id: string; name: string; status: string; duration_s: number }
interface TaskRow { id: string; title: string; assignee: string | null; due_date: string | null; client_name: string | null }

export function CloseSegment({ huddle, agenda }: Props) {
  const { currentMember } = useTeamMember();
  const [summary, setSummary] = useState('');
  const [rating, setRating] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [clientRows, setClientRows] = useState<ClientRow[]>([]);
  const [tasksDueToday, setTasksDueToday] = useState<TaskRow[]>([]);
  const [transcribing, setTranscribing] = useState(false);

  const totalHuddleSeconds = useMemo(() => {
    if (huddle.actual_duration_s) return huddle.actual_duration_s;
    if (huddle.started_at) return Math.max(0, Math.floor((Date.now() - new Date(huddle.started_at).getTime()) / 1000));
    return 0;
  }, [huddle.actual_duration_s, huddle.started_at]);
  const totalClientSeconds = useMemo(
    () => clientRows.reduce((sum, r) => sum + (r.duration_s || 0), 0),
    [clientRows],
  );
  const reviewedCount = clientRows.filter((r) => r.status === 'reviewed').length;
  const skippedCount = clientRows.filter((r) => r.status === 'skipped').length;

  useEffect(() => {
    let cancelled = false;
    const build = async () => {
      const [{ data: att }, { data: wins }, { data: flags }, { data: tasks }, { data: blockers }, { data: ratings }] = await Promise.all([
        supabase.from('huddle_attendance').select('member_name').eq('huddle_id', huddle.id),
        supabase.from('huddle_wins').select('member_name,text').eq('huddle_id', huddle.id),
        supabase.from('huddle_flags').select('client_id,reason').eq('huddle_id', huddle.id),
        supabase.from('tasks').select('title,assigned_to,due_date').eq('huddle_id', huddle.id),
        supabase.from('huddle_blockers').select('description,unblocker_name').eq('huddle_id', huddle.id),
        supabase.from('huddle_ratings').select('rating').eq('huddle_id', huddle.id),
      ]);
      const { data: clients } = await supabase.from('clients').select('id,name').in('id', (flags || []).map((f: any) => f.client_id).filter(Boolean));
      const { data: members } = await supabase.from('agency_members').select('id,name');
      const cMap = Object.fromEntries((clients || []).map((c: any) => [c.id, c.name]));
      const mMap = Object.fromEntries((members || []).map((m: any) => [m.id, m.name]));
      const text = buildSummary({
        date: huddle.date,
        actual_duration_s: huddle.actual_duration_s,
        planned_duration_s: huddle.planned_duration_s,
        attendance: (att as any) || [],
        wins: (wins as any) || [],
        flags: ((flags as any) || []).map((f: any) => ({ client_name: cMap[f.client_id], reason: f.reason })),
        new_tasks: ((tasks as any) || []).map((t: any) => ({ title: t.title, owner_name: mMap[t.assigned_to || ''], due_date: t.due_date })),
        blockers: (blockers as any) || [],
        ratings: (ratings as any) || [],
        agenda,
      });
      if (!cancelled) setSummary(text);

      // Per-client completions from this huddle
      const { data: reviews } = await (supabase as any)
        .from('huddle_client_reviews')
        .select('client_id,duration_s,status,position,clients(name)')
        .eq('huddle_id', huddle.id)
        .order('position', { ascending: true });
      if (!cancelled) {
        setClientRows(
          ((reviews as any[]) || []).map((r) => ({
            client_id: r.client_id,
            name: r?.clients?.name || 'Unknown',
            status: r.status || 'pending',
            duration_s: Number(r.duration_s) || 0,
          })),
        );
      }

      // Tasks due today (with assignees) across the agency
      const today = todayISO();
      const { data: dueToday } = await (supabase as any)
        .from('tasks')
        .select('id,title,due_date,assigned_to,client_id,agency_members!tasks_assigned_to_fkey(name),clients(name)')
        .eq('due_date', today)
        .neq('status', 'completed')
        .neq('status', 'done')
        .order('created_at', { ascending: true })
        .limit(50);
      if (!cancelled) {
        setTasksDueToday(
          ((dueToday as any[]) || []).map((t) => ({
            id: t.id,
            title: t.title,
            assignee: t?.agency_members?.name || null,
            due_date: t.due_date,
            client_name: t?.clients?.name || null,
          })),
        );
      }
    };
    build();
    return () => { cancelled = true; };
  }, [huddle, agenda]);

  const submitRating = async (n: number) => {
    setRating(n);
    await supabase.from('huddle_ratings').upsert(
      {
        huddle_id: huddle.id,
        member_id: currentMember?.id ?? null,
        member_name: currentMember?.name ?? 'Anon',
        rating: n,
      },
      { onConflict: 'huddle_id,member_id' }
    );
    toast.success('Rating saved');
  };

  const doCopy = async () => {
    const ok = await copyText(summary);
    if (ok) { setCopied(true); setTimeout(() => setCopied(false), 2000); toast.success('Copied'); }
  };

  const startTranscribing = async () => {
    setTranscribing(true);
    try {
      await (supabase as any).from('huddles').update({ finalize_status: 'pending' }).eq('id', huddle.id);
      const { error } = await supabase.functions.invoke('huddle-finalize', { body: { huddle_id: huddle.id } });
      if (error) throw error;
      toast.success('Transcription queued — summary + action items will appear in History');
    } catch (e: any) {
      toast.error(e?.message || 'Failed to start transcription');
    } finally {
      setTranscribing(false);
    }
  };

  return (
    <div className="w-full max-w-5xl mx-auto space-y-4">
      {/* Roll-up KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="p-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground"><Clock className="w-3.5 h-3.5" /> Total huddle time</div>
          <div className="text-2xl font-semibold mt-1">{fmtDur(totalHuddleSeconds)}</div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground"><Clock className="w-3.5 h-3.5" /> Time on clients</div>
          <div className="text-2xl font-semibold mt-1">{fmtDur(totalClientSeconds)}</div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground"><ListChecks className="w-3.5 h-3.5" /> Clients reviewed</div>
          <div className="text-2xl font-semibold mt-1">{reviewedCount}<span className="text-sm text-muted-foreground font-normal"> / {clientRows.length}</span></div>
          {skippedCount > 0 && <div className="text-[11px] text-muted-foreground mt-0.5">{skippedCount} skipped</div>}
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground"><CalendarClock className="w-3.5 h-3.5" /> Tasks due today</div>
          <div className="text-2xl font-semibold mt-1">{tasksDueToday.length}</div>
        </Card>
      </div>

      {/* Per-client completions */}
      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm font-semibold">Marked complete this huddle</div>
          <div className="text-xs text-muted-foreground">{reviewedCount}/{clientRows.length} reviewed · {fmtDur(totalClientSeconds)}</div>
        </div>
        {clientRows.length === 0 ? (
          <div className="text-sm text-muted-foreground italic">No client walkthrough entries recorded.</div>
        ) : (
          <ul className="divide-y">
            {clientRows.map((r, i) => (
              <li key={r.client_id} className="flex items-center justify-between py-2 gap-3 text-sm">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-xs text-muted-foreground w-5 tabular-nums">{i + 1}.</span>
                  <span className="font-medium truncate">{r.name}</span>
                  {r.status === 'reviewed' && <Badge variant="default" className="text-[10px]"><Check className="w-3 h-3 mr-0.5" />reviewed</Badge>}
                  {r.status === 'skipped' && <Badge variant="outline" className="text-[10px]"><SkipForward className="w-3 h-3 mr-0.5" />skipped</Badge>}
                  {r.status === 'pending' && <Badge variant="secondary" className="text-[10px]">pending</Badge>}
                </div>
                <div className="text-xs text-muted-foreground tabular-nums shrink-0">{fmtDur(r.duration_s)}</div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Tasks due today */}
      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm font-semibold">Tasks due today ({tasksDueToday.length})</div>
        </div>
        {tasksDueToday.length === 0 ? (
          <div className="text-sm text-muted-foreground italic">Nothing due today. 🎉</div>
        ) : (
          <ul className="divide-y">
            {tasksDueToday.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <div className="min-w-0">
                  <div className="font-medium truncate">{t.title}</div>
                  {t.client_name && <div className="text-[11px] text-muted-foreground">{t.client_name}</div>}
                </div>
                <Badge variant={t.assignee ? 'secondary' : 'outline'} className="text-[10px] shrink-0">
                  {t.assignee || 'Unassigned'}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Start transcribing */}
      <Card className="p-4 flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">Recording & transcription</div>
          <div className="text-xs text-muted-foreground">
            Kick off AI transcription + summary + action items now. Also runs automatically when you press Finish.
          </div>
        </div>
        <Button onClick={startTranscribing} disabled={transcribing}>
          {transcribing ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Queuing…</> : 'Start transcribing'}
        </Button>
      </Card>

      <Card className="p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="text-sm font-semibold">Summary preview</div>
          <Button size="sm" variant="outline" onClick={doCopy}>
            {copied ? <Check className="w-4 h-4 mr-1" /> : <Copy className="w-4 h-4 mr-1" />}
            Copy
          </Button>
        </div>
        <pre className="text-xs whitespace-pre-wrap font-mono max-h-[35vh] overflow-y-auto">{summary}</pre>
      </Card>
      <div>
        <div className="text-sm font-semibold mb-2">Rate this huddle (1–10)</div>
        <div className="flex gap-1 flex-wrap">
          {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
            <Button
              key={n}
              variant={rating === n ? 'default' : 'outline'}
              className="w-10 h-10"
              onClick={() => submitRating(n)}
            >
              {n}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}