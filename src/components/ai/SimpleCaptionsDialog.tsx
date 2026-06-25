import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Loader2, Subtitles, Download as DownloadIcon, Send } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { transcodeWebmToMp4 } from "./hyperframes/transcodeMp4";

/**
 * Simplified captions dialog.
 *
 * - One style: white pill background, black text, rounded, centered.
 * - Four controls: text color, background color, vertical position, font size.
 * - Auto-transcribe via existing `transcribe-video` edge function (word-level timestamps via Gemini).
 * - Live preview overlays an HTML caption layer on top of the original video.
 * - Export burns the captions into a new MP4 via ffmpeg.wasm + libass `subtitles` filter.
 *   The new MP4 is uploaded to the `creatives` bucket and inserted as a new
 *   `scene_video` canvas item so the original remains untouched.
 */

type Word = { word: string; startTime: number; endTime: number };
type Segment = { text?: string; startTime: number; endTime: number; words?: Word[] };

type Cue = { start: number; end: number; text: string };

const FONT_URL = "https://fonts.gstatic.com/s/inter/v18/UcCO3FwrK3iLTeHuS_nVMrMxCp50ojIw2boKoduKmMEVuLyfMZg.ttf";
const WORDS_PER_CUE = 3;

function buildCues(segments: Segment[]): Cue[] {
  const cues: Cue[] = [];
  for (const seg of segments) {
    const words = (seg.words || []).filter(w => Number.isFinite(w.startTime) && Number.isFinite(w.endTime));
    if (words.length === 0) {
      if (seg.text && Number.isFinite(seg.startTime) && Number.isFinite(seg.endTime)) {
        cues.push({ start: seg.startTime, end: seg.endTime, text: seg.text.trim().toUpperCase() });
      }
      continue;
    }
    for (let i = 0; i < words.length; i += WORDS_PER_CUE) {
      const chunk = words.slice(i, i + WORDS_PER_CUE);
      cues.push({
        start: chunk[0].startTime,
        end: chunk[chunk.length - 1].endTime,
        text: chunk.map(w => w.word).join(" ").trim().toUpperCase(),
      });
    }
  }
  return cues.sort((a, b) => a.start - b.start);
}

