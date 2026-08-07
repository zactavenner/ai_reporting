import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, ShieldAlert, ShieldCheck, UserPlus, Link2, RefreshCw } from 'lucide-react';

interface Props {
  clientId: string;
  /** CRM calendar selected in the section above — the guest config must match it. */
  ghlCalendarId: string | null;
}

interface RedactedConnection {
  id: string;
  organizer_email: string;
  display_name: string | null;
  status: string;
  scope_summary: string;
  token_present: boolean;
  last_verified_at: string | null;
  last_error: string | null;
}

async function invokeGuestAdmin<T = any>(body: Record<string, unknown>): Promise<T> {
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

function ts(value?: string | null) {
  return value ? new Date(value).toLocaleString() : '—';
}

export function MeetGeekGuestCalendarPanel({ clientId, ghlCalendarId }: Props) {
  const queryClient = useQueryClient();
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [organizerCalendarId, setOrganizerCalendarId] = useState<string | null>(null);
  const [botEmail, setBotEmail] = useState<string | null>(null);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [connecting, setConnecting] = useState(false);

  const connections = useQuery({
    queryKey: ['gc-connections'],
    queryFn: () => invokeGuestAdmin<{ connections: RedactedConnection[] }>({ action: 'gc_list_connections' }),
  });

  const guest = useQuery({
    queryKey: ['gc-guest-config', clientId],
    queryFn: () =>
      invokeGuestAdmin<{
        config: Record<string, any> | null;
        location_mapped: boolean;
        webhook_secret_configured: boolean;
        jobs: Record<string, any>[];
      }>({ action: 'gc_get_guest_config', client_id: clientId }),
  });

  const cfg = guest.data?.config || null;
  const effConnection = connectionId ?? cfg?.calendar_connection_id ?? null;
  const effOrganizerCal = organizerCalendarId ?? cfg?.organizer_calendar_id ?? 'primary';
  const effBotEmail = botEmail ?? cfg?.bot_guest_email ?? '';
  const effEnabled = enabled ?? !!cfg?.enabled;

  const startConnect = async () => {
    setConnecting(true);
    try {
      const data = await invokeGuestAdminStart();
      window.open(data.auth_url, 'google-calendar-oauth', 'width=520,height=680');
      toast.info('Complete the Google Calendar authorization in the new window.');
    } catch (e: any) {
      toast.error(e?.message || 'Could not start the calendar connection');
    } finally {
      setConnecting(false);
    }
  };

  const invokeGuestAdminStart = async () => {
    const { data, error } = await supabase.functions.invoke('google-calendar-oauth-start', { body: {} });
    if (error) throw new Error(error.message);
    if ((data as any)?.error) throw new Error(String((data as any).error));
    return data as { auth_url: string };
  };

  const save = useMutation({
    mutationFn: () =>
      invokeGuestAdmin<{ success: boolean; enabled: boolean; blockers: string[]; note?: string }>({
        action: 'gc_save_guest_config',
        client_id: clientId,
        calendar_connection_id: effConnection,
        organizer_calendar_id: effOrganizerCal,
        bot_guest_email: effBotEmail,
        ghl_calendar_id: ghlCalendarId,
        enabled: effEnabled,
      }),
    onSuccess: (data) => {
      if (data.enabled) toast.success('Guest invites enabled for this client');
      else toast.warning(data.note || `Saved and kept disabled: ${data.blockers.join('; ')}`);
      queryClient.invalidateQueries({ queryKey: ['gc-guest-config', clientId] });
    },
    onError: (e: any) => toast.error(e?.message || 'Could not save guest configuration'),
  });

  const verify = useMutation({
    mutationFn: (id: string) => invokeGuestAdmin<{ ok: boolean; error?: string }>({ action: 'gc_verify_connection', connection_id: id }),
    onSuccess: (data) => {
      if (data.ok) toast.success('Calendar connection verified');
      else toast.error(data.error || 'Verification failed');
      queryClient.invalidateQueries({ queryKey: ['gc-connections'] });
    },
  });

  const list = connections.data?.connections || [];

  return (
    <div className="border-2 border-border p-4 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="font-medium mb-1 flex items-center gap-2">
            <UserPlus className="h-4 w-4" />
            Notetaker as calendar guest
          </h4>
          <p className="text-sm text-muted-foreground">
            The notetaker account is only ever added as an attendee on the organizer’s own Google event. It is never an
            event owner, appointment owner, assigned user or linked CRM calendar.
          </p>
        </div>
        <Switch
          checked={effEnabled}
          onCheckedChange={setEnabled}
          disabled={!guest.data?.location_mapped}
        />
      </div>

      {guest.error ? (
        <p className="text-xs text-destructive border border-destructive/40 bg-destructive/5 p-2 rounded">
          {(guest.error as Error).message}
        </p>
      ) : null}

      <div className="space-y-2">
        <Label>Organizer Google Calendar connection</Label>
        <div className="flex flex-wrap gap-2">
          <Select value={effConnection ?? undefined} onValueChange={setConnectionId}>
            <SelectTrigger className="min-w-[240px] flex-1">
              <SelectValue placeholder={list.length ? 'Select a connected organizer' : 'No calendar connected yet'} />
            </SelectTrigger>
            <SelectContent>
              {list.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.organizer_email} · {c.status}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={startConnect} disabled={connecting}>
            {connecting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Link2 className="h-4 w-4 mr-2" />}
            Connect calendar
          </Button>
          <Button
            variant="ghost"
            disabled={!effConnection || verify.isPending}
            onClick={() => effConnection && verify.mutate(effConnection)}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${verify.isPending ? 'animate-spin' : ''}`} />
            Verify
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Least-privilege calendar-events access only. Tokens stay server-side — this screen only ever shows the account
          email and status.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>Organizer calendar id</Label>
          <Input
            value={effOrganizerCal}
            onChange={(e) => setOrganizerCalendarId(e.target.value)}
            placeholder="primary"
          />
        </div>
        <div className="space-y-2">
          <Label>Notetaker guest email</Label>
          <Input
            value={effBotEmail}
            onChange={(e) => setBotEmail(e.target.value)}
            placeholder="notetaker@…"
            autoComplete="off"
          />
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 text-xs">
        <div className="flex items-center gap-2">
          {cfg?.validation_status === 'validated'
            ? <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
            : <ShieldAlert className="h-3.5 w-3.5 text-amber-600" />}
          <span>{cfg?.validation_status === 'validated' ? 'Mapping validated' : cfg?.validation_status || 'Unvalidated'}</span>
        </div>
        <div className="flex items-center gap-2">
          {guest.data?.webhook_secret_configured
            ? <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
            : <ShieldAlert className="h-3.5 w-3.5 text-destructive" />}
          <span>{guest.data?.webhook_secret_configured ? 'Webhook signing secret configured' : 'Webhook signing secret missing'}</span>
        </div>
        <div className="text-muted-foreground">Last guest invite: {ts(cfg?.last_invite_at)}</div>
        <div className="text-muted-foreground">Last validated: {ts(cfg?.last_validated_at)}</div>
      </div>

      {(cfg?.validation_error || cfg?.last_error) && (
        <p className="text-xs text-destructive">{cfg?.validation_error || cfg?.last_error}</p>
      )}

      <Button variant="outline" onClick={() => save.mutate()} disabled={save.isPending}>
        {save.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
        Save guest configuration
      </Button>

      <div className="space-y-2 pt-2">
        <div className="flex items-center justify-between">
          <Label>Guest invite jobs</Label>
          <Badge variant="outline">Audit trail</Badge>
        </div>
        <div className="space-y-1 max-h-56 overflow-auto">
          {(guest.data?.jobs || []).length === 0 ? (
            <p className="text-xs text-muted-foreground">No invite attempts yet.</p>
          ) : (
            (guest.data?.jobs || []).map((j) => (
              <div key={j.id} className="flex items-center justify-between gap-2 text-xs border border-border/60 px-2 py-1.5 rounded">
                <span className="truncate">{ts(j.scheduled_start)} · {j.ghl_appointment_id}</span>
                <span className="flex items-center gap-2">
                  {j.rejection_reason || j.error_message ? (
                    <span className="text-destructive truncate max-w-[180px]">{j.rejection_reason || j.error_message}</span>
                  ) : null}
                  <Badge variant={j.status === 'invited' ? 'default' : 'outline'}>{j.status}</Badge>
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}