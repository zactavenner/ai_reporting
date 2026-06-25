import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { Clapperboard, Plus, Trash2, Save, ChevronDown, Settings2, Sparkles, FileAudio, Loader2, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { StyleReferencesEditor, buildReferencesPromptLines, type StyleReference } from "./StyleReferencesEditor";
import { supabase } from "@/integrations/supabase/client";
import { Link } from "react-router-dom";

export type VideoStyle = {
  id: string;
  name: string;
  /** Prompt template injected before the user's text when this style is active. */
  prompt: string;
  builtIn?: boolean;
  /** Stable key for built-in presets so cloud rows can be matched/upserted. */
  builtinKey?: string;
  /** Cloud DB row id (when persisted). */
  cloudId?: string;
  /** Snapshot of the last AI-trained prompt — lets user "Reset to AI-trained". */
  aiTrainedPrompt?: string;
  references?: StyleReference[];
};

const STORAGE_KEY = "ai-studio:video-styles:v1";
const SELECTED_KEY = "ai-studio:video-style:selected";

export const DEFAULT_VIDEO_STYLES: VideoStyle[] = [
  {
    id: "none",
    name: "No Style",
    prompt: "",
    builtIn: true,
  },
  {
    id: "ugc",
    name: "UGC",
    builtIn: true,
    prompt: `STYLE: Authentic amateur-style UGC. Handheld phone feel with subtle micro-shake, natural smartphone-lens look, no cinematic grading. Soft natural daylight, clean realistic background relevant to the offer.

RULES:
- The phone, camera, or any mirror reflection of a phone/hands holding a phone must NEVER be visible. No mirrors showing the filming setup.
- Casual, confident, conversational American English voiceover. Natural breaths and pauses. No music. No SFX. Only voice + faint natural room tone.
- Real person energy — they just learned about this and are sharing it.
- 10–12s total. Structure: (0–2s) visual hook with surprised/serious expression and a question-style opener. (2–4s) quick cut, casual gesture, key stat. (4–7s) tight close-up of a hand holding the printed overview/PDF showing key phrases. (7–10s) medium shot, soft daylight, builds trust. (10–12s) final close-up with small genuine nod + subtle smile, ends mid-motion like a real social post with the CTA.
- Use the attached avatar image for the person and the attached PDF/overview as the printed page they hold up. Keep key phrases from the PDF legible in the close-up.`,
  },
  {
    id: "podcast",
    name: "Podcast",
    builtIn: true,
    prompt: `STYLE: High-energy podcast clip with quick cuts between two hosts in a professional studio. Both wearing headsets and speaking into high-end podcast microphones. Cinematic lighting, 4k, photo-realistic. Shallow depth of field, warm color grade, subtle studio bokeh (acoustic panels, plants, neon accents allowed).

RULES:
- Two on-camera hosts: a younger female interviewer and an older male expert/doctor figure (adapt ages/looks to attached avatars if provided).
- Quick back-and-forth cuts that match the script's Q&A rhythm. Perfect lip sync on every line.
- Conversational, high-energy delivery. Interviewer asks the hook question, expert delivers the punchy answer, closes with a clear CTA pointing the viewer to the form / link below the video.
- Clean spoken voice only — no music, no SFX, no captions, no on-screen text.
- 12–15s total. Structure: (0–4s) interviewer hook question. (4–10s) expert authoritative answer with key proof point. (10–13s) interviewer follow-up ("How can our audience get access?"). (13–15s) expert CTA ("Fill out your info below to see if you qualify…").
- If an avatar is attached, cast that person as the expert; if a PDF/offer is attached, ground the expert's answer in its key claims.

REFERENCE EXAMPLE (style + pacing to emulate, not script to copy verbatim):
"Podcast style video, 15 seconds. High-energy quick cuts between a 29-year-old blonde woman and a 60-year-old male doctor in a professional studio. They are wearing headsets and speaking into high-end podcast microphones. Script: (Woman) 'Doctor, why healthcare real estate over anything else right now?' (Doctor) 'It's the only asset class that's recession-proof, AI-proof, and stable for long-term returns and quarterly payouts.' (Woman) 'Incredible. How can our audience get access?' (Doctor) 'Fill out your info below to see if you qualify for all the investor details.' Perfect lip sync, cinematic lighting, 4k, realistic. No captions. No text."`,
  },
  {
    id: "broll-vo",
    name: "B-roll Voiceover",
    builtIn: true,
    prompt: `STYLE: Cinematic b-roll montage with voiceover. NO on-camera talent speaking — voice is off-screen narration.

RULES:
- Sequence of 3–5 evocative b-roll shots that visually support the script (locations, hands, objects, environment relevant to the offer).
- Smooth slow camera moves (slider, gimbal, slow push-ins). Cinematic color grade. Natural ambient sound at low level.
- Warm, confident narrator voiceover. No music unless requested.
- If a PDF/overview is attached, include one shot of the document/page being flipped through or laid on a desk with key phrases legible.`,
  },
  {
    id: "animated-cartoon",
    name: "Animated Cartoon",
    builtIn: true,
    prompt: `STYLE: 2D animated cartoon explainer, flat vector look with bold outlines, limited palette, smooth tween animation. Pixar-lite character design, expressive faces, clean motion-design typography for key stats.

RULES:
- Cartoon character delivers the script with clear lip-sync. Background is illustrated, not photoreal.
- Animate key numbers / stats popping onto screen as kinetic typography.
- Light, friendly score is OK; voice remains the lead.
- If an avatar reference is attached, stylize the character to resemble them (hair color, outfit color, vibe) but keep it clearly illustrated.`,
  },
];

function loadStyles(): VideoStyle[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr) && arr.length) {
        // Merge with built-ins so new built-ins always show up, but user edits/extras win.
        const userById = new Map(arr.map((s: VideoStyle) => [s.id, s]));
        const merged: VideoStyle[] = DEFAULT_VIDEO_STYLES.map((d) => userById.get(d.id) || d);
        for (const s of arr as VideoStyle[]) {
          if (!merged.find((m) => m.id === s.id)) merged.push(s);
        }
        return merged;
      }
    }
  } catch {}
  return DEFAULT_VIDEO_STYLES;
}

