import { useMemo } from 'react';
import { format, formatDistanceToNow } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, CheckCircle2, PlusCircle, DollarSign, Users, Phone, TrendingUp, Wand2, Image as ImageIcon } from 'lucide-react';
import { useWeeklyRecap } from '@/hooks/useWeeklyRecap';

interface Props {
  clientId: string;
  sinceDate?: string | null;
  compact?: boolean;
  onAutoFill?: () => void;
  windowLabel?: string;
}

const fmtMoney = (n: number | null | undefined) =>
  n == null ? '—' : n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const fmtNum = (n: number | null | undefined) => (n == null ? '—' : Math.round(n).toLocaleString('en-US'));

export function WeeklyRecapCard({ clientId, sinceDate, compact, onAutoFill, windowLabel }: Props) {
  const { data: recap, isLoading } = useWeeklyRecap(clientId, sinceDate);

  const label = useMemo(() => {
    if (windowLabel) return windowLabel;
    if (sinceDate) return `Since last sync (${formatDistanceToNow(new Date(sinceDate))} ago)`;
    return 'Last 7 days';
  }, [windowLabel, sinceDate]);

  if (isLoading || !recap) {
    return (
      <Card>
        <CardContent className="py-6 flex items-center justify-center text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Loading recap…
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-primary/30">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-primary" /> Auto Recap
              <Badge variant="secondary" className="text-[10px]">{label}</Badge>
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              {format(new Date(recap.windowStart), 'MMM d')} → {format(new Date(recap.windowEnd), 'MMM d')}
            </p>
          </div>
          {onAutoFill && (
            <Button size="sm" variant="outline" onClick={onAutoFill}>
              <Wand2 className="h-4 w-4 mr-2" /> Auto-fill agenda
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* KPI strip */}
        <div className={`grid gap-2 ${compact ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-2 sm:grid-cols-4 lg:grid-cols-6'}`}>
          <Mini icon={PlusCircle} label="Tasks created" value={fmtNum(recap.tasks.created)} />
          <Mini icon={CheckCircle2} label="Tasks done" value={fmtNum(recap.tasks.completed)} />
          <Mini icon={Users} label="Leads" value={fmtNum(recap.numbers.leads)} />
          <Mini icon={Phone} label="Booked / Showed" value={`${recap.numbers.bookedCalls} / ${recap.numbers.shows}`} />
          <Mini icon={DollarSign} label="Committed" value={fmtMoney(recap.numbers.committed)} />
          <Mini icon={DollarSign} label="Spend / CPL" value={`${fmtMoney(recap.creatives.spend)} · ${fmtMoney(recap.creatives.blendedCpl)}`} />
        </div>

        {!compact && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Tasks completed */}
            <Section title={`Tasks completed (${recap.tasks?.completed ?? 0})`}>
              {(recap.tasks?.completedList ?? []).length === 0 ? (
                <Empty>No tasks completed.</Empty>
              ) : (
                <ul className="space-y-1 text-sm">
                  {(recap.tasks?.completedList ?? []).map((t) => (
                    <li key={t.id} className="flex items-center gap-2">
                      <CheckCircle2 className="h-3.5 w-3.5 text-primary flex-shrink-0" />
                      <span className="truncate">{t.title}</span>
                      <Badge variant="outline" className="text-[10px] ml-auto">{t.stage}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            {/* Tasks created */}
            <Section title={`Tasks created (${recap.tasks?.created ?? 0})`}>
              {(recap.tasks?.createdList ?? []).length === 0 ? (
                <Empty>No new tasks.</Empty>
              ) : (
                <ul className="space-y-1 text-sm">
                  {(recap.tasks?.createdList ?? []).map((t) => (
                    <li key={t.id} className="flex items-center gap-2">
                      <PlusCircle className="h-3.5 w-3.5 text-primary flex-shrink-0" />
                      <span className="truncate">{t.title}</span>
                      <Badge variant="outline" className="text-[10px] ml-auto">{t.stage}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            {/* Top creatives */}
            <Section title="Top creatives">
              {recap.creatives.top.length === 0 ? (
                <Empty>No active creatives.</Empty>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {recap.creatives.top.map((c) => (
                    <div key={c.id} className="border rounded overflow-hidden">
                      <div className="aspect-square bg-muted">
                        {c.thumb ? (
                          <img src={c.thumb} alt={c.name} className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                            <ImageIcon className="h-5 w-5" />
                          </div>
                        )}
                      </div>
                      <div className="p-1.5 text-[10px] space-y-0.5">
                        <p className="truncate font-medium" title={c.name}>{c.name}</p>
                        <div className="flex justify-between text-muted-foreground">
                          <span>{fmtMoney(c.spend)}</span>
                          <span className="text-primary font-semibold">{fmtMoney(c.cpl)}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Section>

            {/* Pipeline */}
            <Section title="Pipeline">
              <div className="text-sm space-y-2">
                <div className="flex gap-4">
                  <span><strong>{recap.pipeline.movedCount}</strong> moved</span>
                  <span><strong>{recap.pipeline.stalledCount}</strong> stalled</span>
                </div>
                {recap.pipeline.closestList.length > 0 ? (
                  <ul className="space-y-1">
                    {recap.pipeline.closestList.map((d) => (
                      <li key={d.id} className="flex items-center gap-2">
                        <span className="truncate">{d.name}</span>
                        <span className="text-muted-foreground ml-auto whitespace-nowrap">
                          {fmtMoney(d.amount)} · <Badge variant="outline" className="text-[10px]">{d.stage}</Badge>
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <Empty>No active pipeline deals.</Empty>
                )}
              </div>
            </Section>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Mini({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <div className="rounded border bg-card p-2">
      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground uppercase tracking-wide">
        <Icon className="h-3 w-3" /> {label}
      </div>
      <div className="text-sm font-semibold mt-0.5 truncate">{value}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border rounded p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">{title}</p>
      {children}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-muted-foreground italic">{children}</p>;
}