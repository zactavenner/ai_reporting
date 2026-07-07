import { useEffect, useMemo, useState } from 'react';
import { Mail, Download, Loader2, Send, Eye, Pencil } from 'lucide-react';
import { format, startOfMonth, subMonths, endOfMonth, subDays } from 'date-fns';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';

export interface StatHighlight {
  label: string;
  value: string;
  sub?: string;
}

export interface TrendSeries {
  label: string;
  color: string;
  prefix?: string;
  points: { date: string; value: number }[];
}

export type ScheduleFrequency = 'off' | 'weekly' | 'monthly';

export interface ScheduleConfig {
  frequency: ScheduleFrequency;
  dayOfWeek: number; // 0=Sun..6=Sat
  dayOfMonth: number; // 1..28
  hourLocal: number; // 0..23
  timezone: string;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  clientId: string;
  clientName: string;
  rangeLabel: string;
  highlights: StatHighlight[];
  trends?: TrendSeries[];
  initialRecipients?: string[];
  initialSchedule?: Partial<ScheduleConfig>;
  /** Captures the report area as a PDF and returns base64 (no data: prefix). */
  capturePdf: () => Promise<{ base64: string; filename: string } | null>;
}

function sparklineSvg(points: { date: string; value: number }[], color: string): string {
  if (!points.length) return '';
  const w = 320;
  const h = 56;
  const pad = 4;
  const vals = points.map((p) => Number(p.value) || 0);
  const max = Math.max(...vals, 1);
  const min = Math.min(...vals, 0);
  const range = max - min || 1;
  const step = (w - pad * 2) / Math.max(points.length - 1, 1);
  const path = vals
    .map((v, i) => {
      const x = pad + i * step;
      const y = h - pad - ((v - min) / range) * (h - pad * 2);
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  const areaPath = `${path} L${(pad + (points.length - 1) * step).toFixed(1)},${h - pad} L${pad},${h - pad} Z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="100%" height="${h}" preserveAspectRatio="none">
    <path d="${areaPath}" fill="${color}" opacity="0.12" />
    <path d="${path}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
  </svg>`;
}

function buildEmailHtml(opts: {
  clientName: string;
  rangeLabel: string;
  highlights: StatHighlight[];
  trends?: TrendSeries[];
}) {
  const rows: string[] = [];
  for (let i = 0; i < opts.highlights.length; i += 3) {
    const slice = opts.highlights
      .slice(i, i + 3)
      .map(
        (h) => `
          <td style="padding:8px;width:33%;vertical-align:top;">
            <div style="border:1px solid #e5e7eb;border-radius:14px;padding:14px;background:#ffffff;">
              <div style="font-size:10px;letter-spacing:1.4px;color:#6b7280;text-transform:uppercase;font-weight:600;">${h.label}</div>
              <div style="font-size:22px;font-weight:700;color:#0f172a;margin-top:6px;font-family:Georgia,serif;">${h.value}</div>
              ${h.sub ? `<div style="font-size:11px;color:#6b7280;margin-top:4px;">${h.sub}</div>` : ''}
            </div>
          </td>`,
      )
      .join('');
    rows.push(`<tr>${slice}</tr>`);
  }

  const trendsHtml = (opts.trends || [])
    .filter((t) => t.points && t.points.length > 1)
    .map((t) => {
      const last = t.points[t.points.length - 1]?.value ?? 0;
      const first = t.points[0]?.value ?? 0;
      const delta = last - first;
      const deltaPct = first > 0 ? (delta / first) * 100 : 0;
      const up = delta >= 0;
      const deltaTxt = `${up ? '▲' : '▼'} ${Math.abs(deltaPct).toFixed(1)}%`;
      const lastTxt = `${t.prefix || ''}${last.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
      return `
        <td style="padding:8px;width:50%;vertical-align:top;">
          <div style="border:1px solid #e5e7eb;border-radius:14px;padding:14px;background:#ffffff;">
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <div style="font-size:10px;letter-spacing:1.4px;color:#6b7280;text-transform:uppercase;font-weight:600;">${t.label}</div>
              <div style="font-size:11px;color:${up ? '#059669' : '#dc2626'};font-weight:600;">${deltaTxt}</div>
            </div>
            <div style="font-size:20px;font-weight:700;color:#0f172a;margin-top:4px;font-family:Georgia,serif;">${lastTxt}</div>
            <div style="margin-top:6px;">${sparklineSvg(t.points, t.color)}</div>
          </div>
        </td>`;
    })
    .join('');
  const trendsRows: string[] = [];
  const trendCells = (opts.trends || []).filter((t) => t.points && t.points.length > 1);
  for (let i = 0; i < trendCells.length; i += 2) {
    const slice = trendCells
      .slice(i, i + 2)
      .map((t) => {
        const last = t.points[t.points.length - 1]?.value ?? 0;
        const first = t.points[0]?.value ?? 0;
        const delta = last - first;
        const deltaPct = first > 0 ? (delta / first) * 100 : 0;
        const up = delta >= 0;
        const deltaTxt = `${up ? '▲' : '▼'} ${Math.abs(deltaPct).toFixed(1)}%`;
        const lastTxt = `${t.prefix || ''}${last.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
        return `
          <td style="padding:8px;width:50%;vertical-align:top;">
            <div style="border:1px solid #e5e7eb;border-radius:14px;padding:14px;background:#ffffff;">
              <div style="display:flex;justify-content:space-between;align-items:center;">
                <div style="font-size:10px;letter-spacing:1.4px;color:#6b7280;text-transform:uppercase;font-weight:600;">${t.label}</div>
                <div style="font-size:11px;color:${up ? '#059669' : '#dc2626'};font-weight:600;">${deltaTxt}</div>
              </div>
              <div style="font-size:20px;font-weight:700;color:#0f172a;margin-top:4px;font-family:Georgia,serif;">${lastTxt}</div>
              <div style="margin-top:6px;">${sparklineSvg(t.points, t.color)}</div>
            </div>
          </td>`;
      })
      .join('');
    trendsRows.push(`<tr>${slice}</tr>`);
  }

  return `<!doctype html><html><body style="margin:0;padding:24px;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a;">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:720px;margin:0 auto;">
      <tr><td style="padding:8px 8px 16px 8px;">
        <div style="font-size:11px;letter-spacing:2px;color:#6b7280;text-transform:uppercase;font-weight:600;">Performance Overview</div>
        <div style="font-size:26px;font-weight:700;margin-top:4px;font-family:Georgia,serif;">${opts.clientName} — Stat Sheet</div>
        <div style="font-size:13px;color:#475569;margin-top:4px;">${opts.rangeLabel}</div>
      </td></tr>
      <tr><td>
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
          ${rows.join('')}
        </table>
      </td></tr>
      ${trendsRows.length ? `<tr><td style="padding:12px 8px 0 8px;font-size:11px;letter-spacing:1.4px;color:#6b7280;text-transform:uppercase;font-weight:600;">Trends</td></tr>
      <tr><td><table role="presentation" cellpadding="0" cellspacing="0" width="100%">${trendsRows.join('')}</table></td></tr>` : ''}
      <tr><td style="padding:24px 8px 8px 8px;font-size:11px;color:#6b7280;">
        Full report attached as PDF. — High Performance Ads
      </td></tr>
    </table>
  </body></html>`;
}

const DAYS_OF_WEEK = [
  { v: 0, l: 'Sunday' },
  { v: 1, l: 'Monday' },
  { v: 2, l: 'Tuesday' },
  { v: 3, l: 'Wednesday' },
  { v: 4, l: 'Thursday' },
  { v: 5, l: 'Friday' },
  { v: 6, l: 'Saturday' },
];

function describeSchedule(s: ScheduleConfig): string {
  const hour = s.hourLocal % 12 === 0 ? 12 : s.hourLocal % 12;
  const ampm = s.hourLocal < 12 ? 'AM' : 'PM';
  const time = `${hour}:00 ${ampm} PST`;
  if (s.frequency === 'off') return 'Automatic sending is off. Hit Send now to start the weekly cadence.';
  if (s.frequency === 'weekly') {
    const day = DAYS_OF_WEEK.find((d) => d.v === s.dayOfWeek)?.l || 'Monday';
    const from = subDays(new Date(), 7);
    return `Every ${day} at ${time} — covers the previous 7 days (e.g. ${format(from, 'MMM d')} → ${format(new Date(), 'MMM d')}).`;
  }
  const monthStart = startOfMonth(subMonths(new Date(), 1));
  const monthEnd = endOfMonth(subMonths(new Date(), 1));
  return `On the ${s.dayOfMonth}${s.dayOfMonth === 1 ? 'st' : 'th'} of each month at ${time} — covers last calendar month (${format(monthStart, 'MMM d')} → ${format(monthEnd, 'MMM d')}).`;
}

export function SheetStatsReportDialog({
  open,
  onOpenChange,
  clientId,
  clientName,
  rangeLabel,
  highlights,
  trends,
  initialRecipients,
  initialSchedule,
  capturePdf,
}: Props) {
  const { toast } = useToast();
  const [recipientsText, setRecipientsText] = useState('');
  const [schedule, setSchedule] = useState<ScheduleConfig>({
    frequency: 'off',
    dayOfWeek: 1,
    dayOfMonth: 1,
    hourLocal: 8,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Los_Angeles',
  });
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [showPreview, setShowPreview] = useState(true);
  const [editingSchedule, setEditingSchedule] = useState(false);

  useEffect(() => {
    if (open) {
      setRecipientsText((initialRecipients || []).join(', '));
      setSchedule((s) => ({
        frequency: (initialSchedule?.frequency as any) || 'off',
        dayOfWeek: initialSchedule?.dayOfWeek ?? 1,
        dayOfMonth: initialSchedule?.dayOfMonth ?? 1,
        hourLocal: initialSchedule?.hourLocal ?? 8,
        timezone: 'America/Los_Angeles',
      }));
      setEditingSchedule(false);
    }
  }, [open, initialRecipients, initialSchedule]);

  const recipients = useMemo(
    () =>
      recipientsText
        .split(/[,\n;]+/)
        .map((s) => s.trim().toLowerCase())
        .filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)),
    [recipientsText],
  );

  const previewHtml = useMemo(
    () => buildEmailHtml({ clientName, rangeLabel, highlights, trends }),
    [clientName, rangeLabel, highlights, trends],
  );

  async function persistSettings(overrideSchedule?: ScheduleConfig) {
    const sched = overrideSchedule ?? schedule;
    setSaving(true);
    try {
      const { error } = await supabase
        .from('client_settings')
        .upsert(
          {
            client_id: clientId,
            stats_report_recipients: recipients,
            stats_report_weekly_enabled: sched.frequency !== 'off',
            stats_report_frequency: sched.frequency,
            stats_report_day_of_week: sched.dayOfWeek,
            stats_report_day_of_month: sched.dayOfMonth,
            stats_report_hour_local: sched.hourLocal,
            stats_report_timezone: sched.timezone,
          },
          { onConflict: 'client_id' },
        );
      if (error) throw error;
      toast({
        title: 'Saved',
        description: `${recipients.length} recipient${recipients.length === 1 ? '' : 's'} · ${describeSchedule(sched)}`,
      });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Could not save', description: e?.message || String(e) });
    } finally {
      setSaving(false);
    }
  }

  async function sendNow() {
    if (recipients.length === 0) {
      toast({ variant: 'destructive', title: 'No valid recipients', description: 'Enter at least one valid email.' });
      return;
    }
    setSending(true);
    try {
      const pdf = await capturePdf().catch(() => null);
      const { data, error } = await supabase.functions.invoke('send-sheet-stats-email', {
        body: {
          recipients,
          subject: `${clientName} — Stat Sheet (${rangeLabel})`,
          html: previewHtml,
          pdf_base64: pdf?.base64,
          pdf_filename: pdf?.filename,
          client_name: clientName,
          client_id: clientId,
        },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast({ title: 'Sent', description: `Report emailed to ${recipients.length} recipient${recipients.length === 1 ? '' : 's'}.` });
      // Auto-start the weekly cadence when sending manually if no schedule set yet.
      let schedToSave = schedule;
      if (schedule.frequency === 'off') {
        schedToSave = { ...schedule, frequency: 'weekly', dayOfWeek: 1, hourLocal: 8, timezone: 'America/Los_Angeles' };
        setSchedule(schedToSave);
      }
      await persistSettings(schedToSave);
    } catch (e: any) {
      const msg = e?.message || String(e);
      toast({
        variant: 'destructive',
        title: 'Could not send email',
        description: msg.includes('not configured') || msg.includes('email_not_configured')
          ? 'Email sending isn\'t set up yet. Ask an admin to complete the email domain setup, then try again.'
          : msg,
      });
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-4 w-4" /> Email Stat Sheet Report
          </DialogTitle>
          <DialogDescription>
            Send the current view as a clean HTML email with the PDF attached. Add multiple emails separated by commas.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="recipients">Recipients</Label>
            <Textarea
              id="recipients"
              value={recipientsText}
              onChange={(e) => setRecipientsText(e.target.value)}
              placeholder="zac@example.com, partner@example.com"
              rows={2}
            />
            <p className="text-xs text-muted-foreground">
              {recipients.length} valid email{recipients.length === 1 ? '' : 's'} detected.
            </p>
          </div>

          <div className="rounded-xl border bg-muted/30 px-4 py-3 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  {schedule.frequency === 'off' ? 'Weekly email' : schedule.frequency === 'weekly' ? 'Weekly email' : 'Monthly email'}
                </p>
                <p className="text-xs text-muted-foreground">{describeSchedule(schedule)}</p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 px-2"
                onClick={() => setEditingSchedule((v) => !v)}
                title="Edit schedule"
              >
                <Pencil className="h-3.5 w-3.5 mr-1" />
                {editingSchedule ? 'Done' : 'Edit'}
              </Button>
            </div>

            {editingSchedule && (
              <div className="space-y-3">
                <div className="space-y-1">
                  <Label className="text-xs">Frequency</Label>
                  <Select
                    value={schedule.frequency}
                    onValueChange={(v) => setSchedule((s) => ({ ...s, frequency: v as ScheduleFrequency }))}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="off">Off</SelectItem>
                      <SelectItem value="weekly">Weekly</SelectItem>
                      <SelectItem value="monthly">Monthly (1st)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {schedule.frequency !== 'off' && (
              <div className="grid grid-cols-2 gap-3">
                {schedule.frequency === 'weekly' ? (
                  <div className="space-y-1">
                    <Label className="text-xs">Day of week</Label>
                    <Select
                      value={String(schedule.dayOfWeek)}
                      onValueChange={(v) => setSchedule((s) => ({ ...s, dayOfWeek: Number(v) }))}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {DAYS_OF_WEEK.map((d) => (
                          <SelectItem key={d.v} value={String(d.v)}>{d.l}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <Label className="text-xs">Day of month</Label>
                    <Select
                      value={String(schedule.dayOfMonth)}
                      onValueChange={(v) => setSchedule((s) => ({ ...s, dayOfMonth: Number(v) }))}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                          <SelectItem key={d} value={String(d)}>{d}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <div className="space-y-1">
                  <Label className="text-xs">Time (PST)</Label>
                  <Select
                    value={String(schedule.hourLocal)}
                    onValueChange={(v) => setSchedule((s) => ({ ...s, hourLocal: Number(v) }))}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: 24 }, (_, i) => i).map((h) => {
                        const hr = h % 12 === 0 ? 12 : h % 12;
                        const ampm = h < 12 ? 'AM' : 'PM';
                        return <SelectItem key={h} value={String(h)}>{hr}:00 {ampm}</SelectItem>;
                      })}
                    </SelectContent>
                  </Select>
                </div>
              </div>
                )}
              </div>
            )}
          </div>

          <div className="rounded-xl border bg-card/50">
            <button
              type="button"
              onClick={() => setShowPreview((v) => !v)}
              className="w-full flex items-center justify-between px-4 py-2 text-xs uppercase tracking-wider text-muted-foreground hover:text-foreground"
            >
              <span className="inline-flex items-center gap-2"><Eye className="h-3.5 w-3.5" /> Email preview</span>
              <span>{showPreview ? 'Hide' : 'Show'}</span>
            </button>
            {showPreview && (
              <div className="border-t bg-white">
                <iframe
                  title="Email preview"
                  srcDoc={previewHtml}
                  className="w-full h-[560px] border-0"
                />
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          <Button variant="outline" onClick={() => persistSettings()} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Save
          </Button>
          <Button onClick={sendNow} disabled={sending || recipients.length === 0}>
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            <span className="ml-2">Send now</span>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export { buildEmailHtml };