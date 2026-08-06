// Server-side H3 provider status + polling.
//
// PROVIDER CONTRACT: these jobs were submitted through OpenRouter, not directly
// to MiniMax. The only credential is the server-side OPENROUTER_API_KEY. It is
// never sent to the browser, never persisted to the database, and never echoed
// in a response or an audit event.
//
// Hard rules:
// - Operator-only. A valid JWT is never sufficient: the caller must be
//   allowlisted in public.reporting_operator_users (or be the service role).
//   This function holds the service-role key, so it is the only place H3 rows
//   are written server-side and it must not be callable by arbitrary users.
// - POLL ONLY. This function issues exactly one request shape:
//   GET https://openrouter.ai/api/v1/videos/{external_job_id}. It never POSTs
//   /videos and never touches any generation endpoint, so it cannot submit or
//   re-submit a job or spend provider credit.
// - Requires the OPENROUTER_API_KEY server secret. If absent we return an
//   honest disconnected status instead of inventing a result.
// - Idempotent: a pending provider job is left exactly as-is.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { authorizeOperator } from "../_shared/operatorAuth.ts";
import {
  extractContentUrl,
  extractCostUsd,
  extractProviderError,
  isVideoContentType,
  nextWorkflowState,
  openRouterPollUrl as pollUrl,
  type OpenRouterVideoJob,
} from "../_shared/h3Provider.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PROVIDER_LABEL = "OpenRouter";
const NOT_CONFIGURED =
  "Connection required to resume polling — no server-side OpenRouter credential is configured. Add OPENROUTER_API_KEY in Project Settings → Secrets.";

/**
 * "completed" from the provider is a claim, not an asset. Confirm the content
 * URL actually serves a downloadable video before we call anything Downloaded.
 * Headers only — the body is cancelled so we never pull the whole render.
 */
