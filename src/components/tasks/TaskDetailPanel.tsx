import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Calendar } from '@/components/ui/calendar';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  CalendarIcon,
  Loader2,
  Trash2,
  Send,
  CheckCircle2,
  Video,
  ExternalLink,
  Mic,
  Paperclip,
  MessageSquare,
  History,
  Plus,
  FileUp,
  Link,
  Copy,
  Upload,
  FileAudio,
  ListChecks,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  Circle,
  Repeat,
  Sparkles,
} from 'lucide-react';
import { format } from 'date-fns';
import { cn, addBusinessDays } from '@/lib/utils';
import {
  Task,
  TaskComment,
  TaskHistory,
  TaskFile,
  useUpdateTask,
  useDeleteTask,
  useCreateTask,
  useTaskComments,
  useTaskFiles,
  useTaskHistory,
  useAddTaskComment,
  useUploadTaskFile,
  useAddTaskHistory,
  useAgencyMembers,
  useSubtasks,
  useCompleteRecurringTask,
} from '@/hooks/useTasks';
import { useDeleteTaskComment } from '@/hooks/useTasks';
import { useMeetings } from '@/hooks/useMeetings';
import { useTeamMember } from '@/contexts/TeamMemberContext';
import { useTaskFileReview } from '@/hooks/useTaskFileReview';
import { TaskDiscussionVoiceNote, VoiceNotePlayer } from './TaskDiscussionVoiceNote';
import { FilePreviewLightbox, MiniThumbnail } from './FilePreviewLightbox';
import { InlineFilePreview } from './InlineFilePreview';
import { SendToCreativeModal } from './SendToCreativeModal';
import { MultiAssigneeSelector } from './MultiAssigneeSelector';
import { SubtaskRow } from './SubtaskRow';
import { MentionTextarea, parseMentions } from './MentionTextarea';
import { useCreateNotification } from './NotificationsTab';
import { useAgencyPods } from '@/hooks/useAgencyPods';
import { useAgencySettings } from '@/hooks/useAgencySettings';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

