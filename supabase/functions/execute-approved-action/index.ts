import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { META_GRAPH_BASE, metaFetch, resolveMetaToken } from "../_shared/meta.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Fall back to a manual-task row when Meta write is impossible.
async function fallbackToTask(supabase: any, clientId: string | null, title: string, description: string) {
  const row = {
    client_id: clientId,
    title: `Manual Meta action required: ${title}`.slice(0, 255),
    description,
    priority: "high",
    stage: "backlog",
    category: "media-buyer-manual",
    created_by: "media-buyer",
  };
  const { data, error } = await supabase.from("tasks").insert(row).select("id").maybeSingle();
  return { executed: false, fallback: "task_created", task_id: data?.id ?? null, task_error: error?.message ?? null };
}

async function executeBudget(supabase: any, clientId: string | null, payload: any) {
  if (!clientId) return fallbackToTask(supabase, clientId, "budget change (no client_id)", JSON.stringify(payload, null, 2));
  // Load client + guardrails
  const { data: client } = await supabase
    .from("clients").select("id, meta_system_user_token, meta_access_token, meta_token_type").eq("id", clientId).maybeSingle();
  const { data: targets } = await supabase
    .from("client_kpi_targets").select("guardrails, max_daily_budget").eq("client_id", clientId).maybeSingle();
  const guardrails = targets?.guardrails ?? { max_budget_delta_pct: 20, never_touch_ad_ids: [] };

  const targetAdId: string | undefined = payload?.target_ad_id;
  const targetAdsetId: string | undefined = payload?.target_adset_id;
  const newDailyBudget: number | undefined = typeof payload?.new_daily_budget === "number" ? payload.new_daily_budget : undefined;
  const currentBudget: number | undefined = typeof payload?.current_daily_budget === "number" ? payload.current_daily_budget : undefined;
  const newStatus: string | undefined = payload?.new_status; // 'PAUSED' | 'ACTIVE'

  // Re-check guardrails
  const never: string[] = Array.isArray(guardrails.never_touch_ad_ids) ? guardrails.never_touch_ad_ids : [];
  if (targetAdId && never.includes(String(targetAdId))) {
    return { executed: false, reason: "target_ad_id is in never_touch_ad_ids" };
  }
  if (newDailyBudget && currentBudget) {
    const deltaPct = Math.abs((newDailyBudget - currentBudget) / currentBudget) * 100;
    const maxPct = Number(guardrails.max_budget_delta_pct ?? 20);
    if (deltaPct > maxPct) return { executed: false, reason: `budget delta ${deltaPct.toFixed(1)}% exceeds max ${maxPct}%` };
  }
  if (newDailyBudget && targets?.max_daily_budget && newDailyBudget > Number(targets.max_daily_budget)) {
    return { executed: false, reason: `new_daily_budget exceeds client max_daily_budget` };
  }

  const { token } = resolveMetaToken(client ?? {});
  if (!token) return fallbackToTask(supabase, clientId, "budget change", `No Meta token available.\n\nPayload:\n${JSON.stringify(payload, null, 2)}`);

  try {
    if (newDailyBudget && targetAdsetId) {
      // Meta expects daily_budget in minor units (cents). Assume USD if not otherwise stated.
      const cents = Math.round(newDailyBudget * 100);
      const r = await metaFetch(`${META_GRAPH_BASE}/${targetAdsetId}?access_token=${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `daily_budget=${cents}`,
      });
      const txt = await r.text();
      if (!r.ok) return fallbackToTask(supabase, clientId, `set daily_budget=$${newDailyBudget} on adset ${targetAdsetId}`, `Meta ${r.status}: ${txt}\n\nPayload:\n${JSON.stringify(payload, null, 2)}`);
      return { executed: true, target_adset_id: targetAdsetId, new_daily_budget: newDailyBudget };
    }
    if (newStatus && targetAdId) {
      const r = await metaFetch(`${META_GRAPH_BASE}/${targetAdId}?access_token=${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `status=${encodeURIComponent(newStatus)}`,
      });
      const txt = await r.text();
      if (!r.ok) return fallbackToTask(supabase, clientId, `set status=${newStatus} on ad ${targetAdId}`, `Meta ${r.status}: ${txt}\n\nPayload:\n${JSON.stringify(payload, null, 2)}`);
      return { executed: true, target_ad_id: targetAdId, new_status: newStatus };
    }
    return fallbackToTask(supabase, clientId, "budget change (unknown payload shape)", JSON.stringify(payload, null, 2));
  } catch (e) {
    return fallbackToTask(supabase, clientId, "budget change (exception)", `${(e as Error).message}\n\nPayload:\n${JSON.stringify(payload, null, 2)}`);
  }
}

async function executeLaunch(supabase: any, clientId: string | null, payload: any) {
  const spec = payload?.launch_spec ?? payload;
  const desc = `Full launch spec:\n\n${JSON.stringify(spec, null, 2)}\n\nCreate campaign → ad set → ad in Meta, all PAUSED, per naming conventions in the spec.`;
  // Autonomous launches are gated: for safety in this phase we always create a manual task.
  // This preserves the "never throw" contract and lets a human do the final launch.
  return fallbackToTask(supabase, clientId, spec?.title ?? "new campaign launch", desc);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  try {
    const { approval_id } = await req.json();
    if (!approval_id) {
      return new Response(JSON.stringify({ error: "approval_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: row, error } = await supabase
      .from("approval_queue")
      .select("id, queue_type, preview_payload, client_id, audit_log_id, status")
      .eq("id", approval_id)
      .maybeSingle();
    if (error || !row) throw new Error(error?.message || "approval not found");

    if (!["approved", "edited_approved"].includes(row.status)) {
      return new Response(JSON.stringify({ executed: false, reason: "not approved" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const payload = (row.preview_payload || {}) as any;
    let result: any = { executed: false, reason: "executor not yet implemented for this type" };

    try {
      if (row.queue_type === "message") {
        if (payload.channel === "slack" && payload.slack_channel && payload.body) {
          const r = await fetch(`${SUPABASE_URL}/functions/v1/slack-send-message`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
            body: JSON.stringify({ channel: payload.slack_channel, text: payload.body }),
          });
          result = { executed: r.ok, channel: "slack", status: r.status };
        } else if (payload.channel === "sms" && payload.to && payload.body) {
          const r = await fetch(`${SUPABASE_URL}/functions/v1/send-sms-imessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
            body: JSON.stringify({ to: payload.to, message: payload.body, client_id: row.client_id }),
          });
          result = { executed: r.ok, channel: "sms", status: r.status };
        } else {
          result = { executed: false, reason: "message payload missing channel/body" };
        }
      } else if (row.queue_type === "report") {
        if (payload.report_id) {
          const { error: upErr } = await supabase
            .from("daily_reports")
            .update({ status: "published", published_at: new Date().toISOString() } as any)
            .eq("id", payload.report_id);
          result = upErr
            ? { executed: false, reason: upErr.message }
            : { executed: true, report_id: payload.report_id };
        } else {
          result = { executed: false, reason: "report payload missing report_id" };
        }
      } else if (row.queue_type === "budget") {
        result = await executeBudget(supabase, row.client_id, payload);
      } else if (row.queue_type === "launch") {
        result = await executeLaunch(supabase, row.client_id, payload);
      }
    } catch (e) {
      result = { executed: false, reason: String(e) };
    }

    console.log("execute-approved-action", { approval_id, queue_type: row.queue_type, result });

    return new Response(JSON.stringify({ ok: true, result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("execute-approved-action error", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});