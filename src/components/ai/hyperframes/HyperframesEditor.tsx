import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import {
  Loader2,
  Play,
  Pause,
  Trash2,
  Type,
  Subtitles,
  Sticker,
  Download,
  Send,
  Wand2,
  Save,
  AlertCircle,
  RefreshCw,
  Undo2,
  Redo2,
  Image as ImageIcon,
  Camera,
  LayoutTemplate,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  HyperframesCanvas,
  HyperframesCanvasHandle,
} from "./HyperframesCanvas";
import {
  HyperframesComposition,
  Layer,
  TextLayer,
  IconLayer,
  ImageLayer,
  makeDefaultComposition,
  withKenBurns,
  withoutKenBurns,
  hasKenBurns,
} from "./timeline";
import {
  applyCaptionPreset,
  hasCaptionLayers,
  stripCaptionLayers,
  CAPTION_STYLES,
  type CaptionStyle,
  type CaptionSegment,
  type CaptionOverrides,
  type CaptionCasing,
} from "./captionPresets";
import { transcodeWebmToMp4 } from "./transcodeMp4";
import { captureVideoAudioTracks } from "./captureAudio";
import { useCompHistory } from "./useCompHistory";
import {
  listTemplates,
  saveTemplate,
  deleteTemplate,
  bindVideoSrc,
  type HyperframesTemplate,
} from "./templates";

const QUICK = [
  "Add bold caption: 'You won't believe this' fading in at 0.5s",
  "Add karaoke-style subtitles for the whole clip",
  "Add a 🔥 sticker bouncing in at 1s, bottom-right",
  "Add a gold call-to-action banner: 'Book Your Strategy Call'",
  "Add a soft outro card with the offer name",
];

interface Props {
  clientId: string;
  videoUrl: string;
  aspectRatio?: "9:16" | "16:9" | "1:1";
  initialPrompt?: string;
  sourceVideoId?: string | null;
  onSaved?: (newUrl: string) => void;
  /** When true, auto-transcribe + apply viral-pop captions on mount. */
  autoCaptions?: boolean;
}

