import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CalendarClock, Star, Loader2, Clock, Trash2 } from 'lucide-react';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { WeeklyCallRunner } from './WeeklyCallRunner';
import { format, formatDistanceToNowStrict } from 'date-fns';
import { toast } from 'sonner';
import { PastCallsChat } from './PastCallsChat';
import { ClientCallNotesPanel } from './ClientCallNotesPanel';
import { PastCallPlayer } from '@/components/shared/PastCallPlayer';
import { KickOffMeetingPanel } from '@/components/onboarding/KickOffMeetingPanel';
import { Rocket, ChevronDown } from 'lucide-react';

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
  const [kickoffOpen, setKickoffOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);

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

  const retryFinalize = async (row: Row) => {
    if (!row.recording_url) { toast.error('No recording on this call'); return; }
    setRetryingId(row.id);
    try {
      await (supabase as any).from('client_weekly_calls').update({ finalize_status: 'pending' }).eq('id', row.id);
      const { error } = await supabase.functions.invoke('weekly-call-finalize', { body: { call_id: row.id } });
      if (error) throw error;
      toast.success('Transcription re-queued');
      load();
    } catch (e: any) {
      toast.error(e?.message || 'Retry failed');
    } finally {
      setRetryingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <Button
          size="sm"
          variant={kickoffOpen ? 'secondary' : 'outline'}
          onClick={() => setKickoffOpen((v) => !v)}
        >
          <Rocket className="h-3.5 w-3.5 mr-1" />
          {kickoffOpen ? 'Hide kick-off call' : 'Run kick-off call'}
          <ChevronDown className={`h-3.5 w-3.5 ml-1 transition-transform ${kickoffOpen ? 'rotate-180' : ''}`} />
        </Button>
      </div>
      {kickoffOpen && <KickOffMeetingPanel />}

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

                  {r.avg_rating != null && (
                    <div className="text-xs text-muted-foreground flex gap-3 flex-wrap">
                      <span className="flex items-center gap-1"><Star className="w-3 h-3 text-primary" />{r.avg_rating.toFixed(1)}</span>
                    </div>
                  )}

                  <PastCallPlayer
                    recordingUrl={r.recording_url}
                    transcript={r.transcript}
                    summary={r.summary_text}
                    proposedTasks={r.proposed_tasks}
                    clientId={clientId}
                  />
                  {!r.summary_text && r.finalize_status !== 'processing' && r.recording_url && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 text-[11px] px-2"
                      onClick={() => retryFinalize(r)}
                      disabled={retryingId === r.id}
                    >
                      {retryingId === r.id
                        ? <><Loader2 className="w-3 h-3 mr-1 animate-spin" />Retrying…</>
                        : <><RefreshCw className="w-3 h-3 mr-1" />Retry transcription</>}
                    </Button>
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