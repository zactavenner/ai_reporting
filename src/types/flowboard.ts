import type { Node, Edge, BuiltInNode } from '@xyflow/react';
import type { AvatarAngle } from './index';

// Node types - extended with avatar-scene, scene-combiner, and image-combiner
export type FlowNodeType = 
  | 'image-generator' 
  | 'video-generator' 
  | 'prompt-generator' 
  | 'image-to-video'
  | 'avatar-scene'
  | 'scene-combiner'
  | 'image-combiner'
  | 'hooks';

// Status for all nodes
export type NodeStatus = 'idle' | 'generating' | 'completed' | 'failed';

// Aspect ratios
export type ImageAspectRatio = '1:1' | '4:5' | '9:16' | '16:9';
export type VideoAspectRatio = '16:9' | '9:16';
export type OutputFormat = 'png' | 'jpg';
export type VideoDuration = 4 | 6 | 8;
export type CameraMotion = 'none' | 'pan-left' | 'pan-right' | 'zoom-in' | 'zoom-out' | 'orbit';
export type PromptModel = 'openrouter/owl-alpha' | 'gpt-5-mini' | 'gpt-5' | 'gemini-2.5-flash';
export type VideoModel = 'veo3' | 'grok';
export type TransitionType = 'cut' | 'crossfade' | 'wipe-left' | 'wipe-right' | 'zoom-in' | 'zoom-out';
export type CombineMode = 'blend' | 'replace-background' | 'side-by-side' | 'overlay';
export type BackgroundOption = 'keep' | 'remove' | 'custom';

// Base node data
export interface BaseNodeData extends Record<string, unknown> {
  label: string;
  status: NodeStatus;
  error?: string;
  onDeleteNode?: (nodeId: string) => void;
}

// Image Generator Node Data
export interface ImageGeneratorData extends BaseNodeData {
  prompt: string;
  aspectRatio: ImageAspectRatio;
  outputFormat: OutputFormat;
  variationCount: number;
  referenceImageUrl?: string;
  generatedImageUrl?: string;
  generatedVariations?: string[];
}

// Video Generator Node Data
export interface VideoGeneratorData extends BaseNodeData {
  prompt: string;
  aspectRatio: VideoAspectRatio;
  duration: VideoDuration;
  inputImageUrl?: string;
  generatedVideoUrl?: string;
  operationName?: string;
}

// Prompt Generator Node Data
export interface PromptGeneratorData extends BaseNodeData {
  model: PromptModel;
  context: string;
  inputPrompt: string;
  outputPrompt?: string;
  inputImageUrl?: string;
}

// Image to Video Node Data
export interface ImageToVideoData extends BaseNodeData {
  inputImageUrl?: string;
  prompt: string;
  duration: VideoDuration;
  aspectRatio?: VideoAspectRatio;
  cameraMotion: CameraMotion;
  videoModel?: VideoModel;
  generatedVideoUrl?: string;
  operationName?: string;
}

// Avatar Scene Node Data
export interface AvatarSceneData extends BaseNodeData {
  avatarImageUrl?: string;
  avatarId?: string;
  avatarName?: string;
  selectedLookId?: string;
  scenes: {
    id: string;
    angle: AvatarAngle;
    action: string;
    duration: VideoDuration;
    generatedImageUrl?: string;
    generatedVideoUrl?: string;
    status: NodeStatus;
  }[];
}

// Caption style options
export type CaptionStyle = 'none' | 'viral' | 'basic';

// Scene Combiner Node Data
export interface SceneCombinerData extends BaseNodeData {
  inputVideos: string[];
  transitionType: TransitionType;
  transitionDuration: number;
  aspectRatio?: VideoAspectRatio; // 16:9 or 9:16
  outputVideoUrl?: string;
  captionStyle?: CaptionStyle;
  captionText?: string;
  // Voice dubbing
  selectedVoiceId?: string;
  selectedVoiceName?: string;
  dubbingId?: string;
  dubbingStatus?: 'idle' | 'processing' | 'completed' | 'failed';
  dubbedVideoUrl?: string;
  dubbingError?: string;
}

// Image Combiner Node Data
export interface ImageCombinerData extends BaseNodeData {
  primaryImageUrl?: string;
  primaryAvatarId?: string;
  primaryAvatarName?: string;
  primarySelectedLookId?: string;
  secondaryImageUrl?: string;
  combineMode: CombineMode;
  backgroundOption: BackgroundOption;
  customBackgroundPrompt?: string;
  prompt?: string;
  aspectRatio: ImageAspectRatio;
  variationCount: number;
  outputImageUrl?: string;
  outputVariations?: string[];
}

// Hooks A/B Testing Node Data
export interface HooksSceneBreakdown {
  sceneEnvironment: string;
  action: string;
  lipSyncLine: string;
  cameraAngle: string;
  duration: number;
}

