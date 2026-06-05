import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { client_id, limit, offset, since_hours } = await req.json();
    if (!client_id) throw new Error('client_id required');

    const supabaseUrl = Deno.env.get('ORIGINAL_SUPABASE_URL') || Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('ORIGINAL_SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // Get all leads for this client that haven't been enriched yet
    const batchLimit = limit || 50;
    const batchOffset = offset || 0;

    // Get leads
    let query = supabase
      .from('leads')
      .select('id, external_id, name, email, phone')
      .eq('client_id', client_id);
    if (since_hours && Number(since_hours) > 0) {
      const sinceIso = new Date(Date.now() - Number(since_hours) * 3600_000).toISOString();
      query = query.gte('created_at', sinceIso).order('created_at', { ascending: false });
    } else {
      query = query.order('created_at', { ascending: true });
    }
    const { data: leads, error: leadsErr } = await query
      .range(batchOffset, batchOffset + batchLimit - 1);

    if (leadsErr) throw leadsErr;
    if (!leads || leads.length === 0) {
      return new Response(JSON.stringify({ success: true, message: 'No leads to enrich', processed: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Check which ones already have enrichment
    const externalIds = leads.map(l => l.external_id);
    const { data: existing } = await supabase
      .from('lead_enrichment')
      .select('external_id')
      .eq('client_id', client_id)
      .in('external_id', externalIds);

    const enrichedSet = new Set((existing || []).map(e => e.external_id));
    const toEnrich = leads.filter(l => !enrichedSet.has(l.external_id));

    console.log(`[BULK-ENRICH] ${leads.length} leads fetched, ${toEnrich.length} need enrichment (offset=${batchOffset})`);

    let successCount = 0;
    let errorCount = 0;
    const results: any[] = [];

    for (const lead of toEnrich) {
      try {
        const nameParts = (lead.name || '').split(' ');
        console.log(`[BULK-ENRICH] Enriching ${lead.name || lead.external_id}...`);
        
        const res = await fetch(`${supabaseUrl}/functions/v1/enrich-lead-retargetiq`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${serviceKey}`,
          },
          body: JSON.stringify({
            client_id,
            lead_id: lead.id,
            external_id: lead.external_id,
            phone: lead.phone || undefined,
            email: lead.email || undefined,
            first_name: nameParts[0] || undefined,
            last_name: nameParts.slice(1).join(' ') || undefined,
          }),
        });

        const data = await res.json();
        if (data.success) {
          successCount++;
          results.push({ name: lead.name, external_id: lead.external_id, status: 'enriched' });
        } else {
          errorCount++;
          results.push({ name: lead.name, external_id: lead.external_id, status: 'failed', error: data.error });
        }
      } catch (e) {
        errorCount++;
        results.push({ name: lead.name, external_id: lead.external_id, status: 'error', error: e.message });
      }

      // Small delay between enrichments to avoid rate limits
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    return new Response(JSON.stringify({
      success: true,
      total_leads: leads.length,
      already_enriched: enrichedSet.size,
      processed: toEnrich.length,
      succeeded: successCount,
      failed: errorCount,
      has_more: leads.length === batchLimit,
      next_offset: batchOffset + batchLimit,
      results,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('[BULK-ENRICH] Error:', err);
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
