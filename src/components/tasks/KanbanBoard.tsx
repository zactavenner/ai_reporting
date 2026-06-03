import { useState, useMemo, useEffect } from 'react';
import { 
  DndContext, 
  DragEndEvent, 
  DragOverlay,
  DragStartEvent,
  closestCorners,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { 
  Plus, 
  MoreHorizontal, 
  Calendar as CalendarIcon,
  User,
  Paperclip,
  MessageSquare,
  Search,
  Filter,
  CheckCircle2,
  Eye,
  EyeOff,
  Building2,
  Users,
  UserCircle,
  Clock,
  AlertTriangle,
  ClipboardPaste,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
 import { Task, useUpdateTask, useAgencyMembers, AgencyMember, useAddTaskHistory, useBulkUpdateTasks, useBulkDeleteTasks } from '@/hooks/useTasks';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Client } from '@/hooks/useClients';
 import { TaskDetailPanel } from './TaskDetailPanel';
import { CreateTaskModal } from './CreateTaskModal';
import { BulkAddTasksDialog } from './BulkAddTasksDialog';
import { KanbanColumn } from './KanbanColumn';
import { KanbanTaskCard } from './KanbanTaskCard';
 import { BulkActionBar } from './BulkActionBar';
import { format, isToday, isPast, isTomorrow, isThisWeek, addDays, startOfDay, endOfDay } from 'date-fns';
import { cn } from '@/lib/utils';
import { useTeamMember } from '@/contexts/TeamMemberContext';
 import { useSearchParams } from 'react-router-dom';

interface KanbanBoardProps {
  tasks: Task[];
  clients: Client[];
  clientId?: string;
  isPublicView?: boolean;
}

const STAGES = [
  { id: 'client_tasks', label: 'Client Tasks', color: 'bg-cyan-500/20' },
  { id: 'todo', label: 'To-Do', color: 'bg-blue-500/20' },
  { id: 'in_progress', label: 'In Progress', color: 'bg-orange-500/20' },
  { id: 'stuck', label: 'Stuck', color: 'bg-destructive/20' },
  { id: 'agency_review', label: 'Agency Review', color: 'bg-indigo-500/20', agencyOnly: true },
  { id: 'review', label: 'Client Review', color: 'bg-purple-500/20' },
  { id: 'revisions', label: 'Revisions', color: 'bg-amber-500/20' },
  { id: 'done', label: 'Completed', color: 'bg-green-500/20' },
];

const MY_TASKS_KEY = 'kanban_my_tasks_filter';

export function KanbanBoard({ tasks, clients, clientId, isPublicView = false }: KanbanBoardProps) {
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [pendingOpenTaskId, setPendingOpenTaskId] = useState<string | null>(null);
  const [showCreateTask, setShowCreateTask] = useState(false);
  const [createTaskStage, setCreateTaskStage] = useState('todo');
  const [showBulkAdd, setShowBulkAdd] = useState(false);
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showCompleted, setShowCompleted] = useState(false);
  const [filterClientId, setFilterClientId] = useState<string>('');
  const [filterAssigneeId, setFilterAssigneeId] = useState<string>('');
  const [showMyTasksOnly, setShowMyTasksOnly] = useState<boolean>(false);
  const [dueDateFilter, setDueDateFilter] = useState<string>('all');
   const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set());
  
  const updateTask = useUpdateTask();
  const addHistory = useAddTaskHistory();
   const bulkUpdateTasks = useBulkUpdateTasks();
   const bulkDeleteTasks = useBulkDeleteTasks();
  const { data: agencyMembers = [] } = useAgencyMembers();
  const { currentMember } = useTeamMember();
   const [searchParams, setSearchParams] = useSearchParams();
   
    // Handle deep link to specific task
    useEffect(() => {
      const taskId = searchParams.get('task');
      if (taskId && tasks.length > 0) {
        const task = tasks.find(t => t.id === taskId);
        if (task) {
          setSelectedTask(task);
          // Clear the query param after opening
          searchParams.delete('task');
          setSearchParams(searchParams, { replace: true });
        }
      }
    }, [searchParams, tasks, setSearchParams]);

    // Listen for open-task events (e.g. after duplicating)
    useEffect(() => {
      const handler = (e: Event) => {
        const taskId = (e as CustomEvent).detail?.taskId;
        if (taskId) {
          const task = tasks.find(t => t.id === taskId);
          if (task) {
            setSelectedTask(task);
          } else {
            // Task not yet in list (query still refreshing), store for later
            setPendingOpenTaskId(taskId);
          }
        }
      };
      window.addEventListener('open-task', handler);
      return () => window.removeEventListener('open-task', handler);
    }, [tasks]);

    // Open pending task once it appears in tasks list
    useEffect(() => {
      if (pendingOpenTaskId && tasks.length > 0) {
        const task = tasks.find(t => t.id === pendingOpenTaskId);
        if (task) {
          setSelectedTask(task);
          setPendingOpenTaskId(null);
        }
      }
    }, [tasks, pendingOpenTaskId]);
  
  // Initialize "My Tasks" filter based on logged-in member
  useEffect(() => {
    if (currentMember && !isPublicView) {
      // Check session storage for preference
      const stored = sessionStorage.getItem(MY_TASKS_KEY);
      if (stored === null) {
        // Default to showing user's own tasks
        setShowMyTasksOnly(true);
        setFilterAssigneeId(currentMember.id);
      } else {
        setShowMyTasksOnly(stored === 'true');
        if (stored === 'true') {
          setFilterAssigneeId(currentMember.id);
        }
      }
    }
  }, [currentMember, isPublicView]);
  
  // Toggle between my tasks and all tasks
  const handleToggleMyTasks = () => {
    const newValue = !showMyTasksOnly;
    setShowMyTasksOnly(newValue);
    sessionStorage.setItem(MY_TASKS_KEY, String(newValue));
    
    if (newValue && currentMember) {
      setFilterAssigneeId(currentMember.id);
    } else {
      setFilterAssigneeId('');
    }
  };
  
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 4,
      },
    })
  );

  // Bulk fetch all task assignees for the current task set.
  // We fetch ALL assignees (paginated) rather than filtering by taskIds, because:
  //  (1) `.in('task_id', [...])` with thousands of ids hits URL/row caps and silently truncates,
  //  (2) the result set itself can exceed Supabase's default 1000-row cap.
  // This guarantees no assignment row is missed when filtering by a specific user/pod.
  const taskIds = useMemo(() => tasks.map(t => t.id), [tasks]);
  const taskIdSet = useMemo(() => new Set(taskIds), [taskIds]);
  const { data: allTaskAssigneesRaw = [] } = useQuery({
    queryKey: ['all-task-assignees-full'],
    queryFn: async () => {
      const PAGE = 1000;
      let from = 0;
      const rows: any[] = [];
      while (true) {
        const { data, error } = await supabase
          .from('task_assignees')
          .select('task_id, member_id, pod_id, member:agency_members(id, name, pod_id, pod:agency_pods(id, name, color)), pod:agency_pods(id, name, color)')
          .range(from, from + PAGE - 1);
        if (error) throw error;
        const batch = data || [];
        rows.push(...batch);
        if (batch.length < PAGE) break;
        from += PAGE;
      }
      return rows;
    },
    staleTime: 30_000,
  });
  const allTaskAssignees = useMemo(
    () => allTaskAssigneesRaw.filter((ta: any) => taskIdSet.has(ta.task_id)),
    [allTaskAssigneesRaw, taskIdSet]
  );

  // Build a set of task IDs assigned to the current member (via individual or pod assignment)
  const myTaskIds = useMemo(() => {
    if (!currentMember) return new Set<string>();
    const ids = new Set<string>();
    const myMember = agencyMembers.find(m => m.id === currentMember.id);
    const myPodId = myMember?.pod_id;
    allTaskAssignees.forEach((ta: any) => {
      if (ta.member_id === currentMember.id) {
        ids.add(ta.task_id);
      }
      if (ta.pod_id && myPodId && ta.pod_id === myPodId) {
        ids.add(ta.task_id);
      }
    });
    return ids;
  }, [currentMember, allTaskAssignees, agencyMembers]);

  // Direct assignments only — used for "My Tasks" filter (excludes pod-level assignments)
  const myDirectTaskIds = useMemo(() => {
    if (!currentMember) return new Set<string>();
    const ids = new Set<string>();
    allTaskAssignees.forEach((ta: any) => {
      if (ta.member_id === currentMember.id) {
        ids.add(ta.task_id);
      }
    });
    return ids;
  }, [currentMember, allTaskAssignees]);

  // Paused clients — their tasks are hidden from global views and greyed out on
  // the per-client board.
  const pausedClientIds = useMemo(() => {
    const ids = new Set<string>();
    (clients || []).forEach((c: any) => {
      if (c?.status === 'paused') ids.add(c.id);
    });
    return ids;
  }, [clients]);


  // Filter tasks
  const filteredTasks = useMemo(() => {
    // Filter out subtasks from top-level board view
    let filtered = tasks.filter(t => !t.parent_task_id);

    // Hide agency-only stage tasks from public/client view
    if (isPublicView) {
      filtered = filtered.filter(t => t.stage !== 'agency_review');
    }
    
    // Filter by client - use prop clientId if provided, otherwise use filter dropdown
    const effectiveClientId = clientId || (filterClientId && filterClientId !== 'all' ? filterClientId : '');
    if (effectiveClientId) {
      filtered = filtered.filter(t => t.client_id === effectiveClientId);
    } else {
      // Global/agency view: hide tasks belonging to paused clients.
      // When a specific client is being viewed (effectiveClientId set), paused tasks
      // remain visible but are greyed out on the board via the card styling.
      filtered = filtered.filter(t => !t.client_id || !pausedClientIds.has(t.client_id));
    }
    
    // Filter by assignee - check both legacy assigned_to AND task_assignees junction table
    if (filterAssigneeId && filterAssigneeId !== 'all') {
      if (filterAssigneeId === 'unassigned') {
        filtered = filtered.filter(t => {
          const hasLegacyAssignee = !!t.assigned_to;
          const hasJunctionAssignee = allTaskAssignees.some((ta: any) => ta.task_id === t.id);
          return !hasLegacyAssignee && !hasJunctionAssignee;
        });
      } else if (showMyTasksOnly && currentMember) {
        // "My Tasks" mode: show tasks assigned to me directly only (not via pod)
        filtered = filtered.filter(t => 
          t.assigned_to === currentMember.id || myDirectTaskIds.has(t.id)
        );
      } else {
        // Specific assignee filter: include legacy field, direct junction assignment,
        // AND tasks assigned to a pod that this member belongs to.
        const targetMember = agencyMembers.find(m => m.id === filterAssigneeId);
        const targetPodId = targetMember?.pod_id || null;
        filtered = filtered.filter(t => {
          if (t.assigned_to === filterAssigneeId) return true;
          return allTaskAssignees.some((ta: any) =>
            ta.task_id === t.id && (
              ta.member_id === filterAssigneeId ||
              (targetPodId && ta.pod_id === targetPodId)
            )
          );
        });
      }
    }
    
    // Filter by search
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(t => 
        t.title.toLowerCase().includes(query) ||
        t.description?.toLowerCase().includes(query)
      );
    }
    
    // Filter by due date
    if (dueDateFilter && dueDateFilter !== 'all') {
      const now = new Date();
      const today = startOfDay(now);
      
      filtered = filtered.filter(t => {
        if (!t.due_date) {
          return dueDateFilter === 'no_date';
        }
        
        const dueDate = new Date(t.due_date);
        
        switch (dueDateFilter) {
          case 'overdue':
            return isPast(dueDate) && !isToday(dueDate) && t.stage !== 'done' && t.status !== 'completed';
          case 'today':
            return isToday(dueDate);
          case 'tomorrow':
            return isTomorrow(dueDate);
          case 'this_week':
            return isThisWeek(dueDate, { weekStartsOn: 1 });
          case 'no_date':
            return false; // Already handled above
          default:
            return true;
        }
      });
    }
    
    // Filter completed
    if (!showCompleted) {
      filtered = filtered.filter(t => t.status !== 'completed');
    }
    
    return filtered;
  }, [tasks, clientId, filterClientId, filterAssigneeId, searchQuery, showCompleted, dueDateFilter, allTaskAssignees, myDirectTaskIds, showMyTasksOnly, currentMember, isPublicView, pausedClientIds]);

  // Group by stage
  const tasksByStage = useMemo(() => {
    const grouped: Record<string, Task[]> = {};
    STAGES.forEach(stage => {
      grouped[stage.id] = filteredTasks.filter(t => t.stage === stage.id);
    });
    return grouped;
  }, [filteredTasks]);

  const handleDragStart = (event: DragStartEvent) => {
    const task = filteredTasks.find(t => t.id === event.active.id);
    if (task) setActiveTask(task);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    setActiveTask(null);
    
    const { active, over } = event;
    if (!over) return;
    
    const taskId = active.id as string;
    const overId = over.id as string;

    // Resolve target stage: either dropped directly on a column,
    // or dropped on a task card inside a column (use that task's stage).
    let targetStage = STAGES.find(s => s.id === overId);
    if (!targetStage) {
      const overTask = filteredTasks.find(t => t.id === overId);
      if (overTask) {
        targetStage = STAGES.find(s => s.id === overTask.stage);
      }
    }

    if (targetStage) {
      const task = filteredTasks.find(t => t.id === taskId);
      if (task && task.stage !== targetStage.id) {
        const isCompleting = targetStage.id === 'done';
        const oldStageName = STAGES.find(s => s.id === task.stage)?.label || task.stage;
        
        // Add history entry
        await addHistory.mutateAsync({
          taskId,
          action: isCompleting ? 'completed' : 'status_changed',
          oldValue: oldStageName,
          newValue: targetStage.label,
          changedBy: currentMember?.name || 'System',
        });
        
        await updateTask.mutateAsync({
          id: taskId,
          stage: targetStage.id,
          status: targetStage.id === 'done' ? 'completed' : task.status === 'completed' ? 'in_progress' : task.status,
          completed_at: targetStage.id === 'done' ? new Date().toISOString() : null,
        });

        // Fire Slack notification when task moves to review
        if (targetStage.id === 'review' && task.client_id) {
          supabase.functions.invoke('send-task-review-slack', {
            body: { taskId: task.id, clientId: task.client_id },
          }).catch(err => console.error('Slack review notification failed:', err));
        }
      }
    }
  };

  const handleAddTask = (stageId: string) => {
    setCreateTaskStage(stageId);
    setShowCreateTask(true);
  };

  const clientMap = useMemo(() => {
    const map: Record<string, string> = {};
    clients.forEach(c => { map[c.id] = c.name; });
    return map;
  }, [clients]);

  const memberMap = useMemo(() => {
    const map: Record<string, AgencyMember> = {};
    agencyMembers.forEach(m => { map[m.id] = m; });
    return map;
  }, [agencyMembers]);



  // Bulk fetch subtask counts for all visible tasks
  const { data: subtaskCounts = {} } = useQuery({
    queryKey: ['subtask-counts', taskIds],
    queryFn: async () => {
      if (taskIds.length === 0) return {};
      const { data, error } = await supabase
        .from('tasks')
        .select('parent_task_id, stage')
        .in('parent_task_id', taskIds);
      if (error) throw error;
      const map: Record<string, { total: number; done: number }> = {};
      (data || []).forEach((row: any) => {
        if (!row.parent_task_id) return;
        if (!map[row.parent_task_id]) map[row.parent_task_id] = { total: 0, done: 0 };
        map[row.parent_task_id].total++;
        if (row.stage === 'done') map[row.parent_task_id].done++;
      });
      return map;
    },
    enabled: taskIds.length > 0,
  });

  // Build a map: taskId → { assignee: AgencyMember | null, podName: string | null }
  const taskAssigneeMap = useMemo(() => {
    const map: Record<string, { members: AgencyMember[]; podName: string | null; podColor: string | null }> = {};
    allTaskAssignees.forEach((ta: any) => {
      if (!map[ta.task_id]) {
        map[ta.task_id] = { members: [], podName: null, podColor: null };
      }
      if (ta.member) {
        map[ta.task_id].members.push(ta.member as AgencyMember);
      }
      if (ta.pod) {
        map[ta.task_id].podName = ta.pod.name;
        map[ta.task_id].podColor = ta.pod.color;
      }
    });
    return map;
  }, [allTaskAssignees]);

   const handleTaskSelect = (taskId: string, selected: boolean) => {
     setSelectedTaskIds(prev => {
       const next = new Set(prev);
       if (selected) {
         next.add(taskId);
       } else {
         next.delete(taskId);
       }
       return next;
     });
   };
   
   const handleClearSelection = () => {
     setSelectedTaskIds(new Set());
   };
   
   const handleBulkDueDateChange = async (date: Date) => {
     const ids = Array.from(selectedTaskIds);
     await bulkUpdateTasks.mutateAsync({
       ids,
       updates: { due_date: format(date, 'yyyy-MM-dd') },
     });
     setSelectedTaskIds(new Set());
   };
   
   const handleBulkDelete = async () => {
     const ids = Array.from(selectedTaskIds);
     await bulkDeleteTasks.mutateAsync(ids);
     setSelectedTaskIds(new Set());
   };
   
   const handleBulkMarkComplete = async () => {
     const ids = Array.from(selectedTaskIds);
     await bulkUpdateTasks.mutateAsync({
       ids,
       updates: { 
         stage: 'done',
         status: 'completed',
         completed_at: new Date().toISOString(),
       },
     });
     setSelectedTaskIds(new Set());
   };
 
   // Clear selection on Escape key
   useEffect(() => {
     const handleKeyDown = (e: KeyboardEvent) => {
       if (e.key === 'Escape') {
         setSelectedTaskIds(new Set());
       }
     };
     window.addEventListener('keydown', handleKeyDown);
     return () => window.removeEventListener('keydown', handleKeyDown);
   }, []);
 
  return (
    <>
      <div className="space-y-4">
        {/* Toolbar */}
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search tasks..."
                className="pl-9 w-48 md:w-64"
              />
            </div>
            
            {/* Client Filter - only show if not in public view and not already filtered by clientId prop */}
            {!clientId && !isPublicView && (
              <Select value={filterClientId} onValueChange={setFilterClientId}>
                <SelectTrigger className="w-40">
                  <Building2 className="h-4 w-4 mr-2 text-muted-foreground" />
                  <SelectValue placeholder="All Clients" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Clients</SelectItem>
                  {clients.map(client => (
                    <SelectItem key={client.id} value={client.id}>
                      {client.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            
            {/* Assignee Filter - hide in public view */}
            {!isPublicView && !showMyTasksOnly && (
              <Select value={filterAssigneeId} onValueChange={setFilterAssigneeId}>
                <SelectTrigger className="w-40">
                  <Users className="h-4 w-4 mr-2 text-muted-foreground" />
                  <SelectValue placeholder="All Assignees" />
                </SelectTrigger>
                <SelectContent>
                   <SelectItem value="all">All Assignees</SelectItem>
                   <SelectItem value="unassigned">Unassigned</SelectItem>
                   {agencyMembers.map(member => (
                     <SelectItem key={member.id} value={member.id}>
                       {member.name}
                     </SelectItem>
                   ))}
               </SelectContent>
            </Select>
            )}
            
            {/* Due Date Filter */}
            <Select value={dueDateFilter} onValueChange={setDueDateFilter}>
              <SelectTrigger className="w-40">
                <Clock className="h-4 w-4 mr-2 text-muted-foreground" />
                <SelectValue placeholder="Due Date" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Dates</SelectItem>
                <SelectItem value="overdue">
                  <span className="flex items-center gap-2">
                    <AlertTriangle className="h-3 w-3 text-destructive" />
                    Overdue
                  </span>
                </SelectItem>
                <SelectItem value="today">Due Today</SelectItem>
                <SelectItem value="tomorrow">Due Tomorrow</SelectItem>
                <SelectItem value="this_week">This Week</SelectItem>
                <SelectItem value="no_date">No Due Date</SelectItem>
              </SelectContent>
            </Select>
          </div>
          
          <div className="flex items-center gap-2">
            {/* My Tasks / All Tasks Toggle - only for logged in team members */}
            {!isPublicView && currentMember && (
              <Button
                variant={showMyTasksOnly ? 'default' : 'outline'}
                size="sm"
                onClick={handleToggleMyTasks}
              >
                <UserCircle className="h-4 w-4 mr-2" />
                {showMyTasksOnly ? 'My Tasks' : 'All Tasks'}
              </Button>
            )}
            
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowCompleted(!showCompleted)}
            >
              {showCompleted ? (
                <>
                  <EyeOff className="h-4 w-4 mr-2" />
                  Hide Completed
                </>
              ) : (
                <>
                  <Eye className="h-4 w-4 mr-2" />
                  Show Completed
                </>
              )}
            </Button>
            {!isPublicView && (
              <Button variant="outline" size="sm" onClick={() => setShowBulkAdd(true)}>
                <ClipboardPaste className="h-4 w-4 mr-2" />
                Bulk add
              </Button>
            )}
          </div>
        </div>

        {/* Task Stats Bar */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
          {(() => {
            const thisWeekTasks = filteredTasks.filter(t => {
              if (!t.due_date) return false;
              return isThisWeek(new Date(t.due_date), { weekStartsOn: 1 });
            });
            const dueTodayCount = filteredTasks.filter(t => t.due_date && isToday(new Date(t.due_date))).length;
            const totalCount = filteredTasks.length;
            const completedCount = tasks.filter(t => t.status === 'completed' && !t.parent_task_id).length;
            const allNonSubtasks = tasks.filter(t => !t.parent_task_id).length;
            const completionRate = allNonSubtasks > 0 ? Math.round((completedCount / allNonSubtasks) * 100) : 0;
            const overdueCount = filteredTasks.filter(t => {
              if (!t.due_date) return false;
              if (t.stage === 'done' || t.status === 'completed') return false;
              return isPast(new Date(t.due_date)) && !isToday(new Date(t.due_date));
            }).length;
            const recurringCount = filteredTasks.filter(t => t.recurrence_type && t.recurrence_type !== 'none').length;

            const stats = [
              { label: 'This Week', value: thisWeekTasks.length, color: 'text-foreground' },
              { label: 'Due Today', value: dueTodayCount, color: dueTodayCount > 0 ? 'text-orange-500' : 'text-foreground' },
              { label: 'Total', value: totalCount, color: 'text-foreground' },
              { label: 'Completion', value: `${completionRate}%`, color: 'text-foreground' },
              { label: 'Overdue', value: overdueCount, color: overdueCount > 0 ? 'text-destructive' : 'text-foreground' },
              { label: 'Recurring', value: recurringCount, color: 'text-foreground' },
            ];

            return stats.map((stat) => (
              <div key={stat.label} className="rounded-lg border border-border bg-card px-4 py-3">
                <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{stat.label}</p>
                <p className={cn('text-2xl font-bold mt-0.5', stat.color)}>{stat.value}</p>
              </div>
            ));
          })()}
        </div>

        {/* Kanban Board */}
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <div className="flex gap-4 overflow-x-auto pb-4">
            {STAGES.filter(stage => !(isPublicView && (stage as any).agencyOnly)).map(stage => (
              <KanbanColumn
                key={stage.id}
                stage={stage}
                tasks={tasksByStage[stage.id]}
                clientMap={clientMap}
                memberMap={memberMap}
                taskAssigneeMap={taskAssigneeMap}
                subtaskCounts={subtaskCounts}
                onAddTask={() => handleAddTask(stage.id)}
                onTaskClick={setSelectedTask}
                isPublicView={isPublicView}
                 selectedTaskIds={selectedTaskIds}
                 onTaskSelect={handleTaskSelect}
                 pausedClientIds={pausedClientIds}
              />
            ))}
          </div>

          <DragOverlay>
            {activeTask && (
              <div className="p-3 rounded-lg bg-card border shadow-xl rotate-1 scale-105 w-80 opacity-90">
                <div className="flex items-center gap-2 mb-1">
                  <Badge variant={activeTask.priority === 'high' ? 'destructive' : 'secondary'} className="text-[10px] uppercase font-semibold px-1.5 py-0">
                    {activeTask.priority}
                  </Badge>
                  {activeTask.client_id && clientMap[activeTask.client_id] && (
                    <span className="text-[10px] text-muted-foreground bg-muted/60 px-1.5 py-0.5 rounded">
                      {clientMap[activeTask.client_id]}
                    </span>
                  )}
                </div>
                <h4 className="font-medium text-sm leading-tight">{activeTask.title}</h4>
              </div>
            )}
          </DragOverlay>
        </DndContext>
      </div>

       <TaskDetailPanel
        task={selectedTask}
        open={!!selectedTask}
        onOpenChange={(open) => !open && setSelectedTask(null)}
        clientId={selectedTask?.client_id || undefined}
        clientName={selectedTask?.client_id ? clientMap[selectedTask.client_id] : undefined}
        isPublicView={isPublicView}
      />

      <CreateTaskModal
        open={showCreateTask}
        onOpenChange={setShowCreateTask}
        clients={clients}
        defaultClientId={clientId}
        isPublicView={isPublicView}
        defaultStage={createTaskStage}
      />

      <BulkAddTasksDialog
        open={showBulkAdd}
        onOpenChange={setShowBulkAdd}
        clientId={clientId}
      />
 
       <BulkActionBar
         selectedCount={selectedTaskIds.size}
         onChangeDueDate={handleBulkDueDateChange}
         onMarkComplete={handleBulkMarkComplete}
         onDelete={handleBulkDelete}
         onClearSelection={handleClearSelection}
         isUpdating={bulkUpdateTasks.isPending}
         isDeleting={bulkDeleteTasks.isPending}
         isCompleting={bulkUpdateTasks.isPending}
       />
    </>
  );
}
