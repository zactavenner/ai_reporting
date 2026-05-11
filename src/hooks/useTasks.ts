import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { fetchAllRows } from '@/lib/fetchAllRows';

export interface Task {
  id: string;
  client_id: string | null;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  stage: string;
  assigned_to: string | null;
  assigned_client_name: string | null;
  due_date: string | null;
  created_by: string | null;
  completed_at: string | null;
  meeting_id: string | null;
  parent_task_id: string | null;
  show_subtasks_to_client: boolean;
  visible_to_client: boolean;
  recurrence_type: string | null;
  recurrence_interval: number | null;
  recurrence_next_at: string | null;
  recurrence_parent_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface TaskComment {
  id: string;
  task_id: string;
  author_name: string;
  content: string;
  audio_url: string | null;
  duration_seconds: number | null;
  transcript: string | null;
  comment_type: 'text' | 'voice';
  created_at: string;
}

export interface TaskFile {
  id: string;
  task_id: string;
  file_name: string;
  file_url: string;
  file_type: string | null;
  uploaded_by: string | null;
  created_at: string;
}

export interface TaskHistory {
  id: string;
  task_id: string;
  action: string;
  old_value: string | null;
  new_value: string | null;
  changed_by: string | null;
  created_at: string;
}

export interface AgencyMember {
  id: string;
  name: string;
  email: string;
  role: string;
  pod_id: string | null;
  pod?: {
    id: string;
    name: string;
    color: string;
    description: string | null;
  };
  created_at: string;
  updated_at: string;
}

// Fetch all tasks across clients (agency level)
export function useAllTasks() {
  return useQuery({
    queryKey: ['all-tasks'],
    queryFn: async () => {
      return await fetchAllRows<Task>((sb) =>
        sb.from('tasks')
          .select('*')
          .order('created_at', { ascending: false })
      );
    },
  });
}

// Fetch tasks for a specific client
export function useTasks(clientId?: string) {
  return useQuery({
    queryKey: ['tasks', clientId],
    queryFn: async () => {
      return await fetchAllRows<Task>((sb) => {
        let query = sb.from('tasks').select('*');
        
        if (clientId) {
          query = query.eq('client_id', clientId);
        }
        
        return query.order('created_at', { ascending: false });
      });
    },
    enabled: true,
  });
}

// Fetch task comments
export function useTaskComments(taskId?: string) {
  return useQuery({
    queryKey: ['task-comments', taskId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('task_comments')
        .select('*')
        .eq('task_id', taskId!)
        .order('created_at', { ascending: true });
      
      if (error) throw error;
      return data as TaskComment[];
    },
    enabled: !!taskId,
  });
}

// Fetch task files
export function useTaskFiles(taskId?: string) {
  return useQuery({
    queryKey: ['task-files', taskId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('task_files')
        .select('*')
        .eq('task_id', taskId!)
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      return data as TaskFile[];
    },
    enabled: !!taskId,
  });
}

// Fetch task history
export function useTaskHistory(taskId?: string) {
  return useQuery({
    queryKey: ['task-history', taskId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('task_history')
        .select('*')
        .eq('task_id', taskId!)
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      return data as TaskHistory[];
    },
    enabled: !!taskId,
  });
}

// Fetch subtasks for a parent task
export function useSubtasks(parentTaskId?: string) {
  return useQuery({
    queryKey: ['subtasks', parentTaskId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tasks')
        .select('*')
        .eq('parent_task_id', parentTaskId!)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return data as Task[];
    },
    enabled: !!parentTaskId,
  });
}


// Fetch agency members with pod info
export function useAgencyMembers() {
  return useQuery({
    queryKey: ['agency-members'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('agency_members')
        .select('*, pod:agency_pods(*)')
        .order('name');
      
      if (error) throw error;
      return data as AgencyMember[];
    },
  });
}

// Send task notification via edge function
async function sendTaskNotification(taskId: string, action: 'assigned' | 'updated' | 'due_reminder' | 'completed', clientId?: string | null) {
  try {
    const { data, error } = await supabase.functions.invoke('send-task-notification', {
      body: { taskId, action, clientId },
    });
    if (error) {
      console.error('Task notification error:', error);
    } else {
      console.log('Task notification sent:', data);
    }
  } catch (err) {
    console.error('Failed to send task notification:', err);
  }
}

// Post to #6-task-updates Slack channel
async function postTaskFeed(event: 'task_created' | 'task_completed', task: any, userName?: string) {
  try {
    await supabase.functions.invoke('slack-task-feed', {
      body: { event, task, user_name: userName },
    });
  } catch (err) {
    console.error('slack-task-feed error:', err);
  }
}

// Create task mutation
export function useCreateTask() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (task: Omit<Partial<Task>, 'id'> & { title: string }) => {
      const insertData: any = { ...task };
      
      const { data, error } = await supabase
        .from('tasks')
        .insert(insertData)
        .select()
        .single();
      
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.invalidateQueries({ queryKey: ['all-tasks'] });
      queryClient.invalidateQueries({ queryKey: ['subtasks'] });
      toast.success('Task created successfully');
      
      // Send notification if task is assigned
      if (data.assigned_to) {
        sendTaskNotification(data.id, 'assigned', data.client_id);
      } else {
        // No assignee - let AI suggest one based on title/description/team context
        (async () => {
          try {
            const { data: result, error } = await supabase.functions.invoke('ai-auto-assign-task', {
              body: { taskId: data.id },
            });
            if (error) {
              console.error('AI auto-assign error:', error);
              return;
            }
            if (result?.assigned && result?.member_name) {
              toast.success(`AI assigned task to ${result.member_name}`);
              queryClient.invalidateQueries({ queryKey: ['tasks'] });
              queryClient.invalidateQueries({ queryKey: ['all-tasks'] });
            }
          } catch (err) {
            console.error('AI auto-assign failed:', err);
          }
        })();
      }
      postTaskFeed('task_created', data);
    },
    onError: (error: Error) => {
      toast.error('Failed to create task: ' + error.message);
    },
  });
}

