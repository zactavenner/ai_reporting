import { useMemo, useState } from 'react';
import { format, startOfWeek, endOfWeek, endOfMonth, eachWeekOfInterval, eachDayOfInterval, isWithinInterval, parseISO } from 'date-fns';
import { DailyMetric } from '@/hooks/useMetrics';
import { useYearlyMetrics, useUpsertMonthlyMetric, useUpdateDailyMetric } from '@/hooks/useYearlyMetrics';
import { useClientSettings, getThresholdsFromSettings, KPIThresholds } from '@/hooks/useClientSettings';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Pencil, Plus, Check, X, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

interface PeriodicStatsTableProps {
  clientId?: string;
  dailyMetrics?: DailyMetric[];
}

type PeriodType = 'daily' | 'weekly' | 'monthly';

interface PeriodStats {
  period: string;
  periodLabel: string;
  year: number;
  month: number;
  adSpend: number;
  leads: number;
  crmLeads: number;
  cpl: number;
  calls: number;
  costPerCall: number;
  showedCalls: number;
  showRate: number;
  costPerShow: number;
  reconnectCalls: number;
  costPerReconnect: number;
  reconnectShowed: number;
  costPerReconnectShowed: number;
  commitments: number;
  commitmentDollars: number;
  fundedInvestors: number;
  fundedDollars: number;
  costPerInvestor: number;
  costOfCapital: number;
  hasData: boolean;
}

interface EditingState {
  period: string;
  field: string;
  value: string;
}

interface MetricRowConfig {
  label: string;
  key: keyof PeriodStats;
  format: (value: number) => string;
  editable: boolean;
  dbField?: string;
  highlight?: boolean;
}

const CURRENT_YEAR = new Date().getFullYear();
const AVAILABLE_YEARS = [CURRENT_YEAR, CURRENT_YEAR - 1];

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

// Metric row definitions for transposed table
const METRIC_ROWS: MetricRowConfig[] = [
  { label: 'Ad Spend', key: 'adSpend', format: (v) => `$${Math.round(v).toLocaleString()}`, editable: true, dbField: 'ad_spend' },
  { label: 'Leads', key: 'leads', format: (v) => v.toLocaleString(), editable: true, dbField: 'leads' },
  { label: 'CRM Leads', key: 'crmLeads', format: (v) => v.toLocaleString(), editable: false },
  { label: 'CPL', key: 'cpl', format: (v) => `$${Math.round(v).toLocaleString()}`, editable: false },
  { label: 'Calls', key: 'calls', format: (v) => v.toLocaleString(), editable: true, dbField: 'calls' },
  { label: '$/Call', key: 'costPerCall', format: (v) => `$${Math.round(v).toLocaleString()}`, editable: false },
  { label: 'Showed', key: 'showedCalls', format: (v) => v.toLocaleString(), editable: true, dbField: 'showed_calls' },
  { label: 'Show %', key: 'showRate', format: (v) => `${Math.round(v)}%`, editable: false },
  { label: '$/Show', key: 'costPerShow', format: (v) => `$${Math.round(v).toLocaleString()}`, editable: false },
  { label: 'Commitments', key: 'commitments', format: (v) => v.toLocaleString(), editable: true, dbField: 'commitments' },
  { label: 'Commit $', key: 'commitmentDollars', format: (v) => `$${Math.round(v).toLocaleString()}`, editable: true, dbField: 'commitment_dollars' },
  { label: 'Funded #', key: 'fundedInvestors', format: (v) => v.toLocaleString(), editable: true, dbField: 'funded_investors' },
  { label: 'Funded $', key: 'fundedDollars', format: (v) => `$${Math.round(v).toLocaleString()}`, editable: true, dbField: 'funded_dollars', highlight: true },
  { label: 'CPA', key: 'costPerInvestor', format: (v) => `$${Math.round(v).toLocaleString()}`, editable: false },
  { label: 'Cost of Capital %', key: 'costOfCapital', format: (v) => `${v.toFixed(2)}%`, editable: false, highlight: true },
];

