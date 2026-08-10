import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { dashboardAuthHeaders } from '@/lib/dashboardAuthHeaders';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  AlertTriangle, CalendarClock, CheckCircle2, Link2Off, Loader2, RefreshCw, Sparkles, UserCheck, UserX, Video,
} from 'lucide-react';
import { format, subDays } from 'date-fns';
import { toast } from 'sonner';
import { DateRangePresetPicker } from '@/components/shared/DateRangePresetPicker';
import { useClients } from '@/hooks/useClients';

interface UpcomingRow {
  id: string;
  client_id: string | null;
  client_name: string;
  status: string;
  error_code: string | null;
  error_message: string | null;
  scheduled_start: string | null;
  meeting_url: string | null;
  invite_summary: string | null;
  ghl_calendar_name: string | null;
  contact_name: string | null;
  assigned_user_name: string | null;
  invite_provider: string | null;
  invite_send_count: number | null;
  attendance_status?: string | null;
  ghl_appointment_status?: string | null;
}

interface PastRow {
  id: string;
  client_name: string;
  title: string | null;
  started_at: string | null;
  duration_minutes: number | null;
  summary: string | null;
  action_items?: unknown;
  source?: string | null;
  recording_url: string | null;
  contact_name: string | null;
  sales_agent_name: string | null;
  ghl_calendar_name: string | null;
  qa_total: number | null;
  qa_gate_status: string | null;
  qa_pipeline_outcome: string | null;
  crm_sync_status: string | null;
  crm_sync_error: string | null;
}

interface MissedRow extends UpcomingRow {
  capture_reason: string;
}

interface AttendanceRollup {
  showed: number;
  noshow: number;
  cancelled: number;
  awaiting: number;
  total: number;
  show_rate: number | null;
}

interface Overview {
  generated_at: string;
  range?: { start_date: string; end_date: string } | null;
  kpis: {
    past_completed: number; today: number; upcoming: number; invited: number; pending: number;
    no_meeting_link: number; not_captured?: number; showed?: number; noshow?: number; show_rate?: number | null;
  };
  attendance?: AttendanceRollup & {
    window: { from: string; to: string };
    last_checked_at: string | null;
    by_client: (AttendanceRollup & { client_id: string; client_name: string })[];
  };
  upcoming: UpcomingRow[];
  past: PastRow[];
  missed?: MissedRow[];
  health: {
    job_status: Record<string, number>;
    pending_reasons: Record<string, number>;
    enabled_clients: number;
    last_invite_sent_at: string | null;
    sender: { configured: boolean; provider: string | null; from_email: string | null; detail: string | null };
  };
}

/** Viewer-local timezone, shown explicitly so meeting times are never ambiguous. */
const VIEWER_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
const TZ_ABBR = (() => {
  const parts = new Intl.DateTimeFormat('en-US', { timeZoneName: 'short' }).formatToParts(new Date());
  return parts.find((p) => p.type === 'timeZoneName')?.value || VIEWER_TZ;
})();

const when = (iso: string | null) => (iso ? `${format(new Date(iso), 'MMM d, h:mm a')} ${TZ_ABBR}` : '—');

function InviteBadge({ row }: { row: UpcomingRow }) {
  if (row.status === 'invited') {
    return <Badge className="bg-emerald-500/15 text-emerald-600 border-emerald-500/30">Notetaker invited</Badge>;
  }
  if (row.error_code === 'no_meeting_link') {
    return <Badge variant="outline" className="text-amber-600 border-amber-500/40">No join link</Badge>;
  }
  if (row.error_code === 'no_email_sender') {
    return <Badge variant="outline" className="text-destructive border-destructive/40">Sender not configured</Badge>;
  }
  return <Badge variant="outline">{row.status}</Badge>;
}

function ScoreBadge({ total, gate }: { total: number | null; gate: string | null }) {
  return <ScoreBadgeInner total={total} gate={gate} />;
}

