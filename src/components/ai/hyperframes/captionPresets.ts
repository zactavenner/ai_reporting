import type { Layer, HyperframesComposition, TextLayer } from "./timeline";

export type CaptionWord = { word: string; startTime: number; endTime: number };
export type CaptionSegment = {
  text: string;
  startTime: number;
  endTime: number;
  words?: CaptionWord[];
};

const CAP_PREFIX = "cap_";

/** Show captions slightly before they're spoken — readers process text faster than audio. */
const LEAD = 0.12;
/** Linger after spoken to avoid jarring exits. */
const TAIL = 0.06;

/** Caption style presets — viral creator catalog. */
export type CaptionStyle =
  // Legacy / clean
  | "simple-mono"
  | "viral-pop"
  | "karaoke-line"
  | "stacked-bold"
  | "advanced-cinematic"
  // Viral creator presets
  | "hormozi"
  | "mrbeast"
  | "three-pop"
  | "viral-glow"
  | "word-pop"
  | "bounce"
  | "typewriter"
  | "one-word"
  | "golden-cue"
  | "box-pop";

export const CAPTION_STYLES: { id: CaptionStyle; label: string; hint: string }[] = [
  // Viral first — these are what creators pick most
  { id: "hormozi", label: "Hormozi", hint: "Montserrat Black, white + yellow keyword, thick black stroke" },
  { id: "mrbeast", label: "MrBeast", hint: "Block Komika-style, white + green pop on active word" },
  { id: "three-pop", label: "3-Pop", hint: "Three-word burst, magenta accent on final word" },
  { id: "viral-glow", label: "Viral glow", hint: "Cyan glow on the active word — bold attention grabber" },
  { id: "word-pop", label: "Word pop", hint: "Each word springs in with overshoot, exits after spoken" },
  { id: "bounce", label: "Bounce", hint: "Elastic spring entrance, rounded sans, playful energy" },
  { id: "typewriter", label: "Typewriter", hint: "Words accumulate left→right, the full phrase builds" },
  { id: "one-word", label: "One word", hint: "Massive single word at a time — isolated, cinematic" },
  { id: "karaoke-line", label: "Karaoke", hint: "Full phrase visible, current word highlighted yellow" },
  { id: "golden-cue", label: "Golden cue", hint: "Editorial serif, warm gold active word, premium look" },
  { id: "box-pop", label: "Box pop", hint: "Word in colored pill background — playful & loud" },
  { id: "simple-mono", label: "Simple", hint: "Big bold white words, thick black stroke" },
  { id: "viral-pop", label: "Viral pop", hint: "Word-by-word with yellow highlight & spring" },
  { id: "stacked-bold", label: "Stacked", hint: "Condensed Anton-style stack with accent color" },
  { id: "advanced-cinematic", label: "Advanced", hint: "3-line cinematic stack, tilted, gold/red accent" },
];

const FONT_ANTON = "Anton, 'Bebas Neue', Oswald, Impact, system-ui, sans-serif";
const FONT_MONTSERRAT = "'Montserrat', 'Helvetica Neue', Arial, system-ui, sans-serif";
const FONT_BLOCK = "'Bangers', 'Komika Axis', 'Boogaloo', Impact, system-ui, sans-serif";
const FONT_POPPINS = "'Poppins', 'Inter', system-ui, sans-serif";
const FONT_SERIF = "'DM Serif Display', 'Playfair Display', Georgia, serif";
const FONT_BOOGALOO = "'Boogaloo', 'Lexend', 'Poppins', system-ui, sans-serif";

export function stripCaptionLayers(layers: Layer[]): Layer[] {
  return layers.filter((l) => !l.id.startsWith(CAP_PREFIX));
}

