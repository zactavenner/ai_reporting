// Server-side H3 provider status + polling.
//
// Hard rules:
// - Never submits or re-submits a job. Poll only, by existing external job ID.
// - Requires a configured server-side secret (MINIMAX_API_KEY). If absent we
//   return an honest disconnected status instead of inventing a result.
// - Idempotent: a pending provider job is left exactly as-is.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PROVIDER_LABEL = "OpenRouter / MiniMax Hailuo 3";
const NOT_CONFIGURED =
  "Connection required to resume polling — no server-side MiniMax provider credential is configured. Add MINIMAX_API_KEY in Project Settings → Secrets.";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action ?? "status");
    const apiKey = Deno.env.get("MINIMAX_API_KEY");

    if (action === "status") {
      return json({
        connected: !!apiKey,
        provider: PROVIDER_LABEL,
        reason: apiKey ? "Provider credential configured." : NOT_CONFIGURED,
      });
    }

    if (action !== "poll") return json({ error: "Unknown action" }, 400);

    if (!apiKey) {
      return json({ connected: false, provider: PROVIDER_LABEL, reason: NOT_CONFIGURED }, 200);
    }

    const creativeIds: string[] = Array.isArray(body?.creativeIds) ? body.creativeIds : [];
    if (!creativeIds.length) return json({ error: "creativeIds required" }, 400);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: rows, error } = await admin
      .from("h3_creatives")
      .select("id, external_job_id, provider_status, workflow_state")
      .in("id", creativeIds);
    if (error) return json({ error: error.message }, 500);

    const results: Record<string, string> = {};

    for (const row of rows ?? []) {
      if (!row.external_job_id) { results[row.id] = "no_external_job_id"; continue; }
      if (!["submitted", "rendering"].includes(row.workflow_state)) {
        results[row.id] = "not_provider_owned";
        continue;
      }

      let providerStatus = row.provider_status;
      let providerError: string | null = null;
      try {
        const res = await fetch(
          `https://api.minimax.io/v1/query/video_generation?task_id=${encodeURIComponent(row.external_job_id)}`,
          { headers: { Authorization: `Bearer ${apiKey}` } },
        );
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) {
          providerError = `HTTP ${res.status}: ${JSON.stringify(payload).slice(0, 400)}`;
        } else {
          providerStatus = String(payload?.status ?? payload?.task_status ?? "pending").toLowerCase();
        }
      } catch (e) {
        providerError = String(e).slice(0, 400);
      }

      const update: Record<string, unknown> = {
        provider_status: providerStatus,
        polling_ref: row.external_job_id,
        provider_error: providerError,
      };
      // Normalized state only ever moves forward one step, and only when the
      // provider itself reports progress. Pending stays exactly where it is.
      if (row.workflow_state === "submitted" && /processing|rendering|running/.test(providerStatus)) {
        update.workflow_state = "rendering";
      }
      await admin.from("h3_creatives").update(update).eq("id", row.id);
      await admin.from("h3_creative_events").insert({
        creative_id: row.id,
        event_type: "provider_poll",
        detail: { provider_status: providerStatus, provider_error: providerError },
      });
      results[row.id] = providerStatus;
    }

    return json({ connected: true, provider: PROVIDER_LABEL, results });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});