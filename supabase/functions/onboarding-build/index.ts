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

function brief(client: any, offer: any) {
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

  return `Build the COMPLETE onboarding asset suite for ${name} end to end, working with Jeremy AI and the client's specialist agents. Save every deliverable with save_asset (library + AI Studio canvas) as you finish it.

CLIENT FACTS ON FILE:
${facts || "- (sparse record — pull what you can from review_assets and the client's agents, never invent numbers)"}

DELIVERABLES (in this order, one save_asset call each):
1. offer_summary — summary of the offer, the location/market, the unique strategy and the credibility proof.
2. angles — 5 distinct marketing angles, each with the audience, the core belief being shifted and why it wins.
3. ad_copy — 5 ad copy variants, each with 3 headline options, primary text and CTA.
4. nurture_emails — 10 nurture emails (subject + preview + body), sequenced with purpose per email.
5. appointment_reminders — appointment reminder set: confirmation + 24h + 1h emails AND the matching SMS messages.
6. vsl — a full VSL script with timestamps and the hook/story/offer/close structure.
7. video_scripts — 5 video ad scripts (hook, body, CTA, on-screen text, shot notes), written for a female spokesperson around 30.
8. faq_scripts — 5 FAQ video scripts answering the real objections of this investor profile.
9. static_ad_brief — the creative direction for the statics, then call generate_static_ads ONCE with count 10. That is the entire static budget: 10 creatives, each on its own concept slot and aspect ratio. Do not call it a second time.
10. create_client_avatar — create and assign the client avatar: attractive professional female, around 30, warm and credible on camera.

HARD OUTPUT LIMITS FOR THIS ONBOARDING (enforced by the tools):
 - Exactly 10 static creatives, all driven by THIS client's offer above — no generic fund filler.
 - Exactly 5 videos, 30 seconds each, natural and full of motion, one per style: podcast clip, street interview, walk-and-talk, cinematic b-roll, split screen (speaker in one half of the frame, supporting visual in the other).
 - When a generator reports its budget is exhausted, that deliverable is done. Never re-run it.

THEN:
A. Consult Jeremy (ask_jeremy) on the angles, the ad copy and the video scripts BEFORE finalising them, and record_decision with his verdict each time.
B. request_approval with queue_type "creative_review" for the static ads + avatar (list the creative ids / urls in the payload).
C. request_approval with queue_type "video_scripts" for the 5 video ad scripts + 5 FAQ scripts.
D. Poll check_approval. ONLY once the video_scripts approval is "approved" may you produce videos: pick the 5 strongest approved scripts and call generate_video once per style (podcast, street_interview, walk_and_talk, broll, split_screen) with the avatar image, duration 30, 9:16 — then poll check_video_job.
E. If an approval is rejected, read the rejection reason, rewrite the affected deliverable, save it again and request approval once more.
F. finish_mission with a markdown report: deliverables saved, creatives generated, Jeremy verdicts, approval states and videos produced.`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  try {
    const body = await req.json().catch(() => ({}));
    if (body.password !== PASSWORD) return j({ error: "Unauthorized" }, 401);

    const clientId = String(body.client_id || "");
    if (!clientId) return j({ error: "client_id required" }, 400);

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
        goal: brief(client, offer),
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
