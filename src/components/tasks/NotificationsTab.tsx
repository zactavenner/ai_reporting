import { useMemo, useState } from 'react';
import { format } from 'date-fns';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Bell, BellOff, Check, CheckCheck, Clock } from 'lucide-react';
import { useTeamMember } from '@/contexts/TeamMemberContext';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { TaskDeliveriesPanel } from './TaskDeliveriesPanel';

interface Notification {
  id: string;
  task_id: string | null;
  member_id: string;
  triggered_by: string | null;
  message: string;
  is_read: boolean;
  created_at: string;
}

export function useNotifications(memberId?: string) {
  return useQuery({
    queryKey: ['task-notifications', memberId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('task_notifications')
        .select('*')
        .eq('member_id', memberId!)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as Notification[];
    },
    enabled: !!memberId,
    refetchInterval: 30000,
  });
}

export function useMarkNotificationRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (notificationId: string) => {
      const { error } = await supabase
        .from('task_notifications')
        .update({ is_read: true })
        .eq('id', notificationId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['task-notifications'] });
    },
  });
}

export function useMarkAllNotificationsRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (memberId: string) => {
      const { error } = await supabase
        .from('task_notifications')
        .update({ is_read: true })
        .eq('member_id', memberId)
        .eq('is_read', false);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['task-notifications'] });
    },
  });
}

export function useCreateNotification() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ taskId, memberId, triggeredBy, message }: {
      taskId?: string;
      memberId: string;
      triggeredBy: string;
      message: string;
    }) => {
      const { data, error } = await supabase.functions.invoke('notify-task-member', {
        body: {
          taskId: taskId || null,
          memberId,
          triggeredBy,
          message,
        },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['task-notifications'] });
    },
  });
}

export function NotificationsTab({ onTaskClick }: { onTaskClick?: (taskId: string) => void } = {}) {
  const { currentMember } = useTeamMember();
  const { data: notifications = [], isLoading } = useNotifications(currentMember?.id);
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();
  const [filter, setFilter] = useState<'all' | 'unread'>('all');

  const filtered = useMemo(() => {
    if (filter === 'unread') return notifications.filter(n => !n.is_read);
    return notifications;
  }, [notifications, filter]);

  const unreadCount = notifications.filter(n => !n.is_read).length;

  if (!currentMember) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
        <BellOff className="h-12 w-12 mb-4 opacity-50" />
        <p className="text-sm">Select your team member profile to view notifications</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        <Clock className="h-5 w-5 animate-spin mr-2" />
        <span className="text-sm">Loading notifications...</span>
      </div>
    );
  }

  return (
    <Tabs defaultValue="inbox" className="space-y-4">
      <TabsList>
        <TabsTrigger value="inbox">Inbox</TabsTrigger>
        <TabsTrigger value="deliveries">Delivery Log</TabsTrigger>
      </TabsList>

      <TabsContent value="inbox" className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button
            variant={filter === 'all' ? 'secondary' : 'outline'}
            size="sm"
            onClick={() => setFilter('all')}
          >
            All ({notifications.length})
          </Button>
          <Button
            variant={filter === 'unread' ? 'secondary' : 'outline'}
            size="sm"
            onClick={() => setFilter('unread')}
          >
            Unread
            {unreadCount > 0 && (
              <Badge variant="destructive" className="ml-1.5 h-5 px-1.5 text-xs">
                {unreadCount}
              </Badge>
            )}
          </Button>
        </div>
        {unreadCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => markAllRead.mutate(currentMember.id)}
            disabled={markAllRead.isPending}
          >
            <CheckCheck className="h-4 w-4 mr-1" />
            Mark all read
          </Button>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
          <Bell className="h-12 w-12 mb-4 opacity-50" />
          <p className="text-sm">{filter === 'unread' ? 'No unread notifications' : 'No notifications yet'}</p>
          <p className="text-xs mt-1">You'll be notified when someone tags you</p>
        </div>
      ) : (
        <ScrollArea className="h-[500px]">
          <div className="space-y-1 pr-4">
            {filtered.map((notification) => (
              <div
                key={notification.id}
                className={cn(
                  "flex items-start gap-3 py-3 px-3 -mx-1 border-b border-border last:border-0 rounded-lg transition-colors cursor-pointer",
                  !notification.is_read ? "bg-primary/5 hover:bg-primary/10" : "hover:bg-muted/50"
                )}
                onClick={() => {
                  if (!notification.is_read) markRead.mutate(notification.id);
                  if (notification.task_id && onTaskClick) onTaskClick(notification.task_id);
                }}
              >
                <div className="mt-0.5 flex-shrink-0">
                  {notification.is_read ? (
                    <Bell className="h-5 w-5 text-muted-foreground" />
                  ) : (
                    <Bell className="h-5 w-5 text-primary" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className={cn("text-sm", !notification.is_read && "font-medium")}>
                    {notification.message}
                  </p>
                  {notification.triggered_by && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      from {notification.triggered_by}
                    </p>
                  )}
                </div>
                <div className="flex flex-col items-end flex-shrink-0">
                  <span className="text-xs font-medium text-foreground whitespace-nowrap">
                    {format(new Date(notification.created_at), 'MMM d, yyyy')}
                  </span>
                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                    {format(new Date(notification.created_at), 'h:mm a')}
                  </span>
                  {!notification.is_read && (
                    <div className="w-2 h-2 rounded-full bg-primary mt-1" />
                  )}
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      )}
      </TabsContent>

      <TabsContent value="deliveries">
        <TaskDeliveriesPanel memberId={currentMember.id} />
      </TabsContent>
    </Tabs>
  );
}
