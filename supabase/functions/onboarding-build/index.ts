// ONBOARDING BUILD — turns a newly onboarded client straight into a full asset suite.
// Composes a precise deliverables brief from the client + offer record, then hands it
// to the persistent Jarvis mission engine (which delegates to Jeremy AI / Persona MCP
// and the client specialist agents), so the build survives reloads and logouts.
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PASSWORD = "HPA1234$";
const supa = createClient(SUPABASE_URL, SERVICE);

function j(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
}

type PromptRow = { key: string; section: string; label: string; prompt: string; sort_order: number; is_active: boolean };

async function loadPrompts(): Promise<PromptRow[]> {
  const { data } = await supa
    .from("onboarding_prompts")
    .select("key, section, label, prompt, sort_order, is_active")
    .order("sort_order");
  return ((data || []) as PromptRow[]).filter((r) => r.is_active !== false && String(r.prompt || "").trim());
}

function brief(client: any, offer: any, prompts: PromptRow[]) {
  const name = client?.name || offer?.fund_name || "the client";
  const facts = [
    ["Client", name],
    ["Location / market", offer?.location || client?.city || client?.location || "(not on file — research it)"],
    ["Industry / fund type", offer?.fund_type || offer?.industry_focus || client?.industry || ""],
    ["Offer description", offer?.description || client?.description || ""],
    ["Raise amount", offer?.raise_amount || ""],
    ["Minimum investment", offer?.min_investment || ""],
    ["Targeted returns", offer?.targeted_returns || ""],
    ["Hold period", offer?.hold_period || ""],
    ["Distributions", offer?.distribution_schedule || ""],
    ["Tax advantages", offer?.tax_advantages || ""],
    ["Credibility / track record", offer?.credibility || offer?.fund_history || ""],
    ["Target investor", offer?.target_investor || "Accredited investors"],
    ["Website", offer?.website_url || client?.website_url || ""],
    ["Speaker / spokesperson", offer?.speaker_name || ""],
    ["Brand notes", offer?.brand_notes || ""],
  ]
    .filter(([, v]) => String(v || "").trim())
    .map(([k, v]) => `- ${k}: ${v}`)
    .join("\n");

  const bySection = (s: string) => prompts.filter((p) => p.section === s);
  const fill = (t: string) => t.replace(/\{\{client_name\}\}/g, name).replace(/\{\{offer_name\}\}/g, offer?.fund_name || name);

  const header = bySection("brief").map((p) => fill(p.prompt)).join("\n\n");
  const deliverables = bySection("deliverables")
    .map((p, i) => `${i + 1}. ${fill(p.prompt)}`)
    .join("\n");
  const workflow = bySection("workflow").map((p) => fill(p.prompt)).join("\n\n");

  return `${header}

CLIENT FACTS ON FILE:
${facts || "- (sparse record — pull what you can from review_assets and the client's agents, never invent numbers)"}

DELIVERABLES (in this order, one save_asset call each):
${deliverables}

${workflow}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  try {
    const body = await req.json().catch(() => ({}));
    if (body.password !== PASSWORD) return j({ error: "Unauthorized" }, 401);

    const clientId = String(body.client_id || "");
    if (!clientId) return j({ error: "client_id required" }, 400);
    const prompts = await loadPrompts();

    const { data: client } = await supa.from("clients").select("*").eq("id", clientId).maybeSingle();
    if (!client) return j({ error: "client not found" }, 404);

    let offer: any = null;
    if (body.offer_id) {
      const { data } = await supa.from("client_offers").select("*").eq("id", body.offer_id).maybeSingle();
      offer = data;
    }
    if (!offer) {
      const { data } = await supa
        .from("client_offers")
        .select("*")
        .eq("client_id", clientId)
        .order("updated_at", { ascending: false })
        .limit(1);
      offer = data?.[0] || null;
    }

    // ---- GATE 1: the offer must be reviewed by a human before any automation.
    if (!offer) {
      return j({
        error: "No offer on file for this client. Add and review the offer before starting the build.",
        code: "offer_missing",
      }, 409);
    }
    if (!offer.offer_reviewed_at) {
      return j({
        error: "This client's offer has not been reviewed yet. Review and confirm the offer details, then start the build.",
        code: "offer_not_reviewed",
        offer_id: offer.id,
      }, 409);
    }

    // ---- GATE 2: never run two builds for the same client at once. Concurrent
    // missions were a direct cause of runaway duplicate creative generation.
    const { data: live } = await supa
      .from("jarvis_goals")
      .select("id, status")
      .eq("client_id", clientId)
      .ilike("title", "Onboarding build%")
      .in("status", ["queued", "running"])
      .limit(1);
    if (live?.length && !body.force) {
      return j({
        error: "An onboarding build is already running for this client.",
        code: "already_running",
        goal_id: live[0].id,
      }, 409);
    }

    const r = await fetch(`${SUPABASE_URL}/functions/v1/jarvis-goal-worker`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE}` },
      body: JSON.stringify({
        action: "create",
        title: `Onboarding build — ${client.name}`,
        goal: brief(client, offer, prompts),
        client_id: clientId,
        created_by: body.created_by || null,
        // Budgets do the real limiting now; a tight ceiling stops runaway loops.
        max_iterations: 120,
      }),
    });
    const jr = await r.json().catch(() => ({}));
    if (!r.ok) return j({ error: jr?.error || `jarvis-goal-worker ${r.status}` }, 500);

    return j({ ok: true, goal_id: jr.goal_id, client_id: clientId, offer_id: offer?.id || null });
  } catch (e) {
    console.error("onboarding-build", e);
    return j({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
