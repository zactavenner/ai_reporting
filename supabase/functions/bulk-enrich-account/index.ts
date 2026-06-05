import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Creates (or returns) a resumable enrichment job for an entire client account.
// A separate worker function ticks through batches until completion.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  try {
    const { client_id, resume } = await req.json();
    if (!client_id) throw new Error('client_id required');

    const supabase = createClient(
      Deno.env.get('ORIGINAL_SUPABASE_URL') || Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('ORIGINAL_SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // Resume existing pending/running job if present
    const { data: existing } = await supabase
      .from('enrichment_jobs')
      .select('*')
      .eq('client_id', client_id)
      .in('status', ['pending', 'running', 'paused'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existing && !resume) {
      return new Response(JSON.stringify({ success: true, job: existing, resumed: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Count total candidates (unenriched OR last enriched >30d ago)
    const { count: leadTotal } = await supabase
      .from('leads')
      .select('id', { count: 'exact', head: true })
      .eq('client_id', client_id)
      .not('external_id', 'is', null);

    const { data: job, error } = await supabase
      .from('enrichment_jobs')
      .insert({
        client_id,
        status: 'pending',
        total: leadTotal || 0,
        processed: 0,
        succeeded: 0,
        failed: 0,
        last_offset: 0,
        started_at: new Date().toISOString(),
      })
      .select()
      .single();
    if (error) throw error;

    return new Response(JSON.stringify({ success: true, job }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});