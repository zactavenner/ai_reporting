import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { FileWarning, Loader2, Send } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

/**
 * Burn a fine-print disclaimer onto the bottom of a creative (image or video).
 * - Toggle white or black text
 * - Resize via slider (font size in px @ 1080-ref)
 * - Drag the vertical position slider to place the disclaimer
 * - "Add Disclaimer" burns the text and saves a new canvas card; original stays.
 */

export const DEFAULT_DISCLAIMER_TEXT =
  "Accredited investors only. All investments involve risk, including loss of principal. Projections are not guaranteed. See offering documents for complete terms and risks.";

const INTER_TTF =
  "https://fonts.gstatic.com/s/inter/v18/UcCO3FwrK3iLTeHuS_nVMrMxCp50ojIw2boKoduKmMEVuLyfMZg.ttf";

function fmtAss(t: number) {
  if (t < 0) t = 0;
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = Math.floor(t % 60);
  const cs = Math.floor((t - Math.floor(t)) * 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

function hexToAss(hex: string, alpha = 0): string {
  const h = hex.replace("#", "").padStart(6, "0");
  const r = h.slice(0, 2), g = h.slice(2, 4), b = h.slice(4, 6);
  const a = alpha.toString(16).padStart(2, "0").toUpperCase();
  return `&H${a}${b.toUpperCase()}${g.toUpperCase()}${r.toUpperCase()}`;
}

function buildDisclaimerAss(opts: {
  text: string;
  width: number;
  height: number;
  textColor: string;
  fontSize: number;
  verticalPct: number;
  duration: number;
}) {
  const { text, width, height, textColor, fontSize, verticalPct, duration } = opts;
  const primary = hexToAss(textColor);
  // Subtle contrasting shadow so the text stays legible on any backdrop.
  const shadow = textColor.toUpperCase() === "#FFFFFF" ? hexToAss("#000000", 80) : hexToAss("#FFFFFF", 80);
  const header = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    "WrapStyle: 0",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Disc,Inter,${fontSize},${primary},${primary},${shadow},${shadow},0,0,0,0,100,100,0,0,1,1,1,2,40,40,40,1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ].join("\n");
  const xPos = Math.round(width / 2);
  const yPos = Math.round(height * verticalPct);
  const wrapWidth = Math.round(width * 0.86);
  const safe = text.replace(/[{}]/g, "").replace(/\r?\n/g, "\\N");
  const line = `Dialogue: 0,${fmtAss(0)},${fmtAss(duration)},Disc,,0,0,0,,{\\pos(${xPos},${yPos})\\an5\\q2}${safe}`;
  // Force a soft wrap by inserting line breaks at roughly wrapWidth px — libass handles word wrap with \q2 + WrapStyle 0
  void wrapWidth;
  return header + "\n" + line + "\n";
}

function wrapTextOnCanvas(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const trial = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(trial).width > maxWidth && cur) {
      lines.push(cur);
      cur = w;
    } else cur = trial;
  }
  if (cur) lines.push(cur);
  return lines;
}

