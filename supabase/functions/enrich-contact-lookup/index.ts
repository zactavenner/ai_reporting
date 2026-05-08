import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Lightweight RetargetIQ lookup for sheet/file enrichment.
// Does NOT write to leads/lead_enrichment — just returns the enrichment payload.
// Callers: EnrichmentTab "Enrich Sheet" feature.

async function lookupByPhone(apiKey: string, slug: string, phone: string) {
  const clean = phone.replace(/\D/g, '');
  if (clean.length < 10) return null;
  try {
    const r = await fetch('https://app.retargetiq.com/api/v2/GetDataByPhone', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: apiKey, website: slug, phone: clean }),
    });
    if (!r.ok) return null;
    const d = await r.json();
    if (d.success && d.data?.identities?.length) return d.data;
  } catch (_) { /* swallow */ }
  return null;
}

async function lookupByEmail(apiKey: string, slug: string, email: string) {
  if (!email.includes('@')) return null;
  try {
    const r = await fetch('https://app.retargetiq.com/api/v2/GetDataByEmail', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: apiKey, website: slug, email }),
    });
    if (!r.ok) return null;
    const d = await r.json();
    if (d.success && d.data?.identities?.length) return d.data;
  } catch (_) { /* swallow */ }
  return null;
}

function flatten(identity: any) {
  if (!identity) return {};
  return {
    matched_first_name: identity.firstName || identity.first_name || null,
    matched_last_name: identity.lastName || identity.last_name || null,
    matched_email: identity.email || null,
    matched_phone: identity.phone || identity.phoneNumber || null,
    address: identity.address || null,
    city: identity.city || null,
    state: identity.state || null,
    zip: identity.zip || identity.postalCode || null,
    age: identity.age || null,
    gender: identity.gender || null,
    income: identity.income || identity.householdIncome || null,
    net_worth: identity.netWorth || identity.net_worth || null,
    credit_range: identity.creditRange || identity.credit_range || null,
    home_owner: identity.homeOwner ?? identity.home_owner ?? null,
    home_value: identity.homeValue || identity.home_value || null,
    accredited_investor: identity.accreditedInvestor ?? identity.accredited_investor ?? null,
    investor_type: identity.investorType || identity.investor_type || null,
    company: identity.companyName || identity.company || null,
    title: identity.title || identity.jobTitle || null,
    industry: identity.industry || null,
    linkedin: identity.linkedin || identity.linkedinUrl || null,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const { client_id, email, phone } = body || {};
    if (!client_id) {
      return new Response(JSON.stringify({ error: 'client_id required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (!email && !phone) {
      return new Response(JSON.stringify({ matched: false, reason: 'no_contact' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const apiKey = Deno.env.get('RETARGETIQ_API_KEY');
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'RETARGETIQ_API_KEY missing' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    const { data: cs } = await supabase
      .from('client_settings')
      .select('retargetiq_website_slug')
      .eq('client_id', client_id)
      .maybeSingle();
    const slug = cs?.retargetiq_website_slug;
    if (!slug) {
      return new Response(JSON.stringify({ error: 'client missing retargetiq_website_slug' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let result = phone ? await lookupByPhone(apiKey, slug, phone) : null;
    let method = 'phone';
    if (!result && email) { result = await lookupByEmail(apiKey, slug, email); method = 'email'; }

    if (!result) {
      return new Response(JSON.stringify({ matched: false }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const flat = flatten(result.identities[0]);
    return new Response(JSON.stringify({
      matched: true,
      method,
      identity_count: result.identities.length,
      ...flat,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});