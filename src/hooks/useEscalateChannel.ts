import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface EscalateInput {
  channelId: string;
  channelName?: string | null;
  clientId?: string | null;
  agentId?: string | null;
  agentName?: string | null;
  reason: string;
}

export function useEscalateChannel() {
  return useMutation({
    mutationFn: async (input: EscalateInput) => {
      const reason = input.reason.trim();
      if (!reason) throw new Error("Escalation reason is required");

      const { data: userData } = await supabase.auth.getUser();
      const userId = userData?.user?.id || null;

      const title = `🚨 Escalation: ${input.agentName || "Agent"} — ${input.channelName || "channel"}`.slice(0, 180);
      const description = `Escalated from agent channel ${input.channelName || input.channelId}\n\n${reason}`;

      // 1. Create high-priority task (requires client_id)
      let taskId: string | null = null;
      if (input.clientId) {
        const { data: task, error: taskErr } = await (supabase as any)
          .from("tasks")
          .insert({
            client_id: input.clientId,
            title,
            description,
            priority: "high",
            status: "todo",
          })
          .select("id")
          .single();
        if (taskErr) throw taskErr;
        taskId = task.id;
      }

      // 2. Log escalation as an agent message in the channel
      const { error: msgErr } = await (supabase as any).from("agent_messages").insert({
        channel_id: input.channelId,
        body: reason,
        role: "human",
        kind: "escalation",
        to_agent_id: input.agentId || null,
        task_id: taskId,
        user_id: userId,
        payload: { escalated_at: new Date().toISOString(), task_id: taskId },
      });
      if (msgErr) throw msgErr;

      // 3. Record in agent_escalations table for audit
      try {
        await (supabase as any).from("agent_escalations").insert({
          agent_id: input.agentId || null,
          client_id: input.clientId || null,
          task_id: taskId,
          reason,
          status: "open",
        });
      } catch (e) {
        console.warn("agent_escalations insert skipped", e);
      }

      // 4. Fire Slack notification (only when client + task exist; slack-notify needs client_id)
      if (input.clientId && taskId) {
        try {
          await supabase.functions.invoke("slack-notify", {
            body: {
              type: "task_created",
              client_id: input.clientId,
              task: { id: taskId, title, priority: "high" },
              user_name: "Agent Escalation",
            },
          });
        } catch (e) {
          console.warn("slack-notify failed", e);
        }
      }

      return { taskId };
    },
    onSuccess: (res) => {
      toast.success(res.taskId ? "Escalated — task created & Slack notified" : "Escalation logged in channel");
    },
    onError: (e: any) => toast.error(e?.message || "Failed to escalate"),
  });
}