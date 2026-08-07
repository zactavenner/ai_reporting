// Task-type → agent routing. Replaces the Hermes orchestrator: Lovable is the
// orchestrator now, Supabase is the data layer, OpenRouter is the model layer.
export const TASK_TYPE_TO_AGENT_SLUG: Record<string, string> = {
  video: "video_ads",
  video_ad: "video_ads",
  script: "video_ads",
  static_ad: "static_ads",
  static: "static_ads",
  design: "static_ads",
  copy: "copywriter",
  email: "copywriter",
  sms: "copywriter",
  research: "reporting",
  reporting: "reporting",
  report: "reporting",
  media_buying: "media_buyer",
  ads: "media_buyer",
  sales: "sales_agent",
  call_audit: "sales_agent",
  client: "account_manager",
  account: "account_manager",
  strategy: "jeremy_ai",
};

/** Route a free-form task type to an agency agent slug. Defaults to Jarvis. */
export function routeTaskType(taskType?: string | null): string {
  const key = String(taskType || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  return TASK_TYPE_TO_AGENT_SLUG[key] || "account_manager";
}
