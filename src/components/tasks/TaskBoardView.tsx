import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  LayoutGrid, 
  List, 
  Plus,
  Clock,
  Trophy,
  PenLine,
  Activity,
  Bell,
  Maximize2,
  Minimize2,
} from 'lucide-react';
import { FileStack } from 'lucide-react';
import { useAllTasks, Task } from '@/hooks/useTasks';
import { useClients, Client } from '@/hooks/useClients';
import { useTaskMetrics } from '@/hooks/useTaskMetrics';
import { useVoiceNotes } from '@/hooks/useVoiceNotes';
import { useMeetings } from '@/hooks/useMeetings';
import { useCreatives } from '@/hooks/useCreatives';
import { KanbanBoard } from './KanbanBoard';
import { AgencyTaskSummary } from './AgencyTaskSummary';
import { CreateTaskModal } from './CreateTaskModal';
import { LoadTemplateDialog } from './LoadTemplateDialog';
import { TaskHistoryTab } from './TaskHistoryTab';
import { NotificationsTab, useNotifications } from './NotificationsTab';
import { useTeamMember } from '@/contexts/TeamMemberContext';

interface TaskBoardViewProps {
  clientId?: string;
  onClose?: () => void;
  isPublicView?: boolean;
}

export function TaskBoardView({ clientId, onClose, isPublicView = false }: TaskBoardViewProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: allTasks = [], isLoading: tasksLoading } = useAllTasks();
  const { data: clients = [] } = useClients();
  const [view, setView] = useState<'kanban' | 'summary' | 'activity' | 'notifications'>('kanban');
  const { currentMember } = useTeamMember();
  const { data: notifications = [] } = useNotifications(currentMember?.id);
  const unreadCount = Array.isArray(notifications) ? notifications.filter(n => !n.is_read).length : 0;
  const [showCreateTask, setShowCreateTask] = useState(false);
  const [showLoadTemplate, setShowLoadTemplate] = useState(false);
  const [expanded, setExpanded] = useState(false);

  // Deep-link: if ?task= is present, ensure we're on kanban view so KanbanBoard picks it up
  useEffect(() => {
    const taskId = searchParams.get('task');
    if (taskId && view !== 'kanban') {
      setView('kanban');
    }
  }, [searchParams]);

  // Handler for notification click → switch to kanban with task deep-link
  const handleNotificationTaskClick = useCallback((taskId: string) => {
    setSearchParams({ task: taskId }, { replace: true });
    setView('kanban');
  }, [setSearchParams]);

  // In public view, only show tasks for the specific client and filter hidden tasks
  const tasks = clientId 
    ? allTasks.filter(t => t.client_id === clientId && (!isPublicView || t.visible_to_client !== false))
    : allTasks;
  
  // In public view, only show this client in the clients list
  const filteredClients = isPublicView && clientId 
    ? clients.filter(c => c.id === clientId) 
    : clients;

  // Fetch activity data
  const { data: voiceNotes = [] } = useVoiceNotes(clientId);
  const { data: meetings = [] } = useMeetings(clientId);
  const { data: creatives = [] } = useCreatives(clientId);

  // Task metrics
  const metrics = useTaskMetrics(tasks || []);

  return (
    <Card className={`border-2 border-border transition-all ${expanded ? 'fixed inset-0 z-50 rounded-none overflow-auto' : ''}`}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-4">
            <CardTitle className="text-lg flex items-center gap-2">
              <LayoutGrid className="h-5 w-5" />
              Project Management
            </CardTitle>
            
            {/* Task Metrics - Inline with title */}
            {!isPublicView && (
              <div className="flex items-center gap-4 text-sm">
                {metrics?.avgCompletionDays !== null && metrics?.avgCompletionDays !== undefined && (
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <Clock className="h-4 w-4" />
                    <span>Avg: <span className="font-medium text-foreground">{metrics.avgCompletionDays}d</span></span>
                  </div>
                )}
                {metrics?.topCompleter && (
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <Trophy className="h-4 w-4 text-amber-500" />
                    <span>
                      <span className="font-medium text-foreground">{String(metrics.topCompleter.name || '').split(' ')[0]}</span>
                      <Badge variant="secondary" className="ml-1 text-xs">{metrics.topCompleter.count}</Badge>
                    </span>
                  </div>
                )}
                {metrics?.topCreator && (
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <PenLine className="h-4 w-4 text-blue-500" />
                    <span>
                      <span className="font-medium text-foreground">{String(metrics.topCreator.name || '').split(' ')[0]}</span>
                      <Badge variant="outline" className="ml-1 text-xs">{metrics.topCreator.count}</Badge>
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
          
          <div className="flex items-center gap-2">
            <Tabs value={view} onValueChange={(v) => setView(v as any)}>
              <TabsList className="h-8">
                {!isPublicView && (
                  <TabsTrigger value="summary" className="text-xs px-3 h-7">
                    <List className="h-3 w-3 mr-1" />
                    Summary
                  </TabsTrigger>
                )}
                <TabsTrigger value="kanban" className="text-xs px-3 h-7">
                  <LayoutGrid className="h-3 w-3 mr-1" />
                  Kanban
                </TabsTrigger>
                <TabsTrigger value="activity" className="text-xs px-3 h-7">
                  <Activity className="h-3 w-3 mr-1" />
                  Activity
                </TabsTrigger>
                {!isPublicView && (
                  <TabsTrigger value="notifications" className="text-xs px-3 h-7 relative">
                    <Bell className="h-3 w-3 mr-1" />
                    Notifications
                    {unreadCount > 0 && (
                      <span className="absolute -top-1 -right-1 h-4 min-w-[16px] rounded-full bg-destructive text-destructive-foreground text-[10px] flex items-center justify-center px-1">
                        {unreadCount}
                      </span>
                    )}
                  </TabsTrigger>
                )}
              </TabsList>
            </Tabs>
            <Button 
              size="sm" 
              variant="outline"
              onClick={() => setExpanded(!expanded)}
              title={expanded ? 'Collapse' : 'Expand'}
            >
              {expanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </Button>
            <Button size="sm" onClick={() => setShowCreateTask(true)}>
              <Plus className="h-4 w-4 mr-1" />
              Add Task
            </Button>
            {clientId && !isPublicView && (
              <Button size="sm" variant="outline" onClick={() => setShowLoadTemplate(true)}>
                <FileStack className="h-4 w-4 mr-1" />
                Load Template
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {view === 'kanban' ? (
          <KanbanBoard tasks={tasks} clients={filteredClients} clientId={clientId} isPublicView={isPublicView} />
        ) : view === 'summary' ? (
          <AgencyTaskSummary />
        ) : view === 'notifications' ? (
          <NotificationsTab onTaskClick={handleNotificationTaskClick} />
        ) : (
          <TaskHistoryTab 
            tasks={tasks} 
            clientId={clientId}
            voiceNotes={voiceNotes}
            meetings={meetings}
            creatives={creatives}
            isPublicView={isPublicView}
          />
        )}
      </CardContent>

      <CreateTaskModal
        open={showCreateTask}
        onOpenChange={setShowCreateTask}
        clients={filteredClients}
        defaultClientId={clientId}
        isPublicView={isPublicView}
      />

      <LoadTemplateDialog
        open={showLoadTemplate}
        onOpenChange={setShowLoadTemplate}
        clientId={clientId}
      />
    </Card>
  );
}
