import { useEffect, useImperativeHandle, useRef, forwardRef } from "react";
import {
  HyperframesComposition,
  Layer,
  TextLayer,
  IconLayer,
  RectLayer,
  VideoLayer,
  resolveLayer,
} from "./timeline";

export interface HyperframesCanvasHandle {
  play: () => void;
  pause: () => void;
  seek: (t: number) => void;
  getTime: () => number;
  getVideoEl: () => HTMLVideoElement | null;
  getCanvasEl: () => HTMLCanvasElement | null;
}

interface Props {
  comp: HyperframesComposition;
  onTime?: (t: number) => void;
  onDuration?: (d: number) => void;
  className?: string;
  /** Force the canvas back to t=0 when this value changes (used during export). */
  exportTick?: number;
}

function applyAnchor(
  x: number,
  y: number,
  w: number,
  h: number,
  anchor: Layer["anchor"],
) {
  switch (anchor) {
    case "tl": return { x, y };
    case "tc": return { x: x - w / 2, y };
    case "tr": return { x: x - w, y };
    case "cl": return { x, y: y - h / 2 };
    case "cr": return { x: x - w, y: y - h / 2 };
    case "bl": return { x, y: y - h };
    case "bc": return { x: x - w / 2, y: y - h };
    case "br": return { x: x - w, y: y - h };
    case "center":
    default:
      return { x: x - w / 2, y: y - h / 2 };
  }
}

export const HyperframesCanvas = forwardRef<HyperframesCanvasHandle, Props>(function HyperframesCanvas(
  { comp, onTime, onDuration, className, exportTick },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const playingRef = useRef(false);
  const startWallRef = useRef(0);
  const startCompRef = useRef(0);
  const compTimeRef = useRef(0);
  const rafRef = useRef<number | null>(null);

  const videoLayer = comp.layers.find((l) => l.type === "video") as VideoLayer | undefined;

  // Keep the latest composition in a ref so the rAF loop doesn't need to re-bind.
  const compRef = useRef(comp);
  useEffect(() => {
    compRef.current = comp;
  }, [comp]);

  useImperativeHandle(ref, () => ({
    play: () => {
      const v = videoRef.current;
      if (v) v.play().catch(() => {});
      playingRef.current = true;
      startWallRef.current = performance.now();
      startCompRef.current = compTimeRef.current;
    },
    pause: () => {
      videoRef.current?.pause();
      playingRef.current = false;
    },
    seek: (t: number) => {
      const clamped = Math.max(0, Math.min(comp.duration, t));
      compTimeRef.current = clamped;
      startWallRef.current = performance.now();
      startCompRef.current = clamped;
      if (videoRef.current && videoLayer) {
        videoRef.current.currentTime = Math.max(0, clamped - videoLayer.start);
      }
    },
    getTime: () => compTimeRef.current,
    getVideoEl: () => videoRef.current,
    getCanvasEl: () => canvasRef.current,
  }));

  // Reset to 0 when exportTick toggles
  useEffect(() => {
    if (exportTick === undefined) return;
    compTimeRef.current = 0;
    if (videoRef.current) videoRef.current.currentTime = 0;
  }, [exportTick]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onMeta = () => onDuration?.(v.duration || comp.duration);
    v.addEventListener("loadedmetadata", onMeta);
    return () => v.removeEventListener("loadedmetadata", onMeta);
  }, [onDuration, comp.duration]);

  // Render loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const tick = () => {
      const c = compRef.current;
      if (playingRef.current) {
        const elapsed = (performance.now() - startWallRef.current) / 1000;
        compTimeRef.current = startCompRef.current + elapsed;
        if (compTimeRef.current >= c.duration) {
          compTimeRef.current = c.duration;
          playingRef.current = false;
          videoRef.current?.pause();
        }
      }
      drawFrame(ctx, c, compTimeRef.current, videoRef.current);
      onTime?.(compTimeRef.current);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [onTime]);

  return (
    <div className={className} style={{ position: "relative" }}>
      <canvas
        ref={canvasRef}
        width={comp.width}
        height={comp.height}
        style={{ width: "100%", height: "100%", display: "block", background: comp.bgColor }}
      />
      {videoLayer && (
        <video
          ref={videoRef}
          src={videoLayer.src}
          crossOrigin="anonymous"
          playsInline
          muted={false}
          preload="auto"
          style={{ position: "absolute", width: 1, height: 1, opacity: 0, pointerEvents: "none" }}
        />
      )}
    </div>
  );
});

function drawFrame(
  ctx: CanvasRenderingContext2D,
  comp: HyperframesComposition,
  t: number,
  videoEl: HTMLVideoElement | null,
) {
  ctx.save();
  ctx.fillStyle = comp.bgColor || "#000";
  ctx.fillRect(0, 0, comp.width, comp.height);

  for (const layer of comp.layers) {
    const r = resolveLayer(layer, t);
    if (!r.visible || r.opacity <= 0) continue;
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, r.opacity));

    const cx = layer.x * comp.width + r.dx * comp.width;
    const cy = layer.y * comp.height + r.dy * comp.height;

    ctx.translate(cx, cy);
    if (r.rotate) ctx.rotate((r.rotate * Math.PI) / 180);
    if (r.scale !== 1) ctx.scale(r.scale, r.scale);
    ctx.translate(-cx, -cy);

    if (layer.type === "video" && videoEl) {
      drawVideoLayer(ctx, comp, layer as VideoLayer, videoEl);
    } else if (layer.type === "text" || layer.type === "subtitle") {
      drawTextLayer(ctx, comp, layer as TextLayer, cx, cy);
    } else if (layer.type === "icon") {
      drawIconLayer(ctx, comp, layer as IconLayer, cx, cy);
    } else if (layer.type === "rect") {
      drawRectLayer(ctx, comp, layer as RectLayer, cx, cy);
    }
    ctx.restore();
  }
  ctx.restore();
}

