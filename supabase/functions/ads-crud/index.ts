import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const META_GRAPH_API_VERSION = "v21.0";
const META_GRAPH_API_URL = `https://graph.facebook.com/${META_GRAPH_API_VERSION}`;

/**
 * CRUD operations for Meta ads with full audit trail.
 *
 * Every write goes through the agent_actions pattern:
 *   1. Snapshot before-state from our DB
 *   2. Check approval tier (from agent_tools, overridable per request)
 *   3. If tier is 'auto' or the action is pre-approved: execute against Meta API
 *   4. Log after-state + rollback payload
 *
 * Operations:
 *   pause_campaign / enable_campaign     { campaignId }
 *   pause_adset / enable_adset           { adsetId }
 *   pause_ad / enable_ad                 { adId }
 *   update_budget                        { campaignId | adsetId, dailyBudget? lifetimeBudget? } (dollars)
 *   update_name                          { campaignId | adsetId | adId, name }
 *   create_campaign                      { name, objective, dailyBudget?, status? }
 *   execute_approved                     { actionId }  — run a previously approved agent_action
 *   rollback                             { actionId }  — undo a previously executed action
 *
 * Body: { clientId, operation, params, executedBy?, agentRunId?, reasoning?, skipApproval? }
 * skipApproval=true is only honored for human-initiated calls (executedBy != 'agent').
 */

type EntityType = "campaign" | "adset" | "ad";

const ENTITY_TABLE: Record<EntityType, string> = {
  campaign: "meta_campaigns",
  adset: "meta_ad_sets",
  ad: "meta_ads",
};
const ENTITY_ID_COL: Record<EntityType, string> = {
  campaign: "meta_campaign_id",
  adset: "meta_adset_id",
  ad: "meta_ad_id",
};

