import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const BATCH = 25;
// A job is done when the anti-join query returns fewer rows than BATCH
// (meaning no more unenriched leads remain beyond the current cutoff window).
const REFRESH_DAYS = 30;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  try {
    const supabaseUrl = Deno.env.get('ORIGINAL_SUPABASE_URL') || Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('ORIGINAL_SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // Pick the oldest pending/running job
    const { data: job } = await supabase
      .from('enrichment_jobs')
      .select('*')
      .in('status', ['pending', 'running'])
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (!job) {
      return new Response(JSON.stringify({ success: true, idle: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    await supabase.from('enrichment_jobs').update({ status: 'running' }).eq('id', job.id);

    // SQL anti-join: leads that have NO recent enrichment entry (last_enriched_at within REFRESH_DAYS).
    // This is O(index) and never burns credits on already-enriched leads.
    const cutoff = new Date(Date.now() - REFRESH_DAYS * 86400_000).toISOString();
    const { data: candidates, error: candidateErr } = await supabase.rpc(
      'get_unenriched_leads',
      { p_client_id: job.client_id, p_cutoff: cutoff, p_limit: BATCH },
    );

    // Fallback if RPC doesn't exist: direct anti-join via JS (still better than in-memory set)
    let leads: any[] = [];
    if (candidateErr) {
      console.warn('[WORKER] RPC not available, falling back to JS anti-join:', candidateErr.message);
      const { data: recentRows } = await supabase
        .from('lead_enrichment')
        .select('external_id')
        .eq('client_id', job.client_id)
        .gte('last_enriched_at', cutoff);
      const recentSet = new Set((recentRows || []).map((r: any) => r.external_id));

      const { data: allLeads } = await supabase
        .from('leads')
        .select('id, external_id, name, email, phone')
        .eq('client_id', job.client_id)
        .not('external_id', 'is', null)
        .order('created_at', { ascending: false })
        .limit(BATCH * 8);
      leads = (allLeads || []).filter(l => !recentSet.has(l.external_id)).slice(0, BATCH);
    } else {
      leads = candidates || [];
    }

    // Terminal condition: no more unenriched candidates → job is complete.
    if (leads.length === 0) {
      await supabase.from('enrichment_jobs').update({
        status: 'completed',
        finished_at: new Date().toISOString(),
      }).eq('id', job.id);
      console.log(`[WORKER] Job ${job.id} completed — no unenriched leads remaining`);
      return new Response(JSON.stringify({ success: true, completed: true, job_id: job.id }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let ok = 0, fail = 0;
    for (const lead of leads) {
      try {
        const nameParts = (lead.name || '').split(' ');
        const res = await fetch(`${supabaseUrl}/functions/v1/enrich-lead-retargetiq`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${serviceKey}` },
          body: JSON.stringify({
            client_id: job.client_id,
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
      } catch { fail++; }
      await new Promise(r => setTimeout(r, 800));
    }

    const newProcessed = job.processed + leads.length;
    const newSucceeded = job.succeeded + ok;
    const newFailed = job.failed + fail;
    // If the anti-join returned a full BATCH, there may be more unenriched leads.
    // If fewer than BATCH returned, we've drained the queue.
    const done = leads.length < BATCH;

    await supabase.from('enrichment_jobs').update({
      processed: newProcessed,
      succeeded: newSucceeded,
      failed: newFailed,
      status: done ? 'completed' : 'running',
      finished_at: done ? new Date().toISOString() : null,
    }).eq('id', job.id);

    console.log(`[WORKER] Job ${job.id}: batch=${leads.length} ok=${ok} fail=${fail} done=${done}`);

    return new Response(JSON.stringify({
      success: true, job_id: job.id, batch_processed: leads.length, ok, fail, done,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
