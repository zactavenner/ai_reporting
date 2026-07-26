// AI Task Draft
// Generates a "rough draft" comment for a task using the Lovable AI Studio
// model + client context, then posts it as a task_comment authored by
// "AI Studio" so the assignee can review and refine.
//
// Trigger:
//   POST { task_id: uuid, force?: boolean }
// Behavior:
//   - Loads task, client, latest comments, and active client offers
//   - Builds a Dan-Kennedy / direct-response prompt covering ad angles,
//     hooks, scripts, copy, briefs, outlines, summaries, etc.
//   - Skips silently if the task already has an AI draft and force !== true
//   - Returns { drafted: boolean, comment_id?, preview? }
import { createClient } from "jsr:@supabase/supabase-js@2";
import { callOpenRouter } from "../_shared/openrouter.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supa = createClient(SUPABASE_URL, SERVICE_KEY);

const AI_AUTHOR = "AI Studio";
const AI_MARKER = "🤖 **AI Studio rough draft**";

// Tasks whose titles strongly imply an executable AI deliverable.
// We attempt a draft on ANY task, but these keywords mean we're confident
// and will auto-trigger from the UI on creation.
const DRAFTABLE_HINTS = [
  /\bangle/i, /\bhook/i, /\bscript/i, /\bcaption/i, /\bheadline/i,
  /\bcopy\b/i, /\boutline/i, /\bdraft/i, /\bidea/i, /\bbrief/i,
  /\bemail/i, /\bsubject line/i, /\bcta\b/i, /\bsummary/i,
  /\bsummari[sz]e/i, /\bbrainstorm/i, /\bproposal/i, /\bagenda/i,
  /\bquestion/i, /\bvariation/i, /\bvariant/i, /\boffer/i,
  /\bplan\b/i, /\bcompetitor/i, /\bswot/i,
];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export function isLikelyDraftable(title: string, description?: string | null): boolean {
  const t = `${title || ""}\n${description || ""}`;
  return DRAFTABLE_HINTS.some((rx) => rx.test(t));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  let body: { task_id?: string; force?: boolean };
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  const taskId = body.task_id;
  if (!taskId || typeof taskId !== "string") return json({ error: "task_id required" }, 400);

  // Load task
  const { data: task, error: tErr } = await supa
    .from("tasks")
    .select("id, title, description, client_id, category, due_date, status")
    .eq("id", taskId)
    .maybeSingle();
  if (tErr || !task) return json({ error: "Task not found" }, 404);

  // Skip if an AI draft already exists (unless forced)
  const { data: existing } = await supa
    .from("task_comments")
    .select("id, content")
    .eq("task_id", taskId)
    .eq("author_name", AI_AUTHOR)
    .limit(1);
  if (!body.force && existing && existing.length > 0) {
    return json({ drafted: false, reason: "ai_draft_exists", comment_id: existing[0].id });
  }

  // Load client + offer context
  let clientName = "";
  let clientCtx = "";
  if (task.client_id) {
    const { data: client } = await supa
      .from("clients")
      .select("id, name, industry, website_url, description, offer_description, media_buyer, account_manager, product_url, intake_company_name")
      .eq("id", task.client_id).maybeSingle();
    clientName = client?.name || "";
    // Offers use `status` (active/pending_fulfillment), not `is_active`.
    // Column list mirrors the actual public.client_offers schema.
    const { data: offers } = await supa
      .from("client_offers")
      .select(
        "title, description, fund_name, fund_type, target_investor, targeted_returns, hold_period, min_investment, distribution_schedule, industry_focus, tax_advantages, credibility, fund_history, additional_notes, brand_notes, status",
      )
      .eq("client_id", task.client_id)
      .in("status", ["active", "pending_fulfillment"])
      .order("updated_at", { ascending: false })
      .limit(3);
    const offerBlocks = (offers || []).map((o: any, i: number) => {
      const lines = [
        `### Offer ${i + 1}: ${o.title || o.fund_name || "Untitled"}`,
        o.fund_type && `Type: ${o.fund_type}`,
        o.industry_focus && `Industry: ${o.industry_focus}`,
        o.target_investor && `Target investor: ${o.target_investor}`,
        o.targeted_returns && `Targeted returns: ${o.targeted_returns}`,
        o.min_investment && `Min investment: ${o.min_investment}`,
        o.hold_period && `Hold period: ${o.hold_period}`,
        o.distribution_schedule && `Distributions: ${o.distribution_schedule}`,
        o.tax_advantages && `Tax advantages: ${o.tax_advantages}`,
        o.credibility && `Credibility: ${o.credibility}`,
        o.fund_history && `Track record: ${o.fund_history}`,
        o.description && `Description: ${String(o.description).slice(0, 600)}`,
        o.brand_notes && `Brand notes: ${String(o.brand_notes).slice(0, 300)}`,
        o.additional_notes && `Notes: ${String(o.additional_notes).slice(0, 400)}`,
      ].filter(Boolean);
      return lines.join("\n");
    }).join("\n\n");
    clientCtx = [
      client?.intake_company_name && client.intake_company_name !== client?.name && `Legal name: ${client.intake_company_name}`,
      client?.industry && `Industry: ${client.industry}`,
      client?.website_url && `Website: ${client.website_url}`,
      client?.product_url && `Product page: ${client.product_url}`,
      client?.media_buyer && `Media buyer: ${client.media_buyer}`,
      client?.account_manager && `Account manager: ${client.account_manager}`,
      client?.description && `About: ${String(client.description).slice(0, 600)}`,
      client?.offer_description && `Offer summary: ${String(client.offer_description).slice(0, 800)}`,
      offerBlocks && `## Active offers\n${offerBlocks}`,
    ].filter(Boolean).join("\n");
  }

  // Optional: recent human comments to anchor the draft (only the last 3)
  const { data: recentComments } = await supa
    .from("task_comments")
    .select("author_name, content")
    .eq("task_id", taskId)
    .neq("author_name", AI_AUTHOR)
    .order("created_at", { ascending: false })
    .limit(3);
  const commentCtx = (recentComments || []).reverse()
    .map((c: any) => `> ${c.author_name}: ${(c.content || "").slice(0, 400)}`)
    .join("\n");

  const system = [
    "You are AI Studio — the agency's senior creative strategist and copywriter.",
    "You produce ROUGH DRAFTS for internal tasks so the assignee starts at the 80% line.",
    "ALWAYS read the client + offer context FIRST. Every draft must reference the client's specific offer(s), targeted returns, target investor, and industry — never generic templates. If client context is provided, you MUST use it; do not ask questions that the context already answers.",
    "Draft in the exact format the task requests. Be concrete, specific, and ready to ship after light editing.",
    "Direct-response principles (Dan Kennedy): one big idea, specific promise, pattern interrupt, proof, single CTA.",
    "COMPLIANCE (investment marketing): NEVER say 'guaranteed'. Use 'targeted returns'. Add a short risk disclaimer when copy references returns or performance.",
    "Output: clean Markdown. Use numbered lists for variations. Use H3 for sections. Keep it tight — no preamble, no 'as an AI'.",
    "Only fall back to a 'questions to unblock' checklist when the task is genuinely ambiguous AND the client context does not provide enough to draft. If any client/offer context is present, PRODUCE THE DRAFT — do not ask questions.",
  ].join("\n");

  const user = [
    clientName ? `# Client\n${clientName}` : "",
    clientCtx,
    "",
    commentCtx ? `# Recent discussion\n${commentCtx}` : "",
    "",
    `# Task`,
    `Title: ${task.title}`,
    task.description ? `Description:\n${task.description}` : "",
    task.category ? `Category: ${task.category}` : "",
    task.due_date ? `Due: ${task.due_date}` : "",
    "",
    `# Draft`,
    `First, silently review the Client and Active offers sections above. Ground every specific in that context (fund name, targeted returns, target investor, industry, hold period). Do not invent numbers not present in the context.`,
    `Produce the deliverable now. If the title asks for "3 angles", give exactly 3 numbered angles with: angle name, 1-line hook, 2-line body, CTA.`,
    `If it asks for scripts/copy/hooks/headlines, deliver that format directly.`,
    `If it asks for a summary, provide bullets + TL;DR.`,
    `Only if the task is ambiguous AND no useful client/offer context exists above, list the 3-5 questions you'd ask the team to unblock.`,
  ].filter(Boolean).join("\n");

  let draft = "";
  let modelUsed = "";
  try {
    const res = await callOpenRouter(
      [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      {
        temperature: 0.7,
        max_tokens: 1800,
        models: [
          "google/gemini-2.0-flash-001",
          "openai/gpt-4o-mini",
          "nvidia/nemotron-3-ultra-550b-a55b:free",
        ],
      },
    );
    draft = (res.text || "").trim();
    modelUsed = res.model;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return json({ error: `AI draft failed: ${msg}` }, 500);
  }

  if (!draft) return json({ error: "Empty draft from model" }, 502);

  const content = `${AI_MARKER} — review, edit, and ship.\n\n${draft}\n\n_— drafted by ${modelUsed}_`;

  const { data: comment, error: cErr } = await supa
    .from("task_comments")
    .insert({
      task_id: taskId,
      author_name: AI_AUTHOR,
      content,
      comment_type: "text",
    })
    .select("id")
    .single();
  if (cErr) return json({ error: `Insert failed: ${cErr.message}` }, 500);

  return json({ drafted: true, comment_id: comment.id, model: modelUsed, preview: draft.slice(0, 300) });
});