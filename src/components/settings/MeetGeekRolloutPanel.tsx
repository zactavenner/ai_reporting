import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { dashboardAuthHeaders, normalizeDashboardError } from '@/lib/dashboardAuthHeaders';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Loader2, Rocket, ShieldAlert, ShieldCheck, CalendarSearch, Copy, Eye, EyeOff, Webhook, RefreshCw, Info } from 'lucide-react';

const BOT_GUEST_EMAIL = 'theainotetaker@gmail.com';

interface RolloutClient {
  client_id: string;
  client_name: string;
  client_status: string | null;
  calendar_mapped: boolean;
  calendar_name: string | null;
  calendars_covered?: number;
  booking_calendars?: { id: string; name: string }[];
  detection: string;
  bot_guest_email: string | null;
  enabled: boolean;
  blockers: string[];
}

interface RolloutPayload {
  applied: boolean;
  bot_guest_email: string;
  prerequisites: {
    invite_mode?: string;
    email_sender_configured?: boolean;
    email_sender_provider?: string | null;
    email_sender_from?: string | null;
    email_sender_detail?: string;
    gmail_setting_note?: string;
    google_calendar_required?: boolean;
    calendar_connection: boolean;
    calendar_connection_verified: boolean | null;
    webhook_secret_configured: boolean;
    webhook_optional?: boolean;
    polling_enabled?: boolean;
  };
  summary: { total: number; active: number; needs_attention: number; needs_calendar_selection: number };
  clients: RolloutClient[];
}

interface WebhookSetup {
  webhook_url: string;
  secret_header: string;
  secret: string | null;
  secret_configured: boolean;
  optional?: boolean;
  optional_note?: string;
  instructions: string[];
  locations: { client_id: string; client_name: string; client_status: string | null; ghl_location_id: string }[];
}

interface PollResult {
  totals: {
    appointments_found: number;
    jobs_enqueued: number;
    invited: number;
    pending: number;
    invites_sent?: number;
    invites_updated?: number;
    invites_cancelled?: number;
  };
  sender?: { configured: boolean; provider: string | null; from_email: string | null; detail: string };
  google_scan: { connections: number; events_scanned: number; invited: number };
}

async function invokeAdmin<T = any>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('meetgeek-guest-admin', {
    body,
    headers: dashboardAuthHeaders(),
  });
  if (error) throw await normalizeDashboardError(error);
  if ((data as any)?.error) throw new Error(String((data as any).error));
  return data as T;
}

function Check({ ok, label, optional }: { ok: boolean; label: string; optional?: boolean }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      {optional ? (
        <Info className="h-3.5 w-3.5 text-muted-foreground" />
      ) : ok ? (
        <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
      ) : (
        <ShieldAlert className="h-3.5 w-3.5 text-destructive" />
      )}
      <span className={optional ? 'text-muted-foreground' : ok ? '' : 'text-destructive'}>{label}</span>
    </div>
  );
}

