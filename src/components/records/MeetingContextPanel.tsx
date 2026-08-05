import { useQuery } from '@tanstack/react-query';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Badge } from '@/components/ui/badge';
import { ChevronDown, Video, CheckCircle2, AlertCircle, MinusCircle, ExternalLink } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { MeetingCallActivityList } from '@/components/meetings/MeetingCallActivityList';

interface MeetingContextPanelProps {
  leadId?: string | null;
  isOpen: boolean;
  onToggle: () => void;
}

interface MeetingContextRow {
  id: string;
  match_confidence: number | null;
  ghl_note_status: string | null;
  ghl_note_error: string | null;
  meeting_records: {
    id: string;
    title: string | null;
    started_at: string | null;
    duration_minutes: number | null;
    summary: string | null;
    action_items: unknown;
    recording_url: string | null;
    transcript_url: string | null;
    source_url: string | null;
  } | null;
}

const noteStatusMeta: Record<string, { label: string; icon: typeof CheckCircle2; className: string }> = {
  written: { label: 'Synced to CRM', icon: CheckCircle2, className: 'text-emerald-600' },
  skipped: { label: 'CRM sync skipped', icon: MinusCircle, className: 'text-muted-foreground' },
  error: { label: 'CRM sync failed', icon: AlertCircle, className: 'text-destructive' },
};

export function MeetingContextPanel({ leadId, isOpen, onToggle }: MeetingContextPanelProps) {
  const { data: meetings = [] } = useQuery({
    queryKey: ['lead-meeting-context', leadId],
    enabled: !!leadId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('lead_meeting_context' as any)
        .select(`id, match_confidence, ghl_note_status, ghl_note_error,
          meeting_records:meeting_record_id (
            id, title, started_at, duration_minutes, summary, action_items,
            recording_url, transcript_url, source_url
          )`)
        .eq('lead_id', leadId!)
        .order('created_at', { ascending: false })
        .limit(10);
      if (error) throw error;
      return ((data || []) as unknown as MeetingContextRow[]).filter((r) => r.meeting_records);
    },
  });

  const { data: activityCount = 0 } = useQuery({
    queryKey: ['meeting-call-activity-count', leadId],
    enabled: !!leadId,
    queryFn: async () => {
      const { count, error } = await supabase
        .from('meeting_call_activity' as any)
        .select('id', { count: 'exact', head: true })
        .eq('lead_id', leadId!);
      if (error) throw error;
      return count || 0;
    },
  });

  if (!leadId || (meetings.length === 0 && activityCount === 0)) return null;

  return (
    <Collapsible open={isOpen} onOpenChange={onToggle}>
      <CollapsibleTrigger className="flex items-center justify-between w-full py-2 text-sm font-semibold text-muted-foreground uppercase tracking-wide hover:text-foreground transition-colors">
        <span className="flex items-center gap-2">
          <Video className="h-4 w-4" />
          Meetings
          <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{meetings.length + activityCount}</Badge>
        </span>
        <ChevronDown className={`h-4 w-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-3 pt-2">
        {meetings.map((row) => {
          const m = row.meeting_records!;
          const status = noteStatusMeta[row.ghl_note_status || 'skipped'] || noteStatusMeta.skipped;
          const StatusIcon = status.icon;
          const items = Array.isArray(m.action_items) ? (m.action_items as string[]) : [];
          const link = m.recording_url || m.transcript_url || m.source_url;
          return (
            <div key={row.id} className="rounded-lg border border-border bg-muted/20 p-3 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{m.title || 'Meeting'}</p>
                  <p className="text-xs text-muted-foreground">
                    {m.started_at ? new Date(m.started_at).toLocaleString() : 'Unknown time'}
                    {m.duration_minutes != null ? ` • ${m.duration_minutes} min` : ''}
                  </p>
                </div>
                <span className={`flex items-center gap-1 text-[11px] whitespace-nowrap ${status.className}`}>
                  <StatusIcon className="h-3.5 w-3.5" />
                  {status.label}
                </span>
              </div>

              {m.summary && (
                <p className="text-xs text-foreground/80 line-clamp-4 whitespace-pre-wrap">{m.summary}</p>
              )}

              {items.length > 0 && (
                <ul className="space-y-1">
                  {items.slice(0, 5).map((item, i) => (
                    <li key={i} className="text-xs text-muted-foreground flex gap-1.5">
                      <span aria-hidden>•</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              )}

              {row.ghl_note_error && (
                <p className="text-[11px] text-destructive">{row.ghl_note_error}</p>
              )}

              {link && (
                <a
                  href={link}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  Open recording <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          );
        })}
        {activityCount > 0 && (
          <div className="space-y-2 pt-1">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Call activity</p>
            <MeetingCallActivityList leadId={leadId} limit={5} />
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}