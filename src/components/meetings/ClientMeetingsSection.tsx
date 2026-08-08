import { useState } from 'react';
import { format } from 'date-fns';
import { Video, Clock, Users, ExternalLink, ListChecks, Lightbulb, Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Meeting, MeetingHighlight } from '@/hooks/useMeetings';
import { MeetingDetailModal } from './MeetingDetailModal';
import { Client } from '@/hooks/useClients';
import { MeetingAttributionPanel } from './MeetingAttributionPanel';

interface ClientMeetingsSectionProps {
  meetings: Meeting[];
  client?: Client;
  isPublicView?: boolean;
}

export function ClientMeetingsSection({ meetings, client, isPublicView = false }: ClientMeetingsSectionProps) {
  const [selectedMeeting, setSelectedMeeting] = useState<Meeting | null>(null);

  // Attribution (contact, sales agent, calendar, CRM link) is operator-only.
  const attribution = !isPublicView ? <MeetingAttributionPanel clientId={client?.id} limit={15} /> : null;

  if (meetings.length === 0) {
    return (
      <div className="space-y-4">
        {attribution}
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center justify-center py-8">
          <Video className="h-10 w-10 text-muted-foreground opacity-50 mb-3" />
          <p className="text-muted-foreground text-sm">No meetings recorded yet</p>
        </CardContent>
      </Card>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-4">
        {attribution}
        {meetings.slice(0, 5).map((meeting) => (
          <Card key={meeting.id} className="hover:border-primary/50 transition-colors">
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between">
                <div className="space-y-1">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Video className="h-4 w-4 text-muted-foreground" />
                    {meeting.title}
                  </CardTitle>
                  <div className="flex items-center gap-3 text-sm text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {meeting.meeting_date
                        ? format(new Date(meeting.meeting_date), 'MMM d, yyyy h:mm a')
                        : 'Unknown date'}
                    </span>
                    {meeting.duration_minutes && (
                      <span>{meeting.duration_minutes} min</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {meeting.action_items?.length > 0 && (
                    <Badge variant="secondary" className="text-xs">
                      <ListChecks className="h-3 w-3 mr-1" />
                      {meeting.action_items.length}
                    </Badge>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {/* Summary */}
              {meeting.summary && (
                <p className="text-sm text-muted-foreground line-clamp-2">
                  {meeting.summary}
                </p>
              )}
              
              {/* Highlights Preview */}
              {meeting.highlights && meeting.highlights.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
                    <Lightbulb className="h-3 w-3" />
                    Key Highlights
                  </div>
                  <div className="space-y-1">
                    {meeting.highlights.slice(0, 2).map((h: MeetingHighlight, i: number) => (
                      <div key={i} className="flex items-start gap-2 text-sm p-2 bg-muted/50 rounded">
                        <Badge variant="outline" className="text-xs shrink-0">
                          {h.label}
                        </Badge>
                        <span className="text-muted-foreground line-clamp-1">
                          {h.highlightText}
                        </span>
                      </div>
                    ))}
                    {meeting.highlights.length > 2 && (
                      <p className="text-xs text-muted-foreground pl-2">
                        +{meeting.highlights.length - 2} more highlights
                      </p>
                    )}
                  </div>
                </div>
              )}
              
              {/* Participants */}
              {meeting.participants && meeting.participants.length > 0 && (
                <div className="flex items-center gap-2">
                  <Users className="h-3 w-3 text-muted-foreground" />
                  <div className="flex flex-wrap gap-1">
                    {meeting.participants.slice(0, 3).map((p: any, i: number) => (
                      <Badge key={i} variant="outline" className="text-xs">
                        {p.name || p.email}
                      </Badge>
                    ))}
                    {meeting.participants.length > 3 && (
                      <Badge variant="outline" className="text-xs">
                        +{meeting.participants.length - 3}
                      </Badge>
                    )}
                  </div>
                </div>
              )}
              
              {/* Actions */}
              <div className="flex gap-2 pt-2 border-t">
                {meeting.recording_url && (
                  <Button variant="outline" size="sm" asChild>
                    <a
                      href={meeting.recording_url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <Play className="h-3 w-3 mr-1" />
                      Watch
                    </a>
                  </Button>
                )}
                {meeting.meetgeek_url && (
                  <Button variant="outline" size="sm" asChild>
                    <a
                      href={meeting.meetgeek_url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <ExternalLink className="h-3 w-3 mr-1" />
                      MeetGeek
                    </a>
                  </Button>
                )}
                <Button size="sm" onClick={() => setSelectedMeeting(meeting)}>
                  View Details
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
        
        {meetings.length > 5 && (
          <p className="text-sm text-muted-foreground text-center py-2">
            Showing 5 of {meetings.length} meetings
          </p>
        )}
      </div>

      <MeetingDetailModal
        meeting={selectedMeeting}
        clients={client ? [client] : []}
        open={!!selectedMeeting}
        onOpenChange={(open) => !open && setSelectedMeeting(null)}
      />
    </>
  );
}