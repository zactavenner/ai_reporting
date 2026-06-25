// Batch Video Generation Types

export type BatchVideoStep = 'script' | 'visual' | 'scenes' | 'generate';

export type VideoAdType = 'hook-story-cta' | 'problem-solution' | 'testimonial' | 'product-demo' | 'ugc-style';
export type VideoPlatform = 'tiktok-reels' | 'youtube' | 'square';
export type VoiceTone = 'professional' | 'casual' | 'energetic' | 'calm';
export type BackgroundStyle = 'animated-gradient' | 'office-studio' | 'outdoor' | 'abstract-motion' | 'brand-colors';
export type VisualQuality = 'standard' | 'hyper-realistic';
export type VideoModel = 'nano-banana-pro' | 'veo3' | 'haiper-1.1';
export type ExportFormat = 'mp4-1080p' | 'mp4-4k' | 'mov';

export interface ScriptSegment {
  id: string;
  order: number;
  text: string; // Lip-sync dialogue / voiceover script
  duration: number; // seconds (editable)
  imagePrompt: string; // visual description
  sceneDescription: string; // Action/movement description
  cameraAngle?: 'close-up' | 'medium' | 'wide' | 'side-profile';
  sceneType?: 'avatar' | 'broll'; // per-scene toggle
  backgroundStyle?: BackgroundStyle;
}

export interface BatchVideoScene {
  id: string;
  order: number;
  segment: ScriptSegment;
  visualType: 'avatar' | 'broll' | 'mixed';
  avatarId?: string;
  avatarImageUrl?: string;
  generatedImageUrl?: string;
  videoUrl?: string;
  status: 'pending' | 'queued' | 'image_generating' | 'image_completed' | 'video_generating' | 'video_completed' | 'failed';
  operationId?: string;
  error?: string;
  useAvatar?: boolean;
}

export interface BatchVideoConfig {
  projectId: string;
  clientId: string;
  scriptId: string;
  scriptContent: string;
  aspectRatio: '16:9' | '9:16' | '1:1';
  visualType: 'avatar' | 'broll' | 'mixed';
  avatarId?: string;
  avatarImageUrl?: string;
  avatarDescription?: string;
  offerDescription?: string;
  // Brand context
  brandColors?: string[];
  brandFonts?: string[];
  // New fields
  adType?: VideoAdType;
  platform?: VideoPlatform;
  voiceTone?: VoiceTone;
  speakingPace?: number; // 0.5 to 2.0
  backgroundStyle?: BackgroundStyle;
  visualQuality?: VisualQuality;
  videoModel?: VideoModel;
  exportFormat?: ExportFormat;
}

export interface BatchVideoState {
  step: BatchVideoStep;
  config: Partial<BatchVideoConfig>;
  segments: ScriptSegment[];
  scenes: BatchVideoScene[];
  isProcessing: boolean;
}
