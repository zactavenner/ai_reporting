import { useEffect, useRef, useState } from "react";
import { Play, Pause, Volume2, VolumeX, Maximize2, PictureInPicture2, Loader2, AlertCircle, Wand2, RotateCw, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

function fmtTime(t: number) {
  if (!isFinite(t) || t <= 0) return "0:00";
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

const SPEEDS = [0.5, 0.75, 1, 1.5, 2] as const;

export function VideoPlayerCard({
  src,
  poster,
  aspect = "9/16",
  className,
  status = "ready",
  progressLabel,
  progressPercent,
  errorMessage,
  onEdit,
}: {
  src?: string | null;
  poster?: string | null;
  aspect?: "9/16" | "16/9" | "1/1";
  className?: string;
  status?: "ready" | "generating" | "failed";
  progressLabel?: string;
  progressPercent?: number;
  errorMessage?: string;
  onEdit?: (src: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speed, setSpeed] = useState<number>(1);
  const [loadFailed, setLoadFailed] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => { setLoadFailed(false); }, [src, retryKey]);

  const togglePlay = () => {
    const v = videoRef.current; if (!v) return;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
  };
  const toggleMute = () => {
    const v = videoRef.current; if (!v) return;
    v.muted = !v.muted; setMuted(v.muted);
  };
  const setRate = (r: number) => {
    const v = videoRef.current; if (!v) return;
    v.playbackRate = r; setSpeed(r);
  };
  const seek = (pct: number) => {
    const v = videoRef.current; if (!v || !duration) return;
    v.currentTime = Math.max(0, Math.min(duration, (pct / 100) * duration));
  };
  const fullscreen = async () => {
    const v = videoRef.current; if (!v) return;
    try { if (v.requestFullscreen) await v.requestFullscreen(); } catch {}
  };
  const pip = async () => {
    const v = videoRef.current as any; if (!v) return;
    try {
      if (document.pictureInPictureElement) await (document as any).exitPictureInPicture();
      else if (v.requestPictureInPicture) await v.requestPictureInPicture();
    } catch {}
  };

  const aspectClass = aspect === "16/9" ? "aspect-video" : aspect === "1/1" ? "aspect-square" : "aspect-[9/16]";

  if (status === "generating") {
    return (
      <div className={cn("relative w-full rounded-md border bg-muted/40 grid place-items-center text-center p-6", aspectClass, className)}>
        <div className="space-y-2">
          <Loader2 className="h-6 w-6 animate-spin text-primary mx-auto" />
          <p className="text-xs text-muted-foreground">{progressLabel || "Generating video…"}</p>
          <div className="h-1.5 w-40 rounded bg-muted overflow-hidden mx-auto">
            <div className="h-full bg-primary transition-all duration-500" style={{ width: `${Math.max(2, Math.min(100, progressPercent ?? 30))}%` }} />
          </div>
        </div>
      </div>
    );
  }

  if (status === "failed" || loadFailed || !src) {
    return (
      <div className={cn("relative w-full rounded-md border bg-destructive/5 grid place-items-center text-center p-6", aspectClass, className)}>
        <div className="space-y-2">
          <AlertCircle className="h-6 w-6 text-destructive mx-auto" />
          <p className="text-xs text-destructive font-medium">Video unavailable</p>
          {errorMessage && <p className="text-[10px] text-muted-foreground max-w-[260px]">{errorMessage}</p>}
          {!errorMessage && loadFailed && <p className="text-[10px] text-muted-foreground">The video URL could not be loaded.</p>}
          {src && (
            <div className="flex items-center justify-center gap-1.5 pt-1">
              <button
                type="button"
                onClick={() => { setLoadFailed(false); setRetryKey(k => k + 1); }}
                className="h-7 px-2 inline-flex items-center gap-1 rounded bg-primary text-primary-foreground text-[10px] hover:bg-primary/90"
              >
                <RotateCw className="h-3 w-3" /> Retry
              </button>
              <a
                href={src}
                target="_blank"
                rel="noopener noreferrer"
                className="h-7 px-2 inline-flex items-center gap-1 rounded border text-[10px] hover:bg-muted"
              >
                <ExternalLink className="h-3 w-3" /> Open
              </a>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={cn("relative w-full rounded-md border overflow-hidden bg-black group", aspectClass, className)}>
      <video
        key={`${src}-${retryKey}`}
        ref={videoRef}
        poster={poster || undefined}
        playsInline
        preload="metadata"
        crossOrigin="anonymous"
        className="w-full h-full object-contain"
        onClick={togglePlay}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={(e) => setCurrent((e.target as HTMLVideoElement).currentTime)}
        onLoadedMetadata={(e) => setDuration((e.target as HTMLVideoElement).duration || 0)}
        onVolumeChange={(e) => setMuted((e.target as HTMLVideoElement).muted)}
        onError={() => setLoadFailed(true)}
      >
        <source src={src} type="video/mp4" />
      </video>
      {/* Big play overlay when paused */}
      {!playing && (
        <button
          type="button"
          onClick={togglePlay}
          className="absolute inset-0 grid place-items-center bg-black/20 hover:bg-black/30 transition opacity-100"
          aria-label="Play"
        >
          <span className="h-14 w-14 rounded-full bg-white/90 grid place-items-center shadow-lg">
            <Play className="h-6 w-6 text-black translate-x-0.5" />
          </span>
        </button>
      )}
      {/* Controls */}
      <div className="absolute left-0 right-0 bottom-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent p-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <div className="flex items-center gap-2 mb-1">
          <input
            type="range"
            min={0}
            max={100}
            step={0.1}
            value={duration ? (current / duration) * 100 : 0}
            onChange={(e) => seek(Number(e.target.value))}
            className="flex-1 h-1 accent-white cursor-pointer"
            aria-label="Seek"
          />
          <span className="text-[10px] text-white tabular-nums whitespace-nowrap">
            {fmtTime(current)} / {fmtTime(duration)}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <button onClick={togglePlay} className="h-7 w-7 grid place-items-center rounded hover:bg-white/10 text-white" title={playing ? "Pause" : "Play"}>
            {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          </button>
          <button onClick={toggleMute} className="h-7 w-7 grid place-items-center rounded hover:bg-white/10 text-white" title={muted ? "Unmute" : "Mute"}>
            {muted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
          </button>
          <select
            value={speed}
            onChange={(e) => setRate(Number(e.target.value))}
            className="h-6 bg-white/10 text-white text-[10px] rounded px-1 border-0 focus:outline-none cursor-pointer"
            title="Playback speed"
          >
            {SPEEDS.map(s => <option key={s} value={s} className="text-black">{s}×</option>)}
          </select>
          <div className="flex-1" />
          {onEdit && (
            <button
              onClick={() => onEdit(src!)}
              className="h-7 px-2 grid place-items-center rounded bg-primary/90 hover:bg-primary text-primary-foreground text-[10px] gap-1 inline-flex"
              title="Edit this video with Hyperframes-style chat"
            >
              <Wand2 className="h-3 w-3" /> Edit
            </button>
          )}
          <button onClick={pip} className="h-7 w-7 grid place-items-center rounded hover:bg-white/10 text-white" title="Picture-in-picture">
            <PictureInPicture2 className="h-3.5 w-3.5" />
          </button>
          <button onClick={fullscreen} className="h-7 w-7 grid place-items-center rounded hover:bg-white/10 text-white" title="Fullscreen">
            <Maximize2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}