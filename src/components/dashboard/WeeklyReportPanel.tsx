import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { RefreshCw, Loader2, Pencil, Plus, FileSpreadsheet, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { cn } from '@/lib/utils';
import {
  useWeeklyReports, useReportBaselines, useGenerateWeeklyReport,
  useUpdateReportMetric, useAddCustomRow, useSaveBaseline,
  WEEKLY_METRIC_ROWS, type WeeklyReport, type MetricCell,
} from '@/hooks/useWeeklyReports';

interface WeeklyReportPanelProps {
  clientId: string;
}

function fmtValue(v: number | null | undefined, fmt: 'currency' | 'number' | 'pct'): string {
  if (v === null || v === undefined) return '—';
  if (fmt === 'currency') return `$${v.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
  if (fmt === 'pct') return `${v.toFixed(1)}%`;
  return v.toLocaleString('en-US');
}

function displayValue(cell: MetricCell | undefined): number | null {
  if (!cell) return null;
  return cell.override ?? cell.computed;
}

// ─── Editable cell ─────────────────────────────────────────────────────────
function EditableCell({
  report, metricKey, fmt,
}: { report: WeeklyReport; metricKey: string; fmt: 'currency' | 'number' | 'pct' }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const updateMetric = useUpdateReportMetric();
  const cell = report.metrics[metricKey];
  const value = displayValue(cell);
  const isOverridden = cell?.override !== null && cell?.override !== undefined;

  const save = () => {
    const num = draft.trim() === '' ? null : Number(draft);
    if (draft.trim() !== '' && Number.isNaN(num)) { setEditing(false); return; }
    updateMetric.mutate({
      reportId: report.id, metricKey,
      override: num, currentMetrics: report.metrics,
    });
    setEditing(false);
  };

  if (editing) {
    return (
      <Input
        autoFocus
        defaultValue={cell?.override ?? cell?.computed ?? ''}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); }}
        className="h-7 w-24 text-xs text-right tabular-nums"
      />
    );
  }

  return (
    <button
      onClick={() => { setDraft(String(cell?.override ?? cell?.computed ?? '')); setEditing(true); }}
      className={cn(
        'group inline-flex items-center gap-1 tabular-nums text-sm hover:bg-muted rounded px-1.5 py-0.5 -mx-1.5',
        isOverridden && 'text-amber-600 dark:text-amber-400 font-medium',
      )}
      title={isOverridden ? `Manual override (computed: ${fmtValue(cell?.computed, fmt)})` : 'Click to override'}
    >
      {fmtValue(value, fmt)}
      <Pencil className="w-3 h-3 opacity-0 group-hover:opacity-40" />
    </button>
  );
}

// ─── Main panel ────────────────────────────────────────────────────────────
export function WeeklyReportPanel({ clientId }: WeeklyReportPanelProps) {
  const [weeksShown] = useState(6);
  const { data: reports = [], isLoading } = useWeeklyReports(clientId, weeksShown);
  const { data: baselines = [] } = useReportBaselines(clientId, weeksShown);
  const generate = useGenerateWeeklyReport();
  const addRow = useAddCustomRow();
  const saveBaseline = useSaveBaseline();
  const [newRowLabel, setNewRowLabel] = useState('');
  const [baselineDraft, setBaselineDraft] = useState<Record<string, string>>({});
  const [baselineWeek, setBaselineWeek] = useState<string | null>(null);

  // Oldest → newest, left → right like the sheet
  const orderedReports = useMemo(() => [...reports].reverse(), [reports]);
  const latest = reports[0];

  const baselineFor = (weekStart: string) =>
    baselines.find(b => b.week_start === weekStart && b.source_label === 'sheet');

  const handleGenerate = () => generate.mutate({ clientId, weeks: weeksShown });

  const handleSaveBaseline = () => {
    if (!baselineWeek) return;
    const values: Record<string, number> = {};
    for (const [k, v] of Object.entries(baselineDraft)) {
      const n = Number(v);
      if (v.trim() !== '' && !Number.isNaN(n)) values[k] = n;
    }
    saveBaseline.mutate({ clientId, weekStart: baselineWeek, values });
    setBaselineWeek(null);
    setBaselineDraft({});
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5 text-muted-foreground" />
            <CardTitle className="text-base">Weekly Report</CardTitle>
            {latest?.generated_at && (
              <span className="text-[11px] text-muted-foreground">
                refreshed {format(parseISO(latest.generated_at), 'MMM d, h:mm a')}
              </span>
            )}
          </div>
          <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5"
            onClick={handleGenerate} disabled={generate.isPending}>
            {generate.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Refresh {weeksShown} weeks
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="report">
          <TabsList className="h-8">
            <TabsTrigger value="report" className="text-xs">Report</TabsTrigger>
            <TabsTrigger value="questions" className="text-xs">Lead Questions</TabsTrigger>
            <TabsTrigger value="dispositions" className="text-xs">Dispositions</TabsTrigger>
            <TabsTrigger value="crossref" className="text-xs">DB vs Sheet</TabsTrigger>
          </TabsList>

          {/* ── Sheet-style metric grid ── */}
          <TabsContent value="report" className="mt-3">
            {isLoading ? (
              <p className="text-sm text-muted-foreground py-6 text-center">Loading…</p>
            ) : orderedReports.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-sm text-muted-foreground mb-3">No weekly reports yet.</p>
                <Button size="sm" onClick={handleGenerate} disabled={generate.isPending}>Generate now</Button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="min-w-[130px]">Metric</TableHead>
                      {orderedReports.map(r => (
                        <TableHead key={r.id} className="text-right whitespace-nowrap">
                          {format(parseISO(r.week_start), 'MMM d')}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {WEEKLY_METRIC_ROWS.map(row => (
                      <TableRow key={row.key}>
                        <TableCell className="text-xs font-medium">{row.label}</TableCell>
                        {orderedReports.map(r => (
                          <TableCell key={r.id} className="text-right">
                            <EditableCell report={r} metricKey={row.key} fmt={row.format} />
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                    {/* Custom rows (latest report's set shown; edit adds to latest) */}
                    {(latest?.custom_rows || []).map((cr, i) => (
                      <TableRow key={`custom-${i}`}>
                        <TableCell className="text-xs font-medium text-muted-foreground italic">{cr.label}</TableCell>
                        <TableCell colSpan={orderedReports.length} className="text-right text-sm">{cr.value}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {latest && (
                  <div className="flex gap-2 mt-3">
                    <Input
                      placeholder="Add custom row label…"
                      value={newRowLabel}
                      onChange={e => setNewRowLabel(e.target.value)}
                      className="h-8 text-xs max-w-xs"
                    />
                    <Button size="sm" variant="outline" className="h-8 text-xs gap-1"
                      disabled={!newRowLabel.trim() || addRow.isPending}
                      onClick={() => {
                        addRow.mutate({ reportId: latest.id, currentRows: latest.custom_rows, label: newRowLabel.trim(), value: '' });
                        setNewRowLabel('');
                      }}>
                      <Plus className="w-3 h-3" /> Add row
                    </Button>
                    <span className="text-[11px] text-muted-foreground self-center ml-2">
                      Amber values are manual overrides — hover to see the computed number.
                    </span>
                  </div>
                )}
              </div>
            )}
          </TabsContent>

          {/* ── GHL form question breakdown ── */}
          <TabsContent value="questions" className="mt-3 space-y-4">
            {!latest || Object.keys(latest.question_breakdown).length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                No question data captured for the latest week. Question answers come from GHL form fields on each lead.
              </p>
            ) : (
              Object.entries(latest.question_breakdown).map(([question, answers]) => {
                const total = Object.values(answers).reduce((s, n) => s + n, 0);
                return (
                  <div key={question}>
                    <p className="text-sm font-medium mb-1.5">{question}</p>
                    <div className="space-y-1">
                      {Object.entries(answers).sort((a, b) => b[1] - a[1]).map(([answer, count]) => (
                        <div key={answer} className="flex items-center gap-2">
                          <div className="flex-1 h-5 bg-muted rounded overflow-hidden">
                            <div className="h-full bg-primary/60 rounded flex items-center px-2"
                              style={{ width: `${Math.max((count / total) * 100, 8)}%` }}>
                              <span className="text-[10px] text-primary-foreground truncate">{answer}</span>
                            </div>
                          </div>
                          <span className="text-xs tabular-nums w-14 text-right">{count} ({Math.round((count / total) * 100)}%)</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })
            )}
          </TabsContent>

          {/* ── Lead dispositions ── */}
          <TabsContent value="dispositions" className="mt-3">
            {!latest || Object.keys(latest.disposition_breakdown).length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">No disposition data for the latest week.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {Object.entries(latest.disposition_breakdown).sort((a, b) => b[1] - a[1]).map(([status, count]) => (
                  <Badge key={status} variant="outline" className="text-xs gap-1.5 py-1.5 px-3">
                    <span className="capitalize">{status.replace(/_/g, ' ')}</span>
                    <span className="font-bold tabular-nums">{count}</span>
                  </Badge>
                ))}
              </div>
            )}
          </TabsContent>

          {/* ── DB vs Sheet cross-reference ── */}
          <TabsContent value="crossref" className="mt-3 space-y-3">
            <p className="text-xs text-muted-foreground">
              Paste your Google Sheet numbers for a week to cross-reference against DB-computed values.
              Variances over 5% are flagged.
            </p>
            <div className="flex gap-2 items-center">
              <select
                className="h-8 text-xs border rounded px-2 bg-background"
                value={baselineWeek || ''}
                onChange={e => {
                  setBaselineWeek(e.target.value || null);
                  const existing = baselineFor(e.target.value);
                  setBaselineDraft(existing
                    ? Object.fromEntries(Object.entries(existing.values).map(([k, v]) => [k, String(v)]))
                    : {});
                }}
              >
                <option value="">Select week…</option>
                {reports.map(r => (
                  <option key={r.id} value={r.week_start}>{format(parseISO(r.week_start), 'MMM d, yyyy')}</option>
                ))}
              </select>
              {baselineWeek && (
                <Button size="sm" className="h-8 text-xs" onClick={handleSaveBaseline} disabled={saveBaseline.isPending}>
                  Save sheet values
                </Button>
              )}
            </div>
            {baselineWeek && (() => {
              const report = reports.find(r => r.week_start === baselineWeek);
              if (!report) return null;
              return (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Metric</TableHead>
                      <TableHead className="text-right">DB</TableHead>
                      <TableHead className="text-right w-32">Sheet</TableHead>
                      <TableHead className="text-right">Variance</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {WEEKLY_METRIC_ROWS.map(row => {
                      const dbVal = displayValue(report.metrics[row.key]);
                      const sheetStr = baselineDraft[row.key] ?? '';
                      const sheetVal = sheetStr.trim() === '' ? null : Number(sheetStr);
                      const variance = dbVal !== null && sheetVal !== null && sheetVal !== 0
                        ? ((dbVal - sheetVal) / sheetVal) * 100 : null;
                      const flagged = variance !== null && Math.abs(variance) > 5;
                      return (
                        <TableRow key={row.key}>
                          <TableCell className="text-xs">{row.label}</TableCell>
                          <TableCell className="text-right text-sm tabular-nums">{fmtValue(dbVal, row.format)}</TableCell>
                          <TableCell className="text-right">
                            <Input
                              value={sheetStr}
                              onChange={e => setBaselineDraft(d => ({ ...d, [row.key]: e.target.value }))}
                              placeholder="—"
                              className="h-7 text-xs text-right tabular-nums"
                            />
                          </TableCell>
                          <TableCell className="text-right">
                            {variance === null ? <span className="text-muted-foreground text-xs">—</span> : (
                              <span className={cn('inline-flex items-center gap-1 text-xs tabular-nums',
                                flagged ? 'text-destructive font-medium' : 'text-emerald-600 dark:text-emerald-400')}>
                                {flagged ? <AlertTriangle className="w-3 h-3" /> : <CheckCircle2 className="w-3 h-3" />}
                                {variance > 0 ? '+' : ''}{variance.toFixed(1)}%
                              </span>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              );
            })()}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
