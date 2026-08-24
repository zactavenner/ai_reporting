import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import {
  ArrowLeft, ArrowRight, Layers, Edit3, Save, X, Sparkles, Loader2,
  Image as ImageIcon, Check, User, Film, Trash2, Copy, ChevronUp, ChevronDown,
  AlertCircle, Plus, Eye,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useSaveAssetFromUrl } from '@/hooks/useAssets';
import type { ScriptSegment, BatchVideoScene, BatchVideoConfig, BackgroundStyle } from '@/types/batch-video';
import { dashboardAuthHeaders } from '@/lib/dashboardAuthHeaders';

const BACKGROUNDS: { id: BackgroundStyle; label: string }[] = [
  { id: 'animated-gradient', label: 'Animated Gradient' },
  { id: 'brand-colors', label: 'Brand Colors' },
  { id: 'office-studio', label: 'Office Studio' },
  { id: 'outdoor', label: 'Outdoor' },
  { id: 'abstract-motion', label: 'Abstract Motion' },
];

interface SceneGenerationStepProps {
  scenes: BatchVideoScene[];
  segments: ScriptSegment[];
  config: Partial<BatchVideoConfig>;
  onUpdateSegment: (segmentId: string, updates: Partial<ScriptSegment>) => void;
  onUpdateScene: (sceneId: string, updates: Partial<BatchVideoScene>) => void;
  onAddScene: () => void;
  onDeleteScene: (sceneId: string) => void;
  onDuplicateScene: (sceneId: string) => void;
  onReorderScene: (sceneId: string, direction: 'up' | 'down') => void;
  onComplete: () => void;
  onBack: () => void;
}