function fmtAss(t: number) {
  if (t < 0) t = 0;
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = Math.floor(t % 60);
  const cs = Math.floor((t - Math.floor(t)) * 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

// ASS color is &HAABBGGRR (alpha is inverted: 00 = opaque, FF = transparent).
function hexToAss(hex: string, alpha = 0): string {
  const h = hex.replace("#", "").padStart(6, "0");
  const r = h.slice(0, 2);
  const g = h.slice(2, 4);
  const b = h.slice(4, 6);
  const a = alpha.toString(16).padStart(2, "0").toUpperCase();
  return `&H${a}${b.toUpperCase()}${g.toUpperCase()}${r.toUpperCase()}`;
}

function buildAss(opts: {
  cues: Cue[];
  width: number;
  height: number;
  textColor: string;
  bgColor: string;
  fontSize: number;
  // 0..1 from top; 0.5 = middle
  verticalPosition: number;
}) {
  const { cues, width, height, textColor, bgColor, fontSize, verticalPosition } = opts;
  const primary = hexToAss(textColor);
  const back = hexToAss(bgColor);
  // Alignment 2 = bottom-center. We override per-cue with \pos so position works for any value.
  const header = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    "WrapStyle: 2",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    // BorderStyle=4 -> draw box behind text using BackColour
    `Style: Pill,Inter,${fontSize},${primary},${primary},${back},${back},1,0,0,0,100,100,0,0,4,8,0,2,40,40,40,1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ].join("\n");

  const xPos = Math.round(width / 2);
  const yPos = Math.round(height * verticalPosition);
  const lines = cues.map(c => {
    const text = c.text.replace(/\n/g, "\\N").replace(/[{}]/g, "");
    return `Dialogue: 0,${fmtAss(c.start)},${fmtAss(c.end)},Pill,,0,0,0,,{\\pos(${xPos},${yPos})}${text}`;
  });
  return header + "\n" + lines.join("\n") + "\n";
}

function pickCue(cues: Cue[], t: number): Cue | null {
  for (const c of cues) if (t >= c.start && t <= c.end) return c;
  return null;
}

export function SimpleCaptionsDialog({
  open,
  onOpenChange,
  videoUrl,
  clientId,
  conversationId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  videoUrl: string;
  clientId: string;
  conversationId: string | null;
}) {
  const [textColor, setTextColor] = useState("#000000");
  const [bgColor, setBgColor] = useState("#FFFFFF");
  // 0..100: 10 = near top, 50 = middle, 88 = bottom-third (default)
  const [position, setPosition] = useState(82);
  const [fontSize, setFontSize] = useState(64);

  const [cues, setCues] = useState<Cue[]>([]);
  const [transcribing, setTranscribing] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [renderProgress, setRenderProgress] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [videoMeta, setVideoMeta] = useState<{ width: number; height: number } | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // Auto-transcribe on open
  useEffect(() => {
    if (!open || !videoUrl) return;
    let cancelled = false;
    setCues([]);
    setTranscribing(true);
    (async () => {
      try {
        const { data, error } = await supabase.functions.invoke("transcribe-video", { body: { videoUrl } });
        if (cancelled) return;
        if (error) throw error;
        const segs: Segment[] = Array.isArray((data as any)?.captions) ? (data as any).captions : [];
        setCues(buildCues(segs));
      } catch (e: any) {
        toast.error(`Transcription failed: ${e?.message || e}`);
      } finally {
        if (!cancelled) setTranscribing(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, videoUrl]);

  const activeCue = useMemo(() => pickCue(cues, currentTime), [cues, currentTime]);

  const previewStyle = useMemo(() => {
    return {
      color: textColor,
      background: bgColor,
      // Scale font size relative to a 1080px reference so preview matches the export.
      fontSize: `clamp(12px, ${(fontSize / 1080) * 100}cqw, ${fontSize}px)`,
      top: `${position}%`,
    } as React.CSSProperties;
  }, [textColor, bgColor, fontSize, position]);

  const renderAndSave = useCallback(async () => {
    if (!cues.length) {
      toast.error("No captions to burn — transcription returned empty.");
      return;
    }
    setRendering(true);
    setRenderProgress(0);
    try {
      // Lazy-load ffmpeg from existing helper module (shares the 30MB wasm cache).
      const { FFmpeg } = await import("@ffmpeg/ffmpeg");
      const { toBlobURL } = await import("@ffmpeg/util");
      const ff = new FFmpeg();
      const base = "https://unpkg.com/@ffmpeg/[email protected]/dist/umd";
      await ff.load({
        coreURL: await toBlobURL(`${base}/ffmpeg-core.js`, "text/javascript"),
        wasmURL: await toBlobURL(`${base}/ffmpeg-core.wasm`, "application/wasm"),
      });
      ff.on("progress", ({ progress }: { progress: number }) => {
        setRenderProgress(Math.max(0, Math.min(1, progress)));
      });

      // Download source video
      const dl = await fetch(videoUrl);
      if (!dl.ok) throw new Error(`Video download failed (${dl.status})`);
      const srcBuf = new Uint8Array(await dl.arrayBuffer());
      await ff.writeFile("in.mp4", srcBuf);

      // Download font (Inter) for libass
      const fontRes = await fetch(FONT_URL);
      if (!fontRes.ok) throw new Error(`Font download failed (${fontRes.status})`);
      const fontBuf = new Uint8Array(await fontRes.arrayBuffer());
      await ff.writeFile("Inter.ttf", fontBuf);

      const w = videoMeta?.width || 1080;
      const h = videoMeta?.height || 1920;
      const ass = buildAss({
        cues,
        width: w,
        height: h,
        textColor,
        bgColor,
        fontSize,
        verticalPosition: position / 100,
      });
      await ff.writeFile("subs.ass", new TextEncoder().encode(ass));

      await ff.exec([
        "-i", "in.mp4",
        "-vf", `subtitles=subs.ass:fontsdir=.`,
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

      // Upload to creatives bucket
      const path = `ai-studio/${clientId}/captioned/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp4`;
      const up = await supabase.storage.from("creatives").upload(path, outBlob, {
        contentType: "video/mp4",
        upsert: false,
      });
      if (up.error) throw up.error;
      const { data: pub } = supabase.storage.from("creatives").getPublicUrl(path);

      // Persist as a new canvas item so the original stays intact.
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
            source: "captions_burn",
            origin_video_url: videoUrl,
            aspect_ratio: w && h ? `${w}:${h}` : null,
            captions: {
              style: "simple-pill",
              text_color: textColor,
              bg_color: bgColor,
              font_size: fontSize,
              vertical_position_pct: position,
              cue_count: cues.length,
            },
            status: "completed",
          },
        });
        if (insErr) throw insErr;
      }

      toast.success("Captions burned in — new card added to canvas");
      onOpenChange(false);
    } catch (e: any) {
      console.error("burn captions failed", e);
      toast.error(`Render failed: ${e?.message || e}`);
    } finally {
      setRendering(false);
      setRenderProgress(0);
    }
  }, [cues, videoUrl, videoMeta, textColor, bgColor, fontSize, position, clientId, conversationId, onOpenChange]);

  // void unused import so tree-shake doesn't drop the shared transcoder cache hint
  void transcodeWebmToMp4;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Subtitles className="h-4 w-4" /> Add captions
          </DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 md:grid-cols-[1fr_240px]">
          {/* Preview */}
          <div className="relative bg-black rounded-md overflow-hidden aspect-[9/16] max-h-[60vh] mx-auto w-full" style={{ containerType: "inline-size" }}>
            <video
              ref={videoRef}
              src={videoUrl}
              controls
              playsInline
              className="absolute inset-0 h-full w-full object-contain"
              onLoadedMetadata={(e) => {
                const el = e.currentTarget;
                setVideoMeta({ width: el.videoWidth, height: el.videoHeight });
              }}
              onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
            />
            {/* Caption overlay */}
            {activeCue && (
              <div
                className="absolute left-1/2 -translate-x-1/2 -translate-y-1/2 px-3 py-1.5 rounded-md font-bold text-center whitespace-pre-wrap pointer-events-none shadow-md"
                style={previewStyle}
              >
                {activeCue.text}
              </div>
            )}
            {transcribing && (
              <div className="absolute inset-0 bg-black/60 flex items-center justify-center text-white text-sm gap-2">
                <Loader2 className="h-4 w-4 animate-spin" /> Transcribing audio…
              </div>
            )}
          </div>

          {/* Controls */}
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Text color</Label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={textColor}
                  onChange={(e) => setTextColor(e.target.value)}
                  className="h-9 w-12 rounded border border-input bg-transparent cursor-pointer"
                />
                <span className="text-xs font-mono text-muted-foreground">{textColor.toUpperCase()}</span>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Background color</Label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={bgColor}
                  onChange={(e) => setBgColor(e.target.value)}
                  className="h-9 w-12 rounded border border-input bg-transparent cursor-pointer"
                />
                <span className="text-xs font-mono text-muted-foreground">{bgColor.toUpperCase()}</span>
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Vertical position</Label>
                <span className="text-[10px] text-muted-foreground">{position}%</span>
              </div>
              <Slider value={[position]} min={5} max={95} step={1} onValueChange={(v) => setPosition(v[0] ?? 82)} />
              <div className="flex justify-between text-[10px] text-muted-foreground"><span>Top</span><span>Middle</span><span>Bottom</span></div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Font size</Label>
                <span className="text-[10px] text-muted-foreground">{fontSize}px</span>
              </div>
              <Slider value={[fontSize]} min={28} max={140} step={2} onValueChange={(v) => setFontSize(v[0] ?? 64)} />
            </div>

            <div className="text-[11px] text-muted-foreground border-t pt-3">
              {cues.length > 0 ? `${cues.length} caption cue${cues.length === 1 ? "" : "s"} ready.` : transcribing ? "Generating word-level timestamps…" : "No captions yet."}
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={rendering}>Cancel</Button>
          <Button
            onClick={renderAndSave}
            disabled={rendering || transcribing || cues.length === 0}
            className="gap-2"
          >
            {rendering ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Rendering {Math.round(renderProgress * 100)}%
              </>
            ) : (
              <>
                <Send className="h-4 w-4" />
                Burn in &amp; add to canvas
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Silence unused-icon import lint while keeping a single import block.
void DownloadIcon;