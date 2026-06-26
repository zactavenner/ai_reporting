// Client types
export interface Client {
  id: string;
  name: string;
  logo_url?: string;
  brand_colors: string[];
  brand_fonts: string[];
  description?: string;
  offer_description?: string;
  product_url?: string;
  product_images: string[];
  created_at: string;
  updated_at: string;
}

// Project types
export type ProjectType = 'video_batch' | 'static_batch' | 'broll' | 'flowboard' | 'batch_video';

export interface Project {
  id: string;
  client_id: string;
  name: string;
  type: ProjectType;
  description?: string;
  offer_description?: string; // Product/offer context for AI script generation
  settings: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

// Avatar types
export type AvatarStyle = 'professional' | 'casual' | 'ugc';

// Avatar Camera Angles for multi-perspective generation (180° arc around avatar)
export type AvatarAngle = 
  | 'close-up' 
  | 'medium' 
  | 'wide' 
  | 'side-profile'
  // 180° arc positions
  | 'front-left-45'
  | 'front-right-45'
  | 'left-90'
  | 'right-90'
  | 'back-left-135'
  | 'back-right-135'
  | 'over-shoulder-left'
  | 'over-shoulder-right';

export interface AngleConfig {
  type: AvatarAngle;
  label: string;
  icon: string;
  category?: 'classic' | '180-arc';
  promptModifier: string;
  focalLength: string;
  framing: string;
}

export interface GeneratedAngle {
  angle: AvatarAngle;
  imageUrl: string;
  status: 'pending' | 'generating' | 'completed' | 'failed';
  error?: string;
}

export interface Avatar {
  id: string;
  client_id?: string;
  name: string;
  description?: string;
  gender?: string;
  age_range?: string;
  ethnicity?: string;
  style?: AvatarStyle;
  image_url: string;
  is_stock: boolean;
  elevenlabs_voice_id?: string;
  looks_count: number;
  created_at: string;
}

// Script types
export interface Script {
  id: string;
  project_id: string;
  title: string;
  framework?: string;
  duration_seconds?: number;
  content: string;
  hook?: string;
  selected: boolean;
  created_at: string;
}

// Asset types
export type AssetType = 'image' | 'video' | 'broll' | 'ad_variation';
export type AssetStatus = 'pending' | 'generating' | 'completed' | 'failed';

export interface Asset {
  id: string;
  project_id?: string; // Optional for standalone assets (e.g., B-roll library)
  client_id?: string;
  type: AssetType;
  name?: string;
  storage_path?: string;
  public_url?: string;
  metadata: Record<string, unknown>;
  script_id?: string;
  avatar_id?: string;
  status: AssetStatus;
  created_at: string;
}

// Batch job types
export type BatchStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface BatchJob {
  id: string;
  project_id: string;
  status: BatchStatus;
  total_items: number;
  completed_items: number;
  settings: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

// Flowboard types
export interface FlowboardNode {
  id: string;
  type: 'scene' | 'branch' | 'broll' | 'product';
  position: { x: number; y: number };
  data: Record<string, unknown>;
}

export interface FlowboardEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
}

export interface Flowboard {
  id: string;
  project_id: string;
  name: string;
  nodes: FlowboardNode[];
  edges: FlowboardEdge[];
  created_at: string;
  updated_at: string;
}

// Video provider types
export type VideoProvider = 'veo' | 'grok';

// Ad Style types
export interface AdStyle {
  id: string;
  client_id?: string;
  name: string;
  description: string;
  prompt_template: string;
  example_image_url?: string;
  reference_images?: string[];
  canva_url?: string | null;
  is_default: boolean;
  display_order: number;
  created_at: string;
}

// Static Batch types
export type AspectRatio = '1:1' | '4:5' | '9:16' | '16:9';

export interface StaticBatchConfig {
  selectedStyles: string[];
  productUrl?: string;
  productDescription?: string;
  characterImageUrl?: string;
  productImages: string[];
  usp?: string;
  brandColors: string[];
  brandFonts: string[];
  aspectRatios: AspectRatio[];
  variationsPerStyle: number;
  /** Per-style variation overrides. Key = styleId, value = count. Falls back to variationsPerStyle. */
  styleVariations?: Record<string, number>;
  includeDisclaimer?: boolean;
  disclaimerText?: string;
  strictBrandAdherence?: boolean;
  adImageUrls?: string[];
  avatarPercentage?: number; // 0-100, what % of ads should include the avatar
  avatarOnlyWithHuman?: boolean; // only use avatar on reference ads that already show a human
  /** Optimized image model for static ads. */
  imageModel?: 'openai/gpt-image-2' | 'google/gemini-3.1-flash-image-preview';
}

export interface GeneratedAd {
  id: string;
  styleId: string;
  styleName: string;
  aspectRatio: AspectRatio;
  imageUrl: string;
  referenceImageUrl?: string; // The original reference image used to generate this ad
  status: 'pending' | 'generating' | 'completed' | 'failed';
  createdAt: string;
  editHistory?: string[]; // Previous image URLs before AI edits
}
