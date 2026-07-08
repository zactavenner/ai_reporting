import { useState, useCallback } from 'react';
import { ScriptUploader } from './ScriptUploader';
import { IngredientSelector } from './IngredientSelector';
import { StoryboardView } from './StoryboardView';
import { FrameworkSelector } from './FrameworkSelector';
import { ExportPanel } from './ExportPanel';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertCircle, Settings2, Sparkles, Video, ChevronRight, Loader2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAvatars } from '@/hooks/useAvatars';
import { useVideoGeneration } from '@/hooks/useVideoGeneration';
import { useSingleJobPersistence } from '@/hooks/useSingleJobPersistence';
import { useGeminiKey } from '@/hooks/useGeminiKey';
import { cn } from '@/lib/utils';
import type { StoryboardScene, IngredientType, VideoGenerationConfig } from '@/types/video';

interface VideoBatchCreatorProps {
  projectId: string;
  clientId: string;
}

type WorkflowPhase = 'framework' | 'script' | 'storyboard' | 'export';

const PHASE_LABELS: Record<WorkflowPhase, string> = {
  framework: '1. Style',
  script: '2. Script',
  storyboard: '3. Studio',
  export: '4. Export',
};

export function VideoBatchCreator({ projectId, clientId }: VideoBatchCreatorProps) {
  const [phase, setPhase] = useState<WorkflowPhase>('framework');
  const [scenes, setScenes] = useState<StoryboardScene[]>([]);
  const [config, setConfig] = useState<VideoGenerationConfig>({
    aspectRatio: '16:9',
    ingredientType: 'broll',
  });
  
  // Framework selection state
  const [selectedFrameworks, setSelectedFrameworks] = useState<string[]>([]);
  const [customScript, setCustomScript] = useState('');
  const [isBreakingDown, setIsBreakingDown] = useState(false);
  
  const { data: avatars = [] } = useAvatars(clientId);
  const { generateScene, generatingSceneId, hasApiKey } = useVideoGeneration();
  const { createJobRecord, updateScene } = useSingleJobPersistence();
  const { getApiKey: getGeminiKey, hasApiKey: hasGeminiKey } = useGeminiKey();

  // Get selected avatar for character consistency
  const selectedAvatar = config.selectedAvatarId 
    ? avatars.find(a => a.id === config.selectedAvatarId) 
    : null;

  // Parse script into scenes using regex (fallback)
  const parseScriptToScenes = useCallback((content: string): StoryboardScene[] => {
    const scenes: StoryboardScene[] = [];
    const sceneMarkerRegex = /Scene\s*\d+[:\s]/gi;
    const hasSceneMarkers = sceneMarkerRegex.test(content);
    
    let rawScenes: string[];
    
    if (hasSceneMarkers) {
      rawScenes = content.split(/Scene\s*\d+[:\s]*/gi).filter(s => s.trim());
    } else {
      rawScenes = content.split(/\n\s*\n/).filter(s => s.trim());
    }
    
    rawScenes.forEach((text, index) => {
      const cleanText = text.trim();
      if (cleanText.length < 10) return;
      
      scenes.push({
        id: `scene-${Date.now()}-${index}`,
        order: index + 1,
        prompt: cleanText,
        duration: 8,
        ingredientType: 'broll',
        status: 'pending',
      });
    });
    
    if (scenes.length === 0) {
      scenes.push({
        id: `scene-${Date.now()}-0`,
        order: 1,
        prompt: content.trim(),
        duration: 8,
        ingredientType: 'broll',
        status: 'pending',
      });
    }
    
    return scenes;
  }, []);

  // AI-powered scene breakdown
  const breakdownScriptWithAI = useCallback(async (script: string) => {
    const geminiKey = getGeminiKey();
    if (!geminiKey) {
      toast.error('No Gemini API key', {
        description: 'Add your API key in Settings to use AI breakdown',
      });
      return null;
    }

    setIsBreakingDown(true);
    try {
      const { data, error } = await supabase.functions.invoke('breakdown-script', {
        body: {
          script,
          characterDescription: selectedAvatar?.description,
          apiKey: geminiKey,
        },
      });

      if (error || data.error) {
        throw new Error(error?.message || data.error);
      }

      // Transform AI scenes to our format
      const aiScenes: StoryboardScene[] = data.scenes.map((scene: any) => ({
        id: scene.id,
        order: scene.order,
        prompt: scene.prompt,
        duration: scene.duration || 8,
        ingredientType: config.ingredientType,
        status: 'pending',
        action: scene.action,
        lipSyncLine: scene.lipSyncLine,
        cameraAngle: scene.cameraAngle,
      }));

      return aiScenes;
    } catch (err: any) {
      console.error('AI breakdown failed:', err);
      toast.error('AI breakdown failed', {
        description: 'Falling back to basic parsing',
      });
      return null;
    } finally {
      setIsBreakingDown(false);
    }
  }, [getGeminiKey, selectedAvatar, config.ingredientType]);

  const handleScriptSubmit = useCallback(async (title: string, content: string) => {
    // Try AI breakdown first, fall back to regex
    let parsedScenes = hasGeminiKey 
      ? await breakdownScriptWithAI(content) 
      : null;
    
    if (!parsedScenes) {
      parsedScenes = parseScriptToScenes(content);
    }
    
    setScenes(parsedScenes);
    setPhase('storyboard');
    toast.success(`Created ${parsedScenes.length} scenes`, {
      description: hasGeminiKey 
        ? 'AI-powered scene breakdown complete' 
        : 'Edit prompts and generate videos for each scene',
    });
  }, [hasGeminiKey, breakdownScriptWithAI, parseScriptToScenes]);

  const handleFrameworkContinue = useCallback(() => {
    if (customScript.trim()) {
      handleScriptSubmit('Custom Script', customScript);
    } else if (selectedFrameworks.length > 0) {
      setPhase('script');
    } else {
      toast.error('Select a framework or enter a custom script');
    }
  }, [customScript, selectedFrameworks, handleScriptSubmit]);

  const handleUpdateScene = useCallback((sceneId: string, updates: Partial<StoryboardScene>) => {
    setScenes(prev => prev.map(scene => 
      scene.id === sceneId ? { ...scene, ...updates } : scene
    ));
  }, []);

  const handleGenerateScene = useCallback(async (scene: StoryboardScene) => {
    // API keys are managed server-side

    handleUpdateScene(scene.id, { status: 'generating' });

    // Persist to video_batch_jobs so job survives a tab reload
    const jobIds = await createJobRecord({
      kind: 'single-scene',
      model: 'google/veo-3',
      aspectRatio: config.aspectRatio,
      duration: scene.duration || 8,
      prompt: scene.prompt,
    });

    await generateScene(
      scene,
      config.aspectRatio,
      async (sceneId, result) => {
        if (result.status === 'completed' && result.videoUrl) {
          handleUpdateScene(sceneId, { status: 'completed', videoUrl: result.videoUrl });
          if (jobIds) await updateScene(jobIds.batchId, jobIds.sceneId, 'done', { videoUrl: result.videoUrl });
        } else if (result.status === 'failed') {
          handleUpdateScene(sceneId, { status: 'failed', videoUrl: undefined });
          if (jobIds) await updateScene(jobIds.batchId, jobIds.sceneId, 'failed', { error: 'Generation failed' });
        } else if (result.operationId) {
          handleUpdateScene(sceneId, { operationId: result.operationId });
        }
      },
      selectedAvatar?.image_url // Pass character image for identity consistency
    );
  }, [generateScene, config.aspectRatio, hasApiKey, handleUpdateScene, selectedAvatar, createJobRecord, updateScene]);

  const completedCount = scenes.filter(s => s.status === 'completed').length;
  const totalDuration = scenes.length * 8;

  // Phase navigation
  const phases: WorkflowPhase[] = ['framework', 'script', 'storyboard', 'export'];
  const currentPhaseIndex = phases.indexOf(phase);

  return (
    <div className="space-y-6">
      {/* Phase Stepper */}
      <div className="flex items-center gap-2 overflow-x-auto pb-2">
        {phases.map((p, index) => {
          const isActive = p === phase;
          const isCompleted = index < currentPhaseIndex;
          const isDisabled = index > currentPhaseIndex && phase !== 'export';

          return (
            <button
              key={p}
              onClick={() => !isDisabled && setPhase(p)}
              disabled={isDisabled}
              className={cn(
                'flex items-center gap-2 px-4 py-2 rounded-xl transition-all whitespace-nowrap',
                isActive && 'bg-primary text-primary-foreground',
                isCompleted && 'bg-primary/20 text-primary',
                !isActive && !isCompleted && 'bg-muted text-muted-foreground',
                isDisabled && 'opacity-50 cursor-not-allowed'
              )}
            >
              <span className={cn(
                'w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold',
                isActive && 'bg-primary-foreground text-primary',
                isCompleted && 'bg-primary text-primary-foreground',
                !isActive && !isCompleted && 'bg-muted-foreground/30'
              )}>
                {index + 1}
              </span>
              <span className="font-medium">{PHASE_LABELS[p].split('. ')[1]}</span>
              {index < phases.length - 1 && (
                <ChevronRight className="h-4 w-4 ml-1 opacity-50" />
              )}
            </button>
          );
        })}
      </div>

      {/* Header Stats */}
      {scenes.length > 0 && (
        <div className="flex items-center gap-4">
          <Badge variant="secondary" className="gap-1">
            <Video className="h-3 w-3" />
            {scenes.length} scenes
          </Badge>
          <Badge variant="outline">
            {totalDuration}s total duration
          </Badge>
          <Badge 
            variant={completedCount === scenes.length ? 'default' : 'outline'}
            className="gap-1"
          >
            <Sparkles className="h-3 w-3" />
            {completedCount}/{scenes.length} generated
          </Badge>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left Panel - Config */}
        <div className="space-y-4">
          {/* Framework Phase */}
          {phase === 'framework' && (
            <>
              <FrameworkSelector
                selectedFrameworks={selectedFrameworks}
                onFrameworksChange={setSelectedFrameworks}
                customScript={customScript}
                onCustomScriptChange={setCustomScript}
                maxSelections={3}
              />
              <Button 
                onClick={handleFrameworkContinue}
                disabled={!customScript.trim() && selectedFrameworks.length === 0}
                className="w-full"
              >
                Continue
                <ChevronRight className="h-4 w-4 ml-2" />
              </Button>
            </>
          )}

          {/* Script Phase */}
          {phase === 'script' && (
            <>
              <ScriptUploader onScriptSubmit={handleScriptSubmit} />
              {isBreakingDown && (
                <Card>
                  <CardContent className="p-4">
                    <div className="flex items-center gap-3">
                      <Loader2 className="h-5 w-5 animate-spin text-primary" />
                      <div>
                        <p className="font-medium">AI Processing...</p>
                        <p className="text-sm text-muted-foreground">
                          Breaking down script into scenes
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}
              <Button
                variant="outline"
                className="w-full"
                onClick={() => setPhase('framework')}
              >
                ← Back to Frameworks
              </Button>
            </>
          )}

          {/* Storyboard Phase */}
          {phase === 'storyboard' && (
            <>
              {/* Aspect Ratio */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Settings2 className="h-5 w-5 text-primary" />
                    Settings
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label>Aspect Ratio</Label>
                    <div className="grid grid-cols-2 gap-2">
                      {(['16:9', '9:16'] as const).map((ratio) => (
                        <button
                          key={ratio}
                          onClick={() => setConfig(c => ({ ...c, aspectRatio: ratio }))}
                          className={cn(
                            'p-3 rounded-lg border text-center transition-all',
                            config.aspectRatio === ratio
                              ? 'border-primary bg-primary/10 text-primary'
                              : 'border-border hover:border-foreground/30'
                          )}
                        >
                          <div className="text-xl mb-1">
                            {ratio === '16:9' ? '▬' : '▮'}
                          </div>
                          <div className="text-xs font-medium">{ratio}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Ingredients */}
              <IngredientSelector
                avatars={avatars}
                selectedType={config.ingredientType}
                selectedAvatarId={config.selectedAvatarId}
                onTypeChange={(type) => setConfig(c => ({ ...c, ingredientType: type }))}
                onAvatarChange={(id) => setConfig(c => ({ ...c, selectedAvatarId: id }))}
              />

              {/* Character Consistency Notice */}
              {selectedAvatar && (
                <Card className="bg-primary/5 border-primary/20">
                  <CardContent className="p-3 flex items-center gap-3">
                    <img 
                      src={selectedAvatar.image_url} 
                      alt={selectedAvatar.name}
                      className="w-10 h-10 rounded-lg object-cover"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{selectedAvatar.name}</p>
                      <p className="text-xs text-muted-foreground">
                        Character consistency enabled
                      </p>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* API keys are managed server-side */}

              {/* Navigation */}
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => setPhase('script')}
                  className="flex-1"
                >
                  ← Script
                </Button>
                <Button
                  onClick={() => setPhase('export')}
                  disabled={completedCount === 0}
                  className="flex-1"
                >
                  Export →
                </Button>
              </div>
            </>
          )}

          {/* Export Phase */}
          {phase === 'export' && (
            <>
              <ExportPanel
                scenes={scenes}
                characterImage={selectedAvatar?.image_url}
                characterName={selectedAvatar?.name}
                config={config}
                projectName={`project-${projectId.slice(0, 8)}`}
              />
              <Button
                variant="outline"
                className="w-full"
                onClick={() => setPhase('storyboard')}
              >
                ← Back to Studio
              </Button>
            </>
          )}
        </div>

        {/* Right Panel - Content */}
        <div className="lg:col-span-2">
          {phase === 'framework' && (
            <Card className="h-full min-h-[400px] flex items-center justify-center">
              <div className="text-center p-8">
                <Video className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="text-lg font-semibold mb-2">VEO3 Production Suite</h3>
                <p className="text-muted-foreground max-w-md">
                  Select marketing frameworks or paste your own script to get started.
                  AI will break it down into 5 cinematic scenes.
                </p>
              </div>
            </Card>
          )}

          {phase === 'script' && selectedFrameworks.length > 0 && (
            <Card className="h-full min-h-[400px]">
              <CardHeader>
                <CardTitle>Script Generation</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <p className="text-muted-foreground">
                    Selected frameworks: {selectedFrameworks.join(', ')}
                  </p>
                  <p className="text-sm">
                    Upload or paste your script to continue. The AI will use your selected
                    frameworks to enhance the scene breakdown.
                  </p>
                </div>
              </CardContent>
            </Card>
          )}

          {(phase === 'storyboard' || phase === 'export') && scenes.length > 0 && (
            <StoryboardView
              scenes={scenes}
              onUpdateScene={handleUpdateScene}
              onGenerateScene={handleGenerateScene}
              generatingSceneId={generatingSceneId}
            />
          )}

          {phase === 'script' && selectedFrameworks.length === 0 && (
            <Card className="h-full min-h-[400px] flex items-center justify-center">
              <div className="text-center p-8">
                <Video className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="text-lg font-semibold mb-2">Upload Your Script</h3>
                <p className="text-muted-foreground max-w-md">
                  Paste or upload your video script. Each scene will be 8 seconds 
                  and can be generated with Veo 3.
                </p>
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
