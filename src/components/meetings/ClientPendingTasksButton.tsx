import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ClipboardCheck } from 'lucide-react';
import { usePendingMeetingTasks } from '@/hooks/useMeetings';
import { useClients } from '@/hooks/useClients';
import { PendingTasksReview } from './PendingTasksReview';

interface ClientPendingTasksButtonProps {
  clientId: string;
}

export function ClientPendingTasksButton({ clientId }: ClientPendingTasksButtonProps) {
  const [open, setOpen] = useState(false);
  const { data: allPending = [] } = usePendingMeetingTasks();
  const { data: clients = [] } = useClients();

  const scopedTasks = allPending.filter((t) => t.client_id === clientId);

  if (scopedTasks.length === 0) return null;

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className="gap-1.5"
        title="Review AI-generated tasks pending approval"
      >
        <ClipboardCheck className="h-4 w-4" />
        <span className="hidden sm:inline">Approve</span>
        <Badge variant="secondary" className="ml-0.5 px-1.5 py-0 h-5 min-w-5">
          {scopedTasks.length}
        </Badge>
      </Button>
      <PendingTasksReview
        tasks={scopedTasks}
        clients={clients}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  );
}