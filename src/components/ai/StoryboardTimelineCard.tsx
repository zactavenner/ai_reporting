import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  Clapperboard, ChevronUp, ChevronDown, Wand2, Film, Image as ImageIcon,
  Save, Loader2, Play, RotateCw, Trash2, GripVertical, Check, Eye,
  Layers, Sparkles, Wand, ArrowRight,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { CanvasItem, CanvasEntry } from "./AIStudioCanvas";

type Scene = {
  id: string;
  order: number;
  title: string;
  image_prompt: string;
  video_prompt: string;
};

export function StoryboardTimelineCard({
  item, entries, onUpdated, onSendMessage,
}: {
  item: CanvasItem;
  entries: CanvasEntry[];
  onUpdated?: (item: CanvasItem) => void;
  onSendMessage?: (text: string) => void;
}) {
  const payload = item.payload || {};
  const storyboardId: string = payload.storyboard_id || item.id;
  const aspectRatio: string = payload.aspect_ratio || "9:16";
  const brief: string = payload.brief || "";

  const [scenes, setScenes] = useState<Scene[]>(() =>
    (Array.isArray(payload.scenes) ? payload.scenes : []).map((s: any, i: number) => ({
      id: s.id || `${storyboardId}-s${i + 1}`,
      order: s.order ?? i + 1,
      title: s.title || `Scene ${i + 1}`,
      image_prompt: s.image_prompt || "",
      video_prompt: s.video_prompt || "",
    }))
  );
  const [expanded, setExpanded] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [polishing, setPolishing] = useState(false);
  const [previewSceneId, setPreviewSceneId] = useState<string | null>(null);
  const [previewMode, setPreviewMode] = useState<"video" | "image">("video");

  // Index sibling scene_image / scene_video entries by (storyboard_id, scene_id)
  const sceneMedia = useMemo(() => {
    const imgs: Record<string, { url: string; order: number }> = {};
    const vids: Record<string, { url: string; order: number }> = {};
    for (const e of entries) {
      if ("__placeholder" in e) continue;
      const p = e.payload || {};
      if (p.storyboard_id !== storyboardId) continue;
      if (e.kind === "scene_image" && p.image_url && p.scene_id) {
        // Keep latest (entries iterated newest→oldest in canvas; pick first occurrence)
        if (!imgs[p.scene_id]) imgs[p.scene_id] = { url: p.image_url, order: p.scene_order || 0 };
      }
      if (e.kind === "scene_video" && p.video_url && p.scene_id) {
        if (!vids[p.scene_id]) vids[p.scene_id] = { url: p.video_url, order: p.scene_order || 0 };
      }
    }
    return { imgs, vids };
  }, [entries, storyboardId]);

  const totalSec = scenes.length * 8;
  const dirty = useMemo(() => {
    const orig = Array.isArray(payload.scenes) ? payload.scenes : [];
    if (orig.length !== scenes.length) return true;
    return scenes.some((s, i) => {
      const o = orig[i] || {};
      return s.id !== o.id || s.title !== o.title || s.image_prompt !== o.image_prompt || s.video_prompt !== o.video_prompt;
    });
  }, [scenes, payload.scenes]);

  const move = (idx: number, dir: -1 | 1) => {
    const j = idx + dir;
    if (j < 0 || j >= scenes.length) return;
    const next = scenes.slice();
    [next[idx], next[j]] = [next[j], next[idx]];
    setScenes(next.map((s, i) => ({ ...s, order: i + 1 })));
  };

  const remove = (idx: number) => {
    if (scenes.length <= 1) { toast.error("Storyboard needs at least one scene"); return; }
    const next = scenes.filter((_, i) => i !== idx).map((s, i) => ({ ...s, order: i + 1 }));
    setScenes(next);
  };

  const updateField = (idx: number, key: keyof Scene, value: string) => {
    setScenes(curr => curr.map((s, i) => (i === idx ? { ...s, [key]: value } : s)));
  };

  const persist = async () => {
    setSaving(true);
    try {
      const newPayload = { ...payload, scenes };
      const { error } = await supabase
        .from("ai_studio_canvas_items")
        .update({ payload: newPayload })
        .eq("id", item.id);
      if (error) throw error;
      toast.success("Storyboard saved");
      onUpdated?.({ ...item, payload: newPayload });
    } catch (e: any) {
      toast.error(e?.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const regenerateKeyframe = (s: Scene) => {
    if (!onSendMessage) return;
    const msg =
      `Regenerate the keyframe for storyboard ${storyboardId}, scene ${s.id} (#${s.order} "${s.title}").\n` +
      `Use this image_prompt: ${s.image_prompt}\n` +
      `Aspect ratio: ${aspectRatio}. Call generate_scene_image.`;
    onSendMessage(msg);
  };

  const generateAllVideos = async () => {
    if (!onSendMessage) return;
    // Make sure scenes are saved first so the agent sees the finalized order/prompts.
    if (dirty) await persist();
    setGenerating(true);
    try {
      const missing = scenes.filter(s => !sceneMedia.imgs[s.id]);
      if (missing.length > 0) {
        toast.error(`Generate keyframes for ${missing.length} scene${missing.length > 1 ? "s" : ""} first`);
        setGenerating(false);
        return;
      }
      const sceneList = scenes.map(s => {
        const img = sceneMedia.imgs[s.id];
        return `- Scene #${s.order} (id: ${s.id}, title: "${s.title}")\n  image_url: ${img.url}\n  video_prompt: ${s.video_prompt}`;
      }).join("\n");
      const msg =
        `Finalized storyboard ${storyboardId} (${aspectRatio}, ${scenes.length} scenes). Generate all scene videos now — emit one generate_scene_video tool_call per scene in parallel using the listed image_url, scene_id, scene_order, video_prompt, and aspect_ratio ${aspectRatio}. Do not re-plan or re-render keyframes.\n\n${sceneList}`;
      onSendMessage(msg);
    } finally {
      setGenerating(false);
    }
  };

  const previewScene = previewSceneId ? scenes.find(s => s.id === previewSceneId) || null : null;
  const previewImg = previewScene ? sceneMedia.imgs[previewScene.id] : undefined;
  const previewVid = previewScene ? sceneMedia.vids[previewScene.id] : undefined;
  const previewAr = aspectRatio === "9:16" ? "aspect-[9/16]" : aspectRatio === "16:9" ? "aspect-video" : "aspect-square";
  const previewIdx = previewScene ? scenes.findIndex(s => s.id === previewScene.id) : -1;
  const goPreview = (dir: -1 | 1) => {
    if (previewIdx < 0) return;
    const next = scenes[previewIdx + dir];
    if (next) {
      setPreviewSceneId(next.id);
      setPreviewMode(sceneMedia.vids[next.id] ? "video" : "image");
    }
  };

  return (
    <Card data-canvas-card className="p-3">
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <Clapperboard className="h-4 w-4 text-primary" />
        <span className="text-sm font-medium">Storyboard timeline</span>
        <Badge variant="outline" className="text-[10px]">{aspectRatio}</Badge>
        <Badge variant="secondary" className="text-[10px]">{scenes.length} scenes · ~{totalSec}s</Badge>
        {dirty && <Badge variant="destructive" className="text-[10px]">unsaved edits</Badge>}
        <span className="text-xs text-muted-foreground ml-auto">{new Date(item.created_at).toLocaleTimeString()}</span>
      </div>
      {brief && <p className="text-xs text-muted-foreground line-clamp-2 mb-3">{brief}</p>}

      {/* Timeline strip */}
      <div className="flex gap-2 overflow-x-auto pb-2 mb-3">
        {scenes.map((s, idx) => {
          const img = sceneMedia.imgs[s.id];
          const vid = sceneMedia.vids[s.id];
          const isOpen = expanded === s.id;
          const ar = aspectRatio === "9:16" ? "aspect-[9/16]" : aspectRatio === "16:9" ? "aspect-video" : "aspect-square";
          return (
            <div
              key={s.id}
              className={`relative shrink-0 w-28 rounded-md border text-left transition ${isOpen ? "border-primary ring-1 ring-primary" : "border-border hover:border-muted-foreground/50"}`}
              title={s.title}
            >
              <button
                type="button"
                onClick={() => setExpanded(isOpen ? null : s.id)}
                className="block w-full text-left"
              >
              <div className={`relative w-full ${ar} bg-muted overflow-hidden rounded-t-md`}>
                {vid ? (
                  <video src={vid.url} muted playsInline className="absolute inset-0 w-full h-full object-cover" />
                ) : img ? (
                  <img src={img.url} alt={s.title} className="absolute inset-0 w-full h-full object-cover" loading="lazy" />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center text-[10px] text-muted-foreground">
                    <ImageIcon className="h-4 w-4" />
                  </div>
                )}
                {vid && (
                  <div className="absolute top-1 right-1 bg-background/80 rounded px-1 py-0.5 text-[9px] flex items-center gap-0.5">
                    <Film className="h-2.5 w-2.5" /> 8s
                  </div>
                )}
                <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent px-1.5 py-1">
                  <div className="text-[10px] text-white font-medium leading-tight">#{s.order}</div>
                </div>
              </div>
              <div className="p-1.5">
                <div className="text-[10px] font-medium truncate">{s.title}</div>
                <div className="text-[9px] text-muted-foreground truncate">{img ? (vid ? "video ready" : "keyframe ready") : "pending"}</div>
              </div>
              </button>
              {(img || vid) && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setPreviewSceneId(s.id);
                    setPreviewMode(vid ? "video" : "image");
                  }}
                  className="absolute top-1 left-1 bg-background/85 hover:bg-background rounded p-1 shadow-sm"
                  title="Preview scene"
                >
                  <Eye className="h-3 w-3" />
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Scene rows (editor) */}
      <div className="space-y-1.5">
        {scenes.map((s, idx) => {
          const isOpen = expanded === s.id;
          const img = sceneMedia.imgs[s.id];
          return (
            <div key={s.id} className="rounded-md border bg-background/40">
              <div className="flex items-center gap-1.5 px-2 py-1.5">
                <GripVertical className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <Badge variant="outline" className="text-[10px] shrink-0">#{s.order}</Badge>
                <Input
                  value={s.title}
                  onChange={(e) => updateField(idx, "title", e.target.value)}
                  className="h-7 text-xs flex-1"
                  placeholder="Scene title"
                />
                <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => move(idx, -1)} disabled={idx === 0} title="Move up">
                  <ChevronUp className="h-3 w-3" />
                </Button>
                <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => move(idx, 1)} disabled={idx === scenes.length - 1} title="Move down">
                  <ChevronDown className="h-3 w-3" />
                </Button>
                <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setExpanded(isOpen ? null : s.id)} title="Edit prompts">
                  <Wand2 className="h-3 w-3" />
                </Button>
                <Button size="icon" variant="ghost" className="h-6 w-6 text-destructive" onClick={() => remove(idx)} title="Remove">
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
              {isOpen && (
                <div className="px-2 pb-2 space-y-2 border-t">
                  <div>
                    <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Image prompt (keyframe)</label>
                    <Textarea
                      value={s.image_prompt}
                      onChange={(e) => updateField(idx, "image_prompt", e.target.value)}
                      className="text-xs min-h-[60px] mt-1"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Video prompt (motion)</label>
                    <Textarea
                      value={s.video_prompt}
                      onChange={(e) => updateField(idx, "video_prompt", e.target.value)}
                      className="text-xs min-h-[50px] mt-1"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      onClick={() => regenerateKeyframe(s)}
                      disabled={!onSendMessage}
                    >
                      <RotateCw className="h-3 w-3 mr-1" />
                      {img ? "Regenerate keyframe" : "Generate keyframe"}
                    </Button>
                    {(img || sceneMedia.vids[s.id]) && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        onClick={() => {
                          setPreviewSceneId(s.id);
                          setPreviewMode(sceneMedia.vids[s.id] ? "video" : "image");
                        }}
                      >
                        <Eye className="h-3 w-3 mr-1" />
                        Preview
                      </Button>
                    )}
                    {img && (
                      <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                        <Check className="h-3 w-3 text-emerald-500" /> keyframe ready
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Footer actions */}
      <div className="flex items-center gap-2 mt-3 pt-3 border-t">
        <Button size="sm" variant="outline" onClick={persist} disabled={saving || !dirty}>
          {saving ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1" />}
          Save storyboard
        </Button>
        <div className="flex-1" />
        <span className="text-[10px] text-muted-foreground">
          {Object.keys(sceneMedia.imgs).length}/{scenes.length} keyframes · {Object.keys(sceneMedia.vids).length}/{scenes.length} videos
        </span>
        <Button size="sm" onClick={generateAllVideos} disabled={generating || !onSendMessage}>
          {generating ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Play className="h-3.5 w-3.5 mr-1" />}
          Generate videos
        </Button>
      </div>

      <Dialog open={!!previewScene} onOpenChange={(o) => !o && setPreviewSceneId(null)}>
        <DialogContent className="max-w-3xl">
          {previewScene && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Badge variant="outline" className="text-[10px]">#{previewScene.order}</Badge>
                  {previewScene.title}
                  <Badge variant="secondary" className="text-[10px] ml-auto">{aspectRatio}</Badge>
                </DialogTitle>
                <DialogDescription className="text-xs">
                  Preview the keyframe and 8s video before finalizing the storyboard.
                </DialogDescription>
              </DialogHeader>

              <div className="flex items-center gap-1 -mt-1">
                <Button
                  size="sm"
                  variant={previewMode === "video" ? "default" : "outline"}
                  className="h-7 text-xs"
                  onClick={() => setPreviewMode("video")}
                  disabled={!previewVid}
                >
                  <Film className="h-3 w-3 mr-1" /> Video {!previewVid && "(not generated)"}
                </Button>
                <Button
                  size="sm"
                  variant={previewMode === "image" ? "default" : "outline"}
                  className="h-7 text-xs"
                  onClick={() => setPreviewMode("image")}
                  disabled={!previewImg}
                >
                  <ImageIcon className="h-3 w-3 mr-1" /> Keyframe
                </Button>
                <div className="flex-1" />
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => goPreview(-1)} disabled={previewIdx <= 0}>
                  <ChevronUp className="h-3 w-3 rotate-[-90deg]" /> Prev
                </Button>
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => goPreview(1)} disabled={previewIdx >= scenes.length - 1}>
                  Next <ChevronDown className="h-3 w-3 rotate-[-90deg]" />
                </Button>
              </div>

              <div className={`relative w-full ${previewAr} bg-black rounded-md overflow-hidden max-h-[70vh] mx-auto`} style={{ maxWidth: aspectRatio === "9:16" ? "360px" : aspectRatio === "1:1" ? "560px" : "100%" }}>
                {previewMode === "video" && previewVid ? (
                  <video
                    key={previewVid.url}
                    src={previewVid.url}
                    controls
                    autoPlay
                    loop
                    playsInline
                    className="absolute inset-0 w-full h-full object-contain bg-black"
                  />
                ) : previewImg ? (
                  <img src={previewImg.url} alt={previewScene.title} className="absolute inset-0 w-full h-full object-contain" />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
                    No media yet
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                <div>
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Image prompt</div>
                  <p className="text-xs text-foreground/80 whitespace-pre-wrap">{previewScene.image_prompt || "—"}</p>
                </div>
                <div>
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Video prompt</div>
                  <p className="text-xs text-foreground/80 whitespace-pre-wrap">{previewScene.video_prompt || "—"}</p>
                </div>
              </div>

              <div className="flex items-center gap-2 pt-2 border-t">
                <Button size="sm" variant="outline" onClick={() => regenerateKeyframe(previewScene)} disabled={!onSendMessage}>
                  <RotateCw className="h-3.5 w-3.5 mr-1" />
                  Regenerate keyframe
                </Button>
                <div className="flex-1" />
                <Button size="sm" variant="ghost" onClick={() => setPreviewSceneId(null)}>Close</Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}