/** CRM-owned outcome for a booked slot: showed, no-show, cancelled or pending. */
function AttendanceBadge({ status }: { status?: string | null }) {
  const s = String(status || '').toLowerCase();
  if (s === 'showed') return <Badge className="bg-emerald-500/15 text-emerald-600 border-emerald-500/30">Showed</Badge>;
  if (s === 'noshow') return <Badge className="bg-destructive/15 text-destructive border-destructive/30">No-show</Badge>;
  if (s === 'cancelled') return <Badge variant="outline" className="text-muted-foreground">Cancelled</Badge>;
  if (s === 'confirmed') return <Badge variant="outline" className="text-primary border-primary/40">Confirmed</Badge>;
  return <Badge variant="outline" className="text-muted-foreground">Attendance pending</Badge>;
}

function ScoreBadgeInner({ total, gate }: { total: number | null; gate: string | null }) {
  if (total == null) return <span className="text-xs text-muted-foreground">Not scored</span>;
  const tone = total >= 80 ? 'bg-emerald-500/15 text-emerald-600 border-emerald-500/30'
    : total >= 60 ? 'bg-amber-500/15 text-amber-600 border-amber-500/30'
    : 'bg-destructive/15 text-destructive border-destructive/30';
  return <Badge className={tone}>{total}/100{gate ? ` · ${gate}` : ''}</Badge>;
}

function CrmBadge({ status }: { status: string | null }) {
  const s = (status || 'unmatched').toLowerCase();
  if (s === 'synced' || s === 'linked') {
    return <Badge className="bg-primary/15 text-primary border-primary/30">CRM {s}</Badge>;
  }
  if (s === 'failed' || s === 'error') return <Badge variant="destructive">CRM failed</Badge>;
  return <Badge variant="outline" className="text-muted-foreground">CRM {s}</Badge>;
}

function Kpi({ icon: Icon, label, value, hint, tone }: {
  icon: any; label: string; value: number | string; hint?: string; tone?: 'warn' | 'ok';
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
        <Icon className={`h-3.5 w-3.5 ${tone === 'warn' ? 'text-amber-500' : tone === 'ok' ? 'text-emerald-500' : 'text-primary'}`} />
        {label}
      </div>
      <div className="mt-2 text-2xl font-bold tabular-nums">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
    </Card>
  );
}

