import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Loader2 } from 'lucide-react';
import { useCreateTask } from '@/hooks/useTasks';
import { toast } from 'sonner';

interface BulkAddTasksDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientId?: string;
}

export function BulkAddTasksDialog({ open, onOpenChange, clientId }: BulkAddTasksDialogProps) {
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const createTask = useCreateTask();

  const handleSubmit = async () => {
    const lines = text
      .split('\n')
      .map(l => l.replace(/^[\s\-\*\d\.\)]+/, '').trim())
      .filter(l => l.length > 0);

    if (lines.length === 0) {
      toast.error('Paste at least one task');
      return;
    }

    setSubmitting(true);
    let success = 0;
    let failed = 0;
    for (const title of lines) {
      try {
        await createTask.mutateAsync({
          title,
          stage: 'todo',
          status: 'pending',
          priority: 'medium',
          client_id: clientId,
        } as any);
        success++;
      } catch (e) {
        failed++;
      }
    }
    setSubmitting(false);
    toast.success(`Created ${success} task${success === 1 ? '' : 's'}${failed ? ` (${failed} failed)` : ''}`);
    setText('');
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Bulk add tasks</DialogTitle>
          <DialogDescription>
            Paste one task per line. All tasks will be created in the To-Do stage.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={'Write ad copy\nReview landing page\nSchedule kickoff call'}
          rows={12}
          className="font-mono text-sm"
          disabled={submitting}
        />
        <p className="text-xs text-muted-foreground">
          {text.split('\n').filter(l => l.trim()).length} task(s) detected
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Create tasks
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}