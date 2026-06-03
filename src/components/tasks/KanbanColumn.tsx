import { useMemo } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';
import { Task, AgencyMember } from '@/hooks/useTasks';
import { KanbanTaskCard } from './KanbanTaskCard';
import { cn } from '@/lib/utils';

interface KanbanColumnProps {
  stage: { id: string; label: string; color: string };
  tasks: Task[];
  clientMap: Record<string, string>;
  memberMap: Record<string, AgencyMember>;
  taskAssigneeMap: Record<string, { members: AgencyMember[]; podName: string | null; podColor: string | null }>;
  subtaskCounts?: Record<string, { total: number; done: number }>;
  onAddTask: () => void;
  onTaskClick: (task: Task) => void;
  isPublicView?: boolean;
   selectedTaskIds?: Set<string>;
   onTaskSelect?: (taskId: string, selected: boolean) => void;
  pausedClientIds?: Set<string>;
}

export function KanbanColumn({ 
  stage, 
  tasks, 
  clientMap, 
  memberMap,
  taskAssigneeMap,
  subtaskCounts = {},
  onAddTask, 
  onTaskClick,
  isPublicView = false,
   selectedTaskIds,
   onTaskSelect,
  pausedClientIds,
}: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: stage.id,
  });

  // Compute total subtask stats for column header
  const columnSubtaskStats = useMemo(() => {
    let total = 0;
    let done = 0;
    tasks.forEach(t => {
      const info = subtaskCounts[t.id];
      if (info) {
        total += info.total;
        done += info.done;
      }
    });
    return { total, done };
  }, [tasks, subtaskCounts]);

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex-shrink-0 w-80 rounded-lg border-2 border-border bg-card flex flex-col',
        isOver && 'border-primary bg-primary/5'
      )}
    >
      {/* Column Header */}
      <div className={cn('p-3 border-b border-border', stage.color)}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-sm">{stage.label}</h3>
            <span className="bg-background text-foreground text-xs font-medium px-2 py-0.5 rounded-full">
              {tasks.length}
            </span>
            {columnSubtaskStats.total > 0 && (
              <span className="text-[10px] text-muted-foreground">
                ({columnSubtaskStats.done}/{columnSubtaskStats.total} subtasks)
              </span>
            )}
          </div>
          <Button size="icon" variant="ghost" className="h-6 w-6" onClick={onAddTask}>
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Tasks */}
      <ScrollArea className="flex-1 p-2">
        <SortableContext items={tasks.map(t => t.id)} strategy={verticalListSortingStrategy}>
          <div className="space-y-2">
            {tasks.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-8">
                Drop tasks here
              </p>
            ) : (
              tasks.map(task => (
                <KanbanTaskCard
                  key={task.id}
                  task={task}
                  clientName={task.client_id ? clientMap[task.client_id] : undefined}
                  assignee={task.assigned_to ? memberMap[task.assigned_to] : undefined}
                  taskAssignees={taskAssigneeMap[task.id]}
                  subtaskInfo={subtaskCounts[task.id]}
                  onClick={() => onTaskClick(task)}
                  isPublicView={isPublicView}
                   isSelected={selectedTaskIds?.has(task.id) || false}
                   onSelectChange={onTaskSelect ? (selected) => onTaskSelect(task.id, selected) : undefined}
                  isPaused={!!(task.client_id && pausedClientIds?.has(task.client_id))}
                />
              ))
            )}
          </div>
        </SortableContext>
      </ScrollArea>

      {/* Add Task Button */}
      <div className="p-2 border-t border-border">
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start text-muted-foreground"
          onClick={onAddTask}
        >
          <Plus className="h-4 w-4 mr-2" />
          Add a task
        </Button>
      </div>
    </div>
  );
}
