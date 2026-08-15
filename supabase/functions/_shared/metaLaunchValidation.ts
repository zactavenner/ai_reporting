// Shared validation + Graph version resolution for the Ads Launch Center.
// Keep this pure: no secrets, no network. Env is read defensively so this
// module can also be imported by the browser-side test suite.

function envVar(name: string): string | undefined {
  const runtime = globalThis as typeof globalThis & {
    Deno?: { env?: { get?: (n: string) => string | undefined } };
  };
  return runtime.Deno?.env?.get?.(name);
}

export const DEFAULT_META_VERSION = "v24.0";
/** Environment override always wins; otherwise the pinned default. */
export const META_VERSION = (envVar("META_GRAPH_VERSION") || DEFAULT_META_VERSION).trim();
export const GRAPH = `https://graph.facebook.com/${META_VERSION}`;

export const SUPPORTED_CTAS = [
  "LEARN_MORE", "SIGN_UP", "APPLY_NOW", "GET_QUOTE", "SUBSCRIBE",
  "BOOK_TRAVEL", "CONTACT_US", "DOWNLOAD", "GET_OFFER", "SHOP_NOW",
] as const;

export const SPECIAL_AD_CATEGORIES = ["NONE", "HOUSING", "EMPLOYMENT", "CREDIT", "ISSUES_ELECTIONS_POLITICS", "FINANCIAL_PRODUCTS_SERVICES"] as const;

/**
 * Every special ad category other than NONE restricts demographic targeting on
 * Meta. For those we omit the operator's age selection entirely and let Meta
 * apply its own unrestricted floor, instead of sending values it will reject.
 */
export const RESTRICTED_AD_CATEGORIES = [
  "HOUSING", "EMPLOYMENT", "CREDIT", "ISSUES_ELECTIONS_POLITICS", "FINANCIAL_PRODUCTS_SERVICES",
] as const;

export function isRestrictedCategory(category: unknown): boolean {
  return RESTRICTED_AD_CATEGORIES.includes(String(category) as typeof RESTRICTED_AD_CATEGORIES[number]);
}

/** Builds the Meta targeting spec, dropping age fields for restricted categories. */
export function buildTargeting(launch: {
  countries?: unknown;
  age_min?: unknown;
  age_max?: unknown;
  special_ad_category?: unknown;
}): Record<string, unknown> {
  const countries = Array.isArray(launch.countries) ? launch.countries : [];
  const targeting: Record<string, unknown> = { geo_locations: { countries } };
  if (isRestrictedCategory(launch.special_ad_category)) return targeting;
  const min = Number(launch.age_min);
  const max = Number(launch.age_max);
  if (Number.isInteger(min)) targeting.age_min = min;
  if (Number.isInteger(max)) targeting.age_max = max;
  return targeting;
}

export const LAUNCH_STAGES = ["campaign", "adset", "media", "creative", "ad"] as const;

/**
 * Which publish stages still need to run for a launch row. A retry skips every
 * stage whose Meta object id was already persisted.
 */
export function stagesToRun(launch: {
  meta_campaign_id?: unknown;
  meta_adset_id?: unknown;
  meta_image_hash?: unknown;
  meta_video_id?: unknown;
  meta_creative_id?: unknown;
  meta_ad_id?: unknown;
}): string[] {
  const done = {
    campaign: !!launch.meta_campaign_id,
    adset: !!launch.meta_adset_id,
    media: !!launch.meta_image_hash || !!launch.meta_video_id,
    creative: !!launch.meta_creative_id,
    ad: !!launch.meta_ad_id,
  } as Record<string, boolean>;
  return LAUNCH_STAGES.filter((s) => !done[s]);
}

export const OBJECTIVES = {
  leads: { obj: "OUTCOME_LEADS", goal: "OFFSITE_CONVERSIONS", billing: "IMPRESSIONS" },
  traffic: { obj: "OUTCOME_TRAFFIC", goal: "LINK_CLICKS", billing: "IMPRESSIONS" },
} as const;

export interface LaunchInput {
  name: string;
  objective: string;
  daily_budget_cents: number;
  cta: string;
  destination_url: string;
  primary_text: string;
  headline: string;
  description?: string | null;
  page_id: string;
  pixel_id?: string | null;
  countries: string[];
  age_min: number;
  age_max: number;
  special_ad_category: string;
  creative_url: string;
  creative_type: string;
}

function isHttpsUrl(value: unknown): boolean {
  if (typeof value !== "string" || !value) return false;
  try {
    const u = new URL(value);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

/** Returns a list of human-readable validation errors. Empty list = ready to publish. */
export function validateLaunch(input: Partial<LaunchInput>): string[] {
  const errors: string[] = [];

  if (!input.name || String(input.name).trim().length < 3) errors.push("Campaign name must be at least 3 characters");
  if (!input.objective || !(input.objective in OBJECTIVES)) errors.push("Objective must be 'leads' or 'traffic'");
  const budget = Number(input.daily_budget_cents);
  if (!Number.isFinite(budget) || budget < 500) errors.push("Daily budget must be at least $5.00");
  if (!input.cta || !SUPPORTED_CTAS.includes(String(input.cta) as typeof SUPPORTED_CTAS[number])) errors.push("Unsupported call-to-action value");
  if (!isHttpsUrl(input.destination_url)) errors.push("Destination URL must be a valid http(s) URL");
  if (!input.primary_text || String(input.primary_text).trim().length < 5) errors.push("Primary text is required");
  if (!input.headline || String(input.headline).trim().length < 3) errors.push("Headline is required");
  if (!input.page_id || !/^\d{5,}$/.test(String(input.page_id))) errors.push("Meta Page ID must be numeric");
  if (input.objective === "leads" && !/^\d{5,}$/.test(String(input.pixel_id ?? ""))) {
    errors.push("A numeric Pixel ID is required for the Leads objective");
  }
  if (input.pixel_id && !/^\d{5,}$/.test(String(input.pixel_id))) errors.push("Pixel ID must be numeric");

  const countries = Array.isArray(input.countries) ? input.countries : [];
  if (!countries.length) errors.push("At least one target country is required");
  if (countries.some((c) => !/^[A-Z]{2}$/.test(String(c)))) errors.push("Countries must be uppercase 2-letter ISO codes");

  if (!input.special_ad_category || !SPECIAL_AD_CATEGORIES.includes(String(input.special_ad_category) as typeof SPECIAL_AD_CATEGORIES[number])) {
    errors.push("Invalid special ad category");
  }

  // Restricted categories ignore age targeting entirely, so it is not validated.
  if (!isRestrictedCategory(input.special_ad_category)) {
    const min = Number(input.age_min), max = Number(input.age_max);
    if (!Number.isInteger(min) || min < 18 || min > 65) errors.push("Minimum age must be between 18 and 65");
    if (!Number.isInteger(max) || max < 18 || max > 65) errors.push("Maximum age must be between 18 and 65");
    if (Number.isFinite(min) && Number.isFinite(max) && max < min) errors.push("Maximum age must be greater than or equal to minimum age");
  }

  if (!isHttpsUrl(input.creative_url)) errors.push("An approved creative asset is required");
  if (input.creative_type !== "image" && input.creative_type !== "video") errors.push("Creative type must be image or video");

  return errors;
}