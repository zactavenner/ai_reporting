import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Plus,
  Calendar,
  Clock,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Users,
} from 'lucide-react';
import { useAllTasks, Task } from '@/hooks/useTasks';
import { useClients } from '@/hooks/useClients';
import { TaskDetailModal } from './TaskDetailModal';
import { CreateTaskModal } from './CreateTaskModal';
import { format, isToday, isPast, isThisWeek, startOfDay } from 'date-fns';

interface AgencyTaskSummaryProps {
  onOpenFullView?: () => void;
}

export function AgencyTaskSummary({ onOpenFullView }: AgencyTaskSummaryProps) {
  const { data: tasks = [] } = useAllTasks();
  const { data: clients = [] } = useClients();
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [showCreateTask, setShowCreateTask] = useState(false);

  const clientMap = useMemo(() => {
    const map: Record<string, string> = {};
    clients.forEach(c => { map[c.id] = c.name; });
    return map;
  }, [clients]);

  // Categorize tasks
  const { overdue, dueToday, upcoming, activeTasks } = useMemo(() => {
    const today = startOfDay(new Date());
    
    const active = tasks.filter(t => t.status !== 'completed' && t.stage !== 'done');
    
    const overdue = active.filter(t => {
      if (!t.due_date) return false;
      return isPast(new Date(t.due_date)) && !isToday(new Date(t.due_date));
    });
    
    const dueToday = active.filter(t => {
      if (!t.due_date) return false;
      return isToday(new Date(t.due_date));
    });
    
    const upcoming = active.filter(t => {
      if (!t.due_date) return false;
      const dueDate = new Date(t.due_date);
      return isThisWeek(dueDate) && !isToday(dueDate) && !isPast(dueDate);
    });
    
    return { overdue, dueToday, upcoming, activeTasks: active };
  }, [tasks]);

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'high': return 'destructive';
      case 'medium': return 'secondary';
      case 'low': return 'outline';
      default: return 'secondary';
    }
  };

  const TaskItem = ({ task }: { task: Task }) => (
    <div 
      className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/50 cursor-pointer transition-colors"
      onClick={() => setSelectedTask(task)}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium truncate">{task.title}</span>
          <Badge variant={getPriorityColor(task.priority)} className="text-xs shrink-0">
            {task.priority}
          </Badge>
        </div>
        {task.client_id && (
          <p className="text-xs text-muted-foreground truncate mt-1">
            {clientMap[task.client_id] || 'Unknown Client'}
          </p>
        )}
      </div>
      <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
    </div>
  );

  return (
    <>
      <Card className="border-2 border-border">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg flex items-center gap-2">
              <Users className="h-5 w-5" />
              Task Overview
            </CardTitle>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => setShowCreateTask(true)}>
                <Plus className="h-4 w-4 mr-1" />
                Add Task
              </Button>
              {onOpenFullView && (
                <Button size="sm" variant="ghost" onClick={onOpenFullView}>
                  View All
                  <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Overdue */}
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-destructive">
                <AlertTriangle className="h-4 w-4" />
                <span className="font-semibold text-sm">Overdue ({overdue.length})</span>
              </div>
              <ScrollArea className="h-48">
                <div className="space-y-2 pr-3">
                  {overdue.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-4">
                      No overdue tasks
                    </p>
                  ) : (
                    overdue.slice(0, 5).map(task => (
                      <TaskItem key={task.id} task={task} />
                    ))
                  )}
                </div>
              </ScrollArea>
            </div>

            {/* Due Today */}
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-amber-500">
                <Clock className="h-4 w-4" />
                <span className="font-semibold text-sm">Due Today ({dueToday.length})</span>
              </div>
              <ScrollArea className="h-48">
                <div className="space-y-2 pr-3">
                  {dueToday.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-4">
                      No tasks due today
                    </p>
                  ) : (
                    dueToday.slice(0, 5).map(task => (
                      <TaskItem key={task.id} task={task} />
                    ))
                  )}
                </div>
              </ScrollArea>
            </div>

            {/* Upcoming This Week */}
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-primary">
                <Calendar className="h-4 w-4" />
                <span className="font-semibold text-sm">This Week ({upcoming.length})</span>
              </div>
              <ScrollArea className="h-48">
                <div className="space-y-2 pr-3">
                  {upcoming.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-4">
                      No upcoming tasks
                    </p>
                  ) : (
                    upcoming.slice(0, 5).map(task => (
                      <TaskItem key={task.id} task={task} />
                    ))
                  )}
                </div>
              </ScrollArea>
            </div>
          </div>

          {/* Stats Bar */}
          <div className="mt-4 pt-4 border-t flex items-center justify-between text-sm text-muted-foreground">
            <span>
              <span className="font-semibold text-foreground">{activeTasks.length}</span> active tasks across{' '}
              <span className="font-semibold text-foreground">{clients.length}</span> clients
            </span>
            <div className="flex items-center gap-4">
              <span className="flex items-center gap-1">
                <CheckCircle2 className="h-4 w-4 text-chart-2" />
                {tasks.filter(t => t.status === 'completed').length} completed
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      <TaskDetailModal
        task={selectedTask}
        open={!!selectedTask}
        onOpenChange={(open) => !open && setSelectedTask(null)}
        clientId={selectedTask?.client_id || undefined}
        clientName={selectedTask?.client_id ? clientMap[selectedTask.client_id] : undefined}
      />

      <CreateTaskModal
        open={showCreateTask}
        onOpenChange={setShowCreateTask}
        clients={clients}
      />
    </>
  );
}
