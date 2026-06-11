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

async function invokeAgent(agentId: string) {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/run-agent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SERVICE_KEY}`,
      apikey: SERVICE_KEY,
    },
    body: JSON.stringify({ agent_id: agentId }),
  });
  return { ok: r.ok, status: r.status };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
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
      const res = await invokeAgent(a.id as string);
      dispatched.push({ id: a.id, name: a.name, cron: a.schedule_cron, ...res });
    }
    return new Response(JSON.stringify({ ok: true, checked: agents?.length || 0, dispatched }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});