import { CheckCircle2, Circle, Clock3, Lock } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ONBOARDING_STAGES, fmtStageDuration, type StageStatus } from '@/lib/onboarding/dockStages';
import { cn } from '@/lib/utils';

interface Props {
  statuses: Record<string, StageStatus>;
  elapsedFor: (key: string) => number | null;
  totalElapsed: number;
  onJump: (key: string) => void;
}

export function OnboardingStageRail({ statuses, elapsedFor, totalElapsed, onJump }: Props) {
  const done = ONBOARDING_STAGES.filter(s => statuses[s.key] === 'complete').length;

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between gap-3 px-2 mb-4">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Stages</h3>
        <span className="text-[11px] text-muted-foreground tabular-nums">{done}/{ONBOARDING_STAGES.length}</span>
      </div>

      <ScrollArea className="flex-1 -mx-1">
        <div className="space-y-4 px-2 pb-2">
          {ONBOARDING_STAGES.map((stage) => {
            const status = statuses[stage.key] ?? 'pending';
            const elapsed = elapsedFor(stage.key);
            return (
              <button
                key={stage.key}
                type="button"
                onClick={() => onJump(stage.key)}
                className={cn(
                  'w-full text-left flex items-start gap-3 rounded-lg px-1.5 py-1 transition-colors hover:bg-muted/50',
                  status === 'complete' && 'opacity-50',
                )}
              >
                <div className="mt-0.5 shrink-0">
                  {status === 'complete' ? (
                    <CheckCircle2 className="h-4 w-4 text-primary" />
                  ) : status === 'active' ? (
                    <Circle className="h-4 w-4 text-primary fill-primary animate-pulse" />
                  ) : status === 'blocked' ? (
                    <Lock className="h-4 w-4 text-amber-500" />
                  ) : (
                    <Clock3 className="h-4 w-4 text-muted-foreground/30" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className={cn('text-sm font-medium truncate', status === 'active' ? 'text-foreground' : 'text-muted-foreground')}>
                      {stage.label}
                    </span>
                    {elapsed != null && (
                      <span className={cn(
                        'ml-auto font-mono tabular-nums text-[10px] px-1.5 py-0.5 rounded shrink-0',
                        status === 'active'
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-muted-foreground bg-muted/50',
                      )}>
                        {fmtStageDuration(elapsed)}
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 text-[11px] text-muted-foreground/70 line-clamp-2">
                    {status === 'complete' ? 'Done' : status === 'active' ? 'Now' : status === 'blocked' ? 'Waiting on you' : 'Upcoming'} · {stage.hint}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </ScrollArea>

      <div className="mt-2 pt-2 px-2 border-t flex items-center justify-between text-[10px] text-muted-foreground">
        <span>Total onboarding time</span>
        <span className="font-mono tabular-nums">{fmtStageDuration(totalElapsed)}</span>
      </div>
    </div>
  );
}