function saveStyles(styles: VideoStyle[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(styles)); } catch {}
}

export function useVideoStyles() {
  const [styles, setStyles] = useState<VideoStyle[]>(() => loadStyles());
  const [selectedId, setSelectedId] = useState<string>(() => {
    try { return localStorage.getItem(SELECTED_KEY) || "ugc"; } catch { return "ugc"; }
  });

  useEffect(() => { saveStyles(styles); }, [styles]);
  useEffect(() => {
    try { localStorage.setItem(SELECTED_KEY, selectedId); } catch {}
  }, [selectedId]);

  const selected = useMemo(
    () => styles.find((s) => s.id === selectedId) || styles[0],
    [styles, selectedId],
  );

  return { styles, setStyles, selectedId, setSelectedId, selected };
}

/** Build the prompt block that gets prepended to the user's message when a style is active. */
export function buildVideoStyleBlock(style: VideoStyle | undefined, videoActive: boolean): string {
  if (!videoActive) return "";
  if (!style || style.id === "none") return "";
  const refsBlock = buildReferencesPromptLines(style.references, "video");
  if (!style.prompt.trim() && !refsBlock) return "";
  return `\n\n[ACTIVE VIDEO STYLE: ${style.name}]\n${style.prompt.trim()}${refsBlock}\n\n[USER REQUEST]\n`;
}

type Props = {
  styles: VideoStyle[];
  setStyles: (s: VideoStyle[]) => void;
  selectedId: string;
  setSelectedId: (id: string) => void;
  /** Compact mode renders only the chip row; manage button still opens the dialog. */
  compact?: boolean;
};