// Fetch the client's Meta ad account IDs (primary + additional) for the
// "Open Meta Ads" buttons in the task header.
function useClientMetaAdAccounts(clientId?: string) {
  return useQuery({
    queryKey: ['client-meta-ad-accounts', clientId],
    enabled: !!clientId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('clients')
        .select('meta_ad_account_id, meta_ad_account_ids')
        .eq('id', clientId!)
        .maybeSingle();
      if (error) throw error;
      const ids = [
        (data as any)?.meta_ad_account_id,
        ...(((data as any)?.meta_ad_account_ids as string[] | null) || []),
      ]
        .filter(Boolean)
        .map((id: string) => String(id).replace(/^act_/, ''));
      return Array.from(new Set(ids));
    },
  });
}
 
 interface TaskDetailPanelProps {
   task: Task | null;
   open: boolean;
   onOpenChange: (open: boolean) => void;
   clientName?: string;
   clientId?: string;
   isPublicView?: boolean;
 }
 
 type TimelineEntry = 
   | { type: 'comment'; data: TaskComment; timestamp: Date }
   | { type: 'history'; data: TaskHistory; timestamp: Date };
 
 const STAGES = [
   { id: 'client_tasks', label: 'Client Tasks' },
   { id: 'todo', label: 'To Do' },
   { id: 'in_progress', label: 'In Progress' },
   { id: 'stuck', label: 'Stuck' },
  { id: 'agency_review', label: 'Agency Review' },
  { id: 'review', label: 'Client Review' },
   { id: 'revisions', label: 'Revisions' },
   { id: 'done', label: 'Completed' },
 ];
 
 export function TaskDetailPanel({ task, open, onOpenChange, clientName, clientId, isPublicView = false }: TaskDetailPanelProps) {
   const updateTask = useUpdateTask();
  const [editingTitle, setEditingTitle] = useState(false);
  const [editedTitle, setEditedTitle] = useState('');
   const deleteTask = useDeleteTask();
   const createTask = useCreateTask();
   const addHistory = useAddTaskHistory();
   const { data: comments = [] } = useTaskComments(task?.id);
   const { data: files = [] } = useTaskFiles(task?.id);
   const { data: history = [] } = useTaskHistory(task?.id);
   const { data: meetings = [] } = useMeetings();
   const { data: agencyMembers = [] } = useAgencyMembers();
   const { data: subtasks = [] } = useSubtasks(task?.id);
    const addComment = useAddTaskComment();
    const uploadFile = useUploadTaskFile();
    const deleteComment = useDeleteTaskComment();
    const createNotification = useCreateNotification();
    const { data: pods = [] } = useAgencyPods();
  const { data: agencySettings } = useAgencySettings();
   const { currentMember } = useTeamMember();
   const { reviewFile, isReviewing, reviewingFileId } = useTaskFileReview();
    const [aiDrafting, setAiDrafting] = useState(false);
    const queryClient = useQueryClient();
    const handleAiDraft = useCallback(async () => {
      if (!task?.id || aiDrafting) return;
      setAiDrafting(true);
      try {
        const { data, error } = await supabase.functions.invoke('ai-task-draft', {
          body: { task_id: task.id, force: true },
        });
        if (error) throw error;
        if (data?.drafted) {
          toast.success('AI Studio posted a draft');
        } else if (data?.reason === 'ai_draft_exists') {
          toast.message('AI draft already exists — refreshed');
        } else if (data?.error) {
          throw new Error(data.error);
        }
        queryClient.invalidateQueries({ queryKey: ['task-comments', task.id] });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        toast.error(`AI draft failed: ${msg}`);
      } finally {
        setAiDrafting(false);
      }
    }, [task?.id, aiDrafting, queryClient]);
   
   const [isEditingDescription, setIsEditingDescription] = useState(false);
   const [editedDescription, setEditedDescription] = useState('');
   const [newComment, setNewComment] = useState('');
   const [lightboxOpen, setLightboxOpen] = useState(false);
   const [selectedFileIndex, setSelectedFileIndex] = useState(0);
   const [inlineFileIndex, setInlineFileIndex] = useState(0);
  const [sendToCreativeOpen, setSendToCreativeOpen] = useState(false);
  const [selectedFileForCreative, setSelectedFileForCreative] = useState<TaskFile | null>(null);
   const [isDragOver, setIsDragOver] = useState(false);
   const [isTranscribing, setIsTranscribing] = useState(false);
   const [transcribingFileId, setTranscribingFileId] = useState<string | null>(null);
   const [pastedFiles, setPastedFiles] = useState<File[]>([]);
   const [pastedPreviews, setPastedPreviews] = useState<{ file: File; url: string; type: string }[]>([]);
  const [newSubtaskTitle, setNewSubtaskTitle] = useState('');
  const [newSubtaskPriority, setNewSubtaskPriority] = useState<string>('');
  const [newSubtaskDueDate, setNewSubtaskDueDate] = useState<Date | undefined>(() => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return tomorrow;
  });
  const [dueDatePopoverOpen, setDueDatePopoverOpen] = useState(false);
  const [showSubtaskForm, setShowSubtaskForm] = useState(false);
  const [showSubtasks, setShowSubtasks] = useState(true);
  const [editingSubtaskId, setEditingSubtaskId] = useState<string | null>(null);
  const [editingSubtaskTitle, setEditingSubtaskTitle] = useState('');
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const discussionFileInputRef = useRef<HTMLInputElement>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);
   
   const memberLookup = useMemo(() => {
     const lookup: Record<string, { name: string; podName?: string }> = {};
     agencyMembers.forEach(m => {
       lookup[m.name] = { name: m.name, podName: m.pod?.name };
     });
     return lookup;
   }, [agencyMembers]);
   
  const timeline = useMemo<TimelineEntry[]>(() => {
     const entries: TimelineEntry[] = [
       ...comments.map(c => ({ type: 'comment' as const, data: c, timestamp: new Date(c.created_at) })),
       ...history.map(h => ({ type: 'history' as const, data: h, timestamp: new Date(h.created_at) })),
     ];

     // Always inject a synthetic "created" entry from the task itself so authorship is visible
     if (task?.created_at) {
       const hasCreated = history.some(h => h.action === 'created');
       if (!hasCreated) {
         entries.push({
           type: 'history' as const,
           data: {
             id: `synthetic-created-${task.id}`,
             task_id: task.id,
             action: 'created',
             old_value: null,
             new_value: null,
             changed_by: task.created_by || null,
             created_at: task.created_at,
           } as TaskHistory,
           timestamp: new Date(task.created_at),
         });
       }
     }

     // Inject a synthetic "completed" entry when the task is completed
     if (task?.completed_at) {
       const hasCompleted = history.some(h => h.action === 'completed');
       if (!hasCompleted) {
         entries.push({
           type: 'history' as const,
           data: {
             id: `synthetic-completed-${task.id}`,
             task_id: task.id,
             action: 'completed',
             old_value: null,
             new_value: null,
             changed_by: null,
             created_at: task.completed_at,
           } as TaskHistory,
           timestamp: new Date(task.completed_at),
         });
       }
     }

     return entries.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
   }, [comments, history, task?.id, task?.created_at, task?.created_by, task?.completed_at]);
   
  const getAuthorName = useCallback(() => {
    if (isPublicView) return task?.assigned_client_name || 'Client';
    return currentMember?.name || 'Agency';
  }, [isPublicView, task?.assigned_client_name, currentMember?.name]);
    
  const getDisplayAuthorName = useCallback((authorName: string) => {
    if (!isPublicView) return authorName;
    const member = memberLookup[authorName];
    if (member?.podName) return `${member.podName} Team`;
    return authorName;
  }, [isPublicView, memberLookup]);

  const uploadSingleFile = useCallback(async (file: File) => {
    if (!task) return;
    const authorName = getAuthorName();
    await uploadFile.mutateAsync({ taskId: task.id, file, uploadedBy: authorName });
    await addHistory.mutateAsync({
      taskId: task.id,
      action: 'file_uploaded',
      newValue: file.name,
      changedBy: authorName,
    });
  }, [task, uploadFile, addHistory, getAuthorName]);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!dropZoneRef.current?.contains(e.relatedTarget as Node)) {
      setIsDragOver(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    const droppedFiles = Array.from(e.dataTransfer.files);
    if (droppedFiles.length === 0) return;

    toast.info(`Uploading ${droppedFiles.length} file${droppedFiles.length > 1 ? 's' : ''}...`);
    
    for (const file of droppedFiles) {
      await uploadSingleFile(file);
    }
  }, [uploadSingleFile]);
    
  useEffect(() => {
    if (task) {
      setEditedDescription(task.description || '');
      setInlineFileIndex(0);
    }
  }, [task]);
    
  useEffect(() => {
    if (inlineFileIndex >= files.length && files.length > 0) {
      setInlineFileIndex(files.length - 1);
    }
  }, [files.length, inlineFileIndex]);
    
  const handleCreateSubtask = async () => {
    if (!task || !newSubtaskTitle.trim()) return;
    try {
      await createTask.mutateAsync({
        title: newSubtaskTitle.trim(),
        client_id: task.client_id,
        parent_task_id: task.id,
        priority: newSubtaskPriority || task.priority,
        due_date: newSubtaskDueDate ? format(newSubtaskDueDate, 'yyyy-MM-dd') : null,
        stage: 'todo',
        status: 'todo',
        created_by: currentMember?.name || (isPublicView ? 'Client' : null),
      });
      setNewSubtaskTitle('');
      setNewSubtaskPriority('');
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      setNewSubtaskDueDate(tomorrow);
      setShowSubtaskForm(false);
      toast.success('Subtask created');
    } catch (err) {
      toast.error('Failed to create subtask');
    }
  };

  const handleToggleSubtaskComplete = async (subtask: Task) => {
    const newStage = subtask.stage === 'done' ? 'todo' : 'done';
    await updateTask.mutateAsync({
      id: subtask.id,
      stage: newStage,
      completed_at: newStage === 'done' ? new Date().toISOString() : null,
    });
  };

  const handleToggleShowSubtasksToClient = async () => {
    if (!task) return;
    await updateTask.mutateAsync({
      id: task.id,
      show_subtasks_to_client: !task.show_subtasks_to_client,
    });
  };

  const handleToggleVisibleToClient = async () => {
    if (!task) return;
    await updateTask.mutateAsync({
      id: task.id,
      visible_to_client: !task.visible_to_client,
    });
    toast.success(task.visible_to_client ? 'Task hidden from client' : 'Task visible to client');
  };

  const completeRecurring = useCompleteRecurringTask();

  const { data: metaAdAccountIds = [] } = useClientMetaAdAccounts(
    clientId || task?.client_id || undefined
  );

  if (!task) return null;
   
   const resolvedClientId = clientId || task.client_id;
   
   const handleCopyTaskUrl = () => {
      const baseUrl = window.location.origin;
       const taskUrl = isPublicView
         ? `${baseUrl}/public/${window.location.pathname.split('/')[2]}?section=tasks&task=${task.id}`
         : `${baseUrl}/client/${task.client_id}?task=${task.id}`;
      navigator.clipboard.writeText(taskUrl);
      toast.success('Task link copied to clipboard!');
    };

   const handleDuplicateTask = async () => {
     try {
       const newTask = await createTask.mutateAsync({
         title: `${task.title} (Copy)`,
         description: task.description,
         client_id: task.client_id,
         priority: task.priority,
         due_date: task.due_date,
         stage: 'todo',
         status: 'todo',
         assigned_to: task.assigned_to,
         assigned_client_name: task.assigned_client_name,
         visible_to_client: task.visible_to_client,
         show_subtasks_to_client: task.show_subtasks_to_client,
       });
       // Navigate to the duplicated task
       if (newTask?.id) {
         const url = new URL(window.location.href);
         url.searchParams.set('task', newTask.id);
         window.history.pushState({}, '', url.toString());
         // Close current panel and reopen with new task
         onOpenChange(false);
         setTimeout(() => {
           window.dispatchEvent(new CustomEvent('open-task', { detail: { taskId: newTask.id } }));
         }, 300);
       }
     } catch (err) {
       // error handled by hook
     }
   };
   
   const handleStatusChange = async (newStatus: string) => {
     const oldStage = task.stage;
     const isCompleting = newStatus === 'done';
     
     await addHistory.mutateAsync({
       taskId: task.id,
       action: isCompleting ? 'completed' : 'status_changed',
       oldValue: STAGES.find(s => s.id === oldStage)?.label || oldStage,
       newValue: STAGES.find(s => s.id === newStatus)?.label || newStatus,
       changedBy: getAuthorName(),
     });
     
     if (isCompleting && task.recurrence_type) {
       await completeRecurring.mutateAsync(task);
     } else {
       await updateTask.mutateAsync({
         id: task.id,
         stage: newStatus,
         status: newStatus === 'done' ? 'completed' : newStatus === 'todo' ? 'todo' : 'in_progress',
         completed_at: isCompleting ? new Date().toISOString() : null,
       });
     }

     // Fire Slack notification when task moves to review
     if (newStatus === 'review' && task.client_id) {
       supabase.functions.invoke('send-task-review-slack', {
         body: { taskId: task.id, clientId: task.client_id },
       }).catch(err => console.error('Slack review notification failed:', err));
     }
   };
   
   const handlePriorityChange = async (newPriority: string) => {
     await addHistory.mutateAsync({
       taskId: task.id,
       action: 'priority_changed',
       oldValue: task.priority,
       newValue: newPriority,
       changedBy: getAuthorName(),
     });
     await updateTask.mutateAsync({ id: task.id, priority: newPriority });
   };
   
   const handleDueDateChange = async (newDate: Date | undefined) => {
     setDueDatePopoverOpen(false);
     await addHistory.mutateAsync({
       taskId: task.id,
       action: 'due_date_changed',
       oldValue: task.due_date ? format(new Date(task.due_date), 'PP') : 'No date',
       newValue: newDate ? format(newDate, 'PP') : 'No date',
       changedBy: getAuthorName(),
     });
     await updateTask.mutateAsync({
       id: task.id,
       due_date: newDate ? format(newDate, 'yyyy-MM-dd') : null,
     });
    };

    const handleRecurrenceChange = async (value: string) => {
      const newValue = value === 'none' ? null : value;
      await addHistory.mutateAsync({
        taskId: task.id,
        action: 'recurrence_changed',
        oldValue: task.recurrence_type || 'none',
        newValue: value,
        changedBy: getAuthorName(),
      });
      await updateTask.mutateAsync({ id: task.id, recurrence_type: newValue });
    };
    
    const handleSaveDescription = async () => {
      if (editedDescription !== task.description) {
        await addHistory.mutateAsync({
          taskId: task.id,
          action: 'description_updated',
          oldValue: task.description ? 'Previous description' : 'No description',
          newValue: editedDescription ? 'Updated description' : 'Removed description',
          changedBy: getAuthorName(),
        });
        await updateTask.mutateAsync({ id: task.id, description: editedDescription || null });
      }
      setIsEditingDescription(false);
    };
   
   const handleDelete = async () => {
     if (!confirm('Are you sure you want to delete this task?')) return;
     await deleteTask.mutateAsync(task.id);
     onOpenChange(false);
   };
   
     const handleAddComment = async () => {
       if (!newComment.trim() && pastedFiles.length === 0) return;
       
       // Upload pasted files first
       for (const file of pastedFiles) {
         await uploadSingleFile(file);
       }
       
       // Add text comment if there's text
       if (newComment.trim()) {
         await addComment.mutateAsync({
           taskId: task.id,
           authorName: getAuthorName(),
           content: newComment.trim(),
         });

         // Parse @mentions and send notifications
         const mentions = parseMentions(newComment, agencyMembers, pods);
         const authorName = getAuthorName();
         const taskTitle = task.title || 'a task';

         for (const mention of mentions) {
           for (const memberId of mention.memberIds) {
             // Don't notify yourself
             if (currentMember?.id === memberId) continue;
             await createNotification.mutateAsync({
               taskId: task.id,
               memberId,
               triggeredBy: authorName,
               message: `${authorName} mentioned ${mention.type === 'pod' ? `${mention.name} Team` : 'you'} in "${taskTitle}"`,
             });
           }
         }
       }
       
       setNewComment('');
       // Clean up previews
       pastedPreviews.forEach(p => URL.revokeObjectURL(p.url));
       setPastedFiles([]);
       setPastedPreviews([]);
     };

    const handleCommentPaste = (e: React.ClipboardEvent) => {
      const items = Array.from(e.clipboardData.items);
      const mediaItems = items.filter(item => 
        item.type.startsWith('image/') || item.type.startsWith('video/')
      );
      
      if (mediaItems.length === 0) return;
      
      e.preventDefault();
      
      const newFiles: File[] = [];
      const newPreviews: { file: File; url: string; type: string }[] = [];
      
      for (const item of mediaItems) {
        const file = item.getAsFile();
        if (!file) continue;
        const url = URL.createObjectURL(file);
        newFiles.push(file);
        newPreviews.push({ file, url, type: file.type });
      }
      
      setPastedFiles(prev => [...prev, ...newFiles]);
      setPastedPreviews(prev => [...prev, ...newPreviews]);
    };

    const removePastedFile = (index: number) => {
      URL.revokeObjectURL(pastedPreviews[index].url);
      setPastedFiles(prev => prev.filter((_, i) => i !== index));
      setPastedPreviews(prev => prev.filter((_, i) => i !== index));
    };
   
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(e.target.files || []);
    if (selectedFiles.length === 0) return;
    
    if (selectedFiles.length > 1) {
      toast.info(`Uploading ${selectedFiles.length} files...`);
    }
    
    for (const file of selectedFiles) {
      await uploadSingleFile(file);
    }
  };

  const handleTranscribeFile = async (file: TaskFile) => {
    if (!task) return;
    
    const isAudio = file.file_type?.startsWith('audio/');
    const isVideo = file.file_type?.startsWith('video/');
    
    if (!isAudio && !isVideo) {
      toast.error('Transcription is only available for audio and video files');
      return;
    }

    setIsTranscribing(true);
    setTranscribingFileId(file.id);

    try {
      toast.info('Transcribing file with Gemini AI...');
      
      // Fetch the file and convert to base64
      const response = await fetch(file.file_url);
      const blob = await response.blob();
      
      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64Audio = reader.result as string;
        
        try {
          const { data, error } = await supabase.functions.invoke('transcribe-audio', {
            body: { audio: base64Audio }
          });

          if (error) {
            console.error('Transcription error:', error);
            toast.error('Failed to transcribe file');
            return;
          }

          const transcript = data?.text;
          if (!transcript || transcript.trim() === '') {
            toast.warning('No speech detected in the file');
            return;
          }

          // Add transcript as a comment
          const commentContent = `🎤 **Transcription of ${file.file_name}:**\n\n${transcript}`;
          
          await addComment.mutateAsync({
            taskId: task.id,
            authorName: 'AI Transcription',
            content: commentContent,
          });

          await addHistory.mutateAsync({
            taskId: task.id,
            action: 'file_transcribed',
            newValue: file.file_name,
            changedBy: getAuthorName(),
          });

          toast.success('Transcription added to discussion!');
        } catch (err) {
          console.error('Transcription failed:', err);
          toast.error('Transcription failed');
        } finally {
          setIsTranscribing(false);
          setTranscribingFileId(null);
        }
      };

      reader.readAsDataURL(blob);
    } catch (err) {
      console.error('Failed to fetch file:', err);
      toast.error('Failed to load file for transcription');
      setIsTranscribing(false);
      setTranscribingFileId(null);
    }
  };

  const openLightbox = (index: number) => {
    setSelectedFileIndex(index);
    setLightboxOpen(true);
  };
   
   const handleSendToCreative = (file: TaskFile) => {
     setSelectedFileForCreative(file);
     setSendToCreativeOpen(true);
   };
   
   const handleAIReview = async (file: TaskFile) => {
     if (!task) return;
     await reviewFile(file, task.id, getAuthorName());
   };
   
   const getPriorityColor = (p: string) => {
     switch (p) {
       case 'high': return 'destructive';
       case 'medium': return 'secondary';
       case 'low': return 'outline';
       default: return 'secondary';
     }
   };
   
   const getInitials = (name: string) => name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
   
