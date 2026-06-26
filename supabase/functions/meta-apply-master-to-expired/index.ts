import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';

const META_V = 'v21.0';
const GRAPH = `https://graph.facebook.com/${META_V}`;

async function getMasterExpiry(token: string): Promise<string | null> {
  const appId = Deno.env.get('META_APP_ID');
  const appSecret = Deno.env.get('META_APP_SECRET');
  if (!appId || !appSecret) return null;
  try {
    const r = await fetch(`${GRAPH}/debug_token?input_token=${token}&access_token=${appId}|${appSecret}`);
    const j = await r.json();
    const exp = j?.data?.expires_at;
    return exp && exp > 0 ? new Date(exp * 1000).toISOString() : null;
  } catch { return null; }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const sb = createClient(url, key);

    // Resolve master token: prefer persisted refreshed token, fall back to secret
    let masterToken: string | null = null;
    const { data: state } = await sb.from('meta_token_state').select('access_token').eq('id', 1).maybeSingle();
    masterToken = (state?.access_token as string) || Deno.env.get('META_SHARED_ACCESS_TOKEN') || null;
    if (!masterToken) {
      return new Response(JSON.stringify({ ok: false, error: 'No master token available' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const newExpiry = await getMasterExpiry(masterToken);

    // Find expired/expiring (within 14d) meta clients
    const horizon = new Date(Date.now() + 14 * 86400000).toISOString();
    const { data: expired, error: qErr } = await sb
      .from('integration_status')
      .select('client_id, token_expires_at')
      .ilike('integration_name', 'meta%')
      .lt('token_expires_at', horizon);
    if (qErr) throw qErr;

    const clientIds = Array.from(new Set((expired || []).map((r: any) => r.client_id).filter(Boolean)));
    if (clientIds.length === 0) {
      return new Response(JSON.stringify({ ok: true, applied: 0, clients: [] }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Clear per-client overrides so syncs fall back to the master token
    const { error: cErr } = await sb
      .from('clients')
      .update({ meta_access_token: null })
      .in('id', clientIds);
    if (cErr) throw cErr;

    // Refresh integration_status rows: mark connected, push expiry to master's
    const { error: iErr } = await sb
      .from('integration_status')
      .update({
        is_connected: true,
        token_expires_at: newExpiry,
        last_error_message: null,
        error_count: 0,
        updated_at: new Date().toISOString(),
      })
      .ilike('integration_name', 'meta%')
      .in('client_id', clientIds);
    if (iErr) throw iErr;

    return new Response(JSON.stringify({
      ok: true,
      applied: clientIds.length,
      clients: clientIds,
      new_expiry: newExpiry,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});