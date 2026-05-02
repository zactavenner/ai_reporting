import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Per-client snapshot of queue depth, last sync timestamps, and 24h success rate.
// Designed to be called every 15 min by pg_cron, or on demand from the dashboard.

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceKey);

  try {
    const { data: clients, error: cErr } = await supabase
      .from("clients")
      .select("id, name")
      .in("status", ["active", "onboarding"]);
    if (cErr) throw cErr;

    const since24h = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const inserted: string[] = [];

    for (const c of clients ?? []) {
      const [pending, processing, failed, dead, completed24h, failed24h, lastWebhook] = await Promise.all([
        supabase.from("sync_queue").select("id", { count: "exact", head: true })
          .eq("client_id", c.id).eq("status", "pending").eq("dead_letter", false),
        supabase.from("sync_queue").select("id", { count: "exact", head: true })
          .eq("client_id", c.id).eq("status", "processing"),
        supabase.from("sync_queue").select("id", { count: "exact", head: true })
          .eq("client_id", c.id).in("status", ["failed", "retrying"]).eq("dead_letter", false),
        supabase.from("sync_queue").select("id", { count: "exact", head: true })
          .eq("client_id", c.id).eq("dead_letter", true),
        supabase.from("sync_queue").select("id", { count: "exact", head: true })
          .eq("client_id", c.id).eq("status", "completed").gte("completed_at", since24h),
        supabase.from("sync_queue").select("id", { count: "exact", head: true })
          .eq("client_id", c.id).eq("status", "failed").gte("completed_at", since24h),
        supabase.from("webhook_events").select("created_at")
          .eq("client_id", c.id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
      ]);

      const ok = completed24h.count ?? 0;
      const bad = failed24h.count ?? 0;
      const total = ok + bad;
      const success_rate_24h = total > 0 ? Number(((ok / total) * 100).toFixed(2)) : null;

      const { error: insErr } = await supabase.from("sync_health_snapshots").insert({
        client_id: c.id,
        queue_pending: pending.count ?? 0,
        queue_processing: processing.count ?? 0,
        queue_failed: failed.count ?? 0,
        queue_dead_letter: dead.count ?? 0,
        success_rate_24h,
        last_webhook_at: (lastWebhook.data as any)?.created_at ?? null,
      });
      if (!insErr) inserted.push(c.id);
    }

    return new Response(JSON.stringify({ ok: true, snapshots: inserted.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    console.error("[sync-queue-snapshot]", msg);
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});