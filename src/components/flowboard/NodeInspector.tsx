import { useRef, useState, useEffect, forwardRef } from 'react';
import { Play, Loader2, Image, Video, MessageSquare, Film, User, Layers, Combine, Upload, Zap, ChevronDown, ChevronRight, Download, Camera, Mic } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Slider } from '@/components/ui/slider';
import { Checkbox } from '@/components/ui/checkbox';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Badge } from '@/components/ui/badge';
import { useAvatars, useStockAvatars } from '@/hooks/useAvatars';
import { useAvatarLooks } from '@/hooks/useAvatarLooks';
import { useVoices } from '@/hooks/useVoices';
import type { Avatar } from '@/types';
import type { 
  FlowNode, 
  FlowNodeType,
  ImageAspectRatio, 
  VideoAspectRatio, 
  VideoDuration, 
  OutputFormat,
  PromptModel,
  VideoModel,
  CameraMotion,
  TransitionType,
  CombineMode,
  BackgroundOption,
  ImageGeneratorData,
  VideoGeneratorData,
  PromptGeneratorData,
  ImageToVideoData,
  AvatarSceneData,
  SceneCombinerData,
  ImageCombinerData,
  HooksNodeData,
} from '@/types/flowboard';
import { ANGLE_PRESETS } from '@/hooks/useAvatarGeneration';
import { cn } from '@/lib/utils';
import { isGoogleApiUrl, fetchVideoViaProxy } from '@/lib/video-proxy';

interface NodeInspectorProps {
  selectedNode: FlowNode | null;
  onUpdateNode: (nodeId: string, data: Partial<FlowNode['data']>) => void;
  onGenerateNode: (nodeId: string) => void;
  clientId?: string;
  onOpenAvatarDialog?: (avatarId: string) => void;
}

const NODE_ICONS: Record<string, { icon: typeof Image; label: string }> = {
  'image-generator': { icon: Image, label: 'Image Generator' },
  'video-generator': { icon: Video, label: 'Video Generator' },
  'prompt-generator': { icon: MessageSquare, label: 'Prompt Generator' },
  'image-to-video': { icon: Film, label: 'Image to Video' },
  'avatar-scene': { icon: User, label: 'Avatar Scene' },
  'scene-combiner': { icon: Combine, label: 'Scene Combiner' },
  'image-combiner': { icon: Layers, label: 'Image Combiner' },
  'hooks': { icon: Zap, label: 'Hooks A/B' },
};

const MODELS: { value: PromptModel; label: string }[] = [
  { value: 'nvidia/nemotron-3-ultra:free', label: 'Nemotron 3 Ultra' },
  { value: 'gpt-5-mini', label: 'GPT 5 Mini' },
  { value: 'gpt-5', label: 'GPT 5' },
  { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
];

const VIDEO_MODELS: { value: VideoModel; label: string }[] = [
  { value: 'veo3', label: 'VEO 3' },
  { value: 'grok', label: 'Grok' },
];

const CAMERA_MOTIONS: { value: CameraMotion; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'pan-left', label: 'Pan Left' },
  { value: 'pan-right', label: 'Pan Right' },
  { value: 'zoom-in', label: 'Zoom In' },
  { value: 'zoom-out', label: 'Zoom Out' },
  { value: 'orbit', label: 'Orbit' },
];

const TRANSITION_TYPES: { value: TransitionType; label: string; icon: string }[] = [
  { value: 'cut', label: 'Hard Cut', icon: '✂️' },
  { value: 'crossfade', label: 'Crossfade', icon: '🌓' },
  { value: 'wipe-left', label: 'Wipe Left', icon: '⬅️' },
  { value: 'wipe-right', label: 'Wipe Right', icon: '➡️' },
  { value: 'zoom-in', label: 'Zoom In', icon: '🔍' },
  { value: 'zoom-out', label: 'Zoom Out', icon: '🔎' },
];

const COMBINE_MODES: { value: CombineMode; label: string; desc: string }[] = [
  { value: 'blend', label: 'Blend', desc: 'Natural composition of both images' },
  { value: 'replace-background', label: 'Replace BG', desc: 'Keep subject, new background' },
  { value: 'side-by-side', label: 'Side by Side', desc: 'Place images next to each other' },
  { value: 'overlay', label: 'Overlay', desc: 'Layer one image over the other' },
];

const BG_OPTIONS: { value: BackgroundOption; label: string }[] = [
  { value: 'keep', label: 'Keep Original' },
  { value: 'remove', label: 'Remove Background' },
  { value: 'custom', label: 'Custom Background' },
];

/** Small helper component that proxies Google API video URLs for inline playback + download */
const I2VVideoPreview = forwardRef<HTMLDivElement, { videoUrl?: string; aspectRatio?: string }>(function I2VVideoPreview({ videoUrl, aspectRatio }, ref) {
  const [playableUrl, setPlayableUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!videoUrl) { setPlayableUrl(null); return; }
    if (isGoogleApiUrl(videoUrl)) {
      setLoading(true);
      fetchVideoViaProxy(videoUrl)
        .then(setPlayableUrl)
        .catch(() => setPlayableUrl(null))
        .finally(() => setLoading(false));
    } else {
      setPlayableUrl(videoUrl);
    }
  }, [videoUrl]);

  if (!videoUrl) return null;

  const isVertical = aspectRatio === '9:16';

  if (loading) {
    return (
      <div className="flex items-center justify-center p-4 rounded-lg bg-muted/50">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground mr-2" />
        <span className="text-xs text-muted-foreground">Loading preview...</span>
      </div>
    );
  }

  if (!playableUrl) return null;

  return (
    <div className="space-y-2">
      <Label className="text-xs">Generated Video</Label>
      <div className={cn(
        "relative rounded-lg overflow-hidden bg-black",
        isVertical ? "aspect-[9/16]" : "aspect-video"
      )}>
        <video src={playableUrl} controls className="w-full h-full object-contain" />
      </div>
      <Button variant="outline" size="sm" className="w-full text-xs" asChild>
        <a href={playableUrl} download target="_blank" rel="noopener noreferrer">
          <Download className="h-3 w-3 mr-1" />
          Download Video
        </a>
      </Button>
    </div>
  );
});

