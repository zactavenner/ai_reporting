// Returns OpenRouter usage stats: account total spend & credits, plus per-day breakdown
// derived from `agent_runs.cost_usd` for the requested window. Used by the global Team Report.
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY") || "";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const url = new URL(req.url);
    const days = Math.max(1, Math.min(365, Number(url.searchParams.get("days") || 30)));
    const since = new Date(Date.now() - days * 86400_000).toISOString();

    // Real OpenRouter account totals
    let real: { total_usage?: number; total_credits?: number; limit?: number | null; error?: string } = {};
    if (OPENROUTER_API_KEY) {
      try {
        const r = await fetch("https://openrouter.ai/api/v1/credits", {
          headers: { Authorization: `Bearer ${OPENROUTER_API_KEY}` },
        });
        if (r.ok) {
          const j = await r.json();
          // /credits => { data: { total_credits, total_usage } }
          real.total_usage = Number(j?.data?.total_usage ?? 0);
          real.total_credits = Number(j?.data?.total_credits ?? 0);
        } else {
          real.error = `HTTP ${r.status}`;
        }
      } catch (e) {
        real.error = (e as Error).message;
      }
    } else {
      real.error = "OPENROUTER_API_KEY missing";
    }

    // Estimated cost from internal runs (window)
    const supa = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: runs = [] } = await supa
      .from("agent_runs")
      .select("started_at,cost_usd,tokens_used,input_tokens,output_tokens,status,agent_id")
      .gte("started_at", since)
      .limit(20000);

    let estCost = 0;
    let tokens = 0;
    for (const r of runs ?? []) {
      estCost += Number(r.cost_usd || 0);
      tokens += Number(r.tokens_used || 0);
    }

    return new Response(
      JSON.stringify({
        ok: true,
        window_days: days,
        real,
        estimated: { cost_usd: estCost, tokens, runs: runs?.length ?? 0 },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});