export function SceneGenerationStep({
  scenes, segments, config, onUpdateSegment, onUpdateScene,
  onAddScene, onDeleteScene, onDuplicateScene, onReorderScene, onComplete, onBack,
}: SceneGenerationStepProps) {
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const [generatingAll, setGeneratingAll] = useState(false);
  const saveAsset = useSaveAssetFromUrl();

  // Ensure at least 1 default scene exists
  useEffect(() => {
    if (scenes.length === 0) {
      onAddScene();
    }
  }, [scenes.length, onAddScene]);

  const detectGender = (desc?: string): 'male' | 'female' | 'neutral' => {
    if (!desc) return 'neutral';
    const l = desc.toLowerCase();
    if (l.includes('female') || l.includes('woman')) return 'female';
    if (l.includes('male') || l.includes('man')) return 'male';
    return 'neutral';
  };

  const handleGenerateImage = async (scene: BatchVideoScene) => {
    setGeneratingId(scene.id);
    onUpdateScene(scene.id, { status: 'image_generating' });
    try {
      const useAvatarForScene = scene.useAvatar !== false && !!config.avatarImageUrl;
      const shouldUseAvatar = config.visualType === 'avatar' || (config.visualType === 'mixed' && useAvatarForScene);
      const g = detectGender(config.avatarDescription);
      const genderTerm = g === 'female' ? 'female presenter' : g === 'male' ? 'male presenter' : 'presenter';

      const prompt = scene.segment.imagePrompt.trim() || 'A cinematic establishing shot';
      const enhancedPrompt = shouldUseAvatar
        ? `Photorealistic scene featuring this EXACT ${genderTerm} from the reference image. CRITICAL: Match face, skin tone, hair, outfit exactly. Eye contact with camera. Scene: ${prompt}. ${scene.segment.sceneDescription || ''} Camera: ${scene.segment.cameraAngle || 'medium'} shot. ${config.offerDescription ? `Context: ${config.offerDescription}` : ''}`
        : `Cinematic B-roll (NO people): ${prompt}. ${scene.segment.sceneDescription || ''}. ${config.offerDescription ? `Context: ${config.offerDescription}` : ''}`;

      const { data, error } = await supabase.functions.invoke('generate-static-ad', {
        headers: dashboardAuthHeaders(),
        body: {
          prompt: enhancedPrompt,
          aspectRatio: config.aspectRatio || '16:9',
          projectId: config.projectId || 'batch-video',
          clientId: config.clientId || 'default',
          productDescription: config.offerDescription,
          characterImageUrl: shouldUseAvatar ? config.avatarImageUrl : undefined,
          referenceImages: shouldUseAvatar && config.avatarImageUrl ? [config.avatarImageUrl] : [],
        },
      });
      if (error) throw error;
      onUpdateScene(scene.id, { status: 'image_completed', generatedImageUrl: data.imageUrl, useAvatar: Boolean(shouldUseAvatar) });
      saveAsset.mutate({ url: data.imageUrl, projectId: config.projectId, clientId: config.clientId, type: 'image', name: `Batch - Scene ${scene.order}` });
      toast.success(`Scene ${scene.order} image ready`);
    } catch {
      onUpdateScene(scene.id, { status: 'failed', error: 'Image generation failed' });
      toast.error('Failed to generate image');
    } finally { setGeneratingId(null); }
  };

  const handleGenerateAllImages = async () => {
    const pending = scenes.filter(s => s.status === 'pending' || s.status === 'failed');
    if (!pending.length) return;
    setGeneratingAll(true);
    for (const scene of pending) await handleGenerateImage(scene);
    setGeneratingAll(false);
    toast.success('All images generated');
  };

  const totalDuration = scenes.reduce((sum, s) => sum + s.segment.duration, 0);
  const generatedCount = scenes.filter(s => s.status === 'image_completed').length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center gap-2"><Layers className="h-5 w-5" />Step 3: Scene Storyboard</div>
          <Badge variant="outline">{generatedCount}/{scenes.length} ready</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Top actions */}
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={onAddScene} className="gap-2">
            <Plus className="h-4 w-4" />Add Scene
          </Button>
          <Button variant="outline" size="sm" onClick={handleGenerateAllImages}
            disabled={generatingAll || !!generatingId} className="gap-2 shrink-0">
            {generatingAll ? <><Loader2 className="h-4 w-4 animate-spin" />Generating...</> : <><Sparkles className="h-4 w-4" />Generate All Images</>}
          </Button>
        </div>

        {/* Scene Cards */}
        <ScrollArea className="h-[520px] pr-4">
          <div className="space-y-4">
            {scenes.map((scene, index) => (
              <SceneCard
                key={scene.id}
                scene={scene}
                index={index}
                totalScenes={scenes.length}
                isGenerating={generatingId === scene.id}
                isMixedMode={config.visualType === 'mixed'}
                hasAvatar={!!config.avatarImageUrl}
                onUpdateSegment={(updates) => onUpdateSegment(scene.segment.id, updates)}
                onUpdateScene={(updates) => onUpdateScene(scene.id, updates)}
                onGenerate={() => handleGenerateImage(scene)}
                onDelete={() => onDeleteScene(scene.id)}
                onDuplicate={() => onDuplicateScene(scene.id)}
                onMoveUp={() => onReorderScene(scene.id, 'up')}
                onMoveDown={() => onReorderScene(scene.id, 'down')}
              />
            ))}
          </div>
        </ScrollArea>

        {/* Add Scene button below storyboard */}
        <Button variant="outline" onClick={onAddScene} className="w-full gap-2 border-dashed border-2 h-12 text-muted-foreground hover:text-foreground">
          <Plus className="h-4 w-4" />Add Another Scene
        </Button>

        {/* Timeline bar */}
        <div className="border border-border rounded-lg p-3">
          <div className="flex items-center justify-between mb-2">
            <Label className="text-xs">Timeline</Label>
            <span className="text-xs text-muted-foreground">Total: {totalDuration}s</span>
          </div>
          <div className="flex gap-0.5 h-6">
            {scenes.map((scene, i) => (
              <div key={scene.id}
                className={cn('rounded-sm flex items-center justify-center text-[9px] font-medium transition-colors',
                  scene.status === 'image_completed' ? 'bg-primary text-primary-foreground' : scene.status === 'failed' ? 'bg-destructive text-destructive-foreground' : 'bg-muted text-muted-foreground')}
                style={{ flex: scene.segment.duration }}>
                {i + 1}
              </div>
            ))}
          </div>
        </div>

        {/* Navigation */}
        <div className="flex justify-between pt-2">
          <Button variant="outline" onClick={onBack} className="gap-2"><ArrowLeft className="h-4 w-4" />Back</Button>
          <Button onClick={onComplete} className="gap-2">
            Continue to Generate
            {scenes.length > 0 && <span className="text-xs opacity-70">({scenes.length} scenes)</span>}
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Scene Card (always in edit mode with inline fields) ─────────────────────

interface SceneCardProps {
  scene: BatchVideoScene;
  index: number;
  totalScenes: number;
  isGenerating: boolean;
  isMixedMode: boolean;
  hasAvatar: boolean;
  onUpdateSegment: (updates: Partial<ScriptSegment>) => void;
  onUpdateScene: (updates: Partial<BatchVideoScene>) => void;
  onGenerate: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}

