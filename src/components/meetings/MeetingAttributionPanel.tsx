import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { CalendarDays, ExternalLink, User, UserCheck, Video } from 'lucide-react';
import { invokeMeetgeek } from '@/lib/meetgeekInvoke';

interface Props {
  clientId?: string | null;
  limit?: number;
}

interface AttributedMeeting {
  id: string;
  title: string | null;
  started_at: string | null;
  duration_minutes: number | null;
  contact_name: string | null;
  contact_email: string | null;
  sales_agent_name: string | null;
  ghl_calendar_name: string | null;
  ghl_appointment_url: string | null;
  attribution_method: string | null;
  recording_url: string | null;
}

interface AgentRollup {
  sales_agent_name: string;
  meetings_recorded: number;
  meetings_last_30d: number;
  meetings_last_7d: number;
  avg_duration_minutes: number;
  last_meeting_at: string | null;
}

export function MeetingAttributionPanel({ clientId, limit = 25 }: Props) {
  const { data: meetings } = useQuery({
    queryKey: ['mg-attributed-meetings', clientId, limit],
    queryFn: async () => {
      const res = await invokeMeetgeek<{ meetings: AttributedMeeting[] }>({
        action: 'mg_attributed_meetings',
        client_id: clientId || undefined,
        limit,
      });
      return res?.meetings || [];
    },
  });

  const { data: agents } = useQuery({
    queryKey: ['mg-agent-rollup', clientId],
    queryFn: async () => {
      const res = await invokeMeetgeek<{ agents: AgentRollup[] }>({
        action: 'mg_agent_rollup',
        client_id: clientId || undefined,
      });
      return res?.agents || [];
    },
  });

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Video className="h-4 w-4 text-muted-foreground" />
            Recorded meetings — attribution
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!meetings?.length ? (
            <p className="text-sm text-muted-foreground">No attributed meetings yet.</p>
          ) : (
            <ScrollArea className="max-h-[420px] pr-3">
              <div className="space-y-2">
                {meetings.map((m) => (
                  <div key={m.id} className="rounded-lg border border-border bg-muted/20 p-3 space-y-1.5">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium truncate">{m.title || 'Meeting'}</p>
                      <span className="text-xs text-muted-foreground whitespace-nowrap">
                        {m.started_at ? format(new Date(m.started_at), 'MMM d, h:mm a') : 'Unknown time'}
                        {m.duration_minutes != null ? ` • ${m.duration_minutes}m` : ''}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <User className="h-3 w-3" />
                        {m.contact_name || m.contact_email || 'Unknown contact'}
                      </span>
                      <span className="flex items-center gap-1">
                        <UserCheck className="h-3 w-3" />
                        {m.sales_agent_name || 'Unassigned agent'}
                      </span>
                      {m.ghl_calendar_name && (
                        <span className="flex items-center gap-1">
                          <CalendarDays className="h-3 w-3" />
                          {m.ghl_calendar_name}
                        </span>
                      )}
                      {m.attribution_method && (
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                          {m.attribution_method.replace(/_/g, ' ')}
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      {m.ghl_appointment_url && (
                        <a
                          href={m.ghl_appointment_url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                        >
                          CRM appointment <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                      {m.recording_url && (
                        <a
                          href={m.recording_url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                        >
                          Recording <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <UserCheck className="h-4 w-4 text-muted-foreground" />
            Meetings per sales agent
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!agents?.length ? (
            <p className="text-sm text-muted-foreground">No agent rollups yet.</p>
          ) : (
            <div className="space-y-2">
              {agents.map((a) => (
                <div key={`${a.sales_agent_name}`} className="flex items-center justify-between rounded-md border border-border/60 px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{a.sales_agent_name}</p>
                    <p className="text-[11px] text-muted-foreground">
                      7d {a.meetings_last_7d} • 30d {a.meetings_last_30d} • avg {Math.round(a.avg_duration_minutes || 0)}m
                    </p>
                  </div>
                  <Badge variant="secondary" className="text-xs">{a.meetings_recorded}</Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