export function hasCaptionLayers(comp: HyperframesComposition): boolean {
  return comp.layers.some((l) => l.id.startsWith(CAP_PREFIX));
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

/** Chunk a phrase into N-word beats, preserving per-word timings. */
function chunkWords(words: CaptionWord[], size: number): CaptionWord[][] {
  const out: CaptionWord[][] = [];
  for (let i = 0; i < words.length; i += size) {
    out.push(words.slice(i, i + size));
  }
  return out;
}

/** Approximate canvas advance per character at given font size (avg). */
function estimateWordWidth(word: string, fontSize: number, weight: number | string = 900): number {
  const heavy = typeof weight === "number" ? weight >= 800 : /900|800|black/i.test(String(weight));
  const per = fontSize * (heavy ? 0.62 : 0.55);
  return word.length * per;
}

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

/**
 * Lay out a row of words across the canvas, returning text layers.
 * The active (currently spoken) word is highlighted with `activeColor`
 * and gets a brief scale + optional glow pulse.
 */
function layoutWordRow(
  comp: HyperframesComposition,
  words: CaptionWord[],
  startId: number,
  opts: {
    y: number;
    fontSize: number;
    fontFamily: string;
    weight: number;
    baseColor: string;
    activeColor: string;
    stroke: string;
    strokeWidth: number;
    uppercase: boolean;
    activeScale: number;
    glowColor?: string;
    glowBlur?: number;
    entrance?: "fade" | "pop" | "bounce" | "none";
    rowStart: number;
    rowEnd: number;
    shadowColor?: string;
    shadowBlur?: number;
    letterSpacing?: number;
    bgPill?: string; // optional pill background color (Box Pop)
  },
): { layers: Layer[]; nextId: number } {
  const layers: Layer[] = [];
  let id = startId;
  const renderWords = words.map((w) => (opts.uppercase ? w.word.toUpperCase() : w.word));
  const widths = renderWords.map((w) => estimateWordWidth(w, opts.fontSize, opts.weight));
  const space = opts.fontSize * 0.32;
  const total = widths.reduce((a, b) => a + b, 0) + space * Math.max(0, words.length - 1);
  let cursor = (comp.width - total) / 2 + widths[0] / 2;

  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const xNorm = cursor / comp.width;
    const wordStart = Math.max(opts.rowStart, w.startTime) - opts.rowStart;
    const wordEnd = Math.min(opts.rowEnd, w.endTime) - opts.rowStart;
    const popDur = 0.1;

    // Entrance animations (relative to row start)
    const entrance: TextLayer["animations"] = [];
    if (opts.entrance === "pop" || opts.entrance === "bounce") {
      const from = opts.entrance === "bounce" ? 0.4 : 0.7;
      const peak = opts.entrance === "bounce" ? 1.18 : 1.08;
      const ease = opts.entrance === "bounce" ? "spring" : "spring";
      entrance.push(
        { prop: "opacity", from: 0, to: 1, start: 0, end: 0.12, ease: "easeOut" },
        { prop: "scale", from, to: peak, start: 0, end: popDur + 0.04, ease },
        { prop: "scale", from: peak, to: 1, start: popDur + 0.04, end: popDur + 0.14, ease: "easeOut" },
      );
    } else if (opts.entrance === "fade") {
      entrance.push({ prop: "opacity", from: 0, to: 1, start: 0, end: 0.16, ease: "easeOut" });
    } else {
      entrance.push({ prop: "opacity", from: 0, to: 1, start: 0, end: 0.05, ease: "linear" });
    }

    // Active pulse (when this word is being spoken)
    const active: TextLayer["animations"] = [];
    if (wordEnd > wordStart) {
      const pulseUp = 0.06;
      const pulseDown = Math.max(pulseUp + 0.04, wordEnd - wordStart);
      active.push(
        { prop: "scale", from: 1, to: opts.activeScale, start: wordStart, end: wordStart + pulseUp, ease: "easeOut" },
        { prop: "scale", from: opts.activeScale, to: 1, start: pulseDown, end: pulseDown + 0.12, ease: "easeOut" },
      );
    }

    layers.push({
      id: `${CAP_PREFIX}${id++}`,
      type: "text",
      text: renderWords[i],
      uppercase: false,
      start: opts.rowStart,
      end: opts.rowEnd,
      x: xNorm,
      y: opts.y,
      anchor: "center",
      fontFamily: opts.fontFamily,
      fontSize: opts.fontSize,
      fontWeight: opts.weight,
      color: opts.baseColor,
      stroke: opts.stroke,
      strokeWidth: opts.strokeWidth,
      shadowColor: opts.shadowColor,
      shadowBlur: opts.shadowBlur,
      letterSpacing: opts.letterSpacing,
      bgColor: opts.bgPill,
      padding: opts.bgPill ? Math.round(opts.fontSize * 0.18) : undefined,
      borderRadius: opts.bgPill ? Math.round(opts.fontSize * 0.25) : undefined,
      align: "center",
      maxWidthPct: 0.42,
      animations: entrance,
    } as TextLayer);

    // Overlay the SAME word in active color + glow, fading in only during active window.
    const activeOnly: TextLayer["animations"] = [
      { prop: "opacity", from: 0, to: 1, start: wordStart - 0.04, end: wordStart + 0.04, ease: "easeOut" },
      { prop: "opacity", from: 1, to: 0, start: wordEnd, end: wordEnd + 0.12, ease: "easeOut" },
      ...active,
    ];
    layers.push({
      id: `${CAP_PREFIX}${id++}`,
      type: "text",
      text: renderWords[i],
      uppercase: false,
      start: opts.rowStart,
      end: opts.rowEnd,
      x: xNorm,
      y: opts.y,
      anchor: "center",
      fontFamily: opts.fontFamily,
      fontSize: opts.fontSize,
      fontWeight: opts.weight,
      color: opts.activeColor,
      stroke: opts.stroke,
      strokeWidth: opts.strokeWidth,
      shadowColor: opts.glowColor ?? opts.shadowColor,
      shadowBlur: opts.glowBlur ?? opts.shadowBlur,
      letterSpacing: opts.letterSpacing,
      bgColor: opts.bgPill,
      padding: opts.bgPill ? Math.round(opts.fontSize * 0.18) : undefined,
      borderRadius: opts.bgPill ? Math.round(opts.fontSize * 0.25) : undefined,
      align: "center",
      maxWidthPct: 0.42,
      animations: activeOnly,
    } as TextLayer);

    if (i < words.length - 1) {
      cursor += widths[i] / 2 + space + widths[i + 1] / 2;
    }
  }
  return { layers, nextId: id };
}