export function VideoStylesBar({ styles, setStyles, selectedId, setSelectedId }: Props) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<VideoStyle | null>(null);

  function openNew() {
    setEditing({ id: `style-${Date.now()}`, name: "New Style", prompt: "" });
  }

  function saveEditing() {
    if (!editing) return;
    const name = editing.name.trim();
    if (!name) { toast.error("Name required"); return; }
    const existsIdx = styles.findIndex((s) => s.id === editing.id);
    const next = [...styles];
    if (existsIdx >= 0) next[existsIdx] = editing;
    else next.push(editing);
    setStyles(next);
    setEditing(null);
    toast.success(`Saved "${editing.name}"`);
  }

  function deleteStyle(id: string) {
    const s = styles.find((x) => x.id === id);
    if (s?.builtIn) { toast.error("Built-in styles can't be deleted (edit instead)"); return; }
    setStyles(styles.filter((x) => x.id !== id));
    if (selectedId === id) setSelectedId("none");
    setEditing(null);
  }

  return (
    <div className="flex items-center gap-1 flex-wrap">
      <span className="text-[9px] text-muted-foreground uppercase tracking-wide inline-flex items-center gap-1">
        <Clapperboard className="h-3 w-3" /> Video Styles:
      </span>
      {styles.map((s) => {
        const active = s.id === selectedId;
        return (
          <div key={s.id} className="inline-flex">
            <button
              type="button"
              onClick={() => setSelectedId(s.id)}
              title={s.prompt || "No additional style instructions"}
              className={`h-7 px-2 rounded-l-lg text-[10px] border transition ${active ? "bg-primary text-primary-foreground border-primary" : "bg-muted/40 hover:bg-muted border-border/60 text-muted-foreground"}`}
            >
              {s.name}
              {s.builtIn && <span className="ml-1 opacity-60">•</span>}
            </button>
            <button
              type="button"
              onClick={() => setEditing(s)}
              title={`Edit ${s.name}`}
              className={`h-7 px-1.5 rounded-r-lg text-[10px] border border-l-0 transition ${active ? "bg-primary/80 text-primary-foreground border-primary" : "bg-muted/40 hover:bg-muted border-border/60 text-muted-foreground"}`}
            >
              ✎
            </button>
          </div>
        );
      })}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 px-2 text-[10px]"
            onClick={openNew}
          >
            <Plus className="h-3 w-3 mr-1" /> New Style
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>New Video Style</DialogTitle>
            <DialogDescription>
              Name your style and write the prompt instructions the AI should follow when generating videos in this style.
            </DialogDescription>
          </DialogHeader>
          <StyleEditor
            style={editing && !styles.find((x) => x.id === editing.id) ? editing : { id: `style-${Date.now()}`, name: "", prompt: "" }}
            onChange={(s) => setEditing(s)}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => { saveEditing(); setOpen(false); }}>
              <Save className="h-3 w-3 mr-1" /> Save Style
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit existing dialog */}
      <Dialog open={!!editing && !!styles.find((x) => x.id === editing!.id)} onOpenChange={(o) => { if (!o) setEditing(null); }}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Edit Video Style</DialogTitle>
            <DialogDescription>
              Refine the prompt to improve generation quality. Edits to built-in styles are kept locally per browser.
            </DialogDescription>
          </DialogHeader>
          {editing && (
            <StyleEditor
              style={editing}
              onChange={(s) => setEditing(s)}
            />
          )}
          <DialogFooter className="flex items-center justify-between sm:justify-between">
            <div>
              {editing && !editing.builtIn && (
                <Button variant="ghost" className="text-destructive" onClick={() => deleteStyle(editing.id)}>
                  <Trash2 className="h-3 w-3 mr-1" /> Delete
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
              <Button onClick={saveEditing}>
                <Save className="h-3 w-3 mr-1" /> Save
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StyleEditor({ style, onChange }: { style: VideoStyle; onChange: (s: VideoStyle) => void }) {
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">Name</label>
        <Input
          value={style.name}
          onChange={(e) => onChange({ ...style, name: e.target.value })}
          placeholder="UGC, Podcast, Cinematic…"
        />
      </div>
      <div className="space-y-1">
        <label className="text-xs text-muted-foreground flex items-center gap-2">
          Prompt instructions
          {style.builtIn && <Badge variant="secondary" className="text-[9px]">built-in</Badge>}
        </label>
        <Textarea
          value={style.prompt}
          onChange={(e) => onChange({ ...style, prompt: e.target.value })}
          rows={14}
          placeholder="Describe the look, pacing, camera, audio rules, and any hard constraints. This is prepended to every video request when this style is active."
          className="font-mono text-xs"
        />
      </div>
      <StyleReferencesEditor
        kind="video"
        value={style.references || []}
        onChange={(refs) => onChange({ ...style, references: refs })}
      />
    </div>
  );
}

export function VideoStylesPopover({ styles, setStyles, selectedId, setSelectedId }: Props) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<VideoStyle | null>(null);
  const selected = styles.find((s) => s.id === selectedId) || styles[0];

  function saveEditing() {
    if (!editing) return;
    const name = editing.name.trim();
    if (!name) { toast.error("Name required"); return; }
    const existsIdx = styles.findIndex((s) => s.id === editing.id);
    const next = [...styles];
    if (existsIdx >= 0) next[existsIdx] = editing;
    else next.push(editing);
    setStyles(next);
    setEditing(null);
    toast.success(`Saved "${editing.name}"`);
  }

  function deleteStyle(id: string) {
    const s = styles.find((x) => x.id === id);
    if (s?.builtIn) { toast.error("Built-in styles can't be deleted (edit instead)"); return; }
    setStyles(styles.filter((x) => x.id !== id));
    if (selectedId === id) setSelectedId("none");
    setEditing(null);
  }

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={`h-7 px-2 rounded-lg text-[10px] border inline-flex items-center gap-1 transition ${selected && selected.id !== "none" ? "bg-primary text-primary-foreground border-primary" : "bg-muted/40 hover:bg-muted border-border/60 text-muted-foreground"}`}
            title="Pick a video style"
          >
            <Clapperboard className="h-3 w-3" />
            <span>{selected?.name || "No Style"}</span>
            <ChevronDown className="h-3 w-3 opacity-70" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 p-2">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground px-1 pb-1">Video Style</div>
          <div className="flex flex-col gap-1 max-h-72 overflow-y-auto">
            {styles.map((s) => {
              const active = s.id === selectedId;
              return (
                <div key={s.id} className="flex items-stretch gap-1">
                  <button
                    type="button"
                    onClick={() => { setSelectedId(s.id); setOpen(false); }}
                    className={`flex-1 text-left px-2 py-1.5 rounded text-xs border transition ${active ? "bg-primary text-primary-foreground border-primary" : "bg-muted/30 hover:bg-muted border-border/60"}`}
                    title={s.prompt || "No additional style instructions"}
                  >
                    <div className="flex items-center gap-1">
                      <span className="font-medium">{s.name}</span>
                      {s.builtIn && <Badge variant="secondary" className="text-[9px] h-4">built-in</Badge>}
                    </div>
                    {s.prompt && (
                      <div className={`text-[10px] mt-0.5 line-clamp-2 ${active ? "text-primary-foreground/80" : "text-muted-foreground"}`}>
                        {s.prompt.split("\n")[0]}
                      </div>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setEditing(s); }}
                    className="px-2 rounded text-xs border bg-muted/30 hover:bg-muted border-border/60"
                    title={`Edit ${s.name}`}
                  >
                    ✎
                  </button>
                </div>
              );
            })}
          </div>
          <div className="pt-2 border-t border-border/60 mt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 px-2 text-[10px] w-full"
              onClick={() => setEditing({ id: `vid-style-${Date.now()}`, name: "New Style", prompt: "" })}
            >
              <Plus className="h-3 w-3 mr-1" /> New Style
            </Button>
          </div>
        </PopoverContent>
      </Popover>

      <Dialog open={!!editing} onOpenChange={(o) => { if (!o) setEditing(null); }}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{editing && styles.find((x) => x.id === editing.id) ? "Edit Video Style" : "New Video Style"}</DialogTitle>
            <DialogDescription>
              Prompt instructions are prepended to every video request when this style is active.
            </DialogDescription>
          </DialogHeader>
          {editing && (
            <StyleEditor style={editing} onChange={(s) => setEditing(s)} />
          )}
          <DialogFooter className="flex items-center justify-between sm:justify-between">
            <div>
              {editing && !editing.builtIn && styles.find((x) => x.id === editing.id) && (
                <Button variant="ghost" className="text-destructive" onClick={() => deleteStyle(editing.id)}>
                  <Trash2 className="h-3 w-3 mr-1" /> Delete
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
              <Button onClick={saveEditing}>
                <Save className="h-3 w-3 mr-1" /> Save
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}