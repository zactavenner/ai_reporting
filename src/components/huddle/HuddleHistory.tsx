import { Fragment, useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';
import { Loader2, RefreshCw, ChevronDown, ChevronUp, Users, Clock, Star, ListChecks, TrendingUp, Mic } from 'lucide-react';
import { toast } from 'sonner';
import { PastCallPlayer } from '@/components/shared/PastCallPlayer';

interface Row {
  id: string;
  date: string;
  actual_duration_s: number | null;
  planned_duration_s: number;
  avg_rating: number | null;
  attendance_pct: number;
  followthrough_pct: number;
  attendees: string[];
  summary_text: string | null;
  transcript: string | null;
  recording_url: string | null;
  finalize_status: string | null;
  proposed_tasks: Array<{ title: string; priority?: string }> | null;
  clients_reviewed: number;
  clients_skipped: number;
  client_time_s: number;
  tasks_total: number;
  tasks_done: number;
  wins_count: number;
  blockers_count: number;
  client_breakdown: { name: string; duration_s: number; status: string }[];
}

function fmt(s: number | null) {
  if (s == null) return '—';
  return `${Math.floor(s / 60)}m ${(s % 60).toString().padStart(2,'0')}s`;
}

export function HuddleHistory() {
  const [rows, setRows] = useState<Row[]>([]);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data: huddles } = await supabase.from('huddles').select('*').order('date', { ascending: false }).limit(60);
    const { data: members } = await supabase.from('agency_members').select('id');
    const totalMembers = (members || []).length || 1;

    const enriched: Row[] = [];
    for (const h of (huddles as any[] || [])) {
      const [{ data: attRows }, { data: tasks }, { data: reviews }, { data: wins }, { data: blockers }] = await Promise.all([
        supabase.from('huddle_attendance').select('member_name').eq('huddle_id', h.id),
        supabase.from('tasks').select('id,status').eq('huddle_id', h.id),
        (supabase as any).from('huddle_client_reviews').select('client_id,duration_s,status,clients(name)').eq('huddle_id', h.id),
        supabase.from('huddle_wins').select('id').eq('huddle_id', h.id),
        supabase.from('huddle_blockers').select('id').eq('huddle_id', h.id),
      ]);
      const attendees = ((attRows as any[]) || []).map(a => a.member_name).filter(Boolean);
      const total = (tasks || []).length;
      const done = (tasks || []).filter((t: any) => t.status === 'completed' || t.status === 'done').length;
      const revs = (reviews as any[]) || [];
      const clients_reviewed = revs.filter(r => r.status === 'reviewed').length;
      const clients_skipped = revs.filter(r => r.status === 'skipped').length;
      const client_time_s = revs.reduce((s, r) => s + (Number(r.duration_s) || 0), 0);
      const client_breakdown = revs
        .map(r => ({ name: r?.clients?.name || 'Unknown', duration_s: Number(r.duration_s) || 0, status: r.status || 'reviewed' }))
        .sort((a, b) => b.duration_s - a.duration_s);
      enriched.push({
        id: h.id,
        date: h.date,
        actual_duration_s: h.actual_duration_s,
        planned_duration_s: h.planned_duration_s,
        avg_rating: h.avg_rating,
        attendance_pct: Math.round((attendees.length / totalMembers) * 100),
        followthrough_pct: total ? Math.round((done / total) * 100) : 0,
        attendees,
        summary_text: h.summary_text ?? null,
        transcript: h.transcript ?? null,
        recording_url: h.recording_url ?? null,
        finalize_status: h.finalize_status ?? null,
        proposed_tasks: Array.isArray(h.proposed_tasks) ? h.proposed_tasks : null,
        clients_reviewed,
        clients_skipped,
        client_time_s,
        tasks_total: total,
        tasks_done: done,
        wins_count: (wins || []).length,
        blockers_count: (blockers || []).length,
        client_breakdown,
      });
    }
    setRows(enriched);
  }, []);

  useEffect(() => { load(); }, [load]);

  const retryFinalize = async (row: Row) => {
    if (!row.recording_url) { toast.error('No recording on this huddle'); return; }
    setRetryingId(row.id);
    try {
      await supabase.from('huddles').update({ finalize_status: 'pending' } as any).eq('id', row.id);
      const { error } = await supabase.functions.invoke('huddle-finalize', { body: { huddle_id: row.id } });
      if (error) throw error;
      toast.success('Huddle transcription re-queued');
      load();
    } catch (e: any) {
      toast.error(e?.message || 'Retry failed');
    } finally {
      setRetryingId(null);
    }
  };

  const chartData = [...rows].reverse().slice(-30).map(r => ({
    date: r.date.slice(5),
    followThrough: r.followthrough_pct,
    attendance: r.attendance_pct,
    duration: Math.round((r.actual_duration_s || 0) / 60),
  }));

  // Executive KPI roll-up across all loaded huddles
  const kpi = (() => {
    const n = rows.length || 1;
    const totalMin = Math.round(rows.reduce((s, r) => s + (r.actual_duration_s || 0), 0) / 60);
    const avgMin = Math.round(totalMin / n);
    const ratings = rows.filter(r => r.avg_rating != null);
    const avgRating = ratings.length ? (ratings.reduce((s, r) => s + (r.avg_rating || 0), 0) / ratings.length) : null;
    const attPct = Math.round(rows.reduce((s, r) => s + r.attendance_pct, 0) / n);
    const ftPct = Math.round(rows.reduce((s, r) => s + r.followthrough_pct, 0) / n);
    const transcribed = rows.filter(r => !!r.summary_text).length;
    const clientTimeMin = Math.round(rows.reduce((s, r) => s + r.client_time_s, 0) / 60);
    const totalClientsReviewed = rows.reduce((s, r) => s + r.clients_reviewed, 0);
    return { n: rows.length, totalMin, avgMin, avgRating, attPct, ftPct, transcribed, clientTimeMin, totalClientsReviewed };
  })();

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
        <MiniKpi icon={<ListChecks className="w-4 h-4" />} label="Huddles" value={kpi.n.toString()} />
        <MiniKpi icon={<Clock className="w-4 h-4" />} label="Total time" value={`${kpi.totalMin}m`} sub={`avg ${kpi.avgMin}m`} />
        <MiniKpi icon={<Users className="w-4 h-4" />} label="Attendance" value={`${kpi.attPct}%`} />
        <MiniKpi icon={<Star className="w-4 h-4" />} label="Avg rating" value={kpi.avgRating ? kpi.avgRating.toFixed(1) : '—'} />
        <MiniKpi icon={<TrendingUp className="w-4 h-4" />} label="Follow-through" value={`${kpi.ftPct}%`} />
        <MiniKpi icon={<Mic className="w-4 h-4" />} label="Transcribed" value={`${kpi.transcribed}/${kpi.n}`} />
        <MiniKpi icon={<Clock className="w-4 h-4" />} label="Client time" value={`${kpi.clientTimeMin}m`} />
        <MiniKpi icon={<Users className="w-4 h-4" />} label="Clients reviewed" value={kpi.totalClientsReviewed.toString()} />
      </div>

      <Card className="p-4">
        <div className="text-sm font-semibold mb-2">30-day trend</div>
        <div className="h-52">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
              <XAxis dataKey="date" fontSize={11} />
              <YAxis yAxisId="pct" domain={[0, 100]} fontSize={11} unit="%" />
              <YAxis yAxisId="min" orientation="right" fontSize={11} unit="m" />
              <Tooltip />
              <Legend />
              <Line yAxisId="pct" type="monotone" dataKey="followThrough" name="Follow-through %" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
              <Line yAxisId="pct" type="monotone" dataKey="attendance" name="Attendance %" stroke="hsl(var(--muted-foreground))" strokeWidth={2} dot={false} />
              <Line yAxisId="min" type="monotone" dataKey="duration" name="Duration (min)" stroke="hsl(var(--destructive))" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Duration</TableHead>
              <TableHead>Rating</TableHead>
              <TableHead>Attendance</TableHead>
              <TableHead>Clients (rev/skip)</TableHead>
              <TableHead>Wins / Blockers</TableHead>
              <TableHead>Tasks</TableHead>
              <TableHead>Follow-through / Recap</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(r => (
              <Fragment key={r.id}>
                <TableRow className="align-top">
                  <TableCell className="font-medium">{r.date}</TableCell>
                  <TableCell>{fmt(r.actual_duration_s)} / {fmt(r.planned_duration_s)}</TableCell>
                  <TableCell>{r.avg_rating ? r.avg_rating.toFixed(1) : '—'}</TableCell>
                  <TableCell>{r.attendees.length} · {r.attendance_pct}%</TableCell>
                  <TableCell className="text-xs">
                    <div><span className="text-emerald-600 font-medium">{r.clients_reviewed}</span> / <span className="text-muted-foreground">{r.clients_skipped}</span></div>
                    <div className="text-[10px] text-muted-foreground">{fmt(r.client_time_s)} on clients</div>
                  </TableCell>
                  <TableCell className="text-xs">
                    <div><span className="text-primary font-medium">{r.wins_count}</span> wins</div>
                    <div className="text-[10px] text-amber-600">{r.blockers_count} blockers</div>
                  </TableCell>
                  <TableCell className="text-xs">
                    {r.tasks_done}/{r.tasks_total}
                  </TableCell>
                  <TableCell>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <div>{r.followthrough_pct}%</div>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 px-2 text-[11px]"
                          onClick={() => setOpenId((id) => id === r.id ? null : r.id)}
                        >
                          {openId === r.id ? <ChevronUp className="w-3 h-3 mr-1" /> : <ChevronDown className="w-3 h-3 mr-1" />}
                          {openId === r.id ? 'Hide' : 'Recap'}
                        </Button>
                      </div>
                      <div className="flex flex-wrap items-center gap-1">
                        {r.finalize_status === 'processing' && (
                          <Badge variant="outline" className="text-[10px] gap-1"><Loader2 className="w-3 h-3 animate-spin" />transcribing</Badge>
                        )}
                        {r.recording_url && !r.summary_text && r.finalize_status !== 'processing' && (
                          <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]" onClick={() => retryFinalize(r)} disabled={retryingId === r.id}>
                            {retryingId === r.id ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <RefreshCw className="w-3 h-3 mr-1" />}
                            Retry
                          </Button>
                        )}
                      </div>
                      {!openId && !!r.proposed_tasks?.length && (
                        <div className="text-[11px] text-muted-foreground">{r.proposed_tasks.length} proposed tasks</div>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
                {openId === r.id && (
                  <TableRow>
                    <TableCell colSpan={8} className="bg-muted/20">
                      <div className="space-y-4">
                        {r.attendees.length > 0 && (
                          <div>
                            <div className="text-xs font-semibold uppercase text-muted-foreground mb-1">Attendees ({r.attendees.length})</div>
                            <div className="flex flex-wrap gap-1">
                              {r.attendees.map((n, i) => (
                                <span key={i} className="inline-block rounded-full bg-primary/10 text-primary text-[10px] px-2 py-0.5">{n}</span>
                              ))}
                            </div>
                          </div>
                        )}
                        {r.client_breakdown.length > 0 && (
                          <div>
                            <div className="text-xs font-semibold uppercase text-muted-foreground mb-1">Time per client ({r.client_breakdown.length})</div>
                            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 text-xs">
                              {r.client_breakdown.map((c, i) => (
                                <div key={i} className="flex items-center justify-between border rounded-md px-2 py-1">
                                  <span className="truncate">{c.name}</span>
                                  <span className={`font-mono tabular-nums ${c.status === 'skipped' ? 'text-muted-foreground' : 'text-emerald-600'}`}>
                                    {fmt(c.duration_s)}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        <PastCallPlayer
                          recordingUrl={r.recording_url}
                          transcript={r.transcript}
                          summary={r.summary_text}
                          proposedTasks={r.proposed_tasks}
                          taskExtras={{ huddle_id: r.id }}
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            ))}
            {rows.length === 0 && (
              <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground">No huddles yet.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

function MiniKpi({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub?: string }) {
  return (
    <Card className="p-3">
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">{icon}<span>{label}</span></div>
      <div className="text-xl font-semibold mt-1 tabular-nums">{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground">{sub}</div>}
    </Card>
  );
}