function buildChunkedRowPreset(
  segments: CaptionSegment[],
  comp: HyperframesComposition,
  cfg: {
    chunkSize: number;
    y: number;
    fontFamily: string;
    weight: number;
    fontSizePct: number; // of comp.height
    baseColor: string;
    activeColor: string;
    stroke: string;
    strokeWidthPct: number; // of fontSize
    uppercase: boolean;
    activeScale: number;
    glowColor?: string;
    glowBlurPct?: number; // of fontSize
    entrance: "fade" | "pop" | "bounce" | "none";
    shadowColor?: string;
    shadowBlurPct?: number;
    letterSpacingPct?: number;
    bgPill?: string;
  },
): Layer[] {
  const fontSize = Math.round(comp.height * cfg.fontSizePct);
  const stroke = Math.max(3, Math.round(fontSize * cfg.strokeWidthPct));
  const shadowBlur = cfg.shadowBlurPct ? Math.round(fontSize * cfg.shadowBlurPct) : undefined;
  const glowBlur = cfg.glowBlurPct ? Math.round(fontSize * cfg.glowBlurPct) : undefined;
  const letterSpacing = cfg.letterSpacingPct ? Math.round(fontSize * cfg.letterSpacingPct) : undefined;
  const out: Layer[] = [];
  let id = 0;
  for (const seg of segments) {
    const words = ensureWords(seg);
    for (const group of chunkWords(words, cfg.chunkSize)) {
      if (!group.length) continue;
      const rowStart = Math.max(0, group[0].startTime - LEAD);
      const rowEnd = Math.min(comp.duration, group[group.length - 1].endTime + TAIL + 0.08);
      const { layers, nextId } = layoutWordRow(comp, group, id, {
        y: cfg.y,
        fontSize,
        fontFamily: cfg.fontFamily,
        weight: cfg.weight,
        baseColor: cfg.baseColor,
        activeColor: cfg.activeColor,
        stroke: cfg.stroke,
        strokeWidth: stroke,
        uppercase: cfg.uppercase,
        activeScale: cfg.activeScale,
        glowColor: cfg.glowColor,
        glowBlur,
        entrance: cfg.entrance,
        rowStart,
        rowEnd,
        shadowColor: cfg.shadowColor,
        shadowBlur,
        letterSpacing,
        bgPill: cfg.bgPill,
      });
      out.push(...layers);
      id = nextId;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Presets — viral
// ---------------------------------------------------------------------------

export function buildHormoziLayers(segments: CaptionSegment[], comp: HyperframesComposition): Layer[] {
  return buildChunkedRowPreset(segments, comp, {
    chunkSize: 3,
    y: 0.72,
    fontFamily: FONT_MONTSERRAT,
    weight: 900,
    fontSizePct: 0.075,
    baseColor: "#FFFFFF",
    activeColor: "#FFD93D",
    stroke: "#000000",
    strokeWidthPct: 0.14,
    uppercase: true,
    activeScale: 1.08,
    entrance: "pop",
    shadowColor: "rgba(0,0,0,0.55)",
    shadowBlurPct: 0.18,
    letterSpacingPct: -0.01,
  });
}

export function buildMrBeastLayers(segments: CaptionSegment[], comp: HyperframesComposition): Layer[] {
  return buildChunkedRowPreset(segments, comp, {
    chunkSize: 3,
    y: 0.7,
    fontFamily: FONT_BLOCK,
    weight: 900,
    fontSizePct: 0.085,
    baseColor: "#FFFFFF",
    activeColor: "#39FF14",
    stroke: "#000000",
    strokeWidthPct: 0.16,
    uppercase: true,
    activeScale: 1.18,
    glowColor: "rgba(57,255,20,0.7)",
    glowBlurPct: 0.4,
    entrance: "pop",
    shadowColor: "rgba(0,0,0,0.6)",
    shadowBlurPct: 0.18,
  });
}

export function buildThreePopLayers(segments: CaptionSegment[], comp: HyperframesComposition): Layer[] {
  return buildChunkedRowPreset(segments, comp, {
    chunkSize: 3,
    y: 0.65,
    fontFamily: FONT_MONTSERRAT,
    weight: 900,
    fontSizePct: 0.085,
    baseColor: "#FFFFFF",
    activeColor: "#FF2D78",
    stroke: "#000000",
    strokeWidthPct: 0.14,
    uppercase: true,
    activeScale: 1.2,
    glowColor: "rgba(255,45,120,0.6)",
    glowBlurPct: 0.35,
    entrance: "bounce",
    shadowColor: "rgba(0,0,0,0.55)",
    shadowBlurPct: 0.18,
  });
}

export function buildViralGlowLayers(segments: CaptionSegment[], comp: HyperframesComposition): Layer[] {
  return buildChunkedRowPreset(segments, comp, {
    chunkSize: 3,
    y: 0.72,
    fontFamily: FONT_MONTSERRAT,
    weight: 900,
    fontSizePct: 0.075,
    baseColor: "#FFFFFF",
    activeColor: "#24E6FF",
    stroke: "#0B1530",
    strokeWidthPct: 0.12,
    uppercase: true,
    activeScale: 1.12,
    glowColor: "rgba(36,230,255,0.85)",
    glowBlurPct: 0.5,
    entrance: "pop",
    shadowColor: "rgba(0,0,0,0.55)",
    shadowBlurPct: 0.2,
  });
}

export function buildWordPopLayers(segments: CaptionSegment[], comp: HyperframesComposition): Layer[] {
  const out: Layer[] = [];
  const fontSize = Math.round(comp.height * 0.085);
  const stroke = Math.max(5, Math.round(fontSize * 0.14));
  let i = 0;
  for (const seg of segments) {
    for (const w of ensureWords(seg)) {
      const start = Math.max(0, w.startTime - LEAD);
      const end = Math.min(comp.duration, w.endTime + TAIL);
      const dur = Math.max(0.18, end - start);
      const popDur = Math.min(0.18, dur * 0.45);
      out.push({
        id: `${CAP_PREFIX}${i++}`,
        type: "text",
        text: w.word.toUpperCase(),
        uppercase: false,
        start,
        end,
        x: 0.5,
        y: 0.72,
        anchor: "center",
        fontFamily: FONT_MONTSERRAT,
        fontSize,
        fontWeight: 900,
        color: "#FFFFFF",
        stroke: "#000000",
        strokeWidth: stroke,
        shadowColor: "rgba(0,0,0,0.6)",
        shadowBlur: Math.round(fontSize * 0.22),
        align: "center",
        maxWidthPct: 0.92,
        animations: [
          { prop: "opacity", from: 0, to: 1, start: 0, end: popDur * 0.5, ease: "easeOut" },
          { prop: "scale", from: 0.6, to: 1.15, start: 0, end: popDur, ease: "spring" },
          { prop: "scale", from: 1.15, to: 1, start: popDur, end: popDur + 0.1, ease: "easeOut" },
          { prop: "opacity", from: 1, to: 0, start: dur - 0.12, end: dur, ease: "easeIn" },
        ],
      } as TextLayer);
    }
  }
  return out;
}

export function buildBounceLayers(segments: CaptionSegment[], comp: HyperframesComposition): Layer[] {
  return buildChunkedRowPreset(segments, comp, {
    chunkSize: 4,
    y: 0.75,
    fontFamily: FONT_POPPINS,
    weight: 900,
    fontSizePct: 0.065,
    baseColor: "#FFFFFF",
    activeColor: "#FFB400",
    stroke: "#000000",
    strokeWidthPct: 0.12,
    uppercase: false,
    activeScale: 1.15,
    entrance: "bounce",
    shadowColor: "rgba(0,0,0,0.5)",
    shadowBlurPct: 0.2,
  });
}

export function buildTypewriterLayers(segments: CaptionSegment[], comp: HyperframesComposition): Layer[] {
  // Words appear sequentially and STAY visible until the phrase ends.
  const fontSize = Math.round(comp.height * 0.06);
  const stroke = Math.max(4, Math.round(fontSize * 0.12));
  const out: Layer[] = [];
  let id = 0;
  for (const seg of segments) {
    const words = ensureWords(seg);
    if (!words.length) continue;
    const segEnd = Math.min(comp.duration, seg.endTime + 0.2);
    const renderWords = words.map((w) => w.word.toUpperCase());
    const widths = renderWords.map((w) => estimateWordWidth(w, fontSize, 900));
    const space = fontSize * 0.32;
    const total = widths.reduce((a, b) => a + b, 0) + space * Math.max(0, words.length - 1);
    let cursor = (comp.width - total) / 2 + widths[0] / 2;
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      const xNorm = cursor / comp.width;
      const startT = Math.max(0, w.startTime - LEAD);
      out.push({
        id: `${CAP_PREFIX}${id++}`,
        type: "text",
        text: renderWords[i],
        uppercase: false,
        start: startT,
        end: segEnd,
        x: xNorm,
        y: 0.78,
        anchor: "center",
        fontFamily: "ui-monospace, 'JetBrains Mono', 'IBM Plex Mono', SFMono-Regular, Menlo, monospace",
        fontSize,
        fontWeight: 800,
        color: "#FFFFFF",
        stroke: "#000000",
        strokeWidth: stroke,
        shadowColor: "rgba(0,0,0,0.6)",
        shadowBlur: Math.round(fontSize * 0.2),
        align: "center",
        maxWidthPct: 0.42,
        animations: [
          { prop: "opacity", from: 0, to: 1, start: 0, end: 0.08, ease: "easeOut" },
        ],
      } as TextLayer);
      if (i < words.length - 1) cursor += widths[i] / 2 + space + widths[i + 1] / 2;
    }
  }
  return out;
}

export function buildOneWordLayers(segments: CaptionSegment[], comp: HyperframesComposition): Layer[] {
  const out: Layer[] = [];
  const fontSize = Math.round(comp.height * 0.13);
  const stroke = Math.max(8, Math.round(fontSize * 0.13));
  let i = 0;
  for (const seg of segments) {
    for (const w of ensureWords(seg)) {
      const start = Math.max(0, w.startTime - LEAD);
      const end = Math.min(comp.duration, w.endTime + 0.05);
      const dur = Math.max(0.16, end - start);
      out.push({
        id: `${CAP_PREFIX}${i++}`,
        type: "text",
        text: w.word.toUpperCase(),
        uppercase: false,
        start,
        end,
        x: 0.5,
        y: 0.5,
        anchor: "center",
        fontFamily: FONT_ANTON,
        fontSize,
        fontWeight: 900,
        color: "#FFFFFF",
        stroke: "#000000",
        strokeWidth: stroke,
        shadowColor: "rgba(0,0,0,0.7)",
        shadowBlur: Math.round(fontSize * 0.22),
        align: "center",
        maxWidthPct: 0.95,
        animations: [
          { prop: "opacity", from: 0, to: 1, start: 0, end: 0.08, ease: "easeOut" },
          { prop: "scale", from: 0.82, to: 1.06, start: 0, end: 0.14, ease: "spring" },
          { prop: "scale", from: 1.06, to: 1, start: 0.14, end: 0.22, ease: "easeOut" },
          { prop: "opacity", from: 1, to: 0, start: dur - 0.08, end: dur, ease: "easeIn" },
        ],
      } as TextLayer);
    }
  }
  return out;
}

export function buildGoldenCueLayers(segments: CaptionSegment[], comp: HyperframesComposition): Layer[] {
  return buildChunkedRowPreset(segments, comp, {
    chunkSize: 4,
    y: 0.78,
    fontFamily: FONT_SERIF,
    weight: 400,
    fontSizePct: 0.055,
    baseColor: "#F5EFE0",
    activeColor: "#E4B14A",
    stroke: "#1A1108",
    strokeWidthPct: 0.08,
    uppercase: false,
    activeScale: 1.08,
    glowColor: "rgba(228,177,74,0.55)",
    glowBlurPct: 0.35,
    entrance: "fade",
    shadowColor: "rgba(0,0,0,0.55)",
    shadowBlurPct: 0.2,
  });
}

export function buildBoxPopLayers(segments: CaptionSegment[], comp: HyperframesComposition): Layer[] {
  const out: Layer[] = [];
  const fontSize = Math.round(comp.height * 0.07);
  let i = 0;
  for (const seg of segments) {
    for (const w of ensureWords(seg)) {
      const start = Math.max(0, w.startTime - LEAD);
      const end = Math.min(comp.duration, w.endTime + 0.08);
      const dur = Math.max(0.18, end - start);
      out.push({
        id: `${CAP_PREFIX}${i++}`,
        type: "text",
        text: w.word.toUpperCase(),
        uppercase: false,
        start,
        end,
        x: 0.5,
        y: 0.72,
        anchor: "center",
        fontFamily: FONT_BOOGALOO,
        fontSize,
        fontWeight: 800,
        color: "#0B1530",
        bgColor: "#FFD93D",
        padding: Math.round(fontSize * 0.22),
        borderRadius: Math.round(fontSize * 0.3),
        stroke: "#0B1530",
        strokeWidth: 0,
        shadowColor: "rgba(0,0,0,0.45)",
        shadowBlur: Math.round(fontSize * 0.2),
        align: "center",
        maxWidthPct: 0.85,
        animations: [
          { prop: "opacity", from: 0, to: 1, start: 0, end: 0.08, ease: "easeOut" },
          { prop: "scale", from: 0.5, to: 1.12, start: 0, end: 0.14, ease: "spring" },
          { prop: "scale", from: 1.12, to: 1, start: 0.14, end: 0.22, ease: "easeOut" },
          { prop: "opacity", from: 1, to: 0, start: dur - 0.1, end: dur, ease: "easeIn" },
        ],
      } as TextLayer);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Legacy presets — kept for backwards compatibility
// ---------------------------------------------------------------------------

export function buildSimpleMonoLayers(segments: CaptionSegment[], comp: HyperframesComposition): Layer[] {
  const layers: Layer[] = [];
  const fontSize = Math.round(comp.height * 0.085);
  const stroke = Math.max(6, Math.round(fontSize * 0.14));
  let i = 0;
  for (const seg of segments) {
    for (const w of ensureWords(seg)) {
      const start = Math.max(0, w.startTime - LEAD);
      const end = Math.min(comp.duration, w.endTime + 0.04);
      const dur = Math.max(0.12, end - start);
      const popDur = Math.min(0.16, dur * 0.5);
      layers.push({
        id: `${CAP_PREFIX}${i++}`,
        type: "text",
        text: w.word,
        uppercase: true,
        start,
        end,
        x: 0.5,
        y: 0.5,
        anchor: "center",
        fontFamily: FONT_ANTON,
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

export function buildViralPopLayers(segments: CaptionSegment[], comp: HyperframesComposition): Layer[] {
  const layers: Layer[] = [];
  const fontSize = Math.round(comp.height * 0.08);
  const stroke = Math.max(5, Math.round(fontSize * 0.12));
  let i = 0;
  for (const seg of segments) {
    for (const w of ensureWords(seg)) {
      const start = Math.max(0, w.startTime - LEAD);
      const end = Math.min(comp.duration, w.endTime + 0.05);
      const dur = Math.max(0.12, end - start);
      const popDur = Math.min(0.18, dur * 0.45);
      layers.push({
        id: `${CAP_PREFIX}${i++}`,
        type: "text",
        text: w.word,
        uppercase: true,
        start,
        end,
        x: 0.5,
        y: 0.78,
        anchor: "center",
        fontFamily: FONT_ANTON,
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

export function buildKaraokeLineLayers(segments: CaptionSegment[], comp: HyperframesComposition): Layer[] {
  return buildChunkedRowPreset(segments, comp, {
    chunkSize: 100, // whole segment as one row
    y: 0.78,
    fontFamily: FONT_MONTSERRAT,
    weight: 900,
    fontSizePct: 0.06,
    baseColor: "#FFFFFF",
    activeColor: "#FFD93D",
    stroke: "#000000",
    strokeWidthPct: 0.12,
    uppercase: true,
    activeScale: 1.18,
    entrance: "fade",
    shadowColor: "rgba(0,0,0,0.6)",
    shadowBlurPct: 0.2,
  });
}

export function buildStackedBoldLayers(segments: CaptionSegment[], comp: HyperframesComposition): Layer[] {
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
    const start = Math.max(0, seg.startTime - LEAD);
    const end = Math.min(comp.duration, seg.endTime + 0.08);
    const popDur = 0.22;

    const common = {
      start,
      end,
      anchor: "center" as const,
      fontFamily: FONT_ANTON,
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
        id: `${CAP_PREFIX}${i++}`, type: "text", text: before, uppercase: false,
        x: 0.5, y: 0.36, fontSize: baseSize, color: "#FFFFFF", ...common,
      } as TextLayer);
    }
    layers.push({
      id: `${CAP_PREFIX}${i++}`, type: "text", text: accent, uppercase: true,
      x: 0.5, y: 0.5, fontSize: accentSize, color: "#F5C24B", ...common,
    } as TextLayer);
    if (after) {
      layers.push({
        id: `${CAP_PREFIX}${i++}`, type: "text", text: after, uppercase: true,
        x: 0.5, y: 0.64, fontSize: baseSize, color: "#FFFFFF", ...common,
      } as TextLayer);
    }
  }
  return layers;
}

export function buildAdvancedCinematicLayers(segments: CaptionSegment[], comp: HyperframesComposition): Layer[] {
  const layers: Layer[] = [];
  const smallSize = Math.round(comp.height * 0.055);
  const accentSize = Math.round(comp.height * 0.13);
  const suffixSize = Math.round(comp.height * 0.075);
  const strokeBase = Math.max(5, Math.round(smallSize * 0.18));
  const accentColors = ["#F5C24B", "#E85A2A", "#FFFFFF"];
  let i = 0;
  let phraseIdx = 0;
  for (const seg of segments) {
    const words = ensureWords(seg);
    if (!words.length) continue;
    const accentIdx = pickAccentIndex(words);
    const before = words.slice(0, accentIdx).map((w) => w.word).join(" ");
    const accent = words[accentIdx].word;
    const after = words.slice(accentIdx + 1).map((w) => w.word).join(" ");
    const start = Math.max(0, seg.startTime - LEAD);
    const end = Math.min(comp.duration, seg.endTime + 0.1);
    const accentColor = accentColors[phraseIdx % accentColors.length];
    const tilt = ((phraseIdx % 2 === 0) ? -1 : 1) * 2.5;
    phraseIdx++;
    const shadow = { shadowColor: "rgba(0,0,0,0.7)", shadowBlur: Math.round(accentSize * 0.18) };

    if (before) {
      layers.push({
        id: `${CAP_PREFIX}${i++}`, type: "text", text: before, uppercase: false,
        start, end, x: 0.5, y: 0.28, anchor: "center",
        fontFamily: FONT_SERIF, fontSize: smallSize, fontWeight: 600,
        color: "#FFFFFF", stroke: "#000000",
        strokeWidth: Math.max(3, Math.round(strokeBase * 0.7)),
        ...shadow, align: "center", maxWidthPct: 0.85,
        animations: [
          { prop: "opacity", from: 0, to: 1, start: 0, end: 0.18, ease: "easeOut" },
          { prop: "y", from: 0.04, to: 0, start: 0, end: 0.24, ease: "easeOut" },
        ],
      } as TextLayer);
    }
    layers.push({
      id: `${CAP_PREFIX}${i++}`, type: "text", text: accent, uppercase: true,
      start, end, x: 0.5, y: before && after ? 0.45 : before ? 0.5 : 0.42, anchor: "center",
      rotate: tilt, fontFamily: FONT_ANTON, fontSize: accentSize, fontWeight: 900,
      color: accentColor, stroke: "#000000",
      strokeWidth: Math.max(7, Math.round(strokeBase * 1.4)),
      ...shadow, align: "center", maxWidthPct: 0.96,
      animations: [
        { prop: "opacity", from: 0, to: 1, start: 0.05, end: 0.22, ease: "easeOut" },
        { prop: "scale", from: 0.55, to: 1.12, start: 0.05, end: 0.3, ease: "spring" },
        { prop: "scale", from: 1.12, to: 1, start: 0.3, end: 0.42, ease: "easeOut" },
      ],
    } as TextLayer);
    if (after) {
      layers.push({
        id: `${CAP_PREFIX}${i++}`, type: "text", text: after, uppercase: true,
        start, end, x: 0.5, y: 0.66, anchor: "center",
        rotate: -tilt * 0.4, fontFamily: FONT_ANTON, fontSize: suffixSize, fontWeight: 900,
        color: "#FFFFFF", stroke: "#000000",
        strokeWidth: Math.max(5, strokeBase),
        ...shadow, align: "center", maxWidthPct: 0.92,
        animations: [
          { prop: "opacity", from: 0, to: 1, start: 0.2, end: 0.4, ease: "easeOut" },
          { prop: "y", from: 0.05, to: 0, start: 0.2, end: 0.46, ease: "easeOut" },
        ],
      } as TextLayer);
    }
  }
  return layers;
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

export function applyCaptionPreset(
  comp: HyperframesComposition,
  segments: CaptionSegment[],
  preset: CaptionStyle | "none" = "hormozi",
): HyperframesComposition {
  const base = stripCaptionLayers(comp.layers);
  if (preset === "none") return { ...comp, layers: base };
  let caps: Layer[];
  switch (preset) {
    case "hormozi": caps = buildHormoziLayers(segments, comp); break;
    case "mrbeast": caps = buildMrBeastLayers(segments, comp); break;
    case "three-pop": caps = buildThreePopLayers(segments, comp); break;
    case "viral-glow": caps = buildViralGlowLayers(segments, comp); break;
    case "word-pop": caps = buildWordPopLayers(segments, comp); break;
    case "bounce": caps = buildBounceLayers(segments, comp); break;
    case "typewriter": caps = buildTypewriterLayers(segments, comp); break;
    case "one-word": caps = buildOneWordLayers(segments, comp); break;
    case "golden-cue": caps = buildGoldenCueLayers(segments, comp); break;
    case "box-pop": caps = buildBoxPopLayers(segments, comp); break;
    case "viral-pop": caps = buildViralPopLayers(segments, comp); break;
    case "karaoke-line": caps = buildKaraokeLineLayers(segments, comp); break;
    case "stacked-bold": caps = buildStackedBoldLayers(segments, comp); break;
    case "advanced-cinematic": caps = buildAdvancedCinematicLayers(segments, comp); break;
    case "simple-mono":
    default: caps = buildSimpleMonoLayers(segments, comp);
  }
  return { ...comp, layers: [...base, ...caps] };
}