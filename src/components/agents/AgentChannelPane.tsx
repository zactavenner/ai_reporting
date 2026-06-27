import { useEffect, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { MessageSquare, Send, Bot, User } from "lucide-react";
import {
  useAgentChannelForAgent,
  useAgentMessages,
  usePostAgentMessage,
} from "@/hooks/useAgentChannels";
import { EscalateButton } from "./EscalateButton";

interface Props {
  agentId: string;
  scope?: "agency" | "client";
  clientId?: string | null;
}

export function AgentChannelPane({ agentId, scope = "agency", clientId = null }: Props) {
  const { data: channel, isLoading: channelLoading } = useAgentChannelForAgent(agentId, scope, clientId);
  const { data: messages = [] } = useAgentMessages(channel?.id);
  const post = usePostAgentMessage();
  const [body, setBody] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length]);

  const submit = async () => {
    if (!channel || !body.trim()) return;
    await post.mutateAsync({ channel_id: channel.id, body: body.trim(), to_agent_id: agentId });
    setBody("");
  };

  const kindColors: Record<string, string> = {
    message: "bg-muted text-foreground",
    command: "bg-primary/10 text-primary",
    handoff: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
    escalation: "bg-destructive/10 text-destructive",
    "task-comment": "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    "tool-call": "bg-blue-500/10 text-blue-700 dark:text-blue-300",
    "model-call": "bg-purple-500/10 text-purple-700 dark:text-purple-300",
  };

  return (
    <Card className="border-muted">
      <CardContent className="p-0">
        <div className="px-4 py-2 border-b flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-primary" />
          <p className="text-sm font-semibold">{channel?.name || (channelLoading ? "Loading channel…" : "Channel unavailable")}</p>
          <Badge variant="secondary" className="text-[10px] ml-auto">audit trail</Badge>
          {channel && (
            <EscalateButton
              channelId={channel.id}
              channelName={channel.name}
              clientId={channel.client_id}
              agentId={agentId}
            />
          )}
        </div>
        <div ref={scrollRef} className="max-h-[420px] overflow-y-auto p-3 space-y-2">
          {messages.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-8">
              No activity yet. Agent runs and human notes will appear here.
            </p>
          )}
          {messages.map((m) => (
            <div key={m.id} className="flex items-start gap-2">
              <div className="h-6 w-6 rounded-full grid place-items-center bg-muted shrink-0">
                {m.role === "agent" ? <Bot className="h-3 w-3" /> : <User className="h-3 w-3" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                  <span className="font-medium">{m.role}</span>
                  <Badge variant="outline" className={`text-[9px] ${kindColors[m.kind] || ""}`}>{m.kind}</Badge>
                  <span>{new Date(m.created_at).toLocaleString()}</span>
                </div>
                {m.body && <p className="text-xs mt-0.5 whitespace-pre-wrap">{m.body}</p>}
                {m.task_id && (
                  <p className="text-[10px] text-muted-foreground mt-0.5">↳ task {m.task_id.slice(0, 8)}</p>
                )}
              </div>
            </div>
          ))}
        </div>
        <div className="border-t p-2 flex items-end gap-2">
          <Textarea
            rows={2}
            placeholder="Reply or send a command to this agent…"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
            }}
            className="text-xs"
          />
          <Button size="sm" onClick={submit} disabled={!body.trim() || post.isPending}>
            <Send className="h-3 w-3" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}