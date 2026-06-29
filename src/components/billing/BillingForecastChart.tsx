import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
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
import type { StripeCustomerData } from '@/hooks/useStripePayments';
import { TrendingUp } from 'lucide-react';

type Granularity = 'daily' | 'weekly' | 'monthly' | 'yearly';

interface Props {
  stripeDataMap: Record<string, StripeCustomerData>;
  totalMRR: number;
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

export function BillingForecastChart({ stripeDataMap, totalMRR }: Props) {
  const [granularity, setGranularity] = useState<Granularity>('monthly');

  const { chartData, summary } = useMemo(() => {
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
    for (const data of Object.values(stripeDataMap)) {
      if (!data?.payments) continue;
      for (const p of data.payments) {
        if (p.status !== 'succeeded' || p.refunded) continue;
        const d = cfg.bucketStart(new Date(p.created));
        const key = d.toISOString();
        totals.set(key, (totals.get(key) || 0) + (p.amount || 0));
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
    };
  }, [stripeDataMap, totalMRR, granularity]);

  return (
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
              />
              <Line
                type="monotone"
                dataKey="forecast"
                name="Forecast"
                stroke="hsl(var(--chart-3))"
                strokeWidth={2}
                strokeDasharray="5 5"
                dot={{ r: 3 }}
                connectNulls
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
          <Stat label="Active MRR" value={fmtMoney(totalMRR)} />
          <Stat label={`Per ${CONFIG[granularity].label}`} value={fmtMoney(summary.projectedPerBucket)} />
          <Stat label="Actual (window)" value={fmtMoney(summary.actual)} />
          <Stat label="Forecast (window)" value={fmtMoney(summary.forecast)} accent />
        </div>
      </CardContent>
    </Card>
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