export function AIMeetingsTab() {
  const [clientId, setClientId] = useState<string>('all');
  const { data: clients = [] } = useClients();

  const { data, isLoading, isFetching, refetch, error } = useQuery<Overview>({
    queryKey: ['ai-meetings-overview', clientId],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('meetgeek-guest-admin', {
        body: { action: 'ai_meetings_overview', client_id: clientId === 'all' ? null : clientId },
        headers: dashboardAuthHeaders(),
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error(String((data as any).error));
      return data as Overview;
    },
    refetchInterval: 120000,
  });

  const noLink = useMemo(() => (data?.upcoming || []).filter((r) => r.error_code === 'no_meeting_link'), [data]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" /> AI Meetings
          </h2>
          <p className="text-sm text-muted-foreground">
            Every upcoming and completed AI-notetaker meeting, with lead quality scoring and CRM sync status.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={clientId} onValueChange={setClientId}>
            <SelectTrigger className="w-56"><SelectValue placeholder="All clients" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All clients</SelectItem>
              {clients.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? 'animate-spin' : ''}`} /> Refresh
          </Button>
        </div>
      </div>

      {error && (
        <Card className="p-4 border-destructive/40 text-sm text-destructive">
          Failed to load AI meetings: {(error as Error).message}
        </Card>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Kpi icon={CheckCircle2} label="Past completed" value={data?.kpis.past_completed ?? '—'} tone="ok" hint="Recorded & transcribed" />
        <Kpi icon={CalendarClock} label="Today" value={data?.kpis.today ?? '—'} hint="Scheduled today" />
        <Kpi icon={Video} label="Upcoming" value={data?.kpis.upcoming ?? '—'} hint="Next 14 days" />
        <Kpi icon={CheckCircle2} label="Notetaker invited" value={data?.kpis.invited ?? '—'} tone="ok" />
        <Kpi icon={Link2Off} label="No join link" value={data?.kpis.no_meeting_link ?? '—'} tone="warn" hint="Nothing to join" />
      </div>

      <p className="text-xs text-muted-foreground">
        All times shown in your timezone ({VIEWER_TZ} · {TZ_ABBR}).
      </p>

      {noLink.length > 0 && (
        <Card className="p-4 border-amber-500/40 bg-amber-500/5">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5" />
            <div className="text-sm">
              <p className="font-semibold">Why “no meeting link”?</p>
              <p className="text-muted-foreground">
                {noLink.length} upcoming appointment{noLink.length === 1 ? '' : 's'} came from the CRM without any join URL —
                the booking calendar has no conferencing (Zoom/Meet) attached, or it’s a phone/in-person slot. The notetaker
                can only join a video URL, so these stay queued and are retried on every 10-minute poll. Fix at the source:
                add Zoom/Google Meet to that GHL calendar, or paste a room link into the appointment address.
              </p>
            </div>
          </div>
        </Card>
      )}

      <Tabs defaultValue="upcoming">
        <TabsList>
          <TabsTrigger value="upcoming">Upcoming ({data?.upcoming.length ?? 0})</TabsTrigger>
          <TabsTrigger value="past">Recorded ({data?.past.length ?? 0})</TabsTrigger>
          <TabsTrigger value="missed">Not captured ({data?.missed?.length ?? 0})</TabsTrigger>
          <TabsTrigger value="health">Integration health</TabsTrigger>
        </TabsList>

        <TabsContent value="upcoming" className="mt-4">
          <Card className="overflow-hidden">
            {isLoading ? (
              <div className="p-8 text-center text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin inline mr-2" />Loading…</div>
            ) : !data?.upcoming.length ? (
              <div className="p-8 text-center text-muted-foreground">No upcoming meetings detected.</div>
            ) : (
              <div className="divide-y divide-border">
                {data.upcoming.map((row) => (
                  <div key={row.id} className="p-4 flex flex-wrap items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium truncate">
                        {row.client_name}
                        <span className="text-muted-foreground font-normal"> · {row.ghl_calendar_name || row.invite_summary || 'Booking'}</span>
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        {when(row.scheduled_start)}
                        {row.contact_name ? ` · ${row.contact_name}` : ''}
                        {row.assigned_user_name ? ` · owner ${row.assigned_user_name}` : ''}
                      </div>
                      {row.error_message && row.status !== 'invited' && (
                        <div className="text-xs text-amber-600 mt-1">{row.error_message}</div>
                      )}
                    </div>
                    {row.meeting_url && (
                      <a href={row.meeting_url} target="_blank" rel="noreferrer" className="text-xs text-primary underline">Join link</a>
                    )}
                    <InviteBadge row={row} />
                  </div>
                ))}
              </div>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="past" className="mt-4">
          <Card className="overflow-hidden">
            {isLoading ? (
              <div className="p-8 text-center text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin inline mr-2" />Loading…</div>
            ) : !data?.past.length ? (
              <div className="p-8 text-center text-muted-foreground">
                No recorded meetings with notes yet. Notes appear here once the notetaker joins a call and MeetGeek returns
                its summary — check “Not captured” for calls that happened without a recording.
              </div>
            ) : (
              <div className="divide-y divide-border">
                {data.past.map((row) => (
                  <div key={row.id} className="p-4 space-y-2">
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="font-medium truncate">
                          {row.client_name}
                          <span className="text-muted-foreground font-normal"> · {row.title || row.ghl_calendar_name || 'Meeting'}</span>
                        </div>
                        <div className="text-xs text-muted-foreground truncate">
                          {when(row.started_at)}
                          {row.duration_minutes ? ` · ${row.duration_minutes} min` : ''}
                          {row.contact_name ? ` · ${row.contact_name}` : ''}
                          {row.sales_agent_name ? ` · ${row.sales_agent_name}` : ''}
                        </div>
                      </div>
                      <ScoreBadge total={row.qa_total} gate={row.qa_gate_status} />
                      <CrmBadge status={row.crm_sync_status} />
                      <Badge variant="outline" className="text-[10px]">
                        {row.source === 'meetgeek_sync' ? 'MeetGeek sync' : 'Notetaker'}
                      </Badge>
                      {row.recording_url && (
                        <a href={row.recording_url} target="_blank" rel="noreferrer" className="text-xs text-primary underline">Recording</a>
                      )}
                    </div>
                    {row.summary && (
                      <p className="text-xs text-muted-foreground line-clamp-3">{row.summary}</p>
                    )}
                    {Array.isArray(row.action_items) && row.action_items.length > 0 && (
                      <ul className="space-y-0.5">
                        {(row.action_items as any[]).slice(0, 4).map((it, i) => (
                          <li key={i} className="text-xs text-muted-foreground">
                            • {typeof it === 'string' ? it : it?.title || it?.text || JSON.stringify(it)}
                          </li>
                        ))}
                      </ul>
                    )}
                    {row.qa_pipeline_outcome && (
                      <div className="text-xs"><span className="text-muted-foreground">Outcome: </span>{row.qa_pipeline_outcome}</div>
                    )}
                    {row.crm_sync_error && <div className="text-xs text-destructive">CRM: {row.crm_sync_error}</div>}
                  </div>
                ))}
              </div>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="missed" className="mt-4">
          <Card className="overflow-hidden">
            {isLoading ? (
              <div className="p-8 text-center text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin inline mr-2" />Loading…</div>
            ) : !data?.missed?.length ? (
              <div className="p-8 text-center text-muted-foreground">Every past appointment produced a recording. 🎉</div>
            ) : (
              <div className="divide-y divide-border">
                {data.missed.map((row) => (
                  <div key={row.id} className="p-4 space-y-1">
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="font-medium truncate">
                          {row.client_name}
                          <span className="text-muted-foreground font-normal"> · {row.ghl_calendar_name || 'Booking'}</span>
                        </div>
                        <div className="text-xs text-muted-foreground truncate">
                          {when(row.scheduled_start)}
                          {row.contact_name ? ` · ${row.contact_name}` : ''}
                          {row.assigned_user_name ? ` · owner ${row.assigned_user_name}` : ''}
                        </div>
                      </div>
                      {row.status === 'invited' ? (
                        <Badge variant="outline" className="text-amber-600 border-amber-500/40">Invited · no transcript</Badge>
                      ) : (
                        <Badge variant="outline" className="text-muted-foreground">Never invited</Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">{row.capture_reason}</p>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="health" className="mt-4 space-y-3">
          <Card className="p-4 space-y-3">
            <div className="text-sm font-semibold">Invite pipeline</div>
            <div className="flex flex-wrap gap-2">
              {Object.entries(data?.health.job_status || {}).map(([k, v]) => (
                <Badge key={k} variant="outline" className="capitalize">{k}: {v}</Badge>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              {Object.entries(data?.health.pending_reasons || {}).map(([k, v]) => (
                <Badge key={k} variant="outline" className="text-amber-600 border-amber-500/40">{k.replace(/_/g, ' ')}: {v}</Badge>
              ))}
            </div>
            <div className="text-xs text-muted-foreground">
              Enabled clients: {data?.health.enabled_clients ?? '—'} · Last invite sent: {when(data?.health.last_invite_sent_at ?? null)}
            </div>
          </Card>
          <Card className="p-4 space-y-1">
            <div className="text-sm font-semibold">Invite sender</div>
            <div className="text-sm">
              {data?.health.sender.configured ? (
                <Badge className="bg-emerald-500/15 text-emerald-600 border-emerald-500/30">
                  {data.health.sender.provider || 'configured'}
                </Badge>
              ) : (
                <Badge variant="destructive">Not configured</Badge>
              )}
              {data?.health.sender.from_email && <span className="ml-2 text-muted-foreground">{data.health.sender.from_email}</span>}
            </div>
            {data?.health.sender.detail && <div className="text-xs text-muted-foreground">{data.health.sender.detail}</div>}
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default AIMeetingsTab;