const renderContentWithLinks = (content: string) => {
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const parts = content.split(urlRegex);
  
  return parts.map((part, index) => {
    if (urlRegex.test(part)) {
      return (
        <a 
          key={index}
          href={part} 
          target="_blank" 
          rel="noopener noreferrer"
          className="text-primary hover:underline cursor-pointer"
        >
          {part}
        </a>
      );
    }
    return part;
  });
};

const getHistoryIcon = (action: string) => {
     switch (action) {
       case 'completed': return <CheckCircle2 className="h-4 w-4 text-primary" />;
       case 'created': return <Plus className="h-4 w-4 text-primary" />;
       case 'file_uploaded': return <Paperclip className="h-4 w-4 text-muted-foreground" />;
       case 'ai_review': return <CheckCircle2 className="h-4 w-4 text-primary" />;
       default: return <History className="h-4 w-4 text-muted-foreground" />;
     }
   };
   
   const formatHistoryAction = (entry: TaskHistory) => {
     switch (entry.action) {
       case 'created': return <span>Task created</span>;
       case 'completed': return <span className="text-primary">Task completed</span>;
       case 'status_changed':
         return <span>Status: <span className="font-medium">{entry.old_value}</span> → <span className="font-medium">{entry.new_value}</span></span>;
       case 'priority_changed':
         return <span>Priority: <span className="font-medium">{entry.old_value}</span> → <span className="font-medium">{entry.new_value}</span></span>;
       case 'due_date_changed':
         return <span>Due date: <span className="font-medium">{entry.old_value}</span> → <span className="font-medium">{entry.new_value}</span></span>;
       case 'description_updated': return <span>Description updated</span>;
       case 'file_uploaded': return <span>Uploaded: <span className="font-medium">{entry.new_value}</span></span>;
       case 'ai_review': return <span>AI reviewed: <span className="font-medium">{entry.new_value}</span></span>;
       default: return <span>{entry.action}</span>;
     }
   };
   
   const linkedMeeting = task.meeting_id ? meetings.find(m => m.id === task.meeting_id) : null;
   
   return (
     <>
       <Sheet open={open} onOpenChange={onOpenChange}>
         <SheetContent className="w-full sm:max-w-xl p-0 flex flex-col">
            <SheetHeader className="p-6 pb-4 border-b flex-shrink-0">
              <div className="space-y-3">
              <div className="min-w-0">
                 <SheetTitle className="text-lg font-semibold leading-tight w-[80%]">
                   {editingTitle ? (
                     <Input
                       autoFocus
                       value={editedTitle}
                       onChange={(e) => setEditedTitle(e.target.value)}
                       onBlur={async () => {
                         const next = editedTitle.trim();
                         if (next && next !== task.title) {
                           await updateTask.mutateAsync({ id: task.id, title: next });
                         }
                         setEditingTitle(false);
                       }}
                       onKeyDown={async (e) => {
                         if (e.key === 'Enter') {
                           e.preventDefault();
                           (e.target as HTMLInputElement).blur();
                         } else if (e.key === 'Escape') {
                           setEditedTitle(task.title);
                           setEditingTitle(false);
                         }
                       }}
                       className="text-lg font-semibold h-auto py-1"
                     />
                   ) : (
                     <button
                       type="button"
                       onClick={() => {
                         if (isPublicView) return;
                         setEditedTitle(task.title);
                         setEditingTitle(true);
                       }}
                       className="text-left w-full hover:bg-muted/50 rounded px-1 -mx-1 py-0.5 transition-colors cursor-text"
                       title={isPublicView ? undefined : 'Click to edit title'}
                     >
                       {task.title}
                     </button>
                   )}
                 </SheetTitle>
                {clientName && (
                  <p className="text-sm text-muted-foreground mt-1">Client: {clientName}</p>
                )}
                <div className="flex items-center gap-x-3 gap-y-0.5 flex-wrap text-xs text-muted-foreground mt-1">
                  {task.created_at && (
                    <span>
                      Created{task.created_by ? <> by <span className="font-medium text-foreground">{getDisplayAuthorName(task.created_by)}</span></> : ''} · {format(new Date(task.created_at), 'MMM d, yyyy h:mm a')}
                    </span>
                  )}
                  {task.completed_at && (
                    <span>
                      Completed · <span className="font-medium text-foreground">{format(new Date(task.completed_at), 'MMM d, yyyy h:mm a')}</span>
                      {task.created_at && (() => {
                        const ms = new Date(task.completed_at).getTime() - new Date(task.created_at).getTime();
                        if (ms <= 0) return null;
                        const days = Math.floor(ms / 86400000);
                        const hours = Math.floor((ms % 86400000) / 3600000);
                        const mins = Math.floor((ms % 3600000) / 60000);
                        const parts = [];
                        if (days) parts.push(`${days}d`);
                        if (hours) parts.push(`${hours}h`);
                        if (!days && mins) parts.push(`${mins}m`);
                        return parts.length ? <> ({parts.join(' ')})</> : null;
                      })()}
                    </span>
                  )}
                </div>
              </div>
                <div className="flex items-center gap-2 flex-wrap">
                   {!isPublicView && (
                     <Button
                       variant="ghost"
                       size="sm"
                       className="h-8 text-xs gap-1"
                       onClick={handleToggleVisibleToClient}
                     >
                       {task.visible_to_client !== false ? (
                         <><Eye className="h-3.5 w-3.5" /> Visible to client</>
                       ) : (
                         <><EyeOff className="h-3.5 w-3.5" /> Hidden from client</>
                       )}
                     </Button>
                   )}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleCopyTaskUrl}
                    >
                      <Copy className="h-4 w-4 mr-2" />
                      Copy Link
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleDuplicateTask}
                      disabled={createTask.isPending}
                    >
                      {createTask.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      ) : (
                        <Copy className="h-4 w-4 mr-2" />
                      )}
                      Duplicate
                    </Button>
                    {metaAdAccountIds.map((adId, idx) => (
                      <Button
                        key={adId}
                        variant="outline"
                        size="sm"
                        asChild
                      >
                        <a
                          href={`https://business.facebook.com/adsmanager/manage/campaigns?act=${adId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <ExternalLink className="h-4 w-4 mr-2" />
                          {metaAdAccountIds.length > 1 ? `Meta Ads ${idx + 1}` : 'Meta Ads'}
                        </a>
                      </Button>
                    ))}
                    {(agencySettings as any)?.kpi_google_doc_url && (
                      <Button variant="outline" size="sm" asChild>
                        <a
                          href={(agencySettings as any).kpi_google_doc_url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <ExternalLink className="h-4 w-4 mr-2" />
                          KPI Doc
                        </a>
                      </Button>
                    )}
                    {(agencySettings as any)?.kpi_google_sheet_url && (
                      <Button variant="outline" size="sm" asChild>
                        <a
                          href={(agencySettings as any).kpi_google_sheet_url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <ExternalLink className="h-4 w-4 mr-2" />
                          KPI Sheet
                        </a>
                      </Button>
                    )}
                   <Button
                     variant={task.stage === 'done' ? 'secondary' : 'outline'}
                     size="sm"
                     onClick={() => handleStatusChange(task.stage === 'done' ? 'todo' : 'done')}
                     className={task.stage !== 'done' ? 'border-success/50 text-success hover:bg-success/10' : ''}
                     disabled={updateTask.isPending}
                   >
                     {updateTask.isPending ? (
                       <Loader2 className="h-4 w-4 animate-spin mr-2" />
                     ) : (
                       <CheckCircle2 className="h-4 w-4 mr-2" />
                     )}
                     {task.stage === 'done' ? 'Reopen' : 'Complete'}
                   </Button>
                   <Button 
                     variant="destructive" 
                     size="sm"
                     onClick={handleDelete}
                     disabled={deleteTask.isPending}
                   >
                     {deleteTask.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                   </Button>
                 </div>
               </div>
             </SheetHeader>
            
             <ScrollArea className="flex-1 overflow-y-auto">
               <div 
                 ref={dropZoneRef}
                 className={cn(
                   "p-6 space-y-6 min-h-full transition-colors relative",
                   isDragOver && "bg-primary/5 ring-2 ring-primary ring-inset"
                 )}
                 onDragEnter={handleDragEnter}
                 onDragLeave={handleDragLeave}
                 onDragOver={handleDragOver}
                 onDrop={handleDrop}
               >

               {linkedMeeting && (
                 <div className="flex items-center gap-2">
                   <Video className="h-4 w-4 text-muted-foreground" />
                   <span className="text-sm text-muted-foreground">From meeting:</span>
                   {linkedMeeting.meetgeek_url ? (
                     <a href={linkedMeeting.meetgeek_url} target="_blank" rel="noopener noreferrer" className="text-sm text-primary hover:underline flex items-center gap-1">
                       {linkedMeeting.title} <ExternalLink className="h-3 w-3" />
                     </a>
                   ) : (
                     <span className="text-sm">{linkedMeeting.title}</span>
                   )}
                 </div>
               )}

               <div className="space-y-4">
                 <div className="w-[85%]">
                   <Label className="text-xs text-muted-foreground">Description</Label>
                   {isEditingDescription ? (
                     <Textarea
                       value={editedDescription}
                       onChange={(e) => setEditedDescription(e.target.value)}
                       onBlur={handleSaveDescription}
                       onKeyDown={(e) => {
                         if (e.key === 'Escape') {
                           setEditedDescription(task.description || '');
                           setIsEditingDescription(false);
                         }
                       }}
                       rows={3}
                       placeholder="Add a description..."
                       className="mt-1"
                       autoFocus
                     />
                   ) : (
                     <p onClick={() => setIsEditingDescription(true)} className="text-sm mt-1 cursor-pointer hover:bg-muted/50 rounded p-2 -mx-2 transition-colors min-h-[40px] whitespace-pre-wrap break-words">
                       {task.description || <span className="text-muted-foreground italic">Click to add description...</span>}
                     </p>
                   )}
                 </div>
               </div>

               <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-xs text-muted-foreground">Status</Label>
                    <Select value={task.stage} onValueChange={handleStatusChange}>
                      <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {STAGES.map(stage => <SelectItem key={stage.id} value={stage.id}>{stage.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Priority</Label>
                    <Select value={task.priority} onValueChange={handlePriorityChange}>
                      <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="low">Low</SelectItem>
                        <SelectItem value="medium">Medium</SelectItem>
                        <SelectItem value="high">High</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Assigned to</Label>
                    <MultiAssigneeSelector
                      taskId={task.id}
                      isPublicView={isPublicView}
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Due Date</Label>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button variant="outline" className="mt-1 h-9 w-full justify-start text-left font-normal">
                          <CalendarIcon className="h-4 w-4 mr-2" />
                          {task.due_date ? format(new Date(task.due_date + 'T00:00:00'), 'PP') : 'Not set'}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                          mode="single"
                          selected={task.due_date ? new Date(task.due_date + 'T00:00:00') : undefined}
                          onSelect={handleDueDateChange}
                          initialFocus
                        />
                      </PopoverContent>
                    </Popover>
                  </div>
                  {!isPublicView && (
                    <div className="col-span-2">
                      <Label className="text-xs text-muted-foreground">Recurrence</Label>
                      <Select value={task.recurrence_type || 'none'} onValueChange={handleRecurrenceChange}>
                        <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">None</SelectItem>
                          <SelectItem value="daily">Daily</SelectItem>
                          <SelectItem value="weekly">Weekly</SelectItem>
                          <SelectItem value="biweekly">Biweekly</SelectItem>
                          <SelectItem value="monthly">Monthly</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </div>
                {isDragOver && (
                  <div className="absolute inset-4 flex items-center justify-center bg-background/80 rounded-lg border-2 border-dashed border-primary z-10 pointer-events-none">
                    <div className="flex flex-col items-center gap-2 text-primary">
                      <Upload className="h-8 w-8" />
                      <span className="text-sm font-medium">Drop files here to upload</span>
                    </div>
                  </div>
                )}
                
                {/* Subtasks Section */}
                {(!isPublicView || task.show_subtasks_to_client) && (
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <button 
                        className="flex items-center gap-2 text-sm font-medium hover:text-primary transition-colors"
                        onClick={() => setShowSubtasks(!showSubtasks)}
                      >
                        {showSubtasks ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        <ListChecks className="h-4 w-4 text-muted-foreground" />
                        <span>Subtasks ({subtasks.length})</span>
                        {subtasks.length > 0 && (
                          <span className="text-xs text-muted-foreground">
                            {subtasks.filter(s => s.stage === 'done').length}/{subtasks.length} done
                          </span>
                        )}
                      </button>
                      <div className="flex items-center gap-2">
                        {!isPublicView && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs gap-1"
                            onClick={handleToggleShowSubtasksToClient}
                          >
                            {task.show_subtasks_to_client ? (
                              <><Eye className="h-3 w-3" /> Visible to client</>
                            ) : (
                              <><EyeOff className="h-3 w-3" /> Hidden from client</>
                            )}
                          </Button>
                        )}
                      </div>
                    </div>

                    {showSubtasks && (
                      <div className="space-y-1">
                        {subtasks.map((subtask) => (
                          <SubtaskRow
                            key={subtask.id}
                            subtask={subtask}
                            isPublicView={isPublicView}
                            editingSubtaskId={editingSubtaskId}
                            editingSubtaskTitle={editingSubtaskTitle}
                            onStartEdit={(s) => {
                              setEditingSubtaskId(s.id);
                              setEditingSubtaskTitle(s.title);
                            }}
                            onCancelEdit={() => setEditingSubtaskId(null)}
                            onSaveEdit={async (id, title) => {
                              await updateTask.mutateAsync({ id, title });
                              setEditingSubtaskId(null);
                            }}
                            onToggleComplete={handleToggleSubtaskComplete}
                          />
                        ))}

                        {/* Add subtask form */}
                        {showSubtaskForm ? (
                          <div className="space-y-2 mt-2 p-2 rounded-md border border-border/50">
                            <Input
                              placeholder="Subtask title..."
                              value={newSubtaskTitle}
                              onChange={(e) => setNewSubtaskTitle(e.target.value)}
                              className="h-8 text-sm"
                              autoFocus
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleCreateSubtask();
                                if (e.key === 'Escape') { setShowSubtaskForm(false); setNewSubtaskTitle(''); setNewSubtaskPriority(''); const t = new Date(); t.setDate(t.getDate() + 1); setNewSubtaskDueDate(t); }
                              }}
                            />
                            <div className="flex items-center gap-2 flex-wrap">
                              <Select value={newSubtaskPriority || task.priority} onValueChange={setNewSubtaskPriority}>
                                <SelectTrigger className="h-7 w-24 text-xs">
                                  <SelectValue placeholder="Priority" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="low">Low</SelectItem>
                                  <SelectItem value="medium">Medium</SelectItem>
                                  <SelectItem value="high">High</SelectItem>
                                </SelectContent>
                              </Select>
                              <Popover>
                                <PopoverTrigger asChild>
                                  <Button variant="outline" size="sm" className={cn("h-7 text-xs gap-1", !newSubtaskDueDate && "text-muted-foreground")}>
                                    <CalendarIcon className="h-3 w-3" />
                                    {newSubtaskDueDate ? format(newSubtaskDueDate, 'MMM d') : 'Due date'}
                                  </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-auto p-0" align="start">
                                  <Calendar
                                    mode="single"
                                    selected={newSubtaskDueDate}
                                    onSelect={setNewSubtaskDueDate}
                                    initialFocus
                                    className="pointer-events-auto"
                                  />
                                </PopoverContent>
                              </Popover>
                              <div className="ml-auto">
                                <Button size="sm" className="h-7 text-xs" onClick={handleCreateSubtask} disabled={!newSubtaskTitle.trim() || createTask.isPending}>
                                  {createTask.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Add'}
                                </Button>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-xs text-muted-foreground mt-1"
                            onClick={() => setShowSubtaskForm(true)}
                          >
                            <Plus className="h-3 w-3 mr-1" />
                            Add subtask
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {files.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <Paperclip className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm font-medium">Files ({files.length})</span>
                    </div>
                    <InlineFilePreview 
                      files={files} 
                      currentIndex={inlineFileIndex} 
                      onNavigate={setInlineFileIndex} 
                      onOpenLightbox={() => openLightbox(inlineFileIndex)} 
                      onSendToCreative={handleSendToCreative} 
                      onAIReview={handleAIReview} 
                      isReviewing={isReviewing} 
                      reviewingFileId={reviewingFileId}
                      onTranscribe={handleTranscribeFile}
                      isTranscribing={isTranscribing}
                      transcribingFileId={transcribingFileId}
                    />
                    {files.length > 1 && (
                      <div className="flex gap-2 mt-3 overflow-x-auto pb-2">
                        {files.map((file, index) => (
                          <MiniThumbnail key={file.id} file={file} isActive={index === inlineFileIndex} onClick={() => setInlineFileIndex(index)} />
                        ))}
                        <button onClick={() => fileInputRef.current?.click()} disabled={uploadFile.isPending} className="w-12 h-12 rounded border-2 border-dashed border-muted-foreground/30 flex items-center justify-center hover:border-primary/50 hover:bg-muted/50 transition-all flex-shrink-0">
                          {uploadFile.isPending ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : <Plus className="h-4 w-4 text-muted-foreground" />}
                        </button>
                      </div>
                    )}
                    {files.length === 1 && (
                      <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} disabled={uploadFile.isPending} className="mt-3">
                        {uploadFile.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Plus className="h-4 w-4 mr-2" />}
                        Add more files
                      </Button>
                    )}
                  </div>
                )}
                
                {files.length === 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <Paperclip className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm font-medium">Files</span>
                    </div>
                    <button 
                      onClick={() => fileInputRef.current?.click()} 
                      disabled={uploadFile.isPending} 
                      className={cn(
                        "w-full h-24 rounded-lg border-2 border-dashed flex items-center justify-center transition-all",
                        isDragOver 
                          ? "border-primary bg-primary/10" 
                          : "border-muted-foreground/30 hover:border-primary/50 hover:bg-muted/50"
                      )}
                    >
                      {uploadFile.isPending ? <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /> : (
                        <div className="flex flex-col items-center gap-1 text-muted-foreground">
                          <Upload className="h-6 w-6" />
                          <span className="text-sm">Drop files here or click to upload</span>
                        </div>
                      )}
                    </button>
                  </div>
                )}
                
                <input type="file" ref={fileInputRef} className="hidden" onChange={handleFileUpload} multiple />
               
               <div>
                 <div className="flex items-center gap-2 mb-4">
                   <MessageSquare className="h-4 w-4 text-muted-foreground" />
                   <span className="text-sm font-medium">Activity & Discussion</span>
                 </div>
                 <div className="space-y-4">
                   {timeline.length === 0 ? (
                     <p className="text-sm text-muted-foreground text-center py-6">No activity yet. Start the conversation below.</p>
                   ) : (
                      timeline.map((entry) => {
                        // For file_uploaded history entries, find the matching file for inline preview
                        const matchedFile = entry.type === 'history' && entry.data.action === 'file_uploaded'
                          ? files.find(f => f.file_name === entry.data.new_value)
                          : null;

                        return (
                        <div key={`${entry.type}-${entry.data.id}`}>
                          {entry.type === 'comment' ? (
                            <div className="group flex gap-3">
                              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                                <span className="text-xs font-medium text-primary">{getInitials(getDisplayAuthorName(entry.data.author_name))}</span>
                              </div>
                               <div className="flex-1 min-w-0 w-[80%]">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="font-medium text-sm">{getDisplayAuthorName(entry.data.author_name)}</span>
                                  {entry.data.comment_type === 'voice' && <Badge variant="outline" className="text-xs h-5"><Mic className="h-3 w-3 mr-1" />Voice</Badge>}
                                  <span className="text-xs text-muted-foreground">{format(entry.timestamp, 'MMM d, h:mm a')}</span>
                                  {!isPublicView && (
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-6 w-6 ml-auto opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                                      onClick={() => {
                                        if (confirm('Delete this comment?')) {
                                          deleteComment.mutate({ commentId: entry.data.id, taskId: task!.id });
                                        }
                                      }}
                                      disabled={deleteComment.isPending}
                                      title="Delete comment"
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </Button>
                                  )}
                                </div>
                                {entry.data.comment_type === 'voice' && entry.data.audio_url && (
                                  <div className="mt-2"><VoiceNotePlayer audioUrl={entry.data.audio_url} duration={entry.data.duration_seconds || undefined} transcript={entry.data.transcript} /></div>
                                )}
                                {entry.data.comment_type !== 'voice' && <div className="text-sm mt-1 whitespace-pre-wrap break-words">{renderContentWithLinks(entry.data.content)}</div>}
                              </div>
                            </div>
                          ) : (
                            <div className="flex gap-3 items-start">
                              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-muted flex items-center justify-center">{getHistoryIcon(entry.data.action)}</div>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm text-muted-foreground">{formatHistoryAction(entry.data)}{entry.data.changed_by && <span> by {getDisplayAuthorName(entry.data.changed_by)}</span>}</p>
                                <span className="text-xs text-muted-foreground">{format(entry.timestamp, 'MMM d, h:mm a')}</span>
                                
                                {/* Inline media preview for uploaded files */}
                                {matchedFile && (() => {
                                  const isImage = matchedFile.file_type?.startsWith('image/');
                                  const isVideo = matchedFile.file_type?.startsWith('video/');
                                  const isAudio = matchedFile.file_type?.startsWith('audio/');
                                  const canTranscribe = isVideo || isAudio;
                                  
                                  return (
                                    <div className="mt-2 rounded-lg border bg-muted/30 overflow-hidden max-w-sm">
                                      {isImage && (
                                        <img
                                          src={matchedFile.file_url}
                                          alt={matchedFile.file_name}
                                          className="w-full max-h-48 object-contain bg-black/5 cursor-pointer"
                                          onClick={() => {
                                            const idx = files.findIndex(f => f.id === matchedFile.id);
                                            if (idx >= 0) openLightbox(idx);
                                          }}
                                        />
                                      )}
                                      {isVideo && (
                                        <video
                                          src={matchedFile.file_url}
                                          controls
                                          className="w-full max-h-48 bg-black/5"
                                        >
                                          Your browser does not support the video tag.
                                        </video>
                                      )}
                                      {isAudio && (
                                        <div className="p-3">
                                          <audio src={matchedFile.file_url} controls className="w-full" />
                                        </div>
                                      )}
                                      <div className="flex items-center gap-1 p-2 border-t">
                                        {canTranscribe && (
                                          <Button
                                            variant="outline"
                                            size="sm"
                                            className="h-7 text-xs"
                                            onClick={() => handleTranscribeFile(matchedFile)}
                                            disabled={isTranscribing}
                                          >
                                            {transcribingFileId === matchedFile.id ? (
                                              <Loader2 className="h-3 w-3 animate-spin mr-1" />
                                            ) : (
                                              <Mic className="h-3 w-3 mr-1" />
                                            )}
                                            Transcribe
                                          </Button>
                                        )}
                                        {(isImage || isVideo) && (
                                          <Button
                                            variant="outline"
                                            size="sm"
                                            className="h-7 text-xs"
                                            onClick={() => handleSendToCreative(matchedFile)}
                                          >
                                            <Send className="h-3 w-3 mr-1" />
                                            Send to Creative
                                          </Button>
                                        )}
                                      </div>
                                    </div>
                                  );
                                })()}
                              </div>
                            </div>
                          )}
                        </div>
                        );
                      })
                    )}
                 </div>
               </div>
             </div>
           </ScrollArea>
           
           <div className="p-4 border-t bg-background flex-shrink-0">
             {/* Pasted file previews */}
             {pastedPreviews.length > 0 && (
               <div className="flex gap-2 mb-3 overflow-x-auto pb-2">
                 {pastedPreviews.map((preview, index) => (
                   <div key={index} className="relative flex-shrink-0 group">
                     {preview.type.startsWith('image/') ? (
                       <img src={preview.url} alt="Pasted" className="h-16 w-16 object-cover rounded-md border" />
                     ) : (
                       <video src={preview.url} className="h-16 w-16 object-cover rounded-md border" />
                     )}
                     <button
                       onClick={() => removePastedFile(index)}
                       className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                     >
                       ×
                     </button>
                   </div>
                 ))}
               </div>
             )}
               <div className="flex gap-2 items-end">
                 <MentionTextarea 
                   value={newComment} 
                   onChange={setNewComment} 
                   placeholder="Post a comment... (@ to mention, Ctrl+Enter to send)" 
                   onKeyDown={(e) => {
                     if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                       e.preventDefault();
                       handleAddComment();
                     }
                   }} 
                   onPaste={handleCommentPaste}
                   className="flex-1 min-h-[40px] max-h-[160px] resize-none"
                   rows={1}
                   onInput={(e) => {
                     const target = e.target as HTMLTextAreaElement;
                     target.style.height = 'auto';
                     target.style.height = Math.min(target.scrollHeight, 160) + 'px';
                   }}
                 />
                <div className="flex gap-1 flex-shrink-0 pb-0.5">
                  <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => discussionFileInputRef.current?.click()} disabled={uploadFile.isPending}>
                    {uploadFile.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />}
                  </Button>
                  <input type="file" ref={discussionFileInputRef} className="hidden" onChange={handleFileUpload} />
                  <TaskDiscussionVoiceNote taskId={task.id} authorName={getAuthorName()} />
                  <Button className="h-9 w-9" size="icon" onClick={handleAddComment} disabled={(!newComment.trim() && pastedFiles.length === 0) || addComment.isPending}>
                    {addComment.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
           </div>
         </SheetContent>
       </Sheet>
       
       <FilePreviewLightbox files={files} selectedIndex={selectedFileIndex} open={lightboxOpen} onOpenChange={setLightboxOpen} onNavigate={setSelectedFileIndex} onSendToCreative={handleSendToCreative} onAIReview={handleAIReview} isReviewing={isReviewing} reviewingFileId={reviewingFileId} />
       
       {resolvedClientId && (
         <SendToCreativeModal file={selectedFileForCreative} clientId={resolvedClientId} clientName={clientName} open={sendToCreativeOpen} onOpenChange={setSendToCreativeOpen} onSuccess={() => setSelectedFileForCreative(null)} />
       )}
     </>
   );
 }