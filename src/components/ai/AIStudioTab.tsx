import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Sparkles, FileText, Table as TableIcon, Image as ImageIcon, Send, Loader2, ExternalLink, Wand2, Square, Trash2, Film, Settings2, ChevronDown, Library, BookOpenCheck, ShieldAlert, DollarSign, Mic, Copy, Check, PanelRightClose, PanelRightOpen, Globe, Search, Pencil, Paperclip, Bot, History, X, Code2, Eye } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { useAgencySettings } from "@/hooks/useAgencySettings";
import { useClientSettings, useUpdateClientSettings } from "@/hooks/useClientSettings";
import { useClient } from "@/hooks/useClients";
import { toast } from "sonner";
import { AIStudioCanvas, type CanvasEntry, type CanvasItem, type CanvasPlaceholder } from "./AIStudioCanvas";
import { AIStudioReferenceLibrary } from "./AIStudioReferenceLibrary";
import { AIStudioThreadSidebar, type Thread } from "./AIStudioThreadSidebar";
import ReactMarkdown from "react-markdown";
import { useClientAgents, extractAgentMentions, buildAgentContextBlock } from "@/hooks/useClientAgents";
import { AgentFolderInline } from "@/components/agents/AgentFolderInline";
import { AIStudioAgentsTab } from "./AIStudioAgentsTab";
import { AIStudioReferencePicker, buildReferenceContextBlock, type VideoReference } from "./AIStudioReferencePicker";
import { VideoPlayerCard } from "./VideoPlayerCard";

interface Props {
  clientId: string;
  clientName: string;
}

type Msg = { id?: string; role: "user" | "assistant"; content: string; tools?: any[] };
type ChatImage = { url: string; aspect_ratio?: string; prompt?: string; toolName?: string; args?: any; model?: string };
type ChatVideo = { url: string; aspect_ratio?: string; prompt?: string; toolName?: string; args?: any; model?: string; duration?: number; resolution?: string };
type Attachment = { url: string; name: string; mime: string; text?: string; uploading?: boolean };

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
const IMAGE_MODELS: { value: "nano-banana" | "openai"; label: string; hint: string }[] = [
  { value: "nano-banana", label: "Nano Banana 2", hint: "Fast iteration" },
  { value: "openai", label: "GPT Image 2", hint: "Highest quality finals" },
];

// Video models (all routed through OpenRouter /v1/videos)
const VIDEO_MODELS: { value: string; label: string; hint: string }[] = [
  { value: "bytedance/seedance-2.0-fast", label: "Seedance Fast", hint: "Cheapest, quick drafts" },
  { value: "bytedance/seedance-2.0", label: "Seedance Pro", hint: "Best Seedance quality" },
  { value: "moonshotai/kling-v2.1", label: "Kling 2.1", hint: "Realistic motion" },
  { value: "moonshotai/kling-v2.1-pro", label: "Kling 2.1 Pro", hint: "Highest quality Kling" },
];

// Conversion-focused ad format presets. Each preset is injected into the
// AI Studio system prompt so the model picks the right dims, safe zones,
// text-overlay placement, and platform-native look automatically.
const AD_FORMATS: { value: string; label: string; aspect: "1:1" | "9:16" | "16:9"; hint: string }[] = [
  { value: "none", label: "Auto", aspect: "1:1", hint: "Let the AI choose" },
  { value: "meta_feed_1x1", label: "Meta Feed 1:1", aspect: "1:1", hint: "1080×1080 · headline top, CTA bottom" },
  { value: "meta_reel_9x16", label: "Meta Reel 9:16", aspect: "9:16", hint: "1080×1920 · keep text in middle 60% safe-zone" },
  { value: "story_9x16", label: "Story 9:16", aspect: "9:16", hint: "1080×1920 · top 250px / bottom 250px reserved for UI" },
  { value: "youtube_16x9", label: "YouTube 16:9", aspect: "16:9", hint: "1920×1080 · cinematic hook" },
  { value: "tiktok_9x16", label: "TikTok 9:16", aspect: "9:16", hint: "1080×1920 · UGC, native, captions baked in" },
];