export function PeriodicStatsTable({ clientId, dailyMetrics: externalMetrics }: PeriodicStatsTableProps) {
  const [periodType, setPeriodType] = useState<PeriodType>('monthly');
  const [selectedYear, setSelectedYear] = useState<number>(CURRENT_YEAR);
  const [editing, setEditing] = useState<EditingState | null>(null);
  const [addingMonth, setAddingMonth] = useState<number | null>(null);
  const [newMonthData, setNewMonthData] = useState<Record<string, string>>({});

  const { data: yearlyMetrics = [], isLoading } = useYearlyMetrics(clientId, selectedYear);
  const { data: clientSettings } = useClientSettings(clientId);
  const upsertMonthlyMetric = useUpsertMonthlyMetric();
  const updateDailyMetric = useUpdateDailyMetric();
  
  const thresholds = useMemo(() => getThresholdsFromSettings(clientSettings), [clientSettings]);
  
  // Custom metric labels from settings
  const metricLabels: Record<string, string> = useMemo(() => {
    return (clientSettings as any)?.metric_labels || {};
  }, [clientSettings]);

  const metricsToUse = clientId ? yearlyMetrics : (externalMetrics || []);

  const periodicStats = useMemo(() => {
    const allMonths: PeriodStats[] = [];

    if (periodType === 'monthly') {
      for (let month = 1; month <= 12; month++) {
        const monthStart = new Date(selectedYear, month - 1, 1);
        const monthEnd = endOfMonth(monthStart);

        const monthMetrics = metricsToUse.filter(m => {
          const date = parseISO(m.date);
          return isWithinInterval(date, { start: monthStart, end: monthEnd });
        });

        const totals = monthMetrics.reduce((acc, day: any) => ({
          adSpend: acc.adSpend + Number(day.ad_spend || 0),
          leads: acc.leads + (day.leads || 0),
          crmLeads: acc.crmLeads + (day.crm_leads || day.leads || 0) + (day.spam_leads || 0),
          calls: acc.calls + (day.calls || 0),
          showedCalls: acc.showedCalls + (day.showed_calls || 0),
          reconnectCalls: acc.reconnectCalls + (day.reconnect_calls || 0),
          reconnectShowed: acc.reconnectShowed + (day.reconnect_showed || 0),
          commitments: acc.commitments + (day.commitments || 0),
          commitmentDollars: acc.commitmentDollars + Number(day.commitment_dollars || 0),
          fundedInvestors: acc.fundedInvestors + (day.funded_investors || 0),
          fundedDollars: acc.fundedDollars + Number(day.funded_dollars || 0),
        }), {
          adSpend: 0, leads: 0, crmLeads: 0, calls: 0, showedCalls: 0, reconnectCalls: 0,
          reconnectShowed: 0, commitments: 0, commitmentDollars: 0, fundedInvestors: 0, fundedDollars: 0,
        });

        const hasData = monthMetrics.length > 0;

        allMonths.push({
          period: format(monthStart, 'yyyy-MM-dd'),
          periodLabel: format(monthStart, 'MMM yyyy'),
          year: selectedYear,
          month,
          hasData,
          adSpend: totals.adSpend,
          leads: totals.leads,
          crmLeads: totals.crmLeads,
          cpl: totals.leads > 0 ? totals.adSpend / totals.leads : 0,
          calls: totals.calls,
          costPerCall: totals.calls > 0 ? totals.adSpend / totals.calls : 0,
          showedCalls: totals.showedCalls,
          showRate: totals.calls > 0 ? (totals.showedCalls / totals.calls) * 100 : 0,
          costPerShow: totals.showedCalls > 0 ? totals.adSpend / totals.showedCalls : 0,
          reconnectCalls: totals.reconnectCalls,
          costPerReconnect: totals.reconnectCalls > 0 ? totals.adSpend / totals.reconnectCalls : 0,
          reconnectShowed: totals.reconnectShowed,
          costPerReconnectShowed: totals.reconnectShowed > 0 ? totals.adSpend / totals.reconnectShowed : 0,
          commitments: totals.commitments,
          commitmentDollars: totals.commitmentDollars,
          fundedInvestors: totals.fundedInvestors,
          fundedDollars: totals.fundedDollars,
          costPerInvestor: totals.fundedInvestors > 0 ? totals.adSpend / totals.fundedInvestors : 0,
          costOfCapital: totals.fundedDollars > 0 ? (totals.adSpend / totals.fundedDollars) * 100 : 0,
        });
      }

      // Return in chronological order (January first)
      return allMonths;
    }

    if (metricsToUse.length === 0) return [];

    const metricsWithDates = metricsToUse.map(m => ({
      ...m,
      parsedDate: parseISO(m.date)
    }));

    const yearStart = new Date(selectedYear, 0, 1);
    const yearEnd = new Date(selectedYear, 11, 31);

    let periods: { start: Date; end: Date; label: string }[] = [];

    if (periodType === 'daily') {
      const days = eachDayOfInterval({ start: yearStart, end: yearEnd });
      periods = days.map(day => ({
        start: day,
        end: day,
        label: format(day, 'MMM d')
      }));
    } else if (periodType === 'weekly') {
      const weeks = eachWeekOfInterval({ start: yearStart, end: yearEnd }, { weekStartsOn: 1 });
      periods = weeks.map(weekStart => ({
        start: startOfWeek(weekStart, { weekStartsOn: 1 }),
        end: endOfWeek(weekStart, { weekStartsOn: 1 }),
        label: `${format(startOfWeek(weekStart, { weekStartsOn: 1 }), 'M/d')}-${format(endOfWeek(weekStart, { weekStartsOn: 1 }), 'M/d')}`
      }));
    }

    const stats: PeriodStats[] = periods.map(period => {
      const periodMetrics = metricsWithDates.filter(m =>
        isWithinInterval(m.parsedDate, { start: period.start, end: period.end })
      );

      const totals = periodMetrics.reduce((acc, day: any) => ({
        adSpend: acc.adSpend + Number(day.ad_spend || 0),
        leads: acc.leads + (day.leads || 0),
        crmLeads: acc.crmLeads + (day.crm_leads || day.leads || 0) + (day.spam_leads || 0),
        calls: acc.calls + (day.calls || 0),
        showedCalls: acc.showedCalls + (day.showed_calls || 0),
        reconnectCalls: acc.reconnectCalls + (day.reconnect_calls || 0),
        reconnectShowed: acc.reconnectShowed + (day.reconnect_showed || 0),
        commitments: acc.commitments + (day.commitments || 0),
        commitmentDollars: acc.commitmentDollars + Number(day.commitment_dollars || 0),
        fundedInvestors: acc.fundedInvestors + (day.funded_investors || 0),
        fundedDollars: acc.fundedDollars + Number(day.funded_dollars || 0),
      }), {
        adSpend: 0, leads: 0, crmLeads: 0, calls: 0, showedCalls: 0, reconnectCalls: 0,
        reconnectShowed: 0, commitments: 0, commitmentDollars: 0, fundedInvestors: 0, fundedDollars: 0,
      });

      return {
        period: format(period.start, 'yyyy-MM-dd'),
        periodLabel: period.label,
        year: selectedYear,
        month: period.start.getMonth() + 1,
        hasData: periodMetrics.length > 0,
        adSpend: totals.adSpend,
        leads: totals.leads,
        crmLeads: totals.crmLeads,
        cpl: totals.leads > 0 ? totals.adSpend / totals.leads : 0,
        calls: totals.calls,
        costPerCall: totals.calls > 0 ? totals.adSpend / totals.calls : 0,
        showedCalls: totals.showedCalls,
        showRate: totals.calls > 0 ? (totals.showedCalls / totals.calls) * 100 : 0,
        costPerShow: totals.showedCalls > 0 ? totals.adSpend / totals.showedCalls : 0,
        reconnectCalls: totals.reconnectCalls,
        costPerReconnect: totals.reconnectCalls > 0 ? totals.adSpend / totals.reconnectCalls : 0,
        reconnectShowed: totals.reconnectShowed,
        costPerReconnectShowed: totals.reconnectShowed > 0 ? totals.adSpend / totals.reconnectShowed : 0,
        commitments: totals.commitments,
        commitmentDollars: totals.commitmentDollars,
        fundedInvestors: totals.fundedInvestors,
        fundedDollars: totals.fundedDollars,
        costPerInvestor: totals.fundedInvestors > 0 ? totals.adSpend / totals.fundedInvestors : 0,
        costOfCapital: totals.fundedDollars > 0 ? (totals.adSpend / totals.fundedDollars) * 100 : 0,
      };
    }).filter(p => p.hasData);

    return stats.sort((a, b) => a.period.localeCompare(b.period));
  }, [metricsToUse, periodType, selectedYear]);

  const displayStats = periodType === 'monthly'
    ? periodicStats.filter(p => p.hasData)
    : periodicStats;

  const emptyMonths = periodType === 'monthly'
    ? periodicStats.filter(p => !p.hasData && (selectedYear < CURRENT_YEAR || p.month <= new Date().getMonth() + 1))
    : [];

  // Calculate totals
  const totals = useMemo(() => {
    const t = displayStats.reduce((acc, p) => ({
      adSpend: acc.adSpend + p.adSpend,
      leads: acc.leads + p.leads,
      crmLeads: acc.crmLeads + p.crmLeads,
      calls: acc.calls + p.calls,
      showedCalls: acc.showedCalls + p.showedCalls,
      reconnectCalls: acc.reconnectCalls + p.reconnectCalls,
      reconnectShowed: acc.reconnectShowed + p.reconnectShowed,
      commitments: acc.commitments + p.commitments,
      commitmentDollars: acc.commitmentDollars + p.commitmentDollars,
      fundedInvestors: acc.fundedInvestors + p.fundedInvestors,
      fundedDollars: acc.fundedDollars + p.fundedDollars,
    }), {
      adSpend: 0, leads: 0, crmLeads: 0, calls: 0, showedCalls: 0, reconnectCalls: 0,
      reconnectShowed: 0, commitments: 0, commitmentDollars: 0, fundedInvestors: 0, fundedDollars: 0,
    });

    return {
      ...t,
      cpl: t.leads > 0 ? t.adSpend / t.leads : 0,
      costPerCall: t.calls > 0 ? t.adSpend / t.calls : 0,
      showRate: t.calls > 0 ? (t.showedCalls / t.calls) * 100 : 0,
      costPerShow: t.showedCalls > 0 ? t.adSpend / t.showedCalls : 0,
      costPerReconnect: t.reconnectCalls > 0 ? t.adSpend / t.reconnectCalls : 0,
      costPerReconnectShowed: t.reconnectShowed > 0 ? t.adSpend / t.reconnectShowed : 0,
      costPerInvestor: t.fundedInvestors > 0 ? t.adSpend / t.fundedInvestors : 0,
      costOfCapital: t.fundedDollars > 0 ? (t.adSpend / t.fundedDollars) * 100 : 0,
      period: 'total',
      periodLabel: 'TOTAL',
      year: selectedYear,
      month: 0,
      hasData: true,
    } as PeriodStats;
  }, [displayStats, selectedYear]);

  const handleEditClick = (period: string, field: string, currentValue: number) => {
    setEditing({ period, field, value: currentValue.toString() });
  };

  const handleEditSave = async (periodStats: PeriodStats) => {
    if (!editing || !clientId) return;

    const fieldMap: Record<string, string> = {
      adSpend: 'ad_spend',
      leads: 'leads',
      calls: 'calls',
      showedCalls: 'showed_calls',
      reconnectCalls: 'reconnect_calls',
      reconnectShowed: 'reconnect_showed',
      commitments: 'commitments',
      commitmentDollars: 'commitment_dollars',
      fundedInvestors: 'funded_investors',
      fundedDollars: 'funded_dollars',
    };

    const dbField = fieldMap[editing.field];
    if (!dbField) return;

    const desiredValue = parseFloat(editing.value) || 0;

    try {
      if (periodType === 'daily') {
        // Daily mode: override the exact value for this day
        await updateDailyMetric.mutateAsync({
          clientId,
          date: periodStats.period,
          updates: { [dbField]: desiredValue },
        });
      } else if (periodType === 'weekly') {
        // Weekly mode: calculate delta so weekly total matches the desired value
        const weekStart = parseISO(periodStats.period);
        const weekEnd = endOfWeek(weekStart, { weekStartsOn: 1 });

        const weekMetrics = metricsToUse.filter(m => {
          const d = parseISO(m.date);
          return isWithinInterval(d, { start: weekStart, end: weekEnd });
        });

        // Find the first record (anchor) or use week start date
        const anchor = weekMetrics.length > 0
          ? weekMetrics.sort((a, b) => a.date.localeCompare(b.date))[0]
          : null;
        const anchorDate = anchor ? anchor.date : periodStats.period;

        // Sum of all OTHER records in the week (excluding anchor)
        const otherSum = weekMetrics
          .filter(m => m.date !== anchorDate)
          .reduce((sum, m) => sum + Number((m as any)[dbField] || 0), 0);

        // Set anchor so that anchor + otherSum = desiredValue
        const anchorValue = desiredValue - otherSum;

        await updateDailyMetric.mutateAsync({
          clientId,
          date: anchorDate,
          updates: { [dbField]: anchorValue },
        });
      } else {
        // Monthly mode: use the monthly upsert with delta logic
        await upsertMonthlyMetric.mutateAsync({
          clientId,
          year: periodStats.year,
          month: periodStats.month,
          updates: { [dbField]: desiredValue },
        });
      }
      toast.success('Metric updated successfully');
      setEditing(null);
    } catch (error) {
      toast.error('Failed to update metric');
    }
  };

  const handleAddMonth = async () => {
    if (!addingMonth || !clientId) return;

    try {
      await upsertMonthlyMetric.mutateAsync({
        clientId,
        year: selectedYear,
        month: addingMonth,
        updates: {
          ad_spend: parseFloat(newMonthData.adSpend) || 0,
          leads: parseInt(newMonthData.leads) || 0,
          calls: parseInt(newMonthData.calls) || 0,
          showed_calls: parseInt(newMonthData.showedCalls) || 0,
          reconnect_calls: parseInt(newMonthData.reconnectCalls) || 0,
          reconnect_showed: parseInt(newMonthData.reconnectShowed) || 0,
          commitments: parseInt(newMonthData.commitments) || 0,
          commitment_dollars: parseFloat(newMonthData.commitmentDollars) || 0,
          funded_investors: parseInt(newMonthData.fundedInvestors) || 0,
          funded_dollars: parseFloat(newMonthData.fundedDollars) || 0,
        },
      });
      toast.success(`${MONTH_NAMES[addingMonth - 1]} data added successfully`);
      setAddingMonth(null);
      setNewMonthData({});
    } catch (error) {
      toast.error('Failed to add month data');
    }
  };

  // Color coding removed — all values render plain
  const getKpiColorClass = (_metric: MetricRowConfig, _value: number): string => {
    return '';
  };

  const renderEditableCell = (periodStats: PeriodStats, metric: MetricRowConfig, value: number) => {
    const isEditing = editing?.period === periodStats.period && editing?.field === metric.key;

    if (isEditing) {
      return (
        <div className="flex items-center justify-center gap-1">
          <Input
            type="number"
            value={editing.value}
            onChange={(e) => setEditing({ ...editing, value: e.target.value })}
            className="h-6 w-20 text-xs px-1"
            autoFocus
          />
          <Button
            size="icon"
            variant="ghost"
            className="h-5 w-5"
            onClick={() => handleEditSave(periodStats)}
            disabled={upsertMonthlyMetric.isPending || updateDailyMetric.isPending}
          >
            {(upsertMonthlyMetric.isPending || updateDailyMetric.isPending) ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3 text-success" />}
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-5 w-5"
            onClick={() => setEditing(null)}
          >
            <X className="h-3 w-3 text-destructive" />
          </Button>
        </div>
      );
    }

    const colorClass = metric.highlight ? 'text-emerald-400 font-semibold' : getKpiColorClass(metric, value);

    return (
      <div className="relative flex items-center justify-center group">
        <span className={colorClass}>{metric.format(value)}</span>
        {clientId && metric.editable && (
          <Button
            size="icon"
            variant="ghost"
            className="h-4 w-4 opacity-0 group-hover:opacity-100 transition-opacity absolute right-0"
            onClick={() => handleEditClick(periodStats.period, metric.key, value)}
          >
            <Pencil className="h-3 w-3" />
          </Button>
        )}
      </div>
    );
  };

  const periodLabels = {
    daily: 'Daily',
    weekly: 'Weekly',
    monthly: 'Monthly'
  };

  if (isLoading && clientId) {
    return (
      <section className="border-2 border-border bg-card p-4">
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </section>
    );
  }

  return (
    <section className="border border-border bg-card p-3">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div>
          <h3 className="font-bold text-lg">
            {periodLabels[periodType]} Performance Summary
          </h3>
          <p className="text-xs text-muted-foreground">
            Aggregated metrics by {periodType === 'daily' ? 'day' : periodType === 'weekly' ? 'week' : 'month'} for {selectedYear}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={selectedYear.toString()} onValueChange={(v) => setSelectedYear(parseInt(v))}>
            <SelectTrigger className="w-20 h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {AVAILABLE_YEARS.map(year => (
                <SelectItem key={year} value={year.toString()}>{year}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex gap-0.5">
            <Button
              variant={periodType === 'monthly' ? 'default' : 'outline'}
              size="sm"
              className="h-8 px-3"
              onClick={() => setPeriodType('monthly')}
            >
              M
            </Button>
            <Button
              variant={periodType === 'weekly' ? 'default' : 'outline'}
              size="sm"
              className="h-8 px-3"
              onClick={() => setPeriodType('weekly')}
            >
              W
            </Button>
            <Button
              variant={periodType === 'daily' ? 'default' : 'outline'}
              size="sm"
              className="h-8 px-3"
              onClick={() => setPeriodType('daily')}
            >
              D
            </Button>
          </div>
        </div>
      </div>

      {displayStats.length === 0 && periodType === 'monthly' ? (
        <div className="py-8 text-center">
          <p className="text-muted-foreground mb-4">No data available for {selectedYear}</p>
          {clientId && emptyMonths.length > 0 && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">Add historical data for:</p>
              <div className="flex flex-wrap gap-2 justify-center">
                {emptyMonths.map(m => (
                  <Button
                    key={m.month}
                    variant="outline"
                    size="sm"
                    onClick={() => setAddingMonth(m.month)}
                  >
                    <Plus className="h-3 w-3 mr-1" />
                    {MONTH_NAMES[m.month - 1]}
                  </Button>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <>
          {/* Add month option */}
          {clientId && periodType === 'monthly' && emptyMonths.length > 0 && (
            <div className="mb-4 flex items-center gap-2 flex-wrap">
              <span className="text-sm text-muted-foreground">Add missing month:</span>
              {emptyMonths.slice(0, 3).map(m => (
                <Button
                  key={m.month}
                  variant="outline"
                  size="sm"
                  onClick={() => setAddingMonth(m.month)}
                >
                  <Plus className="h-3 w-3 mr-1" />
                  {MONTH_NAMES[m.month - 1]}
                </Button>
              ))}
              {emptyMonths.length > 3 && (
                <span className="text-xs text-muted-foreground">+{emptyMonths.length - 3} more</span>
              )}
            </div>
          )}

          {/* Transposed Table: Metrics as rows, Periods as columns */}
          <div className="relative -mx-2">
            <div className="overflow-x-auto">
              <Table className="text-sm" style={{ borderCollapse: 'separate', borderSpacing: 0 }}>
                <TableHeader>
                  <TableRow className="border-b">
                    <TableHead className="font-bold whitespace-nowrap bg-card w-[120px] py-2 px-3 text-left sticky left-0 z-20 shadow-[2px_0_4px_-2px_hsl(var(--border))]">
                      Metric
                    </TableHead>
                    <TableHead className="font-bold text-center whitespace-nowrap bg-muted min-w-[110px] py-2 px-3 sticky left-[120px] z-20 shadow-[2px_0_4px_-2px_hsl(var(--border))]">
                      TOTAL
                    </TableHead>
                    {displayStats.map((period, i) => (
                      <TableHead
                        key={period.period}
                        className={`font-bold text-center whitespace-nowrap py-2 px-4 min-w-[110px] ${i < displayStats.length - 1 ? 'border-r border-border/50' : ''}`}
                      >
                        {period.periodLabel}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {METRIC_ROWS.map((metric) => {
                    const totalValue = totals[metric.key] as number;
                    const totalColorClass = metric.highlight ? 'text-emerald-400 font-semibold' : getKpiColorClass(metric, totalValue);
                    
                    return (
                      <TableRow key={metric.key} className={`border-b border-border/20 ${metric.highlight ? 'bg-emerald-500/5' : ''}`}>
                        <TableCell className="font-medium whitespace-nowrap bg-card py-1.5 px-3 text-left sticky left-0 z-20 shadow-[2px_0_4px_-2px_hsl(var(--border))] border-b border-border/20">
                          {metricLabels[metric.key] || metric.label}
                        </TableCell>
                        <TableCell className="text-center bg-muted py-1.5 px-3 font-semibold sticky left-[120px] z-20 shadow-[2px_0_4px_-2px_hsl(var(--border))] border-b border-border/20 tabular-nums">
                          <span className={totalColorClass}>
                            {metric.format(totalValue)}
                          </span>
                        </TableCell>
                        {displayStats.map((period, i) => {
                          const value = period[metric.key] as number;
                          const colorClass = metric.highlight ? 'text-emerald-400 font-semibold' : getKpiColorClass(metric, value);
                          
                          return (
                            <TableCell
                              key={period.period}
                              className={`text-center py-1.5 px-4 min-w-[110px] tabular-nums ${i < displayStats.length - 1 ? 'border-r border-border/50' : ''}`}
                            >
                              {metric.editable 
                                ? renderEditableCell(period, metric, value)
                                : <span className={colorClass}>{metric.format(value)}</span>
                              }
                            </TableCell>
                          );
                        })}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </div>
        </>
      )}

      {/* Add Month Modal */}
      {addingMonth && (
        <div className="fixed inset-0 bg-background/80 flex items-center justify-center z-50">
          <div className="bg-card border-2 border-border p-6 max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
            <h3 className="font-bold text-lg mb-4">Add Data for {MONTH_NAMES[addingMonth - 1]} {selectedYear}</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium">Ad Spend</label>
                <Input
                  type="number"
                  placeholder="0"
                  value={newMonthData.adSpend || ''}
                  onChange={(e) => setNewMonthData({ ...newMonthData, adSpend: e.target.value })}
                />
              </div>
              <div>
                <label className="text-sm font-medium">Leads</label>
                <Input
                  type="number"
                  placeholder="0"
                  value={newMonthData.leads || ''}
                  onChange={(e) => setNewMonthData({ ...newMonthData, leads: e.target.value })}
                />
              </div>
              <div>
                <label className="text-sm font-medium">Calls</label>
                <Input
                  type="number"
                  placeholder="0"
                  value={newMonthData.calls || ''}
                  onChange={(e) => setNewMonthData({ ...newMonthData, calls: e.target.value })}
                />
              </div>
              <div>
                <label className="text-sm font-medium">Showed Calls</label>
                <Input
                  type="number"
                  placeholder="0"
                  value={newMonthData.showedCalls || ''}
                  onChange={(e) => setNewMonthData({ ...newMonthData, showedCalls: e.target.value })}
                />
              </div>
              <div>
                <label className="text-sm font-medium">Reconnect Calls</label>
                <Input
                  type="number"
                  placeholder="0"
                  value={newMonthData.reconnectCalls || ''}
                  onChange={(e) => setNewMonthData({ ...newMonthData, reconnectCalls: e.target.value })}
                />
              </div>
              <div>
                <label className="text-sm font-medium">Reconnect Showed</label>
                <Input
                  type="number"
                  placeholder="0"
                  value={newMonthData.reconnectShowed || ''}
                  onChange={(e) => setNewMonthData({ ...newMonthData, reconnectShowed: e.target.value })}
                />
              </div>
              <div>
                <label className="text-sm font-medium">Commitments</label>
                <Input
                  type="number"
                  placeholder="0"
                  value={newMonthData.commitments || ''}
                  onChange={(e) => setNewMonthData({ ...newMonthData, commitments: e.target.value })}
                />
              </div>
              <div>
                <label className="text-sm font-medium">Commitment $</label>
                <Input
                  type="number"
                  placeholder="0"
                  value={newMonthData.commitmentDollars || ''}
                  onChange={(e) => setNewMonthData({ ...newMonthData, commitmentDollars: e.target.value })}
                />
              </div>
              <div>
                <label className="text-sm font-medium">Funded Investors</label>
                <Input
                  type="number"
                  placeholder="0"
                  value={newMonthData.fundedInvestors || ''}
                  onChange={(e) => setNewMonthData({ ...newMonthData, fundedInvestors: e.target.value })}
                />
              </div>
              <div>
                <label className="text-sm font-medium">Funded $</label>
                <Input
                  type="number"
                  placeholder="0"
                  value={newMonthData.fundedDollars || ''}
                  onChange={(e) => setNewMonthData({ ...newMonthData, fundedDollars: e.target.value })}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <Button variant="outline" onClick={() => { setAddingMonth(null); setNewMonthData({}); }}>
                Cancel
              </Button>
              <Button onClick={handleAddMonth} disabled={upsertMonthlyMetric.isPending}>
                {upsertMonthlyMetric.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Save
              </Button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
