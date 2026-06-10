import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Loader2,
  Play,
  Pause,
  Plus,
  Trash2,
  Type,
  Subtitles,
  Sticker,
  Download,
  Send,
  Wand2,
  Save,
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
  makeDefaultComposition,
} from "./timeline";

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
}

export function HyperframesEditor({
  clientId,
  videoUrl,
  aspectRatio = "9:16",
  initialPrompt,
  sourceVideoId,
  onSaved,
}: Props) {
  const canvasRef = useRef<HyperframesCanvasHandle>(null);
  const [duration, setDuration] = useState(8);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [exportTick, setExportTick] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [messages, setMessages] = useState<
    { role: "user" | "assistant"; content: string }[]
  >([]);

  const [comp, setComp] = useState<HyperframesComposition>(() =>
    makeDefaultComposition(videoUrl, 8, aspectRatio),
  );

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
      // Mix in source audio if possible
      try {
        const v: any = video;
        const vStream: MediaStream | undefined =
          v.captureStream?.() || v.mozCaptureStream?.();
        if (vStream) {
          vStream.getAudioTracks().forEach((t) => stream.addTrack(t));
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

      const blob = new Blob(chunks, { type: mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `hyperframes-${Date.now()}.webm`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Exported. Use 'Save to library' to also push it into the client video set.");
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
        const v: any = video;
        const vStream: MediaStream | undefined =
          v.captureStream?.() || v.mozCaptureStream?.();
        if (vStream) vStream.getAudioTracks().forEach((t) => stream.addTrack(t));
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

      const blob = new Blob(chunks, { type: mime });
      const path = `ai-studio/${clientId}/hyperframes-${Date.now()}.webm`;
      const up = await supabase.storage
        .from("creatives")
        .upload(path, blob, { contentType: mime, upsert: false });
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
    <div className="flex-1 grid grid-cols-[1fr_320px_320px] gap-0 min-h-0">
      {/* Canvas + transport */}
      <div className="border-r p-4 flex flex-col gap-3 min-h-0 bg-black/80">
        <div className="flex items-center justify-between gap-2">
          <Badge variant="outline" className="text-[10px] gap-1">
            <Wand2 className="h-3 w-3" /> Hyperframes runtime
          </Badge>
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" onClick={() => addText("text")} title="Add headline">
              <Type className="h-3.5 w-3.5" />
            </Button>
            <Button size="sm" variant="ghost" onClick={() => addText("subtitle")} title="Add subtitle">
              <Subtitles className="h-3.5 w-3.5" />
            </Button>
            <Button size="sm" variant="ghost" onClick={addIcon} title="Add icon">
              <Sticker className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        <div className="flex-1 flex items-center justify-center">
          <div className="w-full max-w-full" style={{ ...aspectStyle, maxHeight: "100%" }}>
            <HyperframesCanvas
              ref={canvasRef}
              comp={comp}
              exportTick={exportTick}
              onTime={setTime}
              onDuration={(d) => setDuration(Math.max(2, Math.min(60, Math.round(d))))}
              className="w-full h-full"
            />
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
          <div className="flex justify-end gap-2">
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

      {/* Layer panel */}
      <div className="border-r flex flex-col min-h-0">
        <div className="p-3 border-b flex items-center justify-between">
          <span className="text-xs font-semibold">Layers</span>
          <Button size="sm" variant="ghost" onClick={() => addText("text")}>
            <Plus className="h-3.5 w-3.5" />
          </Button>
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
                    onClick={(e) => {
                      e.stopPropagation();
                      removeLayer(l.id);
                    }}
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
                <Textarea
                  rows={2}
                  value={(selected as TextLayer).text}
                  onChange={(e) => updateLayer(selected.id, { text: e.target.value } as any)}
                  className="text-xs"
                />
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] uppercase text-muted-foreground">Font px</label>
                    <Input
                      type="number"
                      value={(selected as TextLayer).fontSize ?? 64}
                      onChange={(e) => updateLayer(selected.id, { fontSize: +e.target.value } as any)}
                      className="h-7 text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] uppercase text-muted-foreground">Color</label>
                    <Input
                      type="color"
                      value={(selected as TextLayer).color ?? "#ffffff"}
                      onChange={(e) => updateLayer(selected.id, { color: e.target.value } as any)}
                      className="h-7 p-0.5"
                    />
                  </div>
                </div>
              </>
            )}
            {selected.type === "icon" && (
              <div>
                <label className="block text-[10px] uppercase text-muted-foreground">Emoji / glyph</label>
                <Input
                  value={(selected as IconLayer).glyph}
                  onChange={(e) => updateLayer(selected.id, { glyph: e.target.value } as any)}
                  className="h-7 text-xs"
                />
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[10px] uppercase text-muted-foreground">Start (s)</label>
                <Input
                  type="number"
                  step="0.1"
                  value={selected.start}
                  onChange={(e) => updateLayer(selected.id, { start: +e.target.value })}
                  className="h-7 text-xs"
                />
              </div>
              <div>
                <label className="block text-[10px] uppercase text-muted-foreground">End (s)</label>
                <Input
                  type="number"
                  step="0.1"
                  value={selected.end}
                  onChange={(e) => updateLayer(selected.id, { end: +e.target.value })}
                  className="h-7 text-xs"
                />
              </div>
              <div>
                <label className="block text-[10px] uppercase text-muted-foreground">X (0-1)</label>
                <Input
                  type="number"
                  step="0.05"
                  value={selected.x}
                  onChange={(e) => updateLayer(selected.id, { x: +e.target.value })}
                  className="h-7 text-xs"
                />
              </div>
              <div>
                <label className="block text-[10px] uppercase text-muted-foreground">Y (0-1)</label>
                <Input
                  type="number"
                  step="0.05"
                  value={selected.y}
                  onChange={(e) => updateLayer(selected.id, { y: +e.target.value })}
                  className="h-7 text-xs"
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* AI chat */}
      <div className="flex flex-col min-h-0">
        <div className="p-3 border-b flex items-center gap-2">
          <Wand2 className="h-3.5 w-3.5 text-primary" />
          <span className="text-xs font-semibold">Edit with AI</span>
        </div>
        <ScrollArea className="flex-1">
          <div className="p-3 space-y-2">
            {messages.length === 0 && (
              <div className="text-[11px] text-muted-foreground">
                Tell me what to layer on. Examples:
                <div className="flex flex-col gap-1 mt-2">
                  {QUICK.map((q) => (
                    <button
                      key={q}
                      className="text-left text-[10px] px-2 py-1 rounded border border-border/40 hover:bg-muted/40"
                      onClick={() => setChatInput(q)}
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((m, i) => (
              <div
                key={i}
                className={`text-[11px] rounded-md px-3 py-2 ${
                  m.role === "user" ? "bg-primary/10 ml-6" : "bg-muted mr-6"
                }`}
              >
                <div className="text-[9px] uppercase tracking-wide text-muted-foreground mb-0.5">
                  {m.role}
                </div>
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
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) sendChat();
            }}
          />
          <div className="flex justify-end">
            <Button size="sm" onClick={sendChat} disabled={chatBusy || !chatInput.trim()}>
              <Send className="h-3.5 w-3.5 mr-1" />
              Send
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}