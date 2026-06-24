import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, Film } from "lucide-react";
import { toast } from "sonner";

export type BatchScriptDraft = {
  title: string;
  voiceover: string;
  environment: string;
  target_duration_s?: number;
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  hasAvatar: boolean;
  avatarName?: string | null;
  defaultModel: string;
  onSubmit: (payload: {
    scripts: BatchScriptDraft[];
    model: string;
    aspect_ratio: "9:16" | "1:1" | "16:9";
    resolution: "720p" | "1080p" | "4k";
    use_avatar: boolean;
    force_seedance: boolean;
  }) => void;
}

const MODEL_OPTIONS: { id: string; label: string; perClipCap: number; avatarSafe: boolean }[] = [
  { id: "google/veo-3.1-fast",        label: "Veo 3.1 Fast — 8s/clip (avatar-safe)", perClipCap: 8,  avatarSafe: true },
  { id: "bytedance/seedance-2.0",     label: "Seedance 2.0 Pro — 15s/clip, 4K",       perClipCap: 15, avatarSafe: false },
  { id: "bytedance/seedance-2.0-fast",label: "Seedance Fast — 15s/clip, 720p",        perClipCap: 15, avatarSafe: false },
  { id: "kwaivgi/kling-v3.0-std",     label: "Kling 3.0 — 10s/clip",                   perClipCap: 10, avatarSafe: true },
];