export function SimpleDisclaimerDialog({
  open,
  onOpenChange,
  target,
  clientId,
  conversationId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: { kind: "image" | "video"; url: string; aspect_ratio?: string; prompt?: string } | null;
  clientId: string;
  conversationId: string | null;
}) {
  const [text, setText] = useState(DEFAULT_DISCLAIMER_TEXT);
  const [textColor, setTextColor] = useState<"#FFFFFF" | "#000000">("#FFFFFF");
  const [fontSize, setFontSize] = useState(22);
  const [position, setPosition] = useState(95); // 0-100, % from top
  const [meta, setMeta] = useState<{ width: number; height: number; duration?: number } | null>(null);
  const [rendering, setRendering] = useState(false);
  const [renderProgress, setRenderProgress] = useState(0);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (!open) {
      setMeta(null);
      setRenderProgress(0);
      setRendering(false);
    }
  }, [open]);

  const previewStyle = useMemo<React.CSSProperties>(() => ({
    color: textColor,
    textShadow: textColor === "#FFFFFF" ? "0 1px 2px rgba(0,0,0,0.7)" : "0 1px 2px rgba(255,255,255,0.7)",
    fontFamily: "'Inter', system-ui, sans-serif",
    fontWeight: 500,
    fontSize: `clamp(8px, ${(fontSize / 1080) * 100}cqw, ${fontSize * 1.5}px)`,
    top: `${position}%`,
    transform: "translate(-50%, -50%)",
    left: "50%",
    maxWidth: "86%",
    textAlign: "center",
    lineHeight: 1.25,
  }), [textColor, fontSize, position]);

  const burnImage = useCallback(async () => {
    if (!target || target.kind !== "image") return;
    setRendering(true);
    try {
      // Load the original image
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const i = new Image();
        i.crossOrigin = "anonymous";
        i.onload = () => resolve(i);
        i.onerror = () => reject(new Error("Could not load image (CORS)."));
        i.src = target.url;
      });
      const w = img.naturalWidth, h = img.naturalHeight;
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas 2D not available");
      ctx.drawImage(img, 0, 0, w, h);

      // Scale font from preview reference (1080px height baseline) to actual image height
      const scaledFont = Math.max(10, Math.round((fontSize / 1080) * h));
      ctx.font = `500 ${scaledFont}px Inter, system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const maxWidth = Math.round(w * 0.86);
      const lines = wrapTextOnCanvas(ctx, text.trim(), maxWidth);
      const lineHeight = Math.round(scaledFont * 1.25);
      const totalH = lines.length * lineHeight;
      const cy = Math.round(h * (position / 100));
      const startY = cy - totalH / 2 + lineHeight / 2;

      // Soft contrast shadow for legibility on any backdrop
      ctx.shadowColor = textColor === "#FFFFFF" ? "rgba(0,0,0,0.7)" : "rgba(255,255,255,0.7)";
      ctx.shadowBlur = Math.max(2, Math.round(scaledFont * 0.12));
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = Math.max(1, Math.round(scaledFont * 0.05));
      ctx.fillStyle = textColor;
      lines.forEach((ln, i) => ctx.fillText(ln, w / 2, startY + i * lineHeight));

      // Encode + upload
      const blob: Blob = await new Promise((res, rej) =>
        canvas.toBlob((b) => (b ? res(b) : rej(new Error("Canvas encode failed"))), "image/png", 0.95)!,
      );
      const path = `ai-studio/${clientId}/disclaimer/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
      const up = await supabase.storage.from("creatives").upload(path, blob, { contentType: "image/png", upsert: false });
      if (up.error) throw up.error;
      const { data: pub } = supabase.storage.from("creatives").getPublicUrl(path);

      if (conversationId) {
        const { data: auth } = await supabase.auth.getUser();
        const userId = auth?.user?.id;
        const { error: insErr } = await supabase.from("ai_studio_canvas_items").insert({
          conversation_id: conversationId,
          user_id: userId,
          kind: "image",
          payload: {
            image_url: pub.publicUrl,
            storage_path: path,
            source: "disclaimer_burn",
            origin_image_url: target.url,
            aspect_ratio: target.aspect_ratio || `${w}:${h}`,
            prompt: target.prompt || "",
            disclaimer: {
              text: text.trim(),
              text_color: textColor,
              font_size: fontSize,
              vertical_position_pct: position,
            },
          },
        });
        if (insErr) throw insErr;
      }

      toast.success("Disclaimer burned in — new card added to canvas");
      onOpenChange(false);
    } catch (e: any) {
      console.error("burn disclaimer (image) failed", e);
      toast.error(`Render failed: ${e?.message || e}`);
    } finally {
      setRendering(false);
    }
  }, [target, text, textColor, fontSize, position, clientId, conversationId, onOpenChange]);

  const burnVideo = useCallback(async () => {
    if (!target || target.kind !== "video") return;
    setRendering(true);
    setRenderProgress(0);
    try {
      const { FFmpeg } = await import("@ffmpeg/ffmpeg");
      const { toBlobURL } = await import("@ffmpeg/util");
      const ff = new FFmpeg();
      const base = "https://unpkg.com/@ffmpeg/[email protected]/dist/umd";
      await ff.load({
        coreURL: await toBlobURL(`${base}/ffmpeg-core.js`, "text/javascript"),
        wasmURL: await toBlobURL(`${base}/ffmpeg-core.wasm`, "application/wasm"),
      });
      ff.on("progress", ({ progress }: { progress: number }) => setRenderProgress(Math.max(0, Math.min(1, progress))));

      const dl = await fetch(target.url);
      if (!dl.ok) throw new Error(`Video download failed (${dl.status})`);
      await ff.writeFile("in.mp4", new Uint8Array(await dl.arrayBuffer()));

      const fontRes = await fetch(INTER_TTF);
      if (!fontRes.ok) throw new Error(`Font download failed (${fontRes.status})`);
      await ff.writeFile("Inter.ttf", new Uint8Array(await fontRes.arrayBuffer()));

      const w = meta?.width || 1080;
      const h = meta?.height || 1920;
      const duration = meta?.duration && Number.isFinite(meta.duration) ? meta.duration : 60;

      // Scale font from 1080 reference to actual video height
      const scaledFont = Math.max(12, Math.round((fontSize / 1080) * h));

      const ass = buildDisclaimerAss({
        text: text.trim(),
        width: w,
        height: h,
        textColor,
        fontSize: scaledFont,
        verticalPct: position / 100,
        duration: duration + 0.5,
      });
      await ff.writeFile("disc.ass", new TextEncoder().encode(ass));

      await ff.exec([
        "-i", "in.mp4",
        "-vf", "subtitles=disc.ass:fontsdir=.",
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-crf", "20",
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        "-c:a", "copy",
        "out.mp4",
      ]);

      const outData = (await ff.readFile("out.mp4")) as Uint8Array;
      const outBlob = new Blob([outData as BlobPart], { type: "video/mp4" });
      const path = `ai-studio/${clientId}/disclaimer/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp4`;
      const up = await supabase.storage.from("creatives").upload(path, outBlob, { contentType: "video/mp4", upsert: false });
      if (up.error) throw up.error;
      const { data: pub } = supabase.storage.from("creatives").getPublicUrl(path);

      if (conversationId) {
        const { data: auth } = await supabase.auth.getUser();
        const userId = auth?.user?.id;
        const { error: insErr } = await supabase.from("ai_studio_canvas_items").insert({
          conversation_id: conversationId,
          user_id: userId,
          kind: "scene_video",
          payload: {
            video_url: pub.publicUrl,
            storage_path: path,
            source: "disclaimer_burn",
            origin_video_url: target.url,
            aspect_ratio: target.aspect_ratio || (w && h ? `${w}:${h}` : null),
            disclaimer: {
              text: text.trim(),
              text_color: textColor,
              font_size: fontSize,
              vertical_position_pct: position,
            },
            status: "completed",
          },
        });
        if (insErr) throw insErr;
      }

      toast.success("Disclaimer burned in — new card added to canvas");
      onOpenChange(false);
    } catch (e: any) {
      console.error("burn disclaimer (video) failed", e);
      toast.error(`Render failed: ${e?.message || e}`);
    } finally {
      setRendering(false);
      setRenderProgress(0);
    }
  }, [target, meta, text, textColor, fontSize, position, clientId, conversationId, onOpenChange]);

  if (!target) return null;
  const isVideo = target.kind === "video";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileWarning className="h-4 w-4" /> Add disclaimer
          </DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 md:grid-cols-[1fr_240px]">
          {/* Preview */}
          <div
            className="relative bg-black rounded-md overflow-hidden aspect-[9/16] max-h-[60vh] mx-auto w-full"
            style={{ containerType: "inline-size" }}
          >
            {isVideo ? (
              <video
                ref={videoRef}
                src={target.url}
                controls
                playsInline
                className="absolute inset-0 h-full w-full object-contain"
                onLoadedMetadata={(e) => {
                  const el = e.currentTarget;
                  setMeta({ width: el.videoWidth, height: el.videoHeight, duration: el.duration });
                }}
              />
            ) : (
              <img
                ref={imgRef}
                src={target.url}
                alt="Creative"
                className="absolute inset-0 h-full w-full object-contain"
                onLoad={(e) => {
                  const el = e.currentTarget;
                  setMeta({ width: el.naturalWidth, height: el.naturalHeight });
                }}
              />
            )}
            <div className="absolute pointer-events-none whitespace-pre-wrap" style={previewStyle}>
              {text}
            </div>
          </div>

          {/* Controls */}
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Disclaimer text</Label>
              <Textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={5}
                className="text-xs resize-none"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Text color</Label>
              <div className="grid grid-cols-2 gap-1">
                <button
                  type="button"
                  onClick={() => setTextColor("#FFFFFF")}
                  className={`h-8 rounded border text-xs font-medium transition ${
                    textColor === "#FFFFFF" ? "bg-primary text-primary-foreground border-primary" : "bg-card hover:bg-muted/50 border-input"
                  }`}
                >
                  White
                </button>
                <button
                  type="button"
                  onClick={() => setTextColor("#000000")}
                  className={`h-8 rounded border text-xs font-medium transition ${
                    textColor === "#000000" ? "bg-primary text-primary-foreground border-primary" : "bg-card hover:bg-muted/50 border-input"
                  }`}
                >
                  Black
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Size</Label>
                <span className="text-[10px] text-muted-foreground">{fontSize}px</span>
              </div>
              <Slider value={[fontSize]} min={10} max={64} step={1} onValueChange={(v) => setFontSize(v[0] ?? 22)} />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Vertical position</Label>
                <span className="text-[10px] text-muted-foreground">{position}%</span>
              </div>
              <Slider value={[position]} min={3} max={97} step={1} onValueChange={(v) => setPosition(v[0] ?? 95)} />
              <div className="flex justify-between text-[10px] text-muted-foreground">
                <span>Top</span><span>Middle</span><span>Bottom</span>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={rendering}>Cancel</Button>
          <Button
            onClick={isVideo ? burnVideo : burnImage}
            disabled={rendering || !text.trim()}
            className="gap-2"
          >
            {rendering ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {isVideo ? `Rendering ${Math.round(renderProgress * 100)}%` : "Rendering…"}
              </>
            ) : (
              <>
                <Send className="h-4 w-4" />
                Add Disclaimer
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}