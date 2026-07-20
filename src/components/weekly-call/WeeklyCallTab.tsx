import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CalendarClock, Star, CheckSquare, FileAudio, Loader2, ChevronDown, ChevronUp, FileText, Clock, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { WeeklyCallRunner } from './WeeklyCallRunner';
import { format, formatDistanceToNowStrict } from 'date-fns';
import { toast } from 'sonner';
import { useTeamMember } from '@/contexts/TeamMemberContext';
import { PastCallsChat } from './PastCallsChat';
import { ClientCallNotesPanel } from './ClientCallNotesPanel';

interface Row {
  id: string;
  week_of: string;
  title: string | null;
  status: string;
  started_at: string | null;
  ended_at: string | null;
  actual_duration_s: number | null;
  avg_rating: number | null;
  summary_text: string | null;
  transcript: string | null;
  recording_url: string | null;
  proposed_tasks: Array<{ title: string; priority?: string }> | null;
  finalize_status: string | null;
}

export function WeeklyCallTab({ clientId }: { clientId: string }) {
  const [history, setHistory] = useState<Row[]>([]);
  const { currentMember } = useTeamMember();
  const [creatingFor, setCreatingFor] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = async () => {
    const { data } = await (supabase as any)
      .from('client_weekly_calls')
      .select('id, week_of, title, status, started_at, ended_at, actual_duration_s, avg_rating, summary_text, transcript, recording_url, proposed_tasks, finalize_status')
      .eq('client_id', clientId)
      .neq('status', 'cancelled')
      .order('week_of', { ascending: false })
      .limit(20);
    setHistory((data as any) || []);
  };

  useEffect(() => {
    let active = true;
    (async () => {
      if (active) await load();
    })();
    const int = setInterval(load, 15000);
    return () => { active = false; clearInterval(int); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  const approveTasks = async (row: Row) => {
    const tasks = row.proposed_tasks || [];
    if (!tasks.length) return;
    setCreatingFor(row.id);
    try {
      for (const t of tasks) {
        const { data: task } = await (supabase as any).from('tasks').insert({
          client_id: clientId,
          title: t.title,
          status: 'todo',
          stage: 'to-do',
          priority: t.priority || 'medium',
          created_by: currentMember?.id ?? null,
        }).select('id').single();
        if (task?.id) {
          await (supabase as any).from('client_weekly_call_tasks').insert({ call_id: row.id, task_id: task.id, action: 'created' });
        }
      }
      await (supabase as any).from('client_weekly_calls').update({ proposed_tasks: [] as any }).eq('id', row.id);
      toast.success(`Created ${tasks.length} task${tasks.length === 1 ? '' : 's'}`);
      load();
    } catch (e: any) {
      toast.error(e?.message || 'Failed');
    } finally {
      setCreatingFor(null);
    }
  };

  const deleteCall = async (row: Row) => {
    if (!window.confirm(`Delete "${row.title || 'this weekly call'}"? This removes the recording, transcript, action items, and it will no longer be available to the AI review chat.`)) return;
    setDeletingId(row.id);
    try {
      const { error } = await (supabase as any).from('client_weekly_calls').delete().eq('id', row.id);
      if (error) throw error;
      setHistory((h) => h.filter((x) => x.id !== row.id));
      toast.success('Call deleted');
    } catch (e: any) {
      toast.error(e?.message || 'Failed to delete');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <Card className="p-4 md:p-6">
        <div className="flex items-center gap-2 mb-4">
          <CalendarClock className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">This week's call</h2>
        </div>
          <WeeklyCallRunner clientId={clientId} onFinish={load} />
      </Card>

      <div>
        <div className="text-sm font-semibold mb-2">Past calls</div>
        {history.length === 0 ? (
          <div className="text-sm text-muted-foreground italic">No past weekly calls yet.</div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {history.map((r) => {
              const isOpen = !!expanded[r.id];
              const dateSource = r.ended_at || r.started_at || r.week_of;
              const daysAgo = dateSource ? formatDistanceToNowStrict(new Date(dateSource), { addSuffix: true }) : '';
              const mins = r.actual_duration_s != null ? Math.round(r.actual_duration_s / 60) : null;
              const title = r.title?.trim() || `Weekly call — ${format(new Date(r.week_of), 'MMM d, yyyy')}`;
              return (
              <Card key={r.id} className="p-4 text-sm space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold leading-tight truncate">{title}</div>
                      <div className="text-[11px] text-muted-foreground flex flex-wrap gap-x-2 gap-y-0.5 mt-0.5">
                        <span>{format(new Date(r.week_of), 'MMM d, yyyy')}</span>
                        {r.ended_at && <span>· {format(new Date(r.ended_at), 'h:mm a')}</span>}
                        {mins != null && <span className="flex items-center gap-1">· <Clock className="w-3 h-3" />{mins} min</span>}
                        {daysAgo && <span>· {daysAgo}</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {r.finalize_status === 'processing' && (
                        <Badge variant="outline" className="text-[10px] gap-1"><Loader2 className="w-3 h-3 animate-spin" />transcribing</Badge>
                      )}
                      <Badge variant="outline" className="text-[10px]">{r.status}</Badge>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6 text-muted-foreground hover:text-destructive"
                        onClick={() => deleteCall(r)}
                        disabled={deletingId === r.id}
                        title="Delete call"
                      >
                        {deletingId === r.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                      </Button>
                    </div>
                  </div>

                  {(r.avg_rating != null || r.recording_url) && (
                    <div className="text-xs text-muted-foreground flex gap-3 flex-wrap">
                      {r.avg_rating != null && (
                        <span className="flex items-center gap-1"><Star className="w-3 h-3 text-primary" />{r.avg_rating.toFixed(1)}</span>
                      )}
                      {r.recording_url && (
                        <a href={r.recording_url} target="_blank" rel="noreferrer" className="flex items-center gap-1 hover:text-foreground">
                          <FileAudio className="w-3 h-3" />recording
                        </a>
                      )}
                    </div>
                  )}

                  <div className="space-y-2">
                    <div className="text-xs font-semibold text-foreground">Summary of call</div>
                    {r.summary_text ? (
                      <div className="text-xs whitespace-pre-wrap bg-muted/40 rounded p-2 border leading-relaxed">{r.summary_text}</div>
                    ) : r.finalize_status === 'processing' ? (
                      <div className="text-xs italic text-muted-foreground flex items-center gap-1">
                        <Loader2 className="w-3 h-3 animate-spin" /> Generating summary…
                      </div>
                    ) : (
                      <div className="text-xs italic text-muted-foreground">No summary available.</div>
                    )}
                  </div>

                  <div className="space-y-2 border-t pt-2">
                    <div className="text-xs font-semibold flex items-center justify-between">
                      <span>Action items ({r.proposed_tasks?.length || 0})</span>
                      {r.proposed_tasks && r.proposed_tasks.length > 0 && (
                        <Button size="sm" onClick={() => approveTasks(r)} disabled={creatingFor === r.id}>
                          <CheckSquare className="w-3.5 h-3.5 mr-1" />
                          {creatingFor === r.id ? 'Creating…' : 'Approve all'}
                        </Button>
                      )}
                    </div>
                    {r.proposed_tasks && r.proposed_tasks.length > 0 ? (
                      <ul className="space-y-1">
                        {r.proposed_tasks.map((t, i) => (
                          <li key={i} className="text-xs flex items-start gap-2">
                            <span className="mt-0.5">•</span>
                            <span className="flex-1">{t.title}</span>
                            {t.priority && <Badge variant="outline" className="text-[9px]">{t.priority}</Badge>}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <div className="text-xs italic text-muted-foreground">No action items proposed.</div>
                    )}
                  </div>

                  {r.transcript && (
                    <div className="border-t pt-2">
                      <button
                        onClick={() => setExpanded((e) => ({ ...e, [r.id]: !isOpen }))}
                        className="text-xs flex items-center gap-1 text-muted-foreground hover:text-foreground"
                      >
                        <FileText className="w-3 h-3" />
                        {isOpen ? 'Hide full transcript' : 'Click to expand full transcript'}
                        {isOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                      </button>
                      {isOpen && (
                        <div className="mt-2 text-[11px] whitespace-pre-wrap bg-muted/30 rounded p-2 border max-h-96 overflow-y-auto leading-relaxed">
                          {r.transcript}
                        </div>
                      )}
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </div>

      <PastCallsChat clientId={clientId} />
      <ClientCallNotesPanel clientId={clientId} />
    </div>
  );
}