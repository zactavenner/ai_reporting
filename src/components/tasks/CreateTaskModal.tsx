import { useState, useEffect, useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SelectGroup,
  SelectLabel,
} from '@/components/ui/select';
import { Calendar } from '@/components/ui/calendar';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { CalendarIcon, Loader2, User, Building2, Repeat, Paperclip, X, FileIcon } from 'lucide-react';
import { format } from 'date-fns';
import { cn, addBusinessDays } from '@/lib/utils';
import { useCreateTask, useAgencyMembers, AgencyMember, useUploadTaskFile, useAddTaskComment } from '@/hooks/useTasks';
import { useAgencyPods } from '@/hooks/useAgencyPods';
import { useSetTaskAssignees } from '@/hooks/useTaskAssignees';
import { useCreateNotification } from './NotificationsTab';
import { Client } from '@/hooks/useClients';
import { Badge } from '@/components/ui/badge';
import { useTeamMember } from '@/contexts/TeamMemberContext';
import { toast } from 'sonner';

interface CreateTaskModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clients: Client[];
  defaultClientId?: string;
  isPublicView?: boolean;
  defaultStage?: string;
}

export function CreateTaskModal({ open, onOpenChange, clients, defaultClientId, isPublicView = false, defaultStage }: CreateTaskModalProps) {
  const createTask = useCreateTask();
  const setTaskAssignees = useSetTaskAssignees();
  const createNotification = useCreateNotification();
  const { data: agencyMembers = [] } = useAgencyMembers();
  const { data: pods = [] } = useAgencyPods();
  const { currentMember } = useTeamMember();
  const uploadTaskFile = useUploadTaskFile();
  const addTaskComment = useAddTaskComment();
  
  // Default due date: tomorrow
  const defaultDueDate = useMemo(() => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return tomorrow;
  }, []);
  
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [clientId, setClientId] = useState(defaultClientId || '');
  const [priority, setPriority] = useState('medium');
  const [dueDate, setDueDate] = useState<Date | undefined>(defaultDueDate);
  const [dueDateManuallySet, setDueDateManuallySet] = useState(false);
  const [assignedTo, setAssignedTo] = useState('');
  const [selectedMemberId, setSelectedMemberId] = useState<string>('');
  const [selectedPodId, setSelectedPodId] = useState<string>('');
  const [assignedClientName, setAssignedClientName] = useState('');
  const [stage, setStage] = useState(defaultStage || 'todo');
  const [recurrenceType, setRecurrenceType] = useState<string>('none');
  const [recurrenceInterval, setRecurrenceInterval] = useState<number>(1);
  const [initialComment, setInitialComment] = useState('');
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  
  useEffect(() => {
    if (defaultClientId) {
      setClientId(defaultClientId);
    }
  }, [defaultClientId]);
  
  // Reset due date when modal opens
  useEffect(() => {
    if (open) {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      setDueDate(tomorrow);
      setDueDateManuallySet(false);
      setStage(defaultStage || 'todo');
    }
  }, [open, defaultStage]);

  // Get members for a specific pod
  const getMembersForPod = (podId: string) => {
    return agencyMembers.filter(m => m.pod_id === podId);
  };
  
  const handleCreate = async () => {
    if (!title.trim()) return;
    
    // Determine assigned_to: must be a valid member UUID or null
    // When a pod is selected, we use the first pod member's ID for the assigned_to column
    // and the task_assignees table handles the full team assignment
    let resolvedAssignedTo: string | null = null;
    if (selectedMemberId) {
      resolvedAssignedTo = selectedMemberId;
    } else if (selectedPodId) {
      const podMembers = getMembersForPod(selectedPodId);
      resolvedAssignedTo = podMembers.length > 0 ? podMembers[0].id : null;
    }
    
    const hasRecurrence = recurrenceType !== 'none';
    const recurrenceNextAt = hasRecurrence && dueDate
      ? (() => {
          const next = new Date(dueDate);
          switch (recurrenceType) {
            case 'daily': next.setDate(next.getDate() + recurrenceInterval); break;
            case 'weekly': next.setDate(next.getDate() + 7 * recurrenceInterval); break;
            case 'monthly': next.setMonth(next.getMonth() + recurrenceInterval); break;
          }
          return next.toISOString();
        })()
      : null;

    const taskData = await createTask.mutateAsync({
      title: title.trim(),
      description: description.trim() || null,
      client_id: clientId || null,
      priority,
      due_date: dueDate ? format(dueDate, 'yyyy-MM-dd') : null,
      status: 'todo',
      stage,
      assigned_to: resolvedAssignedTo,
      assigned_client_name: assignedClientName || null,
      created_by: currentMember?.name || (isPublicView ? 'Client' : null),
      recurrence_type: hasRecurrence ? recurrenceType : null,
      recurrence_interval: hasRecurrence ? recurrenceInterval : null,
      recurrence_next_at: recurrenceNextAt,
    } as any);
    
    // Handle task_assignees table entries
    if (taskData?.id) {
      if (selectedPodId) {
        // If a pod was selected, assign all members of that pod
        const podMembers = getMembersForPod(selectedPodId);
        const memberIds = podMembers.map(m => m.id);
        
        if (memberIds.length > 0) {
          await setTaskAssignees.mutateAsync({
            taskId: taskData.id,
            memberIds,
            podIds: [selectedPodId],
          });
        }
      } else if (selectedMemberId) {
        // If an individual member was selected, assign just that member
        await setTaskAssignees.mutateAsync({
          taskId: taskData.id,
          memberIds: [selectedMemberId],
          podIds: [],
        });
      }
      
      // Notify all assigned members about the new task
      const assignedMemberIds: string[] = [];
      if (selectedPodId) {
        const podMembers = getMembersForPod(selectedPodId);
        assignedMemberIds.push(...podMembers.map(m => m.id));
      } else if (selectedMemberId) {
        assignedMemberIds.push(selectedMemberId);
      }
      
      const creatorName = currentMember?.name || (isPublicView ? 'Client' : 'System');
      const stageName = stage === 'in_progress' ? 'In Progress' : stage === 'client_tasks' ? 'Client Tasks' : stage === 'todo' ? 'To-Do' : stage === 'review' ? 'Review' : stage === 'revisions' ? 'Revisions' : stage === 'stuck' ? 'Stuck' : stage;
      
      for (const memberId of assignedMemberIds) {
        if (currentMember?.id === memberId) continue;
        await createNotification.mutateAsync({
          taskId: taskData.id,
          memberId,
          triggeredBy: creatorName,
          message: `${creatorName} assigned you a new task "${title.trim()}" in ${stageName}`,
        });
      }
      
      // Upload attached files
      const uploaderName = currentMember?.name || (isPublicView ? 'Client' : 'System');
      for (const file of attachedFiles) {
        try {
          await uploadTaskFile.mutateAsync({
            taskId: taskData.id,
            file,
            uploadedBy: uploaderName,
          });
        } catch (e) {
          console.error('Failed to upload file:', e);
        }
      }
      
      // Add initial comment if provided
      if (initialComment.trim()) {
        try {
          await addTaskComment.mutateAsync({
            taskId: taskData.id,
            authorName: uploaderName,
            content: initialComment.trim(),
          });
        } catch (e) {
          console.error('Failed to add comment:', e);
        }
      }
    }
    
    // Reset form
    setTitle('');
    setDescription('');
    setClientId(defaultClientId || '');
    setPriority('medium');
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    setDueDate(tomorrow);
    setDueDateManuallySet(false);
    setAssignedTo('');
    setSelectedMemberId('');
    setSelectedPodId('');
    setAssignedClientName('');
    setStage('todo');
    setRecurrenceType('none');
    setRecurrenceInterval(1);
    setInitialComment('');
    setAttachedFiles([]);
    onOpenChange(false);
  };

  // Get selected client name for the client assignment option
  const selectedClient = clients.find(c => c.id === clientId);

  // Group members by pod
  const membersByPod = useMemo(() => {
    const grouped: Record<string, AgencyMember[]> = { unassigned: [] };
    pods.forEach(pod => { grouped[pod.id] = []; });
    
    agencyMembers.forEach(member => {
      const podId = member.pod_id || 'unassigned';
      if (!grouped[podId]) grouped[podId] = [];
      grouped[podId].push(member);
    });
    
    return grouped;
  }, [agencyMembers, pods]);
  
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Create New Task</DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4 overflow-y-auto pr-1">
          <div>
            <Label>Title *</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Enter task title"
            />
          </div>
          
          <div>
            <Label>Description</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Add task description..."
              rows={3}
            />
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Client</Label>
              <Select value={clientId || 'none'} onValueChange={(v) => setClientId(v === 'none' ? '' : v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select client" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No client</SelectItem>
                  {clients.map(client => (
                    <SelectItem key={client.id} value={client.id}>
                      {client.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            <div>
              <Label>Priority</Label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-xs">Low</Badge>
                    </div>
                  </SelectItem>
                  <SelectItem value="medium">
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary" className="text-xs">Medium</Badge>
                    </div>
                  </SelectItem>
                  <SelectItem value="high">
                    <div className="flex items-center gap-2">
                      <Badge variant="destructive" className="text-xs">High</Badge>
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Stage</Label>
              <Select value={stage} onValueChange={setStage}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="client_tasks">Client Tasks</SelectItem>
                  <SelectItem value="todo">To-Do</SelectItem>
                  <SelectItem value="in_progress">In Progress</SelectItem>
                  <SelectItem value="stuck">Stuck</SelectItem>
                  <SelectItem value="review">Review</SelectItem>
                  <SelectItem value="revisions">Revisions</SelectItem>
                  <SelectItem value="done">Completed</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <div>
              <Label>
                Due Date
                {!dueDateManuallySet && dueDate && (
                  <span className="text-xs text-muted-foreground ml-2">(auto: +2 business days)</span>
                )}
              </Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      'w-full justify-start text-left font-normal',
                      !dueDate && 'text-muted-foreground'
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {dueDate ? format(dueDate, 'PPP') : 'Pick a date'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={dueDate}
                    onSelect={(date) => {
                      setDueDate(date);
                      setDueDateManuallySet(true);
                    }}
                    initialFocus
                    className="pointer-events-auto"
                  />
                </PopoverContent>
              </Popover>
            </div>
          </div>

          {/* Recurrence Section */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="flex items-center gap-1.5">
                <Repeat className="h-3.5 w-3.5" />
                Recurring
              </Label>
              <Select value={recurrenceType} onValueChange={setRecurrenceType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No repeat</SelectItem>
                  <SelectItem value="daily">Daily</SelectItem>
                  <SelectItem value="weekly">Weekly</SelectItem>
                  <SelectItem value="monthly">Monthly</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {recurrenceType !== 'none' && (
              <div>
                <Label>Every</Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={1}
                    max={99}
                    value={recurrenceInterval}
                    onChange={(e) => setRecurrenceInterval(Math.max(1, parseInt(e.target.value) || 1))}
                    className="w-20"
                  />
                  <span className="text-sm text-muted-foreground">
                    {recurrenceType === 'daily' ? 'day(s)' : recurrenceType === 'weekly' ? 'week(s)' : 'month(s)'}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Assignment Section */}
          <div>
            <Label>Assign To</Label>
            <div className="space-y-2">
              {isPublicView ? (
                // Public view: show only pods (teams), not individual names
                <Select 
                  value={selectedPodId || 'none'} 
                  onValueChange={(v) => { 
                    setSelectedPodId(v === 'none' ? '' : v); 
                    setAssignedTo('');
                    setAssignedClientName(''); 
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select team..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Unassigned</SelectItem>
                    {pods.map(pod => (
                      <SelectItem key={pod.id} value={pod.id}>
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: pod.color || '#888' }} />
                          <Building2 className="h-3 w-3" />
                          <span>{pod.name} Team</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                // Internal view: show pods to assign all members, or individual members
                <Select 
                  value={selectedPodId ? `pod:${selectedPodId}` : (selectedMemberId ? `member:${selectedMemberId}` : 'none')} 
                  onValueChange={(v) => { 
                    if (v === 'none') {
                      setAssignedTo('');
                      setSelectedMemberId('');
                      setSelectedPodId('');
                    } else if (v.startsWith('pod:')) {
                      setSelectedPodId(v.replace('pod:', ''));
                      setSelectedMemberId('');
                      setAssignedTo('');
                    } else if (v.startsWith('member:')) {
                      const memberId = v.replace('member:', '');
                      const member = agencyMembers.find(m => m.id === memberId);
                      setSelectedMemberId(memberId);
                      setAssignedTo(member?.name || '');
                      setSelectedPodId('');
                    }
                    setAssignedClientName(''); 
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select team or member..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Unassigned</SelectItem>
                    
                    {/* Pod assignments - assign to entire team */}
                    <SelectGroup>
                      <SelectLabel className="text-xs text-muted-foreground">Assign to Entire Team</SelectLabel>
                      {pods.map(pod => {
                        const memberCount = getMembersForPod(pod.id).length;
                        return (
                          <SelectItem key={`pod:${pod.id}`} value={`pod:${pod.id}`}>
                            <div className="flex items-center gap-2">
                              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: pod.color || '#888' }} />
                              <Building2 className="h-3 w-3" />
                              <span>{pod.name} Team</span>
                              <Badge variant="outline" className="text-xs ml-1">{memberCount}</Badge>
                            </div>
                          </SelectItem>
                        );
                      })}
                    </SelectGroup>
                    
                    {/* Individual member assignments */}
                    {pods.map(pod => {
                      const podMembers = membersByPod[pod.id] || [];
                      if (podMembers.length === 0) return null;
                      return (
                        <SelectGroup key={pod.id}>
                          <SelectLabel className="flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: pod.color }} />
                            {pod.name}
                          </SelectLabel>
                          {podMembers.map(member => (
                            <SelectItem key={member.id} value={`member:${member.id}`}>
                              <div className="flex items-center gap-2 pl-4">
                                <User className="h-3 w-3" />
                                <span>{member.name}</span>
                              </div>
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      );
                    })}
                    {membersByPod.unassigned?.length > 0 && (
                      <SelectGroup>
                        <SelectLabel>Unassigned Members</SelectLabel>
                        {membersByPod.unassigned.map(member => (
                          <SelectItem key={member.id} value={`member:${member.id}`}>
                            <div className="flex items-center gap-2 pl-4">
                              <User className="h-3 w-3" />
                              <span>{member.name}</span>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    )}
                  </SelectContent>
                </Select>
              )}
              
              {selectedClient && !isPublicView && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Or assign to client:</span>
                  <Input
                    value={assignedClientName}
                    onChange={(e) => { setAssignedClientName(e.target.value); setAssignedTo(''); setSelectedMemberId(''); setSelectedPodId(''); }}
                    placeholder={`${selectedClient.name} contact...`}
                    className="flex-1 h-8 text-sm"
                  />
                </div>
              )}
            </div>
          </div>

          {/* Initial Comment */}
          <div>
            <Label>Comment (optional)</Label>
            <Textarea
              value={initialComment}
              onChange={(e) => setInitialComment(e.target.value)}
              placeholder="Add an initial comment or note..."
              rows={2}
            />
          </div>

          {/* File Attachments */}
          <div>
            <Label>Attachments</Label>
            <div className="space-y-2">
              <div
                className="border-2 border-dashed rounded-lg p-3 text-center cursor-pointer hover:border-primary/50 transition-colors"
                onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const files = Array.from(e.dataTransfer.files);
                  setAttachedFiles(prev => [...prev, ...files]);
                }}
                onClick={() => {
                  const input = document.createElement('input');
                  input.type = 'file';
                  input.multiple = true;
                  input.onchange = (e) => {
                    const files = Array.from((e.target as HTMLInputElement).files || []);
                    setAttachedFiles(prev => [...prev, ...files]);
                  };
                  input.click();
                }}
                onPaste={(e) => {
                  const files = Array.from(e.clipboardData.files);
                  if (files.length > 0) {
                    e.preventDefault();
                    setAttachedFiles(prev => [...prev, ...files]);
                  }
                }}
                tabIndex={0}
              >
                <Paperclip className="h-4 w-4 mx-auto mb-1 text-muted-foreground" />
                <p className="text-xs text-muted-foreground">
                  Click, drag & drop, or paste files
                </p>
              </div>
              {attachedFiles.length > 0 && (
                <div className="space-y-1">
                  {attachedFiles.map((file, idx) => (
                    <div key={idx} className="flex items-center gap-2 text-sm bg-muted/50 rounded px-2 py-1">
                      <FileIcon className="h-3 w-3 text-muted-foreground shrink-0" />
                      <span className="truncate flex-1">{file.name}</span>
                      <span className="text-xs text-muted-foreground shrink-0">
                        {(file.size / 1024).toFixed(0)}KB
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5"
                        onClick={(e) => {
                          e.stopPropagation();
                          setAttachedFiles(prev => prev.filter((_, i) => i !== idx));
                        }}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          
          <div className="flex justify-end gap-2 pt-4">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button 
              onClick={handleCreate}
              disabled={!title.trim() || createTask.isPending}
            >
              {createTask.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Create Task
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
