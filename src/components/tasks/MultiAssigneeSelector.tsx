import { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { User, Users, Building2, X, Plus, Briefcase } from 'lucide-react';
import { useAgencyMembers, AgencyMember } from '@/hooks/useTasks';
import { useAgencyPods } from '@/hooks/useAgencyPods';
import { useClients, Client } from '@/hooks/useClients';
import { useTaskAssignees, useSetTaskAssignees, TaskAssignee } from '@/hooks/useTaskAssignees';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';

interface MultiAssigneeSelectorProps {
  taskId: string;
  isPublicView?: boolean;
  onAssignmentChange?: () => void;
  currentClientName?: string | null;
}

export function MultiAssigneeSelector({ 
  taskId, 
  isPublicView = false,
  onAssignmentChange,
  currentClientName,
}: MultiAssigneeSelectorProps) {
  const [open, setOpen] = useState(false);
  const { data: agencyMembers = [] } = useAgencyMembers();
  const { data: pods = [] } = useAgencyPods();
  const { data: clients = [] } = useClients();
  const { data: assignees = [] } = useTaskAssignees(taskId);
  const setAssignees = useSetTaskAssignees();

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

  // Get currently selected member and pod IDs
  const selectedMemberIds = assignees.filter(a => a.member_id).map(a => a.member_id!);
  const selectedPodIds = assignees.filter(a => a.pod_id).map(a => a.pod_id!);

  const toggleMember = async (memberId: string) => {
    const newMemberIds = selectedMemberIds.includes(memberId)
      ? selectedMemberIds.filter(id => id !== memberId)
      : [...selectedMemberIds, memberId];
    
    await setAssignees.mutateAsync({
      taskId,
      memberIds: newMemberIds,
      podIds: selectedPodIds,
    });
    onAssignmentChange?.();
  };

  const togglePod = async (podId: string) => {
    const isCurrentlySelected = selectedPodIds.includes(podId);
    const newPodIds = isCurrentlySelected
      ? selectedPodIds.filter(id => id !== podId)
      : [...selectedPodIds, podId];
    
    // Get all members in this pod
    const podMembers = membersByPod[podId] || [];
    const podMemberIds = podMembers.map(m => m.id);
    
    // When adding a pod, also add all its members; when removing, remove pod members too
    let newMemberIds: string[];
    if (isCurrentlySelected) {
      // Removing pod - also remove all pod members
      newMemberIds = selectedMemberIds.filter(id => !podMemberIds.includes(id));
    } else {
      // Adding pod - also add all pod members (avoid duplicates)
      newMemberIds = [...new Set([...selectedMemberIds, ...podMemberIds])];
    }
    
    await setAssignees.mutateAsync({
      taskId,
      memberIds: newMemberIds,
      podIds: newPodIds,
    });
    onAssignmentChange?.();
  };

  const removeAssignee = async (assignee: TaskAssignee) => {
    if (assignee.member_id) {
      await setAssignees.mutateAsync({
        taskId,
        memberIds: selectedMemberIds.filter(id => id !== assignee.member_id),
        podIds: selectedPodIds,
      });
    } else if (assignee.pod_id) {
      await setAssignees.mutateAsync({
        taskId,
        memberIds: selectedMemberIds,
        podIds: selectedPodIds.filter(id => id !== assignee.pod_id),
      });
    }
    onAssignmentChange?.();
  };

  const selectClient = async (client: Client) => {
    await supabase
      .from('tasks')
      .update({ assigned_client_name: client.name, client_id: client.id })
      .eq('id', taskId);
    onAssignmentChange?.();
  };

  const removeClient = async () => {
    await supabase
      .from('tasks')
      .update({ assigned_client_name: null })
      .eq('id', taskId);
    onAssignmentChange?.();
  };

  // Get display name - for public view show pod name instead of individual name
  const getAssigneeDisplay = (assignee: TaskAssignee) => {
    if (assignee.pod_id && assignee.pod) {
      return {
        name: `${assignee.pod.name} Team`,
        color: assignee.pod.color,
        icon: <Building2 className="h-3 w-3" />,
      };
    }
    if (assignee.member_id && assignee.member) {
      if (isPublicView && assignee.member.pod) {
        // In public view, show pod name instead of individual
        return {
          name: `${assignee.member.pod.name} Team`,
          color: assignee.member.pod.color,
          icon: <Building2 className="h-3 w-3" />,
        };
      }
      return {
        name: assignee.member.name,
        color: assignee.member.pod?.color,
        icon: <User className="h-3 w-3" />,
      };
    }
    return { name: 'Unknown', icon: <User className="h-3 w-3" /> };
  };

  // Deduplicate for public view (group by pod)
  const displayAssignees = useMemo(() => {
    if (!isPublicView) return assignees;
    
    // For public view, deduplicate by pod
    const seen = new Set<string>();
    return assignees.filter(a => {
      const display = getAssigneeDisplay(a);
      if (seen.has(display.name)) return false;
      seen.add(display.name);
      return true;
    });
  }, [assignees, isPublicView]);

  return (
    <div className="space-y-2">
      {/* Current assignees */}
      <div className="flex flex-wrap gap-1.5">
        {/* Client badge */}
        {currentClientName && (
          <Badge 
            variant="secondary"
            className="flex items-center gap-1 pr-1"
          >
            <Briefcase className="h-3 w-3 text-primary" />
            <span className="text-xs">{currentClientName}</span>
            {!isPublicView && (
              <button
                onClick={() => removeClient()}
                className="ml-1 hover:bg-muted rounded p-0.5"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </Badge>
        )}
        {displayAssignees.length === 0 && !currentClientName ? (
          <span className="text-sm text-muted-foreground">No assignees</span>
        ) : (
          displayAssignees.map(assignee => {
            const display = getAssigneeDisplay(assignee);
            return (
              <Badge 
                key={assignee.id} 
                variant="secondary"
                className="flex items-center gap-1 pr-1"
              >
                <div 
                  className="w-2 h-2 rounded-full mr-1" 
                  style={{ backgroundColor: display.color || '#888' }}
                />
                {display.icon}
                <span className="text-xs">{display.name}</span>
                {!isPublicView && (
                  <button
                    onClick={() => removeAssignee(assignee)}
                    className="ml-1 hover:bg-muted rounded p-0.5"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </Badge>
            );
          })
        )}
      </div>

      {/* Add assignee button */}
      {!isPublicView && (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-7 text-xs">
              <Plus className="h-3 w-3 mr-1" />
              Add Assignee
            </Button>
          </PopoverTrigger>
          <PopoverContent
            className="w-72 p-0"
            align="start"
            onWheel={(e) => e.stopPropagation()}
            onTouchMove={(e) => e.stopPropagation()}
          >
            <div
              className="max-h-96 overflow-y-auto overscroll-contain p-2 space-y-2"
              onWheel={(e) => e.stopPropagation()}
            >
                {/* Pods section — Teams first */}
                <div className="px-2 py-1 text-xs font-medium text-muted-foreground">
                  Teams
                </div>
                {pods.map(pod => (
                  <div
                    key={pod.id}
                    className={cn(
                      "flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer hover:bg-muted",
                      selectedPodIds.includes(pod.id) && "bg-muted"
                    )}
                    onClick={() => togglePod(pod.id)}
                  >
                    <Checkbox checked={selectedPodIds.includes(pod.id)} />
                    <div 
                      className="w-2 h-2 rounded-full" 
                      style={{ backgroundColor: pod.color || '#888' }}
                    />
                    <Building2 className="h-3 w-3" />
                    <span className="text-sm">{pod.name} Team</span>
                  </div>
                ))}

                {/* Members section */}
                <div className="px-2 py-1 text-xs font-medium text-muted-foreground mt-2">
                  Individuals
                </div>
                {pods.map(pod => {
                  const members = membersByPod[pod.id] || [];
                  if (members.length === 0) return null;
                  
                  return (
                    <div key={pod.id}>
                      <div className="px-2 py-0.5 text-xs text-muted-foreground flex items-center gap-1">
                        <div 
                          className="w-1.5 h-1.5 rounded-full" 
                          style={{ backgroundColor: pod.color || '#888' }}
                        />
                        {pod.name}
                      </div>
                      {members.map(member => (
                        <div
                          key={member.id}
                          className={cn(
                            "flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer hover:bg-muted ml-2",
                            selectedMemberIds.includes(member.id) && "bg-muted"
                          )}
                          onClick={() => toggleMember(member.id)}
                        >
                          <Checkbox checked={selectedMemberIds.includes(member.id)} />
                          <User className="h-3 w-3" />
                          <span className="text-sm">{member.name}</span>
                        </div>
                      ))}
                    </div>
                  );
                })}

                {/* Unassigned members */}
                {membersByPod.unassigned?.length > 0 && (
                  <>
                    <div className="px-2 py-0.5 text-xs text-muted-foreground">
                      Other
                    </div>
                    {membersByPod.unassigned.map(member => (
                      <div
                        key={member.id}
                        className={cn(
                          "flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer hover:bg-muted",
                          selectedMemberIds.includes(member.id) && "bg-muted"
                        )}
                        onClick={() => toggleMember(member.id)}
                      >
                        <Checkbox checked={selectedMemberIds.includes(member.id)} />
                        <User className="h-3 w-3" />
                        <span className="text-sm">{member.name}</span>
                      </div>
                    ))}
                  </>
                )}

                {/* Clients section — moved to the bottom */}
                {clients.length > 0 && (
                  <>
                    <div className="px-2 py-1 text-xs font-medium text-muted-foreground mt-2 border-t pt-2">
                      Clients
                    </div>
                    {clients.filter(c => c.status === 'active').map(client => (
                      <div
                        key={client.id}
                        className={cn(
                          "flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer hover:bg-muted",
                          currentClientName === client.name && "bg-muted"
                        )}
                        onClick={() => selectClient(client)}
                      >
                        <Checkbox checked={currentClientName === client.name} />
                        <Briefcase className="h-3 w-3 text-primary" />
                        <span className="text-sm">{client.name}</span>
                      </div>
                    ))}
                  </>
                )}
            </div>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}
