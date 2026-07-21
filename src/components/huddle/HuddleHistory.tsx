import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { FileAudio, Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';

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
  proposed_tasks: Array<{ title?: string }> | null;
}

function fmt(s: number | null) {
  if (s == null) return '—';
  return `${Math.floor(s / 60)}m ${(s % 60).toString().padStart(2,'0')}s`;
}

export function HuddleHistory() {
  const [rows, setRows] = useState<Row[]>([]);
  const [retryingId, setRetryingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data: huddles } = await supabase.from('huddles').select('*').order('date', { ascending: false }).limit(60);
    const { data: members } = await supabase.from('agency_members').select('id');
    const totalMembers = (members || []).length || 1;

    const enriched: Row[] = [];
    for (const h of (huddles as any[] || [])) {
      const [{ data: attRows }, { data: tasks }] = await Promise.all([
        supabase.from('huddle_attendance').select('member_name').eq('huddle_id', h.id),
        supabase.from('tasks').select('id,status').eq('huddle_id', h.id),
      ]);
      const attendees = ((attRows as any[]) || []).map(a => a.member_name).filter(Boolean);
      const total = (tasks || []).length;
      const done = (tasks || []).filter((t: any) => t.status === 'completed' || t.status === 'done').length;
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
      });
    }
    setRows(enriched);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

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

  const openRecording = async (row: Row) => {
    if (!row.recording_url) return;
    const marker = '/weekly-call-recordings/';
    const idx = row.recording_url.indexOf(marker);
    if (idx === -1) { window.open(row.recording_url, '_blank'); return; }
    const path = row.recording_url.slice(idx + marker.length).split('?')[0];
    const { data, error } = await supabase.storage.from('weekly-call-recordings').createSignedUrl(path, 3600);
    if (error || !data?.signedUrl) { toast.error('Could not open recording'); return; }
    window.open(data.signedUrl, '_blank');
  };

  const chartData = [...rows].reverse().slice(-30).map(r => ({ date: r.date.slice(5), pct: r.followthrough_pct }));

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="text-sm font-semibold mb-2">30-day follow-through</div>
        <div className="h-40">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <XAxis dataKey="date" fontSize={11} />
              <YAxis domain={[0, 100]} fontSize={11} unit="%" />
              <Tooltip />
              <Line type="monotone" dataKey="pct" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Duration (actual/planned)</TableHead>
              <TableHead>Avg rating</TableHead>
              <TableHead>Attendance</TableHead>
              <TableHead>Attendees</TableHead>
              <TableHead>Follow-through</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(r => (
              <TableRow key={r.id} className="align-top">
                <TableCell className="font-medium">{r.date}</TableCell>
                <TableCell>{fmt(r.actual_duration_s)} / {fmt(r.planned_duration_s)}</TableCell>
                <TableCell>{r.avg_rating ? r.avg_rating.toFixed(1) : '—'}</TableCell>
                <TableCell>{r.attendees.length} · {r.attendance_pct}%</TableCell>
                <TableCell className="max-w-[280px]">
                  <div className="flex flex-wrap gap-1">
                    {r.attendees.slice(0, 6).map((n, i) => (
                      <span key={i} className="inline-block rounded-full bg-primary/10 text-primary text-[10px] px-2 py-0.5">{n}</span>
                    ))}
                    {r.attendees.length > 6 && <span className="text-[10px] text-muted-foreground">+{r.attendees.length - 6}</span>}
                    {r.attendees.length === 0 && <span className="text-[10px] text-muted-foreground">—</span>}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="space-y-2">
                    <div>{r.followthrough_pct}%</div>
                    <div className="flex flex-wrap items-center gap-1">
                      {r.finalize_status === 'processing' && (
                        <Badge variant="outline" className="text-[10px] gap-1"><Loader2 className="w-3 h-3 animate-spin" />transcribing</Badge>
                      )}
                      {r.recording_url && (
                        <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={() => openRecording(r)}>
                          <FileAudio className="w-3 h-3 mr-1" />Recording
                        </Button>
                      )}
                      {r.recording_url && !r.summary_text && r.finalize_status !== 'processing' && (
                        <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]" onClick={() => retryFinalize(r)} disabled={retryingId === r.id}>
                          {retryingId === r.id ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <RefreshCw className="w-3 h-3 mr-1" />}
                          Retry
                        </Button>
                      )}
                    </div>
                    {r.summary_text && (
                      <div className="max-w-[360px] whitespace-pre-wrap rounded border bg-muted/40 p-2 text-xs leading-relaxed">
                        {r.summary_text}
                      </div>
                    )}
                    {!!r.proposed_tasks?.length && (
                      <div className="text-[11px] text-muted-foreground">{r.proposed_tasks.length} proposed tasks</div>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && (
              <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No huddles yet.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}