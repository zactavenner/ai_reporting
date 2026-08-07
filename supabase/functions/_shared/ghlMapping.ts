/**
 * Server-only GHL credential mapping.
 *
 * The established Reporting path is `clients.ghl_api_key` + `clients.ghl_location_id`
 * (same rows meetgeek-webhook reads). Nothing here is ever returned to a browser.
 */
export interface GhlMapping {
  apiKey: string | null;
  locationId: string | null;
}

export async function getMappedGhl(supabase: any, clientId: string): Promise<GhlMapping> {
  const { data } = await supabase
    .from('clients')
    .select('ghl_api_key, ghl_location_id')
    .eq('id', clientId)
    .maybeSingle();
  return { apiKey: data?.ghl_api_key || null, locationId: data?.ghl_location_id || null };
}
