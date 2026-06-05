import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Sweeps every client that has RetargetIQ auto-enrich ON + slug set + GHL creds,
// and runs a bounded batch of bulk-enrich for each. Designed to be called by
// pg_cron on a short interval and/or from the UI ("Run Auto-Enrich Now").
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    const perClient: number = Math.min(Math.max(Number(body.per_client) || 50, 1), 200);
    const newOnly: boolean = body.new_only === true;
    const sinceHours: number = Math.max(Number(body.since_hours) || 24, 1);
    const requireOptIn: boolean = body.require_opt_in === true; // legacy mode
    const refreshDays: number = Math.max(Number(body.refresh_days) || 30, 1);

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
      return new Response(JSON.stringify({ success: true, message: 'No eligible clients', clients: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: clients } = await supabase
      .from('clients')
      .select('id, name, ghl_api_key, ghl_location_id, status')
      .in('id', ids)
      .in('status', ['active', 'onboarding', 'paused']);

    const eligible = (clients || []).filter(c => c.ghl_api_key && c.ghl_location_id);
    console.log(`[AUTO-ENRICH-ALL] ${eligible.length} eligible clients (perClient=${perClient})`);

    const results: any[] = [];
    for (const c of eligible) {
      const runStartedAt = Date.now();
      let succeeded = 0, failed = 0, skippedRecent = 0;
      try {
        let leads: any[] = [];
        // Default behavior: enrich anything not enriched in `refresh_days` window
        if (newOnly) {
          // Daily mode: only consider leads created within the last `sinceHours`
          const sinceIso = new Date(Date.now() - sinceHours * 3600_000).toISOString();
          const { data: enrichedRows } = await supabase
            .from('lead_enrichment').select('external_id').eq('client_id', c.id).limit(100000);
          const enriched = new Set((enrichedRows || []).map(e => e.external_id));
          const { data: leadRows } = await supabase
            .from('leads')
            .select('id, external_id, name, email, phone, created_at')
            .eq('client_id', c.id)
            .gte('created_at', sinceIso)
            .order('created_at', { ascending: false })
            .limit(perClient * 2);
          leads = (leadRows || []).filter(l => l.external_id && !enriched.has(l.external_id)).slice(0, perClient);
        } else {
          // V2 behavior: pull leads where last_enriched_at is null OR older than `refresh_days`
          const cutoff = new Date(Date.now() - refreshDays * 86400_000).toISOString();
          const { data: recentRows } = await supabase
            .from('lead_enrichment')
            .select('external_id, last_enriched_at')
            .eq('client_id', c.id)
            .gte('last_enriched_at', cutoff)
            .limit(100000);
          const skipSet = new Set((recentRows || []).map((e: any) => e.external_id));
          const { data: leadRows } = await supabase
            .from('leads')
            .select('id, external_id, name, email, phone')
            .eq('client_id', c.id)
            .not('external_id', 'is', null)
            .order('created_at', { ascending: false })
            .limit(perClient * 6);
          const allRows = leadRows || [];
          skippedRecent = allRows.filter(l => skipSet.has(l.external_id)).length;
          leads = allRows.filter(l => !skipSet.has(l.external_id)).slice(0, perClient);
        }

        if (leads.length === 0) {
          results.push({ client: c.name, processed: 0, succeeded: 0, failed: 0 });
          continue;
        }

        let ok = 0, fail = 0;
        for (const lead of leads) {
          try {
            const nameParts = (lead.name || '').split(' ');
            const res = await fetch(`${supabaseUrl}/functions/v1/enrich-lead-retargetiq`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${serviceKey}` },
              body: JSON.stringify({
                client_id: c.id,
                lead_id: lead.id,
                external_id: lead.external_id,
                phone: lead.phone || undefined,
                email: lead.email || undefined,
                first_name: nameParts[0] || undefined,
                last_name: nameParts.slice(1).join(' ') || undefined,
              }),
            });
            const data = await res.json().catch(() => ({}));
            if (data?.success) ok++; else fail++;
          } catch (e) { fail++; console.error('[AUTO-ENRICH-ALL] lead error', e); }
          await new Promise(r => setTimeout(r, 1200));
        }
        succeeded = ok; failed = fail;
        results.push({ client: c.name, processed: leads.length, succeeded: ok, failed: fail, skipped_recent: skippedRecent });
        console.log(`[AUTO-ENRICH-ALL] ${c.name}: ${ok}/${leads.length} enriched`);
      } catch (e) {
        console.error(`[AUTO-ENRICH-ALL] ${c.name} failed:`, e);
        results.push({ client: c.name, error: String((e as Error).message || e) });
      }
      // Log run
      try {
        await supabase.from('enrichment_run_log').insert({
          client_id: c.id,
          processed: succeeded + failed,
          succeeded,
          failed,
          skipped_recent: skippedRecent,
          duration_ms: Date.now() - runStartedAt,
        });
      } catch (logErr) { console.error('[AUTO-ENRICH-ALL] run log failed', logErr); }
    }

    const totals = results.reduce((a, r) => ({
      processed: a.processed + (r.processed || 0),
      succeeded: a.succeeded + (r.succeeded || 0),
      failed: a.failed + (r.failed || 0),
    }), { processed: 0, succeeded: 0, failed: 0 });

    return new Response(JSON.stringify({ success: true, clients: eligible.length, totals, results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[AUTO-ENRICH-ALL] Error:', err);
    return new Response(JSON.stringify({ success: false, error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});