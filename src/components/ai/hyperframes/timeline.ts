// Hyperframes-compatible timeline schema used by the in-browser editor.
// Mirrors the subset of the Hyperframes composition model that we author
// client-side: a base video layer + animated overlays (text, subtitles,
// icon glyphs, shapes). Coordinates are normalized 0..1 of canvas size.

export type Ease = "linear" | "easeIn" | "easeOut" | "easeInOut" | "spring";

export interface OverlayAnimation {
  prop: "opacity" | "x" | "y" | "scale" | "rotate";
  from: number;
  to: number;
  /** seconds, relative to layer start */
  start: number;
  /** seconds, relative to layer start */
  end: number;
  ease?: Ease;
}

export interface BaseLayer {
  id: string;
  type: "video" | "text" | "subtitle" | "icon" | "rect";
  /** seconds */
  start: number;
  /** seconds */
  end: number;
  /** 0..1 normalized x,y of the anchor point */
  x: number;
  y: number;
  anchor?: "tl" | "tc" | "tr" | "cl" | "center" | "cr" | "bl" | "bc" | "br";
  opacity?: number;
  scale?: number;
  rotate?: number;
  animations?: OverlayAnimation[];
}

export interface TextLayer extends BaseLayer {
  type: "text" | "subtitle";
  text: string;
  fontFamily?: string;
  fontWeight?: number | string;
  fontSize?: number; // px at composition size
  color?: string;
  bgColor?: string;
  padding?: number;
  borderRadius?: number;
  align?: "left" | "center" | "right";
  maxWidthPct?: number; // 0..1 of canvas width
}

export interface IconLayer extends BaseLayer {
  type: "icon";
  /** emoji or single glyph */
  glyph: string;
  size?: number;
  color?: string;
}

export interface RectLayer extends BaseLayer {
  type: "rect";
  width: number; // 0..1
  height: number; // 0..1
  color: string;
  borderRadius?: number;
}

export interface VideoLayer extends BaseLayer {
  type: "video";
  src: string;
  fit?: "cover" | "contain";
}

export type Layer = VideoLayer | TextLayer | IconLayer | RectLayer;

export interface HyperframesComposition {
  width: number;
  height: number;
  fps: number;
  /** seconds */
  duration: number;
  bgColor?: string;
  layers: Layer[];
}

export function makeDefaultComposition(
  videoSrc: string,
  duration: number,
  aspect: "9:16" | "16:9" | "1:1",
): HyperframesComposition {
  const { width, height } =
    aspect === "16:9"
      ? { width: 1280, height: 720 }
      : aspect === "1:1"
      ? { width: 720, height: 720 }
      : { width: 720, height: 1280 };
  return {
    width,
    height,
    fps: 30,
    duration,
    bgColor: "#000",
    layers: [
      {
        id: "base",
        type: "video",
        src: videoSrc,
        start: 0,
        end: duration,
        x: 0.5,
        y: 0.5,
        anchor: "center",
        fit: "cover",
      },
    ],
  };
}

function easeFn(e: Ease | undefined, t: number) {
  switch (e) {
    case "easeIn":
      return t * t;
    case "easeOut":
      return 1 - (1 - t) * (1 - t);
    case "easeInOut":
      return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    case "spring": {
      // Critically-damped-ish ease with mild overshoot
      const c = 1.70158;
      return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2);
    }
    case "linear":
    default:
      return t;
  }
}

/** Resolve a layer's effective transform/opacity at composition time `t` (seconds). */
export function resolveLayer(layer: Layer, t: number) {
  const local = t - layer.start;
  const visible = t >= layer.start && t <= layer.end;
  let opacity = layer.opacity ?? 1;
  let dx = 0;
  let dy = 0;
  let scale = layer.scale ?? 1;
  let rotate = layer.rotate ?? 0;
  for (const a of layer.animations || []) {
    if (local < a.start) {
      if (a.prop === "opacity") opacity = a.from;
      if (a.prop === "scale") scale = a.from;
      if (a.prop === "rotate") rotate = a.from;
      if (a.prop === "x") dx = a.from;
      if (a.prop === "y") dy = a.from;
      continue;
    }
    const span = Math.max(0.0001, a.end - a.start);
    const raw = Math.min(1, Math.max(0, (local - a.start) / span));
    const k = easeFn(a.ease, raw);
    const v = a.from + (a.to - a.from) * k;
    if (a.prop === "opacity") opacity = v;
    if (a.prop === "scale") scale = v;
    if (a.prop === "rotate") rotate = v;
    if (a.prop === "x") dx = v;
    if (a.prop === "y") dy = v;
  }
  return { visible, opacity, dx, dy, scale, rotate };
}