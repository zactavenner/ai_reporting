import { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';
import { Download, Loader2 } from 'lucide-react';
import type { VideoClip, Caption, CaptionStyleType, CaptionPosition, TextOverlay } from '@/hooks/useVideoEditor';
import { HyperframesExportPanel } from './HyperframesExportPanel';
import { renderCaptions } from './CaptionRenderer';
import { toast } from 'sonner';

interface ExportDialogProps {
  projectId: string;
  projectName: string;
  clientId: string | null;
  onClientChange: (clientId: string) => void;
  onSourcesPersisted: (sources: Record<string, string>) => void;
  textOverlays: TextOverlay[];
  clips: VideoClip[];
  captions: Caption[];
  captionStyle: CaptionStyleType;
  captionFontSize: number;
  captionColor: string;
  captionFontFamily: string;
  captionPosition: CaptionPosition;
  captionStroke: boolean;
  captionBackground: boolean;
  aspectRatio: '16:9' | '9:16' | '1:1';
  voiceoverBlobUrl: string | null;
  voiceoverVolume: number;
}

type Quality = 'high' | 'medium' | 'low';
const BITRATES: Record<Quality, number> = {
  high: 8_000_000,
  medium: 4_000_000,
  low: 2_000_000,
};

type Platform = 'custom' | 'tiktok' | 'reels' | 'shorts' | 'youtube' | 'linkedin' | 'twitter';

const PLATFORM_PRESETS: Record<Platform, { label: string; ar: string; maxDuration?: number; desc: string }> = {
  custom: { label: 'Custom', ar: 'current', desc: 'Use current settings' },
  tiktok: { label: 'TikTok', ar: '9:16', maxDuration: 180, desc: '9:16, up to 3min' },
  reels: { label: 'Instagram Reels', ar: '9:16', maxDuration: 90, desc: '9:16, up to 90s' },
  shorts: { label: 'YouTube Shorts', ar: '9:16', maxDuration: 60, desc: '9:16, up to 60s' },
  youtube: { label: 'YouTube', ar: '16:9', desc: '16:9, 1080p' },
  linkedin: { label: 'LinkedIn', ar: '16:9', desc: '16:9 or 1:1' },
  twitter: { label: 'Twitter/X', ar: '16:9', maxDuration: 140, desc: '16:9, up to 2:20' },
};

export function ExportDialog({
  projectId, projectName, clientId, onClientChange, onSourcesPersisted, textOverlays,
  clips,
  captions,
  captionStyle,
  captionFontSize,
  captionColor,
  captionFontFamily,
  captionPosition,
  captionStroke,
  captionBackground,
  aspectRatio,
  voiceoverBlobUrl,
  voiceoverVolume,
}: ExportDialogProps) {
  const [quality, setQuality] = useState<Quality>('high');
  const [platform, setPlatform] = useState<Platform>('custom');
  const [isExporting, setIsExporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);

  const totalDuration = clips.reduce((sum, c) => sum + (c.trimEnd - c.trimStart), 0);
  const selectedPreset = PLATFORM_PRESETS[platform];
  const exceedsLimit = selectedPreset.maxDuration && totalDuration > selectedPreset.maxDuration;

  const handleExport = useCallback(async () => {
    if (clips.length === 0) {
      toast.error('No clips to export');
      return;
    }

    setIsExporting(true);
    setProgress(0);
    setDownloadUrl(null);

    try {
      const width = aspectRatio === '9:16' ? 1080 : aspectRatio === '1:1' ? 1080 : 1920;
      const height = aspectRatio === '9:16' ? 1920 : aspectRatio === '1:1' ? 1080 : 1080;

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d')!;

      const stream = canvas.captureStream(30);
      const audioCtx = new AudioContext();
      const destination = audioCtx.createMediaStreamDestination();
      destination.stream.getAudioTracks().forEach(t => stream.addTrack(t));

      let mimeType = 'video/webm;codecs=vp9';
      if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = 'video/webm;codecs=vp8';
      if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = 'video/webm';

      const recorder = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: BITRATES[quality],
      });

      const chunks: Blob[] = [];
      recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
      recorder.start(100);

      if (voiceoverBlobUrl) {
        try {
          const voResponse = await fetch(voiceoverBlobUrl);
          const voArrayBuffer = await voResponse.arrayBuffer();
          const voAudioBuffer = await audioCtx.decodeAudioData(voArrayBuffer);
          const voSource = audioCtx.createBufferSource();
          voSource.buffer = voAudioBuffer;
          const voGain = audioCtx.createGain();
          voGain.gain.value = voiceoverVolume;
          voSource.connect(voGain);
          voGain.connect(destination);
          voSource.start(0);
        } catch (voErr) {
          console.warn('Failed to load voiceover for export:', voErr);
        }
      }

      for (let i = 0; i < clips.length; i++) {
        setProgress(Math.round((i / clips.length) * 100));
        const clip = clips[i];
        const video = document.createElement('video');
        video.src = clip.blobUrl;
        video.muted = true;
        video.playsInline = true;
        video.currentTime = clip.trimStart;

        await new Promise<void>((resolve, reject) => {
          video.onloadeddata = () => resolve();
          video.onerror = () => reject(new Error(`Failed to load clip ${i + 1}`));
        });

        const source = audioCtx.createMediaElementSource(video);
        source.connect(destination);
        const trimEnd = clip.trimEnd;

        await new Promise<void>((resolve) => {
          const drawFrame = () => {
            if (video.currentTime >= trimEnd || video.paused || video.ended) {
              video.pause();
              resolve();
              return;
            }
            ctx.drawImage(video, 0, 0, width, height);

            if (captionStyle !== 'none') {
              const globalTime = clip.startTime + (video.currentTime - clip.trimStart);
              const caption = captions.find(c => globalTime >= c.startTime && globalTime < c.endTime);
              if (caption) {
                renderCaptions({
                  ctx,
                  caption,
                  currentTime: globalTime,
                  width,
                  height,
                  style: captionStyle,
                  fontSize: captionFontSize,
                  color: captionColor,
                  fontFamily: captionFontFamily,
                  position: captionPosition,
                  showStroke: captionStroke,
                  showBackground: captionBackground,
                });
              }
            }

            requestAnimationFrame(drawFrame);
          };
          video.play().then(drawFrame).catch(() => resolve());
        });
      }

      setProgress(100);
      const finalBlob = await new Promise<Blob>((resolve) => {
        recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
        recorder.stop();
      });

      const url = URL.createObjectURL(finalBlob);
      setDownloadUrl(url);
      toast.success('Export complete!');
    } catch (err) {
      console.error('Export failed:', err);
      toast.error('Export failed');
    } finally {
      setIsExporting(false);
    }
  }, [clips, captions, captionStyle, captionFontSize, captionColor, captionFontFamily, captionPosition, captionStroke, captionBackground, aspectRatio, quality, voiceoverBlobUrl, voiceoverVolume]);

  return (
    <div className="p-4 space-y-4">
      <HyperframesExportPanel
        projectId={projectId} projectName={projectName} clientId={clientId} onClientChange={onClientChange}
        onSourcesPersisted={onSourcesPersisted}
        clips={clips} captions={captions} textOverlays={textOverlays} aspectRatio={aspectRatio}
        captionSettings={{ style: captionStyle, fontSize: captionFontSize, color: captionColor, fontFamily: captionFontFamily, position: captionPosition, stroke: captionStroke, background: captionBackground }}
        voiceoverBlobUrl={voiceoverBlobUrl} voiceoverVolume={voiceoverVolume}
      />
      {/* Platform presets */}
      <div className="space-y-2">
        <label className="text-xs font-medium text-muted-foreground">Platform</label>
        <Select value={platform} onValueChange={(v) => setPlatform(v as Platform)}>
          <SelectTrigger className="text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(PLATFORM_PRESETS).map(([key, preset]) => (
              <SelectItem key={key} value={key}>
                <span>{preset.label}</span>
                <span className="text-muted-foreground ml-2 text-[10px]">{preset.desc}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {exceedsLimit && (
          <p className="text-[10px] text-destructive">
            Video ({totalDuration.toFixed(0)}s) exceeds {selectedPreset.label} max ({selectedPreset.maxDuration}s)
          </p>
        )}
      </div>

      <div className="space-y-2">
        <label className="text-xs font-medium text-muted-foreground">Aspect Ratio</label>
        <p className="text-sm">{aspectRatio}</p>
      </div>

      <div className="space-y-2">
        <label className="text-xs font-medium text-muted-foreground">Quality</label>
        <Select value={quality} onValueChange={(v) => setQuality(v as Quality)}>
          <SelectTrigger className="text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="high">High (8 Mbps)</SelectItem>
            <SelectItem value="medium">Medium (4 Mbps)</SelectItem>
            <SelectItem value="low">Low (2 Mbps)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Estimated file size */}
      <div className="text-[10px] text-muted-foreground">
        Est. size: ~{((BITRATES[quality] * totalDuration) / 8 / 1024 / 1024).toFixed(1)} MB
      </div>

      {isExporting && (
        <div className="space-y-2">
          <Progress value={progress} className="h-2" />
          <p className="text-xs text-muted-foreground text-center">{progress}% — Rendering...</p>
        </div>
      )}

      {!downloadUrl ? (
        <Button
          className="w-full gap-2"
          onClick={handleExport}
          disabled={isExporting || clips.length === 0}
        >
          {isExporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          {isExporting ? 'Exporting...' : 'Browser export (WebM)'}
        </Button>
      ) : (
        <Button className="w-full gap-2" asChild>
          <a href={downloadUrl} download={`video-export-${Date.now()}.webm`}>
            <Download className="h-4 w-4" />
            Download (WebM)
          </a>
        </Button>
      )}
    </div>
  );
}
