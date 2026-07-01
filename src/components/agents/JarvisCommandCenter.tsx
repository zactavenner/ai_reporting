import { useEffect, useMemo, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Sparkles, Send, Plus, MessageSquare, Trash2, Bot, Zap, ChevronRight, ChevronLeft, Mic, Brain } from "lucide-react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { JarvisVoiceMode } from "./JarvisVoiceMode";
import { useTeamMember } from "@/contexts/TeamMemberContext";

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

function useConversations(memberId: string | undefined) {
  return useQuery({
    queryKey: ["jarvis_conversations", memberId],
    enabled: !!memberId,
    queryFn: async (): Promise<Conversation[]> => {
      const { data, error } = await (supabase as any)
        .from("jarvis_conversations")
        .select("id, title, updated_at")
        .eq("user_id", memberId)
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
  const { currentMember } = useTeamMember();
  const { data: convs = [] } = useConversations(currentMember?.id);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [showInterAgent, setShowInterAgent] = useState(true);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [streamingReply, setStreamingReply] = useState("");
  const [thoughts, setThoughts] = useState<Array<{ stage: string; text: string; ts: number }>>([]);
  const [liveInter, setLiveInter] = useState<Array<{ speaker: string; content: string }>>([]);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!activeId && convs[0]) setActiveId(convs[0].id);
  }, [convs, activeId]);

  const { data: msgs = [] } = useMessages(activeId);

  const main = useMemo(() => msgs.filter((m) => m.channel === "main"), [msgs]);
  const inter = useMemo(() => msgs.filter((m) => m.channel === "inter_agent"), [msgs]);

  const streamSend = async (text: string) => {
    setPending(true);
    setStreamingReply("");
    setThoughts([]);
    setLiveInter([]);
    // Optimistic user message
    const optimisticId = `tmp-${Date.now()}`;
    if (activeId) {
      qc.setQueryData<Msg[]>(["jarvis_messages", activeId], (old = []) => [
        ...old,
        { id: optimisticId, channel: "main", speaker: "user", role: "user", content: text, created_at: new Date().toISOString() },
      ]);
    }
    try {
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/jarvis-chat`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string,
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({
          conversation_id: activeId,
          message: text,
          team_member_id: currentMember?.id || "anonymous",
          stream: true,
        }),
      });
      if (!res.ok || !res.body) throw new Error((await res.text().catch(() => "")) || `HTTP ${res.status}`);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      let convIdLocal = activeId;
      let acc = "";
      const process = (event: string, data: any) => {
        if (event === "meta") { convIdLocal = data.conversation_id; setActiveId(data.conversation_id); }
        else if (event === "thought") { setThoughts((t) => [...t, { stage: data.stage, text: data.text, ts: Date.now() }]); }
        else if (event === "delta") { acc += data.text; setStreamingReply(acc); }
        else if (event === "reset_main") { acc = ""; setStreamingReply(""); }
        else if (event === "inter_agent") { setLiveInter((x) => [...x, { speaker: data.speaker, content: data.content }]); }
        else if (event === "tool_call") {
          setThoughts((t) => [...t, { stage: "tool_call", text: `→ ${data.name}(${JSON.stringify(data.args).slice(0, 120)})`, ts: Date.now() }]);
        }
        else if (event === "tool_result") {
          setThoughts((t) => [...t, { stage: "tool_result", text: `← ${data.name}: ${data.preview}`, ts: Date.now() }]);
        }
        else if (event === "hermes_delta") {
          setLiveInter((x) => {
            const last = x[x.length - 1];
            if (last?.speaker === "hermes_stream") return [...x.slice(0, -1), { ...last, content: last.content + data.text }];
            return [...x, { speaker: "hermes_stream", content: data.text }];
          });
        }
        else if (event === "done") {
          qc.invalidateQueries({ queryKey: ["jarvis_conversations"] });
          if (convIdLocal) qc.invalidateQueries({ queryKey: ["jarvis_messages", convIdLocal] });
          setStreamingReply("");
          setLiveInter([]);
        }
        else if (event === "error") { toast.error(data.error || "Jarvis failed"); }
      };
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop() || "";
        for (const p of parts) {
          const evLine = p.split("\n").find((l) => l.startsWith("event:"));
          const dtLine = p.split("\n").find((l) => l.startsWith("data:"));
          if (!evLine || !dtLine) continue;
          try { process(evLine.slice(6).trim(), JSON.parse(dtLine.slice(5).trim())); } catch { /* noop */ }
        }
      }
    } catch (e: any) {
      toast.error(e?.message || "Jarvis failed");
    } finally {
      setPending(false);
      setTimeout(() => taRef.current?.focus(), 30);
    }
  };

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
    void streamSend(t);
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
          <Button
            size="sm"
            onClick={() => setVoiceOpen(true)}
            className="h-7 gap-1.5 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white shadow-[0_0_18px_rgba(34,211,238,0.45)]"
          >
            <Mic className="h-3.5 w-3.5" /> Voice mode
          </Button>
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
                {pending && streamingReply && (
                  <div className="flex gap-3">
                    <div className="h-7 w-7 rounded-full bg-gradient-to-br from-primary to-primary/60 text-primary-foreground flex items-center justify-center text-[11px] font-semibold">J</div>
                    <div className="rounded-2xl px-3.5 py-2 text-sm bg-muted whitespace-pre-wrap break-words max-w-[80%]">
                      {streamingReply}
                      <span className="inline-block w-1.5 h-3 bg-foreground/60 align-middle ml-0.5 animate-pulse" />
                    </div>
                  </div>
                )}
                {pending && !streamingReply && (
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
              <Brain className="h-3.5 w-3.5 text-amber-500" />
              <p className="text-xs font-semibold">Thought Process</p>
              <Badge variant="outline" className="ml-auto text-[9px]">{thoughts.length + inter.length + liveInter.length}</Badge>
            </div>
            <ScrollArea className="flex-1 p-3">
              {inter.length === 0 && thoughts.length === 0 && liveInter.length === 0 ? (
                <p className="text-[11px] text-muted-foreground">
                  Jarvis's live reasoning, model routing, and Hermes consultations will stream here in real time as he works.
                </p>
              ) : (
                <div className="space-y-2.5">
                  {thoughts.map((t, i) => (
                    <div key={`th-${i}`} className="rounded-lg p-2 text-[11px] border border-cyan-500/30 bg-cyan-500/5">
                      <div className="text-[9px] font-bold uppercase tracking-wider mb-1 text-cyan-600 flex items-center gap-1">
                        <Brain className="h-2.5 w-2.5" /> {t.stage}
                      </div>
                      {t.text}
                    </div>
                  ))}
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
                  {liveInter.map((m, i) => (
                    <div key={`li-${i}`} className={cn(
                      "rounded-lg p-2.5 text-[11px] leading-relaxed border whitespace-pre-wrap break-words",
                      m.speaker === "jarvis" ? "bg-primary/5 border-primary/20" : "bg-amber-500/5 border-amber-500/20",
                    )}>
                      <div className={cn(
                        "text-[9px] font-bold uppercase tracking-wider mb-1",
                        m.speaker === "jarvis" ? "text-primary" : "text-amber-600",
                      )}>{m.speaker.replace("_stream", " (streaming)")}</div>
                      {m.content}
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </aside>
        )}
      </div>
      <JarvisVoiceMode
        open={voiceOpen}
        onClose={() => setVoiceOpen(false)}
        conversationId={activeId}
        onConversationCreated={(id) => {
          setActiveId(id);
          qc.invalidateQueries({ queryKey: ["jarvis_conversations"] });
          qc.invalidateQueries({ queryKey: ["jarvis_messages", id] });
        }}
      />
    </Card>
  );
}