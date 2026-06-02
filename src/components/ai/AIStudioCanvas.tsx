import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Copy, ExternalLink, FileText, Table as TableIcon, Image as ImageIcon, AlertCircle, Wand2, Check, Save, Film, Clapperboard, ScrollText, Plus, Minus, Maximize2, Send, X } from "lucide-react";
import { toast } from "sonner";
import { useState, useRef, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { StoryboardTimelineCard } from "./StoryboardTimelineCard";

export type CanvasPlaceholder = {
  __placeholder: true;
  placeholder_id: string;
  kind: "image";
  prompt: string;
  aspect_ratio: string;
  quality: string;
  failed?: string;
};
export type CanvasItem = {
  id: string;
  kind: "image" | "doc_edit" | "sheet_edit" | "variation_set" | "storyboard" | "scene_image" | "scene_video" | "text_artifact";
  payload: any;
  created_at: string;
};
export type CanvasEntry = CanvasItem | CanvasPlaceholder;

export function AIStudioCanvas({
  entries, onEditImage, onInlineEdit, clientId, onCanvasItemUpdated, onSendMessage,
  initialView, focusedItemId, onViewChange, onFocusItem,
}: {
  entries: CanvasEntry[];
  onEditImage?: (imageUrl: string, aspectRatio: string) => void;
  onInlineEdit?: (imageUrl: string, aspectRatio: string, instruction: string) => Promise<void> | void;
  clientId?: string;
  onCanvasItemUpdated?: (item: CanvasItem) => void;
  onSendMessage?: (text: string) => void;
  initialView?: { zoom?: number; panX?: number; panY?: number } | null;
  focusedItemId?: string | null;
  onViewChange?: (view: { zoom: number; panX: number; panY: number }) => void;
  onFocusItem?: (itemId: string | null) => void;
}) {
  const [zoom, setZoom] = useState(initialView?.zoom ?? 1);
  const [pan, setPan] = useState({ x: initialView?.panX ?? 0, y: initialView?.panY ?? 0 });
  const [editingId, setEditingId] = useState<string | null>(null);
  const draggingRef = useRef<{ x: number; y: number } | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const focusScrolledRef = useRef<string | null>(null);

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

  if (entries.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-muted-foreground p-8 text-center">
        The AI builds here. Ask it to generate an ad creative or edit your doc/sheet — results appear as cards on this canvas. Click any image to edit it inline.
      </div>
    );
  }

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
      <div className="flex items-center gap-1 px-2 py-1 border-b bg-muted/30">
        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setZoom(z => Math.max(0.25, z * 0.9))} title="Zoom out">
          <Minus className="h-3.5 w-3.5" />
        </Button>
        <button onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }} className="text-xs tabular-nums w-14 text-center hover:bg-muted rounded px-1 py-0.5" title="Reset">
          {Math.round(zoom * 100)}%
        </button>
        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setZoom(z => Math.min(3, z * 1.1))} title="Zoom in">
          <Plus className="h-3.5 w-3.5" />
        </Button>
        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }} title="Fit">
          <Maximize2 className="h-3.5 w-3.5" />
        </Button>
        <span className="text-[10px] text-muted-foreground ml-2">Ctrl/⌘+wheel to zoom · drag empty area to pan · click image to edit</span>
      </div>
      <div
        ref={viewportRef}
        className="flex-1 overflow-auto bg-muted/10 cursor-grab active:cursor-grabbing"
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={stopDrag}
        onMouseLeave={stopDrag}
        onWheel={onWheel}
      >
        <div
          className="p-4 space-y-3 origin-top-left transition-transform duration-75"
          style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: "0 0", width: "100%" }}
        >
      {entries.map((e, i) => {
        if ("__placeholder" in e) {
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
                    <span className="text-xs text-muted-foreground">{e.failed ? "failed" : "building on canvas…"}</span>
                  </div>
                  <p className="text-sm line-clamp-2">{e.prompt}</p>
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
                  {p.model?.includes("pro") ? "Gemini 3 Pro" : p.model?.includes("flash") ? "Nano Banana 2" : (p.model || "image")}
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
              <div className="flex items-start gap-2 mt-2">
                <p className="text-xs text-muted-foreground line-clamp-2 flex-1">{p.prompt}</p>
                {p.image_url && (
                  <>
                    {onEditImage && (
                      <Button size="icon" variant="ghost" className="h-7 w-7" title="Edit (offer / hook / colors / disclaimer)"
                        onClick={(ev) => { ev.stopPropagation(); onEditImage(p.image_url, p.aspect_ratio || "1:1"); }}>
                        <Wand2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    {onSendMessage && (
                      <Button size="icon" variant="ghost" className="h-7 w-7" title="Animate with Seedance 2.0 (image→video, 15s 1080p)"
                        onClick={(ev) => {
                          ev.stopPropagation();
                          onSendMessage(`Animate this image into a 15-second 1080p cinematic clip using Seedance 2.0 image-to-video. Keep the subject, brand colors, and composition consistent. Add subtle natural camera motion and lighting. image_url: ${p.image_url} aspect_ratio: ${p.aspect_ratio || "1:1"}`);
                          toast.success("Sending to Seedance 2.0…");
                        }}>
                        <Film className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    <Button size="icon" variant="ghost" className="h-7 w-7" title="Copy URL"
                      onClick={(ev) => { ev.stopPropagation(); navigator.clipboard.writeText(p.image_url); toast.success("URL copied"); }}>
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7" title="Open" asChild>
                      <a href={p.image_url} target="_blank" rel="noopener noreferrer" onClick={ev => ev.stopPropagation()}>
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    </Button>
                  </>
                )}
                {p.parent_image_url && (
                  <Badge variant="outline" className="text-[10px] mt-1">revision</Badge>
                )}
              </div>
            </Card>
          );
        }
        if (e.kind === "doc_edit") {
          const p = e.payload || {};
          return (
            <Card key={e.id} data-canvas-card className="p-3">
              <div className="flex items-center gap-2 mb-1">
                <FileText className="h-4 w-4 text-primary" />
                <span className="text-sm font-medium">Doc {p.action === "replace" ? "find & replace" : "append"}</span>
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
            <Card key={e.id} data-canvas-card className="p-3">
              <div className="flex items-center gap-2 mb-1">
                <TableIcon className="h-4 w-4 text-primary" />
                <span className="text-sm font-medium">Sheet {p.action === "append" ? "row append" : "range update"}</span>
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
          return <VariationSetCard key={e.id} item={e} clientId={clientId} onUpdated={onCanvasItemUpdated} />;
        }
        if (e.kind === "storyboard") {
          return (
            <StoryboardTimelineCard
              key={e.id}
              item={e}
              entries={entries}
              onUpdated={onCanvasItemUpdated}
              onSendMessage={onSendMessage}
            />
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
          const modelLabel = p.model?.includes("seedance")
            ? (p.model.includes("fast") ? "Seedance 2.0 Fast" : "Seedance 2.0")
            : (p.model?.includes("veo") ? "Veo 3.1" : (p.model || "Video"));
          const showSceneBadge = typeof p.scene_order === "number" && !p.model?.includes("seedance");
          return (
            <Card key={e.id} data-canvas-card className="p-3">
              <div className="flex items-center gap-2 mb-2">
                <Film className="h-4 w-4 text-primary" />
                {showSceneBadge && <Badge variant="outline" className="text-[10px]">Scene {p.scene_order}</Badge>}
                {p.mode && <Badge variant="outline" className="text-[10px] capitalize">{String(p.mode).replace(/_/g, "→")}</Badge>}
                <Badge variant="secondary" className="text-[10px]">{p.aspect_ratio}</Badge>
                <Badge variant="secondary" className="text-[10px]">{modelLabel}</Badge>
                {p.resolution && <Badge variant="secondary" className="text-[10px]">{p.resolution}</Badge>}
                <span className="text-xs text-muted-foreground ml-auto">{p.duration || 5}s</span>
              </div>
              {p.video_url && (
                <video src={p.video_url} controls playsInline className="w-full rounded-md border bg-black" />
              )}
              <div className="flex items-center gap-2 mt-2">
                <p className="text-[10px] text-muted-foreground line-clamp-2 flex-1">{p.video_prompt}</p>
                {p.video_url && (
                  <Button size="icon" variant="ghost" className="h-7 w-7" title="Copy URL"
                    onClick={() => { navigator.clipboard.writeText(p.video_url); toast.success("URL copied"); }}>
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            </Card>
          );
        }
        if (e.kind === "text_artifact") {
          const p = e.payload || {};
          const typeLabel = String(p.artifact_type || "text").replace(/_/g, " ");
          return (
            <Card key={e.id} data-canvas-card className="p-3">
              <div className="flex items-center gap-2 mb-2">
                <ScrollText className="h-4 w-4 text-primary" />
                <span className="text-sm font-medium truncate flex-1" title={p.title}>{p.title || "Untitled"}</span>
                <Badge variant="outline" className="text-[10px] capitalize">{typeLabel}</Badge>
                <Badge variant="secondary" className="text-[10px]">{p.chars || (p.content?.length ?? 0)} chars</Badge>
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
        <span className="text-xs text-muted-foreground ml-auto">{new Date(item.created_at).toLocaleTimeString()}</span>
      </div>
      <p className="text-xs text-muted-foreground line-clamp-2 mb-2">{p.prompt}</p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
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