async function assetIsDownloadable(url: string, apiKey: string): Promise<{ ok: boolean; detail: string }> {
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}`, Range: "bytes=0-0" },
    });
    const type = res.headers.get("content-type") ?? "";
    const len = res.headers.get("content-length") ?? "";
    try { await res.body?.cancel(); } catch { /* already drained */ }
    if (!res.ok && res.status !== 206) return { ok: false, detail: `content HTTP ${res.status}` };
    if (!isVideoContentType(type)) {
      return { ok: false, detail: `unexpected content-type "${type}"` };
    }
    return { ok: true, detail: `${type}${len ? ` (${len} bytes/range)` : ""}` };
  } catch (e) {
    return { ok: false, detail: `content probe failed: ${String(e).slice(0, 200)}` };
  }
}

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
    const apiKey = Deno.env.get("OPENROUTER_API_KEY");

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Agency-operator authorization boundary — enforced before anything else.
    const auth = await authorizeOperator(req, admin, createClient);

    // The access probe always answers 200 so the UI can render an honest
    // "not an operator" / "bootstrap required" state instead of a dead screen.
    if (action === "access") {
      return json(
        auth.ok
          ? { allowed: true, via: auth.via }
          : { allowed: false, code: auth.code, status: auth.status, error: auth.error },
      );
    }

    if (!auth.ok) {
      return json({ error: auth.error, code: auth.code }, auth.status);
    }

    if (action === "status") {
      return json({
        connected: !!apiKey,
        provider: PROVIDER_LABEL,
        reason: apiKey ? "OpenRouter credential configured server-side." : NOT_CONFIGURED,
      });
    }

    if (action !== "poll") return json({ error: "Unknown action" }, 400);

    if (!apiKey) {
      return json({ connected: false, provider: PROVIDER_LABEL, reason: NOT_CONFIGURED }, 200);
    }

    const creativeIds: string[] = Array.isArray(body?.creativeIds) ? body.creativeIds : [];
    if (!creativeIds.length) return json({ error: "creativeIds required" }, 400);

    const { data: rows, error } = await admin
      .from("h3_creatives")
      .select("id, external_job_id, provider_status, workflow_state, source_asset_url")
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
      let generationId: string | null = null;
      let pollingUrl: string | null = null;
      let costAmount: number | null = null;
      let contentUrl: string | null = null;
      let assetNote = "";

      try {
        const res = await fetch(pollUrl(row.external_job_id), {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) {
          providerError = `OpenRouter HTTP ${res.status}: ${JSON.stringify(payload).slice(0, 400)}`;
        } else {
          providerStatus = String(payload?.status ?? "pending").toLowerCase();
          generationId = typeof payload?.generation_id === "string" ? payload.generation_id : null;
          pollingUrl = typeof payload?.polling_url === "string" ? payload.polling_url : null;
          const cost = payload?.usage?.cost;
          costAmount = typeof cost === "number" ? cost : null;
          contentUrl = extractContentUrl(payload);
          const perJobError = payload?.error;
          if (perJobError) {
            providerError = typeof perJobError === "string"
              ? perJobError.slice(0, 400)
              : JSON.stringify(perJobError).slice(0, 400);
          }
        }
      } catch (e) {
        providerError = String(e).slice(0, 400);
      }

      const update: Record<string, unknown> = {
        provider_status: providerStatus,
        // polling_url as returned by the provider; fall back to the canonical
        // read-only poll URL for this job so the ref is never a dead value.
        polling_ref: pollingUrl ?? pollUrl(row.external_job_id),
        provider_error: providerError,
      };
      if (generationId) update.provider_generation_id = generationId;
      if (costAmount !== null) {
        update.cost_amount = costAmount;
        update.cost_currency = "USD";
      }

      // Normalized state only ever moves forward, and only on evidence.
      //   pending     -> Submitted (stays exactly where it is)
      //   in_progress -> Rendering
      //   completed   -> Downloaded, but ONLY once a downloadable source asset
      //                  is actually present and verified.
      if (row.workflow_state === "submitted" && /in_progress|processing|rendering|running/.test(providerStatus)) {
        update.workflow_state = "rendering";
      }

      if (providerStatus === "completed") {
        if (contentUrl) {
          const probe = await assetIsDownloadable(contentUrl, apiKey);
          assetNote = probe.detail;
          if (probe.ok) {
            update.source_asset_url = contentUrl;
            // The state machine forbids skipping states, so a job still sitting
            // at Submitted is walked Submitted -> Rendering -> Downloaded.
            if (row.workflow_state === "submitted") {
              await admin.from("h3_creatives").update({ workflow_state: "rendering" }).eq("id", row.id);
            }
            update.workflow_state = "downloaded";
          } else {
            // Provider claims completed but no usable asset — hold position and
            // record why rather than advancing on an unverified claim.
            assetNote = `held at ${row.workflow_state}: ${probe.detail}`;
            delete update.workflow_state;
          }
        } else {
          assetNote = `held at ${row.workflow_state}: completed without a content URL`;
          delete update.workflow_state;
        }
      }

      const { error: upErr } = await admin.from("h3_creatives").update(update).eq("id", row.id);
      if (upErr) {
        results[row.id] = `persist_failed: ${upErr.message}`;
        continue;
      }
      await admin.from("h3_creative_events").insert({
        creative_id: row.id,
        event_type: "provider_poll",
        detail: {
          provider: PROVIDER_LABEL,
          job_id: row.external_job_id,
          provider_status: providerStatus,
          generation_id: generationId,
          polling_url: update.polling_ref,
          cost_usd: costAmount,
          asset: assetNote || null,
          provider_error: providerError,
          workflow_state: update.workflow_state ?? row.workflow_state,
        },
      });
      results[row.id] = providerError
        ? `${providerStatus} (error)`
        : String(update.workflow_state ?? providerStatus);
    }

    return json({ connected: true, provider: PROVIDER_LABEL, results });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});