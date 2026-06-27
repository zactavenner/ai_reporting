import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Inbox, Bot, User, Search, RefreshCw, MessageSquare } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAgents } from "@/hooks/useAgents";
import type { Client } from "@/hooks/useClients";
import type { AgentChannel, AgentMessage } from "@/hooks/useAgentChannels";
import { usePostAgentMessage } from "@/hooks/useAgentChannels";
import { Textarea } from "@/components/ui/textarea";

interface Props { clients: Client[]; }

const KIND_COLORS: Record<string, string> = {
  message: "bg-muted text-foreground",
  command: "bg-primary/10 text-primary",
  handoff: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  escalation: "bg-destructive/10 text-destructive",
  "task-comment": "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  "tool-call": "bg-blue-500/10 text-blue-700 dark:text-blue-300",
  "model-call": "bg-purple-500/10 text-purple-700 dark:text-purple-300",
};

export function AllChannelsInbox({ clients }: Props) {
  const qc = useQueryClient();
  const { data: agents = [] } = useAgents();
  const post = usePostAgentMessage();

  const [scope, setScope] = useState<"all" | "agency" | "client">("all");
  const [clientFilter, setClientFilter] = useState<string>("all");
  const [agentFilter, setAgentFilter] = useState<string>("all");
  const [kindFilter, setKindFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [activeChannelId, setActiveChannelId] = useState<string | null>(null);
  const [reply, setReply] = useState("");

  const channelsQ = useQuery({
    queryKey: ["agent_channels", "all"],
    queryFn: async (): Promise<AgentChannel[]> => {
      const { data, error } = await (supabase as any)
        .from("agent_channels")
        .select("*")
        .order("name", { ascending: true });
      if (error) throw error;
      return (data || []) as AgentChannel[];
    },
  });

  // Latest 500 messages across all channels for the inbox stream
  const messagesQ = useQuery({
    queryKey: ["agent_messages", "inbox"],
    queryFn: async (): Promise<AgentMessage[]> => {
      const { data, error } = await (supabase as any)
        .from("agent_messages")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data || []) as AgentMessage[];
    },
  });

  // Live updates: invalidate on any agent_messages change
  useEffect(() => {
    const ch = supabase
      .channel("agent_messages:inbox")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "agent_messages" },
        () => qc.invalidateQueries({ queryKey: ["agent_messages", "inbox"] })
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [qc]);

  const channelById = useMemo(() => {
    const map = new Map<string, AgentChannel>();
    (channelsQ.data || []).forEach((c) => map.set(c.id, c));
    return map;
  }, [channelsQ.data]);

  const agentById = useMemo(() => {
    const map = new Map<string, any>();
    agents.forEach((a: any) => map.set(a.id, a));
    return map;
  }, [agents]);

  const clientById = useMemo(() => {
    const map = new Map<string, Client>();
    clients.forEach((c) => map.set(c.id, c));
    return map;
  }, [clients]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (messagesQ.data || []).filter((m) => {
      const ch = channelById.get(m.channel_id);
      if (!ch) return false;
      if (scope !== "all" && ch.scope !== scope) return false;
      if (clientFilter !== "all" && ch.client_id !== clientFilter) return false;
      if (agentFilter !== "all" && ch.agent_id !== agentFilter && m.from_agent_id !== agentFilter && m.to_agent_id !== agentFilter) return false;
      if (kindFilter !== "all" && m.kind !== kindFilter) return false;
      if (q && !(m.body || "").toLowerCase().includes(q)) return false;
      return true;
    });
  }, [messagesQ.data, channelById, scope, clientFilter, agentFilter, kindFilter, search]);

  // Channel counts (post-filter excluding the channel itself)
  const channelCounts = useMemo(() => {
    const counts = new Map<string, number>();
    filtered.forEach((m) => counts.set(m.channel_id, (counts.get(m.channel_id) || 0) + 1));
    return counts;
  }, [filtered]);

  const visibleChannels = useMemo(() => {
    return (channelsQ.data || []).filter((c) => {
      if (scope !== "all" && c.scope !== scope) return false;
      if (clientFilter !== "all" && c.client_id !== clientFilter) return false;
      if (agentFilter !== "all" && c.agent_id !== agentFilter) return false;
      return true;
    });
  }, [channelsQ.data, scope, clientFilter, agentFilter]);

  const activeChannel = activeChannelId ? channelById.get(activeChannelId) : null;
  const activeMessages = useMemo(() => {
    if (!activeChannelId) return [];
    return (messagesQ.data || [])
      .filter((m) => m.channel_id === activeChannelId)
      .slice()
      .sort((a, b) => +new Date(a.created_at) - +new Date(b.created_at));
  }, [messagesQ.data, activeChannelId]);

  const submitReply = async () => {
    if (!activeChannelId || !reply.trim()) return;
    await post.mutateAsync({
      channel_id: activeChannelId,
      body: reply.trim(),
      to_agent_id: activeChannel?.agent_id || null,
    });
    setReply("");
  };

  const labelForChannel = (ch: AgentChannel) => {
    const agent = ch.agent_id ? agentById.get(ch.agent_id) : null;
    const client = ch.client_id ? clientById.get(ch.client_id) : null;
    const base = ch.name || (agent ? `#${agent.name}` : "#channel");
    return client ? `${base} · ${client.name}` : base;
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle className="flex items-center gap-2 text-base">
            <Inbox className="h-4 w-4 text-primary" />
            All Channels Inbox
            <Badge variant="secondary" className="text-[10px]">{filtered.length} events</Badge>
          </CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              qc.invalidateQueries({ queryKey: ["agent_messages", "inbox"] });
              qc.invalidateQueries({ queryKey: ["agent_channels", "all"] });
            }}
          >
            <RefreshCw className="h-3 w-3 mr-1" /> Refresh
          </Button>
        </div>
        <div className="flex flex-wrap gap-2 mt-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="h-3 w-3 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search messages…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-7 h-8 text-xs"
            />
          </div>
          <Select value={scope} onValueChange={(v: any) => setScope(v)}>
            <SelectTrigger className="h-8 w-[130px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All scopes</SelectItem>
              <SelectItem value="agency">Agency</SelectItem>
              <SelectItem value="client">Client</SelectItem>
            </SelectContent>
          </Select>
          <Select value={clientFilter} onValueChange={setClientFilter}>
            <SelectTrigger className="h-8 w-[160px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All clients</SelectItem>
              {clients.map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={agentFilter} onValueChange={setAgentFilter}>
            <SelectTrigger className="h-8 w-[160px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All agents</SelectItem>
              {agents.map((a: any) => (
                <SelectItem key={a.id} value={a.id}>{a.icon} {a.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={kindFilter} onValueChange={setKindFilter}>
            <SelectTrigger className="h-8 w-[140px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All kinds</SelectItem>
              {["message","command","handoff","escalation","task-comment","tool-call","model-call"].map((k) => (
                <SelectItem key={k} value={k}>{k}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="grid grid-cols-12 border-t min-h-[480px]">
          {/* Channel list */}
          <div className="col-span-3 border-r">
            <ScrollArea className="h-[520px]">
              <div className="p-2 space-y-1">
                {visibleChannels.length === 0 && (
                  <p className="text-[11px] text-muted-foreground p-2">No channels match filters.</p>
                )}
                {visibleChannels.map((ch) => {
                  const count = channelCounts.get(ch.id) || 0;
                  return (
                    <button
                      key={ch.id}
                      onClick={() => setActiveChannelId(ch.id)}
                      className={`w-full text-left px-2 py-1.5 rounded text-xs flex items-center gap-2 hover:bg-muted ${activeChannelId === ch.id ? "bg-muted" : ""}`}
                    >
                      <MessageSquare className="h-3 w-3 shrink-0 text-muted-foreground" />
                      <span className="flex-1 truncate">{labelForChannel(ch)}</span>
                      {count > 0 && <Badge variant="secondary" className="text-[9px] h-4 px-1">{count}</Badge>}
                    </button>
                  );
                })}
              </div>
            </ScrollArea>
          </div>

          {/* Stream / thread */}
          <div className="col-span-9 flex flex-col">
            {activeChannel ? (
              <>
                <div className="px-4 py-2 border-b flex items-center gap-2">
                  <p className="text-sm font-semibold">{labelForChannel(activeChannel)}</p>
                  <Badge variant="outline" className="text-[10px]">{activeChannel.scope}</Badge>
                  <Badge variant="outline" className="text-[10px]">{activeChannel.kind}</Badge>
                  <Button variant="ghost" size="sm" className="ml-auto h-6 text-[11px]" onClick={() => setActiveChannelId(null)}>
                    Back to stream
                  </Button>
                </div>
                <ScrollArea className="flex-1 max-h-[420px]">
                  <div className="p-3 space-y-2">
                    {activeMessages.map((m) => (
                      <MessageRow key={m.id} m={m} agentById={agentById} clientById={clientById} channelById={channelById} showChannel={false} />
                    ))}
                    {activeMessages.length === 0 && (
                      <p className="text-xs text-muted-foreground text-center py-6">No messages in this channel yet.</p>
                    )}
                  </div>
                </ScrollArea>
                <div className="border-t p-2 flex items-end gap-2">
                  <Textarea
                    rows={2}
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                    placeholder="Reply into this channel…"
                    className="text-xs"
                    onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submitReply(); }}
                  />
                  <Button size="sm" disabled={!reply.trim() || post.isPending} onClick={submitReply}>Send</Button>
                </div>
              </>
            ) : (
              <ScrollArea className="h-[520px]">
                <div className="p-3 space-y-2">
                  {filtered.length === 0 && (
                    <p className="text-xs text-muted-foreground text-center py-12">
                      No activity matches the current filters.
                    </p>
                  )}
                  {filtered.map((m) => (
                    <MessageRow
                      key={m.id}
                      m={m}
                      agentById={agentById}
                      clientById={clientById}
                      channelById={channelById}
                      showChannel
                      onOpenChannel={(id) => setActiveChannelId(id)}
                    />
                  ))}
                </div>
              </ScrollArea>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function MessageRow({
  m,
  agentById,
  clientById,
  channelById,
  showChannel,
  onOpenChannel,
}: {
  m: AgentMessage;
  agentById: Map<string, any>;
  clientById: Map<string, Client>;
  channelById: Map<string, AgentChannel>;
  showChannel: boolean;
  onOpenChannel?: (id: string) => void;
}) {
  const ch = channelById.get(m.channel_id);
  const fromAgent = m.from_agent_id ? agentById.get(m.from_agent_id) : null;
  const toAgent = m.to_agent_id ? agentById.get(m.to_agent_id) : null;
  const client = ch?.client_id ? clientById.get(ch.client_id) : null;
  return (
    <div className="flex items-start gap-2 border-b pb-2 last:border-b-0">
      <div className="h-6 w-6 rounded-full grid place-items-center bg-muted shrink-0">
        {m.role === "agent" ? <Bot className="h-3 w-3" /> : <User className="h-3 w-3" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground flex-wrap">
          <Badge variant="outline" className={`text-[9px] ${KIND_COLORS[m.kind] || ""}`}>{m.kind}</Badge>
          <span className="font-medium">{fromAgent ? `${fromAgent.icon || "🤖"} ${fromAgent.name}` : m.role}</span>
          {toAgent && <span>→ {toAgent.icon} {toAgent.name}</span>}
          {showChannel && ch && (
            <button className="underline hover:text-foreground" onClick={() => onOpenChannel?.(ch.id)}>
              {ch.name}{client ? ` · ${client.name}` : ""}
            </button>
          )}
          <span className="ml-auto">{new Date(m.created_at).toLocaleString()}</span>
        </div>
        {m.body && <p className="text-xs mt-0.5 whitespace-pre-wrap">{m.body}</p>}
        {m.task_id && (
          <p className="text-[10px] text-muted-foreground mt-0.5">↳ task {m.task_id.slice(0, 8)}</p>
        )}
      </div>
    </div>
  );
}