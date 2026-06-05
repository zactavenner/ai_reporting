import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Computes health alerts for enrichment system.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  try {
    const supabase = createClient(
      Deno.env.get('ORIGINAL_SUPABASE_URL') || Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('ORIGINAL_SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data: clients } = await supabase
      .from('clients')
      .select('id, name, ghl_api_key, ghl_location_id, status')
      .in('status', ['active', 'onboarding', 'paused']);

    const { data: cov } = await supabase.from('v_client_enrichment_coverage').select('*');
    const covMap = new Map<string, any>((cov || []).map((r: any) => [r.client_id, r]));

    const { data: recentRuns } = await supabase
      .from('enrichment_run_log')
      .select('client_id, succeeded, failed, created_at')
      .gte('created_at', new Date(Date.now() - 86400_000).toISOString());
    const runStats = new Map<string, { ok: number; fail: number; count: number }>();
    for (const r of (recentRuns || [])) {
      const s = runStats.get((r as any).client_id) || { ok: 0, fail: 0, count: 0 };
      s.ok += (r as any).succeeded || 0;
      s.fail += (r as any).failed || 0;
      s.count += 1;
      runStats.set((r as any).client_id, s);
    }

    const alerts: any[] = [];
    for (const c of (clients || [])) {
      if (!c.ghl_api_key) {
        alerts.push({ client_id: c.id, type: 'ghl_disconnected', severity: 'error', message: 'GHL not connected' });
        continue;
      }
      const stats = runStats.get(c.id);
      const coverage = covMap.get(c.id);
      if (!stats || stats.count === 0) {
        if (coverage?.total_contacts > 0) {
          alerts.push({ client_id: c.id, type: 'no_runs_24h', severity: 'warning', message: 'No enrichments in last 24h' });
        }
      } else {
        const total = stats.ok + stats.fail;
        const successRate = total > 0 ? stats.ok / total : 0;
        if (total >= 20 && successRate < 0.5) {
          alerts.push({ client_id: c.id, type: 'low_success', severity: 'warning', message: `Success rate ${Math.round(successRate * 100)}% (last 24h)` });
        }
        if (stats.fail > 100 && stats.fail > stats.ok * 2) {
          alerts.push({ client_id: c.id, type: 'api_error_spike', severity: 'error', message: `${stats.fail} failed enrichments in 24h` });
        }
      }
    }

    // Mark old alerts resolved
    await supabase
      .from('enrichment_alerts')
      .update({ resolved_at: new Date().toISOString() })
      .is('resolved_at', null)
      .lt('created_at', new Date(Date.now() - 6 * 3600_000).toISOString());

    if (alerts.length > 0) {
      await supabase.from('enrichment_alerts').insert(alerts);
    }

    return new Response(JSON.stringify({ success: true, alerts_created: alerts.length }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});