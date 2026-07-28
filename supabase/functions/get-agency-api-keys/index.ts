import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

// Password-gated dump of agency-level API keys for the "Copy Client Info" panel.
// Uses the same internal shared password as other internal endpoints.
const INTERNAL_PASSWORD = 'HPA1234$';

const KEYS = [
  'OPENROUTER_API_KEY',
  'LOVABLE_API_KEY',
  'GEMINI_API_KEY',
  'XAI_API_KEY',
  'APIFY_API_KEY',
  'FIRECRAWL_API_KEY',
  'RETARGETIQ_API_KEY',
  'FATHOM_API_KEY',
  'MEETGEEK_API_KEY',
  'STRIPE_SECRET_KEY',
  'AGENCY_GHL_API_KEY',
  'AGENCY_GHL_PIT_TOKEN',
  'AGENCY_GHL_LOCATION_ID',
  'META_APP_ID',
  'META_APP_SECRET',
  'META_SHARED_ACCESS_TOKEN',
  'GOOGLE_OAUTH_CLIENT_ID',
  'GOOGLE_OAUTH_CLIENT_SECRET',
  'SLACK_BOT_TOKEN',
  'SLACK_SIGNING_SECRET',
  'WHATSAPP_BRIDGE_URL',
  'WHATSAPP_BRIDGE_TOKEN',
  'WHATSAPP_WEBHOOK_SECRET',
  'FATHOM_WEBHOOK_SECRET',
];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const { password } = await req.json().catch(() => ({}));
    if (password !== INTERNAL_PASSWORD) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const out: Record<string, string | null> = {};
    for (const k of KEYS) {
      const v = Deno.env.get(k);
      out[k] = v ? v : null;
    }
    return new Response(JSON.stringify({ keys: out }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});