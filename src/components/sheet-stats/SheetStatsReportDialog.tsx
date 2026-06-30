import { useEffect, useMemo, useState } from 'react';
import { Mail, Download, Loader2, Send, Eye } from 'lucide-react';
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
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';

export interface StatHighlight {
  label: string;
  value: string;
  sub?: string;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  clientId: string;
  clientName: string;
  rangeLabel: string;
  highlights: StatHighlight[];
  initialRecipients?: string[];
  initialWeeklyEnabled?: boolean;
  /** Captures the report area as a PDF and returns base64 (no data: prefix). */
  capturePdf: () => Promise<{ base64: string; filename: string } | null>;
}

function buildEmailHtml(opts: { clientName: string; rangeLabel: string; highlights: StatHighlight[] }) {
  const tiles = opts.highlights
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

  // group into rows of 3
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
      <tr><td style="padding:24px 8px 8px 8px;font-size:11px;color:#6b7280;">
        Full report attached as PDF. — High Performance Ads
      </td></tr>
    </table>
  </body></html>`;
}

export function SheetStatsReportDialog({
  open,
  onOpenChange,
  clientId,
  clientName,
  rangeLabel,
  highlights,
  initialRecipients,
  initialWeeklyEnabled,
  capturePdf,
}: Props) {
  const { toast } = useToast();
  const [recipientsText, setRecipientsText] = useState('');
  const [weeklyEnabled, setWeeklyEnabled] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [showPreview, setShowPreview] = useState(true);

  useEffect(() => {
    if (open) {
      setRecipientsText((initialRecipients || []).join(', '));
      setWeeklyEnabled(!!initialWeeklyEnabled);
    }
  }, [open, initialRecipients, initialWeeklyEnabled]);

  const recipients = useMemo(
    () =>
      recipientsText
        .split(/[,\n;]+/)
        .map((s) => s.trim().toLowerCase())
        .filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)),
    [recipientsText],
  );

  const previewHtml = useMemo(
    () => buildEmailHtml({ clientName, rangeLabel, highlights }),
    [clientName, rangeLabel, highlights],
  );

  async function persistSettings() {
    setSaving(true);
    try {
      const { error } = await supabase
        .from('client_settings')
        .upsert(
          {
            client_id: clientId,
            stats_report_recipients: recipients,
            stats_report_weekly_enabled: weeklyEnabled,
          },
          { onConflict: 'client_id' },
        );
      if (error) throw error;
      toast({ title: 'Saved', description: `${recipients.length} recipient${recipients.length === 1 ? '' : 's'} saved.` });
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
        },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast({ title: 'Sent', description: `Report emailed to ${recipients.length} recipient${recipients.length === 1 ? '' : 's'}.` });
      await persistSettings();
    } catch (e: any) {
      const msg = e?.message || String(e);
      toast({
        variant: 'destructive',
        title: 'Could not send email',
        description: msg.includes('not configured')
          ? 'Email provider not set up — add a RESEND_API_KEY secret to enable sending.'
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

          <div className="flex items-center justify-between rounded-xl border bg-muted/30 px-4 py-3">
            <div>
              <p className="text-sm font-medium">Weekly email</p>
              <p className="text-xs text-muted-foreground">Auto-send this report every Monday at 8 AM local time.</p>
            </div>
            <Switch checked={weeklyEnabled} onCheckedChange={setWeeklyEnabled} />
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
                  className="w-full h-[420px] border-0"
                />
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          <Button variant="outline" onClick={persistSettings} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Save recipients
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