function drawVideoLayer(
  ctx: CanvasRenderingContext2D,
  comp: HyperframesComposition,
  layer: VideoLayer,
  v: HTMLVideoElement,
) {
  if (!v.videoWidth) return;
  const fit = layer.fit ?? "cover";
  const cw = comp.width;
  const ch = comp.height;
  const vr = v.videoWidth / v.videoHeight;
  const cr = cw / ch;
  let dw = cw;
  let dh = ch;
  if ((fit === "cover" && vr > cr) || (fit === "contain" && vr < cr)) {
    dh = ch;
    dw = ch * vr;
  } else {
    dw = cw;
    dh = cw / vr;
  }
  const dx = (cw - dw) / 2;
  const dy = (ch - dh) / 2;
  ctx.drawImage(v, dx, dy, dw, dh);
}

function drawTextLayer(
  ctx: CanvasRenderingContext2D,
  comp: HyperframesComposition,
  layer: TextLayer,
  cx: number,
  cy: number,
) {
  const fontSize = layer.fontSize ?? Math.round(comp.width * 0.05);
  const fontFamily = layer.fontFamily || "Space Grotesk, Inter, system-ui, sans-serif";
  const weight = layer.fontWeight ?? 700;
  ctx.font = `${weight} ${fontSize}px ${fontFamily}`;
  ctx.textBaseline = "top";

  const maxWidth = (layer.maxWidthPct ?? 0.9) * comp.width;
  const rawText = layer.uppercase ? layer.text.toUpperCase() : layer.text;
  const lines = wrapText(ctx, rawText, maxWidth);
  const lineHeight = Math.round(fontSize * 1.15);
  const padding = layer.padding ?? Math.round(fontSize * 0.4);
  const align = layer.align ?? "center";

  const widths = lines.map((l) => ctx.measureText(l).width);
  const boxW = Math.min(maxWidth, Math.max(...widths)) + padding * 2;
  const boxH = lines.length * lineHeight + padding * 2;

  const { x: bx, y: by } = applyAnchor(cx, cy, boxW, boxH, layer.anchor || "center");

  if (layer.bgColor) {
    const r = layer.borderRadius ?? Math.round(fontSize * 0.2);
    roundRect(ctx, bx, by, boxW, boxH, r);
    ctx.fillStyle = layer.bgColor;
    ctx.fill();
  }

  const fillColor = layer.color || "#fff";
  const strokeColor = layer.stroke;
  const strokeWidth = layer.strokeWidth ?? 0;
  const shadowColor = layer.shadowColor;
  const shadowBlur = layer.shadowBlur ?? 0;
  lines.forEach((line, i) => {
    const w = widths[i];
    let tx = bx + padding;
    if (align === "center") tx = bx + (boxW - w) / 2;
    if (align === "right") tx = bx + boxW - padding - w;
    const ty = by + padding + i * lineHeight;
    // shadow pass
    if (shadowColor && shadowBlur > 0) {
      ctx.save();
      ctx.shadowColor = shadowColor;
      ctx.shadowBlur = shadowBlur;
      ctx.shadowOffsetY = Math.round(fontSize * 0.04);
      ctx.fillStyle = fillColor;
      ctx.fillText(line, tx, ty);
      ctx.restore();
    }
    // stroke pass (drawn BEFORE fill so fill sits on top)
    if (strokeColor && strokeWidth > 0) {
      ctx.save();
      ctx.lineJoin = "round";
      ctx.miterLimit = 2;
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = strokeWidth;
      ctx.strokeText(line, tx, ty);
      ctx.restore();
    }
    ctx.fillStyle = fillColor;
    ctx.fillText(line, tx, ty);
  });
}

function drawIconLayer(
  ctx: CanvasRenderingContext2D,
  comp: HyperframesComposition,
  layer: IconLayer,
  cx: number,
  cy: number,
) {
  const size = layer.size ?? Math.round(comp.width * 0.1);
  ctx.font = `${size}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", system-ui, sans-serif`;
  ctx.textBaseline = "top";
  const w = ctx.measureText(layer.glyph).width;
  const h = size;
  const { x, y } = applyAnchor(cx, cy, w, h, layer.anchor || "center");
  if (layer.color) ctx.fillStyle = layer.color;
  ctx.fillText(layer.glyph, x, y);
}

function drawRectLayer(
  ctx: CanvasRenderingContext2D,
  comp: HyperframesComposition,
  layer: RectLayer,
  cx: number,
  cy: number,
) {
  const w = layer.width * comp.width;
  const h = layer.height * comp.height;
  const { x, y } = applyAnchor(cx, cy, w, h, layer.anchor || "center");
  const r = layer.borderRadius ?? 0;
  roundRect(ctx, x, y, w, h, r);
  ctx.fillStyle = layer.color;
  ctx.fill();
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    const words = para.split(/\s+/);
    let line = "";
    for (const w of words) {
      const trial = line ? `${line} ${w}` : w;
      if (ctx.measureText(trial).width > maxWidth && line) {
        out.push(line);
        line = w;
      } else {
        line = trial;
      }
    }
    if (line) out.push(line);
  }
  return out;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}