import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { AlertCircle, Plus } from 'lucide-react';

interface Row {
  id: string;
  name: string;
  status: string;
  cpl_ratio?: number;
  reason?: string;
}

// Derive health from yesterday's CPL vs 7-day baseline (simple heuristic).
function deriveHealth(cpl: number, cplAvg: number, spend: number): 'green' | 'yellow' | 'red' {
  if (!spend) return 'green';
  if (!cplAvg) return 'green';
  const ratio = cpl / cplAvg;
  if (ratio >= 1.5) return 'red';
  if (ratio >= 1.2) return 'yellow';
  return 'green';
}

export function ClientHealthSegment({ huddleId }: { huddleId: string }) {
  const [yellow, setYellow] = useState<Row[]>([]);
  const [red, setRed] = useState<Row[]>([]);
  const [greenCount, setGreenCount] = useState(0);
  const [total, setTotal] = useState(0);
  const [reasons, setReasons] = useState<Record<string, string>>({});

  useEffect(() => {
    const load = async () => {
      const today = new Date();
      const y = new Date(today);
      y.setDate(y.getDate() - 1);
      const yISO = y.toISOString().slice(0, 10);
      const weekStart = new Date(y);
      weekStart.setDate(weekStart.getDate() - 6);
      const [{ data: clients }, { data: metrics }] = await Promise.all([
        supabase.from('clients').select('id,name').in('status', ['active', 'onboarding']),
        supabase.from('daily_metrics').select('client_id,date,ad_spend,leads').gte('date', weekStart.toISOString().slice(0,10)).lte('date', yISO),
      ]);
      const map: Record<string, any[]> = {};
      (metrics || []).forEach((m: any) => { (map[m.client_id] ||= []).push(m); });
      const rows: (Row & { health: string })[] = (clients || []).map((c: any) => {
        const list = map[c.id] || [];
        const yr = list.find(m => m.date === yISO);
        const week = list.filter(m => m.date !== yISO);
        const cpl = yr?.leads ? yr.ad_spend / yr.leads : 0;
        const cplVals = week.map(m => (m.leads ? m.ad_spend / m.leads : 0)).filter(v => v > 0);
        const cplAvg = cplVals.length ? cplVals.reduce((a, b) => a + b, 0) / cplVals.length : 0;
        const health = deriveHealth(cpl, cplAvg, yr?.ad_spend || 0);
        return { id: c.id, name: c.name, status: c.status, health };
      });
      setTotal(rows.length);
      setGreenCount(rows.filter(r => r.health === 'green').length);
      setYellow(rows.filter(r => r.health === 'yellow'));
      setRed(rows.filter(r => r.health === 'red'));
    };
    load();
  }, []);

  const createTask = async (row: Row) => {
    const reason = reasons[row.id] || '';
    await supabase.from('huddle_flags').insert({ huddle_id: huddleId, client_id: row.id, reason });
    await supabase.from('tasks').insert({
      client_id: row.id,
      title: `Address client health: ${row.name}${reason ? ` — ${reason}` : ''}`,
      status: 'pending',
      priority: 'high',
      stage: 'backlog',
      source: 'huddle',
      huddle_id: huddleId,
      due_date: new Date().toISOString().slice(0, 10),
    } as any);
    toast.success(`Task created for ${row.name}`);
  };

  const flagged = [...red, ...yellow];

  return (
    <div className="w-full max-w-5xl mx-auto space-y-3 max-h-[55vh] overflow-y-auto">
      <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-sm">
        {greenCount} of {total} Green — skipped
      </div>
      {flagged.length === 0 && <div className="text-center text-muted-foreground">All clients green today.</div>}
      {flagged.map((r) => {
        const isRed = red.some(x => x.id === r.id);
        return (
          <Card key={r.id} className={`p-4 border-l-4 ${isRed ? 'border-l-destructive' : 'border-l-amber-500'}`}>
            <div className="flex items-center gap-3 mb-2">
              <AlertCircle className={`w-5 h-5 ${isRed ? 'text-destructive' : 'text-amber-500'}`} />
              <div className="font-semibold flex-1">{r.name}</div>
              <span className={`text-xs px-2 py-0.5 rounded ${isRed ? 'bg-destructive/20 text-destructive' : 'bg-amber-500/20 text-amber-600'}`}>
                {isRed ? 'RED' : 'YELLOW'}
              </span>
            </div>
            <div className="flex gap-2">
              <Input
                value={reasons[r.id] || ''}
                onChange={(e) => setReasons(p => ({ ...p, [r.id]: e.target.value }))}
                placeholder="One-line reason…"
              />
              <Button size="sm" onClick={() => createTask(r)}><Plus className="w-4 h-4 mr-1" />Task</Button>
            </div>
          </Card>
        );
      })}
    </div>
  );
}