function SceneCard({ scene, index, totalScenes, isGenerating, isMixedMode, hasAvatar,
  onUpdateSegment, onUpdateScene, onGenerate, onDelete, onDuplicate, onMoveUp, onMoveDown }: SceneCardProps) {

  const imageUrl = scene.generatedImageUrl;

  return (
    <div className={cn('border rounded-lg p-4 transition-all space-y-3', isGenerating && 'ring-2 ring-primary')}>
      {/* Header row */}
      <div className="flex items-center gap-2 flex-wrap">
        <Badge variant="outline">Scene {index + 1}</Badge>
        <Badge variant="secondary">{scene.segment.duration}s</Badge>
        {scene.useAvatar ? (
          <Badge variant="outline" className="gap-1 text-xs"><User className="h-3 w-3" />Avatar</Badge>
        ) : (
          <Badge variant="secondary" className="gap-1 text-xs"><Film className="h-3 w-3" />B-Roll</Badge>
        )}
        {scene.status === 'image_completed' && <Badge className="gap-1 text-xs bg-primary"><Check className="h-3 w-3" />Ready</Badge>}
        {scene.status === 'failed' && <Badge variant="destructive" className="gap-1 text-xs"><AlertCircle className="h-3 w-3" />Failed</Badge>}

        <div className="ml-auto flex items-center gap-0.5">
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onMoveUp} disabled={index === 0}><ChevronUp className="h-3 w-3" /></Button>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onMoveDown} disabled={index === totalScenes - 1}><ChevronDown className="h-3 w-3" /></Button>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onDuplicate}><Copy className="h-3 w-3" /></Button>
          <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive hover:text-destructive" onClick={onDelete}><Trash2 className="h-3 w-3" /></Button>
        </div>
      </div>

      <div className="flex gap-4">
        {/* Image preview */}
        <div className="w-36 h-24 bg-muted rounded-lg overflow-hidden flex-shrink-0 relative">
          {imageUrl ? (
            <img src={imageUrl} alt={`Scene ${index + 1}`} className="w-full h-full object-cover" />
          ) : isGenerating ? (
            <div className="w-full h-full flex items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
          ) : (
            <div className="w-full h-full flex items-center justify-center"><ImageIcon className="h-8 w-8 text-muted-foreground" /></div>
          )}
        </div>

        {/* Inline editable fields */}
        <div className="flex-1 space-y-2 min-w-0">
          <div>
            <Label className="text-xs text-muted-foreground">Visual Description</Label>
            <Textarea
              value={scene.segment.imagePrompt}
              onChange={e => onUpdateSegment({ imagePrompt: e.target.value })}
              placeholder="Describe what should be shown visually in this scene..."
              rows={2} className="text-sm mt-1"
            />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Voiceover Script</Label>
            <Textarea
              value={scene.segment.text}
              onChange={e => onUpdateSegment({ text: e.target.value })}
              placeholder="What the voiceover says during this scene..."
              rows={2} className="text-sm mt-1"
            />
          </div>
        </div>
      </div>

      {/* Bottom controls row */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* Avatar / B-Roll toggle */}
        <div className="flex items-center gap-2">
          <Film className="h-3.5 w-3.5 text-muted-foreground" />
          <Switch
            checked={scene.useAvatar || false}
            onCheckedChange={(checked) => onUpdateScene({ useAvatar: checked })}
            disabled={!hasAvatar}
          />
          <User className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">{scene.useAvatar ? 'Avatar' : 'B-Roll'}</span>
        </div>

        {/* Background dropdown */}
        <Select
          value={scene.segment.backgroundStyle || 'animated-gradient'}
          onValueChange={(v) => onUpdateSegment({ backgroundStyle: v as BackgroundStyle })}
        >
          <SelectTrigger className="h-8 text-xs w-[160px]"><SelectValue /></SelectTrigger>
          <SelectContent>{BACKGROUNDS.map(b => <SelectItem key={b.id} value={b.id}>{b.label}</SelectItem>)}</SelectContent>
        </Select>

        {/* Duration */}
        <div className="flex items-center gap-1">
          <Label className="text-xs text-muted-foreground">Duration</Label>
          <Input
            type="number" min={3} max={30}
            value={scene.segment.duration}
            onChange={e => onUpdateSegment({ duration: Number(e.target.value) })}
            className="h-8 w-16 text-xs"
          />
          <span className="text-xs text-muted-foreground">s</span>
        </div>

        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="outline" onClick={onGenerate} disabled={isGenerating} className="gap-1 h-7">
            {isGenerating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
            {scene.status === 'image_completed' ? 'Regenerate' : scene.status === 'failed' ? 'Retry' : 'Generate'}
          </Button>
          <Button size="sm" variant="ghost" className="gap-1 h-7" disabled><Eye className="h-3 w-3" />Preview</Button>
        </div>
      </div>
    </div>
  );
}
