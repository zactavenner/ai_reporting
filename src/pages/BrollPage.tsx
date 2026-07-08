import { useState, useEffect } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Film,
  Sparkles,
  Loader2,
  Wand2,
  Type,
  Layers,
} from 'lucide-react';
import { useClients } from '@/hooks/useClients';
import { useBrollGeneration } from '@/hooks/useBrollGeneration';
import { useSingleJobPersistence } from '@/hooks/useSingleJobPersistence';
import { useBrollAssets, useDeleteAsset, useCreateAsset, useUpdateAsset } from '@/hooks/useAssets';
import { AssetGrid } from '@/components/assets/AssetGrid';
import { KeyframeUploader, TRANSITION_PRESETS } from '@/components/broll/KeyframeUploader';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import type { Asset } from '@/types';
import { fetchVideoAsBlob } from '@/lib/video-proxy';

const VIDEO_MODEL = 'Google Veo 3';
const VIDEO_MODEL_DISPLAY = 'Veo 3 Fast';

type AspectRatio = '16:9' | '9:16' | '1:1' | '4:5';
type GenerationMode = 'text' | 'keyframe';

const ASPECT_RATIOS: { value: AspectRatio; label: string; icon: string }[] = [
  { value: '16:9', label: 'Landscape', icon: '▬' },
  { value: '9:16', label: 'Portrait', icon: '▮' },
  { value: '1:1', label: 'Square', icon: '■' },
  { value: '4:5', label: 'Social', icon: '▯' },
];

const PROMPT_SUGGESTIONS = [
  'Calm ocean waves at sunset, golden hour lighting',
  'Modern city skyline at night with lights',
  'Nature forest with sunbeams through trees',
  'Coffee being poured into a cup, slow motion',
  'Abstract colorful gradients flowing smoothly',
  'People walking in busy urban street, shallow DOF',
  'Clouds moving across blue sky, timelapse',
  'Product showcase on clean white background',
];