// Proven direct-response copy frameworks. The picker tells the AI which
// structure to use for both on-image text and any scripts it writes.
const HOOK_FRAMEWORKS: { value: string; label: string; desc: string }[] = [
  { value: "auto", label: "Auto", desc: "Let the AI pick the best framework" },
  { value: "pas", label: "PAS", desc: "Problem → Agitate → Solution" },
  { value: "aida", label: "AIDA", desc: "Attention → Interest → Desire → Action" },
  { value: "hppc", label: "Hook-Promise-Proof-CTA", desc: "1s hook, big promise, proof point, single CTA" },
  { value: "pattern_interrupt", label: "Pattern Interrupt", desc: "Stop-scroll visual + contrarian claim" },
  { value: "testimonial", label: "Testimonial", desc: "Real-voice quote + specific result" },
  { value: "curiosity_gap", label: "Curiosity Gap", desc: "Open loop → tease payoff → CTA" },
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
  const artifacts = extractArtifacts(m.role === "assistant" ? (m.content || "") : "");
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
  // Web search citations
  const wsTools = (m.tools || []).filter((t: any) => t.name === "web_search" && t.result?.sources?.length);
  // Inline images + videos produced this turn
  const inlineImages: ChatImage[] = [];
  const inlineVideos: ChatVideo[] = [];
  for (const t of m.tools || []) {
    if (!t.result || t.result.error) continue;
    const u = t.result.url_for_internal_use_only || t.result.image_url;
    if (u) inlineImages.push({ url: u, aspect_ratio: t.result.aspect_ratio, prompt: t.args?.prompt, toolName: t.name, args: t.args, model: t.result.model });
    if (Array.isArray(t.result.variant_urls_internal)) {
      for (const vu of t.result.variant_urls_internal) inlineImages.push({ url: vu, aspect_ratio: t.result.aspect_ratio, prompt: t.args?.prompt, toolName: t.name, args: t.args, model: t.result.model });
    }
    const vu = t.result.video_url;
    if (vu) inlineVideos.push({
      url: vu,
      aspect_ratio: t.result.aspect_ratio || t.args?.aspect_ratio,
      prompt: t.args?.prompt || t.args?.video_prompt,
      toolName: t.name,
      args: t.args,
      model: t.result.model,
      duration: t.args?.duration || t.result.duration,
      resolution: t.args?.resolution || t.result.resolution,
    });
  }
  return (
    <div className="text-sm text-foreground leading-relaxed">
      {m.tools && m.tools.length > 0 && (
        <div className="mb-2 space-y-1">
          {m.tools.map((t: any, j: number) => (
            <div key={j} className="text-xs flex items-center gap-2 text-muted-foreground">
              <Badge variant="secondary" className="text-[10px] gap-1">
                {t.name === "web_search" && <Globe className="h-2.5 w-2.5" />}
                {t.name}
              </Badge>
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
        <div className="prose prose-sm dark:prose-invert max-w-none prose-p:my-2 prose-pre:my-2 prose-ul:my-2 prose-ol:my-2 prose-headings:mt-4 prose-headings:mb-2 prose-headings:font-semibold prose-strong:text-foreground prose-strong:font-semibold prose-h1:text-base prose-h2:text-sm prose-h3:text-sm prose-blockquote:border-l-primary/50 prose-code:bg-muted prose-code:px-1 prose-code:rounded">
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
      {inlineImages.length > 0 && (
        <div className="mt-3 -mx-1 px-1 flex gap-2 overflow-x-auto pb-2 snap-x scrollbar-thin scrollbar-thumb-border">
          {inlineImages.map((img, idx) => (
            <ChatImagePreview key={idx} image={img} />
          ))}
        </div>
      )}
      {inlineVideos.length > 0 && (
        <div className="mt-3 -mx-1 px-1 flex gap-2 overflow-x-auto pb-2 snap-x scrollbar-thin scrollbar-thumb-border">
          {inlineVideos.map((vid, idx) => (
            <ChatVideoPreview key={idx} video={vid} />
          ))}
        </div>
      )}
      {wsTools.length > 0 && (
        <div className="mt-3 space-y-2">
          {wsTools.map((t: any, i: number) => (
            <div key={i} className="rounded-xl border border-border/60 bg-muted/30 p-2.5 text-xs">
              <div className="flex items-center gap-1.5 font-medium mb-1.5 text-muted-foreground">
                <Search className="h-3 w-3" /> Sources for "{t.args?.query}"
              </div>
              <ul className="space-y-1">
                {t.result.sources.slice(0, 5).map((s: any, k: number) => (
                  <li key={k} className="truncate">
                    <a href={s.url} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                      {s.title || s.url}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
      {!isStreaming && m.content && (
        <div className="mt-2 flex items-center gap-1">
          <CopyButton text={m.content} />
          {artifacts.map((a, i) => (
            <ArtifactPreviewButton key={i} artifact={a} />
          ))}
        </div>
      )}
    </div>
  );
}

type Artifact = { lang: string; code: string; label: string };
function extractArtifacts(text: string): Artifact[] {
  const out: Artifact[] = [];
  const re = /```(html|jsx|tsx|react|svg)\s*\n([\s\S]*?)```/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const lang = m[1].toLowerCase();
    out.push({ lang, code: m[2].trim(), label: lang.toUpperCase() });
  }
  return out;
}

function ArtifactPreviewButton({ artifact }: { artifact: Artifact }) {
  const [open, setOpen] = useState(false);
  const html = (() => {
    if (artifact.lang === "svg") return `<!doctype html><html><body style="margin:0;display:grid;place-items:center;min-height:100vh;background:#0a0a0a">${artifact.code}</body></html>`;
    if (artifact.lang === "html") return artifact.code;
    // jsx/tsx/react → wrap in Babel standalone
    return `<!doctype html><html><head><meta charset="utf-8"/><script src="https://unpkg.com/react@18/umd/react.development.js"></script><script src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"></script><script src="https://unpkg.com/@babel/standalone/babel.min.js"></script><script src="https://cdn.tailwindcss.com"></script></head><body><div id="root"></div><script type="text/babel" data-presets="react,typescript">${artifact.code}\ntry{const Comp=typeof App!=='undefined'?App:(typeof Component!=='undefined'?Component:null);if(Comp){ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(Comp));}}catch(e){document.body.innerText=String(e);}</script></body></html>`;
  })();
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 text-[10px] text-primary hover:underline px-2 py-1 rounded-md hover:bg-primary/10"
        title="Preview artifact"
      >
        <Eye className="h-3 w-3" /> Preview {artifact.label}
      </button>
      {open && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm grid place-items-center p-6" onClick={() => setOpen(false)}>
          <div className="w-full max-w-5xl h-[80vh] bg-background rounded-xl shadow-2xl flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-2 border-b">
              <div className="flex items-center gap-2 text-xs"><Code2 className="h-3.5 w-3.5" /> Live artifact preview ({artifact.label})</div>
              <div className="flex items-center gap-2">
                <button onClick={() => { navigator.clipboard.writeText(artifact.code); toast.success("Copied"); }} className="text-[10px] px-2 py-1 rounded hover:bg-muted">Copy code</button>
                <button onClick={() => {
                  const blob = new Blob([artifact.lang === "html" ? html : artifact.code], { type: "text/html" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a"); a.href = url; a.download = `artifact.${artifact.lang === "tsx" ? "tsx" : artifact.lang === "jsx" ? "jsx" : artifact.lang}`;
                  a.click(); URL.revokeObjectURL(url);
                }} className="text-[10px] px-2 py-1 rounded hover:bg-muted">Download</button>
                <button onClick={() => setOpen(false)} className="p-1 hover:bg-muted rounded"><X className="h-4 w-4" /></button>
              </div>
            </div>
            <iframe srcDoc={html} className="flex-1 w-full bg-white" sandbox="allow-scripts" title="artifact" />
          </div>
        </div>
      )}
    </>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => {
        try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {}
      }}
      className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition px-2 py-1 rounded-md hover:bg-muted"
      title="Copy reply"
    >
      {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

async function downloadAsset(url: string, suggestedName: string) {
  try {
    const res = await fetch(url, { mode: "cors" });
    const blob = await res.blob();
    const obj = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = obj;
    a.download = suggestedName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(obj);
  } catch {
    // CORS fallback — open in new tab
    window.open(url, "_blank");
  }
}

function buildRecreatePrompt(asset: { prompt?: string; toolName?: string; args?: any }, kind: "image" | "video"): string {
  const a = asset.args || {};
  const lines: string[] = [];
  lines.push(`Regenerate with same params (edit anything below before sending):`);
  if (asset.prompt) lines.push(`prompt: ${asset.prompt}`);
  lines.push(`type: ${kind}`);
  if (a.model) lines.push(`model: ${a.model}`);
  if (asset.toolName === "generate_seedance_video") lines.push(`model: ${a.fast ? "seedance-2.0-fast" : "seedance-2.0"}`);
  if (a.aspect_ratio) lines.push(`aspect_ratio: ${a.aspect_ratio}`);
  if (a.duration) lines.push(`duration: ${a.duration}s`);
  if (a.resolution) lines.push(`resolution: ${a.resolution}`);
  return lines.join("\n");
}

function PreviewActionBar({
  url,
  prompt,
  filename,
  recreateText,
  canvasPayload,
  canvasKind,
}: {
  url: string;
  prompt?: string;
  filename: string;
  recreateText: string;
  canvasPayload: Record<string, any>;
  canvasKind: "image" | "scene_video";
}) {
  return (
    <div className="flex items-center gap-1">
      <button
        onClick={(e) => { e.stopPropagation(); downloadAsset(url, filename); }}
        className="inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded-md bg-primary text-primary-foreground hover:opacity-90"
        title="Download"
      >
        ⬇ Download
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation();
          window.dispatchEvent(new CustomEvent("aistudio:set-prompt", { detail: { text: recreateText } }));
          toast.success("Prompt loaded — edit and resend");
        }}
        className="inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded-md bg-muted hover:bg-muted/70 text-foreground"
        title="Load this prompt into the composer to edit and regenerate"
      >
        ↻ Recreate
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation();
          window.dispatchEvent(
            new CustomEvent("aistudio:add-canvas-asset", {
              detail: { kind: canvasKind, payload: { ...canvasPayload, prompt } },
            })
          );
        }}
        className="inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded-md bg-muted hover:bg-muted/70 text-foreground"
        title="Pin to canvas"
      >
        + Canvas
      </button>
    </div>
  );
}

function ChatImagePreview({ image }: { image: ChatImage }) {
  const [open, setOpen] = useState(false);
  const onDragStart = (e: React.DragEvent) => {
    try {
      e.dataTransfer.setData("text/uri-list", image.url);
      e.dataTransfer.setData("text/plain", image.url);
      e.dataTransfer.setData(
        "application/x-aistudio-image",
        JSON.stringify({ url: image.url, aspect_ratio: image.aspect_ratio, prompt: image.prompt })
      );
      e.dataTransfer.effectAllowed = "copyMove";
    } catch {}
  };
  const ext = (image.url.split("?")[0].split(".").pop() || "png").toLowerCase();
  const filename = `aistudio-${Date.now()}.${ext.length <= 4 ? ext : "png"}`;
  return (
    <div className="shrink-0 snap-start w-56 rounded-xl border border-border/60 bg-muted/30 overflow-hidden">
      <div
        draggable
        onDragStart={onDragStart}
        onClick={() => setOpen(true)}
        className="relative h-56 w-56 cursor-zoom-in bg-muted/40"
        title="Click to expand · drag onto composer to use as reference"
      >
        <img src={image.url} alt={image.prompt || "Generated"} className="h-full w-full object-cover pointer-events-none" loading="lazy" draggable={false} />
      </div>
      <div className="px-2 py-1.5 flex items-center justify-between gap-1 border-t border-border/40">
        <PreviewActionBar
          url={image.url}
          prompt={image.prompt}
          filename={filename}
          recreateText={buildRecreatePrompt(image, "image")}
          canvasPayload={{
            image_url: image.url,
            aspect_ratio: image.aspect_ratio || "1:1",
            model: image.model || image.args?.model,
            source: "chat_pin",
          }}
          canvasKind="image"
        />
        <button
          onClick={(e) => {
            e.stopPropagation();
            window.dispatchEvent(new CustomEvent("aistudio:use-image", { detail: { url: image.url, name: `ref-${Date.now()}.png` } }));
            toast.success("Added as reference");
          }}
          className="text-[10px] px-1.5 py-1 rounded-md hover:bg-muted text-muted-foreground"
          title="Use as reference"
        >
          + Ref
        </button>
      </div>
      {open && (
        <div onClick={() => setOpen(false)} className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm grid place-items-center p-4 cursor-zoom-out">
          <img src={image.url} alt={image.prompt || "Generated"} className="max-w-[90vw] max-h-[90vh] rounded-xl shadow-2xl" />
        </div>
      )}
    </div>
  );
}

function ChatVideoPreview({ video }: { video: ChatVideo }) {
  const filename = `aistudio-${Date.now()}.mp4`;
  const aspect = video.aspect_ratio === "16:9" ? "16/9" : video.aspect_ratio === "1:1" ? "1/1" : "9/16";
  const hasUrl = !!video.url;
  return (
    <div className="shrink-0 snap-start w-72 rounded-xl border border-border/60 bg-muted/30 overflow-hidden">
      <VideoPlayerCard
        src={video.url}
        aspect={aspect as any}
        status={hasUrl ? "ready" : "failed"}
        errorMessage={!hasUrl ? "The video URL could not be returned. Try Recreate." : undefined}
        className="rounded-none border-0"
      />
      <div className="px-2 py-1.5 flex items-center justify-between gap-1 border-t border-border/40">
        <PreviewActionBar
          url={video.url}
          prompt={video.prompt}
          filename={filename}
          recreateText={buildRecreatePrompt(video, "video")}
          canvasPayload={{
            video_url: video.url,
            aspect_ratio: video.aspect_ratio || "9:16",
            duration: video.duration || 15,
            resolution: video.resolution || "1080p",
            model: video.model || (video.args?.fast ? "seedance-2.0-fast" : "seedance-2.0"),
            video_prompt: video.prompt,
            mode: video.args?.image_url ? "image_to_video" : "text_to_video",
            source: "chat_pin",
          }}
          canvasKind="scene_video"
        />
        {video.duration && <span className="text-[10px] text-muted-foreground">{video.duration}s</span>}
      </div>
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
  const { data: client } = useClient(clientId);
  const brandColors: string[] = Array.isArray(client?.brand_colors) ? (client!.brand_colors as string[]) : [];
  const brandFonts: string[] = Array.isArray(client?.brand_fonts) ? (client!.brand_fonts as string[]) : [];
  const updateClientSettings = useUpdateClientSettings();
  const [docUrl, setDocUrl] = useState<string>("");
  const [sheetUrl, setSheetUrl] = useState<string>("");
  const [quality, setQuality] = useState<"pro" | "fast">("pro");
  const [chatModel, setChatModel] = useState<string>("google/gemini-2.5-pro");
  const [imageModels, setImageModels] = useState<Array<"nano-banana" | "openai">>(["openai"]);
  const [videoModel, setVideoModel] = useState<string>(() => {
    try { return localStorage.getItem("ai-studio:video-model") || "bytedance/seedance-2.0-fast"; }
    catch { return "bytedance/seedance-2.0-fast"; }
  });
  useEffect(() => { try { localStorage.setItem("ai-studio:video-model", videoModel); } catch {} }, [videoModel]);
  const [adFormat, setAdFormat] = useState<string>(() => {
    try { return localStorage.getItem("ai-studio:ad-format") || "none"; } catch { return "none"; }
  });
  useEffect(() => { try { localStorage.setItem("ai-studio:ad-format", adFormat); } catch {} }, [adFormat]);
  const [hookFramework, setHookFramework] = useState<string>(() => {
    try { return localStorage.getItem("ai-studio:hook-framework") || "auto"; } catch { return "auto"; }
  });
  useEffect(() => { try { localStorage.setItem("ai-studio:hook-framework", hookFramework); } catch {} }, [hookFramework]);
  const [burnCaptions, setBurnCaptions] = useState<boolean>(() => {
    try { return localStorage.getItem("ai-studio:burn-captions") === "1"; } catch { return false; }
  });
  useEffect(() => { try { localStorage.setItem("ai-studio:burn-captions", burnCaptions ? "1" : "0"); } catch {} }, [burnCaptions]);
  const [activeReferenceIds, setActiveReferenceIds] = useState<string[]>([]);
  const [activeVideoReferenceIds, setActiveVideoReferenceIds] = useState<string[]>([]);
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
  const [aiStudioTab, setAiStudioTab] = useState<"chat" | "agents">("chat");
  const [videoRefs, setVideoRefs] = useState<VideoReference[]>([]);
  const [loading, setLoading] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [showCanvas, setShowCanvas] = useState<boolean>(() => {
    try { return localStorage.getItem("ai-studio:show-canvas") !== "false"; } catch { return true; }
  });
  const [showChat, setShowChat] = useState<boolean>(() => {
    try { return localStorage.getItem("ai-studio:show-chat") !== "false"; } catch { return true; }
  });
  useEffect(() => { try { localStorage.setItem("ai-studio:show-chat", String(showChat)); } catch {} }, [showChat]);
  useEffect(() => { try { localStorage.setItem("ai-studio:show-canvas", String(showCanvas)); } catch {} }, [showCanvas]);
  const [followups, setFollowups] = useState<string[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [showThreads, setShowThreads] = useState<boolean>(() => {
    try { return localStorage.getItem("ai-studio:show-threads") !== "false"; } catch { return true; }
  });
  useEffect(() => { try { localStorage.setItem("ai-studio:show-threads", String(showThreads)); } catch {} }, [showThreads]);
  const [agentMode, setAgentMode] = useState<boolean>(() => {
    try { return localStorage.getItem("ai-studio:agent-mode") === "true"; } catch { return false; }
  });
  useEffect(() => { try { localStorage.setItem("ai-studio:agent-mode", String(agentMode)); } catch {} }, [agentMode]);
  const [pendingAttachments, setPendingAttachments] = useState<Attachment[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaRecRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recStreamRef = useRef<MediaStream | null>(null);
  useEffect(() => { try { localStorage.setItem("ai-studio:show-canvas", String(showCanvas)); } catch {} }, [showCanvas]);
  const [clientDocUrl, setClientDocUrl] = useState<string>("");
  const [docTest, setDocTest] = useState<null | { ok: boolean; source?: string; title?: string; char_count?: number; doc_id?: string; latency_ms?: number; error?: string; client?: { name?: string } }>(null);
  const [testingDoc, setTestingDoc] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const aiStudioUrl = `https://${import.meta.env.VITE_SUPABASE_PROJECT_ID}.supabase.co/functions/v1/ai-studio`;

  // --- Per-client agents (@mention support in AI Studio) ---
  const { data: clientAgents = [] } = useClientAgents(clientId);

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

  // Load list of threads for this client
  const loadThreads = useCallback(async () => {
    try {
      const { token, dashboardToken } = await getStudioAuth(false);
      if (!token && !dashboardToken) return;
      const res = await studioFetch({ action: "list_threads", clientId });
      if (!res.ok) return;
      const { threads = [] } = await res.json();
      setThreads(threads as Thread[]);
    } catch (e) { console.error("list_threads failed", e); }
  }, [clientId, getStudioAuth, studioFetch]);

  // Load conversation + history + canvas items from DB
  const loadHistory = useCallback(async (threadId?: string | null) => {
    setHydrated(false);
    try {
      const { token, dashboardToken } = await getStudioAuth(false);
      if (!token && !dashboardToken) {
        setMessages([]);
        setCanvas([]);
        setHydrated(true);
        return;
      }
      const res = await studioFetch({ action: "history", clientId, conversationId: threadId || undefined });
      if (!res.ok) throw new Error(await res.text().catch(() => "Failed to load AI Studio history"));
      const { conversation: convo, messages: msgs = [], canvasItems: items = [] } = await res.json();

      if (convo) {
        setConversationId(convo.id);
        if (convo.doc_url) setDocUrl(convo.doc_url);
        if (convo.sheet_url) setSheetUrl(convo.sheet_url);
        if (convo.image_quality === "fast" || convo.image_quality === "pro") setQuality(convo.image_quality);
        if (typeof (convo as any).chat_model === "string" && (convo as any).chat_model) setChatModel((convo as any).chat_model);
        if (Array.isArray((convo as any).active_reference_ids)) setActiveReferenceIds((convo as any).active_reference_ids as string[]);
        if (Array.isArray((convo as any).active_video_reference_ids)) setActiveVideoReferenceIds((convo as any).active_video_reference_ids as string[]);
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
      const msg = String((e as any)?.message || "");
      if (msg.includes("Not authenticated") || msg.includes("401")) {
        // Dashboard session token is missing/expired/invalid — force re-login
        try {
          localStorage.removeItem("dashboard_session_token");
          localStorage.removeItem("dashboard_auth");
        } catch {}
        if (typeof window !== "undefined") window.location.reload();
      }
      setConversationId(null);
      setMessages([]);
      setCanvas([]);
    }
    setHydrated(true);
  }, [clientId, getStudioAuth, studioFetch]);

  useEffect(() => { loadHistory(); loadThreads(); }, [loadHistory, loadThreads]);

  // Thread actions
  const newThread = useCallback(async () => {
    const res = await studioFetch({ action: "new_thread", clientId, threadTitle: "New chat", quality, chatModel });
    if (!res.ok) { toast.error("Failed to create thread"); return; }
    const { conversation } = await res.json();
    setConversationId(conversation.id);
    setMessages([]);
    setCanvas([]);
    setPendingAttachments([]);
    setFollowups([]);
    await loadThreads();
  }, [clientId, quality, chatModel, studioFetch, loadThreads]);

  const switchThread = useCallback(async (id: string) => {
    if (id === conversationId) return;
    setConversationId(id);
    await loadHistory(id);
  }, [conversationId, loadHistory]);

  const updateThread = useCallback(async (id: string, patch: { title?: string; pinned?: boolean; archived?: boolean }) => {
    const res = await studioFetch({ action: "update_thread", clientId, conversationId: id, threadUpdate: patch });
    if (!res.ok) { toast.error("Update failed"); return; }
    if (patch.archived && id === conversationId) {
      setConversationId(null); setMessages([]); setCanvas([]);
    }
    await loadThreads();
  }, [clientId, conversationId, studioFetch, loadThreads]);

  // File upload — store in gpt-files bucket, parse PDFs server-side later if needed
  const uploadFiles = useCallback(async (files: FileList | File[]) => {
    const list = Array.from(files);
    for (const f of list) {
      if (f.size > 20 * 1024 * 1024) { toast.error(`${f.name} exceeds 20MB`); continue; }
      const tempUrl = URL.createObjectURL(f);
      const tempAtt: Attachment = { url: tempUrl, name: f.name, mime: f.type || "application/octet-stream", uploading: true };
      setPendingAttachments(curr => [...curr, tempAtt]);
      try {
        const ext = f.name.split(".").pop() || "bin";
        const path = `ai-studio/${clientId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const { error } = await supabase.storage.from("gpt-files").upload(path, f, { contentType: f.type, upsert: false });
        if (error) throw error;
        const { data: pub } = supabase.storage.from("gpt-files").getPublicUrl(path);
        let text: string | undefined;
        if (/^text\/|\b(application\/json|csv|markdown)\b/i.test(f.type) || /\.(txt|md|json|csv|log)$/i.test(f.name)) {
          try { text = await f.text(); } catch {}
        }
        setPendingAttachments(curr => curr.map(a => a.url === tempUrl ? { url: pub.publicUrl, name: f.name, mime: f.type, text } : a));
        URL.revokeObjectURL(tempUrl);
      } catch (e: any) {
        toast.error(`Failed to upload ${f.name}: ${e?.message || e}`);
        setPendingAttachments(curr => curr.filter(a => a.url !== tempUrl));
      }
    }
  }, [clientId]);

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
    if (pendingAttachments.some(a => a.uploading)) { toast.error("Attachments still uploading"); return; }
    setFollowups([]);
    const attSnapshot = pendingAttachments.slice();
    const userContent = attSnapshot.length
      ? text + "\n\n" + attSnapshot.map(a => `📎 ${a.name}`).join("\n")
      : text;
    const userMsg: Msg = { role: "user", content: userContent };
    const placeholderId = `__pending-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const placeholder: Msg = { id: placeholderId, role: "assistant", content: "", tools: [] };
    setMessages(curr => [...curr, userMsg, placeholder]);
    setInput("");
    setPendingAttachments([]);
    setLoading(true);
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    // ID-based update avoids index drift (history reloads, parallel state updates)
    // which was the root cause of mid-stream flicker / wrong-message overwrites.
    const updateAssistant = (mut: (m: Msg) => Msg) => {
      setMessages(curr => curr.map(m => (m.id === placeholderId ? mut(m) : m)));
    };

    try {
      const res = await studioFetch({
        clientId,
        conversationId: conversationId || undefined,
        userText: (() => {
          const mentioned = extractAgentMentions(text, clientAgents as any);
          if (!mentioned.length) return text;
          return buildAgentContextBlock(mentioned) + text;
        })(),
        docUrl: docUrl || undefined,
        sheetUrl: sheetUrl || undefined,
        quality,
        chatModel,
        imageModels,
        videoModel,
        adFormat: adFormat === "none" ? undefined : adFormat,
        hookFramework: hookFramework === "auto" ? undefined : hookFramework,
        burnCaptions,
        activeReferenceIds,
        activeVideoReferenceIds,
        autoDocContext,
        agentMode,
        attachments: attSnapshot.map(a => ({ url: a.url, name: a.name, mime: a.mime, text: a.text })),
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
          } else if (evt.type === "canvas_placeholder_progress") {
            setCanvas(curr =>
              curr.map(c => {
                if (!("__placeholder" in c) || c.placeholder_id !== evt.placeholder_id) return c;
                return {
                  ...c,
                  progress: {
                    stage: evt.stage,
                    label: evt.label,
                    percent: typeof evt.percent === "number" ? evt.percent : c.progress?.percent,
                    attempt: evt.attempt,
                    max_attempts: evt.max_attempts,
                    elapsed_s: evt.elapsed_s,
                    phase: evt.phase,
                  },
                };
              }),
            );
          } else if (evt.type === "canvas_item") {
            setCanvas(curr => {
              const filtered = evt.replace_placeholder_id
                ? curr.filter(c => !("__placeholder" in c) || c.placeholder_id !== evt.replace_placeholder_id)
                : curr;
              return [evt.item as CanvasItem, ...filtered];
            });
          } else if (evt.type === "suggested_followups") {
            setFollowups(Array.isArray(evt.suggestions) ? evt.suggestions : []);
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
      loadThreads();
    }
  }

  function stop() { abortRef.current?.abort(); }

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recStreamRef.current = stream;
      audioChunksRef.current = [];
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm";
      const mr = new MediaRecorder(stream, { mimeType: mime });
      mediaRecRef.current = mr;
      mr.ondataavailable = (e) => { if (e.data?.size) audioChunksRef.current.push(e.data); };
      mr.onstop = async () => {
        recStreamRef.current?.getTracks().forEach(t => t.stop());
        recStreamRef.current = null;
        if (!audioChunksRef.current.length) return;
        setIsTranscribing(true);
        const blob = new Blob(audioChunksRef.current, { type: mime });
        const reader = new FileReader();
        reader.onloadend = async () => {
          try {
            const { data, error } = await supabase.functions.invoke("transcribe-audio", { body: { audio: reader.result } });
            if (error) throw error;
            const txt = (data as any)?.text?.trim();
            if (txt) setInput(curr => (curr ? curr + " " : "") + txt);
            else toast.error("No speech detected");
          } catch (e: any) { toast.error(e?.message || "Transcription failed"); }
          finally { setIsTranscribing(false); }
        };
        reader.readAsDataURL(blob);
      };
      mr.start();
      setIsRecording(true);
    } catch (e: any) { toast.error(e?.message || "Mic permission denied"); }
  }, []);
  const stopRecording = useCallback(() => { try { mediaRecRef.current?.stop(); } catch {} setIsRecording(false); }, []);

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
      studioFetch({ action: "settings", clientId, conversationId, docUrl: docUrl || null, sheetUrl: sheetUrl || null, quality, chatModel, activeReferenceIds, activeVideoReferenceIds })
        .catch((e) => console.error("AI Studio settings save failed", e));
    }, 500);
    return () => clearTimeout(t);
  }, [docUrl, sheetUrl, quality, chatModel, activeReferenceIds, activeVideoReferenceIds, conversationId, hydrated, clientId, studioFetch]);

  // Inline edit from canvas — fire a hidden edit prompt that targets edit_static_ad
  const inlineEdit = useCallback(async (imageUrl: string, aspectRatio: string, instruction: string) => {
    const text = `Edit the canvas ad (source_image_url: ${imageUrl}, aspect_ratio: ${aspectRatio}). ${instruction}. Use the edit_static_ad tool.`;
    await send(text);
  }, [/* send is stable enough via closure; no deps to avoid loop */]);

  // Drag-from-chat → drop on composer (and click "+ Reference" button on hover)
  const addImageAsReference = useCallback((url: string, name?: string) => {
    if (!url) return;
    setPendingAttachments(curr => {
      if (curr.some(a => a.url === url)) return curr;
      return [...curr, { url, name: name || url.split("/").pop() || "reference.png", mime: "image/png" }];
    });
  }, []);
  useEffect(() => {
    const onUse = (e: Event) => {
      const d = (e as CustomEvent).detail || {};
      addImageAsReference(d.url, d.name);
    };
    const onEdit = (e: Event) => {
      const d = (e as CustomEvent).detail || {};
      if (d.url) inlineEdit(d.url, d.aspect_ratio || "1:1", "Make the changes I'll describe next").catch(() => {});
    };
    window.addEventListener("aistudio:use-image", onUse);
    window.addEventListener("aistudio:edit-image", onEdit);
    const onSetPrompt = (e: Event) => {
      const d = (e as CustomEvent).detail || {};
      if (typeof d.text === "string") setInput(d.text);
    };
    const onAddCanvas = async (e: Event) => {
      const d = (e as CustomEvent).detail || {};
      if (!conversationId || !d.kind || !d.payload) return;
      try {
        const { data: u } = await supabase.auth.getUser();
        const uid = u?.user?.id;
        if (!uid) { toast.error("Sign in required"); return; }
        const { data, error } = await supabase
          .from("ai_studio_canvas_items")
          .insert({ conversation_id: conversationId, user_id: uid, kind: d.kind, payload: d.payload })
          .select()
          .single();
        if (error) throw error;
        setCanvas(curr => [data as CanvasItem, ...curr]);
        toast.success("Pinned to canvas");
      } catch (err: any) {
        toast.error(err?.message || "Failed to pin to canvas");
      }
    };
    window.addEventListener("aistudio:set-prompt", onSetPrompt);
    window.addEventListener("aistudio:add-canvas-asset", onAddCanvas);
    return () => {
      window.removeEventListener("aistudio:use-image", onUse);
      window.removeEventListener("aistudio:edit-image", onEdit);
      window.removeEventListener("aistudio:set-prompt", onSetPrompt);
      window.removeEventListener("aistudio:add-canvas-asset", onAddCanvas);
    };
  }, [addImageAsReference, inlineEdit, conversationId]);

  return (
    <div className={`grid grid-cols-1 ${showThreads ? "lg:grid-cols-[220px,1fr]" : "lg:grid-cols-1"} gap-3 h-full min-h-0`}>
      {showThreads && (
        <Card className="hidden lg:flex flex-col overflow-hidden border-border/60 shadow-sm p-0">
          <AIStudioThreadSidebar
            threads={threads}
            activeId={conversationId}
            onSelect={switchThread}
            onNew={newThread}
            onRename={(id, title) => updateThread(id, { title })}
            onPin={(id, pinned) => updateThread(id, { pinned })}
            onArchive={(id) => updateThread(id, { archived: true })}
          />
        </Card>
      )}
      <div className={`grid grid-cols-1 ${showChat && showCanvas ? "lg:grid-cols-[1fr,1.1fr]" : "lg:grid-cols-1"} gap-3 min-w-0 min-h-0`}>
      {/* LEFT — Chat */}
      {showChat && (
      <Card className="flex flex-col overflow-hidden border-border/60 shadow-sm min-h-0">
        <div className="px-5 pt-4 pb-3 border-b border-border/60">
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-lg bg-primary/10 flex items-center justify-center">
              <Sparkles className="h-4 w-4 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold text-sm leading-tight truncate">AI Studio</h3>
              <p className="text-[11px] text-muted-foreground truncate">{clientName}</p>
            </div>
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0 hidden lg:inline-flex" onClick={() => setShowThreads(v => !v)} title={showThreads ? "Hide threads" : "Show threads"}>
              <History className="h-3.5 w-3.5" />
            </Button>
            <AgentFolderInline clientId={clientId} clientName={clientName} compact />
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0 hidden lg:inline-flex" onClick={() => setShowCanvas(v => !v)} title={showCanvas ? "Hide canvas" : "Show canvas"}>
              {showCanvas ? <PanelRightClose className="h-3.5 w-3.5" /> : <PanelRightOpen className="h-3.5 w-3.5" />}
            </Button>
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
            <AIStudioReferenceLibrary clientId={clientId} activeIds={activeReferenceIds} onToggle={setActiveReferenceIds} activeVideoIds={activeVideoReferenceIds} onToggleVideo={setActiveVideoReferenceIds} />
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
                <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[10px] text-muted-foreground">
                  <div className="flex-1 min-w-[180px] flex items-center gap-2">
                    <BookOpenCheck className="h-3 w-3" />
                    <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                      <div className={`h-full ${barColor} transition-all`} style={{ width: `${pct}%` }} />
                    </div>
                    <span className="tabular-nums whitespace-nowrap">
                      {used.toLocaleString()} / {limit.toLocaleString()} tok ({pct}%)
                    </span>
                  </div>
                  <label className="flex items-center gap-1.5 cursor-pointer shrink-0 whitespace-nowrap" title="Auto-load the tied Google Doc into context on every turn">
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
              <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-muted-foreground">
                <DollarSign className="h-3 w-3" />
                <span className="tabular-nums whitespace-nowrap">
                  ~${usageStats.cost.toFixed(4)} this convo
                </span>
                <span className="text-muted-foreground/60 hidden sm:inline">·</span>
                <span className="tabular-nums whitespace-nowrap">
                  in {usageStats.inTok.toLocaleString()} · out {usageStats.outTok.toLocaleString()} tok
                </span>
                <span className="text-muted-foreground/60 hidden sm:inline">·</span>
                <Badge variant="secondary" className="text-[9px] h-4 px-1.5 whitespace-nowrap">{chatModel.split("/").pop()}</Badge>
              </div>
            )}
            <div
              className="relative rounded-2xl border border-border/60 bg-background shadow-sm focus-within:border-primary/40 focus-within:ring-2 focus-within:ring-primary/10 transition data-[dragging=true]:border-primary data-[dragging=true]:ring-2 data-[dragging=true]:ring-primary/30"
              onDragOver={(e) => {
                if (e.dataTransfer.types.includes("application/x-aistudio-image") || e.dataTransfer.types.includes("text/uri-list") || e.dataTransfer.types.includes("Files")) {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "copy";
                  (e.currentTarget as HTMLElement).dataset.dragging = "true";
                }
              }}
              onDragLeave={(e) => { (e.currentTarget as HTMLElement).dataset.dragging = "false"; }}
              onDrop={(e) => {
                (e.currentTarget as HTMLElement).dataset.dragging = "false";
                const json = e.dataTransfer.getData("application/x-aistudio-image");
                if (json) {
                  e.preventDefault();
                  try { const d = JSON.parse(json); if (d.url) addImageAsReference(d.url); } catch {}
                  return;
                }
                const uri = e.dataTransfer.getData("text/uri-list") || e.dataTransfer.getData("text/plain");
                if (uri && /^https?:\/\//.test(uri)) {
                  e.preventDefault();
                  addImageAsReference(uri);
                  return;
                }
                if (e.dataTransfer.files && e.dataTransfer.files.length) {
                  e.preventDefault();
                  uploadFiles(e.dataTransfer.files);
                }
              }}
            >
              {pendingAttachments.length > 0 && (
                <div className="flex flex-wrap gap-1.5 px-3 pt-2">
                  {pendingAttachments.map((a, i) => (
                    <div key={i} className="flex items-center gap-1.5 text-[10px] bg-muted rounded-md px-2 py-1">
                      {a.uploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Paperclip className="h-3 w-3" />}
                      <span className="max-w-[140px] truncate">{a.name}</span>
                      <button onClick={() => setPendingAttachments(curr => curr.filter((_, j) => j !== i))} className="hover:text-destructive"><X className="h-3 w-3" /></button>
                    </div>
                  ))}
                </div>
              )}
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => { if (e.target.files) uploadFiles(e.target.files); e.target.value = ""; }}
                accept="image/*,application/pdf,.txt,.md,.json,.csv,.log,.tsv"
              />
              <Textarea
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }}
                onPaste={(e) => {
                  const files = Array.from(e.clipboardData.files || []);
                  if (files.length) { e.preventDefault(); uploadFiles(files); }
                }}
                placeholder="Ask AI Studio to build, write, or edit anything…"
                className="resize-none min-h-[80px] max-h-48 border-0 focus-visible:ring-0 focus-visible:ring-offset-0 bg-transparent px-3 pt-3 pb-2 text-sm"
                rows={1}
              />
              <div className="flex items-end gap-2 px-2 pb-2 pt-1 border-t border-border/40">
                <div className="flex-1 flex items-center gap-1.5 flex-wrap min-w-0">
                <div className="flex items-center gap-1 pr-1.5 border-r border-border/60">
                  <span className="text-[9px] text-muted-foreground uppercase tracking-wide">Format:</span>
                  <Select value={adFormat} onValueChange={setAdFormat}>
                    <SelectTrigger className="h-7 text-[10px] gap-1 border-border/60 bg-muted/40 hover:bg-muted w-auto px-2 rounded-lg">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {AD_FORMATS.map(f => (
                        <SelectItem key={f.value} value={f.value} className="text-xs">
                          {f.label}<span className="text-muted-foreground ml-1">— {f.hint}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-1 pr-1.5 border-r border-border/60">
                  <span className="text-[9px] text-muted-foreground uppercase tracking-wide">Hook:</span>
                  <Select value={hookFramework} onValueChange={setHookFramework}>
                    <SelectTrigger className="h-7 text-[10px] gap-1 border-border/60 bg-muted/40 hover:bg-muted w-auto px-2 rounded-lg">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {HOOK_FRAMEWORKS.map(f => (
                        <SelectItem key={f.value} value={f.value} className="text-xs">
                          {f.label}<span className="text-muted-foreground ml-1">— {f.desc}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <button
                  type="button"
                  onClick={() => setBurnCaptions(v => !v)}
                  title="When on, AI burns styled subtitles into any generated video so it converts with sound off."
                  className={`h-7 px-2 rounded-lg text-[10px] border transition flex items-center gap-1 ${burnCaptions ? "bg-primary text-primary-foreground border-primary" : "bg-muted/40 hover:bg-muted border-border/60 text-muted-foreground"}`}
                >
                  CC {burnCaptions ? "on" : "off"}
                </button>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  title="Attach files (images, PDFs, text)"
                  className="h-7 w-7 rounded-lg bg-muted/40 hover:bg-muted border border-border/60 grid place-items-center text-muted-foreground hover:text-foreground transition"
                >
                  <Paperclip className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setAgentMode(v => !v)}
                  title="Agent mode — plan + auto-execute multi-step tasks"
                  className={`h-7 px-2 rounded-lg text-[10px] border transition inline-flex items-center gap-1 ${agentMode ? "bg-primary text-primary-foreground border-primary" : "bg-muted/40 hover:bg-muted border-border/60 text-muted-foreground"}`}
                >
                  <Bot className="h-3 w-3" /> Agent
                </button>
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
                <div className="flex items-center gap-1 pl-1.5 border-l border-border/60">
                  <span className="text-[9px] text-muted-foreground uppercase tracking-wide">Video:</span>
                  <Select value={videoModel} onValueChange={setVideoModel}>
                    <SelectTrigger className="h-7 text-[10px] gap-1 border-border/60 bg-muted/40 hover:bg-muted w-auto px-2 rounded-lg">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {VIDEO_MODELS.map(m => (
                        <SelectItem key={m.value} value={m.value} className="text-xs">
                          {m.label}<span className="text-muted-foreground ml-1">— {m.hint}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                </div>
                <div className="shrink-0">
                {loading ? (
                  <Button onClick={stop} size="icon" variant="destructive" className="h-9 w-9 rounded-xl" title="Stop">
                    <Square className="h-4 w-4" />
                  </Button>
                ) : (
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      onClick={isRecording ? stopRecording : startRecording}
                      size="icon"
                      variant={isRecording ? "destructive" : "ghost"}
                      className="h-9 w-9 rounded-xl"
                      title={isRecording ? "Stop recording" : "Record voice"}
                      disabled={isTranscribing}
                    >
                      {isTranscribing ? <Loader2 className="h-4 w-4 animate-spin" /> : isRecording ? <Square className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                    </Button>
                    <Button onClick={() => send(input)} disabled={!input.trim()} size="icon" className="h-9 w-9 rounded-xl">
                      <Send className="h-4 w-4" />
                    </Button>
                  </div>
                )}
                </div>
              </div>
            </div>
            {followups.length > 0 && !loading && (
              <div className="mt-3 flex flex-wrap gap-2 justify-center">
                <span className="text-[10px] text-muted-foreground self-center mr-1">Try next:</span>
                {followups.map((s, i) => (
                  <button key={i} onClick={() => send(s)} className="text-[11px] px-3 py-1.5 rounded-full border border-border/60 bg-muted/40 hover:bg-muted hover:border-primary/40 transition text-left">
                    {s}
                  </button>
                ))}
              </div>
            )}
            <p className="text-[10px] text-muted-foreground/70 text-center mt-2">Enter to send · Shift+Enter newline · 🎤 voice · 🌐 web search built-in</p>
          </div>
        </div>
      </Card>
      )}

      {/* RIGHT — Canvas */}
      {showCanvas && (
      <Card className="flex flex-col overflow-hidden">
        <Tabs defaultValue="canvas" className="flex-1 flex flex-col">
          <div className="flex items-center justify-between px-2 pt-2 gap-2">
            <TabsList className="self-start">
              <TabsTrigger value="canvas"><Sparkles className="h-4 w-4 mr-1" /> Canvas</TabsTrigger>
              <TabsTrigger value="doc"><FileText className="h-4 w-4 mr-1" /> Doc</TabsTrigger>
              <TabsTrigger value="sheet"><TableIcon className="h-4 w-4 mr-1" /> Sheet</TabsTrigger>
              <TabsTrigger value="references"><Library className="h-4 w-4 mr-1" /> References</TabsTrigger>
            </TabsList>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0 hidden lg:inline-flex shrink-0"
              onClick={() => setShowChat(v => !v)}
              title={showChat ? "Hide chat" : "Show chat"}
            >
              {showChat ? <PanelRightClose className="h-3.5 w-3.5 rotate-180" /> : <PanelRightOpen className="h-3.5 w-3.5 rotate-180" />}
            </Button>
          </div>

          <TabsContent value="canvas" className="flex-1 m-0 overflow-hidden flex flex-col">
            <div className="flex-1 overflow-hidden">
            <AIStudioCanvas
              entries={canvas}
              clientId={clientId}
              onSendMessage={(text) => send(text)}
              initialView={canvasView}
              focusedItemId={focusedItemId}
              onViewChange={(v) => {
                setCanvasView(v);
                if (conversationId) {
                  studioFetch({ action: "settings", clientId, conversationId, docUrl: docUrl || null, sheetUrl: sheetUrl || null, quality, chatModel, activeReferenceIds, activeVideoReferenceIds, canvasView: v }).catch(() => {});
                }
              }}
              onFocusItem={(id) => {
                setFocusedItemId(id);
                if (conversationId) {
                  studioFetch({ action: "settings", clientId, conversationId, docUrl: docUrl || null, sheetUrl: sheetUrl || null, quality, chatModel, activeReferenceIds, activeVideoReferenceIds, focusedCanvasItemId: id }).catch(() => {});
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
            </div>
            {/* Brand guardrails strip — defaults pulled from Company Info */}
            <div className="border-t border-border/60 bg-background/60 backdrop-blur px-3 py-2 flex items-center gap-3 text-[11px]">
              <span className="uppercase tracking-wide text-[9px] text-muted-foreground font-medium">Brand lock</span>
              {brandColors.length > 0 ? (
                <div className="flex items-center gap-1.5">
                  {brandColors.slice(0, 8).map((c, i) => (
                    <div
                      key={i}
                      className="h-5 w-5 rounded-md border border-border/60 shadow-sm"
                      style={{ backgroundColor: c }}
                      title={c}
                    />
                  ))}
                  <span className="text-muted-foreground ml-1 hidden sm:inline">
                    {brandColors.slice(0, 4).join(" · ")}{brandColors.length > 4 ? ` +${brandColors.length - 4}` : ""}
                  </span>
                </div>
              ) : (
                <span className="text-muted-foreground italic">No brand colors — add in Company Info</span>
              )}
              <div className="h-4 w-px bg-border/60" />
              {brandFonts.length > 0 ? (
                <span className="text-foreground/80 truncate max-w-[260px]" style={{ fontFamily: brandFonts[0] }}>
                  {brandFonts.join(" · ")}
                </span>
              ) : (
                <span className="text-muted-foreground italic">No brand fonts set</span>
              )}
              <span className="ml-auto text-[10px] text-muted-foreground">Generations default to these</span>
            </div>
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
              <AIStudioReferenceLibrary clientId={clientId} activeIds={activeReferenceIds} onToggle={setActiveReferenceIds} activeVideoIds={activeVideoReferenceIds} onToggleVideo={setActiveVideoReferenceIds} />
            </div>
          </TabsContent>
        </Tabs>
      </Card>
      )}
      </div>
    </div>
  );
}
