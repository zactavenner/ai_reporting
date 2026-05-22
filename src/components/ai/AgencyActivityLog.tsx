import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow, format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  MessageSquare,
  Image as ImageIcon,
  Library,
  Bot,
  AlertTriangle,
  CheckCircle2,
  Clock,
  RefreshCw,
  Filter,
} from "lucide-react";
import { cn } from "@/lib/utils";

type EntryKind = "chat" | "output" | "reference" | "agent";

interface Entry {
  id: string;
  kind: EntryKind;
  at: string;
  title: string;
  detail?: string;
  meta?: string;
  status?: "ok" | "error" | "running";
  thumb?: string;
}

const KIND_META: Record<EntryKind, { label: string; icon: any; color: string }> = {
  chat: { label: "Step", icon: MessageSquare, color: "text-blue-500 bg-blue-500/10" },
  output: { label: "Output", icon: ImageIcon, color: "text-emerald-600 bg-emerald-500/10" },
  reference: { label: "Reference", icon: Library, color: "text-purple-500 bg-purple-500/10" },
  agent: { label: "Agent", icon: Bot, color: "text-amber-600 bg-amber-500/10" },
};

export function AgencyActivityLog({ clientId }: { clientId: string }) {
  const [filters, setFilters] = useState<Set<EntryKind>>(
    new Set(["chat", "output", "reference", "agent"])
  );

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["agency-ai-activity", clientId],
    queryFn: async () => {
      // 1. Conversations for this client (to scope messages & canvas items)
      const { data: convos } = await supabase
        .from("ai_studio_conversations")
        .select("id, user_id, last_active_at, active_reference_ids")
        .eq("client_id", clientId);
      const convoIds = (convos || []).map((c: any) => c.id);

      const [messagesRes, canvasRes, refsRes, runsRes] = await Promise.all([
        convoIds.length
          ? supabase
              .from("ai_studio_messages")
              .select("id, role, content, created_at, tools, conversation_id")
              .in("conversation_id", convoIds)
              .order("created_at", { ascending: false })
              .limit(200)
          : Promise.resolve({ data: [] as any[] }),
        convoIds.length
          ? supabase
              .from("ai_studio_canvas_items")
              .select("id, kind, payload, created_at, feedback_status, conversation_id")
              .in("conversation_id", convoIds)
              .order("created_at", { ascending: false })
              .limit(200)
          : Promise.resolve({ data: [] as any[] }),
        supabase
          .from("ai_studio_reference_images" as any)
          .select("id, name, image_url, source, tags, created_at")
          .eq("client_id", clientId)
          .order("created_at", { ascending: false })
          .limit(100),
        supabase
          .from("agent_runs")
          .select("id, status, started_at, completed_at, input_summary, output_summary, error, tokens_used, cost_usd, agent_id")
          .eq("client_id", clientId)
          .order("started_at", { ascending: false })
          .limit(100),
      ]);

      const entries: Entry[] = [];

      for (const m of (messagesRes.data || []) as any[]) {
        const tools = Array.isArray(m.tools) ? m.tools : [];
        const toolNames = tools.map((t: any) => t?.name || t?.tool || "tool").filter(Boolean);
        entries.push({
          id: `msg-${m.id}`,
          kind: "chat",
          at: m.created_at,
          title: m.role === "user" ? "User prompt" : m.role === "assistant" ? "Assistant step" : m.role,
          detail: (m.content || "").slice(0, 240),
          meta: toolNames.length ? `tools: ${toolNames.join(", ")}` : undefined,
        });
      }

      for (const c of (canvasRes.data || []) as any[]) {
        const p = c.payload || {};
        const url = p.url || p.image_url || p.thumb || p.poster;
        entries.push({
          id: `canvas-${c.id}`,
          kind: "output",
          at: c.created_at,
          title: `Generated ${c.kind}`,
          detail: p.prompt || p.title || p.caption || undefined,
          meta: c.feedback_status ? `review: ${c.feedback_status}` : undefined,
          thumb: typeof url === "string" ? url : undefined,
          status: c.feedback_status === "rejected" ? "error" : c.feedback_status === "approved" ? "ok" : undefined,
        });
      }

      for (const r of (refsRes.data || []) as any[]) {
        entries.push({
          id: `ref-${r.id}`,
          kind: "reference",
          at: r.created_at,
          title: r.name || "Reference image",
          detail: Array.isArray(r.tags) && r.tags.length ? r.tags.join(" · ") : undefined,
          meta: `source: ${r.source || "upload"}`,
          thumb: r.image_url,
        });
      }

      for (const r of (runsRes.data || []) as any[]) {
        const status =
          r.status === "completed" || r.status === "success" ? "ok" :
          r.status === "failed" || r.status === "error" ? "error" :
          "running";
        const tokens = r.tokens_used ? `${r.tokens_used} tok` : "";
        const cost = r.cost_usd ? `$${Number(r.cost_usd).toFixed(4)}` : "";
        entries.push({
          id: `run-${r.id}`,
          kind: "agent",
          at: r.started_at || r.completed_at,
          title: r.input_summary?.slice(0, 80) || `Agent run · ${r.status}`,
          detail: r.output_summary || r.error || undefined,
          meta: [tokens, cost].filter(Boolean).join(" · ") || undefined,
          status,
        });
      }

      return entries
        .filter((e) => !!e.at)
        .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
    },
    enabled: !!clientId,
    staleTime: 30_000,
  });

  const visible = useMemo(
    () => (data || []).filter((e) => filters.has(e.kind)),
    [data, filters]
  );

  const counts = useMemo(() => {
    const c: Record<EntryKind, number> = { chat: 0, output: 0, reference: 0, agent: 0 };
    (data || []).forEach((e) => { c[e.kind]++; });
    return c;
  }, [data]);

  const toggle = (k: EntryKind) => {
    const next = new Set(filters);
    next.has(k) ? next.delete(k) : next.add(k);
    if (next.size === 0) return;
    setFilters(next);
  };

  return (
    <div className="flex flex-col h-full gap-3">
      <Card className="p-3 flex flex-wrap items-center gap-2">
        <Filter className="h-4 w-4 text-muted-foreground" />
        {(Object.keys(KIND_META) as EntryKind[]).map((k) => {
          const M = KIND_META[k];
          const Icon = M.icon;
          const active = filters.has(k);
          return (
            <button
              key={k}
              onClick={() => toggle(k)}
              className={cn(
                "inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition",
                active ? M.color : "text-muted-foreground bg-muted/40 hover:bg-muted"
              )}
            >
              <Icon className="h-3 w-3" /> {M.label}
              <span className="opacity-70">{counts[k]}</span>
            </button>
          );
        })}
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{visible.length} entries</span>
          <Button size="sm" variant="ghost" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={cn("h-3 w-3", isFetching && "animate-spin")} />
          </Button>
        </div>
      </Card>

      <Card className="flex-1 min-h-0 overflow-hidden rounded-2xl">
        <ScrollArea className="h-full">
          {isLoading ? (
            <div className="p-4 space-y-3">
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)}
            </div>
          ) : visible.length === 0 ? (
            <div className="h-64 grid place-items-center text-sm text-muted-foreground">
              No activity yet for this client.
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {visible.map((e) => {
                const M = KIND_META[e.kind];
                const Icon = M.icon;
                const StatusIcon =
                  e.status === "ok" ? CheckCircle2 :
                  e.status === "error" ? AlertTriangle :
                  e.status === "running" ? Clock : null;
                return (
                  <li key={e.id} className="p-3 flex gap-3 hover:bg-muted/30 transition-colors">
                    <div className={cn("h-8 w-8 rounded-lg grid place-items-center shrink-0", M.color)}>
                      <Icon className="h-4 w-4" />
                    </div>
                    {e.thumb && (
                      <img
                        src={e.thumb}
                        alt=""
                        className="h-12 w-12 rounded-lg object-cover border border-border shrink-0"
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium truncate">{e.title}</span>
                        <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
                          {M.label}
                        </Badge>
                        {StatusIcon && (
                          <StatusIcon className={cn(
                            "h-3.5 w-3.5",
                            e.status === "ok" && "text-emerald-600",
                            e.status === "error" && "text-destructive",
                            e.status === "running" && "text-amber-600"
                          )} />
                        )}
                      </div>
                      {e.detail && (
                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{e.detail}</p>
                      )}
                      <div className="text-[11px] text-muted-foreground mt-1 flex gap-2">
                        <span title={format(new Date(e.at), "PPpp")}>
                          {formatDistanceToNow(new Date(e.at), { addSuffix: true })}
                        </span>
                        {e.meta && <span>· {e.meta}</span>}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </ScrollArea>
      </Card>
    </div>
  );
}

export default AgencyActivityLog;