import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const BATCH = 25;

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

    // Get next batch of candidate leads not enriched within 30 days
    const cutoff = new Date(Date.now() - 30 * 86400_000).toISOString();
    const { data: enrichedRecent } = await supabase
      .from('lead_enrichment')
      .select('external_id')
      .eq('client_id', job.client_id)
      .gte('last_enriched_at', cutoff)
      .limit(50000);
    const recentSet = new Set((enrichedRecent || []).map((r: any) => r.external_id));

    const { data: leads } = await supabase
      .from('leads')
      .select('id, external_id, name, email, phone')
      .eq('client_id', job.client_id)
      .not('external_id', 'is', null)
      .order('created_at', { ascending: true })
      .range(job.last_offset, job.last_offset + BATCH * 4 - 1);

    const candidates = (leads || []).filter(l => !recentSet.has(l.external_id)).slice(0, BATCH);

    if (!leads || leads.length === 0) {
      await supabase.from('enrichment_jobs').update({
        status: 'completed', finished_at: new Date().toISOString(),
      }).eq('id', job.id);
      return new Response(JSON.stringify({ success: true, completed: true, job_id: job.id }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let ok = 0, fail = 0;
    for (const lead of candidates) {
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

    const newOffset = job.last_offset + leads.length;
    const newProcessed = job.processed + candidates.length;
    const newSucceeded = job.succeeded + ok;
    const newFailed = job.failed + fail;
    const done = leads.length < BATCH * 4 && candidates.length < BATCH;

    await supabase.from('enrichment_jobs').update({
      last_offset: newOffset,
      processed: newProcessed,
      succeeded: newSucceeded,
      failed: newFailed,
      status: done ? 'completed' : 'running',
      finished_at: done ? new Date().toISOString() : null,
    }).eq('id', job.id);

    return new Response(JSON.stringify({
      success: true, job_id: job.id, batch_processed: candidates.length, ok, fail, done,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});