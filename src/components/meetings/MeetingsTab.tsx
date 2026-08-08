import { useState } from 'react';
import { format } from 'date-fns';
import { Video, Clock, Users, ExternalLink, Search, Lightbulb, ListChecks, ChevronDown, ChevronUp } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Meeting, MeetingHighlight, useAssignMeetingToClient } from '@/hooks/useMeetings';
import { Client } from '@/hooks/useClients';
import { MeetingDetailModal } from './MeetingDetailModal';
import { MeetingAttributionPanel } from './MeetingAttributionPanel';

interface MeetingsTabProps {
  meetings: Meeting[];
  clients: Client[];
}

export function MeetingsTab({ meetings, clients }: MeetingsTabProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedMeeting, setSelectedMeeting] = useState<Meeting | null>(null);
  const [clientFilter, setClientFilter] = useState<string>('all');
  const assignMutation = useAssignMeetingToClient();

  const filteredMeetings = meetings.filter((meeting) => {
    const matchesSearch = meeting.title.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesClient = clientFilter === 'all' || meeting.client_id === clientFilter;
    return matchesSearch && matchesClient;
  });

  // Aggregate all highlights from all meetings
  const allHighlights = meetings.flatMap((meeting) => 
    (meeting.highlights || []).map((h: MeetingHighlight) => ({
      ...h,
      meetingId: meeting.id,
      meetingTitle: meeting.title,
      meetingDate: meeting.meeting_date,
    }))
  );

  const handleAssignClient = (meetingId: string, clientId: string) => {
    assignMutation.mutate({
      meetingId,
      clientId: clientId === 'unassigned' ? null : clientId,
    });
  };

  return (
    <div className="space-y-6">
      {/* Search and Filters */}
      <div className="flex gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search meetings..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
        <Select value={clientFilter} onValueChange={setClientFilter}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="Filter by client" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Clients</SelectItem>
            {clients.map((client) => (
              <SelectItem key={client.id} value={client.id}>
                {client.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Tabs defaultValue="meetings" className="space-y-4">
        <TabsList>
          <TabsTrigger value="meetings" className="gap-2">
            <Video className="h-4 w-4" />
            Meetings ({filteredMeetings.length})
          </TabsTrigger>
          <TabsTrigger value="highlights" className="gap-2">
            <Lightbulb className="h-4 w-4" />
            Highlights ({allHighlights.length})
          </TabsTrigger>
          <TabsTrigger value="attribution" className="gap-2">
            <Users className="h-4 w-4" />
            Attribution
          </TabsTrigger>
        </TabsList>

        <TabsContent value="attribution" className="space-y-4">
          <MeetingAttributionPanel
            clientId={clientFilter === 'all' ? null : clientFilter}
            limit={50}
          />
        </TabsContent>

        <TabsContent value="meetings" className="space-y-4">
          {filteredMeetings.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Video className="h-12 w-12 text-muted-foreground opacity-50 mb-4" />
                <p className="text-muted-foreground">No meetings found</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4">
              {filteredMeetings.map((meeting) => {
                const assignedClient = clients.find((c) => c.id === meeting.client_id);
                
                return (
                  <Card key={meeting.id} className="hover:border-primary/50 transition-colors">
                    <CardHeader className="pb-2">
                      <div className="flex items-start justify-between">
                        <div className="space-y-1">
                          <CardTitle className="text-lg flex items-center gap-2">
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
                            <Badge variant="secondary">
                              <ListChecks className="h-3 w-3 mr-1" />
                              {meeting.action_items.length} actions
                            </Badge>
                          )}
                          {meeting.highlights?.length > 0 && (
                            <Badge variant="outline">
                              <Lightbulb className="h-3 w-3 mr-1" />
                              {meeting.highlights.length} highlights
                            </Badge>
                          )}
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {/* Summary */}
                      {meeting.summary && (
                        <p className="text-sm text-muted-foreground line-clamp-2">
                          {meeting.summary}
                        </p>
                      )}
                      
                      {/* Participants */}
                      {meeting.participants && meeting.participants.length > 0 && (
                        <div className="flex items-center gap-2">
                          <Users className="h-4 w-4 text-muted-foreground" />
                          <div className="flex flex-wrap gap-1">
                            {meeting.participants.slice(0, 5).map((p: any, i: number) => (
                              <Badge key={i} variant="outline" className="text-xs">
                                {p.name || p.email}
                              </Badge>
                            ))}
                            {meeting.participants.length > 5 && (
                              <Badge variant="outline" className="text-xs">
                                +{meeting.participants.length - 5} more
                              </Badge>
                            )}
                          </div>
                        </div>
                      )}
                      
                      {/* Actions */}
                      <div className="flex items-center justify-between pt-2 border-t">
                        <Select
                          value={meeting.client_id || 'unassigned'}
                          onValueChange={(value) => handleAssignClient(meeting.id, value)}
                        >
                          <SelectTrigger className="w-[180px] h-8 text-xs">
                            <SelectValue placeholder="Assign client" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="unassigned">Unassigned</SelectItem>
                            {clients.map((client) => (
                              <SelectItem key={client.id} value={client.id}>
                                {client.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        
                        <div className="flex gap-2">
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
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="highlights" className="space-y-4">
          {allHighlights.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Lightbulb className="h-12 w-12 text-muted-foreground opacity-50 mb-4" />
                <p className="text-muted-foreground">No highlights captured yet</p>
                <p className="text-sm text-muted-foreground">
                  Highlights from MeetGeek meetings will appear here
                </p>
              </CardContent>
            </Card>
          ) : (
            <ScrollArea className="h-[600px]">
              <div className="space-y-3">
                {allHighlights.map((highlight, index) => (
                  <Card key={index} className="p-4">
                    <div className="flex items-start gap-3">
                      <div className="p-2 rounded-full bg-primary/10">
                        <Lightbulb className="h-4 w-4 text-primary" />
                      </div>
                      <div className="flex-1 space-y-1">
                        <p className="text-sm">{highlight.highlightText}</p>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Badge variant="outline" className="text-xs">
                            {highlight.label}
                          </Badge>
                          {highlight.speaker && (
                            <span>— {highlight.speaker}</span>
                          )}
                          <span>•</span>
                          <span className="truncate max-w-[200px]">{highlight.meetingTitle}</span>
                          {highlight.meetingDate && (
                            <>
                              <span>•</span>
                              <span>{format(new Date(highlight.meetingDate), 'MMM d')}</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            </ScrollArea>
          )}
        </TabsContent>
      </Tabs>

      <MeetingDetailModal
        meeting={selectedMeeting}
        clients={clients}
        open={!!selectedMeeting}
        onOpenChange={(open) => !open && setSelectedMeeting(null)}
      />
    </div>
  );
}