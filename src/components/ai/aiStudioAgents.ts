/**
 * Canonical AI Studio agent rail. Each entry maps a rail row to the value used by
 * the composer's `selectedAgentId` ("master" for Jarvis, `slug:<agency_agent.slug>`
 * for specialists) and is persisted on `ai_studio_conversations.agent_key` so every
 * agent keeps its own chat threads (Grok-style), while the canvas rolls all agents up.
 */
export type StudioAgentRailItem = {
  /** Value stored on the thread + used as selectedAgentId */
  key: string;
  label: string;
  icon: string;
  slug: string | null;
};

export const STUDIO_AGENT_RAIL: StudioAgentRailItem[] = [
  { key: "master", label: "Jarvis", icon: "🧠", slug: "account_manager" },
  { key: "slug:media_buyer", label: "Media Buyer", icon: "📈", slug: "media_buyer" },
  { key: "slug:static_ads", label: "Static Ads", icon: "🎨", slug: "static_ads" },
  { key: "slug:video_ads", label: "Video Ads", icon: "🎬", slug: "video_ads" },
  { key: "slug:reporting", label: "Reporting", icon: "📊", slug: "reporting" },
  { key: "slug:sales_agent", label: "Sales", icon: "📞", slug: "sales_agent" },
  { key: "slug:jeremy_ai", label: "Jeremy AI", icon: "🚀", slug: "jeremy_ai" },
];

/** Threads created before per-agent chats existed live under Jarvis. */
export function normalizeAgentKey(key: string | null | undefined): string {
  if (!key) return "master";
  return STUDIO_AGENT_RAIL.some((a) => a.key === key) ? key : "master";
}

export function agentLabelForKey(key: string | null | undefined): string {
  return STUDIO_AGENT_RAIL.find((a) => a.key === normalizeAgentKey(key))?.label || "Jarvis";
}

export function agentIconForKey(key: string | null | undefined): string {
  return STUDIO_AGENT_RAIL.find((a) => a.key === normalizeAgentKey(key))?.icon || "🧠";
}
