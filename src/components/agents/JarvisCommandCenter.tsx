import { useEffect, useMemo, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Sparkles, Send, Plus, MessageSquare, Trash2, Bot, Zap, ChevronRight, ChevronLeft } from "lucide-react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type Conversation = { id: string; title: string; updated_at: string };
type Msg = {
  id: string;
  channel: "main" | "inter_agent";
  speaker: "user" | "jarvis" | "hermes" | "system";
  role: string;
  content: string;
  created_at: string;
  metadata?: any;
};

function useConversations() {
  return useQuery({
    queryKey: ["jarvis_conversations"],
    queryFn: async (): Promise<Conversation[]> => {
      const { data, error } = await (supabase as any)
        .from("jarvis_conversations")
        .select("id, title, updated_at")
        .order("updated_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data || [];
    },
  });
}

function useMessages(convId: string | null) {
  return useQuery({
    queryKey: ["jarvis_messages", convId],
    enabled: !!convId,
    queryFn: async (): Promise<Msg[]> => {
      const { data, error } = await (supabase as any)
        .from("jarvis_messages")
        .select("id, channel, speaker, role, content, created_at, metadata")
        .eq("conversation_id", convId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data || [];
    },
  });
}

export function JarvisCommandCenter() {
  const qc = useQueryClient();
  const { data: convs = [] } = useConversations();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [showInterAgent, setShowInterAgent] = useState(true);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!activeId && convs[0]) setActiveId(convs[0].id);
  }, [convs, activeId]);

  const { data: msgs = [] } = useMessages(activeId);

  const main = useMemo(() => msgs.filter((m) => m.channel === "main"), [msgs]);
  const inter = useMemo(() => msgs.filter((m) => m.channel === "inter_agent"), [msgs]);

  const send = useMutation({
    mutationFn: async (text: string) => {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess?.session?.access_token;
      if (!token) throw new Error("Not signed in");
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/jarvis-chat`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string,
        },
        body: JSON.stringify({ conversation_id: activeId, message: text }),
      });
      if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
      return res.json() as Promise<{ conversation_id: string }>;
    },
    onMutate: () => setPending(true),
    onSettled: () => setPending(false),
    onSuccess: (r) => {
      setActiveId(r.conversation_id);
      qc.invalidateQueries({ queryKey: ["jarvis_conversations"] });
      qc.invalidateQueries({ queryKey: ["jarvis_messages", r.conversation_id] });
      setTimeout(() => taRef.current?.focus(), 50);
    },
    onError: (e: any) => toast.error(e?.message || "Jarvis failed"),
  });

  const newConv = () => {
    setActiveId(null);
    setInput("");
    setTimeout(() => taRef.current?.focus(), 30);
  };

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from("jarvis_conversations").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_d, id) => {
      if (activeId === id) setActiveId(null);
      qc.invalidateQueries({ queryKey: ["jarvis_conversations"] });
      toast.success("Conversation deleted");
    },
  });

  const submit = () => {
    const t = input.trim();
    if (!t || pending) return;
    setInput("");
    send.mutate(t);
  };

  // Realtime updates while Jarvis is working
  useEffect(() => {
    if (!activeId) return;
    const ch = supabase
      .channel(`jarvis:${activeId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "jarvis_messages", filter: `conversation_id=eq.${activeId}` }, () => {
        qc.invalidateQueries({ queryKey: ["jarvis_messages", activeId] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [activeId, qc]);

  return (
    <Card className="overflow-hidden border-primary/20 bg-gradient-to-br from-primary/5 via-background to-background">
      <div className="flex items-center justify-between px-5 py-3 border-b bg-background/60 backdrop-blur">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-full bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center">
            <Sparkles className="h-4 w-4 text-primary-foreground" />
          </div>
          <div>
            <h2 className="text-base font-bold tracking-tight">Jarvis · Command Center</h2>
            <p className="text-[11px] text-muted-foreground">Talk to your COO. He coordinates with Hermes and the full agent workforce.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-[10px]"><Bot className="h-3 w-3 mr-1" />Nemotron 3 Ultra</Badge>
          <Button size="sm" variant="ghost" onClick={() => setShowInterAgent((s) => !s)}>
            {showInterAgent ? <><ChevronRight className="h-3.5 w-3.5 mr-1" />Hide Hermes feed</> : <><ChevronLeft className="h-3.5 w-3.5 mr-1" />Show Hermes feed</>}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-12 min-h-[520px]">
        {/* Threads */}
        <aside className="col-span-12 md:col-span-2 border-r bg-muted/20 flex flex-col">
          <div className="p-2">
            <Button size="sm" variant="outline" className="w-full justify-start" onClick={newConv}>
              <Plus className="h-3.5 w-3.5 mr-1" />New chat
            </Button>
          </div>
          <ScrollArea className="flex-1 px-2 pb-2">
            <div className="space-y-1">
              {convs.length === 0 ? (
                <p className="text-[11px] text-muted-foreground px-2 py-3">No conversations yet.</p>
              ) : convs.map((c) => (
                <div key={c.id} className={cn(
                  "group flex items-center gap-1 rounded-md px-2 py-1.5 text-xs cursor-pointer hover:bg-accent",
                  activeId === c.id && "bg-accent",
                )} onClick={() => setActiveId(c.id)}>
                  <MessageSquare className="h-3 w-3 shrink-0 text-muted-foreground" />
                  <span className="truncate flex-1">{c.title}</span>
                  <button
                    className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive"
                    onClick={(e) => { e.stopPropagation(); del.mutate(c.id); }}
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          </ScrollArea>
        </aside>

        {/* Main chat */}
        <section className={cn("col-span-12 flex flex-col", showInterAgent ? "md:col-span-7" : "md:col-span-10")}>
          <ScrollArea className="flex-1 px-4 py-3">
            {main.length === 0 && !pending ? (
              <div className="h-full flex flex-col items-center justify-center text-center py-12">
                <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center mb-3">
                  <Sparkles className="h-6 w-6 text-primary" />
                </div>
                <p className="text-sm font-medium">Good to see you.</p>
                <p className="text-xs text-muted-foreground max-w-sm mt-1">
                  Ask me anything — campaign status, client briefings, dispatch a job to Hermes, or coordinate the specialist agents.
                </p>
              </div>
            ) : (
              <div className="space-y-4 max-w-3xl mx-auto">
                {main.map((m) => (
                  <div key={m.id} className={cn("flex gap-3", m.speaker === "user" && "flex-row-reverse")}>
                    <div className={cn(
                      "h-7 w-7 rounded-full flex items-center justify-center text-[11px] font-semibold shrink-0",
                      m.speaker === "user" ? "bg-muted" : "bg-gradient-to-br from-primary to-primary/60 text-primary-foreground",
                    )}>{m.speaker === "user" ? "U" : "J"}</div>
                    <div className={cn(
                      "rounded-2xl px-3.5 py-2 text-sm leading-relaxed max-w-[80%] whitespace-pre-wrap break-words",
                      m.speaker === "user" ? "bg-primary text-primary-foreground" : "bg-muted",
                    )}>
                      {m.content}
                      {m.metadata?.consulted_hermes && (
                        <div className="mt-1.5 flex items-center gap-1 text-[10px] opacity-70">
                          <Zap className="h-2.5 w-2.5" /> Consulted Hermes
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                {pending && (
                  <div className="flex gap-3">
                    <div className="h-7 w-7 rounded-full bg-gradient-to-br from-primary to-primary/60 text-primary-foreground flex items-center justify-center text-[11px] font-semibold">J</div>
                    <div className="rounded-2xl px-3.5 py-2 text-sm bg-muted">
                      <span className="inline-flex gap-1">
                        <span className="h-1.5 w-1.5 bg-foreground/50 rounded-full animate-bounce" />
                        <span className="h-1.5 w-1.5 bg-foreground/50 rounded-full animate-bounce [animation-delay:0.15s]" />
                        <span className="h-1.5 w-1.5 bg-foreground/50 rounded-full animate-bounce [animation-delay:0.3s]" />
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )}
          </ScrollArea>
          <div className="border-t p-3 bg-background/60">
            <div className="max-w-3xl mx-auto flex items-end gap-2">
              <Textarea
                ref={taRef}
                autoFocus
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
                }}
                placeholder="Message Jarvis…  (Shift+Enter for newline)"
                rows={1}
                className="min-h-[44px] max-h-40 resize-none"
                disabled={pending}
              />
              <TooltipProvider><Tooltip>
                <TooltipTrigger asChild>
                  <Button onClick={submit} disabled={pending || !input.trim()} size="icon">
                    <Send className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Send (Enter)</TooltipContent>
              </Tooltip></TooltipProvider>
            </div>
          </div>
        </section>

        {/* Hermes inter-agent feed */}
        {showInterAgent && (
          <aside className="col-span-12 md:col-span-3 border-l bg-muted/10 flex flex-col">
            <div className="px-3 py-2 border-b flex items-center gap-2">
              <Zap className="h-3.5 w-3.5 text-amber-500" />
              <p className="text-xs font-semibold">Jarvis ↔ Hermes</p>
              <Badge variant="outline" className="ml-auto text-[9px]">{inter.length}</Badge>
            </div>
            <ScrollArea className="flex-1 p-3">
              {inter.length === 0 ? (
                <p className="text-[11px] text-muted-foreground">
                  No agent-to-agent traffic yet. Ask Jarvis to dispatch work, check Hermes status, or coordinate across clients — you'll see the exchange here in real time.
                </p>
              ) : (
                <div className="space-y-2.5">
                  {inter.map((m) => (
                    <div key={m.id} className={cn(
                      "rounded-lg p-2.5 text-[11px] leading-relaxed border whitespace-pre-wrap break-words",
                      m.speaker === "jarvis"
                        ? "bg-primary/5 border-primary/20"
                        : "bg-amber-500/5 border-amber-500/20",
                    )}>
                      <div className={cn(
                        "text-[9px] font-bold uppercase tracking-wider mb-1",
                        m.speaker === "jarvis" ? "text-primary" : "text-amber-600",
                      )}>{m.speaker}</div>
                      {m.content}
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </aside>
        )}
      </div>
    </Card>
  );
}