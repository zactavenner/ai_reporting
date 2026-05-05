import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { 
  Calendar as CalendarIcon,
  Paperclip,
  AlertTriangle,
  Check,
  CheckCircle2,
  Repeat,
  EyeOff,
  ListChecks,
} from 'lucide-react';
import { Task, AgencyMember, useUpdateTask, useTaskFiles, useCompleteRecurringTask } from '@/hooks/useTasks';
import { format, isToday, isPast, parseISO, startOfDay } from 'date-fns';
import { cn } from '@/lib/utils';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface KanbanTaskCardProps {
  task: Task;
  clientName?: string;
  assignee?: AgencyMember;
  taskAssignees?: { members: AgencyMember[]; podName: string | null; podColor: string | null };
  subtaskInfo?: { total: number; done: number };
  onClick?: () => void;
  isDragging?: boolean;
  isPublicView?: boolean;
  isSelected?: boolean;
  onSelectChange?: (selected: boolean) => void;
}

export function KanbanTaskCard({ 
  task, 
  clientName, 
  assignee,
  taskAssignees,
  subtaskInfo,
  onClick,
  isDragging,
  isPublicView = false,
  isSelected = false,
  onSelectChange,
}: KanbanTaskCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging: isSortableDragging,
  } = useSortable({ id: task.id });

  const updateTask = useUpdateTask();
  const completeRecurring = useCompleteRecurringTask();
  const { data: files = [] } = useTaskFiles(task?.id);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'high': return 'destructive';
      case 'medium': return 'secondary';
      case 'low': return 'outline';
      default: return 'secondary';
    }
  };

  // Parse due_date as local date (YYYY-MM-DD string → local midnight)
  // Adding T23:59:59 ensures the task is due by end of day, not start
  const parseDueDate = (dateStr: string) => {
    const [year, month, day] = dateStr.split('-').map(Number);
    return new Date(year, month - 1, day, 23, 59, 59);
  };
  
  const isCompletedForOverdue = task.stage === 'done' || task.status === 'completed';
  const dueDateTime = task.due_date ? parseDueDate(task.due_date) : null;
  const isOverdue = dueDateTime && isPast(dueDateTime) && !isCompletedForOverdue;
  const isDueToday = task.due_date ? (() => {
    const [year, month, day] = task.due_date.split('-').map(Number);
    const dueDate = new Date(year, month - 1, day);
    return isToday(dueDate);
  })() : false;
  const isCompleted = task.stage === 'done' || task.status === 'completed';
  const isSelectionMode = !!onSelectChange;

  const handleCompleteTask = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (task.recurrence_type && !isCompleted) {
      // Recurring task: complete and spawn next occurrence
      await completeRecurring.mutateAsync(task);
    } else {
      await updateTask.mutateAsync({
        id: task.id,
        stage: isCompleted ? 'todo' : 'done',
        status: isCompleted ? 'todo' : 'completed',
        completed_at: isCompleted ? null : new Date().toISOString(),
      });
    }
  };

  const handleSelectionChange = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onSelectChange) {
      onSelectChange(!isSelected);
    }
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={cn(
        'group relative p-3 rounded-lg cursor-grab active:cursor-grabbing transition-all duration-200 overflow-hidden',
        // Base styling
        'bg-card border shadow-sm',
        // Default hover - subtle lift
        !isSelected && !isCompleted && 'hover:shadow-md hover:-translate-y-0.5 hover:border-primary/30',
        // Dragging state
        (isDragging || isSortableDragging) && 'opacity-60 shadow-xl rotate-1 scale-105',
        // Overdue styling
        isOverdue && !isCompleted && 'border-destructive/40 bg-destructive/5',
        // Completed styling
        isCompleted && 'bg-muted/40 border-border/50',
        // Selection styling
        isSelected && 'ring-2 ring-primary ring-offset-1 ring-offset-background border-primary shadow-md'
      )}
    >
      <div onClick={onClick} className={cn(isCompleted && 'opacity-60')}>
        {/* Priority Badge & Quick Complete Button */}
        <div className="flex items-center justify-between gap-1.5 mb-2">
          <div className="flex items-center gap-2">
            {/* Quick Complete Button - Always visible, styled based on state */}
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    className={cn(
                      'flex items-center justify-center w-5 h-5 rounded-full transition-all duration-200 cursor-pointer flex-shrink-0',
                      // Completed state
                      isCompleted && 'bg-success text-success-foreground',
                      // Selected state (for bulk selection)
                      isSelected && !isCompleted && 'bg-primary text-primary-foreground',
                      // Default unchecked state with hover effect
                      !isCompleted && !isSelected && 'border-2 border-muted-foreground/30 hover:border-success hover:bg-success/10 group-hover:border-success/50'
                    )}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (isSelectionMode) {
                        handleSelectionChange(e);
                      } else {
                        handleCompleteTask(e);
                      }
                    }}
                  >
                    {isCompleted ? (
                      <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={2.5} />
                    ) : isSelected ? (
                      <Check className="h-3 w-3" strokeWidth={3} />
                    ) : (
                      <Check className="h-3 w-3 text-transparent group-hover:text-success/50" strokeWidth={2} />
                    )}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs">
                  {isSelectionMode 
                    ? (isSelected ? 'Deselect' : 'Select for bulk action')
                    : (isCompleted ? 'Mark incomplete' : 'Mark complete')
                  }
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            
            <Badge 
              variant={getPriorityColor(task.priority)} 
              className={cn(
                'text-[10px] uppercase font-semibold px-1.5 py-0',
                isCompleted && 'opacity-50'
              )}
            >
              {task.priority}
            </Badge>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            {task.visible_to_client === false && !isPublicView && (
              <TooltipProvider>
                <Tooltip>
                <TooltipTrigger asChild>
                      <span className="inline-flex"><EyeOff className="h-3 w-3 text-muted-foreground/70" /></span>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="text-xs">Hidden from client</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
            {files.length > 0 && (
              <div className="flex items-center gap-0.5 text-muted-foreground/70">
                <Paperclip className="h-3 w-3" />
                <span className="text-[10px]">{files.length}</span>
              </div>
            )}
            {clientName && (
              <span className="text-[10px] text-muted-foreground bg-muted/60 px-1.5 py-0.5 rounded">
                {clientName}
              </span>
            )}
          </div>
        </div>

        {/* Title */}
        <h4 className={cn(
          'font-medium text-sm leading-tight mb-1.5 break-words overflow-wrap-anywhere',
          isCompleted && 'line-through text-muted-foreground'
        )}
        style={{ wordBreak: 'break-word', overflowWrap: 'anywhere' }}>
          {task.title}
        </h4>

        {/* Description */}
        {task.description && (
          <p className={cn(
            'text-xs text-muted-foreground mb-2 whitespace-pre-wrap',
            isCompleted && 'opacity-70'
          )}
          style={{ wordBreak: 'break-word', overflowWrap: 'anywhere' }}>
            {task.description}
          </p>
        )}

        {/* Subtask Progress */}
        {subtaskInfo && subtaskInfo.total > 0 && (
          <div className="flex items-center gap-2 mb-2">
            <ListChecks className="h-3 w-3 text-muted-foreground flex-shrink-0" />
            <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
              <div 
                className="h-full bg-primary rounded-full transition-all" 
                style={{ width: `${Math.round((subtaskInfo.done / subtaskInfo.total) * 100)}%` }}
              />
            </div>
            <span className={cn(
              'text-[10px] font-medium flex-shrink-0',
              subtaskInfo.done === subtaskInfo.total ? 'text-primary' : 'text-muted-foreground'
            )}>
              {subtaskInfo.done}/{subtaskInfo.total} ({Math.round((subtaskInfo.done / subtaskInfo.total) * 100)}%)
            </span>
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between pt-1 gap-2">
          {/* Due Date */}
          {task.due_date && (
            <div className={cn(
              'flex items-center gap-1 text-[11px] font-medium flex-shrink-0',
              isOverdue && !isCompleted && 'text-destructive',
              isDueToday && !isCompleted && 'text-warning',
              isCompleted && 'text-muted-foreground line-through'
            )}>
              {isOverdue && !isCompleted && <AlertTriangle className="h-3 w-3 flex-shrink-0" />}
              <CalendarIcon className="h-3 w-3 flex-shrink-0" />
              <span>{(() => {
                const [year, month, day] = task.due_date.split('-').map(Number);
                return format(new Date(year, month - 1, day), 'MMM d');
              })()}</span>
              {task.recurrence_type && (
                <Repeat className="h-3 w-3 text-primary/70 flex-shrink-0" />
              )}
            </div>
          )}
          {!task.due_date && task.recurrence_type && (
            <div className="flex items-center gap-1 text-[11px] font-medium text-primary/70">
              <Repeat className="h-3 w-3 flex-shrink-0" />
              <span className="capitalize">{task.recurrence_type}</span>
            </div>
          )}
          
          <div className="flex-1" />
          
          {/* Assignee(s) */}
          <div className="flex items-center gap-1 flex-shrink-0">
            {(() => {
              // Resolve assignees: prefer taskAssignees from junction table, fallback to assigned_to
              const hasJunctionAssignees = taskAssignees && (taskAssignees.members.length > 0 || taskAssignees.podName);
              
              if (isPublicView) {
                // Public view: show pod/group name only
                const podName = taskAssignees?.podName || assignee?.pod?.name;
                const podColor = taskAssignees?.podColor || assignee?.pod?.color;
                if (podName) {
                  return (
                    <Badge 
                      variant="outline" 
                      className="text-[10px] font-normal border-border/60 px-1.5 py-0"
                      style={podColor ? { 
                        backgroundColor: `${podColor}15`,
                        borderColor: `${podColor}40`,
                        color: podColor
                      } : undefined}
                    >
                      {podName}
                    </Badge>
                  );
                }
                return null;
              }
              
              // Agency view: show avatars
              if (hasJunctionAssignees) {
                const members = taskAssignees!.members.slice(0, 3);
                const extraCount = taskAssignees!.members.length - 3;
                return (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="flex -space-x-1.5">
                          {taskAssignees!.podName && members.length === 0 ? (
                            <Badge 
                              variant="outline" 
                              className="text-[10px] font-normal px-1.5 py-0"
                              style={taskAssignees!.podColor ? { 
                                backgroundColor: `${taskAssignees!.podColor}15`,
                                borderColor: `${taskAssignees!.podColor}40`,
                                color: taskAssignees!.podColor
                              } : undefined}
                            >
                              {taskAssignees!.podName}
                            </Badge>
                          ) : (
                            <>
                              {members.map((m) => (
                                <Avatar key={m.id} className="h-5 w-5 border border-background">
                                  <AvatarFallback className="text-[9px] font-medium bg-muted/80 text-muted-foreground">
                                    {(m.name || '').slice(0, 2).toUpperCase()}
                                  </AvatarFallback>
                                </Avatar>
                              ))}
                              {extraCount > 0 && (
                                <Avatar className="h-5 w-5 border border-background">
                                  <AvatarFallback className="text-[8px] font-medium bg-muted text-muted-foreground">
                                    +{extraCount}
                                  </AvatarFallback>
                                </Avatar>
                              )}
                            </>
                          )}
                        </div>
                      </TooltipTrigger>
                      <TooltipContent side="bottom">
                        <p>{taskAssignees!.members.map(m => m.name).join(', ')}{taskAssignees!.podName ? ` (${taskAssignees!.podName})` : ''}</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                );
              }

              if (assignee) {
                return (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Avatar className="h-5 w-5 border border-border/50">
                          <AvatarFallback className="text-[9px] font-medium bg-muted/80 text-muted-foreground">
                            {(assignee.name || 'N/A').slice(0, 2).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                      </TooltipTrigger>
                      <TooltipContent side="bottom">
                        <p>{assignee.name}</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                );
              }

              return (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Avatar className="h-5 w-5 border-2 border-dashed border-muted-foreground/30">
                        <AvatarFallback className="text-[9px] font-medium bg-transparent text-muted-foreground/40">
                          ?
                        </AvatarFallback>
                      </Avatar>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">
                      <p>Unassigned</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              );
            })()}
          </div>
        </div>
      </div>
    </div>
  );
}
