import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { ExternalLink } from 'lucide-react';
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
} from 'recharts';
import {
  format,
  startOfDay,
  startOfWeek,
  startOfMonth,
  startOfYear,
  addDays,
  addWeeks,
  addMonths,
  addYears,
  subDays,
  subWeeks,
  subMonths,
  subYears,
  isAfter,
} from 'date-fns';
import type { StripeCustomerData, StripePayment } from '@/hooks/useStripePayments';
import { TrendingUp } from 'lucide-react';

type Granularity = 'daily' | 'weekly' | 'monthly' | 'yearly';

interface Props {
  stripeDataMap: Record<string, StripeCustomerData>;
  totalMRR: number;
  clientNameMap?: Record<string, string>;
}

const fmtMoney = (v: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(v);

const CONFIG: Record<
  Granularity,
  {
    label: string;
    historyCount: number;
    forecastCount: number;
    bucketStart: (d: Date) => Date;
    addBucket: (d: Date, n: number) => Date;
    subBucket: (d: Date, n: number) => Date;
    labelFmt: (d: Date) => string;
    bucketsPerMonth: number;
  }
> = {
  daily: {
    label: 'Daily',
    historyCount: 30,
    forecastCount: 14,
    bucketStart: startOfDay,
    addBucket: addDays,
    subBucket: subDays,
    labelFmt: (d) => format(d, 'MMM d'),
    bucketsPerMonth: 30,
  },
  weekly: {
    label: 'Weekly',
    historyCount: 16,
    forecastCount: 8,
    bucketStart: (d) => startOfWeek(d, { weekStartsOn: 1 }),
    addBucket: addWeeks,
    subBucket: subWeeks,
    labelFmt: (d) => format(d, 'MMM d'),
    bucketsPerMonth: 4.345,
  },
  monthly: {
    label: 'Monthly',
    historyCount: 12,
    forecastCount: 6,
    bucketStart: startOfMonth,
    addBucket: addMonths,
    subBucket: subMonths,
    labelFmt: (d) => format(d, 'MMM yy'),
    bucketsPerMonth: 1,
  },
  yearly: {
    label: 'Yearly',
    historyCount: 4,
    forecastCount: 2,
    bucketStart: startOfYear,
    addBucket: addYears,
    subBucket: subYears,
    labelFmt: (d) => format(d, 'yyyy'),
    bucketsPerMonth: 1 / 12,
  },
};

type DrilldownRow = StripePayment & { clientId: string; clientName: string };

export function BillingForecastChart({ stripeDataMap, totalMRR, clientNameMap = {} }: Props) {
  const [granularity, setGranularity] = useState<Granularity>('monthly');
  const [drilldown, setDrilldown] = useState<{
    label: string;
    isForecast: boolean;
    rows: DrilldownRow[];
  } | null>(null);

  const { chartData, summary, paymentsByBucket } = useMemo(() => {
    const cfg = CONFIG[granularity];
    const now = new Date();
    const currentBucket = cfg.bucketStart(now);

    // Build bucket keys for history (oldest -> current)
    const buckets: { date: Date; key: string }[] = [];
    for (let i = cfg.historyCount - 1; i >= 0; i--) {
      const d = cfg.subBucket(currentBucket, i);
      buckets.push({ date: d, key: d.toISOString() });
    }

    // Aggregate succeeded, non-refunded payments
    const totals = new Map<string, number>();
    const byBucket = new Map<string, DrilldownRow[]>();
    for (const data of Object.values(stripeDataMap)) {
      if (!data?.payments) continue;
      // Find clientId for this dataset
      const clientId =
        Object.keys(stripeDataMap).find((id) => stripeDataMap[id] === data) || '';
      const clientName = clientNameMap[clientId] || data.customer?.name || data.customer?.email || 'Unknown';
      for (const p of data.payments) {
        if (p.status !== 'succeeded' || p.refunded) continue;
        const d = cfg.bucketStart(new Date(p.created));
        const key = d.toISOString();
        totals.set(key, (totals.get(key) || 0) + (p.amount || 0));
        const arr = byBucket.get(key) || [];
        arr.push({ ...p, clientId, clientName });
        byBucket.set(key, arr);
      }
    }

    const history = buckets.map((b) => ({
      bucket: b.date,
      label: cfg.labelFmt(b.date),
      actual: Math.round(totals.get(b.key) || 0),
      forecast: null as number | null,
      isForecast: false,
    }));

    // Forecast: prefer MRR-based projection, fall back to last 3 buckets average
    const last3 = history.slice(-3).map((h) => h.actual).filter((v) => v > 0);
    const recentAvg =
      last3.length > 0 ? last3.reduce((s, v) => s + v, 0) / last3.length : 0;
    const mrrProjection = totalMRR * cfg.bucketsPerMonth;
    const projectedPerBucket = Math.max(mrrProjection, recentAvg);

    const forecast: typeof history = [];
    for (let i = 1; i <= cfg.forecastCount; i++) {
      const d = cfg.addBucket(currentBucket, i);
      forecast.push({
        bucket: d,
        label: cfg.labelFmt(d),
        actual: 0,
        forecast: Math.round(projectedPerBucket),
        isForecast: true,
      });
    }

    // Attach forecast line to last actual bucket so the dashed line connects
    if (history.length > 0) {
      history[history.length - 1] = {
        ...history[history.length - 1],
        forecast: history[history.length - 1].actual,
      };
    }

    const chartData = [...history, ...forecast];
    const totalActual = history.reduce((s, h) => s + h.actual, 0);
    const totalForecast = forecast.reduce((s, h) => s + (h.forecast || 0), 0);

    return {
      chartData,
      summary: {
        actual: totalActual,
        forecast: totalForecast,
        projectedPerBucket,
      },
      paymentsByBucket: byBucket,
    };
  }, [stripeDataMap, totalMRR, granularity, clientNameMap]);

  const handleBucketClick = (payload: any) => {
    if (!payload) return;
    const bucketDate: Date | undefined = payload.bucket;
    if (!bucketDate) return;
    const key = bucketDate.toISOString();
    const rows = (paymentsByBucket.get(key) || []).sort((a, b) =>
      new Date(b.created).getTime() - new Date(a.created).getTime(),
    );
    setDrilldown({
      label: payload.label,
      isForecast: Boolean(payload.isForecast),
      rows,
    });
  };

  return (
    <>
    <Card className="border-2">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-primary" />
              Revenue & Forecast
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Actuals from Stripe charges + forward projection from active MRR.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden md:flex items-center gap-2 text-xs text-muted-foreground">
              <Badge variant="secondary">Actual {fmtMoney(summary.actual)}</Badge>
              <Badge variant="outline">Projected {fmtMoney(summary.forecast)}</Badge>
            </div>
            <Tabs value={granularity} onValueChange={(v) => setGranularity(v as Granularity)}>
              <TabsList>
                <TabsTrigger value="daily">Daily</TabsTrigger>
                <TabsTrigger value="weekly">Weekly</TabsTrigger>
                <TabsTrigger value="monthly">Monthly</TabsTrigger>
                <TabsTrigger value="yearly">Yearly</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="h-[320px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="billingActualFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.85} />
                  <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.35} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis
                tick={{ fontSize: 11 }}
                tickFormatter={(v) => (v >= 1000 ? `$${Math.round(v / 1000)}k` : `$${v}`)}
              />
              <Tooltip
                contentStyle={{
                  background: 'hsl(var(--card))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: 8,
                  fontSize: 12,
                }}
                formatter={(value: any, name: string) => [
                  fmtMoney(Number(value) || 0),
                  name === 'actual' ? 'Actual' : 'Forecast',
                ]}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar
                dataKey="actual"
                name="Actual"
                fill="url(#billingActualFill)"
                radius={[4, 4, 0, 0]}
                maxBarSize={48}
                cursor="pointer"
                onClick={(d: any) => handleBucketClick(d?.payload)}
              />
              <Line
                type="monotone"
                dataKey="forecast"
                name="Forecast"
                stroke="hsl(var(--chart-3))"
                strokeWidth={2}
                strokeDasharray="5 5"
                dot={{ r: 3, cursor: 'pointer' }}
                activeDot={{ r: 5, cursor: 'pointer', onClick: (_: any, d: any) => handleBucketClick(d?.payload) }}
                connectNulls
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground text-center">
          Tip: click any bar or forecast point to see the underlying Stripe charges.
        </p>
        <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
          <Stat label="Active MRR" value={fmtMoney(totalMRR)} />
          <Stat label={`Per ${CONFIG[granularity].label}`} value={fmtMoney(summary.projectedPerBucket)} />
          <Stat label="Actual (window)" value={fmtMoney(summary.actual)} />
          <Stat label="Forecast (window)" value={fmtMoney(summary.forecast)} accent />
        </div>
      </CardContent>
    </Card>

    <Dialog open={!!drilldown} onOpenChange={(o) => !o && setDrilldown(null)}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>
            {drilldown?.isForecast ? 'Forecast' : 'Stripe charges'} · {drilldown?.label}
          </DialogTitle>
          <DialogDescription>
            {drilldown?.isForecast
              ? 'This bucket is a forward projection based on active MRR — no charges have settled yet.'
              : `${drilldown?.rows.length ?? 0} succeeded charges · ${fmtMoney(
                  (drilldown?.rows ?? []).reduce((s, r) => s + (r.amount || 0), 0) / 100,
                )} total`}
          </DialogDescription>
        </DialogHeader>
        <div className="overflow-auto">
          {drilldown && !drilldown.isForecast && drilldown.rows.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {drilldown.rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {format(new Date(r.created), 'MMM d, yyyy · h:mm a')}
                    </TableCell>
                    <TableCell className="text-sm font-medium">{r.clientName}</TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-[280px] truncate">
                      {r.description || r.id}
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-semibold">
                      {fmtMoney((r.amount || 0) / 100)}
                    </TableCell>
                    <TableCell>
                      {r.receipt_url ? (
                        <Button asChild variant="ghost" size="icon" className="h-7 w-7">
                          <a href={r.receipt_url} target="_blank" rel="noopener noreferrer" aria-label="Open receipt">
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : !drilldown?.isForecast ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              No Stripe charges landed in this bucket.
            </p>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
    </>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-md border bg-muted/30 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`text-sm font-bold tabular-nums ${accent ? 'text-primary' : ''}`}>{value}</div>
    </div>
  );
}
