import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';

const META_V = 'v21.0';
const GRAPH = `https://graph.facebook.com/${META_V}`;

interface ValidationResult {
  ok: boolean;
  token?: string;
  expires_at?: string | null;
  scopes?: string[];
  ad_accounts?: { id: string; name: string; account_status: number }[];
  user?: { id: string; name: string };
  error?: string;
}

async function exchangeForLongLived(shortToken: string): Promise<{ token: string; expires_in: number | null }> {
  const appId = Deno.env.get('META_APP_ID');
  const appSecret = Deno.env.get('META_APP_SECRET');
  if (!appId || !appSecret) throw new Error('META_APP_ID / META_APP_SECRET missing');

  const url = `${GRAPH}/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${shortToken}`;
  const res = await fetch(url);
  const body = await res.json();
  if (!res.ok || !body.access_token) {
    throw new Error(`Exchange failed: ${body?.error?.message || JSON.stringify(body)}`);
  }
  return { token: body.access_token, expires_in: body.expires_in ?? null };
}

async function validateToken(token: string): Promise<ValidationResult> {
  try {
    // 1) /me — confirms token is alive
    const meRes = await fetch(`${GRAPH}/me?fields=id,name&access_token=${token}`);
    const me = await meRes.json();
    if (!meRes.ok) return { ok: false, error: me?.error?.message || 'Token invalid (/me failed)' };

    // 2) /me/adaccounts — confirms ads_read scope
    const acctRes = await fetch(`${GRAPH}/me/adaccounts?fields=id,name,account_status&limit=200&access_token=${token}`);
    const acct = await acctRes.json();
    if (!acctRes.ok) return { ok: false, error: acct?.error?.message || 'No ad account access' };

    // 3) debug_token — expiry + scopes
    const appId = Deno.env.get('META_APP_ID');
    const appSecret = Deno.env.get('META_APP_SECRET');
    let expires_at: string | null = null;
    let scopes: string[] = [];
    if (appId && appSecret) {
      const dbgRes = await fetch(`${GRAPH}/debug_token?input_token=${token}&access_token=${appId}|${appSecret}`);
      const dbg = await dbgRes.json();
      const exp = dbg?.data?.expires_at;
      if (exp && exp > 0) expires_at = new Date(exp * 1000).toISOString();
      scopes = dbg?.data?.scopes || [];
    }

    return {
      ok: true,
      token,
      expires_at,
      scopes,
      user: me,
      ad_accounts: acct.data || [],
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function persistTokenState(state: {
  token: string;
  expires_at: string | null;
  ok: boolean;
  error?: string;
  ad_account_count: number;
}) {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) return;
  const sb = createClient(url, key);
  await sb.from('meta_token_state').upsert({
    id: 1,
    access_token: state.token,
    expires_at: state.expires_at,
    last_refreshed_at: new Date().toISOString(),
    last_validated_at: new Date().toISOString(),
    last_status: state.ok ? 'ok' : 'failed',
    last_error: state.error ?? null,
    ad_account_count: state.ad_account_count,
  });
}

async function getCurrentToken(): Promise<string | null> {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (url && key) {
    const sb = createClient(url, key);
    const { data } = await sb.from('meta_token_state').select('access_token').eq('id', 1).maybeSingle();
    if (data?.access_token) return data.access_token as string;
  }
  return Deno.env.get('META_SHARED_ACCESS_TOKEN') ?? null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { action = 'validate', token: inputToken, persist = false } = await req.json().catch(() => ({}));

    // Action: validate a token (provided or current shared)
    if (action === 'validate') {
      const tok = inputToken || (await getCurrentToken());
      if (!tok) {
        return new Response(JSON.stringify({ ok: false, error: 'No token provided' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const result = await validateToken(tok);
      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Action: exchange short-lived → long-lived AND validate
    if (action === 'refresh') {
      const seed = inputToken || (await getCurrentToken());
      if (!seed) {
        return new Response(JSON.stringify({ ok: false, error: 'No seed token' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const { token: longLived } = await exchangeForLongLived(seed);
      const validation = await validateToken(longLived);
      if (persist || validation.ok) {
        await persistTokenState({
          token: longLived,
          expires_at: validation.expires_at ?? null,
          ok: validation.ok,
          error: validation.error,
          ad_account_count: validation.ad_accounts?.length ?? 0,
        });
      }
      return new Response(JSON.stringify(validation), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ ok: false, error: `Unknown action: ${action}` }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});