export function HyperframesEditor({
  clientId,
  videoUrl,
  aspectRatio = "9:16",
  initialPrompt,
  sourceVideoId,
  onSaved,
  autoCaptions = false,
}: Props) {
  const canvasRef = useRef<HyperframesCanvasHandle>(null);
  // Resolved playback URL — we fetch the source as a same-origin blob URL so
  // the <video crossOrigin="anonymous"> element always loads cleanly (no CORS
  // taint) regardless of the upstream host. This is what unblocks preview
  // playback, audio capture, MP4 export, and Save-to-library all at once.
  const [playbackUrl, setPlaybackUrl] = useState<string | null>(null);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [playbackLoading, setPlaybackLoading] = useState(true);
  const [duration, setDuration] = useState(8);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [exportTick, setExportTick] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [exportFormat, setExportFormat] = useState<"webm" | "mp4">("mp4");
  const [exportProgress, setExportProgress] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [messages, setMessages] = useState<
    { role: "user" | "assistant"; content: string }[]
  >([]);
  const [captionBusy, setCaptionBusy] = useState(false);
  const [captionStage, setCaptionStage] = useState<
    "idle" | "downloading" | "transcribing" | "applying" | "done"
  >("idle");
  const [captionError, setCaptionError] = useState<string | null>(null);
  const captionsRanRef = useRef(false);
  const [captionStyle, setCaptionStyle] = useState<CaptionStyle>("hormozi");
  const [segments, setSegments] = useState<CaptionSegment[]>([]);
  const [captionOverrides, setCaptionOverrides] = useState<CaptionOverrides>({
    casing: "preset",
  });
  const [leftTab, setLeftTab] = useState<"style" | "edit" | "layers" | "ai">("style");

  const { comp, setComp, undo, redo, canUndo, canRedo } = useCompHistory(
    makeDefaultComposition(videoUrl, 8, aspectRatio),
  );

  // Rehost the source video into a same-origin blob URL.
  useEffect(() => {
    let cancelled = false;
    let createdUrl: string | null = null;
    setPlaybackLoading(true);
    setPlaybackError(null);
    (async () => {
      try {
        const res = await fetch(videoUrl, { mode: "cors", credentials: "omit" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        if (cancelled) return;
        createdUrl = URL.createObjectURL(blob);
        setPlaybackUrl(createdUrl);
        setComp((c) => ({
          ...c,
          layers: c.layers.map((l) =>
            l.type === "video" ? { ...l, src: createdUrl! } : l,
          ),
        }));
      } catch (e: any) {
        // Fallback to direct URL — preview may still work for permissive hosts,
        // but warn the user so they know why export/audio may misbehave.
        if (cancelled) return;
        setPlaybackUrl(videoUrl);
        setPlaybackError(
          `Couldn't rehost video (${e?.message || e}). Using direct URL — export and audio may be limited if the host blocks CORS.`,
        );
      } finally {
        if (!cancelled) setPlaybackLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoUrl]);

  // Templates
  const [templates, setTemplates] = useState<HyperframesTemplate[]>([]);
  const [templatesLoaded, setTemplatesLoaded] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadTemplates = async () => {
    try {
      const list = await listTemplates(clientId);
      setTemplates(list);
      setTemplatesLoaded(true);
    } catch (e: any) {
      toast.error(`Couldn't load templates: ${e?.message || e}`);
    }
  };

  const handleSaveTemplate = async () => {
    const title = window.prompt("Template name?", "Hyperframes template");
    if (!title) return;
    try {
      const t = await saveTemplate(clientId, title, comp);
      setTemplates((ts) => [t, ...ts]);
      toast.success(`Saved template "${title}"`);
    } catch (e: any) {
      toast.error(`Save failed: ${e?.message || e}`);
    }
  };

  const handleApplyTemplate = (t: HyperframesTemplate) => {
    const bound = bindVideoSrc(t.composition, videoUrl, duration);
    setComp(bound, { commit: true });
    toast.success(`Applied "${t.title}"`);
  };

  const handleDeleteTemplate = async (t: HyperframesTemplate) => {
    if (!window.confirm(`Delete template "${t.title}"?`)) return;
    try {
      await deleteTemplate(t.id);
      setTemplates((ts) => ts.filter((x) => x.id !== t.id));
      toast.success("Template deleted");
    } catch (e: any) {
      toast.error(`Delete failed: ${e?.message || e}`);
    }
  };

  // Keyboard shortcuts: cmd/ctrl-Z = undo, cmd/ctrl-shift-Z or cmd/ctrl-Y = redo
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tgt = e.target as HTMLElement | null;
      if (tgt && (tgt.tagName === "INPUT" || tgt.tagName === "TEXTAREA" || tgt.isContentEditable)) {
        return;
      }
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      if (e.key.toLowerCase() === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((e.key.toLowerCase() === "z" && e.shiftKey) || e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [undo, redo]);

  // ---------- Captions ----------
  const generateCaptions = async (styleOverride?: CaptionStyle) => {
    setCaptionBusy(true);
    setCaptionError(null);
    setCaptionStage("downloading");
    // Advance stage indicators so the UI feels responsive while the edge fn runs
    const t1 = window.setTimeout(() => setCaptionStage("transcribing"), 600);
    try {
      const { data, error } = await supabase.functions.invoke("transcribe-video", {
        body: { videoUrl },
      });
      if (error) throw new Error(error.message || "Transcription request failed");
      if (data?.error) throw new Error(String(data.error));
      const segments: CaptionSegment[] = Array.isArray(data?.captions) ? data.captions : [];
      if (segments.length === 0) {
        const msg = "No speech detected in the video";
        setCaptionError(msg);
        toast.error(msg);
        return;
      }
      setCaptionStage("applying");
      setSegments(segments);
      const style = styleOverride ?? captionStyle;
      setComp((c) => applyCaptionPreset(c, segments, style, captionOverrides));
      setCaptionStage("done");
      toast.success(`Generated ${segments.reduce((n, s) => n + (s.words?.length || s.text.split(/\s+/).length), 0)} caption words`);
    } catch (e: any) {
      const msg = e?.message || String(e);
      setCaptionError(msg);
      setCaptionStage("idle");
      toast.error(`Caption generation failed: ${msg}`);
    } finally {
      window.clearTimeout(t1);
      setCaptionBusy(false);
    }
  };

  const restyleCaptions = (style: CaptionStyle) => {
    setCaptionStyle(style);
    if (segments.length === 0) {
      generateCaptions(style);
      return;
    }
    setComp((c) => applyCaptionPreset(c, segments, style, captionOverrides));
    setLeftTab("edit");
  };

  // Edit a caption segment's text and re-apply the current style
  const updateSegmentText = (idx: number, text: string) => {
    setSegments((prev) => {
      const next = prev.map((s, i) =>
        i === idx
          ? {
              ...s,
              text,
              // Re-distribute word timings evenly across the new word list
              words: (() => {
                const arr = text.split(/\s+/).filter(Boolean);
                if (!arr.length) return [];
                const span = (s.endTime - s.startTime) / arr.length;
                return arr.map((w, i) => ({
                  word: w,
                  startTime: s.startTime + i * span,
                  endTime: s.startTime + (i + 1) * span,
                }));
              })(),
            }
          : s,
      );
      setComp((c) => applyCaptionPreset(c, next, captionStyle, captionOverrides));
      return next;
    });
  };

  const deleteSegment = (idx: number) => {
    setSegments((prev) => {
      const next = prev.filter((_, i) => i !== idx);
      setComp((c) => applyCaptionPreset(c, next, captionStyle, captionOverrides));
      return next;
    });
  };

  // Live re-apply when overrides change (font / case / colors).
  const updateCaptionOverrides = (patch: Partial<CaptionOverrides>) => {
    setCaptionOverrides((prev) => {
      const next = { ...prev, ...patch };
      if (segments.length > 0) {
        setComp((c) => applyCaptionPreset(c, segments, captionStyle, next));
      }
      return next;
    });
  };

  const clearCaptions = () => {
    setComp((c) => ({ ...c, layers: stripCaptionLayers(c.layers) }));
    toast.success("Captions cleared");
  };

  // Auto-run captions on mount when requested
  useEffect(() => {
    if (!autoCaptions || captionsRanRef.current) return;
    if (hasCaptionLayers(comp)) {
      captionsRanRef.current = true;
      return;
    }
    captionsRanRef.current = true;
    generateCaptions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoCaptions]);

  // When duration becomes known, extend video layer + composition
  useEffect(() => {
    setComp((c) => {
      const next = { ...c, duration };
      next.layers = c.layers.map((l) =>
        l.type === "video" ? { ...l, end: duration } : l,
      );
      return next;
    });
  }, [duration]);

  const selected = useMemo(
    () => comp.layers.find((l) => l.id === selectedId) || null,
    [comp, selectedId],
  );

  const togglePlay = () => {
    const c = canvasRef.current;
    if (!c) return;
    if (playing) {
      c.pause();
      setPlaying(false);
    } else {
      if (canvasRef.current!.getTime() >= comp.duration - 0.05) c.seek(0);
      c.play();
      setPlaying(true);
    }
  };

  const updateLayer = (id: string, patch: Partial<Layer>) => {
    setComp((c) => ({
      ...c,
      layers: c.layers.map((l) => (l.id === id ? ({ ...l, ...patch } as Layer) : l)),
    }));
  };

  const removeLayer = (id: string) => {
    setComp((c) => ({ ...c, layers: c.layers.filter((l) => l.id !== id) }));
    if (selectedId === id) setSelectedId(null);
  };

  const addText = (kind: "text" | "subtitle" = "text") => {
    const id = `${kind}-${Date.now()}`;
    const newLayer: TextLayer = {
      id,
      type: kind,
      text: kind === "subtitle" ? "Add your subtitle here" : "BOLD HOOK",
      start: Math.max(0, time),
      end: Math.min(comp.duration, time + 3),
      x: 0.5,
      y: kind === "subtitle" ? 0.85 : 0.5,
      anchor: "center",
      fontSize: kind === "subtitle" ? 44 : 72,
      fontWeight: 800,
      color: "#fff",
      bgColor: kind === "subtitle" ? "rgba(0,0,0,0.55)" : undefined,
      padding: 16,
      borderRadius: 12,
      align: "center",
      maxWidthPct: 0.85,
      animations: [
        { prop: "opacity", from: 0, to: 1, start: 0, end: 0.3, ease: "easeOut" },
        { prop: "scale", from: 0.92, to: 1, start: 0, end: 0.3, ease: "spring" },
      ],
    };
    setComp((c) => ({ ...c, layers: [...c.layers, newLayer] }));
    setSelectedId(id);
  };

  const addIcon = () => {
    const id = `icon-${Date.now()}`;
    const newLayer: IconLayer = {
      id,
      type: "icon",
      glyph: "🔥",
      start: Math.max(0, time),
      end: Math.min(comp.duration, time + 2),
      x: 0.85,
      y: 0.85,
      anchor: "center",
      size: 120,
      animations: [
        { prop: "scale", from: 0, to: 1, start: 0, end: 0.35, ease: "spring" },
        { prop: "opacity", from: 0, to: 1, start: 0, end: 0.2, ease: "easeOut" },
      ],
    };
    setComp((c) => ({ ...c, layers: [...c.layers, newLayer] }));
    setSelectedId(id);
  };

  // ---------- Image layer ----------
  const handleImageUpload = async (file: File) => {
    try {
      const ext = file.name.split(".").pop() || "png";
      const path = `ai-studio/${clientId}/hyperframes-img-${Date.now()}.${ext}`;
      const up = await supabase.storage.from("creatives").upload(path, file, {
        contentType: file.type,
        upsert: false,
      });
      if (up.error) throw up.error;
      const { data: pub } = supabase.storage.from("creatives").getPublicUrl(path);
      const id = `image-${Date.now()}`;
      const layer: ImageLayer = {
        id,
        type: "image",
        src: pub.publicUrl,
        start: Math.max(0, time),
        end: Math.min(comp.duration, time + 3),
        x: 0.5,
        y: 0.5,
        anchor: "center",
        width: 0.4,
        borderRadius: 16,
        animations: [
          { prop: "opacity", from: 0, to: 1, start: 0, end: 0.3, ease: "easeOut" },
          { prop: "scale", from: 0.85, to: 1, start: 0, end: 0.35, ease: "spring" },
        ],
      };
      setComp((c) => ({ ...c, layers: [...c.layers, layer] }), { commit: true });
      setSelectedId(id);
      toast.success("Image added");
    } catch (e: any) {
      toast.error(`Image upload failed: ${e?.message || e}`);
    }
  };

  // ---------- Ken Burns ----------
  const kenBurnsOn = hasKenBurns(comp);
  const toggleKenBurns = () => {
    setComp((c) => (hasKenBurns(c) ? withoutKenBurns(c) : withKenBurns(c)), { commit: true });
    toast.success(kenBurnsOn ? "Ken Burns off" : "Ken Burns on");
  };

  // ---------- AI chat ----------
  const sendChat = async () => {
    const inst = chatInput.trim();
    if (!inst) return;
    setChatInput("");
    setMessages((m) => [...m, { role: "user", content: inst }]);
    setChatBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("hyperframes-author", {
        body: {
          password: "HPA1234$",
          composition: comp,
          instruction: inst,
          videoPrompt: initialPrompt,
        },
      });
      if (error) throw error;
      if (data?.composition) {
        setComp(data.composition as HyperframesComposition);
      }
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content: data?.reply || "Updated the timeline.",
        },
      ]);
    } catch (e: any) {
      setMessages((m) => [
        ...m,
        { role: "assistant", content: `Error: ${e?.message || e}` },
      ]);
    } finally {
      setChatBusy(false);
    }
  };

  // ---------- Export ----------
  const exportMp4 = async () => {
    const canvas = canvasRef.current?.getCanvasEl();
    const video = canvasRef.current?.getVideoEl();
    if (!canvas || !video) return;
    setExporting(true);
    try {
      // Rewind everything
      canvasRef.current!.pause();
      canvasRef.current!.seek(0);
      setExportTick((n) => n + 1);
      await new Promise((r) => setTimeout(r, 100));

      const stream = (canvas as HTMLCanvasElement).captureStream(30);
      // Mix in source audio (robust: tries captureStream → WebAudio fallback).
      try {
        video.muted = false;
        video.volume = 1;
        const audioTracks = captureVideoAudioTracks(video);
        audioTracks.forEach((t) => stream.addTrack(t));
        if (!audioTracks.length) {
          toast.warning("Source audio couldn't be captured — exporting silent video.");
        }
      } catch {}

      const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")
        ? "video/webm;codecs=vp9,opus"
        : "video/webm";
      const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6_000_000 });
      const chunks: BlobPart[] = [];
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      const stopped = new Promise<void>((res) => (rec.onstop = () => res()));

      rec.start(100);
      canvasRef.current!.play();
      setPlaying(true);

      await new Promise<void>((res) => {
        const tick = () => {
          if ((canvasRef.current?.getTime() ?? 0) >= comp.duration - 0.05) {
            res();
            return;
          }
          requestAnimationFrame(tick);
        };
        tick();
      });

      rec.stop();
      await stopped;
      canvasRef.current!.pause();
      setPlaying(false);

      let blob = new Blob(chunks, { type: mime });
      let ext = "webm";
      let outType = mime;
      if (exportFormat === "mp4") {
        try {
          setExportProgress(0);
          toast.message("Transcoding to MP4…", { description: "First run downloads the ~30MB ffmpeg core." });
          blob = await transcodeWebmToMp4(blob, (r) => setExportProgress(Math.round(r * 100)));
          ext = "mp4";
          outType = "video/mp4";
        } catch (err: any) {
          toast.error(`MP4 transcode failed, falling back to WebM: ${err?.message || err}`);
        } finally {
          setExportProgress(null);
        }
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `hyperframes-${Date.now()}.${ext}`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`Exported ${ext.toUpperCase()}. Use 'Save to library' to also push it into the client video set.`);
      void outType;
    } catch (e: any) {
      toast.error(`Export failed: ${e?.message || e}`);
    } finally {
      setExporting(false);
    }
  };

  const saveToLibrary = async () => {
    const canvas = canvasRef.current?.getCanvasEl();
    const video = canvasRef.current?.getVideoEl();
    if (!canvas || !video) return;
    setSaving(true);
    try {
      canvasRef.current!.pause();
      canvasRef.current!.seek(0);
      setExportTick((n) => n + 1);
      await new Promise((r) => setTimeout(r, 100));

      const stream = (canvas as HTMLCanvasElement).captureStream(30);
      try {
        video.muted = false;
        video.volume = 1;
        const audioTracks = captureVideoAudioTracks(video);
        audioTracks.forEach((t) => stream.addTrack(t));
      } catch {}

      const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")
        ? "video/webm;codecs=vp9,opus"
        : "video/webm";
      const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6_000_000 });
      const chunks: BlobPart[] = [];
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      const stopped = new Promise<void>((res) => (rec.onstop = () => res()));
      rec.start(100);
      canvasRef.current!.play();
      setPlaying(true);
      await new Promise<void>((res) => {
        const tick = () => {
          if ((canvasRef.current?.getTime() ?? 0) >= comp.duration - 0.05) {
            res();
            return;
          }
          requestAnimationFrame(tick);
        };
        tick();
      });
      rec.stop();
      await stopped;
      canvasRef.current!.pause();
      setPlaying(false);

      let blob = new Blob(chunks, { type: mime });
      let ext = "webm";
      let outType = mime;
      if (exportFormat === "mp4") {
        try {
          setExportProgress(0);
          blob = await transcodeWebmToMp4(blob, (r) => setExportProgress(Math.round(r * 100)));
          ext = "mp4";
          outType = "video/mp4";
        } catch (err: any) {
          toast.error(`MP4 transcode failed, saving WebM instead: ${err?.message || err}`);
        } finally {
          setExportProgress(null);
        }
      }
      const path = `ai-studio/${clientId}/hyperframes-${Date.now()}.${ext}`;
      const up = await supabase.storage
        .from("creatives")
        .upload(path, blob, { contentType: outType, upsert: false });
      if (up.error) throw up.error;
      const { data: pub } = supabase.storage.from("creatives").getPublicUrl(path);
      const storageUrl = pub.publicUrl;

      const { error: insErr } = await supabase.from("client_videos" as any).insert({
        client_id: clientId,
        title: "Hyperframes edit",
        prompt: initialPrompt || "Hyperframes overlay edit",
        storage_url: storageUrl,
        storage_path: path,
        source: "hyperframes",
        parent_video_id: sourceVideoId || null,
        aspect_ratio: aspectRatio,
        duration_seconds: Math.round(comp.duration),
        status: "completed",
        edit_instructions: "hyperframes",
        metadata: { composition: comp },
      });
      if (insErr) throw insErr;
      toast.success("Saved to client library");
      onSaved?.(storageUrl);
    } catch (e: any) {
      toast.error(`Save failed: ${e?.message || e}`);
    } finally {
      setSaving(false);
    }
  };

  const aspectStyle =
    aspectRatio === "16:9"
      ? { aspectRatio: "16 / 9" }
      : aspectRatio === "1:1"
      ? { aspectRatio: "1 / 1" }
      : { aspectRatio: "9 / 16" };

  return (
    <div className="flex-1 grid grid-cols-[minmax(0,1fr)_minmax(420px,520px)] gap-0 min-h-0">
      {/* LEFT: Tabbed caption studio / layers / AI */}
      <div className="border-r flex flex-col min-h-0">
        <Tabs value={leftTab} onValueChange={(v) => setLeftTab(v as any)} className="flex-1 flex flex-col min-h-0">
          <div className="px-3 pt-3 pb-2 border-b flex items-center justify-between gap-2">
            <TabsList className="h-9">
              <TabsTrigger value="style" className="text-xs">Choose Style</TabsTrigger>
              <TabsTrigger value="edit" className="text-xs">Edit Captions</TabsTrigger>
              <TabsTrigger value="layers" className="text-xs">Layers</TabsTrigger>
              <TabsTrigger value="ai" className="text-xs">AI Tools</TabsTrigger>
            </TabsList>
            <div className="flex items-center gap-1">
              <Button size="sm" variant="ghost" onClick={undo} disabled={!canUndo} title="Undo (Cmd/Ctrl-Z)" className="h-8 w-8 p-0">
                <Undo2 className="h-3.5 w-3.5" />
              </Button>
              <Button size="sm" variant="ghost" onClick={redo} disabled={!canRedo} title="Redo" className="h-8 w-8 p-0">
                <Redo2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          {(captionBusy || captionError) && (
            <div
              className={`mx-3 mt-2 flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-[11px] ${
                captionError
                  ? "border-destructive/40 bg-destructive/10 text-destructive"
                  : "border-primary/30 bg-primary/10"
              }`}
            >
              {captionBusy ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span className="font-medium">
                    {captionStage === "downloading" && "Preparing video…"}
                    {captionStage === "transcribing" && "Transcribing with Gemini…"}
                    {captionStage === "applying" && "Applying caption style…"}
                    {captionStage === "idle" && "Starting…"}
                  </span>
                  <span className="opacity-70 ml-auto">10–30s</span>
                </>
              ) : (
                <>
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate flex-1" title={captionError!}>{captionError}</span>
                  <Button size="sm" variant="outline" className="h-6 px-2 text-[10px] gap-1" onClick={() => generateCaptions()}>
                    <RefreshCw className="h-3 w-3" /> Retry
                  </Button>
                  <button type="button" onClick={() => setCaptionError(null)} className="text-[10px] opacity-60 hover:opacity-100" aria-label="Dismiss">✕</button>
                </>
              )}
            </div>
          )}

          {/* CHOOSE STYLE */}
          <TabsContent value="style" className="flex-1 min-h-0 m-0">
            <ScrollArea className="h-full">
              <div className="p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-semibold">Caption presets</div>
                    <div className="text-[11px] text-muted-foreground">Pick a look — we'll transcribe + apply</div>
                  </div>
                  <Button size="sm" variant={hasCaptionLayers(comp) ? "secondary" : "default"} onClick={() => generateCaptions()} disabled={captionBusy} className="gap-1 text-[11px]">
                    {captionBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Subtitles className="h-3.5 w-3.5" />}
                    {hasCaptionLayers(comp) ? "Regenerate" : "Transcribe"}
                  </Button>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  {CAPTION_STYLES.map((s) => {
                    const active = captionStyle === s.id;
                    return (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => restyleCaptions(s.id)}
                        title={s.hint}
                        className={`group relative aspect-[16/9] rounded-lg border overflow-hidden text-left transition-all ${
                          active
                            ? "border-primary ring-2 ring-primary/40 shadow-md"
                            : "border-border/60 hover:border-primary/40 hover:shadow-sm"
                        }`}
                      >
                        <div className={`absolute inset-0 ${captionPresetPreviewBg(s.id)}`} />
                        <div className="absolute inset-0 flex items-center justify-center px-3">
                          <CaptionPresetPreview id={s.id} />
                        </div>
                        <div className="absolute bottom-0 left-0 right-0 bg-background/85 backdrop-blur px-2 py-1.5 flex items-center justify-between">
                          <div className="text-[11px] font-semibold truncate">{s.label}</div>
                          {active && <Badge variant="default" className="text-[9px] h-4 px-1.5">Active</Badge>}
                        </div>
                      </button>
                    );
                  })}
                </div>

                <div className="pt-2 border-t flex items-center justify-between gap-2">
                  <div className="text-[11px] text-muted-foreground">
                    {segments.length > 0 ? `${segments.length} caption phrases` : "No captions yet"}
                  </div>
                  {hasCaptionLayers(comp) && (
                    <Button size="sm" variant="ghost" onClick={clearCaptions} className="text-[11px] h-7">
                      Clear captions
                    </Button>
                  )}
                </div>

                <div className="pt-3 border-t">
                  <div className="text-[10px] uppercase text-muted-foreground mb-2">Base video</div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button size="sm" variant={kenBurnsOn ? "secondary" : "outline"} onClick={toggleKenBurns} className="text-[11px] h-8 gap-1">
                      <Camera className="h-3.5 w-3.5" /> Ken Burns
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => fileInputRef.current?.click()} className="text-[11px] h-8 gap-1">
                      <ImageIcon className="h-3.5 w-3.5" /> Add image
                    </Button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) handleImageUpload(f);
                        e.target.value = "";
                      }}
                    />
                    <DropdownMenu onOpenChange={(o) => { if (o && !templatesLoaded) loadTemplates(); }}>
                      <DropdownMenuTrigger asChild>
                        <Button size="sm" variant="outline" className="text-[11px] h-8 gap-1">
                          <LayoutTemplate className="h-3.5 w-3.5" /> My templates
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-64">
                        <DropdownMenuLabel className="text-[11px]">Saved compositions</DropdownMenuLabel>
                        <DropdownMenuItem onClick={handleSaveTemplate} className="text-xs">
                          <Save className="h-3 w-3 mr-2" /> Save current as template…
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        {!templatesLoaded ? (
                          <DropdownMenuItem disabled className="text-[11px] opacity-60">
                            <Loader2 className="h-3 w-3 mr-2 animate-spin" /> Loading…
                          </DropdownMenuItem>
                        ) : templates.length === 0 ? (
                          <DropdownMenuItem disabled className="text-[11px] opacity-60">No templates yet</DropdownMenuItem>
                        ) : (
                          templates.map((t) => (
                            <DropdownMenuItem
                              key={t.id}
                              className="text-xs flex items-center justify-between gap-2"
                              onSelect={(e) => { e.preventDefault(); handleApplyTemplate(t); }}
                            >
                              <span className="truncate flex-1">{t.title}</span>
                              <Trash2
                                className="h-3 w-3 text-muted-foreground hover:text-destructive shrink-0"
                                onClick={(e) => { e.stopPropagation(); handleDeleteTemplate(t); }}
                              />
                            </DropdownMenuItem>
                          ))
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              </div>
            </ScrollArea>
          </TabsContent>

          {/* EDIT CAPTIONS */}
          <TabsContent value="edit" className="flex-1 min-h-0 m-0">
            <ScrollArea className="h-full">
              <div className="p-4 space-y-2">
                {segments.length === 0 ? (
                  <div className="text-center text-[12px] text-muted-foreground py-12 space-y-3">
                    <div>No captions yet. Transcribe the video to start editing.</div>
                    <Button size="sm" onClick={() => generateCaptions()} disabled={captionBusy} className="gap-1">
                      {captionBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Subtitles className="h-3.5 w-3.5" />}
                      Transcribe video
                    </Button>
                  </div>
                ) : (
                  segments.map((seg, i) => (
                    <div key={i} className="rounded-lg border bg-card p-2.5 space-y-1.5">
                      <div className="flex items-center justify-between text-[10px] tabular-nums text-muted-foreground">
                        <span>{seg.startTime.toFixed(2)}s → {seg.endTime.toFixed(2)}s</span>
                        <button
                          type="button"
                          onClick={() => {
                            canvasRef.current?.seek(seg.startTime);
                            setTime(seg.startTime);
                          }}
                          className="text-primary hover:underline"
                        >
                          Jump
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteSegment(i)}
                          className="text-muted-foreground hover:text-destructive"
                          aria-label="Delete segment"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                      <Textarea
                        rows={2}
                        value={seg.text}
                        onChange={(e) => updateSegmentText(i, e.target.value)}
                        className="text-xs resize-none"
                      />
                    </div>
                  ))
                )}
              </div>
            </ScrollArea>
          </TabsContent>

          {/* LAYERS */}
          <TabsContent value="layers" className="flex-1 min-h-0 m-0 flex flex-col">
            <div className="p-3 border-b flex items-center justify-between">
              <span className="text-xs font-semibold">Layers</span>
              <div className="flex items-center gap-1">
                <Button size="sm" variant="ghost" onClick={() => addText("text")} title="Add headline" className="h-7 w-7 p-0">
                  <Type className="h-3.5 w-3.5" />
                </Button>
                <Button size="sm" variant="ghost" onClick={() => addText("subtitle")} title="Add subtitle" className="h-7 w-7 p-0">
                  <Subtitles className="h-3.5 w-3.5" />
                </Button>
                <Button size="sm" variant="ghost" onClick={addIcon} title="Add sticker" className="h-7 w-7 p-0">
                  <Sticker className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
            <ScrollArea className="flex-1">
              <div className="p-2 space-y-1">
                {comp.layers.map((l) => (
                  <button
                    key={l.id}
                    onClick={() => setSelectedId(l.id)}
                    className={`w-full text-left px-2 py-1.5 rounded-md text-[11px] flex items-center justify-between border ${
                      selectedId === l.id ? "border-primary bg-primary/10" : "border-border/40 hover:bg-muted/40"
                    }`}
                  >
                    <span className="truncate">
                      <span className="uppercase text-muted-foreground mr-2">{l.type}</span>
                      {(l as any).text || (l as any).glyph || (l.type === "video" ? "source clip" : "")}
                    </span>
                    {l.type !== "video" && (
                      <Trash2
                        className="h-3 w-3 text-muted-foreground hover:text-destructive"
                        onClick={(e) => { e.stopPropagation(); removeLayer(l.id); }}
                      />
                    )}
                  </button>
                ))}
              </div>
            </ScrollArea>
            {selected && selected.type !== "video" && (
              <div className="border-t p-3 space-y-2 text-xs">
                {(selected.type === "text" || selected.type === "subtitle") && (
                  <>
                    <label className="block text-[10px] uppercase text-muted-foreground">Text</label>
                    <Textarea rows={2} value={(selected as TextLayer).text} onChange={(e) => updateLayer(selected.id, { text: e.target.value } as any)} className="text-xs" />
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[10px] uppercase text-muted-foreground">Font px</label>
                        <Input type="number" value={(selected as TextLayer).fontSize ?? 64} onChange={(e) => updateLayer(selected.id, { fontSize: +e.target.value } as any)} className="h-7 text-xs" />
                      </div>
                      <div>
                        <label className="block text-[10px] uppercase text-muted-foreground">Color</label>
                        <Input type="color" value={(selected as TextLayer).color ?? "#ffffff"} onChange={(e) => updateLayer(selected.id, { color: e.target.value } as any)} className="h-7 p-0.5" />
                      </div>
                    </div>
                  </>
                )}
                {selected.type === "icon" && (
                  <div>
                    <label className="block text-[10px] uppercase text-muted-foreground">Emoji / glyph</label>
                    <Input value={(selected as IconLayer).glyph} onChange={(e) => updateLayer(selected.id, { glyph: e.target.value } as any)} className="h-7 text-xs" />
                  </div>
                )}
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] uppercase text-muted-foreground">Start (s)</label>
                    <Input type="number" step="0.1" value={selected.start} onChange={(e) => updateLayer(selected.id, { start: +e.target.value })} className="h-7 text-xs" />
                  </div>
                  <div>
                    <label className="block text-[10px] uppercase text-muted-foreground">End (s)</label>
                    <Input type="number" step="0.1" value={selected.end} onChange={(e) => updateLayer(selected.id, { end: +e.target.value })} className="h-7 text-xs" />
                  </div>
                  <div>
                    <label className="block text-[10px] uppercase text-muted-foreground">X (0-1)</label>
                    <Input type="number" step="0.05" value={selected.x} onChange={(e) => updateLayer(selected.id, { x: +e.target.value })} className="h-7 text-xs" />
                  </div>
                  <div>
                    <label className="block text-[10px] uppercase text-muted-foreground">Y (0-1)</label>
                    <Input type="number" step="0.05" value={selected.y} onChange={(e) => updateLayer(selected.id, { y: +e.target.value })} className="h-7 text-xs" />
                  </div>
                </div>
              </div>
            )}
          </TabsContent>

          {/* AI TOOLS */}
          <TabsContent value="ai" className="flex-1 min-h-0 m-0 flex flex-col">
            <ScrollArea className="flex-1">
              <div className="p-3 space-y-2">
                {messages.length === 0 && (
                  <div className="text-[11px] text-muted-foreground">
                    Tell me what to layer on. Examples:
                    <div className="flex flex-col gap-1 mt-2">
                      {QUICK.map((q) => (
                        <button key={q} className="text-left text-[10px] px-2 py-1 rounded border border-border/40 hover:bg-muted/40" onClick={() => setChatInput(q)}>
                          {q}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {messages.map((m, i) => (
                  <div key={i} className={`text-[11px] rounded-md px-3 py-2 ${m.role === "user" ? "bg-primary/10 ml-6" : "bg-muted mr-6"}`}>
                    <div className="text-[9px] uppercase tracking-wide text-muted-foreground mb-0.5">{m.role}</div>
                    <div className="whitespace-pre-wrap">{m.content}</div>
                  </div>
                ))}
                {chatBusy && (
                  <div className="text-[11px] text-muted-foreground flex items-center gap-2">
                    <Loader2 className="h-3 w-3 animate-spin" /> Updating timeline…
                  </div>
                )}
              </div>
            </ScrollArea>
            <div className="border-t p-3 space-y-2">
              <Textarea
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                rows={2}
                placeholder="Add a 🔥 sticker bouncing in at 1s..."
                className="text-xs"
                onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) sendChat(); }}
              />
              <div className="flex justify-end">
                <Button size="sm" onClick={sendChat} disabled={chatBusy || !chatInput.trim()}>
                  <Send className="h-3.5 w-3.5 mr-1" /> Send
                </Button>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>

      {/* RIGHT: Preview + transport */}
      <div className="p-4 flex flex-col gap-3 min-h-0 bg-black/85">
        <div className="flex items-center justify-between gap-2">
          <Badge variant="outline" className="text-[10px] gap-1">
            <Wand2 className="h-3 w-3" /> Hyperframes runtime
          </Badge>
          <span className="text-[10px] text-muted-foreground">{aspectRatio} • {comp.duration.toFixed(1)}s</span>
        </div>

        <div className="flex-1 flex items-center justify-center">
          <div className="w-full max-w-full" style={{ ...aspectStyle, maxHeight: "100%" }}>
            <div className="relative w-full h-full">
            <HyperframesCanvas
              ref={canvasRef}
              comp={comp}
              exportTick={exportTick}
              onTime={setTime}
              onDuration={(d) => setDuration(Math.max(2, Math.min(60, Math.round(d))))}
              className="w-full h-full"
            />
            {playbackLoading && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/70 text-white gap-2 text-xs">
                <Loader2 className="h-5 w-5 animate-spin" />
                Loading source video…
              </div>
            )}
            {playbackError && !playbackLoading && (
              <div className="absolute top-2 left-2 right-2 bg-amber-500/90 text-black text-[10px] rounded px-2 py-1">
                {playbackError}
              </div>
            )}
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Button size="icon" variant="secondary" onClick={togglePlay}>
              {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            </Button>
            <Slider
              value={[time]}
              max={comp.duration}
              step={0.05}
              onValueChange={([v]) => {
                canvasRef.current?.seek(v);
              }}
              className="flex-1"
            />
            <span className="text-[10px] text-muted-foreground w-16 text-right tabular-nums">
              {time.toFixed(2)}s / {comp.duration.toFixed(2)}s
            </span>
          </div>
          <div className="flex justify-end items-center gap-2">
            {exportProgress !== null && (
              <span className="text-[10px] text-muted-foreground tabular-nums">
                MP4 {exportProgress}%
              </span>
            )}
            <div className="flex items-center gap-0.5 rounded-md border bg-background/40 p-0.5">
              {(["mp4", "webm"] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setExportFormat(f)}
                  className={`text-[10px] uppercase px-1.5 py-0.5 rounded ${
                    exportFormat === f
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>
            <Button size="sm" variant="outline" onClick={exportMp4} disabled={exporting || saving}>
              {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Download className="h-3.5 w-3.5 mr-1" />}
              Export
            </Button>
            <Button size="sm" onClick={saveToLibrary} disabled={exporting || saving}>
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Save className="h-3.5 w-3.5 mr-1" />}
              Save to library
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---- Preset preview helpers (visual cards in Choose Style) ----
function captionPresetPreviewBg(id: CaptionStyle): string {
  switch (id) {
    case "simple-mono": return "bg-gradient-to-br from-slate-800 to-slate-950";
    case "viral-pop": return "bg-gradient-to-br from-fuchsia-900 to-slate-950";
    case "karaoke-line": return "bg-gradient-to-br from-indigo-900 to-slate-950";
    case "stacked-bold": return "bg-gradient-to-br from-amber-900/60 to-slate-950";
    case "advanced-cinematic": return "bg-gradient-to-br from-emerald-900 to-slate-950";
    case "hormozi": return "bg-gradient-to-br from-zinc-800 to-black";
    case "mrbeast": return "bg-gradient-to-br from-emerald-900 to-black";
    case "three-pop": return "bg-gradient-to-br from-pink-900 to-black";
    case "viral-glow": return "bg-gradient-to-br from-cyan-900 to-slate-950";
    case "word-pop": return "bg-gradient-to-br from-violet-900 to-slate-950";
    case "bounce": return "bg-gradient-to-br from-orange-900 to-slate-950";
    case "typewriter": return "bg-gradient-to-br from-slate-900 to-black";
    case "one-word": return "bg-gradient-to-br from-zinc-900 to-black";
    case "golden-cue": return "bg-gradient-to-br from-amber-950 to-stone-950";
    case "box-pop": return "bg-gradient-to-br from-yellow-900/60 to-slate-950";
  }
}

function CaptionPresetPreview({ id }: { id: CaptionStyle }) {
  if (id === "hormozi") {
    return (
      <div className="flex gap-1 items-baseline">
        <span className="font-black text-white text-lg" style={{ fontFamily: "Montserrat, sans-serif", WebkitTextStroke: "1.5px black" }}>MAKE</span>
        <span className="font-black text-lg" style={{ color: "#FFD93D", fontFamily: "Montserrat, sans-serif", WebkitTextStroke: "1.5px black" }}>MORE</span>
        <span className="font-black text-white text-lg" style={{ fontFamily: "Montserrat, sans-serif", WebkitTextStroke: "1.5px black" }}>MONEY</span>
      </div>
    );
  }
  if (id === "mrbeast") {
    return (
      <div className="flex gap-1 items-baseline">
        <span className="font-black text-white text-lg" style={{ fontFamily: "Bangers, Impact, sans-serif", WebkitTextStroke: "2px black" }}>YOU</span>
        <span className="font-black text-xl" style={{ color: "#39FF14", fontFamily: "Bangers, Impact, sans-serif", WebkitTextStroke: "2px black", textShadow: "0 0 10px rgba(57,255,20,0.7)" }}>WON</span>
      </div>
    );
  }
  if (id === "three-pop") {
    return (
      <div className="flex gap-1 items-baseline">
        <span className="font-black text-white text-base" style={{ WebkitTextStroke: "1.5px black" }}>BUY</span>
        <span className="font-black text-base text-white" style={{ WebkitTextStroke: "1.5px black" }}>IT</span>
        <span className="font-black text-lg" style={{ color: "#FF2D78", WebkitTextStroke: "1.5px black", textShadow: "0 0 8px rgba(255,45,120,0.7)" }}>NOW</span>
      </div>
    );
  }
  if (id === "viral-glow") {
    return (
      <span className="font-black text-xl" style={{ color: "#24E6FF", WebkitTextStroke: "1.5px black", textShadow: "0 0 12px rgba(36,230,255,0.9)" }}>VIRAL</span>
    );
  }
  if (id === "word-pop") {
    return <span className="font-black text-white text-2xl tracking-tight scale-110 inline-block" style={{ WebkitTextStroke: "2px black" }}>POP</span>;
  }
  if (id === "bounce") {
    return (
      <div className="flex gap-1 items-baseline">
        <span className="text-white font-black text-base" style={{ WebkitTextStroke: "1px black" }}>let's</span>
        <span className="font-black text-lg" style={{ color: "#FFB400", WebkitTextStroke: "1.5px black" }}>go!</span>
      </div>
    );
  }
  if (id === "typewriter") {
    return <span className="text-white font-mono font-bold text-base" style={{ WebkitTextStroke: "0.5px black" }}>BUILD▌IT▌NOW</span>;
  }
  if (id === "one-word") {
    return <span className="font-black text-white text-3xl tracking-tighter" style={{ fontFamily: "Anton, sans-serif", WebkitTextStroke: "2px black" }}>ONE</span>;
  }
  if (id === "golden-cue") {
    return (
      <div className="flex gap-1 items-baseline" style={{ fontFamily: "'DM Serif Display', serif" }}>
        <span style={{ color: "#F5EFE0" }} className="text-base">an</span>
        <span style={{ color: "#E4B14A", textShadow: "0 0 8px rgba(228,177,74,0.5)" }} className="text-lg">elegant</span>
        <span style={{ color: "#F5EFE0" }} className="text-base">cue</span>
      </div>
    );
  }
  if (id === "box-pop") {
    return (
      <span className="font-bold text-base px-2 py-0.5 rounded-md" style={{ background: "#FFD93D", color: "#0B1530" }}>BOOM!</span>
    );
  }
  if (id === "simple-mono") {
    return <span className="font-black text-white text-2xl tracking-tight" style={{ WebkitTextStroke: "2px black" }}>HOOK</span>;
  }
  if (id === "viral-pop") {
    return <span className="font-black text-yellow-300 text-2xl tracking-tight" style={{ WebkitTextStroke: "2px black" }}>VIRAL</span>;
  }
  if (id === "karaoke-line") {
    return (
      <div className="flex gap-1.5 items-center">
        <span className="text-white/70 font-bold text-base">your</span>
        <span className="text-yellow-300 font-black text-lg scale-110" style={{ WebkitTextStroke: "1.5px black" }}>BIG</span>
        <span className="text-white/70 font-bold text-base">day</span>
      </div>
    );
  }
  if (id === "stacked-bold") {
    return (
      <div className="flex flex-col items-center leading-none">
        <span className="text-white font-black text-xs">your biggest</span>
        <span className="text-amber-400 font-black text-2xl" style={{ WebkitTextStroke: "1.5px black" }}>WIN</span>
        <span className="text-white font-black text-xs">EVER</span>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center leading-none gap-0.5">
      <span className="italic text-white/90 text-xs">your biggest</span>
      <span className="text-amber-400 font-black text-2xl -rotate-3" style={{ WebkitTextStroke: "1.5px black" }}>WINS</span>
      <span className="text-white font-black text-xs rotate-1">IN LIFE</span>
    </div>
  );
}