export default function BrollPage() {
  const { data: clients = [] } = useClients();
  const { generateVideo, generateFromKeyframes, isGenerating: isApiGenerating, stopPolling } = useBrollGeneration();
  const { createJobRecord, updateScene } = useSingleJobPersistence();

  const { data: brollAssets = [], isLoading: isLoadingAssets, refetch: refetchAssets } = useBrollAssets();
  const deleteAssetMutation = useDeleteAsset();
  const createAssetMutation = useCreateAsset();
  const updateAssetMutation = useUpdateAsset();

  // Form state
  const [mode, setMode] = useState<GenerationMode>('text');
  const [prompt, setPrompt] = useState('');
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('16:9');
  const [duration, setDuration] = useState(5);
  const [selectedClientId, setSelectedClientId] = useState<string>('');
  const [isGenerating, setIsGenerating] = useState(false);

  // Keyframe state
  const [startFrame, setStartFrame] = useState<string | null>(null);
  const [endFrame, setEndFrame] = useState<string | null>(null);
  const [transitionPrompt, setTransitionPrompt] = useState('');

  useEffect(() => {
    return () => stopPolling();
  }, [stopPolling]);

  const handleStatusCallback = (
    clientId: string | undefined,
    pendingAssetId: string,
    customPrompt?: string,
    jobIds?: { batchId: string; sceneId: string } | null
  ) =>
    async (result: { status: string; videoUrl?: string }) => {
      if (result.status === 'completed' && result.videoUrl) {
        try {
          const blob = await fetchVideoAsBlob(result.videoUrl);
          const { supabase } = await import('@/integrations/supabase/client');
          const timestamp = Date.now();
          const clientFolder = clientId || 'stock';
          const storagePath = `broll/${clientFolder}/${timestamp}.mp4`;

          const { error: uploadError } = await supabase.storage
            .from('assets')
            .upload(storagePath, blob, { contentType: 'video/mp4', upsert: false });

          if (uploadError) throw uploadError;

          const { data: urlData } = supabase.storage.from('assets').getPublicUrl(storagePath);

          await updateAssetMutation.mutateAsync({
            id: pendingAssetId,
            status: 'completed',
            storage_path: storagePath,
            public_url: urlData.publicUrl,
          });

          toast.success('B-roll generated and saved!');
          if (jobIds) await updateScene(jobIds.batchId, jobIds.sceneId, 'done', { videoUrl: urlData.publicUrl });
          if (!customPrompt) setPrompt('');
        } catch (saveError) {
          console.error('Failed to save video to storage:', saveError);
          await updateAssetMutation.mutateAsync({
            id: pendingAssetId,
            status: 'completed',
            public_url: result.videoUrl,
          });
          toast.success('B-roll generated!', { description: 'Saved with external URL' });
          if (jobIds) await updateScene(jobIds.batchId, jobIds.sceneId, 'done', { videoUrl: result.videoUrl });
        }
      } else if (result.status === 'failed') {
        await updateAssetMutation.mutateAsync({ id: pendingAssetId, status: 'failed' });
        if (jobIds) await updateScene(jobIds.batchId, jobIds.sceneId, 'failed', { error: 'Generation failed' });
        toast.error('B-roll generation failed');
      }
      refetchAssets();
    };

  const handleGenerate = async (customPrompt?: string, customAspect?: AspectRatio, customDuration?: number) => {
    const finalPrompt = customPrompt || prompt;
    const finalAspect = customAspect || aspectRatio;
    const finalDuration = customDuration || duration;

    if (mode === 'text' && !finalPrompt.trim()) {
      toast.error('Please enter a prompt');
      return;
    }

    if (mode === 'keyframe' && (!startFrame || !endFrame)) {
      toast.error('Please upload both a start and end frame');
      return;
    }

    setIsGenerating(true);

    try {
      const clientId = selectedClientId && selectedClientId !== 'none' ? selectedClientId : undefined;

      const metadata: Record<string, unknown> = {
        aspectRatio: finalAspect,
        duration: finalDuration,
        model: VIDEO_MODEL,
        mode,
      };

      if (mode === 'keyframe') {
        metadata.startFrame = startFrame;
        metadata.endFrame = endFrame;
        metadata.transitionPrompt = transitionPrompt;
        metadata.prompt = 'Keyframe transition';
      } else {
        metadata.prompt = finalPrompt.trim();
      }

      const pendingAsset = await createAssetMutation.mutateAsync({
        project_id: undefined,
        client_id: clientId,
        type: 'broll',
        name: mode === 'keyframe'
          ? `B-Roll: Keyframe Transition`
          : `B-Roll: ${finalPrompt.slice(0, 50)}`,
        status: 'generating',
        metadata,
      });

      const finalPromptForJob = mode === 'keyframe' ? 'Keyframe transition' : finalPrompt.trim();
      const jobIds = await createJobRecord({
        kind: mode === 'keyframe' ? 'image-to-video' : 'broll',
        model: 'google/veo-3',
        aspectRatio: finalAspect,
        duration: finalDuration,
        prompt: finalPromptForJob,
        clientId,
      });
      const cb = handleStatusCallback(clientId, pendingAsset.id, customPrompt, jobIds);

      if (mode === 'keyframe') {
        toast.info('Analyzing keyframes & generating transition...', {
          description: `${finalDuration}s ${finalAspect} video`,
        });

        await generateFromKeyframes(
          startFrame!,
          endFrame!,
          transitionPrompt || undefined,
          finalAspect,
          finalDuration,
          cb
        );
      } else {
        toast.info(`Generating with ${VIDEO_MODEL_DISPLAY}...`, {
          description: `${finalDuration}s ${finalAspect} video`,
        });

        await generateVideo(finalPrompt.trim(), finalAspect, finalDuration, cb);
      }
    } catch (error) {
      console.error('Generation error:', error);
      toast.error('Failed to start generation');
    }

    setIsGenerating(false);
  };

  const handleDelete = async (asset: Asset) => {
    await deleteAssetMutation.mutateAsync({
      id: asset.id,
      storage_path: asset.storage_path || undefined,
    });
    toast.success('B-roll deleted');
  };

  const handleAIEdit = async (asset: Asset, editPrompt: string) => {
    const metadata = asset.metadata as Record<string, unknown>;
    const originalAspect = (metadata?.aspectRatio as AspectRatio) || '16:9';
    const originalDuration = (metadata?.duration as number) || 5;
    await handleGenerate(editPrompt, originalAspect, originalDuration);
  };

  const isKeyframeReady = mode === 'keyframe' && startFrame && endFrame;
  const isTextReady = mode === 'text' && prompt.trim();
  const canGenerate = !isGenerating && (isKeyframeReady || isTextReady);

  return (
    <AppLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Film className="h-6 w-6" />
            B-Roll Library
          </h1>
          <p className="text-muted-foreground">
            Generate background video clips with {VIDEO_MODEL}
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="lg:sticky lg:top-6 h-fit">
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Wand2 className="h-5 w-5 text-primary" />
                Generate B-Roll
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              {/* Mode Toggle */}
              <div className="space-y-2">
                <Label>Mode</Label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setMode('text')}
                    className={cn(
                      'flex items-center justify-center gap-2 py-2.5 rounded-lg border text-sm font-medium transition-all',
                      mode === 'text'
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border hover:border-foreground/30'
                    )}
                  >
                    <Type className="h-4 w-4" />
                    Text to Video
                  </button>
                  <button
                    onClick={() => setMode('keyframe')}
                    className={cn(
                      'flex items-center justify-center gap-2 py-2.5 rounded-lg border text-sm font-medium transition-all',
                      mode === 'keyframe'
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border hover:border-foreground/30'
                    )}
                  >
                    <Layers className="h-4 w-4" />
                    Keyframe Transition
                  </button>
                </div>
              </div>

              {/* Mode-specific content */}
              {mode === 'text' ? (
                <div className="space-y-2">
                  <Label>Prompt</Label>
                  <Textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder="Describe the B-roll video you want to create..."
                    rows={3}
                    className="resize-none"
                  />
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {PROMPT_SUGGESTIONS.slice(0, 4).map((suggestion, i) => (
                      <button
                        key={i}
                        onClick={() => setPrompt(suggestion)}
                        className="text-xs px-2 py-1 rounded-full bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground transition-colors"
                      >
                        {suggestion.slice(0, 30)}...
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <Label>Keyframes</Label>
                  <KeyframeUploader
                    startFrame={startFrame}
                    endFrame={endFrame}
                    onStartFrameChange={setStartFrame}
                    onEndFrameChange={setEndFrame}
                    disabled={isGenerating}
                  />

                  {/* Transition Presets */}
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">Transition Style</Label>
                    <div className="grid grid-cols-3 lg:grid-cols-4 gap-1.5">
                      {TRANSITION_PRESETS.map((preset) => (
                        <button
                          key={preset.label}
                          onClick={() => setTransitionPrompt(preset.prompt)}
                          className={cn(
                            'text-xs px-2 py-2 rounded-lg border font-medium transition-all text-center',
                            transitionPrompt === preset.prompt
                              ? 'border-primary bg-primary/10 text-primary ring-2 ring-primary/30'
                              : 'border-border bg-muted/40 text-muted-foreground hover:border-foreground/30 hover:text-foreground'
                          )}
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">Custom Description (Optional)</Label>
                    <Textarea
                      value={transitionPrompt}
                      onChange={(e) => setTransitionPrompt(e.target.value)}
                      placeholder="Or describe your own transition motion..."
                      rows={2}
                      className="resize-none"
                    />
                  </div>
                </div>
              )}

              {/* Aspect Ratio */}
              <div className="space-y-2">
                <Label>Aspect Ratio</Label>
                <div className="grid grid-cols-4 gap-2">
                  {ASPECT_RATIOS.map((ar) => (
                    <button
                      key={ar.value}
                      onClick={() => setAspectRatio(ar.value)}
                      className={cn(
                        'p-3 rounded-lg border text-center transition-all',
                        aspectRatio === ar.value
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-border hover:border-foreground/30'
                      )}
                    >
                      <div className="text-xl mb-1">{ar.icon}</div>
                      <div className="text-xs font-medium">{ar.value}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Duration */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label>Duration</Label>
                  <span className="text-sm font-medium">{duration}s</span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {[4, 6, 8].map((d) => (
                    <button
                      key={d}
                      onClick={() => setDuration(d)}
                      className={cn(
                        'py-2 rounded-lg border text-center transition-all font-medium',
                        duration === d
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-border hover:border-foreground/30'
                      )}
                    >
                      {d}s
                    </button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground text-center">
                  Veo 3 supports 4, 6, or 8 second videos
                </p>
              </div>

              {/* Client Assignment */}
              <div className="space-y-2">
                <Label>Assign to Client (Optional)</Label>
                <Select value={selectedClientId} onValueChange={setSelectedClientId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select client..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No client (Stock)</SelectItem>
                    {clients.map((client) => (
                      <SelectItem key={client.id} value={client.id}>
                        {client.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Generate Button */}
              <Button
                onClick={() => handleGenerate()}
                disabled={!canGenerate}
                className="w-full gap-2"
                size="lg"
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {mode === 'keyframe' ? 'Analyzing & Generating...' : `Generating with ${VIDEO_MODEL_DISPLAY}...`}
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4" />
                    {mode === 'keyframe' ? 'Generate Transition' : 'Generate B-Roll'}
                  </>
                )}
              </Button>

              {/* Model Info */}
              <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/50 text-sm text-muted-foreground">
                <Sparkles className="h-4 w-4 text-primary" />
                <span>
                  {mode === 'keyframe'
                    ? <>Gemini analyzes frames → <strong className="text-foreground">{VIDEO_MODEL}</strong> generates transition</>
                    : <>Powered by <strong className="text-foreground">{VIDEO_MODEL}</strong> for fast, high-quality video generation</>
                  }
                </span>
              </div>
            </CardContent>
          </Card>

          {/* Gallery */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Generated B-Roll</h2>
              <Badge variant="secondary">{brollAssets.length} clips</Badge>
            </div>

            <AssetGrid
              assets={brollAssets}
              isLoading={isLoadingAssets}
              onDelete={handleDelete}
              onAIEdit={handleAIEdit}
              emptyTitle="No B-roll yet"
              emptyDescription="Enter a prompt and generate your first background video clip"
              emptyIcon={<Film className="h-8 w-8 text-muted-foreground" />}
            />
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
