import type { Layer, HyperframesComposition, TextLayer } from "./timeline";

export type CaptionWord = { word: string; startTime: number; endTime: number };
export type CaptionSegment = {
  text: string;
  startTime: number;
  endTime: number;
  words?: CaptionWord[];
};

const CAP_PREFIX = "cap_";

/** Caption style presets, simple → advanced. */
export type CaptionStyle =
  | "simple-mono"   // single big white word, thick black stroke (clean reels look)
  | "viral-pop"     // word-by-word yellow highlight + spring pop
  | "stacked-bold"; // 2-line condensed Anton-style, one accent word per phrase

export const CAPTION_STYLES: { id: CaptionStyle; label: string; hint: string }[] = [
  { id: "simple-mono", label: "Simple", hint: "Big bold white words, thick black stroke" },
  { id: "viral-pop", label: "Viral pop", hint: "Word-by-word with yellow highlight & spring" },
  { id: "stacked-bold", label: "Stacked", hint: "Condensed Anton-style stack with accent color" },
];

const DISPLAY_FONT = "Anton, Oswald, 'Bebas Neue', Impact, system-ui, sans-serif";

export function stripCaptionLayers(layers: Layer[]): Layer[] {
  return layers.filter((l) => !l.id.startsWith(CAP_PREFIX));
}

function ensureWords(seg: CaptionSegment): CaptionWord[] {
  if (seg.words && seg.words.length) return seg.words;
  const arr = seg.text.split(/\s+/).filter(Boolean);
  const span = (seg.endTime - seg.startTime) / Math.max(1, arr.length);
  return arr.map((w, idx) => ({
    word: w,
    startTime: seg.startTime + idx * span,
    endTime: seg.startTime + (idx + 1) * span,
  }));
}

/** Pick the most "emphasis-worthy" word in a phrase: longest non-stopword. */
function pickAccentIndex(words: CaptionWord[]): number {
  const STOP = new Set([
    "the","a","an","and","or","but","of","to","in","on","for","with","is","are",
    "was","were","be","been","being","it","this","that","i","you","we","they",
    "my","your","our","their","at","by","as","so","if","do","does","did","not",
  ]);
  let best = 0;
  let bestScore = -1;
  words.forEach((w, i) => {
    const clean = w.word.toLowerCase().replace(/[^a-z0-9%]/g, "");
    if (!clean || STOP.has(clean)) return;
    const score = clean.length + (/\d|%/.test(clean) ? 5 : 0);
    if (score > bestScore) { bestScore = score; best = i; }
  });
  return best;
}

/**
 * SIMPLE-MONO: one BIG white word at a time, thick black stroke, soft drop shadow.
 * Mirrors the "ONE" / "CLEANING UP" reels frames.
 */
export function buildSimpleMonoLayers(
  segments: CaptionSegment[],
  comp: HyperframesComposition,
): Layer[] {
  const layers: Layer[] = [];
  const fontSize = Math.round(comp.height * 0.085);
  const stroke = Math.max(6, Math.round(fontSize * 0.14));
  let i = 0;
  for (const seg of segments) {
    for (const w of ensureWords(seg)) {
      const dur = Math.max(0.12, w.endTime - w.startTime);
      const popDur = Math.min(0.16, dur * 0.5);
      layers.push({
        id: `${CAP_PREFIX}${i++}`,
        type: "text",
        text: w.word,
        uppercase: true,
        start: w.startTime,
        end: Math.min(comp.duration, w.endTime + 0.04),
        x: 0.5,
        y: 0.5,
        anchor: "center",
        fontFamily: DISPLAY_FONT,
        fontSize,
        fontWeight: 900,
        color: "#FFFFFF",
        stroke: "#000000",
        strokeWidth: stroke,
        shadowColor: "rgba(0,0,0,0.6)",
        shadowBlur: Math.round(fontSize * 0.25),
        align: "center",
        maxWidthPct: 0.92,
        animations: [
          { prop: "opacity", from: 0, to: 1, start: 0, end: popDur * 0.5, ease: "easeOut" },
          { prop: "scale", from: 0.85, to: 1.04, start: 0, end: popDur, ease: "spring" },
          { prop: "scale", from: 1.04, to: 1, start: popDur, end: popDur + 0.07, ease: "easeOut" },
        ],
      } as TextLayer);
    }
  }
  return layers;
}

/**
 * VIRAL-POP: word-by-word with bright yellow highlight + spring pop.
 */
