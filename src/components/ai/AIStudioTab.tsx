import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Sparkles, FileText, Table as TableIcon, Image as ImageIcon, Send, Loader2, ExternalLink, Wand2, Square, Trash2, Film, Settings2, ChevronDown, Library, BookOpenCheck, ShieldAlert, DollarSign } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { useAgencySettings } from "@/hooks/useAgencySettings";
import { useClientSettings, useUpdateClientSettings } from "@/hooks/useClientSettings";
import { toast } from "sonner";
import { AIStudioCanvas, type CanvasEntry, type CanvasItem, type CanvasPlaceholder } from "./AIStudioCanvas";
import { AIStudioReferenceLibrary } from "./AIStudioReferenceLibrary";
import ReactMarkdown from "react-markdown";

interface Props {
  clientId: string;
  clientName: string;
}

type Msg = { id?: string; role: "user" | "assistant"; content: string; tools?: any[] };

const CHAT_MODELS = [
  { value: "google/gemini-2.5-pro", label: "Gemini 2.5 Pro (reasoning)" },
  { value: "google/gemini-3-flash-preview", label: "Gemini 3 Flash (fastest)" },
  { value: "openai/gpt-5", label: "GPT-5 (multimodal)" },
  { value: "openai/gpt-5-mini", label: "GPT-5 Mini (cheap)" },
  // OpenRouter — server routes any model id prefixed with "openrouter/"
  // through the OpenRouter API using OPENROUTER_API_KEY.
  { value: "openrouter/anthropic/claude-3.7-sonnet", label: "Claude 3.7 Sonnet (via OpenRouter)" },
  { value: "openrouter/openai/gpt-5", label: "GPT-5 via OpenRouter" },
  { value: "openrouter/deepseek/deepseek-chat", label: "DeepSeek Chat (via OpenRouter)" },
  { value: "openrouter/meta-llama/llama-3.3-70b-instruct", label: "Llama 3.3 70B (via OpenRouter)" },
];

// Image models the AI can use when generating ad creatives.
// Multi-select: pick 1 = AI uses that model. Pick 2+ = AI runs a side-by-side comparison.
const IMAGE_MODELS: { value: "gemini-pro" | "nano-banana" | "openai"; label: string; hint: string }[] = [
  { value: "gemini-pro", label: "Gemini 3 Pro", hint: "Best finals" },
  { value: "nano-banana", label: "Nano Banana 2", hint: "Fast iteration" },
  { value: "openai", label: "GPT Image 1", hint: "Distinct style" },
];

// Approximate context window per model family (in tokens) for the usage meter.
function contextLimitFor(model: string): number {
  if (/gemini-2\.5-pro|gemini-3|gemini-2\.5-flash/i.test(model)) return 1_000_000;
  if (/gpt-5/i.test(model)) return 400_000;
  if (/claude/i.test(model)) return 200_000;
  if (/deepseek/i.test(model)) return 128_000;
  if (/llama/i.test(model)) return 128_000;
  return 200_000;
}

