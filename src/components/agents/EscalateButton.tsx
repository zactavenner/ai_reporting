import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { AlertTriangle } from "lucide-react";
import { useEscalateChannel } from "@/hooks/useEscalateChannel";

interface Props {
  channelId: string;
  channelName?: string | null;
  clientId?: string | null;
  agentId?: string | null;
  agentName?: string | null;
  size?: "sm" | "default";
  variant?: "destructive" | "outline" | "ghost";
}

export function EscalateButton({ channelId, channelName, clientId, agentId, agentName, size = "sm", variant = "destructive" }: Props) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const escalate = useEscalateChannel();

  const submit = async () => {
    await escalate.mutateAsync({ channelId, channelName, clientId, agentId, agentName, reason });
    setReason("");
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size={size} variant={variant} className="gap-1">
          <AlertTriangle className="h-3.5 w-3.5" /> Escalate
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Escalate this thread</DialogTitle>
          <DialogDescription>
            Creates a high-priority task{clientId ? " for this client" : " (no client linked — task creation skipped)"} and notifies the team via Slack.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          autoFocus
          rows={4}
          placeholder="What needs immediate action? Include context the team needs to act."
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="destructive" onClick={submit} disabled={!reason.trim() || escalate.isPending}>
            {escalate.isPending ? "Escalating…" : "Escalate now"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}