async function metaPost(
  accessToken: string,
  path: string,
  params: Record<string, string>,
): Promise<{ ok: boolean; status: number; body: any }> {
  const form = new URLSearchParams({ ...params, access_token: accessToken });
  const res = await fetch(`${META_GRAPH_API_URL}/${path}`, {
    method: "POST",
    body: form,
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const body = await req.json();
    const { clientId, operation, params = {}, executedBy = "agent", agentRunId, reasoning, skipApproval } = body;

    if (!clientId || !operation) {
      return new Response(JSON.stringify({ success: false, error: "clientId and operation required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get client Meta credentials
    const { data: client } = await supabase
      .from("clients")
      .select("id, name, meta_access_token")
      .eq("id", clientId)
      .maybeSingle();
    const accessToken = client?.meta_access_token || Deno.env.get("META_SHARED_ACCESS_TOKEN");
    if (!client || !accessToken) {
      return new Response(JSON.stringify({ success: false, error: "Client not found or missing Meta token" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── rollback: undo a previously executed action ──
    if (operation === "rollback") {
      const { data: action } = await supabase
        .from("agent_actions").select("*").eq("id", params.actionId).maybeSingle();
      if (!action || action.status !== "executed" || !action.rollback_payload?.operation) {
        return new Response(JSON.stringify({ success: false, error: "Action not found, not executed, or has no rollback payload" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      // Re-invoke ourselves with the inverse operation, skipping approval (human-initiated rollback)
      const rb = action.rollback_payload;
      const result = await executeOperation(supabase, accessToken, clientId, rb.operation, rb.params);
      if (result.ok) {
        await supabase.from("agent_actions").update({ status: "rolled_back" }).eq("id", action.id);
      }
      return new Response(JSON.stringify({ success: result.ok, result: result.body }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── execute_approved: run a pending action that a human approved ──
    if (operation === "execute_approved") {
      const { data: action } = await supabase
        .from("agent_actions").select("*").eq("id", params.actionId).maybeSingle();
      if (!action || action.status !== "approved") {
        return new Response(JSON.stringify({ success: false, error: "Action not found or not in approved state" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const meta = action.metadata || {};
      const result = await executeOperation(supabase, accessToken, clientId, meta.operation, meta.params || {});
      await supabase.from("agent_actions").update({
        status: result.ok ? "executed" : "failed",
        executed_at: new Date().toISOString(),
        after_state: result.body || {},
        error_message: result.ok ? null : JSON.stringify(result.body).substring(0, 500),
      }).eq("id", action.id);
      return new Response(JSON.stringify({ success: result.ok, result: result.body }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Normal operations: check approval tier first ──
    const toolName = operation.startsWith("pause") ? "pause_ad"
      : operation.startsWith("enable") ? "enable_ad"
      : operation === "update_budget" ? "adjust_budget"
      : "pause_ad"; // conservative default tier lookup

    const { data: tool } = await supabase
      .from("agent_tools").select("default_approval_tier").eq("tool_name", toolName).maybeSingle();
    const tier = tool?.default_approval_tier || "approval_ui";

    // Snapshot before-state from our DB
    const beforeState = await snapshotEntity(supabase, clientId, operation, params);

    // Humans can skip approval; agents must follow the tier
    const requiresApproval = tier !== "auto" && !(skipApproval && executedBy !== "agent");

    if (requiresApproval) {
      // Queue the action for approval instead of executing
      const { data: queued, error: queueErr } = await supabase.from("agent_actions").insert({
        agent_run_id: agentRunId || null,
        client_id: clientId,
        action_type: operation.includes("budget") ? "adjust_budget"
          : operation.startsWith("pause") ? "pause_ad"
          : operation.startsWith("enable") ? "enable_ad" : "custom",
        action_label: buildActionLabel(operation, params, beforeState),
        approval_tier: tier,
        status: "pending",
        before_state: beforeState || {},
        rollback_payload: buildRollback(operation, params, beforeState),
        reasoning: reasoning || null,
        executed_by: executedBy,
        metadata: { operation, params },
      }).select("id").single();

      if (queueErr) throw new Error(`Failed to queue action: ${queueErr.message}`);

      return new Response(JSON.stringify({
        success: true,
        status: "pending_approval",
        actionId: queued.id,
        approvalTier: tier,
        message: `Action queued for approval (tier: ${tier}). Approve in the dashboard or via Slack, then it executes.`,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Auto tier or human skip: execute now
    const result = await executeOperation(supabase, accessToken, clientId, operation, params);

    // Log the executed action for audit
    await supabase.from("agent_actions").insert({
      agent_run_id: agentRunId || null,
      client_id: clientId,
      action_type: operation.includes("budget") ? "adjust_budget"
        : operation.startsWith("pause") ? "pause_ad"
        : operation.startsWith("enable") ? "enable_ad" : "custom",
      action_label: buildActionLabel(operation, params, beforeState),
      approval_tier: "auto",
      status: result.ok ? "executed" : "failed",
      before_state: beforeState || {},
      after_state: result.body || {},
      rollback_payload: buildRollback(operation, params, beforeState),
      executed_at: new Date().toISOString(),
      executed_by: executedBy,
      reasoning: reasoning || null,
      error_message: result.ok ? null : JSON.stringify(result.body).substring(0, 500),
      metadata: { operation, params },
    });

    return new Response(JSON.stringify({ success: result.ok, result: result.body }), {
      status: result.ok ? 200 : 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[ads-crud] Error:", error);
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});

// ── Helpers ──

function entityFromOperation(operation: string, params: Record<string, any>): { type: EntityType; id: string } | null {
  if (params.campaignId) return { type: "campaign", id: params.campaignId };
  if (params.adsetId) return { type: "adset", id: params.adsetId };
  if (params.adId) return { type: "ad", id: params.adId };
  return null;
}

async function snapshotEntity(supabase: any, clientId: string, operation: string, params: Record<string, any>) {
  const entity = entityFromOperation(operation, params);
  if (!entity) return {};
  const { data } = await supabase
    .from(ENTITY_TABLE[entity.type])
    .select("*")
    .eq("client_id", clientId)
    .eq(ENTITY_ID_COL[entity.type], entity.id)
    .maybeSingle();
  return data || {};
}

function buildActionLabel(operation: string, params: Record<string, any>, beforeState: any): string {
  const name = beforeState?.name || params.campaignId || params.adsetId || params.adId || "entity";
  switch (operation) {
    case "pause_campaign": return `Pause campaign "${name}"`;
    case "enable_campaign": return `Enable campaign "${name}"`;
    case "pause_adset": return `Pause ad set "${name}"`;
    case "enable_adset": return `Enable ad set "${name}"`;
    case "pause_ad": return `Pause ad "${name}"`;
    case "enable_ad": return `Enable ad "${name}"`;
    case "update_budget": {
      const oldBudget = beforeState?.daily_budget ? `$${beforeState.daily_budget}/day` : "unknown";
      const newBudget = params.dailyBudget ? `$${params.dailyBudget}/day` : `$${params.lifetimeBudget} lifetime`;
      return `Change budget on "${name}": ${oldBudget} → ${newBudget}`;
    }
    case "update_name": return `Rename "${name}" → "${params.name}"`;
    case "create_campaign": return `Create campaign "${params.name}" (${params.objective})`;
    default: return `${operation} on "${name}"`;
  }
}

function buildRollback(operation: string, params: Record<string, any>, beforeState: any): Record<string, any> {
  // The inverse operation with the pre-change values
  if (operation.startsWith("pause")) {
    return { operation: operation.replace("pause", "enable"), params };
  }
  if (operation.startsWith("enable")) {
    return { operation: operation.replace("enable", "pause"), params };
  }
  if (operation === "update_budget" && beforeState?.daily_budget) {
    return { operation: "update_budget", params: { ...params, dailyBudget: beforeState.daily_budget } };
  }
  if (operation === "update_name" && beforeState?.name) {
    return { operation: "update_name", params: { ...params, name: beforeState.name } };
  }
  return {}; // create_campaign etc. have no auto-rollback
}

async function executeOperation(
  supabase: any,
  accessToken: string,
  clientId: string,
  operation: string,
  params: Record<string, any>,
): Promise<{ ok: boolean; body: any }> {
  const entity = entityFromOperation(operation, params);

  switch (operation) {
    case "pause_campaign":
    case "pause_adset":
    case "pause_ad": {
      if (!entity) return { ok: false, body: { error: "missing entity id" } };
      const res = await metaPost(accessToken, entity.id, { status: "PAUSED" });
      if (res.ok) {
        await supabase.from(ENTITY_TABLE[entity.type])
          .update({ status: "PAUSED", synced_at: new Date().toISOString() })
          .eq("client_id", clientId).eq(ENTITY_ID_COL[entity.type], entity.id);
      }
      return { ok: res.ok, body: res.body };
    }

    case "enable_campaign":
    case "enable_adset":
    case "enable_ad": {
      if (!entity) return { ok: false, body: { error: "missing entity id" } };
      const res = await metaPost(accessToken, entity.id, { status: "ACTIVE" });
      if (res.ok) {
        await supabase.from(ENTITY_TABLE[entity.type])
          .update({ status: "ACTIVE", synced_at: new Date().toISOString() })
          .eq("client_id", clientId).eq(ENTITY_ID_COL[entity.type], entity.id);
      }
      return { ok: res.ok, body: res.body };
    }

    case "update_budget": {
      if (!entity) return { ok: false, body: { error: "missing entity id" } };
      const metaParams: Record<string, string> = {};
      // Meta budgets are in cents
      if (params.dailyBudget) metaParams.daily_budget = String(Math.round(Number(params.dailyBudget) * 100));
      if (params.lifetimeBudget) metaParams.lifetime_budget = String(Math.round(Number(params.lifetimeBudget) * 100));
      if (Object.keys(metaParams).length === 0) return { ok: false, body: { error: "no budget provided" } };
      const res = await metaPost(accessToken, entity.id, metaParams);
      if (res.ok) {
        await supabase.from(ENTITY_TABLE[entity.type]).update({
          daily_budget: params.dailyBudget ?? undefined,
          lifetime_budget: params.lifetimeBudget ?? undefined,
          synced_at: new Date().toISOString(),
        }).eq("client_id", clientId).eq(ENTITY_ID_COL[entity.type], entity.id);
      }
      return { ok: res.ok, body: res.body };
    }

    case "update_name": {
      if (!entity || !params.name) return { ok: false, body: { error: "missing entity id or name" } };
      const res = await metaPost(accessToken, entity.id, { name: params.name });
      if (res.ok) {
        await supabase.from(ENTITY_TABLE[entity.type])
          .update({ name: params.name, synced_at: new Date().toISOString() })
          .eq("client_id", clientId).eq(ENTITY_ID_COL[entity.type], entity.id);
      }
      return { ok: res.ok, body: res.body };
    }

    case "create_campaign": {
      const { data: client } = await supabase
        .from("clients").select("meta_ad_account_id").eq("id", clientId).maybeSingle();
      if (!client?.meta_ad_account_id) return { ok: false, body: { error: "no ad account configured" } };
      const adAccountId = client.meta_ad_account_id.startsWith("act_")
        ? client.meta_ad_account_id : `act_${client.meta_ad_account_id}`;
      const metaParams: Record<string, string> = {
        name: params.name,
        objective: params.objective || "OUTCOME_LEADS",
        status: params.status || "PAUSED", // Always create paused for safety
        special_ad_categories: "[]",
      };
      if (params.dailyBudget) metaParams.daily_budget = String(Math.round(Number(params.dailyBudget) * 100));
      const res = await metaPost(accessToken, `${adAccountId}/campaigns`, metaParams);
      if (res.ok && res.body.id) {
        await supabase.from("meta_campaigns").upsert({
          client_id: clientId,
          meta_campaign_id: res.body.id,
          name: params.name,
          status: metaParams.status,
          objective: metaParams.objective,
          daily_budget: params.dailyBudget || null,
          platform: "meta",
          synced_at: new Date().toISOString(),
        }, { onConflict: "client_id,meta_campaign_id" });
      }
      return { ok: res.ok, body: res.body };
    }

    default:
      return { ok: false, body: { error: `Unsupported operation: ${operation}` } };
  }
}
