/**
 * Small panel showing recent broll / single-scene / image-to-video jobs.
 * Mounts wherever single-job pages want reload-resume visibility.
 */
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, RefreshCw, Video, CheckCircle2, XCircle, Clock } from 'lucide-react';
import { useResumeJobs } from '@/hooks/useResumeJobs';
import type { SingleJobKind } from '@/hooks/useSingleJobPersistence';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';

const KIND_LABELS: Record<SingleJobKind, string> = {
  broll: 'B-Roll',
  'single-scene': 'Single Scene',
  'image-to-video': 'Image → Video',
};

const STATUS_ICON = {
  processing: <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" />,
  queued:     <Clock className="h-3.5 w-3.5 text-yellow-500" />,
  done:       <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />,
  failed:     <XCircle className="h-3.5 w-3.5 text-destructive" />,
};

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  processing: 'default',
  queued:     'secondary',
  done:       'outline',
  failed:     'destructive',
};

interface RecentJobsPanelProps {
  kinds?: SingleJobKind[];
  className?: string;
}

export function RecentJobsPanel({ kinds, className }: RecentJobsPanelProps) {
  const { jobs, loading, refetch } = useResumeJobs(kinds);

  if (!loading && jobs.length === 0) return null;

  return (
    <Card className={cn('w-full', className)}>
      <CardHeader className="pb-2 flex flex-row items-center justify-between">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Video className="h-4 w-4" />
          Recent Jobs
        </CardTitle>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={refetch} title="Refresh">
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
      </CardHeader>
      <CardContent className="pt-0">
        {loading ? (
          <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
          </div>
        ) : (
          <ul className="space-y-2">
            {jobs.map(job => (
              <li key={job.id} className="flex items-start gap-3 text-sm">
                <span className="mt-0.5">{STATUS_ICON[job.status as keyof typeof STATUS_ICON] ?? <Clock className="h-3.5 w-3.5" />}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium">{KIND_LABELS[job.kind] ?? job.kind}</span>
                    <Badge variant={STATUS_VARIANT[job.status] ?? 'outline'} className="text-[10px] px-1.5 py-0">
                      {job.status}
                    </Badge>
                    <span className="text-muted-foreground text-xs">
                      {formatDistanceToNow(new Date(job.created_at), { addSuffix: true })}
                    </span>
                  </div>
                  {job.prompt && (
                    <p className="text-muted-foreground text-xs truncate mt-0.5">{job.prompt}</p>
                  )}
                  {job.videoUrl && job.status === 'done' && (
                    <a href={job.videoUrl} target="_blank" rel="noreferrer"
                      className="text-xs text-primary underline underline-offset-2 hover:no-underline">
                      View video ↗
                    </a>
                  )}
                </div>
                <span className="text-[10px] text-muted-foreground shrink-0">{job.aspect_ratio}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
