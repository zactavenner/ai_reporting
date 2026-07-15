import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

interface Row {
  id: string;
  date: string;
  actual_duration_s: number | null;
  planned_duration_s: number;
  avg_rating: number | null;
  attendance_pct: number;
  followthrough_pct: number;
  attendees: string[];
}

function fmt(s: number | null) {
  if (s == null) return '—';
  return `${Math.floor(s / 60)}m ${(s % 60).toString().padStart(2,'0')}s`;
}

export function HuddleHistory() {
  const [rows, setRows] = useState<Row[]>([]);

  useEffect(() => {
    const load = async () => {
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
        });
      }
      setRows(enriched);
    };
    load();
  }, []);

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
              <TableRow key={r.id}>
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
                <TableCell>{r.followthrough_pct}%</TableCell>
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