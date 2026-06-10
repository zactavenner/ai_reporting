import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const PASSWORD = 'HPA1234$';

function getCloudUrl() { return Deno.env.get('SUPABASE_URL')!; }
function getCloudKey() { return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!; }
function getProdDb() {
  const url = Deno.env.get('ORIGINAL_SUPABASE_URL') || getCloudUrl();
  const key = Deno.env.get('ORIGINAL_SUPABASE_SERVICE_ROLE_KEY') || getCloudKey();
  return createClient(url, key);
}

async function callFunction(name: string, payload: any, cloudUrl: string, anonKey: string) {
  const resp = await fetch(`${cloudUrl}/functions/v1/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${anonKey}` },
    body: JSON.stringify(payload),
  });
  return { ok: resp.ok, status: resp.status, data: await resp.json().catch(() => ({})) };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const body = await req.json();
    if (body.password !== PASSWORD) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { client_id, offer_id, run_id, company_name, offer_description, client_data, ad_image_urls, avatar_image_url } = body;
    if (!client_id || !run_id) throw new Error('client_id and run_id required');

    const prodDb = getProdDb();
    const cloudUrl = getCloudUrl();
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || '';

    console.log(`[fulfill-browser] Starting browser tasks for ${company_name} (run: ${run_id})`);

    await prodDb.from('fulfillment_runs').update({ current_phase: 'browser_tasks' }).eq('id', run_id);

    // Define browser tasks
    const browserTasks = [
      { type: 'ghl_create_subaccount', group: 'ghl', priority: 1, input: { company_name, ...client_data } },
      { type: 'ghl_buy_phone', group: 'ghl', priority: 2, input: { company_name } },
      { type: 'ghl_submit_a2p', group: 'ghl', priority: 3, input: { company_name } },
      { type: 'ghl_clone_workflows', group: 'ghl', priority: 4, input: { company_name, offer_description } },
      { type: 'ghl_setup_calendar', group: 'ghl', priority: 5, input: { company_name, calendar_name: '15-Min Investor Discovery Call' } },
      { type: 'ghl_build_funnel', group: 'ghl', priority: 6, input: { company_name, offer_description } },
      { type: 'meta_create_campaign', group: 'meta', priority: 7, input: { company_name, offer_description } },
      { type: 'meta_upload_creatives', group: 'meta', priority: 8, input: { company_name, ad_image_urls: ad_image_urls || [] } },
      { type: 'meta_create_lead_form', group: 'meta', priority: 9, input: { company_name } },
      { type: 'meta_install_pixel', group: 'meta', priority: 10, input: { company_name } },
      { type: 'meta_connect_crm', group: 'meta', priority: 11, input: { company_name } },
    ];

    let sortOrder = 70;
    for (const task of browserTasks) {
      // Create fulfillment step
      const { data: step } = await prodDb.from('fulfillment_steps').insert({
        run_id, phase: 'browser_tasks', step_name: task.type.replace(/_/g, ' '),
        step_type: 'browser_task', sort_order: sortOrder++,
        function_name: task.type, status: 'pending',
      }).select('id').single();

      // Create browser task
      await prodDb.from('browser_tasks').insert({
        fulfillment_run_id: run_id,
        fulfillment_step_id: step?.id,
        client_id, offer_id: offer_id || null,
        task_type: task.type, task_group: task.group,
        priority: task.priority, status: 'queued',
        input_data: task.input,
      });
    }

    console.log(`[fulfill-browser] Created ${browserTasks.length} browser tasks`);

    // ─── PHASE 8: Mark ready for review ───
    await prodDb.from('fulfillment_runs').update({
      current_phase: 'review',
      status: 'completed',
      completed_at: new Date().toISOString(),
    }).eq('id', run_id);

    // Calculate duration
    const { data: runData } = await prodDb.from('fulfillment_runs').select('started_at').eq('id', run_id).single();
    const startedAt = runData?.started_at ? new Date(runData.started_at) : null;
    const durationMin = startedAt ? Math.round((Date.now() - startedAt.getTime()) / 60000) : 0;

    await callFunction('slack-notify', {
      message: `🎉 *${company_name}* fulfillment complete in ${durationMin} minutes! Browser tasks queued (${browserTasks.length}). Review ready.`,
    }, cloudUrl, anonKey).catch(() => {});

    return new Response(JSON.stringify({
      success: true, run_id,
      browser_tasks_created: browserTasks.length,
      message: 'All phases complete. Browser tasks queued for MCP pickup.',
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (err) {
    console.error('[fulfill-browser] Fatal error:', err);
    return new Response(JSON.stringify({ error: 'Internal server error', details: String(err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
