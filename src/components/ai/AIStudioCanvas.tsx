import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, Copy, ExternalLink, FileText, Table as TableIcon, Image as ImageIcon, AlertCircle, Wand2, Check, Save, Film, Clapperboard, ScrollText } from "lucide-react";
import { toast } from "sonner";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";

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
  entries, onEditImage, clientId, onCanvasItemUpdated,
}: {
  entries: CanvasEntry[];
  onEditImage?: (imageUrl: string, aspectRatio: string) => void;
  clientId?: string;
  onCanvasItemUpdated?: (item: CanvasItem) => void;
}) {
  if (entries.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-muted-foreground p-8 text-center">
        The AI builds here. Ask it to generate an ad creative or edit your doc/sheet — results appear as cards on this canvas.
      </div>
    );
  }
  return (
    <div className="p-4 space-y-3 overflow-auto h-full">
      {entries.map((e, i) => {
        if ("__placeholder" in e) {
          return (
            <Card key={`ph-${e.placeholder_id}`} className="p-4 border-dashed">
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
          return (
            <Card key={e.id} className="p-3 overflow-hidden">
              <div className="flex items-center gap-2 mb-2">
                <ImageIcon className="h-4 w-4 text-primary" />
                <Badge variant="outline" className="text-[10px]">{p.aspect_ratio || "1:1"}</Badge>
                <Badge variant="secondary" className="text-[10px] truncate max-w-[180px]" title={p.model}>
                  {p.model?.includes("pro") ? "Gemini 3 Pro" : p.model?.includes("flash") ? "Nano Banana 2" : (p.model || "image")}
                </Badge>
                <span className="text-xs text-muted-foreground ml-auto">{new Date(e.created_at).toLocaleTimeString()}</span>
              </div>
              {p.image_url && (
                <a href={p.image_url} target="_blank" rel="noopener noreferrer" className="block">
                  <img src={p.image_url} alt={p.prompt || "ad creative"} className="w-full rounded-md border" loading="lazy" />
                </a>
              )}
              <div className="flex items-start gap-2 mt-2">
                <p className="text-xs text-muted-foreground line-clamp-2 flex-1">{p.prompt}</p>
                {p.image_url && (
                  <>
                    {onEditImage && (
                      <Button size="icon" variant="ghost" className="h-7 w-7" title="Edit (offer / hook / colors / disclaimer)"
                        onClick={() => onEditImage(p.image_url, p.aspect_ratio || "1:1")}>
                        <Wand2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    <Button size="icon" variant="ghost" className="h-7 w-7" title="Copy URL"
                      onClick={() => { navigator.clipboard.writeText(p.image_url); toast.success("URL copied"); }}>
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7" title="Open" asChild>
                      <a href={p.image_url} target="_blank" rel="noopener noreferrer">
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
            <Card key={e.id} className="p-3">
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
            <Card key={e.id} className="p-3">
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
          const p = e.payload || {};
          const scenes: any[] = Array.isArray(p.scenes) ? p.scenes : [];
          return (
            <Card key={e.id} className="p-3">
              <div className="flex items-center gap-2 mb-2">
                <Clapperboard className="h-4 w-4 text-primary" />
                <span className="text-sm font-medium">Storyboard</span>
                <Badge variant="outline" className="text-[10px]">{p.aspect_ratio || "9:16"}</Badge>
                <Badge variant="secondary" className="text-[10px]">{scenes.length} scenes</Badge>
                <span className="text-xs text-muted-foreground ml-auto">{new Date(e.created_at).toLocaleTimeString()}</span>
              </div>
              <p className="text-xs text-muted-foreground line-clamp-2 mb-2">{p.brief}</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {scenes.map((s: any) => (
                  <div key={s.id} className="rounded-md border p-2 text-xs">
                    <div className="font-medium text-[11px] mb-1">#{s.order} {s.title}</div>
                    <div className="text-muted-foreground line-clamp-3 text-[10px]">{s.image_prompt}</div>
                  </div>
                ))}
              </div>
            </Card>
          );
        }
        if (e.kind === "scene_image") {
          const p = e.payload || {};
          return (
            <Card key={e.id} className="p-3">
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
          return (
            <Card key={e.id} className="p-3">
              <div className="flex items-center gap-2 mb-2">
                <Film className="h-4 w-4 text-primary" />
                <Badge variant="outline" className="text-[10px]">Scene {p.scene_order}</Badge>
                <Badge variant="secondary" className="text-[10px]">{p.aspect_ratio}</Badge>
                <Badge variant="secondary" className="text-[10px]">Veo 3.1</Badge>
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
        return null;
      })}
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
