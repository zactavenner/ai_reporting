import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { format } from 'date-fns';
import { FileText } from 'lucide-react';

interface DailyReport {
  id: string;
  report_date: string;
  report_type: string;
  wins_shared: string | null;
  touchpoint_count: number | null;
  self_assessment: number | null;
  created_at: string;
}

export function ReportHistory({ memberId }: { memberId: string }) {
  const { data: reports = [], isLoading } = useQuery({
    queryKey: ['daily-reports-history', memberId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('daily_reports')
        .select('id, report_date, report_type, wins_shared, touchpoint_count, self_assessment, created_at')
        .eq('member_id', memberId)
        .order('report_date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return data as DailyReport[];
    },
    enabled: !!memberId,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <FileText className="h-4 w-4" />
          Report History
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground text-center py-6">Loading…</p>
        ) : reports.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">No reports found.</p>
        ) : (
          <ul className="divide-y divide-border">
            {reports.map((r) => (
              <li key={r.id} className="flex items-center justify-between py-2.5 gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <Badge variant="outline" className="text-[10px] shrink-0 uppercase">
                    {r.report_type === 'sod' ? 'SOD' : 'EOD'}
                  </Badge>
                  <span className="text-sm font-medium">
                    {format(new Date(r.report_date), 'MMM d, yyyy')}
                  </span>
                  {r.wins_shared && (
                    <span className="text-xs text-muted-foreground truncate hidden sm:block">
                      — {r.wins_shared.slice(0, 60)}{r.wins_shared.length > 60 ? '…' : ''}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0 text-xs text-muted-foreground">
                  {r.touchpoint_count != null && (
                    <span>{r.touchpoint_count} touchpoints</span>
                  )}
                  {r.self_assessment != null && (
                    <span className="font-medium">
                      {r.self_assessment}/10
                    </span>
                  )}
                  <span className="hidden md:block">
                    {format(new Date(r.created_at), 'h:mm a')}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
