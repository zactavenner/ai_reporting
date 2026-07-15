import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CalendarClock, Star } from 'lucide-react';
import { WeeklyCallRunner } from './WeeklyCallRunner';
import { format } from 'date-fns';

interface Row {
  id: string;
  week_of: string;
  status: string;
  started_at: string | null;
  ended_at: string | null;
  actual_duration_s: number | null;
  avg_rating: number | null;
  summary_text: string | null;
}

export function WeeklyCallTab({ clientId }: { clientId: string }) {
  const [history, setHistory] = useState<Row[]>([]);

  useEffect(() => {
    let active = true;
    (async () => {
      const { data } = await (supabase as any)
        .from('client_weekly_calls')
        .select('id, week_of, status, started_at, ended_at, actual_duration_s, avg_rating, summary_text')
        .eq('client_id', clientId)
        .order('week_of', { ascending: false })
        .limit(20);
      if (active) setHistory((data as any) || []);
    })();
    return () => { active = false; };
  }, [clientId]);

  return (
    <div className="space-y-6">
      <Card className="p-4 md:p-6">
        <div className="flex items-center gap-2 mb-4">
          <CalendarClock className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">This week's call</h2>
        </div>
        <WeeklyCallRunner clientId={clientId} />
      </Card>

      <div>
        <div className="text-sm font-semibold mb-2">Past calls</div>
        {history.length === 0 ? (
          <div className="text-sm text-muted-foreground italic">No past weekly calls yet.</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {history.map((r) => (
              <Card key={r.id} className="p-3 text-sm space-y-1">
                <div className="flex items-center justify-between">
                  <div className="font-semibold">Week of {format(new Date(r.week_of), 'MMM d, yyyy')}</div>
                  <Badge variant="outline" className="text-[10px]">{r.status}</Badge>
                </div>
                <div className="text-xs text-muted-foreground flex gap-3">
                  {r.actual_duration_s != null && <span>{Math.round((r.actual_duration_s || 0) / 60)} min</span>}
                  {r.avg_rating != null && (
                    <span className="flex items-center gap-1"><Star className="w-3 h-3 text-primary" />{r.avg_rating.toFixed(1)}</span>
                  )}
                </div>
                {r.summary_text && <div className="text-xs line-clamp-3">{r.summary_text}</div>}
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}