// Update task mutation
export function useUpdateTask() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<Task> & { id: string }) => {
      const { data, error } = await supabase
        .from('tasks')
        .update(updates)
        .eq('id', id)
        .select()
        .single();
      
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.invalidateQueries({ queryKey: ['all-tasks'] });
      queryClient.invalidateQueries({ queryKey: ['subtasks'] });
      
      // Send notification for completion
      if (data.status === 'completed') {
        sendTaskNotification(data.id, 'completed', data.client_id);
        postTaskFeed('task_completed', data);
      }
    },
    onError: (error: Error) => {
      toast.error('Failed to update task: ' + error.message);
    },
  });
}

// Complete a recurring task: mark done, then create the next occurrence
export function useCompleteRecurringTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (task: Task) => {
      // 1. Mark the current task as completed
      const now = new Date().toISOString();
      const { error: updateErr } = await supabase
        .from('tasks')
        .update({ status: 'completed', stage: 'done', completed_at: now })
        .eq('id', task.id);
      if (updateErr) throw updateErr;

      // 2. Calculate the next due date
      if (!task.recurrence_type || !task.due_date) return null;

      const interval = task.recurrence_interval || 1;
      const nextDue = new Date(task.due_date);

      switch (task.recurrence_type) {
        case 'daily':
          nextDue.setDate(nextDue.getDate() + interval);
          break;
        case 'weekly':
          nextDue.setDate(nextDue.getDate() + 7 * interval);
          break;
        case 'monthly':
          nextDue.setMonth(nextDue.getMonth() + interval);
          break;
      }

      const nextDueStr = nextDue.toISOString().slice(0, 10);

      // 3. Create the next occurrence
      const { data: newTask, error: insertErr } = await supabase
        .from('tasks')
        .insert({
          title: task.title,
          description: task.description,
          client_id: task.client_id,
          priority: task.priority,
          stage: task.stage === 'done' ? 'todo' : task.stage,
          status: 'todo',
          assigned_to: task.assigned_to,
          assigned_client_name: task.assigned_client_name,
          due_date: nextDueStr,
          created_by: task.created_by,
          parent_task_id: task.parent_task_id,
          show_subtasks_to_client: task.show_subtasks_to_client,
          visible_to_client: task.visible_to_client,
          recurrence_type: task.recurrence_type,
          recurrence_interval: task.recurrence_interval,
          recurrence_next_at: nextDue.toISOString(),
          recurrence_parent_id: task.recurrence_parent_id || task.id,
        })
        .select()
        .single();

      if (insertErr) throw insertErr;
      return newTask;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.invalidateQueries({ queryKey: ['all-tasks'] });
      toast.success('Task completed — next occurrence created');
    },
    onError: (error: Error) => {
      toast.error('Failed to complete recurring task: ' + error.message);
    },
  });
}

// Delete task mutation
export function useDeleteTask() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (taskId: string) => {
      const { error } = await supabase
        .from('tasks')
        .delete()
        .eq('id', taskId);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.invalidateQueries({ queryKey: ['all-tasks'] });
      toast.success('Task deleted successfully');
    },
    onError: (error: Error) => {
      toast.error('Failed to delete task: ' + error.message);
    },
  });
}

// Add text comment mutation
export function useAddTaskComment() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ taskId, authorName, content }: { taskId: string; authorName: string; content: string }) => {
      const { data, error } = await supabase
        .from('task_comments')
        .insert({
          task_id: taskId,
          author_name: authorName,
          content,
          comment_type: 'text',
        })
        .select()
        .single();
      
      if (error) throw error;
      return data;
    },
    onSuccess: (_, { taskId }) => {
      queryClient.invalidateQueries({ queryKey: ['task-comments', taskId] });
    },
    onError: (error: Error) => {
      toast.error('Failed to add comment: ' + error.message);
    },
  });
}

