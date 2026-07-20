import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CalendarClock, Star, CheckSquare, FileAudio, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { WeeklyCallRunner } from './WeeklyCallRunner';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { useTeamMember } from '@/contexts/TeamMemberContext';

interface Row {
  id: string;
  week_of: string;
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

  const load = async () => {
    const { data } = await (supabase as any)
      .from('client_weekly_calls')
      .select('id, week_of, status, started_at, ended_at, actual_duration_s, avg_rating, summary_text, transcript, recording_url, proposed_tasks, finalize_status')
      .eq('client_id', clientId)
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
            {history.map((r) => (
              <Card key={r.id} className="p-4 text-sm space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-semibold">Week of {format(new Date(r.week_of), 'MMM d, yyyy')}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {r.ended_at ? format(new Date(r.ended_at), "MMM d, yyyy · h:mm a") : (r.started_at ? format(new Date(r.started_at), "MMM d, yyyy · h:mm a") : '—')}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    {r.finalize_status === 'processing' && (
                      <Badge variant="outline" className="text-[10px] gap-1"><Loader2 className="w-3 h-3 animate-spin" />transcribing</Badge>
                    )}
                    <Badge variant="outline" className="text-[10px]">{r.status}</Badge>
                  </div>
                </div>
                <div className="text-xs text-muted-foreground flex gap-3 flex-wrap">
                  {r.actual_duration_s != null && <span>{Math.round((r.actual_duration_s || 0) / 60)} min</span>}
                  {r.avg_rating != null && (
                    <span className="flex items-center gap-1"><Star className="w-3 h-3 text-primary" />{r.avg_rating.toFixed(1)}</span>
                  )}
                  {r.recording_url && (
                    <a href={r.recording_url} target="_blank" rel="noreferrer" className="flex items-center gap-1 hover:text-foreground">
                      <FileAudio className="w-3 h-3" />recording
                    </a>
                  )}
                </div>
                {r.summary_text && (
                  <div className="text-xs whitespace-pre-wrap bg-muted/40 rounded p-2 border">{r.summary_text}</div>
                )}
                {r.proposed_tasks && r.proposed_tasks.length > 0 && (
                  <div className="space-y-2 border-t pt-2">
                    <div className="text-xs font-semibold flex items-center justify-between">
                      <span>Proposed tasks ({r.proposed_tasks.length})</span>
                      <Button size="sm" onClick={() => approveTasks(r)} disabled={creatingFor === r.id}>
                        <CheckSquare className="w-3.5 h-3.5 mr-1" />
                        {creatingFor === r.id ? 'Creating…' : 'Approve all'}
                      </Button>
                    </div>
                    <ul className="space-y-1">
                      {r.proposed_tasks.map((t, i) => (
                        <li key={i} className="text-xs flex items-start gap-2">
                          <span className="mt-0.5">•</span>
                          <span className="flex-1">{t.title}</span>
                          {t.priority && <Badge variant="outline" className="text-[9px]">{t.priority}</Badge>}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}