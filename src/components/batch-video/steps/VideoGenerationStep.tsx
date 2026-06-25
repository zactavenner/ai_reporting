import { useState, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  ArrowLeft, Video, Play, Pause, Download, Trash2, Loader2, Check,
  AlertCircle, RefreshCw, RotateCcw, Edit3, Save, X, ChevronDown,
  ChevronUp, Image as ImageIcon, Copy, Sparkles, Zap,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { fetchVideoAsBlob } from '@/lib/video-proxy';
import { useImageToVideoGeneration } from '@/hooks/useImageToVideoGeneration';
import { useSaveAssetFromUrl } from '@/hooks/useAssets';
import { SimpleVideoPreviewDialog } from '@/components/batch-video/SimpleVideoPreviewDialog';
import { SceneTimeline } from '@/components/batch-video/SceneTimeline';
import type { BatchVideoScene, BatchVideoConfig, ScriptSegment, VideoModel, ExportFormat } from '@/types/batch-video';

interface VideoGenerationStepProps {
  scenes: BatchVideoScene[];
  config: Partial<BatchVideoConfig>;
  onUpdateScene: (sceneId: string, updates: Partial<BatchVideoScene>) => void;
  onUpdateSegment: (segmentId: string, updates: Partial<ScriptSegment>) => void;
  onDeleteScene: (sceneId: string) => void;
  onDuplicateScene: (sceneId: string) => void;
  onReorderScene: (sceneId: string, direction: 'up' | 'down') => void;
  onBack: () => void;
  onReset: () => void;
  onVideoComplete?: (scene: BatchVideoScene) => void;
  brandContext?: { colors: string[]; fonts: string[]; offer: string };
}

export function VideoGenerationStep({
  scenes, config, onUpdateScene, onUpdateSegment,
  onDeleteScene, onDuplicateScene, onReorderScene, onBack, onReset,
  onVideoComplete, brandContext,
}: VideoGenerationStepProps) {
  const [previewScene, setPreviewScene] = useState<BatchVideoScene | null>(null);
  const [generatingAll, setGeneratingAll] = useState(false);
  const [generatingAllProgress, setGeneratingAllProgress] = useState({ current: 0, total: 0 });
  const [videoModel, setVideoModel] = useState<VideoModel>(config.videoModel || 'veo3');
  const [exportFormat, setExportFormat] = useState<ExportFormat>(config.exportFormat || 'mp4-1080p');
  const { generateVideoFromImage, generatingSceneId } = useImageToVideoGeneration();
  const saveAsset = useSaveAssetFromUrl();

  const handleGenerateVideo = async (scene: BatchVideoScene) => {
    if (!scene.generatedImageUrl) { toast.error('Generate scene image first'); return; }
    onUpdateScene(scene.id, { status: 'video_generating' });
    const isBroll = scene.useAvatar === false;
    const cam = scene.segment.cameraAngle ? `Camera: ${scene.segment.cameraAngle} shot. ` : '';
    const brandStr = brandContext?.offer ? ` Brand context: ${brandContext.offer}.` : '';
    const colorStr = brandContext?.colors?.length ? ` Brand colors: ${brandContext.colors.join(', ')}.` : '';
    const videoPrompt = isBroll
      ? `${cam}Cinematic B-roll. ${scene.segment.sceneDescription || scene.segment.imagePrompt}. Smooth movement. No people.${brandStr}${colorStr}`
      : `${cam}Person maintains eye contact, speaks naturally. ${scene.segment.sceneDescription || scene.segment.imagePrompt}.${scene.segment.text ? ` Says: "${scene.segment.text}".` : ''} Same outfit.${brandStr}`;

    await generateVideoFromImage({
      sceneId: scene.id,
      imageUrl: scene.generatedImageUrl,
      prompt: videoPrompt,
      aspectRatio: (config.aspectRatio === '9:16' ? '9:16' : '16:9') as '16:9' | '9:16',
      duration: 8,
      videoModel,
      onStatusUpdate: (sceneId, result) => {
        if (result.status === 'completed' && result.videoUrl) {
          const updatedScene = { ...scene, status: 'video_completed' as const, videoUrl: result.videoUrl };
          onUpdateScene(sceneId, { status: 'video_completed', videoUrl: result.videoUrl });
          saveAsset.mutate({ url: result.videoUrl, projectId: config.projectId, clientId: config.clientId, type: 'video', name: `Batch - Scene ${scene.order}` });
          onVideoComplete?.(updatedScene);
        } else if (result.status === 'failed') {
          onUpdateScene(sceneId, { status: 'failed', error: result.error });
        } else if (result.status === 'processing') {
          onUpdateScene(sceneId, { status: 'video_generating', operationId: result.operationId });
        }
      },
    });
  };

  const handleGenerateAllVideos = async () => {
    const eligible = scenes.filter(s => s.generatedImageUrl && s.status !== 'video_completed' && s.status !== 'video_generating');
    if (!eligible.length) return;
    setGeneratingAll(true);
    setGeneratingAllProgress({ current: 0, total: eligible.length });
    // Mark all as queued first
    eligible.forEach(s => onUpdateScene(s.id, { status: 'queued' as any }));
    for (let i = 0; i < eligible.length; i++) {
      setGeneratingAllProgress({ current: i + 1, total: eligible.length });
      await handleGenerateVideo(eligible[i]);
    }
    setGeneratingAll(false);
    toast.success('All videos generated');
  };

  const handleDownload = async (scene: BatchVideoScene) => {
    if (!scene.videoUrl) return;
    try {
      const blob = await fetchVideoAsBlob(scene.videoUrl);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `scene-${scene.order}.mp4`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch { toast.error('Download failed'); }
  };

  const completedCount = scenes.filter(s => s.status === 'video_completed').length;
  const progress = scenes.length > 0 ? (completedCount / scenes.length) * 100 : 0;
  const eligible = scenes.filter(s => s.generatedImageUrl && s.status !== 'video_completed' && s.status !== 'video_generating').length;

  // Credit cost estimate
  const creditCost = scenes.length * (videoModel === 'veo3' ? 5 : videoModel === 'haiper-1.1' ? 3 : 2);

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Video className="h-5 w-5" />Step 4: Generate & Export</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Model Selector */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <button onClick={() => setVideoModel('nano-banana-pro')}
              className={cn('p-4 rounded-lg border-2 text-left transition-all', videoModel === 'nano-banana-pro' ? 'border-primary bg-primary/5' : 'border-border hover:border-muted-foreground/50')}>
              <div className="flex items-center gap-2 mb-1">
                <Zap className="h-4 w-4 text-primary" />
                <span className="font-semibold text-sm">Nano Banana Pro</span>
                {videoModel === 'nano-banana-pro' && <Check className="h-4 w-4 text-primary ml-auto" />}
              </div>
              <p className="text-xs text-muted-foreground">Fast avatar-based generation. ~2 credits/scene</p>
            </button>
            <button onClick={() => setVideoModel('veo3')}
              className={cn('p-4 rounded-lg border-2 text-left transition-all', videoModel === 'veo3' ? 'border-primary bg-primary/5' : 'border-border hover:border-muted-foreground/50')}>
              <div className="flex items-center gap-2 mb-1">
                <Sparkles className="h-4 w-4 text-primary" />
                <span className="font-semibold text-sm">Veo3 — Hyper-Realistic AI Video</span>
                {videoModel === 'veo3' && <Check className="h-4 w-4 text-primary ml-auto" />}
              </div>
              <p className="text-xs text-muted-foreground">Cinema-quality output. ~5 credits/scene</p>
            </button>
            <button onClick={() => setVideoModel('haiper-1.1')}
              className={cn('p-4 rounded-lg border-2 text-left transition-all', videoModel === 'haiper-1.1' ? 'border-primary bg-primary/5' : 'border-border hover:border-muted-foreground/50')}>
              <div className="flex items-center gap-2 mb-1">
                <Video className="h-4 w-4 text-primary" />
                <span className="font-semibold text-sm">Happy Horse 1.1</span>
                {videoModel === 'haiper-1.1' && <Check className="h-4 w-4 text-primary ml-auto" />}
              </div>
              <p className="text-xs text-muted-foreground">OpenRouter — fast video via Haiper. ~3 credits/scene</p>
            </button>
          </div>

          {/* Veo3 Prompt Preview */}
          {videoModel === 'veo3' && scenes.length > 0 && (
            <div className="p-3 bg-muted rounded-lg space-y-1">
              <Label className="text-xs font-semibold">Veo3 Prompt Preview — Scene 1</Label>
              <p className="text-xs text-muted-foreground italic">
                {scenes[0].useAvatar !== false
                  ? `Camera: ${scenes[0].segment.cameraAngle || 'medium'} shot. Person maintains eye contact, speaks naturally. ${(scenes[0].segment.sceneDescription || scenes[0].segment.imagePrompt).substring(0, 120)}...`
                  : `Cinematic B-roll. ${(scenes[0].segment.sceneDescription || scenes[0].segment.imagePrompt).substring(0, 120)}...`}
              </p>
            </div>
          )}

          {/* Export + Cost */}
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex gap-2">
              {(['mp4-1080p', 'mp4-4k', 'mov'] as ExportFormat[]).map(f => (
                <Button key={f} size="sm" variant={exportFormat === f ? 'default' : 'outline'} onClick={() => setExportFormat(f)} className="text-xs h-7">
                  {f === 'mp4-1080p' ? 'MP4 1080p' : f === 'mp4-4k' ? 'MP4 4K' : 'MOV'}
                </Button>
              ))}
            </div>
            <Badge variant="secondary" className="text-xs">Est. {creditCost} credits</Badge>
          </div>

          {/* Progress */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span>Progress</span>
              <span className="text-muted-foreground">{completedCount}/{scenes.length} completed</span>
            </div>
            <Progress value={progress} className="h-2" />
          </div>

          {/* Generate All */}
          <Button onClick={handleGenerateAllVideos} disabled={generatingAll || !!generatingSceneId || eligible === 0} className="w-full gap-2" size="lg">
            {generatingAll ? <><Loader2 className="h-4 w-4 animate-spin" />Generating {generatingAllProgress.current}/{generatingAllProgress.total}...</>
              : <><Video className="h-4 w-4" />Generate All Scenes {eligible > 0 && `(${eligible})`}</>}
          </Button>

          {/* Scene List */}
          <ScrollArea className="h-[400px] pr-4">
            <div className="space-y-3">
              {scenes.map((scene, index) => (
                <VideoSceneRow key={scene.id} scene={scene} index={index} totalScenes={scenes.length}
                  isGenerating={generatingSceneId === scene.id}
                  onGenerate={() => handleGenerateVideo(scene)}
                  onPreview={() => setPreviewScene(scene)}
                  onDownload={() => handleDownload(scene)}
                  onDelete={() => onDeleteScene(scene.id)}
                  onDuplicate={() => onDuplicateScene(scene.id)}
                  onMoveUp={() => onReorderScene(scene.id, 'up')}
                  onMoveDown={() => onReorderScene(scene.id, 'down')}
                  onUpdateSegment={(u) => onUpdateSegment(scene.segment.id, u)}
                />
              ))}
            </div>
          </ScrollArea>

          <SceneTimeline scenes={scenes} />

          {/* Navigation */}
          <div className="flex justify-between pt-4">
            <Button variant="outline" onClick={onBack} className="gap-2"><ArrowLeft className="h-4 w-4" />Back</Button>
            <Button variant="outline" onClick={onReset} className="gap-2"><RotateCcw className="h-4 w-4" />Start New Batch</Button>
          </div>
        </CardContent>
      </Card>

      {previewScene?.videoUrl && (
        <SimpleVideoPreviewDialog open={!!previewScene} onOpenChange={() => setPreviewScene(null)}
          videoUrl={previewScene.videoUrl} title={`Scene ${previewScene.order}`} aspectRatio={(config.aspectRatio === '9:16' ? '9:16' : '16:9')} />
      )}
    </>
  );
}

// ─── Scene Row ──────────────────────────────────────────────────────────────

function VideoSceneRow({ scene, index, totalScenes, isGenerating, onGenerate, onPreview, onDownload, onDelete, onDuplicate, onMoveUp, onMoveDown, onUpdateSegment }: {
  scene: BatchVideoScene; index: number; totalScenes: number; isGenerating: boolean;
  onGenerate: () => void; onPreview: () => void; onDownload: () => void;
  onDelete: () => void; onDuplicate: () => void; onMoveUp: () => void; onMoveDown: () => void;
  onUpdateSegment: (u: Partial<ScriptSegment>) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const imageUrl = scene.generatedImageUrl;
  const hasVideo = scene.status === 'video_completed' && scene.videoUrl;

  const statusMap: Record<string, { label: string; color: string; est?: string }> = {
    pending: { label: 'Pending', color: 'text-muted-foreground' },
    queued: { label: 'Queued', color: 'text-amber-500', est: '~2 min' },
    image_generating: { label: 'Preparing', color: 'text-primary', est: '~30s' },
    image_completed: { label: 'Image Ready', color: 'text-emerald-500' },
    video_generating: { label: 'Rendering...', color: 'text-primary', est: '~90s' },
    video_completed: { label: 'Complete', color: 'text-emerald-500' },
    failed: { label: 'Failed', color: 'text-destructive' },
  };
  const st = statusMap[scene.status] || statusMap.pending;

  return (
    <div className={cn('border rounded-lg p-3 flex gap-3', isGenerating && 'ring-2 ring-primary')}>
      {/* Thumbnail */}
      <div className="w-32 h-20 bg-muted rounded overflow-hidden flex-shrink-0 relative">
        {hasVideo ? (
          <video ref={videoRef} src={scene.videoUrl} className="w-full h-full object-cover" loop muted playsInline
            onPlay={() => setIsPlaying(true)} onPause={() => setIsPlaying(false)} />
        ) : imageUrl ? (
          <img src={imageUrl} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center"><Video className="h-6 w-6 text-muted-foreground" /></div>
        )}
        <Badge className="absolute top-1 left-1 text-[10px] h-5" variant="secondary">S{index + 1}</Badge>
        {/* Status indicator */}
        {scene.status === 'video_generating' && (
          <div className="absolute inset-0 bg-black/40 flex items-center justify-center"><Loader2 className="h-5 w-5 text-white animate-spin" /></div>
        )}
        {scene.status === 'queued' && (
          <div className="absolute inset-0 bg-black/30 flex items-center justify-center"><span className="text-[10px] text-white font-medium">Queued</span></div>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center gap-2">
          <span className={cn('text-xs font-medium', st.color)}>{st.label}</span>
          {(scene.status === 'video_generating' || scene.status === 'queued') && (
            <div className="flex items-center gap-1.5">
              <Progress value={scene.status === 'video_generating' ? 50 : 10} className="h-1 flex-1 max-w-[60px]" />
              {st.est && <span className="text-[10px] text-muted-foreground">{st.est}</span>}
            </div>
          )}
          <span className="text-xs text-muted-foreground">{scene.segment.duration}s</span>
        </div>
        <p className="text-xs text-muted-foreground line-clamp-1">{scene.segment.sceneDescription || scene.segment.imagePrompt}</p>
        {scene.error && <p className="text-xs text-destructive">{scene.error}</p>}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 shrink-0">
        {hasVideo && (
          <>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onPreview}><Play className="h-3.5 w-3.5" /></Button>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onDownload}><Download className="h-3.5 w-3.5" /></Button>
          </>
        )}
        {!hasVideo && scene.generatedImageUrl && (
          <Button size="sm" onClick={onGenerate} disabled={isGenerating} className="gap-1 h-7 text-xs">
            {isGenerating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Video className="h-3 w-3" />}
            {scene.status === 'failed' ? 'Retry' : 'Generate'}
          </Button>
        )}
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onMoveUp} disabled={index === 0}><ChevronUp className="h-3 w-3" /></Button>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onMoveDown} disabled={index === totalScenes - 1}><ChevronDown className="h-3 w-3" /></Button>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onDuplicate}><Copy className="h-3 w-3" /></Button>
        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={onDelete}><Trash2 className="h-3 w-3" /></Button>
      </div>
    </div>
  );
}