export function NodeInspector({ selectedNode, onUpdateNode, onGenerateNode, clientId, onOpenAvatarDialog }: NodeInspectorProps) {
  const { data: clientAvatars = [] } = useAvatars(clientId);
  const { data: stockAvatars = [] } = useStockAvatars();
  const { data: voices = [] } = useVoices(clientId);
  const primaryFileRef = useRef<HTMLInputElement>(null);
  const secondaryFileRef = useRef<HTMLInputElement>(null);
  
  // Get selected avatar ID for looks query (avatar-scene, image-combiner, or image-to-video)
  const avatarSceneData = selectedNode?.type === 'avatar-scene' ? selectedNode.data as AvatarSceneData : null;
  const combinerData = selectedNode?.type === 'image-combiner' ? selectedNode.data as ImageCombinerData : null;
  const i2vAvatarId = selectedNode?.type === 'image-to-video' ? (selectedNode.data as any).avatarId : null;
  const activeAvatarId = avatarSceneData?.avatarId || combinerData?.primaryAvatarId || i2vAvatarId || null;
  const { data: avatarLooks = [] } = useAvatarLooks(activeAvatarId);
  
  const allAvatars: Avatar[] = [
    ...stockAvatars,
    ...clientAvatars.filter(a => !a.is_stock),
  ];

  if (!selectedNode) {
    return (
      <div className="w-80 border-l border-border bg-card flex items-center justify-center p-6">
        <p className="text-sm text-muted-foreground text-center">
          Select a node to view and edit its properties
        </p>
      </div>
    );
  }

  const nodeType = selectedNode.type as FlowNodeType;
  const nodeConfig = NODE_ICONS[nodeType];
  const Icon = nodeConfig?.icon || Image;
  const isGenerating = selectedNode.data.status === 'generating';

  const renderImageGeneratorFields = () => {
    const data = selectedNode.data as ImageGeneratorData;
    return (
      <>
        <div className="space-y-2">
          <Label className="text-xs">Prompt *</Label>
          <Textarea
            value={data.prompt}
            onChange={(e) => onUpdateNode(selectedNode.id, { prompt: e.target.value })}
            placeholder="Describe the image to generate..."
            className="min-h-[100px] text-sm"
          />
        </div>
        <div className="space-y-2">
          <Label className="text-xs">Aspect Ratio</Label>
          <Select 
            value={data.aspectRatio} 
            onValueChange={(v) => onUpdateNode(selectedNode.id, { aspectRatio: v as ImageAspectRatio })}
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {(['1:1', '4:5', '9:16', '16:9'] as ImageAspectRatio[]).map((ratio) => (
                <SelectItem key={ratio} value={ratio}>{ratio}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label className="text-xs">Output Format</Label>
          <Select 
            value={data.outputFormat} 
            onValueChange={(v) => onUpdateNode(selectedNode.id, { outputFormat: v as OutputFormat })}
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {(['png', 'jpg'] as OutputFormat[]).map((format) => (
                <SelectItem key={format} value={format}>{format.toUpperCase()}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label className="text-xs">Variations: {data.variationCount || 1}</Label>
          <Slider
            value={[data.variationCount || 1]}
            onValueChange={([v]) => onUpdateNode(selectedNode.id, { variationCount: v })}
            min={1}
            max={10}
            step={1}
            className="w-full"
          />
          <p className="text-[10px] text-muted-foreground">Generate 1–10 variations from the same prompt</p>
        </div>
        {data.referenceImageUrl && (
          <div className="space-y-2">
            <Label className="text-xs">Reference Avatar</Label>
            <div className="relative w-16 h-16 rounded-lg overflow-hidden bg-muted border border-border">
              <img src={data.referenceImageUrl} alt="Reference avatar" className="w-full h-full object-cover" />
            </div>
            <p className="text-[10px] text-muted-foreground">Identity reference for consistency</p>
          </div>
        )}
        {data.generatedVariations && data.generatedVariations.length > 1 ? (
          <div className="space-y-2">
            <Label className="text-xs">Generated Variations ({data.generatedVariations.length})</Label>
            <div className="grid grid-cols-2 gap-2">
              {data.generatedVariations.map((url, i) => (
                <div key={i} className="relative aspect-square rounded-lg overflow-hidden bg-muted cursor-pointer hover:ring-2 hover:ring-primary transition-all"
                  onClick={() => onUpdateNode(selectedNode.id, { generatedImageUrl: url })}
                >
                  <img src={url} alt={`Variation ${i + 1}`} className="w-full h-full object-cover" />
                  {data.generatedImageUrl === url && (
                    <div className="absolute inset-0 ring-2 ring-primary rounded-lg" />
                  )}
                  <span className="absolute bottom-1 left-1 text-[9px] bg-black/60 text-white px-1 rounded">{i + 1}</span>
                </div>
              ))}
            </div>
          </div>
        ) : data.generatedImageUrl ? (
          <div className="space-y-2">
            <Label className="text-xs">Generated Image</Label>
            <div className="relative aspect-square rounded-lg overflow-hidden bg-muted">
              <img src={data.generatedImageUrl} alt="Generated" className="w-full h-full object-cover" />
            </div>
          </div>
        ) : null}
      </>
    );
  };

  const renderVideoGeneratorFields = () => {
    const data = selectedNode.data as VideoGeneratorData;
    return (
      <>
        <div className="space-y-2">
          <Label className="text-xs">Prompt *</Label>
          <Textarea
            value={data.prompt}
            onChange={(e) => onUpdateNode(selectedNode.id, { prompt: e.target.value })}
            placeholder="Describe the video to generate..."
            className="min-h-[100px] text-sm"
          />
        </div>
        <div className="space-y-2">
          <Label className="text-xs">Aspect Ratio</Label>
          <Select 
            value={data.aspectRatio} 
            onValueChange={(v) => onUpdateNode(selectedNode.id, { aspectRatio: v as VideoAspectRatio })}
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {(['16:9', '9:16'] as VideoAspectRatio[]).map((ratio) => (
                <SelectItem key={ratio} value={ratio}>{ratio}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label className="text-xs">Duration</Label>
          <Select 
            value={String(data.duration)} 
            onValueChange={(v) => onUpdateNode(selectedNode.id, { duration: Number(v) as VideoDuration })}
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {([4, 6, 8] as VideoDuration[]).map((dur) => (
                <SelectItem key={dur} value={String(dur)}>{dur} seconds</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {data.generatedVideoUrl && (
          <div className="space-y-2">
            <Label className="text-xs">Generated Video</Label>
            <div className="relative aspect-video rounded-lg overflow-hidden bg-muted">
              <video src={data.generatedVideoUrl} controls className="w-full h-full object-cover" />
            </div>
          </div>
        )}
      </>
    );
  };

  const renderPromptGeneratorFields = () => {
    const data = selectedNode.data as PromptGeneratorData;
    return (
      <>
        <div className="space-y-2">
          <Label className="text-xs">Model</Label>
          <Select 
            value={data.model} 
            onValueChange={(v) => onUpdateNode(selectedNode.id, { model: v as PromptModel })}
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {MODELS.map((model) => (
                <SelectItem key={model.value} value={model.value}>{model.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label className="text-xs">Context (System Instructions)</Label>
          <Textarea
            value={data.context}
            onChange={(e) => onUpdateNode(selectedNode.id, { context: e.target.value })}
            placeholder="System instructions..."
            className="min-h-[80px] text-sm"
          />
        </div>
        <div className="space-y-2">
          <Label className="text-xs">Prompt *</Label>
          <Textarea
            value={data.inputPrompt}
            onChange={(e) => onUpdateNode(selectedNode.id, { inputPrompt: e.target.value })}
            placeholder="User input..."
            className="min-h-[80px] text-sm"
          />
        </div>
        {data.outputPrompt && (
          <div className="space-y-2">
            <Label className="text-xs">Generated Output</Label>
            <div className="bg-muted rounded-lg p-3 text-sm max-h-40 overflow-y-auto">
              {data.outputPrompt}
            </div>
          </div>
        )}
      </>
    );
  };

  const renderImageToVideoFields = () => {
    const data = selectedNode.data as ImageToVideoData;
    const extData = data as any;

    const handleI2VAvatarSelect = (avatarId: string) => {
      const avatar = allAvatars.find(a => a.id === avatarId);
      if (avatar) {
        onUpdateNode(selectedNode.id, {
          inputImageUrl: avatar.image_url,
          avatarId: avatar.id,
          avatarName: avatar.name,
          avatarImageUrl: avatar.image_url,
        } as any);
      }
    };

    const displayImage = data.inputImageUrl || extData.avatarImageUrl;

    return (
      <>
        {/* Avatar / Look Selection */}
        <div className="space-y-2">
          <Label className="text-xs">Select Avatar (optional)</Label>
          <Select
            value={extData.avatarId || ''}
            onValueChange={handleI2VAvatarSelect}
          >
            <SelectTrigger>
              <SelectValue placeholder="Choose an avatar..." />
            </SelectTrigger>
            <SelectContent className="max-h-[300px]">
              {allAvatars.map((avatar) => (
                <SelectItem key={avatar.id} value={avatar.id}>
                  <div className="flex items-center gap-2">
                    <img src={avatar.image_url} alt={avatar.name} className="w-6 h-6 rounded-full object-cover" />
                    <span className="truncate">{avatar.name}</span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Avatar Looks */}
        {extData.avatarId && avatarLooks.length > 0 && (
          <div className="space-y-2">
            <Label className="text-xs">Select Look</Label>
            <div className="grid grid-cols-3 gap-1.5">
              {avatarLooks.map((look) => (
                <button
                  key={look.id}
                  onClick={() => onUpdateNode(selectedNode.id, {
                    inputImageUrl: look.image_url,
                    avatarImageUrl: look.image_url,
                    selectedLookId: look.id,
                  } as any)}
                  className={cn(
                    'relative aspect-[3/4] rounded-md overflow-hidden border-2 transition-all',
                    extData.selectedLookId === look.id
                      ? 'border-primary ring-1 ring-primary'
                      : 'border-transparent hover:border-muted-foreground/30'
                  )}
                >
                  <img src={look.image_url} alt={look.angle || 'Look'} className="w-full h-full object-cover" />
                  {look.is_primary && (
                    <span className="absolute top-0.5 right-0.5 text-[8px] bg-primary text-primary-foreground px-1 rounded">★</span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Edit Avatar Button */}
        {extData.avatarId && onOpenAvatarDialog && (
          <Button
            variant="outline"
            size="sm"
            className="w-full text-xs gap-1.5"
            onClick={() => onOpenAvatarDialog(extData.avatarId)}
          >
            <Camera className="h-3 w-3" />
            Edit Avatar / Generate Looks
          </Button>
        )}

        {/* Input Image Preview */}
        {displayImage && (
          <div className="space-y-2">
            <Label className="text-xs">Input Image</Label>
            <div className="relative aspect-video rounded-lg overflow-hidden bg-muted">
              <img src={displayImage} alt="Input" className="w-full h-full object-cover" />
            </div>
          </div>
        )}
        <div className="space-y-2">
          <Label className="text-xs">Motion Prompt</Label>
          <Textarea
            value={data.prompt}
            onChange={(e) => onUpdateNode(selectedNode.id, { prompt: e.target.value })}
            placeholder="Describe the motion..."
            className="min-h-[80px] text-sm"
          />
        </div>
        <div className="space-y-2">
          <Label className="text-xs">Aspect Ratio</Label>
          <Select
            value={data.aspectRatio || '16:9'}
            onValueChange={(v) => onUpdateNode(selectedNode.id, { aspectRatio: v as VideoAspectRatio })}
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {(['16:9', '9:16'] as VideoAspectRatio[]).map((ratio) => (
                <SelectItem key={ratio} value={ratio}>{ratio}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label className="text-xs">Duration</Label>
          <Select 
            value={String(data.duration)} 
            onValueChange={(v) => onUpdateNode(selectedNode.id, { duration: Number(v) as VideoDuration })}
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {([4, 6, 8] as VideoDuration[]).map((dur) => (
                <SelectItem key={dur} value={String(dur)}>{dur} seconds</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label className="text-xs">Camera Motion</Label>
          <Select 
            value={data.cameraMotion} 
            onValueChange={(v) => onUpdateNode(selectedNode.id, { cameraMotion: v as CameraMotion })}
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {CAMERA_MOTIONS.map((motion) => (
                <SelectItem key={motion.value} value={motion.value}>{motion.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label className="text-xs">Video Model</Label>
          <Select 
            value={(data as any).videoModel || 'veo3'} 
            onValueChange={(v) => onUpdateNode(selectedNode.id, { videoModel: v as VideoModel })}
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {VIDEO_MODELS.map((model) => (
                <SelectItem key={model.value} value={model.value}>{model.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <I2VVideoPreview videoUrl={data.generatedVideoUrl} aspectRatio={data.aspectRatio} />
      </>
    );
  };

  const renderAvatarSceneFields = () => {
    const data = selectedNode.data as AvatarSceneData;
    
    const handleAvatarSelect = (avatarId: string) => {
      const avatar = allAvatars.find(a => a.id === avatarId);
      if (avatar) {
        onUpdateNode(selectedNode.id, { 
          avatarId: avatar.id,
          avatarImageUrl: avatar.image_url,
          avatarName: avatar.name,
          selectedLookId: undefined,
        });
      }
    };

    const handleLookSelect = (lookId: string, imageUrl: string) => {
      onUpdateNode(selectedNode.id, {
        selectedLookId: lookId,
        avatarImageUrl: imageUrl,
      });
    };

    return (
      <>
        {/* Avatar Selection */}
        <div className="space-y-2">
          <Label className="text-xs">Select Avatar</Label>
          <Select 
            value={data.avatarId || ''} 
            onValueChange={handleAvatarSelect}
          >
            <SelectTrigger>
              <SelectValue placeholder="Choose an avatar..." />
            </SelectTrigger>
            <SelectContent className="max-h-[300px]">
              {stockAvatars.length > 0 && (
                <div className="px-2 py-1 text-xs font-medium text-muted-foreground">Stock Avatars</div>
              )}
              {stockAvatars.map((avatar) => (
                <SelectItem key={avatar.id} value={avatar.id}>
                  <div className="flex items-center gap-2">
                    <img src={avatar.image_url} alt={avatar.name} className="w-6 h-6 rounded-full object-cover" />
                    <span className="truncate">{avatar.name}</span>
                    <Badge variant="secondary" className="text-[9px] ml-auto">Stock</Badge>
                  </div>
                </SelectItem>
              ))}
              {clientAvatars.filter(a => !a.is_stock).length > 0 && (
                <>
                  <div className="px-2 py-1 text-xs font-medium text-muted-foreground mt-2">Client Avatars</div>
                  {clientAvatars.filter(a => !a.is_stock).map((avatar) => (
                    <SelectItem key={avatar.id} value={avatar.id}>
                      <div className="flex items-center gap-2">
                        <img src={avatar.image_url} alt={avatar.name} className="w-6 h-6 rounded-full object-cover" />
                        <span className="truncate">{avatar.name}</span>
                      </div>
                    </SelectItem>
                  ))}
                </>
              )}
              {allAvatars.length === 0 && (
                <div className="px-2 py-3 text-xs text-muted-foreground text-center">No avatars available.</div>
              )}
            </SelectContent>
          </Select>
        </div>

        {/* Look Selection (persistent looks from DB) */}
        {data.avatarId && avatarLooks.length > 0 && (
          <div className="space-y-2">
            <Label className="text-xs">Select Look ({avatarLooks.length} saved)</Label>
            <div className="grid grid-cols-3 gap-1.5">
              {avatarLooks.map((look) => (
                <button
                  key={look.id}
                  onClick={() => handleLookSelect(look.id, look.image_url)}
                  className={cn(
                    'relative aspect-[3/4] rounded-md overflow-hidden border-2 transition-all',
                    data.selectedLookId === look.id 
                      ? 'border-primary ring-1 ring-primary' 
                      : 'border-transparent hover:border-muted-foreground/30'
                  )}
                >
                  <img src={look.image_url} alt={look.angle || 'Look'} className="w-full h-full object-cover" />
                  {look.angle && (
                    <span className="absolute bottom-0 left-0 right-0 text-[8px] bg-black/60 text-white text-center py-0.5">
                      {look.angle}
                    </span>
                  )}
                  {look.is_primary && (
                    <span className="absolute top-0.5 right-0.5 text-[8px] bg-primary text-primary-foreground px-1 rounded">★</span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Manual URL Input */}
        <div className="space-y-2">
          <Label className="text-xs">Or paste Image URL</Label>
          <Input
            value={data.avatarImageUrl || ''}
            onChange={(e) => onUpdateNode(selectedNode.id, { 
              avatarImageUrl: e.target.value,
              avatarId: undefined,
              selectedLookId: undefined,
            })}
            placeholder="https://..."
            className="text-sm"
          />
        </div>

        {/* Avatar Preview */}
        {data.avatarImageUrl && (
          <div className="space-y-2">
            <Label className="text-xs">Avatar Preview</Label>
            <div className="relative aspect-[3/4] rounded-lg overflow-hidden bg-muted">
              <img src={data.avatarImageUrl} alt="Avatar" className="w-full h-full object-cover" />
            </div>
            {data.avatarName && (
              <p className="text-xs text-muted-foreground text-center">{data.avatarName}</p>
            )}
          </div>
        )}

        {/* Scene Angles */}
        <div className="space-y-2">
          <Label className="text-xs">Scene Angles (4 perspectives)</Label>
          <div className="space-y-2">
            {data.scenes?.map((scene, index) => {
              const angleConfig = ANGLE_PRESETS.find(a => a.type === scene.angle);
              return (
                <div 
                  key={scene.id}
                  className={cn(
                    'p-2 rounded-lg border text-xs',
                    scene.status === 'completed' && 'border-green-500/50 bg-green-500/10',
                    scene.status === 'generating' && 'border-primary/50 bg-primary/10 animate-pulse',
                    scene.status === 'failed' && 'border-destructive/50 bg-destructive/10',
                    scene.status === 'idle' && 'border-border'
                  )}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-medium flex items-center gap-1">
                      {angleConfig?.icon} {angleConfig?.label}
                    </span>
                    <Badge variant="outline" className="text-[10px]">
                      {scene.duration}s
                    </Badge>
                  </div>
                  <Input
                    value={scene.action}
                    onChange={(e) => {
                      const newScenes = [...(data.scenes || [])];
                      newScenes[index] = { ...scene, action: e.target.value };
                      onUpdateNode(selectedNode.id, { scenes: newScenes });
                    }}
                    placeholder="Action description..."
                    className="h-7 text-xs"
                  />
                </div>
              );
            })}
          </div>
        </div>
      </>
    );
  };

  const renderSceneCombinerFields = () => {
    const data = selectedNode.data as SceneCombinerData;
    return (
      <>
        <div className="space-y-2">
          <Label className="text-xs">Transition Type</Label>
          <Select 
            value={data.transitionType} 
            onValueChange={(v) => onUpdateNode(selectedNode.id, { transitionType: v as TransitionType })}
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {TRANSITION_TYPES.map((t) => (
                <SelectItem key={t.value} value={t.value}>
                  <span className="flex items-center gap-2">
                    <span>{t.icon}</span>
                    <span>{t.label}</span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label className="text-xs">Input Videos</Label>
          <div className="p-3 rounded-lg bg-muted/50 text-center">
            <Badge variant="secondary" className="text-xs">
              {data.inputVideos?.length || 0} clips connected
            </Badge>
            <p className="text-xs text-muted-foreground mt-2">Connect video nodes to the top handles</p>
          </div>
        </div>

        {/* Caption Style (shown after combining) */}
        {data.status === 'completed' && data.outputVideoUrl && (
          <div className="space-y-2">
            <Label className="text-xs">Caption Style</Label>
            <Select
              value={(data as any).captionStyle || 'none'}
              onValueChange={(v) => onUpdateNode(selectedNode.id, { captionStyle: v })}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No Captions</SelectItem>
                <SelectItem value="viral">Viral Captions (Bold, Animated)</SelectItem>
                <SelectItem value="basic">Basic Captions (Clean Subtitles)</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[10px] text-muted-foreground">
              Choose a caption style before downloading
            </p>
          </div>
        )}

        {/* Voice Dubbing (shown after combining) */}
        {data.status === 'completed' && data.outputVideoUrl && (
          <div className="space-y-2 border-t border-border pt-3">
            <div className="flex items-center gap-1.5">
              <Mic className="h-3.5 w-3.5 text-muted-foreground" />
              <Label className="text-xs font-medium">Voice Dubbing (ElevenLabs)</Label>
            </div>
            <p className="text-[10px] text-muted-foreground">
              Select a voice to dub the combined video with matched lip-sync
            </p>
            <Select
              value={data.selectedVoiceId || ''}
              onValueChange={(v) => {
                const voice = voices.find(vo => vo.elevenlabs_voice_id === v);
                onUpdateNode(selectedNode.id, {
                  selectedVoiceId: v,
                  selectedVoiceName: voice?.name || 'Unknown',
                });
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Choose a voice..." />
              </SelectTrigger>
              <SelectContent className="max-h-[250px]">
                {voices.map((voice) => (
                  <SelectItem key={voice.id} value={voice.elevenlabs_voice_id}>
                    <div className="flex items-center gap-2">
                      <Mic className="h-3 w-3" />
                      <span>{voice.name}</span>
                      {voice.gender && <Badge variant="secondary" className="text-[9px]">{voice.gender}</Badge>}
                    </div>
                  </SelectItem>
                ))}
                {voices.length === 0 && (
                  <div className="p-3 text-xs text-muted-foreground text-center">
                    No voices available. Import voices from Avatars → Voice tab.
                  </div>
                )}
              </SelectContent>
            </Select>

            {data.selectedVoiceId && (
              <Button
                size="sm"
                className="w-full gap-2 text-xs"
                disabled={data.dubbingStatus === 'processing'}
                onClick={() => onGenerateNode(selectedNode.id)}
              >
                {data.dubbingStatus === 'processing' ? (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Dubbing in progress...
                  </>
                ) : data.dubbedVideoUrl ? (
                  <>
                    <Mic className="h-3 w-3" />
                    Re-Dub with Voice
                  </>
                ) : (
                  <>
                    <Mic className="h-3 w-3" />
                    Generate Dubbed Video
                  </>
                )}
              </Button>
            )}

            {/* Dubbed Video Preview */}
            {data.dubbedVideoUrl && (
              <div className="space-y-2">
                <Label className="text-xs text-green-600">✓ Dubbed Video Ready</Label>
                <I2VVideoPreview videoUrl={data.dubbedVideoUrl} />
                <Button variant="outline" size="sm" className="w-full text-xs" asChild>
                  <a href={data.dubbedVideoUrl} download="dubbed-video.mp4" target="_blank" rel="noopener noreferrer">
                    <Download className="h-3 w-3 mr-1" />
                    Download Dubbed Video
                  </a>
                </Button>
              </div>
            )}

            {data.dubbingError && (
              <p className="text-xs text-destructive">{data.dubbingError}</p>
            )}
          </div>
        )}

        {data.outputVideoUrl && (
          <I2VVideoPreview videoUrl={data.outputVideoUrl} />
        )}
      </>
    );
  };

  const renderImageCombinerFields = () => {
    const data = selectedNode.data as ImageCombinerData;

    const handleFileUpload = (field: 'primaryImageUrl' | 'secondaryImageUrl') => (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        // For now use data URL; in production this would upload to storage
        onUpdateNode(selectedNode.id, { [field]: reader.result as string });
      };
      reader.readAsDataURL(file);
      e.target.value = '';
    };

    const handleAvatarSelect = (avatarId: string) => {
      const avatar = allAvatars.find(a => a.id === avatarId);
      if (avatar) {
        onUpdateNode(selectedNode.id, {
          primaryImageUrl: avatar.image_url,
          primaryAvatarId: avatar.id,
          primaryAvatarName: avatar.name,
          primarySelectedLookId: undefined,
        });
      }
    };

    const handleLookSelect = (lookId: string, imageUrl: string) => {
      onUpdateNode(selectedNode.id, {
        primarySelectedLookId: lookId,
        primaryImageUrl: imageUrl,
      });
    };

    return (
      <>
        {/* Primary Image - Avatar/Person */}
        <div className="space-y-2">
          <Label className="text-xs">Primary Image (Avatar/Person)</Label>
          
          {/* Avatar Dropdown */}
          <Select
            value={data.primaryAvatarId || ''}
            onValueChange={handleAvatarSelect}
          >
            <SelectTrigger>
              <SelectValue placeholder="Choose an avatar..." />
            </SelectTrigger>
            <SelectContent className="max-h-[300px]">
              {stockAvatars.length > 0 && (
                <div className="px-2 py-1 text-xs font-medium text-muted-foreground">Stock Avatars</div>
              )}
              {stockAvatars.map((avatar) => (
                <SelectItem key={avatar.id} value={avatar.id}>
                  <div className="flex items-center gap-2">
                    <img src={avatar.image_url} alt={avatar.name} className="w-6 h-6 rounded-full object-cover" />
                    <span className="truncate">{avatar.name}</span>
                    <Badge variant="secondary" className="text-[9px] ml-auto">Stock</Badge>
                  </div>
                </SelectItem>
              ))}
              {clientAvatars.filter(a => !a.is_stock).length > 0 && (
                <>
                  <div className="px-2 py-1 text-xs font-medium text-muted-foreground mt-2">Client Avatars</div>
                  {clientAvatars.filter(a => !a.is_stock).map((avatar) => (
                    <SelectItem key={avatar.id} value={avatar.id}>
                      <div className="flex items-center gap-2">
                        <img src={avatar.image_url} alt={avatar.name} className="w-6 h-6 rounded-full object-cover" />
                        <span className="truncate">{avatar.name}</span>
                      </div>
                    </SelectItem>
                  ))}
                </>
              )}
            </SelectContent>
          </Select>

          {/* Look selection for selected avatar */}
          {data.primaryAvatarId && avatarLooks.length > 0 && (
            <div className="space-y-1">
              <Label className="text-[10px] text-muted-foreground">Select Look ({avatarLooks.length})</Label>
              <div className="grid grid-cols-4 gap-1">
                {avatarLooks.map((look) => (
                  <button
                    key={look.id}
                    onClick={() => handleLookSelect(look.id, look.image_url)}
                    className={cn(
                      'relative aspect-[3/4] rounded-md overflow-hidden border-2 transition-all',
                      data.primarySelectedLookId === look.id
                        ? 'border-primary ring-1 ring-primary'
                        : 'border-transparent hover:border-muted-foreground/30'
                    )}
                  >
                    <img src={look.image_url} alt={look.angle || 'Look'} className="w-full h-full object-cover" />
                    {look.is_primary && (
                      <span className="absolute top-0.5 right-0.5 text-[8px] bg-primary text-primary-foreground px-1 rounded">★</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* File Upload */}
          <input ref={primaryFileRef} type="file" accept="image/*" className="hidden" onChange={handleFileUpload('primaryImageUrl')} />
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="flex-1 text-xs" onClick={() => primaryFileRef.current?.click()}>
              <Upload className="h-3 w-3 mr-1" /> Upload
            </Button>
          </div>

          {/* URL Input */}
          <Input
            value={(!data.primaryAvatarId ? data.primaryImageUrl : '') || ''}
            onChange={(e) => onUpdateNode(selectedNode.id, {
              primaryImageUrl: e.target.value,
              primaryAvatarId: undefined,
              primaryAvatarName: undefined,
              primarySelectedLookId: undefined,
            })}
            placeholder="Or paste URL..."
            className="text-sm"
          />

          {data.primaryImageUrl && (
            <div className="relative aspect-square rounded-md overflow-hidden bg-muted">
              <img src={data.primaryImageUrl} alt="Primary" className="w-full h-full object-cover" />
              {data.primaryAvatarName && (
                <span className="absolute bottom-1 left-1 text-[9px] bg-black/60 text-white px-1.5 py-0.5 rounded">{data.primaryAvatarName}</span>
              )}
            </div>
          )}
        </div>

        {/* Secondary Image - Product/Object */}
        <div className="space-y-2">
          <Label className="text-xs">Secondary Image (Product/Object)</Label>
          <input ref={secondaryFileRef} type="file" accept="image/*" className="hidden" onChange={handleFileUpload('secondaryImageUrl')} />
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="flex-1 text-xs" onClick={() => secondaryFileRef.current?.click()}>
              <Upload className="h-3 w-3 mr-1" /> Upload
            </Button>
          </div>
          <Input
            value={data.secondaryImageUrl || ''}
            onChange={(e) => onUpdateNode(selectedNode.id, { secondaryImageUrl: e.target.value })}
            placeholder="Or paste URL..."
            className="text-sm"
          />
          {data.secondaryImageUrl && (
            <div className="relative aspect-square rounded-md overflow-hidden bg-muted">
              <img src={data.secondaryImageUrl} alt="Secondary" className="w-full h-full object-cover" />
            </div>
          )}
        </div>

        {/* Combine Mode */}
        <div className="space-y-2">
          <Label className="text-xs">Combine Mode</Label>
          <Select 
            value={data.combineMode} 
            onValueChange={(v) => onUpdateNode(selectedNode.id, { combineMode: v as CombineMode })}
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {COMBINE_MODES.map((mode) => (
                <SelectItem key={mode.value} value={mode.value}>
                  <div>
                    <span className="font-medium">{mode.label}</span>
                    <span className="text-muted-foreground ml-2 text-xs">{mode.desc}</span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Background Option */}
        <div className="space-y-2">
          <Label className="text-xs">Background</Label>
          <Select 
            value={data.backgroundOption} 
            onValueChange={(v) => onUpdateNode(selectedNode.id, { backgroundOption: v as BackgroundOption })}
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {BG_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {data.backgroundOption === 'custom' && (
          <div className="space-y-2">
            <Label className="text-xs">Custom Background Prompt</Label>
            <Textarea
              value={data.customBackgroundPrompt || ''}
              onChange={(e) => onUpdateNode(selectedNode.id, { customBackgroundPrompt: e.target.value })}
              placeholder="Describe the background..."
              className="min-h-[60px] text-sm"
            />
          </div>
        )}

        {/* Scene Prompt */}
        <div className="space-y-2">
          <Label className="text-xs">Scene Description</Label>
          <Textarea
            value={data.prompt || ''}
            onChange={(e) => onUpdateNode(selectedNode.id, { prompt: e.target.value })}
            placeholder="Describe how images should be combined..."
            className="min-h-[80px] text-sm"
          />
        </div>

        {/* Aspect Ratio */}
        <div className="space-y-2">
          <Label className="text-xs">Output Aspect Ratio</Label>
          <Select 
            value={data.aspectRatio} 
            onValueChange={(v) => onUpdateNode(selectedNode.id, { aspectRatio: v as ImageAspectRatio })}
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {(['1:1', '4:5', '9:16', '16:9'] as ImageAspectRatio[]).map((ratio) => (
                <SelectItem key={ratio} value={ratio}>{ratio}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Variations */}
        <div className="space-y-2">
          <Label className="text-xs">Variations: {data.variationCount || 1}</Label>
          <Slider
            value={[data.variationCount || 1]}
            onValueChange={([v]) => onUpdateNode(selectedNode.id, { variationCount: v })}
            min={1}
            max={10}
            step={1}
            className="w-full"
          />
          <p className="text-[10px] text-muted-foreground">Generate 1–10 variations from the same combination</p>
        </div>

        {/* Output */}
        {data.outputVariations && data.outputVariations.length > 1 ? (
          <div className="space-y-2">
            <Label className="text-xs">Variations ({data.outputVariations.length})</Label>
            <div className="grid grid-cols-2 gap-2">
              {data.outputVariations.map((url, i) => (
                <div key={i} className="relative aspect-square rounded-lg overflow-hidden bg-muted cursor-pointer hover:ring-2 hover:ring-primary"
                  onClick={() => onUpdateNode(selectedNode.id, { outputImageUrl: url })}
                >
                  <img src={url} alt={`Var ${i + 1}`} className="w-full h-full object-cover" />
                  {data.outputImageUrl === url && <div className="absolute inset-0 ring-2 ring-primary rounded-lg" />}
                  <span className="absolute bottom-1 left-1 text-[9px] bg-black/60 text-white px-1 rounded">{i + 1}</span>
                </div>
              ))}
            </div>
          </div>
        ) : data.outputImageUrl ? (
          <div className="space-y-2">
            <Label className="text-xs">Combined Output</Label>
            <div className="relative aspect-square rounded-lg overflow-hidden bg-muted">
              <img src={data.outputImageUrl} alt="Combined" className="w-full h-full object-cover" />
            </div>
          </div>
        ) : null}
      </>
    );
  };

  const renderHooksFields = () => {
    const data = selectedNode.data as HooksNodeData;

    const handleAvatarToggle = (avatar: Avatar, checked: boolean) => {
      const current = data.avatars || [];
      if (checked && current.length >= 5) return; // max 5
      const updated = checked
        ? [...current, { avatarId: avatar.id, avatarName: avatar.name, avatarImageUrl: avatar.image_url }]
        : current.filter(a => a.avatarId !== avatar.id);
      onUpdateNode(selectedNode.id, { avatars: updated });
    };

    const isAvatarSelected = (id: string) => (data.avatars || []).some(a => a.avatarId === id);

    return (
      <>
        {/* Script */}
        <div className="space-y-2">
          <Label className="text-xs">Script *</Label>
          <Textarea
            value={data.script}
            onChange={(e) => onUpdateNode(selectedNode.id, { script: e.target.value })}
            placeholder="Paste your full script here..."
            className="min-h-[120px] text-sm"
          />
        </div>

        {/* Video Prompt Override */}
        <div className="space-y-2">
          <Label className="text-xs">Video Prompt (optional)</Label>
          <Textarea
            value={data.videoPrompt || ''}
            onChange={(e) => onUpdateNode(selectedNode.id, { videoPrompt: e.target.value })}
            placeholder="e.g. Keep same background and attire, slow camera follow..."
            className="min-h-[60px] text-sm"
          />
          <p className="text-[10px] text-muted-foreground">Custom instructions applied to all video generations. Leave blank for defaults.</p>
        </div>

        {/* Aspect Ratio */}
        <div className="space-y-2">
          <Label className="text-xs">Aspect Ratio</Label>
          <Select
            value={data.aspectRatio}
            onValueChange={(v) => onUpdateNode(selectedNode.id, { aspectRatio: v as VideoAspectRatio })}
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {(['16:9', '9:16'] as VideoAspectRatio[]).map((ratio) => (
                <SelectItem key={ratio} value={ratio}>{ratio}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Video Model */}
        <div className="space-y-2">
          <Label className="text-xs">Video Model</Label>
          <Select
            value={data.videoModel || 'veo3'}
            onValueChange={(v) => onUpdateNode(selectedNode.id, { videoModel: v as VideoModel })}
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {VIDEO_MODELS.map((model) => (
                <SelectItem key={model.value} value={model.value}>{model.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label className="text-xs">Select Avatars (max 5) — {(data.avatars || []).length}/5</Label>
          <div className="space-y-1.5 max-h-[200px] overflow-y-auto pr-1">
            {allAvatars.map((avatar) => (
              <label
                key={avatar.id}
                className={cn(
                  'flex items-center gap-2 p-2 rounded-lg border cursor-pointer transition-all',
                  isAvatarSelected(avatar.id) ? 'border-primary bg-primary/5' : 'border-border hover:border-muted-foreground/30'
                )}
              >
                <Checkbox
                  checked={isAvatarSelected(avatar.id)}
                  onCheckedChange={(checked) => handleAvatarToggle(avatar, !!checked)}
                  disabled={!isAvatarSelected(avatar.id) && (data.avatars || []).length >= 5}
                />
                <img src={avatar.image_url} alt={avatar.name} className="w-8 h-8 rounded-full object-cover" />
                <span className="text-sm truncate flex-1">{avatar.name}</span>
                {avatar.is_stock && <Badge variant="secondary" className="text-[9px]">Stock</Badge>}
              </label>
            ))}
            {allAvatars.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-3">No avatars available</p>
            )}
          </div>
        </div>

        {/* Scenes Breakdown Preview */}
        {data.scenesBreakdown && data.scenesBreakdown.length > 0 && (
          <div className="space-y-2">
            <Label className="text-xs">Scene Breakdown ({data.scenesBreakdown.length} scenes)</Label>
            <div className="space-y-1">
              {data.scenesBreakdown.map((scene, i) => (
                <div key={i} className="p-2 rounded-lg border border-border text-xs">
                  <div className="flex justify-between items-center mb-1">
                    <span className="font-medium">Scene {i + 1}</span>
                    <Badge variant="outline" className="text-[10px]">{scene.duration}s</Badge>
                  </div>
                  <p className="text-muted-foreground line-clamp-1">{scene.lipSyncLine}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Per-Avatar Track Results */}
        {data.tracks && data.tracks.length > 0 && (
          <div className="space-y-2">
            <Label className="text-xs">Avatar Tracks</Label>
            {data.tracks.map((track) => (
              <Collapsible key={track.avatarId}>
                <CollapsibleTrigger className="flex items-center gap-2 w-full p-2 rounded-lg border border-border hover:bg-muted/50 transition-all text-left">
                  <img src={track.avatarImageUrl} alt={track.avatarName} className="w-6 h-6 rounded-full object-cover" />
                  <span className="text-sm flex-1 truncate">{track.avatarName}</span>
                  <Badge variant={track.overallStatus === 'completed' ? 'default' : 'secondary'} className="text-[9px]">
                    {track.overallStatus}
                  </Badge>
                  <ChevronDown className="h-3 w-3 text-muted-foreground" />
                </CollapsibleTrigger>
                <CollapsibleContent className="mt-1 space-y-1">
                  {track.scenes.map((scene) => (
                    <div key={scene.id} className={cn(
                      'p-2 rounded-lg border text-xs ml-2',
                      scene.status === 'completed' && 'border-green-500/30 bg-green-500/5',
                      scene.status === 'generating' && 'border-yellow-500/30 bg-yellow-500/5 animate-pulse',
                      scene.status === 'failed' && 'border-destructive/30 bg-destructive/5',
                      scene.status === 'idle' && 'border-border',
                    )}>
                      <div className="flex justify-between mb-1">
                        <span className="font-medium">Scene {scene.order + 1}</span>
                        <Badge variant="outline" className="text-[10px]">{scene.status}</Badge>
                      </div>
                      <p className="text-muted-foreground line-clamp-1 mb-1">{scene.lipSyncLine}</p>
                      {scene.generatedImageUrl && (
                        <img src={scene.generatedImageUrl} alt={`Scene ${scene.order + 1}`} className="w-full aspect-video rounded object-cover mb-1" />
                      )}
                      {scene.generatedVideoUrl && (
                        <video src={scene.generatedVideoUrl} controls className="w-full aspect-video rounded object-cover" />
                      )}
                    </div>
                  ))}
                </CollapsibleContent>
              </Collapsible>
            ))}
          </div>
        )}
      </>
    );
  };

  const renderFields = () => {
    switch (nodeType) {
      case 'image-generator':
        return renderImageGeneratorFields();
      case 'video-generator':
        return renderVideoGeneratorFields();
      case 'prompt-generator':
        return renderPromptGeneratorFields();
      case 'image-to-video':
        return renderImageToVideoFields();
      case 'avatar-scene':
        return renderAvatarSceneFields();
      case 'scene-combiner':
        return renderSceneCombinerFields();
      case 'image-combiner':
        return renderImageCombinerFields();
      case 'hooks':
        return renderHooksFields();
      default:
        return null;
    }
  };

  return (
    <div className="w-80 border-l border-border bg-card flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-border">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-muted">
            <Icon className="h-5 w-5 text-foreground" />
          </div>
          <div>
            <h3 className="font-semibold text-sm">{selectedNode.data.label}</h3>
            <p className="text-xs text-muted-foreground">{nodeConfig?.label || nodeType}</p>
          </div>
        </div>
      </div>

      {/* Content */}
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-4">
          {renderFields()}

          {selectedNode.data.error && (
            <div className="text-sm text-destructive bg-destructive/10 rounded-lg p-3">
              {selectedNode.data.error}
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Footer */}
      <div className="p-4 border-t border-border">
        <Button 
          className="w-full gap-2" 
          onClick={() => onGenerateNode(selectedNode.id)}
          disabled={isGenerating}
        >
          {isGenerating ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Generating...
            </>
          ) : (
            <>
              <Play className="h-4 w-4" />
              Generate
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
