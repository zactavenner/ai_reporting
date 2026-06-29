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
  "openrouter/owl-alpha": { id: "openrouter/owl-alpha", label: "Owl Alpha", provider: "OpenRouter", contextTokens: 200_000, capability: "chat" },
  "openrouter/deepseek/deepseek-v4-flash": { id: "openrouter/deepseek/deepseek-v4-flash", label: "DeepSeek V4 Flash", provider: "DeepSeek", contextTokens: 128_000, capability: "chat" },
  "openai/gpt-5": { id: "openai/gpt-5", label: "GPT-5", provider: "OpenAI", contextTokens: 400_000, capability: "chat" },
  "openai/gpt-5-mini": { id: "openai/gpt-5-mini", label: "GPT-5 Mini", provider: "OpenAI", contextTokens: 200_000, capability: "chat" },
  "openai/gpt-image-2": { id: "openai/gpt-image-2", label: "GPT Image 2", provider: "OpenAI", contextTokens: 0, capability: "image" },
  "google/gemini-3.1-flash-image": { id: "google/gemini-3.1-flash-image", label: "Nano Banana Pro", provider: "Google", contextTokens: 0, capability: "image" },
  "bytedance/seedance-2.0-fast": { id: "bytedance/seedance-2.0-fast", label: "Seedance 2.0 Fast", provider: "ByteDance", contextTokens: 0, capability: "video" },
  "x-ai/grok-imagine-video": { id: "x-ai/grok-imagine-video", label: "Grok Imagine", provider: "xAI", contextTokens: 0, capability: "video" },
  "alibaba/happyhorse-1.1": { id: "alibaba/happyhorse-1.1", label: "HappyHorse 1.1", provider: "Alibaba", contextTokens: 0, capability: "video" },
};

export const CONNECTOR_REGISTRY: Record<string, { label: string; emoji: string }> = {
  meta: { label: "Meta Ads", emoji: "📘" },
  ghl: { label: "GoHighLevel", emoji: "📞" },
  stripe: { label: "Stripe", emoji: "💳" },
  "google-sheets": { label: "Google Sheets", emoji: "📊" },
  slack: { label: "Slack", emoji: "💬" },
  whatsapp: { label: "WhatsApp", emoji: "🟢" },
  openrouter: { label: "OpenRouter", emoji: "🛰️" },
  fathom: { label: "Fathom", emoji: "🎙️" },
};

export function getModelInfo(id: string): ModelInfo | undefined {
  return MODEL_REGISTRY[id];
}

// Rough char→token conversion: ~4 chars/token. Used for capacity bar from file size.
export function bytesToTokensApprox(bytes: number): number {
  return Math.ceil(bytes / 4);
}