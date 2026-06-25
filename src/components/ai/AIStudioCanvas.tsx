import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Copy, ExternalLink, FileText, Table as TableIcon, Image as ImageIcon, AlertCircle, Wand2, Check, Save, Film, Clapperboard, ScrollText, Plus, Minus, Maximize2, Send, X, ShieldCheck, Download, Scissors, Subtitles, Crosshair, LayoutGrid, Rows3, Grid3x3, RefreshCw, GraduationCap } from "lucide-react";
import { toast } from "sonner";
import { useState, useRef, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { StoryboardTimelineCard } from "./StoryboardTimelineCard";
import { VideoPlayerCard } from "./VideoPlayerCard";

/** Pretty label for the model id stored on canvas payloads. */
export function modelLabel(model?: string): string {
  if (!model) return "model";
  const m = model.toLowerCase();
  if (m.includes("seedance") && m.includes("fast")) return "Seedance 2.0 Fast";
  if (m.includes("seedance")) return "Seedance 2.0 Pro";
  if (m.includes("kling") && m.includes("pro")) return "Kling 3.0 Pro";
  if (m.includes("kling")) return "Kling 3.0 Fast";
  if (m.includes("veo")) return "Veo 3.1 Fast";
  if (m.includes("happyhorse") || m.includes("happy-horse")) return "HappyHorse 1.1";
  if (m.includes("riverflow")) return "Riverflow v2 Pro";
  if (m.includes("gpt-image") || m === "openai") return "GPT Image 2";
  if (m.includes("gemini-3") && m.includes("pro")) return "Gemini 3 Pro";
  if (m.includes("nano-banana") || m.includes("gemini-3") || m.includes("flash-image") || m === "nano-banana") return "Nano Banana 2";
  return model;
}

export type CanvasPlaceholder = {
  __placeholder: true;
  placeholder_id: string;
  kind: "image";
  prompt: string;
  aspect_ratio: string;
  quality: string;
  failed?: string;
  progress?: {
    stage: "submitting" | "queued" | "polling" | "downloading" | "rehosting" | "completed" | "failed";
    label: string;
    percent?: number;
    attempt?: number;
    max_attempts?: number;
    elapsed_s?: number;
    phase?: "keyframe" | "animation";
  };
};
export type CanvasItem = {
  id: string;
  kind: "image" | "doc_edit" | "sheet_edit" | "variation_set" | "storyboard" | "scene_image" | "scene_video" | "text_artifact";
  payload: any;
  created_at: string;
};
export type CanvasEntry = CanvasItem | CanvasPlaceholder;

export function AIStudioCanvas({
  entries, onEditImage, onInlineEdit, onEditVideo, onAddCaptions, clientId, onCanvasItemUpdated, onSendMessage, onSendToCreatives,
  initialView, focusedItemId, onViewChange, onFocusItem,
}: {
  entries: CanvasEntry[];
  onEditImage?: (imageUrl: string, aspectRatio: string) => void;
  onInlineEdit?: (imageUrl: string, aspectRatio: string, instruction: string) => Promise<void> | void;
  onEditVideo?: (videoUrl: string, meta?: { prompt?: string; aspect_ratio?: string }) => void;
  onAddCaptions?: (videoUrl: string, meta?: { prompt?: string; aspect_ratio?: string }) => void;
  clientId?: string;
  onCanvasItemUpdated?: (item: CanvasItem) => void;
  onSendMessage?: (text: string) => void;
  /** Routes "Send to Creatives" through the ai-studio edge function (handles auth + RLS bypass). */
  onSendToCreatives?: (rows: any[]) => Promise<void>;
  initialView?: { zoom?: number; panX?: number; panY?: number } | null;
  focusedItemId?: string | null;
  onViewChange?: (view: { zoom: number; panX: number; panY: number }) => void;
  onFocusItem?: (itemId: string | null) => void;
}) {
  const [zoom, setZoom] = useState(initialView?.zoom ?? 1);
  const [pan, setPan] = useState({ x: initialView?.panX ?? 0, y: initialView?.panY ?? 0 });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [animatingId, setAnimatingId] = useState<string | null>(null);
  const draggingRef = useRef<{ x: number; y: number } | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const focusScrolledRef = useRef<string | null>(null);
  const lastEntryCountRef = useRef<number>(0);
  const lastEntryKeyRef = useRef<string>("");
  const [sendingApproval, setSendingApproval] = useState(false);
  // Mobile-friendly: default to a simple stacked "feed" mode on small screens
  // (no pan/zoom transform — easier to scroll with thumbs). Users can flip back
  // to the free canvas via the toolbar toggle, persisted in localStorage.
  const [feedMode, setFeedMode] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem("ai-studio:canvas-feed-mode");
      if (stored !== null) return stored === "true";
    } catch {}
    return typeof window !== "undefined" && window.matchMedia("(max-width: 768px)").matches;
  });
  useEffect(() => {
    try { localStorage.setItem("ai-studio:canvas-feed-mode", String(feedMode)); } catch {}
  }, [feedMode]);

  const approvalCandidates = entries.filter(
    (e) =>
      !("__placeholder" in e) &&
      (e.kind === "image" || e.kind === "scene_image" || e.kind === "scene_video") &&
      (e.payload?.image_url || e.payload?.video_url),
  ) as CanvasItem[];

  const sendToCreatives = async () => {
    if (!clientId) { toast.error("No client selected"); return; }
    if (approvalCandidates.length === 0) { toast.error("Nothing on the canvas to send"); return; }
    setSendingApproval(true);
    try {
      const rows = approvalCandidates.map((it) => {
        const p: any = it.payload || {};
        const isVideo = it.kind === "scene_video" || !!p.video_url;
        const url = isVideo ? p.video_url : p.image_url;
        const promptText: string = p.prompt || p.video_prompt || "AI Studio asset";
        return {
          client_id: clientId,
          title: `AI Studio — ${promptText.slice(0, 80)}`,
          type: isVideo ? "video" : "image",
          platform: "meta",
          file_url: url,
          status: "draft" as const,
          aspect_ratio: p.aspect_ratio || null,
          comments: [],
          source: "ai_studio_canvas",
        };
      });
      if (onSendToCreatives) {
        await onSendToCreatives(rows);
      } else {
        // Fallback: direct insert (only works for Supabase-JWT users)
        const { error } = await supabase.from("creatives").insert(rows as any);
        if (error) throw error;
      }
      toast.success(`Sent ${rows.length} asset${rows.length === 1 ? "" : "s"} to Creatives for agency review`);
    } catch (err: any) {
      toast.error(err?.message || "Failed to send to Creatives");
    } finally {
      setSendingApproval(false);
    }
  };

  // Hydrate when initialView arrives (after async load)
  useEffect(() => {
    if (!initialView) return;
    if (typeof initialView.zoom === "number") setZoom(initialView.zoom);
    if (typeof initialView.panX === "number" || typeof initialView.panY === "number") {
      setPan({ x: initialView.panX ?? 0, y: initialView.panY ?? 0 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialView?.zoom, initialView?.panX, initialView?.panY]);

  // Debounced persistence of zoom + pan
  useEffect(() => {
    if (!onViewChange) return;
    const t = setTimeout(() => onViewChange({ zoom, panX: pan.x, panY: pan.y }), 400);
    return () => clearTimeout(t);
  }, [zoom, pan.x, pan.y, onViewChange]);

  // Scroll to focused item once on load
  useEffect(() => {
    if (!focusedItemId || focusScrolledRef.current === focusedItemId) return;
    const el = viewportRef.current?.querySelector<HTMLElement>(`[data-canvas-item-id="${focusedItemId}"]`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      focusScrolledRef.current = focusedItemId;
    }
  }, [focusedItemId, entries.length]);

  // Auto-scroll canvas to bottom when new entries arrive (mirrors chat flow).
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const lastKey = entries.length
      ? ("__placeholder" in entries[entries.length - 1]
          ? (entries[entries.length - 1] as CanvasPlaceholder).placeholder_id
          : (entries[entries.length - 1] as CanvasItem).id)
      : "";
    const grew = entries.length > lastEntryCountRef.current;
    const changed = lastKey !== lastEntryKeyRef.current;
    lastEntryCountRef.current = entries.length;
    lastEntryKeyRef.current = lastKey;
    if (!grew && !changed) return;
    // Defer to next frame so newly inserted card has a measured height.
    requestAnimationFrame(() => {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    });
  }, [entries]);

  const onWheel = useCallback((e: React.WheelEvent) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    setZoom(z => Math.max(0.25, Math.min(3, z * (e.deltaY < 0 ? 1.1 : 0.9))));
  }, []);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      setZoom(z => Math.max(0.25, Math.min(3, z * (e.deltaY < 0 ? 1.1 : 0.9))));
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler as any);
  }, []);

  const onMouseDown = (e: React.MouseEvent) => {
    // Only pan when clicking the empty background, not a card
    if ((e.target as HTMLElement).closest("[data-canvas-card]")) return;
    draggingRef.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
  };
  const onMouseMove = (e: React.MouseEvent) => {
    if (!draggingRef.current) return;
    setPan({ x: e.clientX - draggingRef.current.x, y: e.clientY - draggingRef.current.y });
  };
  const stopDrag = () => { draggingRef.current = null; };

  return (
    <div className="h-full flex flex-col">
      <div className="sticky top-0 z-20 shrink-0 flex items-center gap-1 px-2 py-1 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 flex-wrap">
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          onClick={() => setFeedMode(f => !f)}
          title={feedMode ? "Switch to free canvas (pan + zoom)" : "Switch to stacked feed (easier on mobile)"}
        >
          {feedMode ? <LayoutGrid className="h-3.5 w-3.5" /> : <Rows3 className="h-3.5 w-3.5" />}
        </Button>
        <Button size="icon" variant="ghost" className="h-7 w-7" disabled={feedMode} onClick={() => setZoom(z => Math.max(0.25, z * 0.9))} title="Zoom out">
          <Minus className="h-3.5 w-3.5" />
        </Button>
        <button
          onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}
          disabled={feedMode}
          className="text-xs tabular-nums w-14 text-center hover:bg-muted rounded px-1 py-0.5 disabled:opacity-40 disabled:hover:bg-transparent"
          title="Reset"
        >
          {feedMode ? "Feed" : `${Math.round(zoom * 100)}%`}
        </button>
        <Button size="icon" variant="ghost" className="h-7 w-7" disabled={feedMode} onClick={() => setZoom(z => Math.min(3, z * 1.1))} title="Zoom in">
          <Plus className="h-3.5 w-3.5" />
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 gap-1 px-2"
          title="Overview — zoom out so every creative on the canvas is visible at once, with same-turn cards lined up in rows"
          onClick={() => {
            // One-click overview: leave feed mode, reset pan, drop zoom so a
            // full row of creatives fits, and scroll to the top of the canvas.
            setFeedMode(false);
            setPan({ x: 0, y: 0 });
            setZoom(0.6);
            requestAnimationFrame(() => {
              viewportRef.current?.scrollTo({ top: 0, behavior: "smooth" });
            });
          }}
        >
          <Grid3x3 className="h-3.5 w-3.5" />
          <span className="hidden sm:inline text-xs">Overview</span>
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          title="Jump to most recent generation"
          onClick={() => {
            const el = viewportRef.current;
            if (!el) return;
            // Find the last canvas card in DOM order (most recent generation).
            const cards = el.querySelectorAll<HTMLElement>("[data-canvas-card]");
            const target = cards[cards.length - 1];
            if (!target) {
              el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
              return;
            }
            // Reset zoom so the target is legible, then center it.
            if (!feedMode) { setZoom(1); setPan({ x: 0, y: 0 }); }
            requestAnimationFrame(() => {
              target.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
            });
          }}
        >
          <Crosshair className="h-3.5 w-3.5" />
        </Button>
        <span className="text-[10px] text-muted-foreground ml-2 hidden xl:inline truncate">Ctrl/⌘+wheel to zoom · drag empty area to pan · click image to edit</span>
        <div className="ml-auto flex items-center gap-2 shrink-0">
          <span className="text-[10px] text-muted-foreground">{approvalCandidates.length} ready</span>
          <Button
            size="sm"
            className="h-7 gap-1 whitespace-nowrap"
            disabled={sendingApproval || approvalCandidates.length === 0 || !clientId}
            onClick={sendToCreatives}
            title="Push every image/video on the canvas into the Creatives section as drafts for agency review"
          >
            {sendingApproval ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
            <span className="hidden sm:inline">Send to Creatives</span>
            <span className="sm:hidden">Approve</span>
          </Button>
        </div>
      </div>
      <div
        ref={viewportRef}
        className={`flex-1 overflow-auto bg-muted/10 ${feedMode ? "" : "cursor-grab active:cursor-grabbing"}`}
        onMouseDown={feedMode ? undefined : onMouseDown}
        onMouseMove={feedMode ? undefined : onMouseMove}
        onMouseUp={feedMode ? undefined : stopDrag}
        onMouseLeave={feedMode ? undefined : stopDrag}
        onWheel={feedMode ? undefined : onWheel}
      >
        <div
          className={`p-3 sm:p-4 grid grid-cols-1 ${feedMode ? "" : "sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5"} gap-4 sm:gap-6 origin-top-left transition-transform duration-75 auto-rows-min items-start`}
          style={feedMode ? { width: "100%" } : { transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: "0 0", width: "100%" }}
        >
      {entries.length === 0 && (
        <div className="col-span-full flex items-center justify-center text-sm text-muted-foreground p-12 text-center">
          The canvas builds downward as you chat. Ask for an ad, edit a doc, or pin an asset — each result drops in here in step with the conversation.
        </div>
      )}
      {entries.map((e, i) => {
        if ("__placeholder" in e) {
          const pr = e.progress;
          const pct = pr?.percent ?? (pr?.stage === "completed" ? 100 : pr?.stage === "queued" ? 8 : pr?.stage === "submitting" ? 2 : 0);
          return (
            <Card key={`ph-${e.placeholder_id}`} data-canvas-card className="p-4 border-dashed">
              <div className="flex items-start gap-3">
                <div className="h-10 w-10 rounded bg-muted flex items-center justify-center">
                  {e.failed ? <AlertCircle className="h-5 w-5 text-destructive" /> : <Loader2 className="h-5 w-5 animate-spin text-primary" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <Badge variant="outline" className="text-[10px]">{e.aspect_ratio}</Badge>
                    <Badge variant="secondary" className="text-[10px]">{e.quality === "fast" ? "fast" : "pro"}</Badge>
                    <span className="text-xs text-muted-foreground truncate">
                      {e.failed ? "failed" : (pr?.label || "building on canvas…")}
                      {pr?.elapsed_s ? ` · ${Math.round(pr.elapsed_s)}s` : ""}
                      {pr?.phase ? ` · ${pr.phase}` : ""}
                    </span>
                  </div>
                  <p className="text-sm line-clamp-2">{e.prompt}</p>
                  {!e.failed && pr && (
                    <div className="mt-2 h-1.5 w-full rounded bg-muted overflow-hidden">
                      <div
                        className="h-full bg-primary transition-all duration-500"
                        style={{ width: `${Math.max(2, Math.min(100, pct))}%` }}
                      />
                    </div>
                  )}
                  {e.failed && <p className="text-xs text-destructive mt-1">{e.failed}</p>}
                </div>
              </div>
            </Card>
          );
        }
        if (e.kind === "image") {
          const p = e.payload || {};
          const isEditing = editingId === e.id;
          const isFocused = focusedItemId === e.id;
          return (
            <Card key={e.id} data-canvas-card data-canvas-item-id={e.id} className={`p-3 overflow-hidden transition-shadow ${isFocused ? "ring-2 ring-primary shadow-lg" : ""}`}>
              <div className="flex items-center gap-2 mb-2">
                <ImageIcon className="h-4 w-4 text-primary" />
                <Badge variant="outline" className="text-[10px]">{p.aspect_ratio || "1:1"}</Badge>
                <Badge variant="secondary" className="text-[10px] truncate max-w-[180px]" title={p.model}>
                  {modelLabel(p.model)}
                </Badge>
                <span className="text-xs text-muted-foreground ml-auto">{new Date(e.created_at).toLocaleTimeString()}</span>
              </div>
              {p.image_url && (
                <div
                  className="relative group cursor-pointer"
                  onClick={(ev) => {
                    ev.stopPropagation();
                    onFocusItem?.(e.id);
                    if (onInlineEdit) setEditingId(prev => prev === e.id ? null : e.id);
                  }}
                  title={onInlineEdit ? "Click to edit this image" : ""}
                >
                  <img src={p.image_url} alt={p.prompt || "ad creative"} className="w-full rounded-md border" loading="lazy" />
                  {onInlineEdit && !isEditing && (
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors rounded-md flex items-center justify-center opacity-0 group-hover:opacity-100">
                      <div className="bg-background/90 backdrop-blur-sm rounded-full px-3 py-1.5 text-xs flex items-center gap-1.5 shadow-lg">
                        <Wand2 className="h-3.5 w-3.5 text-primary" /> Click to edit
                      </div>
                    </div>
                  )}
                </div>
              )}
              {isEditing && p.image_url && onInlineEdit && (
                <InlineEditBar
                  onSubmit={async (instr) => {
                    await onInlineEdit(p.image_url, p.aspect_ratio || "1:1", instr);
                    setEditingId(null);
                  }}
                  onCancel={() => setEditingId(null)}
                />
              )}
              {animatingId === e.id && p.image_url && onSendMessage && (
                <InlineAnimateBar
                  defaultPrompt={`Animate this image into a cinematic clip. Subject, brand colors, and composition stay consistent. Add subtle natural camera motion and lighting.`}
                  onSubmit={(instr) => {
                    const text =
                      `Animate this image into a 15-second 1080p cinematic clip using Seedance 2.0 image-to-video. ` +
                      `${instr.trim()} ` +
                      `Keep the subject, brand colors, and composition consistent. ` +
                      `image_url: ${p.image_url} aspect_ratio: ${p.aspect_ratio || "1:1"}`;
                    onSendMessage(text);
                    toast.success("Animating with Seedance 2.0…");
                    setAnimatingId(null);
                  }}
                  onCancel={() => setAnimatingId(null)}
                />
              )}
              <p className="text-xs text-muted-foreground line-clamp-2 mt-2">{p.prompt}</p>
              <div className="flex items-center flex-wrap gap-1 mt-2">
                {p.image_url && (
                  <>
                    {onEditImage && (
                      <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" title="Edit (offer / hook / colors / disclaimer)"
                        onClick={(ev) => { ev.stopPropagation(); onEditImage(p.image_url, p.aspect_ratio || "1:1"); }}>
                        <Wand2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    {onSendMessage && (
                      <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" title="Animate this image (describe the motion)"
                        onClick={(ev) => {
                          ev.stopPropagation();
                          setAnimatingId(prev => prev === e.id ? null : e.id);
                          setEditingId(null);
                        }}>
                        <Film className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" title="Copy URL"
                      onClick={(ev) => { ev.stopPropagation(); navigator.clipboard.writeText(p.image_url); toast.success("URL copied"); }}>
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" title="Open" asChild>
                      <a href={p.image_url} target="_blank" rel="noopener noreferrer" onClick={ev => ev.stopPropagation()}>
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    </Button>
                  </>
                )}
                {p.parent_image_url && (
                  <Badge variant="outline" className="text-[10px] ml-auto">revision</Badge>
                )}
              </div>
            </Card>
          );
        }
        if (e.kind === "doc_edit") {
          const p = e.payload || {};
          return (
            <Card key={e.id} data-canvas-card className="p-3 col-span-full">
              <div className="flex items-center gap-2 mb-1">
                <FileText className="h-4 w-4 text-primary" />
                <span className="text-sm font-medium">Doc {p.action === "replace" ? "find & replace" : "append"}</span>
                {p.model && <Badge variant="secondary" className="text-[10px]" title={p.model}>{modelLabel(p.model)}</Badge>}
                <span className="text-xs text-muted-foreground ml-auto">{new Date(e.created_at).toLocaleTimeString()}</span>
              </div>
              {p.action === "append" ? (
                <p className="text-xs text-muted-foreground">{p.chars} chars appended. <span className="italic line-clamp-2">{p.preview}</span></p>
              ) : (
                <p className="text-xs text-muted-foreground">Replaced "{p.find}" → "{p.replace}"</p>
              )}
              {p.doc_url && (
                <a href={p.doc_url} target="_blank" rel="noopener noreferrer" className="text-xs text-primary inline-flex items-center gap-1 mt-1">
                  <ExternalLink className="h-3 w-3" /> Open doc
                </a>
              )}
            </Card>
          );
        }
        if (e.kind === "sheet_edit") {
          const p = e.payload || {};
          return (
            <Card key={e.id} data-canvas-card className="p-3 col-span-full">
              <div className="flex items-center gap-2 mb-1">
                <TableIcon className="h-4 w-4 text-primary" />
                <span className="text-sm font-medium">Sheet {p.action === "append" ? "row append" : "range update"}</span>
                {p.model && <Badge variant="secondary" className="text-[10px]" title={p.model}>{modelLabel(p.model)}</Badge>}
                <span className="text-xs text-muted-foreground ml-auto">{new Date(e.created_at).toLocaleTimeString()}</span>
              </div>
              <p className="text-xs text-muted-foreground">
                {p.range} — {p.action === "append" ? `${p.rows} rows` : `${p.cells} cells`}
              </p>
              {p.sheet_url && (
                <a href={p.sheet_url} target="_blank" rel="noopener noreferrer" className="text-xs text-primary inline-flex items-center gap-1 mt-1">
                  <ExternalLink className="h-3 w-3" /> Open sheet
                </a>
              )}
            </Card>
          );
        }
        if (e.kind === "variation_set") {
          return <div key={e.id} className="col-span-full"><VariationSetCard item={e} clientId={clientId} onUpdated={onCanvasItemUpdated} /></div>;
        }
        if (e.kind === "storyboard") {
          return (
            <div key={e.id} className="col-span-full">
              <StoryboardTimelineCard
                item={e}
                entries={entries}
                onUpdated={onCanvasItemUpdated}
                onSendMessage={onSendMessage}
              />
            </div>
          );
        }
        if (e.kind === "scene_image") {
          const p = e.payload || {};
          return (
            <Card key={e.id} data-canvas-card className="p-3">
              <div className="flex items-center gap-2 mb-2">
                <ImageIcon className="h-4 w-4 text-primary" />
                <Badge variant="outline" className="text-[10px]">Scene {p.scene_order}</Badge>
                <Badge variant="secondary" className="text-[10px]">{p.aspect_ratio}</Badge>
                {p.model && <Badge variant="secondary" className="text-[10px]" title={p.model}>{modelLabel(p.model)}</Badge>}
                <span className="text-xs text-muted-foreground ml-auto">keyframe</span>
              </div>
              {p.image_url && (
                <a href={p.image_url} target="_blank" rel="noopener noreferrer">
                  <img src={p.image_url} alt={`scene ${p.scene_order}`} className="w-full rounded-md border" loading="lazy" />
                </a>
              )}
              <p className="text-[10px] text-muted-foreground line-clamp-2 mt-2">{p.prompt}</p>
            </Card>
          );
        }
        if (e.kind === "scene_video") {
          const p = e.payload || {};
          const displayModelLabel = modelLabel(p.effective_model || p.model);
          const showSceneBadge = typeof p.scene_order === "number" && !p.model?.includes("seedance");
          const requestedModel = p.requested_model || p.model || "—";
          const effectiveModel = p.effective_model || p.model || "—";
          const effectiveDuration = p.effective_duration || p.duration || "—";
          const effectiveResolution = p.effective_resolution || p.resolution || "—";
          const wireResolution = p.wire_resolution || effectiveResolution;
          const isHappyHorse = String(effectiveModel || p.model || "").toLowerCase().includes("happyhorse");
          const happyHorseLocked = isHappyHorse && Number(effectiveDuration) === 15 && String(effectiveResolution).toLowerCase() === "1080p";
          return (
            <Card key={e.id} data-canvas-card className="p-3">
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <Film className="h-4 w-4 text-primary" />
                {showSceneBadge && <Badge variant="outline" className="text-[10px]">Scene {p.scene_order}</Badge>}
                {p.mode && <Badge variant="outline" className="text-[10px] capitalize">{String(p.mode).replace(/_/g, "→")}</Badge>}
                <Badge variant="secondary" className="text-[10px]">{p.aspect_ratio}</Badge>
                <Badge variant="secondary" className="text-[10px]" title={effectiveModel}>{displayModelLabel}</Badge>
                {p.resolution && <Badge variant="secondary" className="text-[10px]">{p.resolution}</Badge>}
                {p.actual_resolution && (
                  p.resolution_match === false ? (
                    <Badge variant="outline" className="text-[10px] border-amber-500/50 text-amber-600 dark:text-amber-400" title={`Requested ${p.resolution || "?"}, actual ${p.actual_resolution}${p.actual_width && p.actual_height ? ` (${p.actual_width}×${p.actual_height})` : ""}`}>
                      ⚠ actual {p.actual_resolution}
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-[10px] border-emerald-500/50 text-emerald-600 dark:text-emerald-400" title={`Verified ${p.actual_resolution}${p.actual_width && p.actual_height ? ` (${p.actual_width}×${p.actual_height})` : ""}`}>
                      ✓ verified
                    </Badge>
                  )
                )}
                <span className="text-xs text-muted-foreground ml-auto">{p.duration || 5}s</span>
              </div>
              <VideoPlayerCard
                src={p.video_url}
                aspect={p.aspect_ratio === "16:9" ? "16/9" : p.aspect_ratio === "1:1" ? "1/1" : "9/16"}
                status={p.video_url ? "ready" : "failed"}
                errorMessage={!p.video_url ? "Generation finished but no video URL was returned." : undefined}
                onEdit={p.video_url && onEditVideo ? (u) => onEditVideo(u, { prompt: p.video_prompt, aspect_ratio: p.aspect_ratio }) : undefined}
              />
              <p className="text-[10px] text-muted-foreground line-clamp-2 mt-2">{p.video_prompt}</p>
              {isHappyHorse && (
                <div className="mt-2 rounded-lg border border-primary/25 bg-primary/5 p-2 text-[10px]">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="font-semibold text-foreground">HappyHorse render debug</span>
                    <Badge variant={happyHorseLocked ? "secondary" : "destructive"} className="h-5 text-[10px]">
                      {happyHorseLocked ? "Locked 15s / 1080p" : "Check settings"}
                    </Badge>
                  </div>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-muted-foreground">
                    <span>Exact model</span><span className="font-mono text-foreground truncate" title={effectiveModel}>{effectiveModel}</span>
                    <span>Duration used</span><span className="font-mono text-foreground">{effectiveDuration}s</span>
                    <span>Resolution used</span><span className="font-mono text-foreground">{effectiveResolution}</span>
                    <span>OpenRouter sent</span><span className="font-mono text-foreground">{wireResolution}</span>
                    <span>Requested</span><span className="font-mono text-foreground truncate" title={`${requestedModel} • ${p.requested_duration ?? p.duration ?? "—"}s • ${p.requested_resolution ?? p.resolution ?? "—"}`}>{p.requested_duration ?? p.duration ?? "—"}s / {p.requested_resolution ?? p.resolution ?? "—"}</span>
                    <span>Actual file</span><span className="font-mono text-foreground">{p.actual_width && p.actual_height ? `${p.actual_width}×${p.actual_height}` : p.actual_resolution || "pending"}</span>
                  </div>
                </div>
              )}
              <div className="flex items-center flex-wrap gap-1.5 mt-2">
                {p.video_url && (
                  <>
                    <Button
                      size="sm"
                      variant="default"
                      className="h-7 px-2 text-[11px] gap-1 shrink-0"
                      title="Download video"
                      onClick={async () => {
                        try {
                          const res = await fetch(p.video_url, { mode: "cors" });
                          const blob = await res.blob();
                          const obj = URL.createObjectURL(blob);
                          const a = document.createElement("a");
                          a.href = obj;
                          a.download = `aistudio-${Date.now()}.mp4`;
                          document.body.appendChild(a);
                          a.click();
                          a.remove();
                          URL.revokeObjectURL(obj);
                          toast.success("Downloaded");
                        } catch {
                          window.open(p.video_url, "_blank");
                        }
                      }}
                    >
                      <Download className="h-3.5 w-3.5" /> Download
                    </Button>
                    {onEditVideo && (
                      <Button
                        size="sm"
                        variant="secondary"
                        className="h-7 px-2 text-[11px] gap-1 shrink-0"
                        title="Edit in Video Editor"
                        onClick={() => onEditVideo(p.video_url, { prompt: p.video_prompt, aspect_ratio: p.aspect_ratio })}
                      >
                        <Scissors className="h-3.5 w-3.5" /> Edit
                      </Button>
                    )}
                    {onAddCaptions && (
                      <Button
                        size="sm"
                        variant="secondary"
                        className="h-7 px-2 text-[11px] gap-1 shrink-0"
                        title="Add viral-pop captions (auto-transcribe)"
                        onClick={() => onAddCaptions(p.video_url, { prompt: p.video_prompt, aspect_ratio: p.aspect_ratio })}
                      >
                        <Subtitles className="h-3.5 w-3.5" /> Captions
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="secondary"
                      className="h-7 px-2 text-[11px] gap-1 shrink-0"
                      title="Re-create — load this video's prompt into chat"
                      onClick={() => {
                        const text = p.video_prompt || "";
                        if (!text) { toast.error("No prompt found for this video"); return; }
                        window.dispatchEvent(new CustomEvent("aistudio:set-prompt", { detail: { text } }));
                        toast.success("Prompt loaded — tweak & send");
                      }}
                    >
                      <RefreshCw className="h-3.5 w-3.5" /> Re-create
                    </Button>
                    {onSendMessage && (
                      <Button
                        size="sm"
                        variant="secondary"
                        className="h-7 px-2 text-[11px] gap-1 shrink-0"
                        title="Train — teach the AI to make more like this"
                        onClick={() => {
                          const promptText = p.video_prompt || "";
                          const model = p.model || "this model";
                          const ar = p.aspect_ratio || "";
                          const dur = p.duration || "";
                          const msg = `TRAIN: Remember this winning video as a reference style going forward. When I ask for similar videos, match its pacing, framing, tone, and structure.\n\nReference video URL: ${p.video_url}\nModel: ${model}\nAspect: ${ar}  Duration: ${dur}s\nOriginal prompt:\n"""${promptText}"""\n\nExtract the key style ingredients (camera, lighting, subject energy, edit rhythm, hook pattern) and save them as the preferred style for this client. Confirm what you've learned, then suggest 3 fresh variations I could generate next.`;
                          onSendMessage(msg);
                          toast.success("Training the AI on this video…");
                        }}
                      >
                        <GraduationCap className="h-3.5 w-3.5" /> Train
                      </Button>
                    )}
                    <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" title="Copy URL"
                      onClick={() => { navigator.clipboard.writeText(p.video_url); toast.success("URL copied"); }}>
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                  </>
                )}
              </div>
            </Card>
          );
        }
        if (e.kind === "text_artifact") {
          const p = e.payload || {};
          const typeLabel = String(p.artifact_type || "text").replace(/_/g, " ");
          return (
            <Card key={e.id} data-canvas-card className="p-3 col-span-full">
              <div className="flex items-center gap-2 mb-2">
                <ScrollText className="h-4 w-4 text-primary" />
                <span className="text-sm font-medium truncate flex-1" title={p.title}>{p.title || "Untitled"}</span>
                <Badge variant="outline" className="text-[10px] capitalize">{typeLabel}</Badge>
                <Badge variant="secondary" className="text-[10px]">{p.chars || (p.content?.length ?? 0)} chars</Badge>
                {p.model && <Badge variant="secondary" className="text-[10px]" title={p.model}>{modelLabel(p.model)}</Badge>}
                <span className="text-xs text-muted-foreground">{new Date(e.created_at).toLocaleTimeString()}</span>
              </div>
              {p.notes && <p className="text-xs text-muted-foreground italic mb-2">{p.notes}</p>}
              <div className="text-xs whitespace-pre-wrap font-mono bg-muted/40 rounded p-3 max-h-96 overflow-auto leading-relaxed">
                {p.content}
              </div>
              <div className="flex items-center gap-2 mt-2">
                <Button size="sm" variant="ghost" className="h-7" onClick={() => { navigator.clipboard.writeText(p.content || ""); toast.success("Copied"); }}>
                  <Copy className="h-3.5 w-3.5 mr-1" /> Copy
                </Button>
                {p.appended_to_doc && p.doc_url && (
                  <a href={p.doc_url} target="_blank" rel="noopener noreferrer" className="text-xs text-primary inline-flex items-center gap-1 ml-auto">
                    <ExternalLink className="h-3 w-3" /> Appended to doc
                  </a>
                )}
              </div>
            </Card>
          );
        }
        return null;
      })}
        </div>
      </div>
    </div>
  );
}

function InlineEditBar({ onSubmit, onCancel }: { onSubmit: (instr: string) => Promise<void> | void; onCancel: () => void }) {
  const [val, setVal] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!val.trim() || busy) return;
    setBusy(true);
    try { await onSubmit(val.trim()); } finally { setBusy(false); setVal(""); }
  };
  return (
    <div className="mt-2 flex items-center gap-1.5 bg-muted/40 rounded-lg p-1.5 border" onClick={(e) => e.stopPropagation()}>
      <Wand2 className="h-3.5 w-3.5 text-primary ml-1 shrink-0" />
      <Input
        autoFocus
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } if (e.key === "Escape") onCancel(); }}
        placeholder="Describe the change… (new offer, swap hook, brand green, etc.)"
        className="h-7 text-xs border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0"
        disabled={busy}
      />
      <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={onCancel} disabled={busy} title="Cancel">
        <X className="h-3.5 w-3.5" />
      </Button>
      <Button size="icon" className="h-7 w-7 shrink-0" onClick={submit} disabled={!val.trim() || busy} title="Send edit">
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
      </Button>
    </div>
  );
}

function InlineAnimateBar({
  defaultPrompt,
  onSubmit,
  onCancel,
}: {
  defaultPrompt?: string;
  onSubmit: (instr: string) => void;
  onCancel: () => void;
}) {
  const [val, setVal] = useState("");
  const submit = () => {
    const text = val.trim() || defaultPrompt || "Add subtle natural camera motion.";
    onSubmit(text);
    setVal("");
  };
  return (
    <div className="mt-2 flex items-center gap-1.5 bg-primary/5 rounded-lg p-1.5 border border-primary/30" onClick={(e) => e.stopPropagation()}>
      <Film className="h-3.5 w-3.5 text-primary ml-1 shrink-0" />
      <Input
        autoFocus
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } if (e.key === "Escape") onCancel(); }}
        placeholder="Describe the motion… (slow push-in, gentle parallax, product rotates, etc.)"
        className="h-7 text-xs border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0"
      />
      <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={onCancel} title="Cancel">
        <X className="h-3.5 w-3.5" />
      </Button>
      <Button size="icon" className="h-7 w-7 shrink-0" onClick={submit} title="Animate">
        <Send className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