// Add voice comment mutation
export function useAddVoiceComment() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ 
      taskId, 
      authorName, 
      audioUrl, 
      durationSeconds,
      transcript,
    }: { 
      taskId: string; 
      authorName: string; 
      audioUrl: string;
      durationSeconds: number;
      transcript?: string;
    }) => {
      const { data, error } = await supabase
        .from('task_comments')
        .insert({
          task_id: taskId,
          author_name: authorName,
          content: transcript || 'Voice note',
          audio_url: audioUrl,
          duration_seconds: durationSeconds,
          transcript: transcript || null,
          comment_type: 'voice',
        })
        .select()
        .single();
      
      if (error) throw error;
      return data;
    },
    onSuccess: (_, { taskId }) => {
      queryClient.invalidateQueries({ queryKey: ['task-comments', taskId] });
      toast.success('Voice note added');
    },
    onError: (error: Error) => {
      toast.error('Failed to add voice note: ' + error.message);
    },
  });
}

// Upload file mutation
export function useUploadTaskFile() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ taskId, file, uploadedBy }: { taskId: string; file: File; uploadedBy: string }) => {
      // Upload to storage
      const filePath = `${taskId}/${Date.now()}-${file.name}`;
      const { error: uploadError } = await supabase.storage
        .from('task-files')
        .upload(filePath, file);
      
      if (uploadError) throw uploadError;
      
      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from('task-files')
        .getPublicUrl(filePath);
      
      // Save to database
      const { data, error } = await supabase
        .from('task_files')
        .insert({
          task_id: taskId,
          file_name: file.name,
          file_url: publicUrl,
          file_type: file.type,
          uploaded_by: uploadedBy,
        })
        .select()
        .single();
      
      if (error) throw error;
      return data;
    },
    onSuccess: (_, { taskId }) => {
      queryClient.invalidateQueries({ queryKey: ['task-files', taskId] });
      toast.success('File uploaded successfully');
    },
    onError: (error: Error) => {
      toast.error('Failed to upload file: ' + error.message);
    },
  });
}

// Add agency member mutation
export function useAddAgencyMember() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ name, email, role }: { name: string; email: string; role?: string }) => {
      const { data, error } = await supabase
        .from('agency_members')
        .insert({ name, email, role: role || 'member' })
        .select()
        .single();
      
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agency-members'] });
      toast.success('Team member added');
    },
    onError: (error: Error) => {
      toast.error('Failed to add member: ' + error.message);
    },
  });
}

// Add task history
export function useAddTaskHistory() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ taskId, action, oldValue, newValue, changedBy }: {
      taskId: string;
      action: string;
      oldValue?: string;
      newValue?: string;
      changedBy?: string;
    }) => {
      const { data, error } = await supabase
        .from('task_history')
        .insert({
          task_id: taskId,
          action,
          old_value: oldValue || null,
          new_value: newValue || null,
          changed_by: changedBy || null,
        })
        .select()
        .single();
      
      if (error) throw error;
      return data;
    },
    onSuccess: (_, { taskId }) => {
      queryClient.invalidateQueries({ queryKey: ['task-history', taskId] });
    },
  });
}
 
 // Bulk update tasks mutation
 export function useBulkUpdateTasks() {
   const queryClient = useQueryClient();
   
   return useMutation({
     mutationFn: async ({ ids, updates }: { ids: string[]; updates: Partial<Task> }) => {
       const { data, error } = await supabase
         .from('tasks')
         .update(updates)
         .in('id', ids)
         .select();
       
       if (error) throw error;
       return data;
     },
     onSuccess: () => {
       queryClient.invalidateQueries({ queryKey: ['tasks'] });
       queryClient.invalidateQueries({ queryKey: ['all-tasks'] });
       toast.success('Tasks updated successfully');
     },
     onError: (error: Error) => {
       toast.error('Failed to update tasks: ' + error.message);
     },
   });
 }
 
 // Bulk delete tasks mutation
 export function useBulkDeleteTasks() {
   const queryClient = useQueryClient();
   
   return useMutation({
     mutationFn: async (taskIds: string[]) => {
       const { error } = await supabase
         .from('tasks')
         .delete()
         .in('id', taskIds);
       
       if (error) throw error;
     },
     onSuccess: () => {
       queryClient.invalidateQueries({ queryKey: ['tasks'] });
       queryClient.invalidateQueries({ queryKey: ['all-tasks'] });
       toast.success('Tasks deleted successfully');
     },
     onError: (error: Error) => {
       toast.error('Failed to delete tasks: ' + error.message);
     },
   });
 }