export function MeetGeekRolloutPanel() {
  const queryClient = useQueryClient();
  const [result, setResult] = useState<RolloutPayload | null>(null);
  const [showSecret, setShowSecret] = useState(false);

  const status = useQuery({
    queryKey: ['gc-rollout-status'],
    queryFn: () => invokeAdmin<RolloutPayload>({ action: 'gc_rollout_status', bot_guest_email: BOT_GUEST_EMAIL }),
  });

  const setup = useQuery({
    queryKey: ['gc-webhook-setup'],
    queryFn: () => invokeAdmin<WebhookSetup>({ action: 'gc_webhook_setup' }),
  });

  const copy = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label} copied`);
    } catch {
      toast.error('Copy failed — select the value manually');
    }
  };

  const rollout = useMutation({
    mutationFn: () => invokeAdmin<RolloutPayload>({ action: 'gc_bulk_rollout', bot_guest_email: BOT_GUEST_EMAIL }),
    onSuccess: (data) => {
      setResult(data);
      toast.success(`${data.summary.active} of ${data.summary.total} clients fully active`);
      queryClient.invalidateQueries({ queryKey: ['gc-rollout-status'] });
      queryClient.invalidateQueries({ queryKey: ['gc-guest-config'] });
      queryClient.invalidateQueries({ queryKey: ['meetgeek-client-config'] });
    },
    onError: (e: any) => toast.error(e?.message || 'Rollout failed'),
  });

  const poll = useMutation({
    mutationFn: () => invokeAdmin<PollResult>({ action: 'gc_run_poll' }),
    onSuccess: (data) => {
      toast.success(
        `Polled ${data.totals.appointments_found} upcoming appointments — ${data.totals.jobs_enqueued} new jobs, ` +
          `${data.totals.invites_sent ?? 0} invites emailed, ${data.totals.invites_updated ?? 0} updated, ` +
          `${data.totals.invites_cancelled ?? 0} cancelled, ${data.totals.pending} pending`,
      );
      queryClient.invalidateQueries({ queryKey: ['gc-rollout-status'] });
    },
    onError: (e: any) => toast.error(e?.message || 'Poll failed'),
  });

  const view = result || status.data || null;
  const prereq = view?.prerequisites;
  const prereqOk = prereq?.email_sender_configured !== false;

  return (
    <div className="border-2 border-border p-4 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h4 className="font-medium mb-1 flex items-center gap-2">
            <Rocket className="h-4 w-4" />
            Agency-wide notetaker rollout
          </h4>
          <p className="text-sm text-muted-foreground">
            Adds <code className="font-mono">{BOT_GUEST_EMAIL}</code> as a calendar guest on every new booked video
            meeting, keeps the join policy on all video calls, and auto-maps each client’s primary booking calendar
            where it can be determined.
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Bookings are detected by a poller that runs every 10 minutes and the notetaker is invited by email with a
            standard calendar invite — no Google Calendar connection and no per-location GHL workflow are required.
            Reschedules re-send an updated invite and cancellations withdraw it automatically.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => poll.mutate()} disabled={poll.isPending}>
            {poll.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
            Run poller now
          </Button>
          <Button onClick={() => rollout.mutate()} disabled={rollout.isPending}>
            {rollout.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Rocket className="h-4 w-4 mr-2" />}
            Roll out to all clients
          </Button>
        </div>
      </div>

      {status.error ? (
        <p className="text-xs text-destructive border border-destructive/40 bg-destructive/5 p-2 rounded">
          {(status.error as Error).message}
        </p>
      ) : null}

      {setup.data ? (
        <div className="border border-border/70 p-3 space-y-2">
          <Label className="text-xs flex items-center gap-2">
            <Webhook className="h-3.5 w-3.5" />
            GHL appointment webhook — optional real-time boost
          </Label>
          <p className="text-[11px] text-muted-foreground">
            {setup.data.optional_note ||
              'Optional. Polling already catches every booking within 10 minutes; installing this workflow only makes the invite instant.'}
          </p>
          <div className="space-y-1.5 text-xs">
            <div className="flex items-center gap-2">
              <span className="w-24 shrink-0 text-muted-foreground">URL</span>
              <code className="font-mono truncate flex-1">{setup.data.webhook_url}</code>
              <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => copy(setup.data!.webhook_url, 'Webhook URL')}>
                <Copy className="h-3 w-3" />
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-24 shrink-0 text-muted-foreground">Header</span>
              <code className="font-mono truncate flex-1">{setup.data.secret_header}</code>
              <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => copy(setup.data!.secret_header, 'Header name')}>
                <Copy className="h-3 w-3" />
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-24 shrink-0 text-muted-foreground">Secret</span>
              <code className="font-mono truncate flex-1">
                {setup.data.secret
                  ? showSecret
                    ? setup.data.secret
                    : `${setup.data.secret.slice(0, 4)}${'•'.repeat(24)}${setup.data.secret.slice(-4)}`
                  : 'stored as an environment secret (not readable here)'}
              </code>
              {setup.data.secret ? (
                <>
                  <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setShowSecret((v) => !v)}>
                    {showSecret ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                  </Button>
                  <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => copy(setup.data!.secret!, 'Shared secret')}>
                    <Copy className="h-3 w-3" />
                  </Button>
                </>
              ) : null}
            </div>
          </div>
          <ol className="list-decimal pl-5 space-y-0.5 text-[11px] text-muted-foreground">
            {setup.data.instructions.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          <p className="text-[11px] text-muted-foreground">
            {setup.data.locations.length} client locations are mapped and ready for this workflow.
          </p>
        </div>
      ) : null}

      <div className="space-y-1">
        <Label className="text-xs">Setup prerequisites</Label>
        <Check
          ok={!!prereq?.email_sender_configured}
          label={
            prereq?.email_sender_configured
              ? `Invite sender configured — ${prereq?.email_sender_provider} (${prereq?.email_sender_from})`
              : prereq?.email_sender_detail || 'Configure an email sender for the calendar invites'
          }
        />
        <Check
          ok={false}
          optional
          label={
            prereq?.gmail_setting_note ||
            'One-time manual step in the notetaker mailbox: Gmail → Settings → General → Event settings → “Add invitations to my calendar” → From everyone.'
          }
        />
        <Check ok optional={false} label="Polling ingest active (every 10 minutes, CRM + Google calendar)" />
        <Check
          ok={!!prereq?.webhook_secret_configured}
          optional
          label={
            prereq?.webhook_secret_configured
              ? 'Optional: appointment webhook shared secret configured (real-time boost)'
              : 'Optional: no webhook shared secret — polling still covers every booking'
          }
        />
        <Check
          ok={!!prereq?.calendar_connection}
          optional
          label={
            prereq?.calendar_connection
              ? 'Optional: organizer Google Calendar connected (legacy guest-patch path)'
              : 'Optional: no Google Calendar connection needed — the email invite path is used'
          }
        />
        {!prereqOk && (
          <div className="border border-border p-3 space-y-2 text-[11px] text-muted-foreground">
            <p className="text-xs font-medium text-foreground">
              Add ONE of these in Project Settings → Secrets — invites send automatically within 10 minutes after that.
            </p>
            <div className="space-y-1">
              <p className="font-medium text-foreground">Option A — Resend (recommended)</p>
              <p>
                Add <code>RESEND_API_KEY</code> and <code>SHADOW_INVITE_FROM</code>. The from-address must be on a domain
                verified in Resend (e.g. <code>notetaker@highperformanceads.com</code> — verify{' '}
                <code>highperformanceads.com</code> in Resend → Domains). Never expires.
              </p>
            </div>
            <div className="space-y-1">
              <p className="font-medium text-foreground">Option B — Plain SMTP (no OAuth, no domain verification)</p>
              <p>
                Add <code>SMTP_HOST</code> = <code>smtp.gmail.com</code>, <code>SMTP_PORT</code> = <code>587</code>,{' '}
                <code>SMTP_USER</code> = <code>theainotetaker@gmail.com</code>, <code>SMTP_PASSWORD</code> = a Google
                app password for that mailbox (Google Account → Security → App passwords). Optionally{' '}
                <code>SHADOW_INVITE_FROM</code> to override the from-address. App passwords do not expire.
              </p>
            </div>
            <p>
              Everything else is already automated — queued invites stay queued and flush on the next poll, nothing is
              lost.
            </p>
          </div>
        )}
        <p className="text-[11px] text-muted-foreground">
          Reminder: invites only auto-land on the notetaker's calendar after the one-time Gmail setting in{' '}
          <strong>theainotetaker@gmail.com</strong> → Settings → General → Event settings →{' '}
          <em>Add invitations to my calendar</em> → <strong>From everyone</strong>.
        </p>
        <p className="text-[11px] text-muted-foreground">
          Note on the Gmail OAuth connect option: if the Google consent screen is in Testing mode, refresh tokens expire
          every 7 days and sending dies silently. Use Resend or SMTP for production sending; treat Gmail OAuth as a
          non-blocking fallback only.
        </p>
      </div>

      {view ? (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {[
              { label: 'Clients', value: view.summary.total },
              { label: 'Fully active', value: view.summary.active },
              { label: 'Needs attention', value: view.summary.needs_attention },
              { label: 'No calendars found', value: view.summary.needs_calendar_selection },
            ].map((s) => (
              <div key={s.label} className="border border-border p-2">
                <div className="text-lg font-semibold">{s.value}</div>
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{s.label}</div>
              </div>
            ))}
          </div>

          <div className="space-y-1 max-h-72 overflow-auto">
            {view.clients.map((c) => (
              <div key={c.client_id} className="flex items-start justify-between gap-2 border border-border/60 px-2 py-1.5 text-xs">
                <div className="min-w-0">
                  <div className="truncate font-medium">{c.client_name}</div>
                  {c.blockers.length ? (
                    <div className="text-destructive">{c.blockers.join(' · ')}</div>
                  ) : (
                    <div className="text-muted-foreground truncate">
                      {c.calendars_covered
                        ? `${c.calendars_covered} booking calendar${c.calendars_covered === 1 ? '' : 's'} covered`
                        : c.calendar_name || 'Mapped calendar'}{' '}
                      · {c.bot_guest_email}
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {!c.calendar_mapped && (
                    <Badge variant="outline" className="gap-1">
                      <CalendarSearch className="h-3 w-3" />
                      Needs calendar
                    </Badge>
                  )}
                  <Badge variant={c.enabled ? 'default' : 'outline'}>{c.enabled ? 'Active' : 'Disabled'}</Badge>
                </div>
              </div>
            ))}
          </div>
        </>
      ) : (
        <p className="text-xs text-muted-foreground">
          {status.isLoading ? 'Loading rollout status…' : 'No rollout status available yet.'}
        </p>
      )}
    </div>
  );
}