function VariationSetCard({
  item, clientId, onUpdated,
}: {
  item: CanvasItem;
  clientId?: string;
  onUpdated?: (item: CanvasItem) => void;
}) {
  const p = item.payload || {};
  const variants: any[] = Array.isArray(p.variants) ? p.variants : [];
  const savedIndices: number[] = Array.isArray(p.saved_indices) ? p.saved_indices : [];
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [saving, setSaving] = useState(false);

  const toggle = (i: number) => {
    if (savedIndices.includes(i)) return;
    setPicked(prev => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else if (next.size + savedIndices.length < 5) next.add(i);
      else toast.error("Max 5 selected");
      return next;
    });
  };

  const save = async () => {
    if (!clientId || picked.size === 0) return;
    setSaving(true);
    try {
      const rows = Array.from(picked).map(i => {
        const v = variants[i];
        return {
          client_id: clientId,
          asset_type: "static_ad",
          title: `Variation ${i + 1}: ${(p.prompt || "").slice(0, 100)}`,
          status: "completed",
          content: {
            image_url: v.image_url,
            storage_path: v.storage_path,
            model: v.model,
            aspect_ratio: v.aspect_ratio,
            source: "ai_studio_variation",
            prompt: p.prompt,
            variant_hint: v.hint,
            variation_set_id: item.id,
            variant_index: i,
          },
        };
      });
      const { error: insErr } = await supabase.from("client_assets").insert(rows);
      if (insErr) throw insErr;

      const newSaved = [...savedIndices, ...Array.from(picked)].sort((a, b) => a - b);
      const newPayload = { ...p, saved_indices: newSaved };
      const { error: updErr } = await supabase
        .from("ai_studio_canvas_items")
        .update({ payload: newPayload })
        .eq("id", item.id);
      if (updErr) throw updErr;

      toast.success(`Saved ${picked.size} variation${picked.size > 1 ? "s" : ""} to client assets`);
      setPicked(new Set());
      onUpdated?.({ ...item, payload: newPayload });
    } catch (e: any) {
      toast.error(e?.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="p-3">
      <div className="flex items-center gap-2 mb-2">
        <ImageIcon className="h-4 w-4 text-primary" />
        <span className="text-sm font-medium">Variations</span>
        <Badge variant="outline" className="text-[10px]">{p.aspect_ratio || "1:1"}</Badge>
        <Badge variant="secondary" className="text-[10px]">{variants.length} options</Badge>
        {(p.model || variants[0]?.model) && (
          <Badge variant="secondary" className="text-[10px]" title={p.model || variants[0]?.model}>
            {modelLabel(p.model || variants[0]?.model)}
          </Badge>
        )}
        <span className="text-xs text-muted-foreground ml-auto">{new Date(item.created_at).toLocaleTimeString()}</span>
      </div>
      <p className="text-xs text-muted-foreground line-clamp-2 mb-2">{p.prompt}</p>
      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 xl:grid-cols-6 gap-2">
        {variants.map((v, i) => {
          const isSaved = savedIndices.includes(i);
          const isPicked = picked.has(i);
          return (
            <button
              key={i}
              type="button"
              onClick={() => toggle(i)}
              disabled={isSaved}
              className={`relative block rounded-md overflow-hidden border-2 transition ${
                isSaved ? "border-emerald-500 cursor-default" : isPicked ? "border-primary" : "border-transparent hover:border-muted-foreground/40"
              }`}
              title={v.hint}
            >
              <img src={v.image_url} alt={`variation ${i + 1}`} className="w-full aspect-square object-cover" loading="lazy" />
              {(isSaved || isPicked) && (
                <div className={`absolute top-1 right-1 rounded-full p-1 ${isSaved ? "bg-emerald-500" : "bg-primary"} text-white`}>
                  <Check className="h-3 w-3" />
                </div>
              )}
              {isSaved && (
                <div className="absolute bottom-1 left-1 right-1 text-[10px] text-white bg-emerald-600/80 rounded px-1 py-0.5 text-center">Saved</div>
              )}
            </button>
          );
        })}
      </div>
      <div className="flex items-center gap-2 mt-3">
        <span className="text-xs text-muted-foreground flex-1">
          {picked.size > 0
            ? `${picked.size} selected — pick 1–5 to save as client assets`
            : savedIndices.length > 0
              ? `${savedIndices.length} already saved`
              : "Click thumbnails to pick 1–5 favorites"}
        </span>
        <Button size="sm" disabled={picked.size === 0 || saving || !clientId} onClick={save}>
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Save className="h-3.5 w-3.5 mr-1" />}
          Save {picked.size || ""}
        </Button>
      </div>
    </Card>
  );
}