export function BatchScriptsDialog({ open, onOpenChange, hasAvatar, avatarName, defaultModel, onSubmit }: Props) {
  const [scripts, setScripts] = useState<BatchScriptDraft[]>([
    { title: "Script 1", voiceover: "", environment: "", target_duration_s: undefined },
  ]);
  const [model, setModel] = useState<string>(defaultModel || "bytedance/seedance-2.0");
  const [aspect, setAspect] = useState<"9:16" | "1:1" | "16:9">("9:16");
  const [resolution, setResolution] = useState<"720p" | "1080p" | "4k">("1080p");
  const [useAvatar, setUseAvatar] = useState(true);
  const [forceSeedance, setForceSeedance] = useState(false);

  const addScript = () => setScripts(s => [...s, { title: `Script ${s.length + 1}`, voiceover: "", environment: "", target_duration_s: undefined }]);
  const removeScript = (i: number) => setScripts(s => s.filter((_, idx) => idx !== i));
  const updateScript = (i: number, patch: Partial<BatchScriptDraft>) => setScripts(s => s.map((x, idx) => idx === i ? { ...x, ...patch } : x));

  const modelMeta = MODEL_OPTIONS.find(m => m.id === model);
  const effectiveModelForAvatar = (hasAvatar && useAvatar && !forceSeedance && !modelMeta?.avatarSafe)
    ? "google/veo-3.1-fast"
    : model;
  const effectiveCap = MODEL_OPTIONS.find(m => m.id === effectiveModelForAvatar)?.perClipCap || 15;

  const handleSubmit = () => {
    const cleaned = scripts.filter(s => s.voiceover.trim().length > 0);
    if (!cleaned.length) {
      toast.error("Add at least one script with voiceover text.");
      return;
    }
    onSubmit({
      scripts: cleaned,
      model,
      aspect_ratio: aspect,
      resolution,
      use_avatar: useAvatar && hasAvatar,
      force_seedance: forceSeedance,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Film className="h-5 w-5" /> Batch render multiple scripts</DialogTitle>
          <DialogDescription>
            Paste 1–12 scripts. Each one auto-splits into clips that fit the model's per-clip cap and renders in parallel. Closing the tab is fine — they keep running.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-3 gap-3 py-2">
          <div>
            <Label className="text-xs">Model</Label>
            <Select value={model} onValueChange={setModel}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                {MODEL_OPTIONS.map(m => <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Aspect</Label>
            <Select value={aspect} onValueChange={(v) => setAspect(v as any)}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="9:16">9:16 (Reel)</SelectItem>
                <SelectItem value="1:1">1:1 (Square)</SelectItem>
                <SelectItem value="16:9">16:9 (Landscape)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Resolution</Label>
            <Select value={resolution} onValueChange={(v) => setResolution(v as any)}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="720p">720p</SelectItem>
                <SelectItem value="1080p">1080p</SelectItem>
                <SelectItem value="4k">4K (Seedance Pro only)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {hasAvatar && (
          <div className="rounded-lg border border-border/60 bg-muted/30 p-3 text-xs space-y-2">
            <div className="flex items-center justify-between">
              <span>Avatar selected: <strong>{avatarName || "Yes"}</strong> — apply to every script?</span>
              <input type="checkbox" checked={useAvatar} onChange={e => setUseAvatar(e.target.checked)} />
            </div>
            {useAvatar && !modelMeta?.avatarSafe && (
              <div className="text-amber-600 dark:text-amber-400">
                {forceSeedance
                  ? "⚠ Forcing Seedance with an avatar will likely fail (Seedance rejects synthetic faces)."
                  : `Avatar scripts will auto-route to Veo 3.1 Fast (8s per clip). Cap ${effectiveCap}s per clip.`}
              </div>
            )}
            {useAvatar && (
              <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <input type="checkbox" checked={forceSeedance} onChange={e => setForceSeedance(e.target.checked)} />
                Force {modelMeta?.label || model} anyway (advanced)
              </label>
            )}
          </div>
        )}

        <div className="space-y-3 pt-2">
          {scripts.map((s, i) => {
            const wc = s.voiceover.trim().split(/\s+/).filter(Boolean).length;
            const estDur = s.target_duration_s ?? Math.max(8, Math.ceil(wc / 2.4));
            const clips = Math.max(1, Math.ceil(estDur / effectiveCap));
            return (
              <div key={i} className="rounded-lg border border-border/60 p-3 space-y-2 bg-card">
                <div className="flex items-center justify-between gap-2">
                  <Input
                    value={s.title}
                    onChange={e => updateScript(i, { title: e.target.value })}
                    placeholder={`Script ${i + 1} title`}
                    className="h-8 text-sm flex-1"
                  />
                  <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                    {wc} words ≈ {estDur}s → {clips} clip{clips === 1 ? "" : "s"}
                  </span>
                  {scripts.length > 1 && (
                    <Button size="icon" variant="ghost" onClick={() => removeScript(i)} className="h-8 w-8">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
                <Input
                  value={s.environment}
                  onChange={e => updateScript(i, { environment: e.target.value })}
                  placeholder="Environment / scene (e.g. Walking through a luxury RV resort)"
                  className="h-8 text-xs"
                />
                <Textarea
                  value={s.voiceover}
                  onChange={e => updateScript(i, { voiceover: e.target.value })}
                  placeholder="Paste the full voiceover / on-camera dialogue exactly as it should be spoken…"
                  rows={5}
                  className="text-xs resize-y"
                />
                <div className="flex items-center gap-2">
                  <Label className="text-[10px] text-muted-foreground">Override total seconds (optional):</Label>
                  <Input
                    type="number"
                    min={4}
                    max={120}
                    value={s.target_duration_s ?? ""}
                    onChange={e => updateScript(i, { target_duration_s: e.target.value ? Number(e.target.value) : undefined })}
                    className="h-7 text-xs w-24"
                    placeholder="auto"
                  />
                </div>
              </div>
            );
          })}
          <Button variant="outline" size="sm" onClick={addScript} disabled={scripts.length >= 12} className="w-full">
            <Plus className="h-4 w-4 mr-1" /> Add another script ({scripts.length}/12)
          </Button>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSubmit}>
            <Film className="h-4 w-4 mr-1" /> Render {scripts.filter(s => s.voiceover.trim()).length} script{scripts.filter(s => s.voiceover.trim()).length === 1 ? "" : "s"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}