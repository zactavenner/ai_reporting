import type { Layer, HyperframesComposition, TextLayer } from "./timeline";

export type CaptionWord = { word: string; startTime: number; endTime: number };
export type CaptionSegment = {
  text: string;
  startTime: number;
  endTime: number;
  words?: CaptionWord[];
};

const CAP_PREFIX = "cap_";

export function stripCaptionLayers(layers: Layer[]): Layer[] {
  return layers.filter((l) => !l.id.startsWith(CAP_PREFIX));
}

/**
 * Viral-pop style: one BIG word at a time, white bold with thick black stroke
 * (via shadow), yellow highlight popping in with spring scale. No background.
 * Sits at y=0.78 (lower-third).
 */
export function buildViralPopLayers(
  segments: CaptionSegment[],
  comp: HyperframesComposition,
): Layer[] {
  const layers: Layer[] = [];
  const fontSize = Math.round(comp.height * 0.075); // ~7.5% of height
  let i = 0;
  for (const seg of segments) {
    const words = seg.words && seg.words.length > 0
      ? seg.words
      : seg.text
          .split(/\s+/)
          .filter(Boolean)
          .map((w, idx, arr) => {
            const span = (seg.endTime - seg.startTime) / arr.length;
            return {
              word: w,
              startTime: seg.startTime + idx * span,
              endTime: seg.startTime + (idx + 1) * span,
            };
          });
    for (const w of words) {
      const dur = Math.max(0.12, w.endTime - w.startTime);
      const popDur = Math.min(0.18, dur * 0.45);
      const layer: TextLayer = {
        id: `${CAP_PREFIX}${i++}`,
        type: "text",
        text: w.word.toUpperCase(),
        start: w.startTime,
        end: Math.min(comp.duration, w.endTime + 0.05),
        x: 0.5,
        y: 0.78,
        anchor: "center",
        fontSize,
        fontWeight: 900,
        color: "#FFEB3B", // yellow viral highlight
        align: "center",
        maxWidthPct: 0.9,
        animations: [
          { prop: "opacity", from: 0, to: 1, start: 0, end: popDur * 0.6, ease: "easeOut" },
          { prop: "scale", from: 0.6, to: 1.08, start: 0, end: popDur, ease: "spring" },
          { prop: "scale", from: 1.08, to: 1, start: popDur, end: popDur + 0.08, ease: "easeOut" },
        ],
      };
      layers.push(layer);
    }
  }
  return layers;
}

export function applyCaptionPreset(
  comp: HyperframesComposition,
  segments: CaptionSegment[],
  preset: "viral-pop" | "none" = "viral-pop",
): HyperframesComposition {
  const base = stripCaptionLayers(comp.layers);
  if (preset === "none") return { ...comp, layers: base };
  const caps = buildViralPopLayers(segments, comp);
  return { ...comp, layers: [...base, ...caps] };
}

export function hasCaptionLayers(comp: HyperframesComposition): boolean {
  return comp.layers.some((l) => l.id.startsWith(CAP_PREFIX));
}