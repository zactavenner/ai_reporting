import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface MetricCell {
  computed: number;
  override: number | null;
  note: string | null;
}

export interface WeeklyReport {
  id: string;
  client_id: string;
  week_start: string;
  week_end: string;
  metrics: Record<string, MetricCell>;
  question_breakdown: Record<string, Record<string, number>>;
  disposition_breakdown: Record<string, number>;
  custom_rows: Array<{ label: string; value: string; note?: string }>;
  status: 'draft' | 'reviewed' | 'sent';
  generated_at: string | null;
}

export interface ReportBaseline {
  id: string;
  client_id: string;
  week_start: string;
  source_label: string;
  values: Record<string, number>;
}

// Display order + labels for the sheet-style grid
export const WEEKLY_METRIC_ROWS: Array<{ key: string; label: string; format: 'currency' | 'number' | 'pct' }> = [
  { key: 'ad_spend', label: 'Ad Spend', format: 'currency' },
  { key: 'leads', label: 'Leads', format: 'number' },
  { key: 'cpl', label: 'Cost / Lead', format: 'currency' },
  { key: 'booked_calls', label: 'Booked Calls', format: 'number' },
  { key: 'cost_per_booked', label: 'Cost / Booked', format: 'currency' },
  { key: 'showed_calls', label: 'Showed Calls', format: 'number' },
  { key: 'cost_per_showed', label: 'Cost / Showed', format: 'currency' },
  { key: 'show_rate_pct', label: 'Show Rate', format: 'pct' },
  { key: 'committed', label: 'Committed', format: 'number' },
  { key: 'commitment_dollars', label: 'Committed $', format: 'currency' },
  { key: 'funded', label: 'Funded', format: 'number' },
  { key: 'funded_dollars', label: 'Funded $', format: 'currency' },
  { key: 'cost_per_funded', label: 'Cost / Funded', format: 'currency' },
  { key: 'cost_of_capital_pct', label: 'Cost of Capital', format: 'pct' },
];

export function useWeeklyReports(clientId: string | undefined, weeks = 8) {
  return useQuery({
    queryKey: ['weekly-reports', clientId, weeks],
    queryFn: async (): Promise<WeeklyReport[]> => {
      if (!clientId) return [];
      const { data, error } = await supabase
        .from('weekly_reports')
        .select('*')
        .eq('client_id', clientId)
        .order('week_start', { ascending: false })
        .limit(weeks);
      if (error) throw error;
      return (data || []) as WeeklyReport[];
    },
    enabled: !!clientId,
  });
}

export function useReportBaselines(clientId: string | undefined, weeks = 8) {
  return useQuery({
    queryKey: ['report-baselines', clientId, weeks],
    queryFn: async (): Promise<ReportBaseline[]> => {
      if (!clientId) return [];
      const { data, error } = await supabase
        .from('report_baselines')
        .select('*')
        .eq('client_id', clientId)
        .order('week_start', { ascending: false })
        .limit(weeks * 2);
      if (error) throw error;
      return (data || []) as ReportBaseline[];
    },
    enabled: !!clientId,
  });
}

export function useGenerateWeeklyReport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ clientId, weekStart, weeks }: { clientId: string; weekStart?: string; weeks?: number }) => {
      const { data, error } = await supabase.functions.invoke('weekly-report-generator-v2', {
        body: { clientId, weekStart, weeks: weeks || 1 },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['weekly-reports'] });
    },
  });
}

// Save a manual override (or clear it with override=null)
export function useUpdateReportMetric() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ reportId, metricKey, override, note, currentMetrics }: {
      reportId: string; metricKey: string; override: number | null; note?: string | null;
      currentMetrics: Record<string, MetricCell>;
    }) => {
      const updated = { ...currentMetrics };
      const cell = updated[metricKey] || { computed: 0, override: null, note: null };
      updated[metricKey] = { ...cell, override, note: note !== undefined ? note : cell.note };
      const { error } = await supabase
        .from('weekly_reports')
        .update({ metrics: updated })
        .eq('id', reportId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['weekly-reports'] });
    },
  });
}

export function useAddCustomRow() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ reportId, currentRows, label, value }: {
      reportId: string; currentRows: WeeklyReport['custom_rows']; label: string; value: string;
    }) => {
      const { error } = await supabase
        .from('weekly_reports')
        .update({ custom_rows: [...currentRows, { label, value }] })
        .eq('id', reportId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['weekly-reports'] });
    },
  });
}

// Save sheet baseline values for cross-referencing
export function useSaveBaseline() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ clientId, weekStart, values, sourceLabel }: {
      clientId: string; weekStart: string; values: Record<string, number>; sourceLabel?: string;
    }) => {
      const { error } = await supabase
        .from('report_baselines')
        .upsert({
          client_id: clientId,
          week_start: weekStart,
          source_label: sourceLabel || 'sheet',
          values,
          entered_by: 'dashboard',
        }, { onConflict: 'client_id,week_start,source_label' });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['report-baselines'] });
    },
  });
}
