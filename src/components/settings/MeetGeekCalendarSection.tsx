import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { invokeMeetgeek } from '@/lib/meetgeekInvoke';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CalendarCheck, Loader2, RefreshCw, ShieldCheck, ShieldAlert, FlaskConical } from 'lucide-react';
import { MeetingCallActivityList } from '@/components/meetings/MeetingCallActivityList';
import { MeetGeekGuestCalendarPanel } from '@/components/settings/MeetGeekGuestCalendarPanel';

interface Props {
  clientId: string;
}

const policyLabels: Record<string, string> = {
  never: 'Never join meetings',
  selected_calendar_video_only: 'Join video meetings on the selected calendar',
  all_video_on_calendar: 'Join every video meeting on the selected calendar',
};

function ts(value?: string | null) {
  return value ? new Date(value).toLocaleString() : '—';
}

export function MeetGeekCalendarSection({ clientId }: Props) {
  const queryClient = useQueryClient();
  const [calendarId, setCalendarId] = useState<string | null>(null);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [policy, setPolicy] = useState<string | null>(null);
  const [ingestMode, setIngestMode] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  const configQuery = useQuery({
    queryKey: ['meetgeek-client-config', clientId],
    queryFn: async () => {
      const data: any = await invokeMeetgeek({ action: 'mg_get_config', client_id: clientId });
      return data as {
        config: Record<string, any> | null;
        location_mapped: boolean;
        webhook_secret_configured: boolean;
      };
    },
  });

  const calendarsQuery = useQuery({
    queryKey: ['meetgeek-ghl-calendars', clientId],
    queryFn: async () => {
      const data: any = await invokeMeetgeek({ action: 'mg_list_calendars', client_id: clientId });
      return data as { calendars: { id: string; name: string; isActive: boolean }[]; location_mapped: boolean; error?: string };
    },
  });

  const config = configQuery.data?.config || null;
  const effectiveCalendar = calendarId ?? config?.ghl_calendar_id ?? null;
  const effectiveEnabled = enabled ?? !!config?.enabled;
  const effectivePolicy = policy ?? config?.bot_join_policy ?? 'selected_calendar_video_only';
  const effectiveMode = ingestMode ?? config?.ingest_mode ?? 'selected_calendar';

  const save = useMutation({
    mutationFn: async () => {
      const data: any = await invokeMeetgeek({
          action: 'mg_save_config',
          client_id: clientId,
          enabled: effectiveEnabled,
          ghl_calendar_id: effectiveCalendar,
          bot_join_policy: effectivePolicy,
          ingest_mode: effectiveMode,
        });
      return data as { success: boolean; error?: string };
    },
    onSuccess: (data) => {
      if (data?.success) toast.success('MeetGeek calendar configuration saved');
      else toast.error(data?.error || 'Configuration saved but the mapping is invalid');
      queryClient.invalidateQueries({ queryKey: ['meetgeek-client-config', clientId] });
    },
    onError: (e: any) => toast.error(e?.message || 'Failed to save MeetGeek calendar configuration'),
  });

  const runTest = async (mode: 'match' | 'wrong_calendar') => {
    setTesting(true);
    try {
      const data: any = await invokeMeetgeek({ action: 'mg_test_event', client_id: clientId, mode });
      if (!data?.ok) {
        toast.error(data?.error || 'Test event failed');
      } else {
        toast.success(
          `Test event ingested (${data.gate})${data.isolation_ok ? ' · client isolation verified' : ''}`,
        );
      }
      queryClient.invalidateQueries({ queryKey: ['meeting-call-activity', clientId] });
      queryClient.invalidateQueries({ queryKey: ['meetgeek-client-config', clientId] });
    } catch {
      toast.error('Test event failed');
    } finally {
      setTesting(false);
    }
  };

  const mappingValid = !!config?.mapping_valid;
  const locationMapped = configQuery.data?.location_mapped ?? false;

  return (
    <div className="border-2 border-border p-4 space-y-4">
      {configQuery.error ? (
        <p className="text-xs text-destructive border border-destructive/40 bg-destructive/5 p-2 rounded">
          {(configQuery.error as Error).message}
        </p>
      ) : null}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="font-medium mb-1 flex items-center gap-2">
            <CalendarCheck className="h-4 w-4" />
            Calendar-scoped meeting ingestion
          </h4>
          <p className="text-sm text-muted-foreground">
            MeetGeek may only join and ingest video meetings booked on the calendar you select here.
          </p>
        </div>
        <Switch
          checked={effectiveEnabled}
          onCheckedChange={setEnabled}
          disabled={!locationMapped}
        />
      </div>

      {!locationMapped && (
        <p className="text-xs text-destructive">
          This client has no mapped CRM location or API key yet — add them above before enabling ingestion.
        </p>
      )}

      <div className="space-y-2">
        <Label>Calendar</Label>
        <Select value={effectiveCalendar ?? undefined} onValueChange={setCalendarId} disabled={!locationMapped}>
          <SelectTrigger>
            <SelectValue placeholder={calendarsQuery.isLoading ? 'Loading calendars…' : 'Select a calendar'} />
          </SelectTrigger>
          <SelectContent>
            {(calendarsQuery.data?.calendars || []).map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}{c.isActive ? '' : ' (inactive)'}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {calendarsQuery.data?.error && (
          <p className="text-xs text-destructive">{calendarsQuery.data.error}</p>
        )}
        <p className="text-xs text-muted-foreground">
          Sourced live from this client’s mapped CRM location. Bookings on any other calendar are rejected.
        </p>
        {!effectiveCalendar && (
          <p className="text-xs text-amber-600 border border-amber-500/40 bg-amber-500/5 p-2 rounded">
            Needs calendar selection — the primary booking calendar could not be determined automatically. Pick one above
            to activate the notetaker for this client.
          </p>
        )}
      </div>

      <div className="space-y-2">
        <Label>Ingestion scope</Label>
        <Select value={effectiveMode} onValueChange={setIngestMode} disabled={!locationMapped}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="selected_calendar">Only the selected calendar (recommended)</SelectItem>
            <SelectItem value="all_mapped_calendars">Any calendar in this client’s mapped location</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label>Bot join policy</Label>
        <Select value={effectivePolicy} onValueChange={setPolicy} disabled={!locationMapped}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {Object.entries(policyLabels).map(([value, label]) => (
              <SelectItem key={value} value={value}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 text-xs">
        <div className="flex items-center gap-2">
          {mappingValid
            ? <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
            : <ShieldAlert className="h-3.5 w-3.5 text-amber-600" />}
          <span>{mappingValid ? 'Mapping validated' : 'Mapping not validated'}</span>
        </div>
        <div className="flex items-center gap-2">
          {configQuery.data?.webhook_secret_configured
            ? <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
            : <ShieldAlert className="h-3.5 w-3.5 text-destructive" />}
          <span>
            {configQuery.data?.webhook_secret_configured ? 'Webhook secret configured' : 'Webhook secret missing'}
          </span>
        </div>
        <div className="text-muted-foreground">Last event received: {ts(config?.last_event_at)}</div>
        <div className="text-muted-foreground">Last bot join: {ts(config?.last_bot_join_at)}</div>
        <div className="text-muted-foreground">Last completed meeting: {ts(config?.last_completed_meeting_at)}</div>
        <div className="text-muted-foreground">Last CRM sync: {ts(config?.last_crm_sync_at)}</div>
      </div>

      {(config?.mapping_error || config?.last_error) && (
        <p className="text-xs text-destructive">
          {config?.mapping_error || `${config?.last_error} (${ts(config?.last_error_at)})`}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => save.mutate()} disabled={save.isPending || !locationMapped}>
          {save.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
          Save calendar configuration
        </Button>
        <Button variant="ghost" onClick={() => calendarsQuery.refetch()} disabled={calendarsQuery.isFetching}>
          <RefreshCw className={`h-4 w-4 mr-2 ${calendarsQuery.isFetching ? 'animate-spin' : ''}`} />
          Refresh calendars
        </Button>
        <Button variant="secondary" onClick={() => runTest('match')} disabled={testing || !mappingValid}>
          {testing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <FlaskConical className="h-4 w-4 mr-2" />}
          Run test event
        </Button>
        <Button variant="ghost" onClick={() => runTest('wrong_calendar')} disabled={testing || !mappingValid}>
          Test rejection path
        </Button>
      </div>

      <div className="space-y-2 pt-2">
        <div className="flex items-center justify-between">
          <Label>Call activity</Label>
          <Badge variant="outline">Client-scoped</Badge>
        </div>
        <MeetingCallActivityList clientId={clientId} />
      </div>

      <MeetGeekGuestCalendarPanel clientId={clientId} ghlCalendarId={effectiveCalendar} />
    </div>
  );
}
