import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Sweeps every client that has RetargetIQ auto-enrich ON + slug set + GHL creds,
// and inserts one enrichment_jobs row per client.
// The heavy lifting (API calls, dedup via SQL anti-join) is done by
// bulk-enrich-account-worker, which is called by a separate cron.
// This function is intentionally lightweight: it just enqueues, then returns.
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    const requireOptIn: boolean = body.require_opt_in === true; // legacy mode

    const supabaseUrl = Deno.env.get('ORIGINAL_SUPABASE_URL') || Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('ORIGINAL_SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // Find eligible clients
    let settingsQuery = supabase
      .from('client_settings')
      .select('client_id, retargetiq_website_slug, retargetiq_auto_enrich')
      .not('retargetiq_website_slug', 'is', null);
    if (requireOptIn) settingsQuery = settingsQuery.eq('retargetiq_auto_enrich', true);
    const { data: settings, error: sErr } = await settingsQuery;
    if (sErr) throw sErr;

    const ids = (settings || [])
      .filter(s => requireOptIn ? true : (s as any).retargetiq_auto_enrich !== false)
      .map(s => (s as any).client_id);

    if (ids.length === 0) {
      return new Response(JSON.stringify({ success: true, message: 'No eligible clients', enqueued: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: clients } = await supabase
      .from('clients')
      .select('id, name, ghl_api_key, ghl_location_id, status')
      .in('id', ids)
      .in('status', ['active', 'onboarding', 'paused']);

    const eligible = (clients || []).filter(c => c.ghl_api_key && c.ghl_location_id);
    console.log(`[AUTO-ENRICH-ALL] ${eligible.length} eligible clients — enqueueing enrichment_jobs`);

    // For each eligible client, insert an enrichment_jobs row (if not already pending/running).
    // We skip clients that already have a pending/running job to avoid double-queueing.
    const { data: activeJobs } = await supabase
      .from('enrichment_jobs')
      .select('client_id')
      .in('status', ['pending', 'running'])
      .in('client_id', eligible.map(c => c.id));

    const alreadyQueued = new Set((activeJobs || []).map((j: any) => j.client_id));

    const toEnqueue = eligible.filter(c => !alreadyQueued.has(c.id));

    let enqueued = 0;
    const skipped = eligible.length - toEnqueue.length;
    for (const c of toEnqueue) {
      const { error: insertErr } = await supabase.from('enrichment_jobs').insert({
        client_id: c.id,
        status: 'pending',
        processed: 0,
        succeeded: 0,
        failed: 0,
        last_offset: 0,
      });
      if (insertErr) {
        console.error(`[AUTO-ENRICH-ALL] Failed to enqueue ${c.name}:`, insertErr.message);
      } else {
        enqueued++;
        console.log(`[AUTO-ENRICH-ALL] Enqueued ${c.name}`);
      }
    }

    return new Response(JSON.stringify({
      success: true,
      eligible: eligible.length,
      enqueued,
      skipped_already_queued: skipped,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[AUTO-ENRICH-ALL] Error:', err);
    return new Response(JSON.stringify({ success: false, error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
