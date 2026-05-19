import { useMemo, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Copy } from 'lucide-react';
import { toast } from 'sonner';
import { WELCOME_MESSAGE_TEMPLATE } from '@/lib/constraintRules';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  defaultFirstName?: string;
  defaultAmName?: string;
}

export function WelcomeMessageDialog({ open, onOpenChange, defaultFirstName, defaultAmName }: Props) {
  const [firstName, setFirstName] = useState(defaultFirstName ?? '');
  const [amName, setAmName] = useState(defaultAmName ?? '');

  const message = useMemo(
    () =>
      WELCOME_MESSAGE_TEMPLATE
        .split('{{first_name}}')
        .join(firstName || '{{first_name}}')
        .split('{{am_name}}')
        .join(amName || '{{am_name}}'),
    [firstName, amName],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Send Welcome Message</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Client first name</Label>
            <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} />
          </div>
          <div>
            <Label>Your name (AM)</Label>
            <Input value={amName} onChange={(e) => setAmName(e.target.value)} />
          </div>
        </div>
        <Textarea value={message} readOnly rows={14} className="text-sm font-mono" />
        <DialogFooter>
          <Button
            onClick={() => {
              navigator.clipboard.writeText(message);
              toast.success('Welcome message copied');
            }}
          >
            <Copy className="h-4 w-4 mr-2" /> Copy to clipboard
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}