export interface HooksTrackScene {
  id: string;
  order: number;
  sceneEnvironment: string;
  action: string;
  lipSyncLine: string;
  cameraAngle: string;
  duration: number;
  generatedImageUrl?: string;
  generatedVideoUrl?: string;
  status: NodeStatus;
}

export interface HooksTrack {
  avatarId: string;
  avatarName: string;
  avatarImageUrl: string;
  selectedLookId?: string;
  scenes: HooksTrackScene[];
  overallStatus: NodeStatus;
}

export interface HooksAvatarSelection {
  avatarId: string;
  avatarName: string;
  avatarImageUrl: string;
  selectedLookId?: string;
}

export interface HooksNodeData extends BaseNodeData {
  script: string;
  aspectRatio: VideoAspectRatio;
  videoPrompt?: string;
  videoModel?: VideoModel;
  avatars: HooksAvatarSelection[];
  tracks: HooksTrack[];
  scenesBreakdown?: HooksSceneBreakdown[];
  onRetryScene?: (nodeId: string, avatarId: string, sceneId: string) => void;
}

// Union type for all node data
export type FlowNodeData = 
  | ImageGeneratorData 
  | VideoGeneratorData 
  | PromptGeneratorData 
  | ImageToVideoData
  | AvatarSceneData
  | SceneCombinerData
  | ImageCombinerData
  | HooksNodeData;

// Custom node types
export type ImageGeneratorNode = Node<ImageGeneratorData, 'image-generator'>;
export type VideoGeneratorNode = Node<VideoGeneratorData, 'video-generator'>;
export type PromptGeneratorNode = Node<PromptGeneratorData, 'prompt-generator'>;
export type ImageToVideoNode = Node<ImageToVideoData, 'image-to-video'>;
export type AvatarSceneNode = Node<AvatarSceneData, 'avatar-scene'>;
export type SceneCombinerNode = Node<SceneCombinerData, 'scene-combiner'>;
export type ImageCombinerNode = Node<ImageCombinerData, 'image-combiner'>;
export type HooksNode = Node<HooksNodeData, 'hooks'>;

export type FlowNode = ImageGeneratorNode | VideoGeneratorNode | PromptGeneratorNode | ImageToVideoNode | AvatarSceneNode | SceneCombinerNode | ImageCombinerNode | HooksNode;
export type FlowEdge = Edge;
export type AppNode = FlowNode | BuiltInNode;

// Flowboard state
export interface FlowboardState {
  nodes: FlowNode[];
  edges: FlowEdge[];
  selectedNodeId: string | null;
}

// Default node data factories
export const createImageGeneratorData = (): ImageGeneratorData => ({
  label: 'Image Generator',
  status: 'idle',
  prompt: '',
  aspectRatio: '1:1',
  outputFormat: 'png',
  variationCount: 1,
});

export const createVideoGeneratorData = (): VideoGeneratorData => ({
  label: 'Video Generator',
  status: 'idle',
  prompt: '',
  aspectRatio: '16:9',
  duration: 8,
});

export const createPromptGeneratorData = (): PromptGeneratorData => ({
  label: 'Prompt Generator',
  status: 'idle',
  model: 'openrouter/owl-alpha',
  context: '',
  inputPrompt: '',
});

export const createImageToVideoData = (): ImageToVideoData => ({
  label: 'Image to Video',
  status: 'idle',
  prompt: '',
  duration: 8,
  cameraMotion: 'none',
  videoModel: 'veo3',
});

export const createAvatarSceneData = (): AvatarSceneData => ({
  label: 'Avatar Scene',
  status: 'idle',
  scenes: [
    { id: 'close-up', angle: 'close-up', action: 'talking to camera', duration: 8, status: 'idle' },
    { id: 'medium', angle: 'medium', action: 'explaining with gestures', duration: 8, status: 'idle' },
    { id: 'wide', angle: 'wide', action: 'full body movement', duration: 8, status: 'idle' },
    { id: 'side-profile', angle: 'side-profile', action: 'looking thoughtful', duration: 8, status: 'idle' },
  ],
});

export const createSceneCombinerData = (): SceneCombinerData => ({
  label: 'Scene Combiner',
  status: 'idle',
  inputVideos: [],
  transitionType: 'cut',
  transitionDuration: 0,
  captionStyle: 'none',
});

export const createImageCombinerData = (): ImageCombinerData => ({
  label: 'Image Combiner',
  status: 'idle',
  combineMode: 'blend',
  backgroundOption: 'keep',
  aspectRatio: '1:1',
  variationCount: 1,
});

export const createHooksData = (): HooksNodeData => ({
  label: 'Hooks A/B',
  status: 'idle',
  script: '',
  aspectRatio: '9:16',
  avatars: [],
  tracks: [],
});

// Credits/cost information
export const NODE_CREDITS = {
  'image-generator': 0.28,
  'video-generator': 5,
  'prompt-generator': 0.01,
  'image-to-video': 5,
  'avatar-scene': 20,
  'scene-combiner': 1,
  'image-combiner': 0.28,
  'hooks': 25,
} as const;