function ChatMessage({ message: m, isStreaming }: { message: Msg; isStreaming: boolean }) {
  if (m.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl bg-muted px-4 py-2 text-sm whitespace-pre-wrap text-foreground">
          {m.content}
        </div>
      </div>
    );
  }
  // Surface lead-quality tool results as a prominent inline alert
  const lqTool = (m.tools || []).find((t: any) => t.name === "check_lead_quality" && t.result && !t.result.error);
  const lq = lqTool?.result;
  return (
    <div className="text-sm text-foreground leading-relaxed">
      {m.tools && m.tools.length > 0 && (
        <div className="mb-2 space-y-1">
          {m.tools.map((t: any, j: number) => (
            <div key={j} className="text-xs flex items-center gap-2 text-muted-foreground">
              <Badge variant="secondary" className="text-[10px]">{t.name}</Badge>
              {t.status === "running" ? (
                <span className="flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> running…</span>
              ) : t.status === "error" || t.result?.error ? (
                <span className="text-destructive truncate max-w-[260px]">{t.result?.error || "failed"}</span>
              ) : (
                <span>✓</span>
              )}
            </div>
          ))}
        </div>
      )}
      {lq && (
        <div className="mb-3 rounded-xl border border-border/60 bg-background/60 backdrop-blur p-3 space-y-2">
          <div className="flex items-center gap-2 text-xs font-medium">
            <ShieldAlert className="h-3.5 w-3.5 text-rose-500" />
            Lead quality scan · last {lq.window_days || 30}d
          </div>
          <div className="flex flex-wrap gap-2 text-[11px]">
            <Badge variant="secondary">Total: {lq.total_leads}</Badge>
            {lq.spam_count > 0 && (
              <Badge className="bg-rose-500/15 text-rose-600 border border-rose-500/30 animate-pulse">
                Spam patterns: {lq.spam_count}
              </Badge>
            )}
            {lq.email_name_mismatch > 0 && (
              <Badge className="bg-amber-500/15 text-amber-700 border border-amber-500/30">
                Name⇆email mismatch: {lq.email_name_mismatch}
              </Badge>
            )}
            {lq.spam_count === 0 && lq.email_name_mismatch === 0 && (
              <Badge className="bg-emerald-500/15 text-emerald-600 border border-emerald-500/30">All clean</Badge>
            )}
          </div>
          {Array.isArray(lq.samples) && lq.samples.length > 0 && (
            <details className="text-[11px] text-muted-foreground">
              <summary className="cursor-pointer hover:text-foreground">View {lq.samples.length} flagged samples</summary>
              <ul className="mt-1 space-y-0.5 max-h-40 overflow-y-auto pl-3">
                {lq.samples.slice(0, 25).map((s: any, i: number) => (
                  <li key={i} className="font-mono truncate">
                    <span className="text-rose-500">[{s.reason}]</span> {s.name || "(no name)"} · {s.email}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
      {m.content ? (
        <div className="prose prose-sm dark:prose-invert max-w-none prose-p:my-2 prose-pre:my-2 prose-ul:my-2 prose-ol:my-2 prose-headings:mt-4 prose-headings:mb-2">
          <ReactMarkdown>{m.content}</ReactMarkdown>
          {isStreaming && (
            <span className="inline-flex items-center gap-1 ml-1 text-muted-foreground align-middle">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-primary/70 animate-pulse [animation-delay:120ms]" />
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-primary/40 animate-pulse [animation-delay:240ms]" />
            </span>
          )}
        </div>
      ) : isStreaming ? (
        <span className="inline-flex items-center gap-1 text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" /> thinking…
        </span>
      ) : null}
    </div>
  );
}

const SUGGESTIONS = [
  { icon: <ImageIcon className="h-4 w-4" />, label: "Generate a 1:1 ad creative for our offer" },
  { icon: <Wand2 className="h-4 w-4" />, label: "Generate 4 Instagram 1:1 variations of our offer" },
  { icon: <Film className="h-4 w-4" />, label: "Build a 32s 9:16 reel (4 keyframes → wait for my approval → Veo 3.1, 8s each)" },
  { icon: <FileText className="h-4 w-4" />, label: "Summarize the master doc" },
  { icon: <TableIcon className="h-4 w-4" />, label: "Audit EVERY tab in the sheet and give me a performance report" },
  { icon: <ShieldAlert className="h-4 w-4" />, label: "Scan leads for spam patterns (armyspy, teleworm, name/email mismatch)" },
];

// Defensive: strip any image markdown / image URLs from streamed assistant text
function stripImageMarkup(t: string) {
  return t
    .replace(/!\[[^\]]*\]\([^)]+\)/g, "")
    .replace(/<img[^>]*>/gi, "")
    .replace(/https?:\/\/\S+\.(png|jpg|jpeg|webp|gif)\b/gi, "")
    .replace(/\n{3,}/g, "\n\n");
}

export function AIStudioTab({ clientId, clientName }: Props) {
  const { data: agencySettings } = useAgencySettings();
  const { data: clientSettings } = useClientSettings(clientId);
  const updateClientSettings = useUpdateClientSettings();
  const [docUrl, setDocUrl] = useState<string>("");
  const [sheetUrl, setSheetUrl] = useState<string>("");
  const [quality, setQuality] = useState<"pro" | "fast">("pro");
  const [chatModel, setChatModel] = useState<string>("google/gemini-2.5-pro");
  const [imageModels, setImageModels] = useState<Array<"gemini-pro" | "nano-banana" | "openai">>(["gemini-pro"]);
  const [activeReferenceIds, setActiveReferenceIds] = useState<string[]>([]);
  const [autoDocContext, setAutoDocContext] = useState<boolean>(true);
  const [contextUsage, setContextUsage] = useState<{ chars: number; tokens: number; auto_doc?: { enabled: boolean; chars: number; title?: string | null } } | null>(null);
  const [autoConnectedDoc, setAutoConnectedDoc] = useState(false);
  const [autoConnectedSheet, setAutoConnectedSheet] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [canvas, setCanvas] = useState<CanvasEntry[]>([]);
  const [canvasView, setCanvasView] = useState<{ zoom: number; panX: number; panY: number } | null>(null);
  const [focusedItemId, setFocusedItemId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [clientDocUrl, setClientDocUrl] = useState<string>("");
  const [docTest, setDocTest] = useState<null | { ok: boolean; source?: string; title?: string; char_count?: number; doc_id?: string; latency_ms?: number; error?: string; client?: { name?: string } }>(null);
  const [testingDoc, setTestingDoc] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const aiStudioUrl = `https://${import.meta.env.VITE_SUPABASE_PROJECT_ID}.supabase.co/functions/v1/ai-studio`;

  const getStudioAuth = useCallback(async (requireIdentity = false) => {
    const { data: sess } = await supabase.auth.getSession();
    const token = sess.session?.access_token || null;
    const dashboardToken = localStorage.getItem("dashboard_session_token") || null;
    if (!token && !dashboardToken && requireIdentity) {
      throw new Error("Your dashboard session expired. Please sign in again.");
    }
    return { token, dashboardToken };
  }, []);

  const studioFetch = useCallback(async (body: Record<string, any>, signal?: AbortSignal) => {
    const { token, dashboardToken } = await getStudioAuth(true);
    return fetch(aiStudioUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string,
      },
      body: JSON.stringify({ ...body, dashboardToken }),
      signal,
    });
  }, [aiStudioUrl, getStudioAuth]);

  // Load conversation + history + canvas items from DB
  const loadHistory = useCallback(async () => {
    setHydrated(false);
    try {
      const { token, dashboardToken } = await getStudioAuth(false);
      if (!token && !dashboardToken) {
        setMessages([]);
        setCanvas([]);
        setHydrated(true);
        return;
      }
      const res = await studioFetch({ action: "history", clientId });
      if (!res.ok) throw new Error(await res.text().catch(() => "Failed to load AI Studio history"));
      const { conversation: convo, messages: msgs = [], canvasItems: items = [] } = await res.json();

      if (convo) {
        setConversationId(convo.id);
        if (convo.doc_url) setDocUrl(convo.doc_url);
        if (convo.sheet_url) setSheetUrl(convo.sheet_url);
        if (convo.image_quality === "fast" || convo.image_quality === "pro") setQuality(convo.image_quality);
        if (typeof (convo as any).chat_model === "string" && (convo as any).chat_model) setChatModel((convo as any).chat_model);
        if (Array.isArray((convo as any).active_reference_ids)) setActiveReferenceIds((convo as any).active_reference_ids as string[]);
        setCanvasView({
          zoom: Number((convo as any).canvas_zoom ?? 1) || 1,
          panX: Number((convo as any).canvas_pan_x ?? 0) || 0,
          panY: Number((convo as any).canvas_pan_y ?? 0) || 0,
        });
        setFocusedItemId(((convo as any).focused_canvas_item_id as string) || null);
        setMessages((msgs || []).map((m: any) => ({
          id: m.id,
          role: m.role as "user" | "assistant",
          content: m.content || "",
          tools: Array.isArray(m.tools) ? m.tools : [],
        })));
        setCanvas((items || []) as CanvasItem[]);
      } else {
        setConversationId(null);
        setMessages([]);
        setCanvas([]);
      }
    } catch (e) {
      console.error("AI Studio history load failed", e);
      setConversationId(null);
      setMessages([]);
      setCanvas([]);
    }
    setHydrated(true);
  }, [clientId, getStudioAuth, studioFetch]);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  // Load the Google Doc tied directly to this client (clients.google_doc_url)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("clients")
        .select("google_doc_url")
        .eq("id", clientId)
        .maybeSingle();
      if (!cancelled) setClientDocUrl(((data as any)?.google_doc_url as string) || "");
    })();
    return () => { cancelled = true; };
  }, [clientId]);

  // Default URLs from agency settings (only if conversation has none)
  useEffect(() => {
    if (!hydrated) return;
    // Per-client only — never fall back to agency-wide URLs so each client's
    // AI Studio is strictly tied to that client's own Doc/Sheet.
    if (!docUrl) {
      const fallback = clientDocUrl || (clientSettings as any)?.kpi_google_doc_url;
      if (fallback) { setDocUrl(fallback); setAutoConnectedDoc(true); }
    }
    if (!sheetUrl) {
      const fallback = (clientSettings as any)?.kpi_google_sheet_url;
      if (fallback) { setSheetUrl(fallback); setAutoConnectedSheet(true); }
    }
  }, [clientSettings, hydrated, docUrl, sheetUrl, clientDocUrl]);

  // Auto-scroll: instant follow during streaming so the user always sees the
  // newest tokens. Scroll the inner Radix viewport (ScrollArea wraps a viewport).
  useEffect(() => {
    const root = scrollRef.current as HTMLElement | null;
    if (!root) return;
    const viewport = root.querySelector<HTMLElement>("[data-radix-scroll-area-viewport]") || root;
    viewport.scrollTo({ top: viewport.scrollHeight, behavior: loading ? "auto" : "smooth" });
  }, [messages, loading]);

  // Rough per-model usage estimate for this client's conversation.
  // We approximate tokens from char counts and price using public-ish per-1M rates.
  const usageStats = (() => {
    const RATES: Record<string, { in: number; out: number }> = {
      "google/gemini-2.5-pro": { in: 1.25, out: 5 },
      "google/gemini-3-flash-preview": { in: 0.3, out: 2.5 },
      "openai/gpt-5": { in: 1.25, out: 10 },
      "openai/gpt-5-mini": { in: 0.25, out: 2 },
    };
    const r = RATES[chatModel] || { in: 1, out: 5 };
    let inChars = 0, outChars = 0;
    for (const m of messages) {
      if (m.role === "user") inChars += (m.content || "").length;
      else outChars += (m.content || "").length;
    }
    const inTok = Math.round(inChars / 4);
    const outTok = Math.round(outChars / 4);
    const cost = (inTok / 1_000_000) * r.in + (outTok / 1_000_000) * r.out;
    return { inTok, outTok, cost, model: chatModel };
  })();

  async function send(text: string) {
    if (!text.trim() || loading) return;
    const userMsg: Msg = { role: "user", content: text };
    const placeholder: Msg = { role: "assistant", content: "", tools: [] };
    setMessages(curr => [...curr, userMsg, placeholder]);
    const assistantIdx = messages.length + 1;
    setInput("");
    setLoading(true);
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    const updateAssistant = (mut: (m: Msg) => Msg) => {
      setMessages(curr => {
        const copy = curr.slice();
        if (copy[assistantIdx]) copy[assistantIdx] = mut(copy[assistantIdx]);
        return copy;
      });
    };

    try {
      const res = await studioFetch({
        clientId,
        userText: text,
        docUrl: docUrl || undefined,
        sheetUrl: sheetUrl || undefined,
        quality,
        chatModel,
        imageModels,
        activeReferenceIds,
        autoDocContext,
      }, ctrl.signal);
      if (!res.ok || !res.body) throw new Error(`Stream failed: ${res.status} ${await res.text().catch(() => "")}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() || "";
        for (const part of parts) {
          const line = part.split("\n").find(l => l.startsWith("data:"));
          if (!line) continue;
          let evt: any; try { evt = JSON.parse(line.slice(5).trim()); } catch { continue; }

          if (evt.type === "conversation") {
            setConversationId(evt.conversationId);
          } else if (evt.type === "context_usage") {
            setContextUsage({ chars: evt.chars, tokens: evt.estimated_tokens, auto_doc: evt.auto_doc });
          } else if (evt.type === "text") {
            updateAssistant(m => ({ ...m, content: stripImageMarkup((m.content || "") + evt.delta) }));
          } else if (evt.type === "tool_start") {
            updateAssistant(m => ({
              ...m,
              tools: [...(m.tools || []), { id: evt.id, name: evt.name, args: evt.args, status: "running" }],
            }));
          } else if (evt.type === "tool_end") {
            updateAssistant(m => ({
              ...m,
              tools: (m.tools || []).map(t =>
                t.id === evt.id ? { ...t, result: evt.result, status: evt.result?.error ? "error" : "done" } : t,
              ),
            }));
          } else if (evt.type === "canvas_placeholder") {
            const ph: CanvasPlaceholder = {
              __placeholder: true,
              placeholder_id: evt.placeholder_id,
              kind: "image",
              prompt: evt.prompt,
              aspect_ratio: evt.aspect_ratio,
              quality: evt.quality,
            };
            setCanvas(curr => [ph, ...curr]);
          } else if (evt.type === "canvas_placeholder_failed") {
            setCanvas(curr =>
              curr.map(c => "__placeholder" in c && c.placeholder_id === evt.placeholder_id ? { ...c, failed: evt.error } : c),
            );
          } else if (evt.type === "canvas_item") {
            setCanvas(curr => {
              const filtered = evt.replace_placeholder_id
                ? curr.filter(c => !("__placeholder" in c) || c.placeholder_id !== evt.replace_placeholder_id)
                : curr;
              return [evt.item as CanvasItem, ...filtered];
            });
          } else if (evt.type === "error") {
            updateAssistant(m => ({ ...m, content: (m.content || "") + `\n\n⚠️ ${evt.message}` }));
            toast.error(evt.message);
          }
        }
      }
    } catch (e: any) {
      if (e?.name === "AbortError") {
        updateAssistant(m => ({ ...m, content: (m.content || "") + "\n\n_(stopped)_" }));
      } else {
        toast.error(e?.message || "AI Studio failed");
        updateAssistant(m => ({ ...m, content: (m.content || "") + `\n\nError: ${e?.message || e}` }));
      }
    } finally {
      abortRef.current = null;
      setLoading(false);
    }
  }

  function stop() { abortRef.current?.abort(); }

  async function clearConversation() {
    if (!conversationId) { setMessages([]); setCanvas([]); return; }
    if (!confirm("Clear this AI Studio conversation? Past messages and canvas items will be hidden.")) return;
    const res = await studioFetch({ action: "clear", clientId, conversationId });
    if (!res.ok) { toast.error("Failed to clear"); return; }
    setMessages([]);
    setCanvas([]);
    toast.success("Conversation cleared");
  }

  // Persist URL/quality changes back to conversation row
  useEffect(() => {
    if (!hydrated || !conversationId) return;
    const t = setTimeout(() => {
      studioFetch({ action: "settings", clientId, conversationId, docUrl: docUrl || null, sheetUrl: sheetUrl || null, quality, chatModel, activeReferenceIds })
        .catch((e) => console.error("AI Studio settings save failed", e));
    }, 500);
    return () => clearTimeout(t);
  }, [docUrl, sheetUrl, quality, chatModel, activeReferenceIds, conversationId, hydrated, clientId, studioFetch]);

  // Inline edit from canvas — fire a hidden edit prompt that targets edit_static_ad
  const inlineEdit = useCallback(async (imageUrl: string, aspectRatio: string, instruction: string) => {
    const text = `Edit the canvas ad (source_image_url: ${imageUrl}, aspect_ratio: ${aspectRatio}). ${instruction}. Use the edit_static_ad tool.`;
    await send(text);
  }, [/* send is stable enough via closure; no deps to avoid loop */]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr,1.1fr] gap-4 h-[calc(100vh-220px)] min-h-[600px]">
      {/* LEFT — Chat */}
      <Card className="flex flex-col overflow-hidden border-border/60 shadow-sm">
        <div className="px-5 pt-4 pb-3 border-b border-border/60">
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-lg bg-primary/10 flex items-center justify-center">
              <Sparkles className="h-4 w-4 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold text-sm leading-tight truncate">AI Studio</h3>
              <p className="text-[11px] text-muted-foreground truncate">{clientName}</p>
            </div>
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={clearConversation} title="Clear conversation">
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        <details className="group border-b border-border/60 bg-muted/20">
          <summary className="flex items-center gap-2 px-5 py-2 cursor-pointer text-xs text-muted-foreground hover:bg-muted/40 select-none [&::-webkit-details-marker]:hidden">
            <Settings2 className="h-3.5 w-3.5" />
            <span className="flex-1">Connections & quality</span>
            <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
          </summary>
          <div className="px-5 pb-3 pt-1 space-y-2">
          {(() => {
            const clientDoc = clientDocUrl || (clientSettings as any)?.kpi_google_doc_url || "";
            const clientSheet = (clientSettings as any)?.kpi_google_sheet_url || "";
            const docSource = !docUrl
              ? ""
              : docUrl === clientDocUrl
                ? "tied to client"
                : docUrl === (clientSettings as any)?.kpi_google_doc_url
                  ? "client KPI default"
                  : "session override";
            const sheetSource = !sheetUrl ? "" : sheetUrl === clientSheet ? "client default" : "session override";
            const saveDoc = async () => {
              if (!docUrl.trim()) return;
              try {
                const trimmed = docUrl.trim();
                const m = trimmed.match(/\/document\/d\/([a-zA-Z0-9-_]+)/);
                const { error } = await supabase
                  .from("clients")
                  .update({ google_doc_url: trimmed, google_doc_id: m?.[1] || null })
                  .eq("id", clientId);
                if (error) throw error;
                setClientDocUrl(trimmed);
                toast.success("Linked Google Doc to this client");
              } catch (e: any) { toast.error(e?.message || "Failed to save"); }
            };
            const testDoc = async () => {
              setTestingDoc(true);
              setDocTest(null);
              try {
                const res = await studioFetch({ action: "test_doc", clientId, docUrl: docUrl || null });
                const json = await res.json();
                setDocTest(json);
                if (json.ok) {
                  toast.success(`Connected: "${json.title || "Untitled"}" (${json.char_count?.toLocaleString() || 0} chars, ${json.source})`);
                } else {
                  toast.error(json.error || "Doc test failed");
                }
              } catch (e: any) {
                setDocTest({ ok: false, error: e?.message || "Test failed" });
                toast.error(e?.message || "Doc test failed");
              } finally {
                setTestingDoc(false);
              }
            };
            const saveSheet = async () => {
              if (!sheetUrl.trim()) return;
              try {
                await updateClientSettings.mutateAsync({ client_id: clientId, kpi_google_sheet_url: sheetUrl.trim() } as any);
                toast.success("Saved as this client's default sheet");
              } catch (e: any) { toast.error(e?.message || "Failed to save"); }
            };
            return (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div className="space-y-1">
                  <div className="flex gap-1">
                    <Input placeholder="Google Doc URL" value={docUrl} onChange={e => setDocUrl(e.target.value)} className="h-8 text-xs" />
                    <Button size="sm" variant="outline" className="h-8 px-2 text-[10px] shrink-0"
                      disabled={!docUrl.trim() || docUrl === clientDocUrl}
                      onClick={saveDoc}>Tie to client</Button>
                    <Button size="sm" variant="outline" className="h-8 px-2 text-[10px] shrink-0"
                      disabled={testingDoc}
                      onClick={testDoc} title="Verify the tied Google Doc is reachable">
                      {testingDoc ? <Loader2 className="h-3 w-3 animate-spin" /> : "Test"}
                    </Button>
                  </div>
                  <div className="flex flex-wrap items-center gap-1">
                    {docSource && <Badge variant="secondary" className="text-[9px]">{docSource}</Badge>}
                    {autoConnectedDoc && <Badge variant="default" className="text-[9px] bg-emerald-600 hover:bg-emerald-600">Auto-connected</Badge>}
                    {docTest && (
                      <Badge
                        variant={docTest.ok ? "default" : "destructive"}
                        className="text-[9px] max-w-full truncate"
                        title={docTest.ok
                          ? `${docTest.title || "Untitled"} · ${docTest.char_count?.toLocaleString() || 0} chars · ${docTest.latency_ms}ms · source=${docTest.source} · client=${docTest.client?.name || "?"}`
                          : docTest.error}
                      >
                        {docTest.ok
                          ? `OK · ${docTest.title?.slice(0, 30) || "Untitled"} · ${docTest.source}`
                          : `Fail · ${(docTest.error || "").slice(0, 60)}`}
                      </Badge>
                    )}
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="flex gap-1">
                    <Input placeholder="Google Sheet URL" value={sheetUrl} onChange={e => setSheetUrl(e.target.value)} className="h-8 text-xs" />
                    <Button size="sm" variant="outline" className="h-8 px-2 text-[10px] shrink-0"
                      disabled={!sheetUrl.trim() || sheetUrl === clientSheet || updateClientSettings.isPending}
                      onClick={saveSheet}>Save</Button>
                  </div>
                  <div className="flex flex-wrap items-center gap-1">
                    {sheetSource && <Badge variant="secondary" className="text-[9px]">{sheetSource}</Badge>}
                    {autoConnectedSheet && <Badge variant="default" className="text-[9px] bg-emerald-600 hover:bg-emerald-600">Auto-connected</Badge>}
                  </div>
                </div>
              </div>
            );
          })()}
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Image quality:</span>
            <Select value={quality} onValueChange={(v: any) => setQuality(v)}>
              <SelectTrigger className="h-7 w-[220px] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="pro">Pro — Gemini 3 Pro Image (best)</SelectItem>
                <SelectItem value="fast">Fast — Nano Banana 2 (iterate)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="pt-2 border-t">
            <AIStudioReferenceLibrary clientId={clientId} activeIds={activeReferenceIds} onToggle={setActiveReferenceIds} />
          </div>
          </div>
        </details>

        <ScrollArea className="flex-1" ref={scrollRef as any}>
          <div className="px-4 sm:px-6 py-6 space-y-5 max-w-3xl mx-auto w-full">
            {messages.length === 0 && hydrated && (
              <div className="py-8 space-y-6">
                <div className="space-y-2">
                  <h2 className="text-2xl font-semibold tracking-tight">What can I build for {clientName.split(" ")[0]}?</h2>
                  <p className="text-sm text-muted-foreground">
                    Ask for ad creatives, scripts, copy, doc edits, or sheet queries. Visual results appear on the Canvas →
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {SUGGESTIONS.map(s => (
                    <button
                      key={s.label}
                      onClick={() => send(s.label)}
                      className="group flex items-center gap-2 rounded-full border border-border/60 bg-background hover:bg-muted/60 hover:border-border transition px-3 py-1.5 text-xs text-left"
                    >
                      <span className="text-primary/80 group-hover:text-primary">{s.icon}</span>
                      <span className="line-clamp-1">{s.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((m, i) => {
              const isLast = i === messages.length - 1;
              const isEmptyAssistant = m.role === "assistant" && !m.content && (!m.tools || m.tools.length === 0);
              if (isEmptyAssistant && !(loading && isLast)) return null;
              return (
                <ChatMessage
                  key={m.id || i}
                  message={m}
                  isStreaming={loading && isLast && m.role === "assistant"}
                />
              );
            })}
          </div>
        </ScrollArea>

        <div className="px-4 sm:px-6 pb-4 pt-2">
          <div className="max-w-3xl mx-auto w-full">
            {/* Context usage + auto doc toggle */}
            {(() => {
              const limit = contextLimitFor(chatModel);
              const used = contextUsage?.tokens ?? 0;
              const pct = Math.min(100, Math.round((used / limit) * 100));
              const barColor = pct > 85 ? "bg-destructive" : pct > 60 ? "bg-amber-500" : "bg-primary";
              return (
                <div className="mb-2 flex items-center gap-3 text-[10px] text-muted-foreground">
                  <div className="flex-1 flex items-center gap-2">
                    <BookOpenCheck className="h-3 w-3" />
                    <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                      <div className={`h-full ${barColor} transition-all`} style={{ width: `${pct}%` }} />
                    </div>
                    <span className="tabular-nums">
                      {used.toLocaleString()} / {limit.toLocaleString()} tok ({pct}%)
                    </span>
                  </div>
                  <label className="flex items-center gap-1.5 cursor-pointer shrink-0" title="Auto-load the tied Google Doc into context on every turn">
                    <Switch checked={autoDocContext} onCheckedChange={setAutoDocContext} className="scale-75" />
                    Auto Doc context
                    {contextUsage?.auto_doc?.enabled && contextUsage.auto_doc.chars > 0 && (
                      <Badge variant="secondary" className="text-[9px] ml-1">
                        {(contextUsage.auto_doc.chars / 1000).toFixed(1)}k chars
                      </Badge>
                    )}
                  </label>
                </div>
              );
            })()}
            {/* Cost analysis based on model + usage for this client/conversation */}
            {messages.length > 0 && (
              <div className="mb-2 flex items-center gap-2 text-[10px] text-muted-foreground">
                <DollarSign className="h-3 w-3" />
                <span className="tabular-nums">
                  ~${usageStats.cost.toFixed(4)} this convo
                </span>
                <span className="text-muted-foreground/60">·</span>
                <span className="tabular-nums">
                  in {usageStats.inTok.toLocaleString()} · out {usageStats.outTok.toLocaleString()} tok
                </span>
                <span className="text-muted-foreground/60">·</span>
                <Badge variant="secondary" className="text-[9px] h-4 px-1.5">{chatModel.split("/").pop()}</Badge>
              </div>
            )}
            <div className="relative rounded-2xl border border-border/60 bg-background shadow-sm focus-within:border-primary/40 focus-within:ring-2 focus-within:ring-primary/10 transition">
              <Textarea
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }}
                placeholder="Ask AI Studio to build, write, or edit anything…"
                className="resize-none min-h-[80px] max-h-48 border-0 focus-visible:ring-0 focus-visible:ring-offset-0 bg-transparent pr-14 pb-14 pt-3 text-sm"
                rows={1}
              />
              <div className="absolute bottom-2 left-2 right-14 flex items-center gap-1.5 flex-wrap">
                <Select value={chatModel} onValueChange={setChatModel}>
                  <SelectTrigger className="h-7 text-[10px] gap-1 border-border/60 bg-muted/40 hover:bg-muted w-auto px-2 rounded-lg">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CHAT_MODELS.map(m => (
                      <SelectItem key={m.value} value={m.value} className="text-xs">{m.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="flex items-center gap-1 pl-1.5 border-l border-border/60">
                  <span className="text-[9px] text-muted-foreground uppercase tracking-wide">Image:</span>
                  {IMAGE_MODELS.map(m => {
                    const active = imageModels.includes(m.value);
                    return (
                      <button
                        key={m.value}
                        type="button"
                        onClick={() => {
                          setImageModels(curr => {
                            const next = curr.includes(m.value) ? curr.filter(v => v !== m.value) : [...curr, m.value];
                            return next.length === 0 ? [m.value] : next;
                          });
                        }}
                        title={`${m.label} — ${m.hint}${active && imageModels.length > 1 ? " (in comparison)" : ""}`}
                        className={`h-7 px-2 rounded-lg text-[10px] border transition ${active ? "bg-primary text-primary-foreground border-primary" : "bg-muted/40 hover:bg-muted border-border/60 text-muted-foreground"}`}
                      >
                        {m.label}
                      </button>
                    );
                  })}
                  {imageModels.length > 1 && (
                    <Badge variant="secondary" className="text-[9px] h-5">compare ×{imageModels.length}</Badge>
                  )}
                </div>
              </div>
              <div className="absolute bottom-2 right-2">
                {loading ? (
                  <Button onClick={stop} size="icon" variant="destructive" className="h-9 w-9 rounded-xl" title="Stop">
                    <Square className="h-4 w-4" />
                  </Button>
                ) : (
                  <Button onClick={() => send(input)} disabled={!input.trim()} size="icon" className="h-9 w-9 rounded-xl">
                    <Send className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground/70 text-center mt-2">Enter to send · Shift+Enter for newline · Model + image quality apply to this turn</p>
          </div>
        </div>
      </Card>

      {/* RIGHT — Canvas */}
      <Card className="flex flex-col overflow-hidden">
        <Tabs defaultValue="canvas" className="flex-1 flex flex-col">
          <TabsList className="m-2 self-start">
            <TabsTrigger value="canvas"><Sparkles className="h-4 w-4 mr-1" /> Canvas</TabsTrigger>
            <TabsTrigger value="doc"><FileText className="h-4 w-4 mr-1" /> Doc</TabsTrigger>
            <TabsTrigger value="sheet"><TableIcon className="h-4 w-4 mr-1" /> Sheet</TabsTrigger>
            <TabsTrigger value="references"><Library className="h-4 w-4 mr-1" /> References</TabsTrigger>
          </TabsList>

          <TabsContent value="canvas" className="flex-1 m-0 overflow-hidden">
            <AIStudioCanvas
              entries={canvas}
              clientId={clientId}
              initialView={canvasView}
              focusedItemId={focusedItemId}
              onViewChange={(v) => {
                setCanvasView(v);
                if (conversationId) {
                  studioFetch({ action: "settings", clientId, conversationId, docUrl: docUrl || null, sheetUrl: sheetUrl || null, quality, chatModel, activeReferenceIds, canvasView: v }).catch(() => {});
                }
              }}
              onFocusItem={(id) => {
                setFocusedItemId(id);
                if (conversationId) {
                  studioFetch({ action: "settings", clientId, conversationId, docUrl: docUrl || null, sheetUrl: sheetUrl || null, quality, chatModel, activeReferenceIds, focusedCanvasItemId: id }).catch(() => {});
                }
              }}
              onCanvasItemUpdated={(updated) => {
                setCanvas(curr => curr.map(c => ("__placeholder" in c) ? c : (c.id === updated.id ? updated : c)));
              }}
              onInlineEdit={inlineEdit}
              onEditImage={(imageUrl, aspectRatio) => {
                setInput(
                  `Edit this ad on the canvas (source_image_url: ${imageUrl}, aspect_ratio: ${aspectRatio}).\n` +
                  `Describe what to change — for example: new offer, new hook/headline, new colors (hex list), or new disclaimer text. ` +
                  `Use the edit_static_ad tool.`
                );
                toast.success("Edit prompt loaded — refine and send");
              }}
            />
          </TabsContent>

          <TabsContent value="doc" className="flex-1 m-0 overflow-hidden">
            {docUrl ? (
              <div className="h-full flex flex-col">
                <div className="px-4 py-2 border-b flex items-center justify-between">
                  <span className="text-xs text-muted-foreground truncate">{docUrl}</span>
                  <a href={docUrl} target="_blank" rel="noopener noreferrer" className="text-xs flex items-center gap-1 text-primary"><ExternalLink className="h-3 w-3" /> Open</a>
                </div>
                <iframe src={docUrl.replace(/\/edit.*$/, "/preview")} className="flex-1 w-full" title="Doc preview" />
              </div>
            ) : (
              <div className="h-full flex items-center justify-center text-sm text-muted-foreground">Add a Google Doc URL above.</div>
            )}
          </TabsContent>

          <TabsContent value="sheet" className="flex-1 m-0 overflow-hidden">
            {sheetUrl ? (
              <div className="h-full flex flex-col">
                <div className="px-4 py-2 border-b flex items-center justify-between">
                  <span className="text-xs text-muted-foreground truncate">{sheetUrl}</span>
                  <a href={sheetUrl} target="_blank" rel="noopener noreferrer" className="text-xs flex items-center gap-1 text-primary"><ExternalLink className="h-3 w-3" /> Open</a>
                </div>
                <iframe src={sheetUrl.replace(/\/edit.*$/, "/preview")} className="flex-1 w-full" title="Sheet preview" />
              </div>
            ) : (
              <div className="h-full flex items-center justify-center text-sm text-muted-foreground">Add a Google Sheet URL above.</div>
            )}
          </TabsContent>

          <TabsContent value="references" className="flex-1 m-0 overflow-auto p-4">
            <div className="max-w-3xl mx-auto space-y-3">
              <div>
                <h3 className="text-sm font-semibold flex items-center gap-1.5"><Library className="h-4 w-4" /> Reference Library</h3>
                <p className="text-xs text-muted-foreground">
                  Toggle references on to have the AI use them as visual inspiration for new generations.
                  Auto-approved client creatives also appear here.
                </p>
              </div>
              <AIStudioReferenceLibrary clientId={clientId} activeIds={activeReferenceIds} onToggle={setActiveReferenceIds} />
            </div>
          </TabsContent>
        </Tabs>
      </Card>
    </div>
  );
}
