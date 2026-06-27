// Scheduled agent dispatcher.
// Wired up via pg_cron to invoke `run-agent` for any enabled agent whose
// schedule_cron expression is due. Supports the cron forms used in this
// project's agent templates:
//   - "*/N * * * *"     every N minutes
//   - "M * * * *"       at minute M every hour
//   - "M H * * *"       once daily at HH:MM (UTC)
//   - "M H * * D"       weekly on day D at HH:MM
// Anything more exotic falls back to "run if last_run_at older than 60 min".
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supa = createClient(SUPABASE_URL, SERVICE_KEY);

function isDue(cron: string, lastRunAt: string | null): boolean {
  const parts = (cron || "").trim().split(/\s+/);
  if (parts.length !== 5) return ageMinutes(lastRunAt) >= 60;
  const [minP, hourP, , , dowP] = parts;
  const now = new Date();
  const minNow = now.getUTCMinutes();
  const hourNow = now.getUTCHours();
  const dowNow = now.getUTCDay();
  const age = ageMinutes(lastRunAt);

  // every-N-minutes form
  const everyN = /^\*\/(\d+)$/.exec(minP);
  if (everyN && hourP === "*" && dowP === "*") {
    return age >= Number(everyN[1]);
  }
  // explicit minute M, hour wildcard => hourly at minute M
  if (/^\d+$/.test(minP) && hourP === "*") {
    const targetMin = Number(minP);
    return minNow >= targetMin && age >= 55;
  }
  // daily at H:M
  if (/^\d+$/.test(minP) && /^\d+$/.test(hourP) && dowP === "*") {
    const targetMin = Number(minP);
    const targetHour = Number(hourP);
    const reached = hourNow > targetHour || (hourNow === targetHour && minNow >= targetMin);
    return reached && age >= 60 * 12; // once per ~12h+
  }
  // weekly on day D at H:M
  if (/^\d+$/.test(minP) && /^\d+$/.test(hourP) && /^\d+$/.test(dowP)) {
    const targetMin = Number(minP);
    const targetHour = Number(hourP);
    const targetDow = Number(dowP);
    const reached = dowNow === targetDow && (hourNow > targetHour || (hourNow === targetHour && minNow >= targetMin));
    return reached && age >= 60 * 24 * 6;
  }
  return age >= 60;
}
function ageMinutes(iso: string | null) {
  if (!iso) return Infinity;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
}

async function invokeAgent(agentId: string, agentName: string) {
  const startedAt = Date.now();
  let status = 0;
  let errorMessage: string | null = null;
  try {
    const r = await fetch(`${SUPABASE_URL}/functions/v1/run-agent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SERVICE_KEY}`,
        apikey: SERVICE_KEY,
      },
      body: JSON.stringify({ agent_id: agentId }),
    });
    status = r.status;
    if (!r.ok) {
      try { errorMessage = (await r.text()).slice(0, 500); } catch {}
    }
    // Per-fire audit row in cron_run_log
    await supa.rpc("log_cron_run", {
      p_job_name: `run-agent:${agentName}`,
      p_status: r.ok ? "success" : "failed",
      p_status_code: status,
      p_response_body: null,
      p_error_message: errorMessage,
      p_duration_ms: Date.now() - startedAt,
    });
    return { ok: r.ok, status };
  } catch (e) {
    errorMessage = e instanceof Error ? e.message : String(e);
    await supa.rpc("log_cron_run", {
      p_job_name: `run-agent:${agentName}`,
      p_status: "failed",
      p_status_code: 0,
      p_response_body: null,
      p_error_message: errorMessage,
      p_duration_ms: Date.now() - startedAt,
    });
    return { ok: false, status: 0, error: errorMessage };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const sweepStart = Date.now();
  try {
    const { data: agents, error } = await supa
      .from("agents")
      .select("id, name, schedule_cron, last_run_at, enabled, consecutive_failures")
      .eq("enabled", true)
      .not("schedule_cron", "is", null);
    if (error) throw error;

    const dispatched: any[] = [];
    for (const a of agents || []) {
      if ((a.consecutive_failures || 0) >= 3) continue;
      if (!isDue(a.schedule_cron as string, a.last_run_at as string | null)) continue;
      const res = await invokeAgent(a.id as string, (a.name as string) || a.id);
      dispatched.push({ id: a.id, name: a.name, cron: a.schedule_cron, ...res });
    }
    // Sweep-level log so we can confirm the cron itself is firing.
    await supa.rpc("log_cron_run", {
      p_job_name: "dispatch-scheduled-agents",
      p_status: "success",
      p_status_code: 200,
      p_response_body: JSON.stringify({ checked: agents?.length || 0, dispatched: dispatched.length }),
      p_error_message: null,
      p_duration_ms: Date.now() - sweepStart,
    });
    return new Response(JSON.stringify({ ok: true, checked: agents?.length || 0, dispatched }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    await supa.rpc("log_cron_run", {
      p_job_name: "dispatch-scheduled-agents",
      p_status: "failed",
      p_status_code: 500,
      p_response_body: null,
      p_error_message: e instanceof Error ? e.message : String(e),
      p_duration_ms: Date.now() - sweepStart,
    });
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});