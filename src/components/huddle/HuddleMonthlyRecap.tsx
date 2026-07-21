import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Copy, Check, Trophy, Users, Star, ListChecks, TrendingUp, Clock } from 'lucide-react';
import { toast } from 'sonner';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

function monthBounds(ym: string): [string, string] {
  const [y, m] = ym.split('-').map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 1));
  const toISO = (d: Date) => d.toISOString().slice(0, 10);
  return [toISO(start), toISO(end)];
}

function currentYearMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

interface MemberStat { name: string; attended: number; wins: number }
interface ClientTimeStat { client_id: string; name: string; total_s: number; sessions: number; avg_s: number }

export function HuddleMonthlyRecap() {
  const [ym, setYm] = useState<string>(currentYearMonth());
  const [copied, setCopied] = useState(false);
  const [state, setState] = useState<{
    loading: boolean;
    huddles: any[];
    totalMembers: number;
    attendancePct: number;
    avgRating: number | null;
    followThroughPct: number;
    memberStats: MemberStat[];
    topWins: { name: string; text: string; date: string }[];
    improvements: { text: string; date: string }[];
    clientTime: ClientTimeStat[];
    totalClientSeconds: number;
  }>({ loading: true, huddles: [], totalMembers: 0, attendancePct: 0, avgRating: null, followThroughPct: 0, memberStats: [], topWins: [], improvements: [], clientTime: [], totalClientSeconds: 0 });

  useEffect(() => {
    const load = async () => {
      setState(s => ({ ...s, loading: true }));
      const [startISO, endISO] = monthBounds(ym);
      const { data: huddles } = await supabase
        .from('huddles')
        .select('*')
        .gte('date', startISO)
        .lt('date', endISO)
        .order('date', { ascending: true });
      const ids = (huddles || []).map((h: any) => h.id);
      const { data: members } = await supabase.from('agency_members').select('id,name').order('name');
      const totalMembers = (members || []).length || 1;

      if (ids.length === 0) {
        setState({ loading: false, huddles: [], totalMembers, attendancePct: 0, avgRating: null, followThroughPct: 0, memberStats: (members || []).map((m: any) => ({ name: m.name, attended: 0, wins: 0 })), topWins: [], improvements: [], clientTime: [], totalClientSeconds: 0 });
        return;
      }

      const [{ data: att }, { data: wins }, { data: tasks }, { data: blockers }, { data: reviews }] = await Promise.all([
        supabase.from('huddle_attendance').select('huddle_id,member_id,member_name').in('huddle_id', ids),
        supabase.from('huddle_wins').select('huddle_id,member_name,text,created_at').in('huddle_id', ids),
        supabase.from('tasks').select('huddle_id,status').in('huddle_id', ids),
        supabase.from('huddle_blockers').select('huddle_id,description,created_at').in('huddle_id', ids),
        supabase.from('huddle_client_reviews').select('huddle_id,client_id,duration_s,status,clients(name)').in('huddle_id', ids),
      ]);

      // Attendance aggregation
      const attByMember = new Map<string, number>();
      (att || []).forEach((a: any) => {
        const key = a.member_id || a.member_name;
        if (!key) return;
        attByMember.set(key, (attByMember.get(key) || 0) + 1);
      });
      const winsByMember = new Map<string, number>();
      (wins || []).forEach((w: any) => {
        if (!w.member_name) return;
        winsByMember.set(w.member_name, (winsByMember.get(w.member_name) || 0) + 1);
      });

      const memberStats: MemberStat[] = (members || []).map((m: any) => ({
        name: m.name,
        attended: attByMember.get(m.id) || 0,
        wins: winsByMember.get(m.name) || 0,
      })).sort((a, b) => b.attended - a.attended);

      const attendancePct = Math.round(((att?.length || 0) / (ids.length * totalMembers)) * 100);
      const ratings = (huddles || []).map((h: any) => h.avg_rating).filter((r: any) => r != null);
      const avgRating = ratings.length ? ratings.reduce((a: number, b: number) => a + b, 0) / ratings.length : null;
      const totalTasks = (tasks || []).length;
      const doneTasks = (tasks || []).filter((t: any) => t.status === 'completed' || t.status === 'done').length;
      const followThroughPct = totalTasks ? Math.round((doneTasks / totalTasks) * 100) : 0;

      const huddleDateMap = Object.fromEntries((huddles || []).map((h: any) => [h.id, h.date]));
      const topWins = (wins || []).map((w: any) => ({ name: w.member_name || 'Team', text: w.text, date: huddleDateMap[w.huddle_id] })).slice(0, 25);
      const improvements = (blockers || []).map((b: any) => ({ text: b.description, date: huddleDateMap[b.huddle_id] })).slice(0, 25);

      // Per-client time roll-up
      const timeMap = new Map<string, ClientTimeStat>();
      (reviews || []).forEach((r: any) => {
        const d = Number(r.duration_s) || 0;
        if (!r.client_id) return;
        const cur = timeMap.get(r.client_id) || { client_id: r.client_id, name: r?.clients?.name || 'Unknown', total_s: 0, sessions: 0, avg_s: 0 };
        cur.total_s += d;
        if (d > 0) cur.sessions += 1;
        timeMap.set(r.client_id, cur);
      });
      const clientTime = Array.from(timeMap.values())
        .map(c => ({ ...c, avg_s: c.sessions ? Math.round(c.total_s / c.sessions) : 0 }))
        .sort((a, b) => b.total_s - a.total_s);
      const totalClientSeconds = clientTime.reduce((sum, c) => sum + c.total_s, 0);

      setState({ loading: false, huddles: huddles || [], totalMembers, attendancePct, avgRating, followThroughPct, memberStats, topWins, improvements, clientTime, totalClientSeconds });
    };
    load();
  }, [ym]);

  const chartData = useMemo(() => state.memberStats.slice(0, 15).map(m => ({ name: m.name.split(' ')[0], attended: m.attended })), [state.memberStats]);

  const summary = useMemo(() => {
    const [startISO, endISO] = monthBounds(ym);
    const label = new Date(startISO + 'T00:00:00Z').toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
    const lines: string[] = [];
    lines.push(`Huddle Monthly Recap — ${label}`);
    lines.push('');
    lines.push(`Huddles held: ${state.huddles.length}`);
    lines.push(`Team attendance: ${state.attendancePct}%`);
    lines.push(`Avg huddle rating: ${state.avgRating ? state.avgRating.toFixed(1) : '—'}`);
    lines.push(`Follow-through on tasks: ${state.followThroughPct}%`);
    lines.push(`Total time on clients: ${fmtDuration(state.totalClientSeconds)}`);
    lines.push('');
    lines.push('Attendance leaderboard:');
    state.memberStats.forEach(m => lines.push(`  - ${m.name}: ${m.attended}/${state.huddles.length} (${state.huddles.length ? Math.round(m.attended / state.huddles.length * 100) : 0}%)  · ${m.wins} wins`));
    if (state.clientTime.length) {
      lines.push('');
      lines.push('Time per client:');
      state.clientTime.forEach(c => lines.push(`  - ${c.name}: ${fmtDuration(c.total_s)} across ${c.sessions} huddle${c.sessions === 1 ? '' : 's'} (avg ${fmtDuration(c.avg_s)})`));
    }
    if (state.topWins.length) {
      lines.push('');
      lines.push('Wins:');
      state.topWins.forEach(w => lines.push(`  - ${w.date} — ${w.name}: ${w.text}`));
    }
    if (state.improvements.length) {
      lines.push('');
      lines.push('Improvements / blockers surfaced:');
      state.improvements.forEach(b => lines.push(`  - ${b.date} — ${b.text}`));
    }
    return lines.join('\n');
  }, [ym, state]);

  const doCopy = async () => {
    try { await navigator.clipboard.writeText(summary); setCopied(true); setTimeout(() => setCopied(false), 2000); toast.success('Recap copied'); }
    catch { toast.error('Copy failed'); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <label className="text-sm text-muted-foreground">Month</label>
          <Input type="month" value={ym} onChange={(e) => setYm(e.target.value)} className="w-44" />
        </div>
        <Button size="sm" variant="outline" onClick={doCopy}>
          {copied ? <Check className="w-4 h-4 mr-1" /> : <Copy className="w-4 h-4 mr-1" />} Copy recap
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi icon={<Users className="w-4 h-4" />} label="Attendance" value={`${state.attendancePct}%`} />
        <Kpi icon={<ListChecks className="w-4 h-4" />} label="Huddles" value={state.huddles.length.toString()} />
        <Kpi icon={<Star className="w-4 h-4" />} label="Avg rating" value={state.avgRating ? state.avgRating.toFixed(1) : '—'} />
        <Kpi icon={<TrendingUp className="w-4 h-4" />} label="Follow-through" value={`${state.followThroughPct}%`} />
      </div>

      <Card className="p-4">
        <div className="text-sm font-semibold mb-2">Attendance by team member</div>
        <div className="h-52">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
              <XAxis dataKey="name" fontSize={11} />
              <YAxis fontSize={11} allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="attended" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Team member</TableHead>
              <TableHead>Attended</TableHead>
              <TableHead>Attendance %</TableHead>
              <TableHead>Wins shared</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {state.memberStats.map(m => (
              <TableRow key={m.name}>
                <TableCell className="font-medium">{m.name}</TableCell>
                <TableCell>{m.attended} / {state.huddles.length}</TableCell>
                <TableCell>{state.huddles.length ? Math.round(m.attended / state.huddles.length * 100) : 0}%</TableCell>
                <TableCell>{m.wins}</TableCell>
              </TableRow>
            ))}
            {state.memberStats.length === 0 && (
              <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">No data.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

      <div className="grid md:grid-cols-2 gap-4">
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-2">
            <Trophy className="w-4 h-4 text-primary" />
            <div className="text-sm font-semibold">Wins this month ({state.topWins.length})</div>
          </div>
          <div className="space-y-2 max-h-80 overflow-y-auto text-sm">
            {state.topWins.map((w, i) => (
              <div key={i} className="border-l-2 border-l-primary/60 pl-2">
                <div className="text-xs text-muted-foreground">{w.date} · {w.name}</div>
                <div>{w.text}</div>
              </div>
            ))}
            {state.topWins.length === 0 && <div className="text-xs text-muted-foreground">No wins logged.</div>}
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="w-4 h-4 text-amber-500" />
            <div className="text-sm font-semibold">Improvements / blockers ({state.improvements.length})</div>
          </div>
          <div className="space-y-2 max-h-80 overflow-y-auto text-sm">
            {state.improvements.map((b, i) => (
              <div key={i} className="border-l-2 border-l-amber-500/60 pl-2">
                <div className="text-xs text-muted-foreground">{b.date}</div>
                <div>{b.text}</div>
              </div>
            ))}
            {state.improvements.length === 0 && <div className="text-xs text-muted-foreground">No blockers logged.</div>}
          </div>
        </Card>
      </div>
    </div>
  );
}

function Kpi({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">{icon}<span>{label}</span></div>
      <div className="text-2xl font-semibold mt-1">{value}</div>
    </Card>
  );
}