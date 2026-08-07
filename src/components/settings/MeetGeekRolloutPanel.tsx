import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Loader2, Rocket, ShieldAlert, ShieldCheck, CalendarSearch } from 'lucide-react';

const BOT_GUEST_EMAIL = 'theainotetaker@gmail.com';

interface RolloutClient {
  client_id: string;
  client_name: string;
  client_status: string | null;
  calendar_mapped: boolean;
  calendar_name: string | null;
  detection: string;
  bot_guest_email: string | null;
  enabled: boolean;
  blockers: string[];
}

interface RolloutPayload {
  applied: boolean;
  bot_guest_email: string;
  prerequisites: {
    calendar_connection: boolean;
    calendar_connection_verified: boolean | null;
    webhook_secret_configured: boolean;
  };
  summary: { total: number; active: number; needs_attention: number; needs_calendar_selection: number };
  clients: RolloutClient[];
}

async function invokeAdmin<T = any>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('meetgeek-guest-admin', { body });
  if (error) {
    let message = error.message;
    try {
      const payload = await (error as any).context?.json?.();
      if (payload?.error) message = String(payload.error);
    } catch { /* keep original */ }
    throw new Error(message);
  }
  if ((data as any)?.error) throw new Error(String((data as any).error));
  return data as T;
}

function Check({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      {ok ? (
        <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
      ) : (
        <ShieldAlert className="h-3.5 w-3.5 text-destructive" />
      )}
      <span className={ok ? '' : 'text-destructive'}>{label}</span>
    </div>
  );
}

export function MeetGeekRolloutPanel() {
  const queryClient = useQueryClient();
  const [result, setResult] = useState<RolloutPayload | null>(null);

  const status = useQuery({
    queryKey: ['gc-rollout-status'],
    queryFn: () => invokeAdmin<RolloutPayload>({ action: 'gc_rollout_status', bot_guest_email: BOT_GUEST_EMAIL }),
  });

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

  const view = result || status.data || null;
  const prereq = view?.prerequisites;
  const prereqOk = !!prereq?.calendar_connection && !!prereq?.webhook_secret_configured;

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
        </div>
        <Button onClick={() => rollout.mutate()} disabled={rollout.isPending}>
          {rollout.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Rocket className="h-4 w-4 mr-2" />}
          Roll out to all clients
        </Button>
      </div>

      {status.error ? (
        <p className="text-xs text-destructive border border-destructive/40 bg-destructive/5 p-2 rounded">
          {(status.error as Error).message}
        </p>
      ) : null}

      <div className="space-y-1">
        <Label className="text-xs">Setup prerequisites</Label>
        <Check
          ok={!!prereq?.calendar_connection}
          label={
            prereq?.calendar_connection
              ? 'Organizer Google Calendar connected'
              : 'Connect the organizer Google Calendar (per-client panel → Connect calendar)'
          }
        />
        <Check
          ok={!!prereq?.webhook_secret_configured}
          label={
            prereq?.webhook_secret_configured
              ? 'Appointment webhook shared secret configured'
              : 'Missing GHL_APPOINTMENT_WEBHOOK_SECRET (32+ chars) — add it in Project Settings → Secrets'
          }
        />
        {!prereqOk && (
          <p className="text-xs text-muted-foreground">
            The rollout still runs and enables everything it can — clients stay disabled until each blocker clears.
          </p>
        )}
      </div>

      {view ? (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {[
              { label: 'Clients', value: view.summary.total },
              { label: 'Fully active', value: view.summary.active },
              { label: 'Needs attention', value: view.summary.needs_attention },
              { label: 'Needs calendar', value: view.summary.needs_calendar_selection },
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
                      {c.calendar_name || 'Mapped calendar'} · {c.bot_guest_email}
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