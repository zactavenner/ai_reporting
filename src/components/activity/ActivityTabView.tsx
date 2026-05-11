import { useMemo, useState } from 'react';
import { formatDistanceToNow, format } from 'date-fns';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  CheckCircle2,
  PlusCircle,
  Clock,
  Video,
  Mic,
  Image as ImageIcon,
  ExternalLink,
  Activity as ActivityIcon,
  Search,
} from 'lucide-react';
import type { Task } from '@/hooks/useTasks';
import type { VoiceNote } from '@/hooks/useVoiceNotes';
import type { Meeting } from '@/hooks/useMeetings';
import type { Creative } from '@/hooks/useCreatives';

type ActivityType =
  | 'task_created'
  | 'task_completed'
  | 'task_ready_for_review'
  | 'meeting_synced'
  | 'voice_note_recorded'
  | 'creative_approved'
  | 'creative_launched';

interface ActivityItem {
  id: string;
  sourceId: string;
  type: ActivityType;
  title: string;
  timestamp: Date;
  link?: string | null;
  detail?: string | null;
}

const TYPE_META: Record<ActivityType, { label: string; icon: React.ReactNode; tone: string }> = {
  task_created: { label: 'Task created', icon: <PlusCircle className="h-4 w-4" />, tone: 'text-blue-500' },
  task_completed: { label: 'Task completed', icon: <CheckCircle2 className="h-4 w-4" />, tone: 'text-green-500' },
  task_ready_for_review: { label: 'Ready for review', icon: <Clock className="h-4 w-4" />, tone: 'text-amber-500' },
  meeting_synced: { label: 'Meeting', icon: <Video className="h-4 w-4" />, tone: 'text-purple-500' },
  voice_note_recorded: { label: 'Voice note', icon: <Mic className="h-4 w-4" />, tone: 'text-pink-500' },
  creative_approved: { label: 'Creative approved', icon: <ImageIcon className="h-4 w-4" />, tone: 'text-emerald-500' },
  creative_launched: { label: 'Creative launched', icon: <ImageIcon className="h-4 w-4" />, tone: 'text-cyan-500' },
};

interface Props {
  tasks: Task[];
  voiceNotes?: VoiceNote[];
  meetings?: Meeting[];
  creatives?: Creative[];
  onActivityClick?: (sourceId: string, type: ActivityType) => void;
}

export function ActivityTabView({
  tasks,
  voiceNotes = [],
  meetings = [],
  creatives = [],
  onActivityClick,
}: Props) {
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [rangeFilter, setRangeFilter] = useState<string>('30');
  const [search, setSearch] = useState('');

  const activities = useMemo(() => {
    const items: ActivityItem[] = [];

    tasks.forEach(t => {
      items.push({
        id: `task-created-${t.id}`,
        sourceId: t.id,
        type: 'task_created',
        title: t.title,
        timestamp: new Date(t.created_at),
        detail: t.priority ? `Priority: ${t.priority}` : null,
      });
      if (t.completed_at) {
        items.push({
          id: `task-completed-${t.id}`,
          sourceId: t.id,
          type: 'task_completed',
          title: t.title,
          timestamp: new Date(t.completed_at),
        });
      }
      if (t.stage === 'review') {
        items.push({
          id: `task-review-${t.id}`,
          sourceId: t.id,
          type: 'task_ready_for_review',
          title: t.title,
          timestamp: new Date(t.updated_at),
        });
      }
    });

    meetings.forEach(m => {
      items.push({
        id: `meeting-${m.id}`,
        sourceId: m.id,
        type: 'meeting_synced',
        title: m.title,
        timestamp: new Date(m.meeting_date || m.created_at),
        link: (m as any).recording_url || (m as any).meeting_url || null,
        detail: m.summary?.slice(0, 140) || null,
      });
    });

    voiceNotes.forEach(n => {
      items.push({
        id: `voice-${n.id}`,
        sourceId: n.id,
        type: 'voice_note_recorded',
        title: n.title,
        timestamp: new Date(n.created_at),
        link: n.audio_url || null,
        detail: n.summary?.slice(0, 140) || null,
      });
    });

    creatives.forEach(c => {
      if (c.status === 'approved') {
        items.push({
          id: `creative-approved-${c.id}`,
          sourceId: c.id,
          type: 'creative_approved',
          title: c.title,
          timestamp: new Date(c.updated_at),
          link: (c as any).file_url || null,
          detail: c.platform || null,
        });
      }
      if (c.status === 'launched') {
        items.push({
          id: `creative-launched-${c.id}`,
          sourceId: c.id,
          type: 'creative_launched',
          title: c.title,
          timestamp: new Date(c.updated_at),
          link: (c as any).file_url || null,
          detail: c.platform || null,
        });
      }
    });

    items.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    return items;
  }, [tasks, meetings, voiceNotes, creatives]);

  const filtered = useMemo(() => {
    const now = Date.now();
    const days = rangeFilter === 'all' ? null : parseInt(rangeFilter, 10);
    const cutoff = days ? now - days * 24 * 60 * 60 * 1000 : 0;
    const q = search.trim().toLowerCase();
    return activities.filter(a => {
      if (typeFilter !== 'all' && a.type !== typeFilter) return false;
      if (cutoff && a.timestamp.getTime() < cutoff) return false;
      if (q && !a.title.toLowerCase().includes(q) && !(a.detail || '').toLowerCase().includes(q)) return false;
      return true;
    });
  }, [activities, typeFilter, rangeFilter, search]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: activities.length };
    activities.forEach(a => { c[a.type] = (c[a.type] || 0) + 1; });
    return c;
  }, [activities]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search activity..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types ({counts.all || 0})</SelectItem>
            {(Object.keys(TYPE_META) as ActivityType[]).map(t => (
              <SelectItem key={t} value={t}>
                {TYPE_META[t].label} ({counts[t] || 0})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={rangeFilter} onValueChange={setRangeFilter}>
          <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="1">Last 24 hours</SelectItem>
            <SelectItem value="7">Last 7 days</SelectItem>
            <SelectItem value="30">Last 30 days</SelectItem>
            <SelectItem value="90">Last 90 days</SelectItem>
            <SelectItem value="all">All time</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card className="border border-border">
        <ScrollArea className="h-[600px]">
          <div className="divide-y divide-border">
            {filtered.length === 0 && (
              <div className="p-12 text-center text-sm text-muted-foreground">
                <ActivityIcon className="h-8 w-8 mx-auto mb-2 opacity-50" />
                No activity matches your filters.
              </div>
            )}
            {filtered.map(a => {
              const meta = TYPE_META[a.type];
              return (
                <div
                  key={a.id}
                  className="flex items-start gap-3 p-4 hover:bg-muted/40 transition-colors cursor-pointer"
                  onClick={() => onActivityClick?.(a.sourceId, a.type)}
                >
                  <span className={`mt-0.5 ${meta.tone}`}>{meta.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
                        {meta.label}
                      </Badge>
                      <span className="font-medium text-sm truncate">{a.title}</span>
                    </div>
                    {a.detail && (
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{a.detail}</p>
                    )}
                    <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground">
                      <span title={format(a.timestamp, 'PPpp')}>
                        {formatDistanceToNow(a.timestamp, { addSuffix: true })}
                      </span>
                      {a.link && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 px-2 text-xs gap-1"
                          onClick={(e) => { e.stopPropagation(); window.open(a.link!, '_blank'); }}
                        >
                          <ExternalLink className="h-3 w-3" /> Open link
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </ScrollArea>
      </Card>
    </div>
  );
}