import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2, Mail, MessageSquare, Send } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientId: string;
  clientName?: string;
  defaultSubject?: string;
  defaultMessage?: string;
  previewUrl?: string;
  taskId?: string;
  creativeId?: string;
}

export function SendToClientDialog({
  open, onOpenChange, clientId, clientName,
  defaultSubject = '', defaultMessage = '',
  previewUrl, taskId, creativeId,
}: Props) {
  const [subject, setSubject] = useState(defaultSubject);
  const [message, setMessage] = useState(defaultMessage);
  const [sendEmail, setSendEmail] = useState(true);
  const [sendSms, setSendSms] = useState(true);
  const [overrideEmail, setOverrideEmail] = useState('');
  const [overridePhone, setOverridePhone] = useState('');
  const [sending, setSending] = useState(false);
  const [contact, setContact] = useState<{ email: string | null; phone: string | null } | null>(null);

  useEffect(() => {
    if (!open || !clientId) return;
    setSubject(defaultSubject);
    setMessage(defaultMessage);
    setOverrideEmail('');
    setOverridePhone('');
    (async () => {
      const { data } = await supabase
        .from('clients')
        .select('notification_email, notification_phone')
        .eq('id', clientId)
        .maybeSingle();
      setContact({
        email: (data as any)?.notification_email || null,
        phone: (data as any)?.notification_phone || null,
      });
    })();
  }, [open, clientId, defaultSubject, defaultMessage]);

  const handleSend = async () => {
    if (!message.trim()) {
      toast.error('Message is required');
      return;
    }
    const channels: string[] = [];
    if (sendEmail) channels.push('email');
    if (sendSms) channels.push('sms');
    if (channels.length === 0) {
      toast.error('Pick at least one channel');
      return;
    }
    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke('send-client-notification', {
        body: {
          client_id: clientId,
          subject: subject || undefined,
          message,
          preview_url: previewUrl,
          channels,
          task_id: taskId,
          creative_id: creativeId,
          override_email: overrideEmail.trim() || undefined,
          override_phone: overridePhone.trim() || undefined,
        },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      const sent = (data as any)?.sent_to || {};
      const parts = [sent.email && `email → ${sent.email}`, sent.phone && `SMS → ${sent.phone}`].filter(Boolean);
      toast.success(`Sent (${parts.join(', ') || 'done'})`);
      onOpenChange(false);
    } catch (err: any) {
      toast.error('Send failed: ' + (err?.message || 'Unknown error'));
    } finally {
      setSending(false);
    }
  };

  const effectiveEmail = overrideEmail.trim() || contact?.email || '';
  const effectivePhone = overridePhone.trim() || contact?.phone || '';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Send to {clientName || 'Client'}</DialogTitle>
          <DialogDescription>
            Email goes through GoHighLevel; SMS goes through the agency GHL number.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Subject (email only)</Label>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="e.g. New creative for review" />
          </div>

          <div className="space-y-2">
            <Label>Message</Label>
            <Textarea rows={4} value={message} onChange={(e) => setMessage(e.target.value)} />
            {previewUrl && (
              <p className="text-xs text-muted-foreground">
                Preview link will be appended: <span className="underline break-all">{previewUrl}</span>
              </p>
            )}
          </div>

          <div className="space-y-3 border rounded-md p-3">
            <div className="flex items-center gap-2">
              <Checkbox checked={sendEmail} onCheckedChange={(v) => setSendEmail(!!v)} id="ch-email" />
              <Label htmlFor="ch-email" className="flex items-center gap-2 cursor-pointer">
                <Mail className="h-4 w-4" /> Email
              </Label>
              <span className="text-xs text-muted-foreground ml-auto">{effectiveEmail || 'no email on file'}</span>
            </div>
            {sendEmail && (
              <Input
                placeholder="Override email (optional)"
                value={overrideEmail}
                onChange={(e) => setOverrideEmail(e.target.value)}
                className="h-8 text-sm"
              />
            )}
            <div className="flex items-center gap-2 pt-1">
              <Checkbox checked={sendSms} onCheckedChange={(v) => setSendSms(!!v)} id="ch-sms" />
              <Label htmlFor="ch-sms" className="flex items-center gap-2 cursor-pointer">
                <MessageSquare className="h-4 w-4" /> SMS
              </Label>
              <span className="text-xs text-muted-foreground ml-auto">{effectivePhone || 'no phone on file'}</span>
            </div>
            {sendSms && (
              <Input
                placeholder="Override phone (E.164, e.g. +15551234567)"
                value={overridePhone}
                onChange={(e) => setOverridePhone(e.target.value)}
                className="h-8 text-sm"
              />
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={sending}>Cancel</Button>
          <Button onClick={handleSend} disabled={sending}>
            {sending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
            Send
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}