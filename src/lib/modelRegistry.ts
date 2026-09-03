// Centralized model registry for Agent Workforce.
// `contextTokens` is approx; capacity bar = sum(file tokens) / contextTokens.

export type CapabilityKind = "chat" | "image" | "video";

export type ModelInfo = {
  id: string;
  label: string;
  provider: string;
  contextTokens: number; // approx context window
  capability: CapabilityKind;
};

export const MODEL_REGISTRY: Record<string, ModelInfo> = {
  "nvidia/nemotron-3-ultra-550b-a55b:free": { id: "nvidia/nemotron-3-ultra-550b-a55b:free", label: "Nemotron 3 Ultra", provider: "OpenRouter", contextTokens: 1_000_000, capability: "chat" },
  "openrouter/deepseek/deepseek-v4-flash-latest": { id: "openrouter/deepseek/deepseek-v4-flash-latest", label: "DeepSeek V4 Flash", provider: "DeepSeek", contextTokens: 128_000, capability: "chat" },
  "openai/gpt-5": { id: "openai/gpt-5", label: "GPT-5", provider: "OpenAI", contextTokens: 400_000, capability: "chat" },
  "openai/gpt-5-mini": { id: "openai/gpt-5-mini", label: "GPT-5 Mini", provider: "OpenAI", contextTokens: 200_000, capability: "chat" },
  "google/gemini-2.5-pro": { id: "google/gemini-2.5-pro", label: "Gemini 2.5 Pro", provider: "Google", contextTokens: 2_000_000, capability: "chat" },
  "anthropic/claude-3.7-sonnet": { id: "anthropic/claude-3.7-sonnet", label: "Claude 3.7 Sonnet", provider: "Anthropic", contextTokens: 200_000, capability: "chat" },
  "openai/gpt-image-2": { id: "openai/gpt-image-2", label: "GPT Image 2", provider: "OpenAI", contextTokens: 0, capability: "image" },
  "google/gemini-3.1-flash-image": { id: "google/gemini-3.1-flash-image", label: "Nano Banana Pro", provider: "Google", contextTokens: 0, capability: "image" },
  // Approved video models: MiniMax H3 (720p/2K), Seedance 2.0 (720p only)
  // and Seedance 2.5 (480p/720p, 4–30s in one clip).
  "minimax/hailuo-3": { id: "minimax/hailuo-3", label: "MiniMax H3", provider: "MiniMax", contextTokens: 0, capability: "video" },
  "bytedance/seedance-2.0": { id: "bytedance/seedance-2.0", label: "Seedance", provider: "ByteDance", contextTokens: 0, capability: "video" },
  "bytedance/seedance-2.5": { id: "bytedance/seedance-2.5", label: "Seedance 2.5", provider: "ByteDance", contextTokens: 0, capability: "video" },
  "alibaba/wan-3.0": { id: "alibaba/wan-3.0", label: "Wan 3.0", provider: "Alibaba", contextTokens: 0, capability: "video" },
};

export const CONNECTOR_REGISTRY: Record<string, { label: string; emoji: string }> = {
  meta: { label: "Meta Ads", emoji: "📘" },
  ghl: { label: "GoHighLevel", emoji: "📞" },
  "google-sheets": { label: "Google Sheets", emoji: "📊" },
  fathom: { label: "Fathom", emoji: "🎙️" },
};

export function getModelInfo(id: string): ModelInfo | undefined {
  return MODEL_REGISTRY[id];
}

// Rough char→token conversion: ~4 chars/token. Used for capacity bar from file size.
export function bytesToTokensApprox(bytes: number): number {
  return Math.ceil(bytes / 4);
}

// ----- Legacy exports kept for video batch + offer UI ------------------------

export type VideoModelSpec = {
  value: string;
  /** alias for value */
  id: string;
  label: string;
  hint: string;
  maxSeconds: number;
  pricePerSecond: number;
  supportsResolutions?: string[];
  defaultDuration?: number;
  durations?: number[];
  maxRes?: "720p" | "1080p" | "2k" | "4k";
};

export const VIDEO_MODELS: VideoModelSpec[] = [
  { value: "minimax/hailuo-3", id: "minimax/hailuo-3", label: "MiniMax H3", hint: "720p or native 2K • first/last frame + reference identity", maxSeconds: 15, pricePerSecond: 0.13, supportsResolutions: ["720p", "2k"], defaultDuration: 15, durations: [5, 10, 15], maxRes: "2k" },
  { value: "bytedance/seedance-2.0", id: "bytedance/seedance-2.0", label: "Seedance", hint: "720p only • first/last frame keyframing + reference images", maxSeconds: 15, pricePerSecond: 0.0538, supportsResolutions: ["720p"], defaultDuration: 15, durations: [5, 10, 15], maxRes: "720p" },
  { value: "bytedance/seedance-2.5", id: "bytedance/seedance-2.5", label: "Seedance 2.5", hint: "480p or 720p • 4–30s in ONE clip • first/last frame • best for 30s ads", maxSeconds: 30, pricePerSecond: 0.2311, supportsResolutions: ["480p", "720p"], defaultDuration: 15, durations: [5, 10, 15, 20, 25, 30], maxRes: "720p" },
  { value: "alibaba/wan-3.0", id: "alibaba/wan-3.0", label: "Wan 3.0", hint: "480p / 720p / 1080p • 2–30s in ONE clip • first frame + reference images • native audio", maxSeconds: 30, pricePerSecond: 0.034, supportsResolutions: ["480p", "720p", "1080p"], defaultDuration: 10, durations: [5, 10, 15, 20, 25, 30], maxRes: "1080p" },
];

export const OFFER_IMAGE_ROLES = [
  { key: "reference", label: "Reference" },
  { key: "video_ad", label: "Video Ad Ref" },
  { key: "static_ad", label: "Static Ad Ref" },
  { key: "product", label: "Product" },
  { key: "logo", label: "Logo" },
  { key: "lifestyle", label: "Lifestyle" },
  { key: "testimonial", label: "Testimonial" },
  { key: "avatar", label: "Avatar" },
] as const;