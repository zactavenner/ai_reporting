import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

async function fetchAgencySettingsRow(url: string, serviceKey: string): Promise<Record<string, unknown> | null> {
  const supabase = createClient(url, serviceKey);

  const { data, error } = await supabase
    .from('agency_settings')
    .select('*')
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return data as Record<string, unknown>;
}

export async function getOpenRouterApiKey(requestApiKey?: string): Promise<string | null> {
  try {
    const databaseCandidates = [
      {
        url: Deno.env.get('SUPABASE_URL'),
        serviceKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
      },
      {
        url: Deno.env.get('ORIGINAL_SUPABASE_URL'),
        serviceKey: Deno.env.get('ORIGINAL_SUPABASE_SERVICE_ROLE_KEY'),
      },
    ];

    for (const candidate of databaseCandidates) {
      if (!candidate.url || !candidate.serviceKey) continue;

      const row = await fetchAgencySettingsRow(candidate.url, candidate.serviceKey);
      if (!row) continue;

      const settings = (row.settings && typeof row.settings === 'object' && !Array.isArray(row.settings))
        ? row.settings as Record<string, unknown>
        : {};

      const key = (typeof row.openrouter_api_key === 'string' && row.openrouter_api_key.trim())
        ? row.openrouter_api_key
        : (typeof settings.openrouter_api_key === 'string' && (settings.openrouter_api_key as string).trim())
          ? settings.openrouter_api_key as string
          : null;

      if (key) return key;
    }
  } catch (err) {
    console.warn('Failed to resolve OpenRouter key from agency settings:', err);
  }

  if (requestApiKey?.trim()) return requestApiKey;

  return Deno.env.get('OPENROUTER_API_KEY') || null;
}
