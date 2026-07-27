import { useState, useRef, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Beaker, Send, Loader2, Bot, User as UserIcon, RotateCcw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";

type Msg = { role: "user" | "assistant"; content: string };

export function AgentTestChat({
  agentId,
  agentName,
  clientId = null,
  clientName,
}: {
  agentId: string;
  agentName: string;
  clientId?: string | null;
  clientName?: string;
}) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [contextSummary, setContextSummary] = useState<any>(null);
  const [modelUsed, setModelUsed] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Reset when agent or client changes
  useEffect(() => {
    setMessages([]);
    setContextSummary(null);
    setModelUsed(null);
  }, [agentId, clientId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, loading]);

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;
    const next: Msg[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setInput("");
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("test-agent", {
        body: { agent_id: agentId, client_id: clientId, messages: next },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      const reply = (data as any).reply as string;
      setContextSummary((data as any).context_summary || null);
      setModelUsed((data as any).model_used || null);
      setMessages([...next, { role: "assistant", content: reply }]);
    } catch (e: any) {
      toast.error(`Test failed: ${e?.message || e}`);
      setMessages(next); // keep user msg
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="p-4 space-y-3 border-primary/40">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Beaker className="h-4 w-4 text-primary" />
          <p className="text-sm font-semibold">Test {agentName}</p>
          <Badge variant="secondary" className="text-[10px]">
            {clientId ? `${clientName || "Client"} scope` : "Master scope"}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          {modelUsed && <span className="text-[10px] text-muted-foreground">{modelUsed}</span>}
          {messages.length > 0 && (
            <Button size="sm" variant="ghost" onClick={() => setMessages([])}>
              <RotateCcw className="h-3 w-3 mr-1" /> Reset
            </Button>
          )}
        </div>
      </div>

      {contextSummary && (
        <div className="flex flex-wrap gap-1 text-[10px]">
          <Badge variant={contextSummary.has_memory ? "default" : "outline"}>memory {contextSummary.has_memory ? "✓" : "—"}</Badge>
          <Badge variant={contextSummary.has_instructions ? "default" : "outline"}>instructions {contextSummary.has_instructions ? "✓" : "—"}</Badge>
          {clientId && (
            <>
              <Badge variant={contextSummary.client_override ? "default" : "outline"}>client override {contextSummary.client_override ? "✓" : "—"}</Badge>
              <Badge variant={contextSummary.client_brain ? "default" : "outline"}>client brain {contextSummary.client_brain ? "✓" : "—"}</Badge>
            </>
          )}
          <Badge variant={contextSummary.files_count ? "default" : "outline"}>{contextSummary.files_count} file{contextSummary.files_count === 1 ? "" : "s"}</Badge>
        </div>
      )}

      <div ref={scrollRef} className="max-h-[360px] min-h-[120px] overflow-y-auto space-y-2 rounded-md bg-muted/30 p-3">
        {messages.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-6">
            Send a test prompt to see how this agent responds using its memory, instructions, and files.
          </p>
        )}
        {messages.map((m, i) => (
          <div key={i} className="flex items-start gap-2">
            <div className="h-6 w-6 rounded-full grid place-items-center bg-background shrink-0 border">
              {m.role === "assistant" ? <Bot className="h-3 w-3" /> : <UserIcon className="h-3 w-3" />}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">
                {m.role === "assistant" ? agentName : "You"}
              </p>
              {m.role === "assistant" ? (
                <div className="prose prose-sm dark:prose-invert max-w-none text-xs [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1">
                  <ReactMarkdown>{m.content}</ReactMarkdown>
                </div>
              ) : (
                <p className="text-xs whitespace-pre-wrap">{m.content}</p>
              )}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" /> {agentName} is thinking…
          </div>
        )}
      </div>

      <div className="flex items-end gap-2">
        <Textarea
          rows={2}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={`Ask ${agentName} anything — this uses the exact memory, instructions & files above.`}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send();
          }}
          className="text-xs"
        />
        <Button size="sm" onClick={send} disabled={!input.trim() || loading}>
          {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
        </Button>
      </div>
    </Card>
  );
}