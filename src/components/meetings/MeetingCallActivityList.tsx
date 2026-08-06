import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import {
  Video, CheckCircle2, AlertCircle, MinusCircle, ExternalLink, Clock, RefreshCw,
} from 'lucide-react';

interface Props {
  clientId?: string | null;
  leadId?: string | null;
  limit?: number;
}

interface ActivityRow {
  id: string;
  status: string;
  title: string | null;
  attendee_email: string | null;
  agent_joined_at: string | null;
  started_at: string | null;
  ended_at: string | null;
  duration_minutes: number | null;
  recording_url: string | null;
  transcript_url: string | null;
  summary: string | null;
  action_items: unknown;
  crm_sync_status: string | null;
  crm_sync_error: string | null;
  error_message: string | null;
  quality_rating: number | null;
  quality_rubric: unknown;
  quality_summary: string | null;
  created_at: string;
}

function qualityTone(rating: number): string {
  if (rating >= 8) return 'text-emerald-600 border-emerald-500/30';
  if (rating >= 6) return 'text-primary border-primary/30';
  if (rating >= 4) return 'text-amber-600 border-amber-500/30';
  return 'text-destructive border-destructive/30';
}

const statusMeta: Record<string, { label: string; className: string }> = {
  booked: { label: 'Booked', className: 'text-muted-foreground' },
  bot_joined: { label: 'Bot joined', className: 'text-primary' },
  completed: { label: 'Completed', className: 'text-emerald-600' },
  unmatched: { label: 'No lead matched', className: 'text-amber-600' },
  rejected: { label: 'Rejected', className: 'text-destructive' },
  error: { label: 'Error', className: 'text-destructive' },
  test: { label: 'Self-test', className: 'text-muted-foreground' },
};

const crmMeta: Record<string, { label: string; icon: typeof CheckCircle2; className: string }> = {
  written: { label: 'Synced to CRM', icon: CheckCircle2, className: 'text-emerald-600' },
  retrying: { label: 'CRM retrying', icon: RefreshCw, className: 'text-amber-600' },
  pending: { label: 'CRM pending', icon: Clock, className: 'text-muted-foreground' },
  skipped: { label: 'CRM skipped', icon: MinusCircle, className: 'text-muted-foreground' },
  error: { label: 'CRM sync failed', icon: AlertCircle, className: 'text-destructive' },
  not_applicable: { label: 'No CRM write', icon: MinusCircle, className: 'text-muted-foreground' },
};

export function MeetingCallActivityList({ clientId, leadId, limit = 15 }: Props) {
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['meeting-call-activity', clientId, leadId, limit],
    enabled: !!(clientId || leadId),
    queryFn: async () => {
      let q = supabase
        .from('meeting_call_activity')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit);
      if (clientId) q = q.eq('client_id', clientId);
      if (leadId) q = q.eq('lead_id', leadId);
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as unknown as ActivityRow[];
    },
  });

  if (isLoading) {
    return <p className="text-xs text-muted-foreground">Loading call activity…</p>;
  }

  if (rows.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No meeting call activity yet. Bookings, bot joins and completions appear here.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {rows.map((row) => {
        const status = statusMeta[row.status] ?? { label: row.status, className: 'text-muted-foreground' };
        const crm = crmMeta[row.crm_sync_status || 'pending'];
        const CrmIcon = crm?.icon ?? Clock;
        const items = Array.isArray(row.action_items) ? (row.action_items as string[]) : [];
        return (
          <div key={row.id} className="border border-border p-3 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Video className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <span className="text-sm font-medium truncate">{row.title || 'Untitled meeting'}</span>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {row.started_at ? new Date(row.started_at).toLocaleString() : new Date(row.created_at).toLocaleString()}
                  {row.duration_minutes ? ` · ${row.duration_minutes} min` : ''}
                  {row.attendee_email ? ` · ${row.attendee_email}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {typeof row.quality_rating === 'number' && (
                  <Badge
                    variant="outline"
                    className={qualityTone(row.quality_rating)}
                    title={row.quality_summary || undefined}
                  >
                    {row.quality_rating}/10
                  </Badge>
                )}
                <Badge variant="outline" className={status.className}>{status.label}</Badge>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 text-xs">
              <span className={`flex items-center gap-1 ${crm?.className || ''}`}>
                <CrmIcon className="h-3.5 w-3.5" />
                {crm?.label || row.crm_sync_status}
              </span>
              {row.agent_joined_at && (
                <span className="flex items-center gap-1 text-primary">
                  <Video className="h-3.5 w-3.5" /> Bot joined
                </span>
              )}
              {row.recording_url && (
                <a href={row.recording_url} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-primary hover:underline">
                  Recording <ExternalLink className="h-3 w-3" />
                </a>
              )}
              {row.transcript_url && (
                <a href={row.transcript_url} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-primary hover:underline">
                  Transcript <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>

            {row.summary && <p className="text-xs text-muted-foreground line-clamp-3">{row.summary}</p>}

            {Array.isArray(row.quality_rubric) && (row.quality_rubric as any[]).length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {(row.quality_rubric as { label: string; points: number; max: number }[]).map((r, i) => (
                  <span
                    key={i}
                    className={`text-[10px] border px-1.5 py-0.5 ${r.points >= r.max ? 'text-emerald-600 border-emerald-500/30' : 'text-muted-foreground border-border'}`}
                  >
                    {r.label} {r.points}/{r.max}
                  </span>
                ))}
              </div>
            )}

            {items.length > 0 && (
              <ul className="text-xs list-disc pl-4 space-y-0.5">
                {items.slice(0, 5).map((item, i) => <li key={i}>{String(item)}</li>)}
              </ul>
            )}

            {(row.error_message || row.crm_sync_error) && (
              <p className="text-xs text-destructive">{row.error_message || row.crm_sync_error}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}
