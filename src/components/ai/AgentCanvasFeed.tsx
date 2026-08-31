import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, RefreshCw, ExternalLink } from "lucide-react";
import { STUDIO_AGENT_RAIL, agentIconForKey, agentLabelForKey, normalizeAgentKey } from "./aiStudioAgents";

type FeedItem = {
  id: string;
  conversation_id: string;
  kind: string;
  payload: any;
  created_at: string;
  thread_title: string | null;
  agent_key: string | null;
};

/**
 * Master roll-up: every canvas item produced by every agent thread for this client,
 * newest first, with the originating agent + thread. Clicking an item opens that thread.
 */
export function AgentCanvasFeed({
  studioFetch,
  clientId,
  onOpenThread,
}: {
  studioFetch: (body: Record<string, any>, signal?: AbortSignal) => Promise<Response>;
  clientId: string;
  onOpenThread: (conversationId: string, agentKey: string) => void;
}) {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [agentFilter, setAgentFilter] = useState<string>("all");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await studioFetch({ action: "list_client_canvas", clientId });
      if (!res.ok) return;
      const { items = [] } = await res.json();
      setItems(items as FeedItem[]);
    } catch (e) {
      console.error("list_client_canvas failed", e);
    } finally {
      setLoading(false);
    }
  }, [studioFetch, clientId]);

  useEffect(() => { load(); }, [load]);

  const visible = agentFilter === "all"
    ? items
    : items.filter(i => normalizeAgentKey(i.agent_key) === agentFilter);

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center gap-1.5 flex-wrap px-1 pb-2">
        <button
          type="button"
          onClick={() => setAgentFilter("all")}
          className={`h-7 px-2.5 rounded-full text-[10px] border transition ${agentFilter === "all" ? "bg-primary text-primary-foreground border-primary" : "bg-muted/40 hover:bg-muted border-border/60 text-muted-foreground"}`}
        >
          All agents
        </button>
        {STUDIO_AGENT_RAIL.map(a => (
          <button
            key={a.key}
            type="button"
            onClick={() => setAgentFilter(a.key)}
            className={`h-7 px-2.5 rounded-full text-[10px] border transition inline-flex items-center gap-1 ${agentFilter === a.key ? "bg-primary text-primary-foreground border-primary" : "bg-muted/40 hover:bg-muted border-border/60 text-muted-foreground"}`}
          >
            <span>{a.icon}</span> {a.label}
          </button>
        ))}
        <Button variant="ghost" size="sm" className="h-7 px-2 ml-auto text-[10px]" onClick={load} disabled={loading}>
          {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
        </Button>
      </div>

      <ScrollArea className="flex-1 min-h-0">
        {loading && items.length === 0 ? (
          <div className="flex items-center gap-2 justify-center py-10 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading cross-agent feed…
          </div>
        ) : visible.length === 0 ? (
          <div className="py-10 text-center text-xs text-muted-foreground">Nothing produced yet for this filter.</div>
        ) : (
          <div className="grid grid-cols-2 xl:grid-cols-3 gap-2.5 p-1">
            {visible.map(item => {
              const p = item.payload || {};
              const img: string | undefined = p.image_url || p.thumbnail_url || p.first_frame_url;
              const vid: string | undefined = p.video_url;
              return (
                <Card key={item.id} className="overflow-hidden p-0 border-border/60">
                  <div className="relative bg-muted/40 aspect-square flex items-center justify-center overflow-hidden">
                    {vid ? (
                      <video src={vid} controls playsInline className="w-full h-full object-cover" />
                    ) : img ? (
                      <img src={img} alt={item.thread_title || "Canvas item"} loading="lazy" className="w-full h-full object-cover" />
                    ) : (
                      <div className="p-3 text-[10px] text-muted-foreground line-clamp-6">
                        {typeof p.text === "string" ? p.text : (p.prompt || item.kind)}
                      </div>
                    )}
                    <Badge variant="secondary" className="absolute top-1.5 left-1.5 text-[9px] gap-1">
                      <span>{agentIconForKey(item.agent_key)}</span>{agentLabelForKey(item.agent_key)}
                    </Badge>
                  </div>
                  <div className="p-2 space-y-1">
                    <div className="text-[10px] truncate text-muted-foreground">{item.thread_title || "Untitled thread"}</div>
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-[9px] text-muted-foreground/70">
                        {new Date(item.created_at).toLocaleString()}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-1.5 text-[9px] gap-1"
                        onClick={() => onOpenThread(item.conversation_id, normalizeAgentKey(item.agent_key))}
                      >
                        Open <ExternalLink className="h-2.5 w-2.5" />
                      </Button>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
