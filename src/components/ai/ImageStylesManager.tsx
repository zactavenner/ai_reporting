import { useEffect, useMemo, useState } from "react";
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
import { Image as ImageIcon, Plus, Trash2, Save, ChevronDown } from "lucide-react";
import { toast } from "sonner";

export type ImageStyle = {
  id: string;
  name: string;
  /** Prompt template injected before the user's text when this style is active. */
  prompt: string;
  builtIn?: boolean;
};

const STORAGE_KEY = "ai-studio:image-styles:v1";
const SELECTED_KEY = "ai-studio:image-style:selected";

export const DEFAULT_IMAGE_STYLES: ImageStyle[] = [
  {
    id: "none",
    name: "No Style",
    prompt: "",
    builtIn: true,
  },
  {
    id: "capital-raising",
    name: "Capital Raising",
    builtIn: true,
    prompt: `STYLE: Premium institutional capital-raising static ad. Sophisticated, trust-forward design language — think private equity / family office deck cover. Deep, rich color palette (navy, forest green, charcoal, cream, gold accents). Editorial photography or tasteful real-estate / asset imagery. Refined serif headline pairing with a clean modern sans-serif subhead.

RULES:
- Hero headline must lead with the offer's strongest financial proof point (e.g. "15–18% Preferred Returns", "Targeted Cash-on-Cash"). Use the exact numbers from the active offer — never invent.
- Always include a single clear CTA button (e.g. "View The Offering", "See If You Qualify").
- Subtle accreditation / compliance hint allowed in small type (e.g. "For Accredited Investors").
- Avoid stock-photo cliché, emojis, casual UGC look, or screenshot-style mockups.
- Respect the client brand colors and fonts from Brand Lock — do not invent new palettes.`,
  },
  {
    id: "low-ticket",
    name: "Low Ticket",
    builtIn: true,
    prompt: `STYLE: High-conversion low-ticket direct-response ad creative. Bold, punchy, scroll-stopping. Bright contrast, oversized headline, clear product / outcome shot, prominent CTA badge or sticker. Optimized for paid social feeds (Meta / TikTok).

RULES:
- Headline = the single biggest benefit / hook in plain language. Use specific numbers and a price anchor if relevant ("$27", "Today Only", "Save 60%").
- Add a visible CTA element (button, badge, arrow) — never a passive composition.
- Crop tight, no wasted negative space. Text must be legible at thumbnail size.
- Color: 2–3 high-contrast brand colors. Avoid muted / luxury palettes here.
- No tiny disclaimers, no enterprise-y language. Conversational and urgent.`,
  },
  {
    id: "news-format",
    name: "News Format",
    builtIn: true,
    prompt: `STYLE: Native news / press-article ad creative. Looks like a real news outlet feature: outlet wordmark or "FEATURED IN" strip across the top, editorial photo, serif headline, byline / dateline, short standfirst paragraph.

RULES:
- Top strip: "AS SEEN IN" or a believable generic outlet wordmark (no real third-party logos unless the user explicitly provided proof).
- Headline written like a news story — third-person, neutral tone, no marketing exclamations ("How [Company] Is Helping Accredited Investors Target 15–18% Preferred Returns").
- Below headline: short standfirst sentence + small "Read More →" or "Learn More" CTA styled like an article link.
- Photo: editorial / journalistic, real-world setting relevant to the offer (property, principal, signing room, skyline).
- Avoid neon colors, emojis, sticker badges, or sale-style typography.`,
  },
];

function loadStyles(): ImageStyle[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr) && arr.length) {
        const userById = new Map(arr.map((s: ImageStyle) => [s.id, s]));
        const merged: ImageStyle[] = DEFAULT_IMAGE_STYLES.map((d) => userById.get(d.id) || d);
        for (const s of arr as ImageStyle[]) {
          if (!merged.find((m) => m.id === s.id)) merged.push(s);
        }
        return merged;
      }
    }
  } catch {}
  return DEFAULT_IMAGE_STYLES;
}

function saveStyles(styles: ImageStyle[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(styles)); } catch {}
}

export function useImageStyles() {
  const [styles, setStyles] = useState<ImageStyle[]>(() => loadStyles());
  const [selectedId, setSelectedId] = useState<string>(() => {
    try { return localStorage.getItem(SELECTED_KEY) || "none"; } catch { return "none"; }
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

export function buildImageStyleBlock(style: ImageStyle | undefined, imageActive: boolean): string {
  if (!imageActive) return "";
  if (!style || !style.prompt.trim() || style.id === "none") return "";
  return `\n\n[ACTIVE IMAGE STYLE: ${style.name}]\n${style.prompt.trim()}\n\n[USER REQUEST]\n`;
}

type Props = {
  styles: ImageStyle[];
  setStyles: (s: ImageStyle[]) => void;
  selectedId: string;
  setSelectedId: (id: string) => void;
};

export function ImageStylesPopover({ styles, setStyles, selectedId, setSelectedId }: Props) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ImageStyle | null>(null);
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
            title="Pick an image style"
          >
            <ImageIcon className="h-3 w-3" />
            <span>{selected?.name || "No Style"}</span>
            <ChevronDown className="h-3 w-3 opacity-70" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 p-2">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground px-1 pb-1">Image Style</div>
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
              onClick={() => setEditing({ id: `img-style-${Date.now()}`, name: "New Style", prompt: "" })}
            >
              <Plus className="h-3 w-3 mr-1" /> New Style
            </Button>
          </div>
        </PopoverContent>
      </Popover>

      <Dialog open={!!editing} onOpenChange={(o) => { if (!o) setEditing(null); }}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{editing && styles.find((x) => x.id === editing.id) ? "Edit Image Style" : "New Image Style"}</DialogTitle>
            <DialogDescription>
              Prompt instructions are prepended to every static-ad request when this style is active.
            </DialogDescription>
          </DialogHeader>
          {editing && (
            <div className="space-y-3">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Name</label>
                <Input
                  value={editing.name}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  placeholder="Capital Raising, Low Ticket, News Format…"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground flex items-center gap-2">
                  Prompt instructions
                  {editing.builtIn && <Badge variant="secondary" className="text-[9px]">built-in</Badge>}
                </label>
                <Textarea
                  value={editing.prompt}
                  onChange={(e) => setEditing({ ...editing, prompt: e.target.value })}
                  rows={14}
                  placeholder="Describe the look, palette, typography, composition, and any hard constraints."
                  className="font-mono text-xs"
                />
              </div>
            </div>
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