export function buildViralPopLayers(
  segments: CaptionSegment[],
  comp: HyperframesComposition,
): Layer[] {
  const layers: Layer[] = [];
  const fontSize = Math.round(comp.height * 0.08);
  const stroke = Math.max(5, Math.round(fontSize * 0.12));
  let i = 0;
  for (const seg of segments) {
    for (const w of ensureWords(seg)) {
      const dur = Math.max(0.12, w.endTime - w.startTime);
      const popDur = Math.min(0.18, dur * 0.45);
      layers.push({
        id: `${CAP_PREFIX}${i++}`,
        type: "text",
        text: w.word,
        uppercase: true,
        start: w.startTime,
        end: Math.min(comp.duration, w.endTime + 0.05),
        x: 0.5,
        y: 0.78,
        anchor: "center",
        fontFamily: DISPLAY_FONT,
        fontSize,
        fontWeight: 900,
        color: "#FFEB3B",
        stroke: "#000000",
        strokeWidth: stroke,
        shadowColor: "rgba(0,0,0,0.55)",
        shadowBlur: Math.round(fontSize * 0.2),
        align: "center",
        maxWidthPct: 0.9,
        animations: [
          { prop: "opacity", from: 0, to: 1, start: 0, end: popDur * 0.6, ease: "easeOut" },
          { prop: "scale", from: 0.6, to: 1.08, start: 0, end: popDur, ease: "spring" },
          { prop: "scale", from: 1.08, to: 1, start: popDur, end: popDur + 0.08, ease: "easeOut" },
        ],
      } as TextLayer);
    }
  }
  return layers;
}

/**
 * STACKED-BOLD: condensed Anton-style stack (2 lines), accent word in gold.
 * Each phrase appears as a whole then advances. Mirrors "your biggest OPPORTUNITIES in AI" frame.
 */
export function buildStackedBoldLayers(
  segments: CaptionSegment[],
  comp: HyperframesComposition,
): Layer[] {
  const layers: Layer[] = [];
  const baseSize = Math.round(comp.height * 0.07);
  const accentSize = Math.round(comp.height * 0.105);
  const stroke = Math.max(5, Math.round(baseSize * 0.13));
  let i = 0;
  for (const seg of segments) {
    const words = ensureWords(seg);
    if (!words.length) continue;
    const accentIdx = pickAccentIndex(words);
    const before = words.slice(0, accentIdx).map((w) => w.word).join(" ");
    const accent = words[accentIdx].word;
    const after = words.slice(accentIdx + 1).map((w) => w.word).join(" ");
    const start = seg.startTime;
    const end = Math.min(comp.duration, seg.endTime + 0.08);
    const popDur = 0.22;

    const common = {
      start,
      end,
      anchor: "center" as const,
      fontFamily: DISPLAY_FONT,
      fontWeight: 900,
      stroke: "#000000",
      strokeWidth: stroke,
      shadowColor: "rgba(0,0,0,0.55)",
      shadowBlur: Math.round(baseSize * 0.25),
      align: "center" as const,
      maxWidthPct: 0.92,
      animations: [
        { prop: "opacity", from: 0, to: 1, start: 0, end: popDur * 0.5, ease: "easeOut" } as const,
        { prop: "scale", from: 0.9, to: 1.05, start: 0, end: popDur, ease: "spring" } as const,
        { prop: "scale", from: 1.05, to: 1, start: popDur, end: popDur + 0.08, ease: "easeOut" } as const,
      ],
    };

    if (before) {
      layers.push({
        id: `${CAP_PREFIX}${i++}`,
        type: "text",
        text: before,
        uppercase: false,
        x: 0.5,
        y: 0.36,
        fontSize: baseSize,
        color: "#FFFFFF",
        ...common,
      } as TextLayer);
    }
    layers.push({
      id: `${CAP_PREFIX}${i++}`,
      type: "text",
      text: accent,
      uppercase: true,
      x: 0.5,
      y: 0.5,
      fontSize: accentSize,
      color: "#F5C24B", // gold accent
      ...common,
    } as TextLayer);
    if (after) {
      layers.push({
        id: `${CAP_PREFIX}${i++}`,
        type: "text",
        text: after,
        uppercase: true,
        x: 0.5,
        y: 0.64,
        fontSize: baseSize,
        color: "#FFFFFF",
        ...common,
      } as TextLayer);
    }
  }
  return layers;
}

export function applyCaptionPreset(
  comp: HyperframesComposition,
  segments: CaptionSegment[],
  preset: CaptionStyle | "none" = "simple-mono",
): HyperframesComposition {
  const base = stripCaptionLayers(comp.layers);
  if (preset === "none") return { ...comp, layers: base };
  const caps =
    preset === "viral-pop"
      ? buildViralPopLayers(segments, comp)
      : preset === "stacked-bold"
      ? buildStackedBoldLayers(segments, comp)
      : buildSimpleMonoLayers(segments, comp);
  return { ...comp, layers: [...base, ...caps] };
}

export function hasCaptionLayers(comp: HyperframesComposition): boolean {
  return comp.layers.some((l) => l.id.startsWith(CAP_PREFIX));
}