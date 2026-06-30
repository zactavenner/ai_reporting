// Wave C #11: single source of truth for default chat / image / video models.
// Edge functions previously hard-coded "nvidia/nemotron-3-ultra-550b-a55b:free" in 30+ places;
// now they call getAgencyDefaults() and read the live values from
// public.agency_settings. The constants below are last-resort fallbacks used
// when the row is missing or the lookup fails (e.g. during boot).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

export const FALLBACK_CHAT_MODEL = "nvidia/nemotron-3-ultra-550b-a55b:free";
export const FALLBACK_IMAGE_MODEL = "google/gemini-3.1-flash-image";
export const FALLBACK_VIDEO_MODEL = "bytedance/seedance-2.0-fast";

export type AgencyDefaults = {
  chat: string;
  image: string;
  video: string;
};

let _cache: { value: AgencyDefaults; at: number } | null = null;
const TTL_MS = 60_000;

export async function getAgencyDefaults(opts?: { supabaseUrl?: string; serviceKey?: string }): Promise<AgencyDefaults> {
  if (_cache && Date.now() - _cache.at < TTL_MS) return _cache.value;
  const url = opts?.supabaseUrl || Deno.env.get("SUPABASE_URL") || "";
  const key = opts?.serviceKey || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const fallback: AgencyDefaults = { chat: FALLBACK_CHAT_MODEL, image: FALLBACK_IMAGE_MODEL, video: FALLBACK_VIDEO_MODEL };
  if (!url || !key) return fallback;
  try {
    const supa = createClient(url, key);
    const { data } = await supa
      .from("agency_settings")
      .select("default_chat_model, default_image_model, default_video_model")
      .limit(1)
      .maybeSingle();
    const value: AgencyDefaults = {
      chat: data?.default_chat_model || FALLBACK_CHAT_MODEL,
      image: data?.default_image_model || FALLBACK_IMAGE_MODEL,
      video: data?.default_video_model || FALLBACK_VIDEO_MODEL,
    };
    _cache = { value, at: Date.now() };
    return value;
  } catch (e) {
    console.warn("getAgencyDefaults lookup failed; using fallbacks", e);
    return fallback;
  }
}

export function clearAgencyDefaultsCache() { _cache = null; }