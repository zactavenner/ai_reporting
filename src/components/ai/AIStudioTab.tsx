import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Sparkles, FileText, Table as TableIcon, Image as ImageIcon, Send, Loader2, ExternalLink, Wand2, Square, Trash2, Film } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAgencySettings } from "@/hooks/useAgencySettings";
import { useClientSettings, useUpdateClientSettings } from "@/hooks/useClientSettings";
import { toast } from "sonner";
import { AIStudioCanvas, type CanvasEntry, type CanvasItem, type CanvasPlaceholder } from "./AIStudioCanvas";

interface Props {
  clientId: string;
  clientName: string;
}

type Msg = { id?: string; role: "user" | "assistant"; content: string; tools?: any[] };

const SUGGESTIONS = [
  { icon: <ImageIcon className="h-4 w-4" />, label: "Generate a 1:1 ad creative for our offer" },
  { icon: <Wand2 className="h-4 w-4" />, label: "Generate 4 Instagram 1:1 variations of our offer" },
  { icon: <Film className="h-4 w-4" />, label: "Build a 4-scene 9:16 video reel for our offer (storyboard → keyframes → Veo 3.1 videos, fully auto)" },
  { icon: <FileText className="h-4 w-4" />, label: "Summarize the master doc" },
  { icon: <TableIcon className="h-4 w-4" />, label: "Read the first 20 rows of the sheet" },
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
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [canvas, setCanvas] = useState<CanvasEntry[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [hydrated, setHydrated] = useState(false);
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

  // Default URLs from agency settings (only if conversation has none)
  useEffect(() => {
    if (!hydrated) return;
    if (!docUrl) {
      const fallback = (clientSettings as any)?.kpi_google_doc_url || agencySettings?.kpi_google_doc_url;
      if (fallback) setDocUrl(fallback);
    }
    if (!sheetUrl) {
      const fallback = (clientSettings as any)?.kpi_google_sheet_url || agencySettings?.kpi_google_sheet_url;
      if (fallback) setSheetUrl(fallback);
    }
  }, [agencySettings, clientSettings, hydrated, docUrl, sheetUrl]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

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
      studioFetch({ action: "settings", clientId, conversationId, docUrl: docUrl || null, sheetUrl: sheetUrl || null, quality })
        .catch((e) => console.error("AI Studio settings save failed", e));
    }, 500);
    return () => clearTimeout(t);
  }, [docUrl, sheetUrl, quality, conversationId, hydrated, clientId, studioFetch]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr,1.1fr] gap-4 h-[calc(100vh-220px)] min-h-[600px]">
      {/* LEFT — Chat */}
      <Card className="flex flex-col overflow-hidden">
        <div className="p-4 border-b space-y-2">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <h3 className="font-semibold flex-1">AI Studio · {clientName}</h3>
            <Button variant="ghost" size="sm" onClick={clearConversation} title="Clear conversation">
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
          {(() => {
            const clientDoc = (clientSettings as any)?.kpi_google_doc_url || "";
            const agencyDoc = agencySettings?.kpi_google_doc_url || "";
            const clientSheet = (clientSettings as any)?.kpi_google_sheet_url || "";
            const agencySheet = agencySettings?.kpi_google_sheet_url || "";
            const docSource = !docUrl ? "" : docUrl === clientDoc ? "client default" : docUrl === agencyDoc ? "agency default" : "override";
            const sheetSource = !sheetUrl ? "" : sheetUrl === clientSheet ? "client default" : sheetUrl === agencySheet ? "agency default" : "override";
            const saveDoc = async () => {
              if (!docUrl.trim()) return;
              try {
                await updateClientSettings.mutateAsync({ client_id: clientId, kpi_google_doc_url: docUrl.trim() } as any);
                toast.success("Saved as this client's default doc");
              } catch (e: any) { toast.error(e?.message || "Failed to save"); }
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
                      disabled={!docUrl.trim() || docUrl === clientDoc || updateClientSettings.isPending}
                      onClick={saveDoc}>Save</Button>
                  </div>
                  {docSource && <Badge variant="secondary" className="text-[9px]">{docSource}</Badge>}
                </div>
                <div className="space-y-1">
                  <div className="flex gap-1">
                    <Input placeholder="Google Sheet URL" value={sheetUrl} onChange={e => setSheetUrl(e.target.value)} className="h-8 text-xs" />
                    <Button size="sm" variant="outline" className="h-8 px-2 text-[10px] shrink-0"
                      disabled={!sheetUrl.trim() || sheetUrl === clientSheet || updateClientSettings.isPending}
                      onClick={saveSheet}>Save</Button>
                  </div>
                  {sheetSource && <Badge variant="secondary" className="text-[9px]">{sheetSource}</Badge>}
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
        </div>

        <ScrollArea className="flex-1" ref={scrollRef as any}>
          <div className="p-4 space-y-4">
            {messages.length === 0 && hydrated && (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Ask anything about this client's doc, sheet, or generate an ad. Built creatives appear on the Canvas →
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {SUGGESTIONS.map(s => (
                    <Button key={s.label} variant="outline" size="sm" className="justify-start h-auto py-2" onClick={() => send(s.label)}>
                      {s.icon}<span className="ml-2 text-xs text-left">{s.label}</span>
                    </Button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((m, i) => {
              const isLast = i === messages.length - 1;
              const isEmptyAssistant = m.role === "assistant" && !m.content && (!m.tools || m.tools.length === 0);
              if (isEmptyAssistant && !(loading && isLast)) return null;
              return (
                <div key={m.id || i} className={m.role === "user" ? "flex justify-end" : ""}>
                  <div className={`max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${m.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                    {m.tools && m.tools.length > 0 && (
                      <div className="mb-2 space-y-1">
                        {m.tools.map((t: any, j: number) => (
                          <div key={j} className="text-xs flex items-center gap-2 opacity-80">
                            <Badge variant="secondary" className="text-[10px]">{t.name}</Badge>
                            {t.status === "running" ? (
                              <span className="flex items-center gap-1 text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> running…</span>
                            ) : t.status === "error" || t.result?.error ? (
                              <span className="text-destructive truncate max-w-[260px]">{t.result?.error || "failed"}</span>
                            ) : (
                              <span>✓</span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                    {m.content || (loading && isLast && m.role === "assistant" ? (
                      <span className="inline-flex items-center gap-1 text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> thinking…</span>
                    ) : null)}
                  </div>
                </div>
              );
            })}
          </div>
        </ScrollArea>

        <div className="p-3 border-t flex gap-2">
          <Textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }}
            placeholder="Build an ad, edit the doc, query the sheet…"
            className="resize-none min-h-[44px] max-h-32"
            rows={1}
          />
          {loading ? (
            <Button onClick={stop} size="icon" variant="destructive" title="Stop">
              <Square className="h-4 w-4" />
            </Button>
          ) : (
            <Button onClick={() => send(input)} disabled={!input.trim()} size="icon">
              <Send className="h-4 w-4" />
            </Button>
          )}
        </div>
      </Card>

      {/* RIGHT — Canvas */}
      <Card className="flex flex-col overflow-hidden">
        <Tabs defaultValue="canvas" className="flex-1 flex flex-col">
          <TabsList className="m-2 self-start">
            <TabsTrigger value="canvas"><Sparkles className="h-4 w-4 mr-1" /> Canvas</TabsTrigger>
            <TabsTrigger value="doc"><FileText className="h-4 w-4 mr-1" /> Doc</TabsTrigger>
            <TabsTrigger value="sheet"><TableIcon className="h-4 w-4 mr-1" /> Sheet</TabsTrigger>
          </TabsList>

          <TabsContent value="canvas" className="flex-1 m-0 overflow-hidden">
            <AIStudioCanvas
              entries={canvas}
              clientId={clientId}
              onCanvasItemUpdated={(updated) => {
                setCanvas(curr => curr.map(c => ("__placeholder" in c) ? c : (c.id === updated.id ? updated : c)));
              }}
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
        </Tabs>
      </Card>
    </div>
  );
}
