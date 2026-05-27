import { useMemo, useState } from 'react';
import { CheckCircle2, Circle, ChevronRight, ListChecks } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { useOnboardingTasks, useToggleOnboardingTask, useSeedOnboardingTasks } from '@/hooks/useOnboardingTasks';
import {
  getTemplatesForClientType,
  getOnboardingTemplate,
  ONBOARDING_TEMPLATE_OPTIONS,
  type OnboardingTemplateKey,
} from '@/lib/onboardingTaskTemplates';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface OnboardingChecklistProps {
  clientId: string;
  clientType?: string | null;
}

export function OnboardingChecklist({ clientId, clientType }: OnboardingChecklistProps) {
  const { data: tasks = [], isLoading } = useOnboardingTasks(clientId);
  const toggleTask = useToggleOnboardingTask();
  const seedTasks = useSeedOnboardingTasks();

  // Default the selector based on client type (capital raisers get capital template).
  const defaultKey: OnboardingTemplateKey = useMemo(() => {
    const t = (clientType || '').toLowerCase();
    return t.includes('capital') || t.includes('invest') || t.includes('fund') ? 'capital' : 'standard';
  }, [clientType]);
  const [templateKey, setTemplateKey] = useState<OnboardingTemplateKey>(defaultKey);

  const grouped = useMemo(() => {
    const map: Record<string, typeof tasks> = {};
    tasks.forEach(t => {
      if (!map[t.category]) map[t.category] = [];
      map[t.category].push(t);
    });
    return Object.entries(map);
  }, [tasks]);

  const completedCount = tasks.filter(t => t.completed).length;
  const totalCount = tasks.length;
  const progress = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  if (isLoading) return null;

  if (totalCount === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-muted/30 p-4 flex flex-col sm:flex-row sm:items-center gap-3 sm:justify-between">
        <div className="flex items-center gap-3">
          <ListChecks className="h-5 w-5 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No onboarding checklist yet.</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={templateKey} onValueChange={(v) => setTemplateKey(v as OnboardingTemplateKey)}>
            <SelectTrigger className="h-9 w-[200px]">
              <SelectValue placeholder="Choose template" />
            </SelectTrigger>
            <SelectContent>
              {ONBOARDING_TEMPLATE_OPTIONS.map((opt) => (
                <SelectItem key={opt.key} value={opt.key}>
                  <div className="flex flex-col">
                    <span className="text-sm">{opt.label}</span>
                    <span className="text-[10px] text-muted-foreground">{opt.description}</span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              const templates = getOnboardingTemplate(templateKey)
                ?? getTemplatesForClientType(clientType);
              await seedTasks.mutateAsync({
                clientId,
                tasks: templates,
                // Capital raising clients also get the full checklist
                // mirrored into the PM task board (To Do) with each task
                // auto-routed to the owning department pod.
                createPmTasks: templateKey === 'capital',
              });
              toast.success(
                templateKey === 'capital'
                  ? 'Capital Raising onboarding loaded — tasks added to PM board & assigned to pods'
                  : 'Onboarding tasks created'
              );
            }}
            disabled={seedTasks.isPending}
          >
            Load Template
          </Button>
        </div>
      </div>
    );
  }

  if (completedCount === totalCount) {
    return (
      <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 flex items-center gap-3">
        <CheckCircle2 className="h-5 w-5 text-primary" />
        <p className="text-sm font-medium text-primary">Onboarding complete!</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Onboarding Progress</h3>
        <span className="text-xs text-muted-foreground">{completedCount}/{totalCount} tasks</span>
      </div>
      <Progress value={progress} className="h-2" />

      <div className="space-y-4">
        {grouped.map(([category, catTasks]) => {
          const catDone = catTasks.filter(t => t.completed).length;
          return (
            <div key={category}>
              <div className="flex items-center gap-2 mb-2">
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{category}</span>
                <span className="text-[10px] text-muted-foreground ml-auto">{catDone}/{catTasks.length}</span>
              </div>
              <div className="space-y-1 pl-5">
                {catTasks.map(task => (
                  <button
                    key={task.id}
                    onClick={() => toggleTask.mutate({ id: task.id, completed: !task.completed, clientId })}
                    className={cn(
                      'flex items-center gap-2.5 w-full text-left py-1.5 px-2 rounded-md text-sm transition-colors hover:bg-muted/50',
                      task.completed && 'text-muted-foreground line-through'
                    )}
                    disabled={toggleTask.isPending}
                  >
                    {task.completed ? (
                      <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />
                    ) : (
                      <Circle className="h-4 w-4 text-muted-foreground shrink-0" />
                    )}
                    {task.title}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
