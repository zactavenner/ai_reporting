// Single source of truth for AI model capabilities (OpenRouter ids).
// Used by: agent dropdowns, video batch dispatch UI, canvas badges,
// composer "next request" badge, model-override pickers.
// Mirror this list in supabase/functions/_shared/video-models.ts for server-side validation.

export type ModelKind = "text" | "image" | "video";

export interface VideoModelSpec {
  id: string;                       // OpenRouter model id ("provider/name")
  label: string;                    // Human label
  provider: "openrouter" | "gemini";
  durations: number[];              // Allowed scene durations (seconds)
  defaultDuration: number;
  maxRes: "720p" | "1080p" | "4k";
  aspectRatios: ("9:16" | "1:1" | "16:9")[];
  estCostPerSecondUsd?: number;     // Rough credit estimate for UI preview
  // Whether this model reliably renders synthetic / AI-generated human avatars
  // without rejecting them as "real people". Seedance currently rejects most
  // photoreal AI avatars; Veo handles them. Used by AI Studio to auto-route
  // avatar clips to a compatible model.
  supportsRealisticAvatars: boolean;
}

export interface TextModelSpec {
  id: string;                       // gateway id ("openai/gpt-5", "google/gemini-2.5-pro", "openrouter/owl-alpha", etc.)
  label: string;
  provider: "lovable" | "openrouter";
  good_for: string;                 // Short description for picker tooltips
}

export const VIDEO_MODELS: VideoModelSpec[] = [
  {
    id: "bytedance/seedance-2.0-fast",
    label: "Seedance Fast",
    provider: "openrouter",
    durations: [4, 5, 8, 10, 12, 15],
    defaultDuration: 15,
    maxRes: "720p",
    aspectRatios: ["9:16", "1:1", "16:9"],
    estCostPerSecondUsd: 0.05,
    supportsRealisticAvatars: false,
  },
  {
    id: "bytedance/seedance-2.0",
    label: "Seedance Pro",
    provider: "openrouter",
    durations: [4, 5, 8, 10, 12, 15],
    defaultDuration: 15,
    maxRes: "4k",
    aspectRatios: ["9:16", "1:1", "16:9"],
    estCostPerSecondUsd: 0.15,
    supportsRealisticAvatars: false,
  },
  {
    id: "kwaivgi/kling-v3.0-std",
    label: "Kling Standard",
    provider: "openrouter",
    durations: [5, 10],
    defaultDuration: 10,
    maxRes: "1080p",
    aspectRatios: ["9:16", "1:1", "16:9"],
    estCostPerSecondUsd: 0.09,
    supportsRealisticAvatars: true,
  },
  {
    id: "kwaivgi/kling-v2.1-master",
    label: "Kling Pro",
    provider: "openrouter",
    durations: [5, 10],
    defaultDuration: 10,
    maxRes: "1080p",
    aspectRatios: ["9:16", "1:1", "16:9"],
    estCostPerSecondUsd: 0.18,
    supportsRealisticAvatars: true,
  },
  {
    id: "google/veo-3.1-fast",
    label: "Veo 3.1",
    provider: "gemini",
    durations: [4, 6, 8],
    defaultDuration: 8,
    maxRes: "1080p",
    aspectRatios: ["9:16", "16:9"],
    estCostPerSecondUsd: 0.40,
    supportsRealisticAvatars: true,
  },
  {
    id: "alibaba/happyhorse-1.1",
    label: "HappyHorse 1.1",
    provider: "openrouter",
    durations: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    defaultDuration: 15,
    maxRes: "1080p",
    aspectRatios: ["9:16", "1:1", "16:9"],
    estCostPerSecondUsd: 0.0988,
    supportsRealisticAvatars: true,
  },
];

export const TEXT_MODELS: TextModelSpec[] = [
  { id: "openrouter/owl-alpha",          label: "Owl Alpha (default)",  provider: "openrouter", good_for: "Default chat/agent model. Balanced reasoning + speed." },
  { id: "google/gemini-2.5-pro",         label: "Gemini 2.5 Pro",       provider: "lovable",    good_for: "Strong multimodal reasoning. Use for complex analysis, sheet audits, vision." },
  { id: "google/gemini-2.5-flash",       label: "Gemini 2.5 Flash",     provider: "lovable",    good_for: "Cheaper, faster Gemini. High-volume drafting." },
  { id: "google/gemini-3-flash-preview", label: "Gemini 3 Flash",       provider: "lovable",    good_for: "Newest Gemini preview, fast." },
  { id: "openai/gpt-5",                  label: "GPT-5",                provider: "lovable",    good_for: "Premium nuance + accuracy." },
  { id: "openai/gpt-5-mini",             label: "GPT-5 Mini",           provider: "lovable",    good_for: "Lower-cost GPT-5." },
];

export function findVideoModel(id: string): VideoModelSpec | undefined {
  return VIDEO_MODELS.find((m) => m.id === id);
}

export function findTextModel(id: string): TextModelSpec | undefined {
  return TEXT_MODELS.find((m) => m.id === id);
}

export function shortModelLabel(id?: string | null): string {
  if (!id) return "default";
  const v = findVideoModel(id) ?? findTextModel(id);
  if (v) return v.label;
  const parts = id.split("/");
  return parts[parts.length - 1] || id;
}

// Offer image tags / semantic roles used as reference hints in AI prompts.
export const OFFER_IMAGE_ROLES = [
  { key: "product",     label: "Product",     hint: "Hero product photo, the thing being sold." },
  { key: "lifestyle",   label: "Lifestyle",   hint: "Person using the product in context." },
  { key: "logo",        label: "Logo",        hint: "Brand mark / wordmark." },
  { key: "testimonial", label: "Testimonial", hint: "Customer quote or proof image." },
  { key: "background",  label: "Background",  hint: "Texture / scene background plate." },
  { key: "reference",   label: "Reference",   hint: "Generic style reference." },
] as const;

export type OfferImageRole = typeof OFFER_IMAGE_ROLES[number]["key"];