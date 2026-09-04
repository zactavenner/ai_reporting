import { useEffect, useState } from "react";
import { Check, ChevronDown, ChevronUp, Clapperboard, Loader2, User2, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { VIDEO_STYLE_PRESETS } from "@/lib/videoStylePresets";

export const VIDEO_STEPS = [
  { id: 1, label: "Pick styles" },
  { id: 2, label: "Avatar (optional)" },
  { id: 3, label: "Script & prompt" },
  { id: 4, label: "Produce & deliver" },
] as const;

const ASPECT_CLASS: Record<string, string> = {
  "9:16": "aspect-[9/16]",
  "1:1": "aspect-square",
  "16:9": "aspect-video",
};

type Props = {
  aspect: string;
  selectedPresetIds: string[];
  onTogglePreset: (id: string) => void;
  onGenerateScripts: () => void;
  generating?: boolean;
  avatarName?: string | null;
  onOpenAvatars: () => void;
  produce: boolean;
  onSetProduce: (produce: boolean) => void;
  summary: { model: string; resolution: string; seconds: number; cost?: string | null };
  hasFirstFrame?: boolean;
  referenceCount?: number;
};

const STEP_KEY = "ai-studio:video-step";
const OPEN_KEY = "ai-studio:video-line-open";

/**
 * Production line for the Video Ads agent: pick reference styles from a
 * hover-preview gallery, optionally cast an avatar, generate scripts in chat,
 * then flip to Produce to render with the locked composer settings.
 */
export function VideoProductionLine({
  aspect,
  selectedPresetIds,
  onTogglePreset,
  onGenerateScripts,
  generating,
  avatarName,
  onOpenAvatars,
  produce,
  onSetProduce,
  summary,
  hasFirstFrame,
  referenceCount = 0,
}: Props) {
  const [step, setStep] = useState<number>(() => {
    const v = parseInt(localStorage.getItem(STEP_KEY) || "", 10);
    return v >= 1 && v <= 4 ? v : 1;
  });
  const [open, setOpen] = useState<boolean>(() => localStorage.getItem(OPEN_KEY) !== "0");

  useEffect(() => {
    try { localStorage.setItem(STEP_KEY, String(step)); } catch { /* ignore */ }
  }, [step]);
  useEffect(() => {
    try { localStorage.setItem(OPEN_KEY, open ? "1" : "0"); } catch { /* ignore */ }
  }, [open]);

  const count = selectedPresetIds.length;

  return (
    <div className="border-b border-border/60 bg-muted/20">
      {/* Step rail */}
      <div className="flex items-center gap-2 overflow-x-auto px-4 sm:px-6 py-2">
        {VIDEO_STEPS.map((s, i) => {
          const done = step > s.id;
          const active = step === s.id;
          return (
            <div key={s.id} className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={() => { setStep(s.id); setOpen(true); }}
                aria-current={active}
                className={cn(
                  "flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] transition-colors",
                  active
                    ? "border-primary bg-primary text-primary-foreground"
                    : done
                      ? "border-primary/40 text-primary"
                      : "border-border text-muted-foreground hover:bg-accent",
                )}
              >
                <span
                  className={cn(
                    "flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-semibold",
                    active ? "bg-primary-foreground/20" : done ? "bg-primary/10" : "bg-muted",
                  )}
                >
                  {done ? <Check className="h-2.5 w-2.5" /> : s.id}
                </span>
                {s.label}
              </button>
              {i < VIDEO_STEPS.length - 1 && <span className="h-px w-4 bg-border" />}
            </div>
          );
        })}
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {count > 0 && <Badge variant="secondary" className="text-[10px]">{count} style{count === 1 ? "" : "s"}</Badge>}
          <Button variant="ghost" size="sm" className="h-7 px-2 text-[11px]" onClick={() => setOpen((o) => !o)}>
            {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            {open ? "Hide" : "Show"}
          </Button>
        </div>
      </div>

      {open && (
        <div className="px-4 sm:px-6 pb-3">
          {step === 1 && (
            <div className="max-h-[46vh] overflow-y-auto">
              <div className="mb-2 flex items-center gap-3">
                <p className="text-[12px] font-medium">
                  Creative style{" "}
                  <span className="font-normal text-muted-foreground">— hover a card to preview, click to select</span>
                </p>
                <Button
                  size="sm"
                  className="ml-auto h-7 px-2.5 text-[11px]"
                  disabled={count === 0}
                  onClick={() => setStep(3)}
                >
                  Next: script
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-3 pb-1 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                {VIDEO_STYLE_PRESETS.map((preset) => {
                  const on = selectedPresetIds.includes(preset.id);
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => onTogglePreset(preset.id)}
                      aria-pressed={on}
                      className={cn(
                        "group relative overflow-hidden rounded-xl border-2 text-left transition-all",
                        on ? "border-primary ring-2 ring-ring/30" : "border-border hover:border-ring",
                      )}
                    >
                      <div className={cn("w-full bg-muted", ASPECT_CLASS[aspect] || ASPECT_CLASS["9:16"])}>
                        <video
                          src={preset.preview}
                          muted
                          loop
                          playsInline
                          preload="metadata"
                          className="h-full w-full object-cover"
                          onMouseEnter={(e) => { void e.currentTarget.play().catch(() => {}); }}
                          onMouseLeave={(e) => { e.currentTarget.pause(); e.currentTarget.currentTime = 0; }}
                        />
                      </div>
                      <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent px-2 pt-7 pb-1.5">
                        <span className="block text-[11px] font-semibold leading-tight text-white">{preset.name}</span>
                        <span className="block text-[9px] leading-tight text-white/70">{preset.description}</span>
                      </span>
                      {on && (
                        <span className="absolute right-1.5 top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-primary-foreground">
                          <Check className="h-2.5 w-2.5" />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="flex flex-wrap items-center gap-3 py-2">
              <div className="text-[12px]">
                {avatarName ? (
                  <>Casting <span className="font-medium">{avatarName}</span> as the on-camera talent.</>
                ) : (
                  <>No avatar cast — the model will generate the talent from your style and script.</>
                )}
              </div>
              <Button variant="outline" size="sm" className="h-7 px-2.5 text-[11px]" onClick={onOpenAvatars}>
                <User2 className="mr-1 h-3.5 w-3.5" />
                {avatarName ? "Change avatar" : "Pick an avatar"}
              </Button>
              {hasFirstFrame && <Badge variant="outline" className="text-[10px]">First frame pinned</Badge>}
              {referenceCount > 0 && <Badge variant="outline" className="text-[10px]">{referenceCount} reference{referenceCount === 1 ? "" : "s"}</Badge>}
              <Button size="sm" className="ml-auto h-7 px-2.5 text-[11px]" onClick={() => setStep(3)}>Next: script</Button>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-2 py-2">
              <p className="text-[12px] text-muted-foreground">
                Develop the script in chat — no render spend. Generate one script per selected style, then refine it in the thread.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                {selectedPresetIds.map((id) => {
                  const p = VIDEO_STYLE_PRESETS.find((s) => s.id === id);
                  if (!p) return null;
                  return <Badge key={id} variant="secondary" className="text-[10px]">{p.name}</Badge>;
                })}
                {count === 0 && (
                  <button type="button" className="text-[11px] underline text-muted-foreground" onClick={() => setStep(1)}>
                    Pick a style first
                  </button>
                )}
                <Button
                  size="sm"
                  className="ml-auto h-7 px-2.5 text-[11px]"
                  disabled={count === 0 || generating}
                  onClick={() => { onSetProduce(false); onGenerateScripts(); }}
                >
                  {generating ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Wand2 className="mr-1 h-3.5 w-3.5" />}
                  Generate {count > 0 ? `${count} ` : ""}script{count === 1 ? "" : "s"}
                </Button>
                <Button variant="outline" size="sm" className="h-7 px-2.5 text-[11px]" onClick={() => setStep(4)}>Next: produce</Button>
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="flex flex-wrap items-center gap-3 py-2">
              <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
                <Badge variant="outline" className="text-[10px]">{summary.model}</Badge>
                <Badge variant="outline" className="text-[10px]">{summary.resolution}</Badge>
                <Badge variant="outline" className="text-[10px]">{summary.seconds}s</Badge>
                <Badge variant="outline" className="text-[10px]">{aspect}</Badge>
                {summary.cost && <span>~{summary.cost}</span>}
              </div>
              <div className="ml-auto flex items-center gap-1 rounded-lg border border-border/60 bg-muted/40 p-0.5">
                <button
                  type="button"
                  onClick={() => onSetProduce(false)}
                  className={cn("rounded-md px-2 py-1 text-[11px]", !produce ? "bg-background font-medium" : "text-muted-foreground")}
                >
                  Chat script
                </button>
                <button
                  type="button"
                  onClick={() => onSetProduce(true)}
                  className={cn("rounded-md px-2 py-1 text-[11px] inline-flex items-center gap-1", produce ? "bg-primary text-primary-foreground font-medium" : "text-muted-foreground")}
                >
                  <Clapperboard className="h-3 w-3" /> Produce video
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Prompt block describing the selected reference styles, for scripts and renders. */
export function buildPresetStyleBlock(ids: string[]): string {
  const picks = VIDEO_STYLE_PRESETS.filter((p) => ids.includes(p.id));
  if (!picks.length) return "";
  return picks
    .map((p) => `STYLE REFERENCE — ${p.name} (${p.description})\nDIRECTION: ${p.promptHint}\n${p.baselinePrompt}`)
    .join("\n\n");
}
