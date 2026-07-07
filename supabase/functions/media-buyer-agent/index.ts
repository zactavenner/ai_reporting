// Media Buyer Agent — Phase 3A.
// Reads ONLY existing DB tables (no Meta API calls), calls Lovable AI Gateway,
// persists findings/classifications/creative_intel, and routes every proposal
// with confidence >= 0.7 through agent-gatekeeper into the /approvals inbox.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const DEFAULT_MODEL = "openai/gpt-5.4";
const CONFIDENCE_THRESHOLD = 0.7;

type RunType = "account_audit" | "daily_review" | "weekly_review" | "creative_intel" | "fatigue_scan" | "pixel_audit" | "launch_plan";
type Sb = ReturnType<typeof createClient>;

interface RequestBody {
  run_type: RunType;
  client_id?: string;
  lookback_days?: number;
}

interface Proposal {
  action_type: string;
  queue_type: string;
  client_id?: string | null;
  title?: string;
  summary?: string;
  reasoning?: string;
  preview_payload?: Record<string, unknown>;
  confidence?: number;
  priority?: number;
  compliance_check?: { status?: string; notes?: string };
  inputs?: Record<string, unknown>;
}

interface AgentOutput {
  findings_md?: string;
  ad_classifications?: Array<{ meta_ad_id: string; client_id?: string; classification: string; reasoning?: string; metrics_snapshot?: Record<string, unknown> }>;
  creative_intel?: Array<{ scope: "client" | "portfolio"; client_id?: string | null; pattern_type: string; pattern_description: string; evidence?: Record<string, unknown>; recommendation: string; confidence?: number }>;
  proposals?: Proposal[];
}

const RUN_TYPE_INSTRUCTIONS: Record<RunType, string> = {
  account_audit: "Perform a full account audit for the given client (or portfolio). Classify every active ad. Identify structural issues (naming, sprawl, over-segmentation), tracking gaps, and 1-3 highest-leverage actions. Produce proposals only for concrete actions.",
  daily_review: "Daily performance review for each active client in scope. Focus on trend deltas vs prior equal window. Classify every active ad. Propose immediate budget adjustments (within guardrails) and creative kills for underperformers with sufficient spend. IMPORTANT: also inspect `ad_lead_quality_7d` in context — when an ad's bad_rate is elevated (>=25%) or qualified_rate is depressed (<25%) with spend_current >= 50, propose specific downstream fixes through the normal gatekeeper flow: audience exclusions (queue_type='audience'), form qualification question changes (queue_type='form'), or creative callout adjustments (queue_type='creative'). Route insight, not just data — a cheap CPL with a bad qualified rate is a worse ad than an expensive CPL with a great qualified rate.",
  weekly_review: "Weekly rollup with structural recommendations. Classify ads, identify winning angles, propose new creative launches (creative_launch with full launch_spec), scale winners, kill losers.",
  creative_intel: "Cross-client creative intelligence pass. Identify STRUCTURAL patterns that transfer across accounts (hook shapes, formats, CTAs, spokesperson patterns) — never confidential client brand/claim content. Portfolio-scope findings only. Produce specific creative production recommendations. No proposals unless a launch is clearly warranted.",
  fatigue_scan: "Fatigue-only scan portfolio-wide. Use ONLY the `ad_window_metrics` array in context — each entry has frequency_current, ctr_delta_pct, cpl_delta_pct, spend_current, cpl_current, and prior-window comparisons. Flag ads that meet ANY of: frequency_current >= 3.0 AND ctr_delta_pct <= -15; OR frequency_current >= 4.0; OR cpl_delta_pct >= 25 with spend_current >= 50. For each flagged ad emit an ad_classification (PAUSE/ITERATE/WATCH) with metrics_snapshot copied from ad_window_metrics, and produce a creative_kill (queue_type='creative') or budget_change proposal referencing target_ad_id. Skip ads with no fatigue signal — do NOT classify healthy ads.",
  pixel_audit: "Tracking / pixel audit for the given client (or portfolio). Cross-reference pixel_verifications, pixel_expected_events, funnel_analytics. Label every claim VERIFIED / LIKELY / UNKNOWN / NEEDS TESTING. For NEEDS TESTING items produce task_created proposals with specific test steps.",
  launch_plan: "Produce concrete launch proposals for the given client. Each proposal must include a complete launch_spec in preview_payload: campaign objective, adset targeting/budget, ad creative refs, naming per convention, UTMs.",
};

function j(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

async function loadContext(sb: Sb, clientIds: string[], lookbackDays: number) {
  const now = new Date();
  const winStart = new Date(now.getTime() - lookbackDays * 86400_000).toISOString().slice(0, 10);
  const priorStart = new Date(now.getTime() - 2 * lookbackDays * 86400_000).toISOString().slice(0, 10);

  const [clientsRes, targetsRes, offersRes, adsRes, adsetsRes, campaignsRes, dailyRes, priorDailyRes, lessonsRes, pixelRes, expEventsRes, insightsWinRes, insightsPriorRes] = await Promise.all([
    sb.from("clients").select("id, name, status, timezone").in("id", clientIds),
    sb.from("client_kpi_targets").select("*").in("client_id", clientIds),
    sb.from("client_offers").select("client_id, name, description, offer_type, target_return, minimum_investment").in("client_id", clientIds).eq("is_primary", true),
    sb.from("meta_ads").select("meta_ad_id, client_id, meta_adset_id, meta_campaign_id, name, status, effective_status, thumbnail_url, headline, body, call_to_action_type, spend, impressions, clicks, ctr, reach, attributed_leads, attributed_calls, attributed_showed, attributed_funded, cost_per_lead, cost_per_call, cost_per_funded").in("client_id", clientIds).eq("effective_status", "ACTIVE").limit(500),
    sb.from("meta_ad_sets").select("meta_adset_id, client_id, meta_campaign_id, name, status, daily_budget, spend, attributed_leads, cost_per_lead, cost_per_funded").in("client_id", clientIds).eq("status", "ACTIVE").limit(300),
    sb.from("meta_campaigns").select("meta_campaign_id, client_id, name, status, objective, spend, attributed_leads, cost_per_lead").in("client_id", clientIds).eq("status", "ACTIVE").limit(150),
    sb.from("daily_metrics").select("client_id, date, ad_spend, leads, calls, showed_calls, funded_investors, funded_dollars").in("client_id", clientIds).gte("date", winStart),
    sb.from("daily_metrics").select("client_id, date, ad_spend, leads, calls, showed_calls, funded_investors, funded_dollars").in("client_id", clientIds).gte("date", priorStart).lt("date", winStart),
    sb.from("agent_lessons").select("lesson, source, context, created_at").eq("agent_name", "media-buyer").eq("active", true).order("created_at", { ascending: false }).limit(30),
    sb.from("pixel_verifications").select("client_id, status, events_detected, missing_expected, scanned_at").in("client_id", clientIds).order("scanned_at", { ascending: false }).limit(100),
    sb.from("pixel_expected_events").select("step_id, platform, event_name, is_custom").limit(200),
    sb.from("meta_ad_daily_insights").select("date, client_id, meta_ad_id, spend, impressions, reach, frequency, clicks, ctr, leads, cost_per_lead, video_3s_views, video_thruplay").in("client_id", clientIds).gte("date", winStart),
    sb.from("meta_ad_daily_insights").select("date, client_id, meta_ad_id, spend, impressions, reach, frequency, clicks, ctr, leads, cost_per_lead, video_3s_views, video_thruplay").in("client_id", clientIds).gte("date", priorStart).lt("date", winStart),
  ]);

  // Latest ad-level lead quality (7d) per meta_ad_id for context
  const qualityRes = await sb
    .from("ad_lead_quality")
    .select("client_id, meta_ad_id, window_size, date, leads, qualified, qualified_rate, bad_rate, booked_rate, funded")
    .in("client_id", clientIds)
    .eq("window_size", "7d")
    .order("date", { ascending: false })
    .limit(2000);
  const qualityByAd = new Map<string, any>();
  for (const q of (qualityRes.data ?? [])) {
    if (!qualityByAd.has(q.meta_ad_id)) qualityByAd.set(q.meta_ad_id, q);
  }

  // Aggregate per meta_ad_id per window and compute WoW deltas
  type Agg = { meta_ad_id: string; client_id: string | null; spend: number; impressions: number; clicks: number; leads: number; freq_last: number; days: number; avg_ctr: number; cpl: number };
  const aggregate = (rows: any[]): Map<string, Agg> => {
    const m = new Map<string, Agg>();
    for (const r of rows) {
      const k = String(r.meta_ad_id);
      const a = m.get(k) ?? { meta_ad_id: k, client_id: r.client_id ?? null, spend: 0, impressions: 0, clicks: 0, leads: 0, freq_last: 0, days: 0, avg_ctr: 0, cpl: 0 };
      a.spend += Number(r.spend ?? 0);
      a.impressions += Number(r.impressions ?? 0);
      a.clicks += Number(r.clicks ?? 0);
      a.leads += Number(r.leads ?? 0);
      a.freq_last = Math.max(a.freq_last, Number(r.frequency ?? 0));
      a.days += 1;
      m.set(k, a);
    }
    for (const a of m.values()) {
      a.avg_ctr = a.impressions > 0 ? (a.clicks / a.impressions) * 100 : 0;
      a.cpl = a.leads > 0 ? a.spend / a.leads : 0;
    }
    return m;
  };
  const winAgg = aggregate((insightsWinRes as any).data ?? []);
  const priorAgg = aggregate((insightsPriorRes as any).data ?? []);
  const adWindowMetrics: any[] = [];
  for (const [k, cur] of winAgg.entries()) {
    const prior = priorAgg.get(k);
    const cpl_delta_pct = prior && prior.cpl > 0 && cur.cpl > 0 ? ((cur.cpl - prior.cpl) / prior.cpl) * 100 : null;
    const ctr_delta_pct = prior && prior.avg_ctr > 0 ? ((cur.avg_ctr - prior.avg_ctr) / prior.avg_ctr) * 100 : null;
    adWindowMetrics.push({
      meta_ad_id: k,
      client_id: cur.client_id,
      frequency_current: Number(cur.freq_last.toFixed(2)),
      spend_current: Number(cur.spend.toFixed(2)),
      leads_current: cur.leads,
      ctr_current_pct: Number(cur.avg_ctr.toFixed(3)),
      cpl_current: Number(cur.cpl.toFixed(2)),
      spend_prior: prior ? Number(prior.spend.toFixed(2)) : null,
      leads_prior: prior?.leads ?? null,
      ctr_prior_pct: prior ? Number(prior.avg_ctr.toFixed(3)) : null,
      cpl_prior: prior ? Number(prior.cpl.toFixed(2)) : null,
      cpl_delta_pct: cpl_delta_pct !== null ? Number(cpl_delta_pct.toFixed(1)) : null,
      ctr_delta_pct: ctr_delta_pct !== null ? Number(ctr_delta_pct.toFixed(1)) : null,
      days_active_in_window: cur.days,
    });
  }

  return {
    lookback_start: winStart,
    prior_start: priorStart,
    clients: clientsRes.data ?? [],
    kpi_targets: targetsRes.data ?? [],
    offers: offersRes.data ?? [],
    active_ads: adsRes.data ?? [],
    active_adsets: adsetsRes.data ?? [],
    active_campaigns: campaignsRes.data ?? [],
    daily_metrics_window: dailyRes.data ?? [],
    daily_metrics_prior: priorDailyRes.data ?? [],
    lessons: lessonsRes.data ?? [],
    pixel_verifications: pixelRes.data ?? [],
    pixel_expected_events: expEventsRes.data ?? [],
    ad_window_metrics: adWindowMetrics,
    ad_lead_quality_7d: [...qualityByAd.values()],
  };
}

async function callLLM(systemPrompt: string, instruction: string, context: unknown, model: string): Promise<{ output: AgentOutput; cost_usd: number | null; raw: string }> {
  const res = await fetch(GATEWAY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Lovable-API-Key": LOVABLE_API_KEY },
    body: JSON.stringify({
      model,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `RUN INSTRUCTION:\n${instruction}\n\nCONTEXT (JSON):\n${JSON.stringify(context)}\n\nRespond with STRICT JSON matching the OUTPUT CONTRACT.` },
      ],
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`AI gateway ${res.status}: ${text.slice(0, 400)}`);
  const body = JSON.parse(text);
  const raw = body?.choices?.[0]?.message?.content ?? "{}";
  let output: AgentOutput = {};
  try { output = JSON.parse(raw); }
  catch {
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) { try { output = JSON.parse(m[0]); } catch { /* leave empty */ } }
  }
  const cost_usd = typeof body?.usage?.total_cost === "number" ? body.usage.total_cost : null;
  return { output, cost_usd, raw };
}

async function loadSystemPrompt(sb: Sb): Promise<{ prompt: string; model: string }> {
  const { data } = await sb.from("agents").select("prompt_template, model").eq("name", "media-buyer").maybeSingle();
  return { prompt: data?.prompt_template ?? "You are a senior direct-response media buyer.", model: data?.model ?? DEFAULT_MODEL };
}

async function persistFindings(sb: Sb, runId: string, clientId: string | null, output: AgentOutput) {
  if (Array.isArray(output.ad_classifications) && output.ad_classifications.length) {
    const rows = output.ad_classifications
      .filter((c) => c?.meta_ad_id && c?.classification)
      .map((c) => ({
        run_id: runId,
        client_id: c.client_id ?? clientId ?? null,
        meta_ad_id: String(c.meta_ad_id),
        classification: c.classification,
        reasoning: c.reasoning ?? null,
        metrics_snapshot: c.metrics_snapshot ?? {},
      }));
    if (rows.length) await sb.from("ad_classifications").upsert(rows, { onConflict: "run_id,meta_ad_id" });
  }

  if (Array.isArray(output.creative_intel) && output.creative_intel.length) {
    const rows = output.creative_intel
      .filter((f) => f?.pattern_type && f?.pattern_description && f?.recommendation)
      .map((f) => ({
        run_id: runId,
        scope: f.scope === "portfolio" ? "portfolio" : "client",
        client_id: f.scope === "portfolio" ? null : (f.client_id ?? clientId ?? null),
        pattern_type: f.pattern_type,
        pattern_description: f.pattern_description,
        evidence: f.evidence ?? {},
        recommendation: f.recommendation,
        confidence: typeof f.confidence === "number" ? f.confidence : null,
      }));
    if (rows.length) await sb.from("creative_intel_findings").insert(rows);

    // Portfolio winners: distill to copy_library / swipe_file
    const copyLibRows = rows.filter((r) => r.scope === "portfolio" && ["hook", "headline", "cta"].includes(r.pattern_type))
      .map((r) => ({ client_id: null, type: r.pattern_type === "cta" ? "cta" : r.pattern_type === "hook" ? "hook" : "headline", content: r.pattern_description, platform: "meta", performance_score: r.confidence, tags: ["media-buyer", "winner", r.pattern_type] }));
    if (copyLibRows.length) await sb.from("copy_library").insert(copyLibRows);

    const swipeRows = rows.filter((r) => r.scope === "portfolio" && ["format", "visual", "spokesperson"].includes(r.pattern_type))
      .map((r) => ({ client_id: null, title: r.pattern_description.slice(0, 200), notes: r.recommendation, category: r.pattern_type, added_by: "media-buyer", tags: ["media-buyer", r.pattern_type] }));
    if (swipeRows.length) await sb.from("swipe_file").insert(swipeRows);
  }
}

async function queueProposals(sb: Sb, clientIdCtx: string | null, proposals: Proposal[]): Promise<number> {
  const eligible = proposals.filter((p) => (p.confidence ?? 0) >= CONFIDENCE_THRESHOLD && p.queue_type && p.action_type);
  let queued = 0;
  for (const p of eligible) {
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/agent-gatekeeper`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}`, apikey: SERVICE_KEY },
        body: JSON.stringify({
          agent_name: "media-buyer",
          action_type: p.action_type,
          client_id: p.client_id ?? clientIdCtx ?? null,
          reasoning: p.reasoning ?? p.summary ?? p.title ?? "media-buyer proposal",
          inputs: p.inputs ?? {},
          proposed_action: {
            queue_type: p.queue_type,
            title: p.title,
            summary: p.summary,
            preview_payload: p.preview_payload ?? {},
            compliance_check_result: p.compliance_check ?? null,
            priority: p.priority ?? 3,
          },
        }),
      });
      if (res.ok) queued++;
      else console.warn("gatekeeper non-ok", res.status, (await res.text()).slice(0, 200));
    } catch (e) {
      console.warn("gatekeeper call failed", (e as Error).message);
    }
  }
  return queued;
}

async function createPixelAuditTasks(sb: Sb, clientIds: string[], structured: Record<string, unknown>) {
  const items = (structured?.needs_testing as Array<{ client_id?: string; title?: string; description?: string }> | undefined) ?? [];
  if (!items.length) return 0;

  // Load pod assignments → pick a lead member to assign
  const { data: pods } = await sb.from("client_pod_assignments").select("client_id, pod_id, is_lead").in("client_id", clientIds);
  const podByClient = new Map<string, string[]>();
  (pods ?? []).forEach((p) => {
    const arr = podByClient.get(p.client_id as string) ?? [];
    arr.push(p.pod_id as string);
    podByClient.set(p.client_id as string, arr);
  });
  const podIds = [...new Set((pods ?? []).map((p) => p.pod_id as string))];
  const { data: members } = podIds.length
    ? await sb.from("agency_members").select("id, pod_id").in("pod_id", podIds)
    : { data: [] as Array<{ id: string; pod_id: string }> };
  const memberByPod = new Map<string, string>();
  (members ?? []).forEach((m) => { if (!memberByPod.has(m.pod_id)) memberByPod.set(m.pod_id, m.id); });

  const rows = items.filter((it) => it?.client_id && it?.title).map((it) => {
    const clientPods = podByClient.get(it.client_id!) ?? [];
    const assigned = clientPods.map((pid) => memberByPod.get(pid)).find(Boolean) ?? null;
    return {
      client_id: it.client_id!,
      title: `Manual pixel test required: ${it.title}`,
      description: it.description ?? null,
      priority: "high",
      stage: "backlog",
      category: "pixel-audit",
      created_by: "media-buyer",
      assigned_to: assigned,
    };
  });
  if (!rows.length) return 0;
  const { error } = await sb.from("tasks").insert(rows);
  if (error) { console.warn("pixel-audit tasks insert failed", error.message); return 0; }
  return rows.length;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (!LOVABLE_API_KEY) return j({ error: "LOVABLE_API_KEY not configured" }, 500);

  const sb = createClient(SUPABASE_URL, SERVICE_KEY);
  let body: RequestBody;
  try { body = await req.json(); } catch { return j({ error: "invalid json body" }, 400); }
  const runType = body.run_type;
  if (!runType || !(runType in RUN_TYPE_INSTRUCTIONS)) return j({ error: "invalid run_type" }, 400);
  const lookbackDays = Math.max(1, Math.min(90, body.lookback_days ?? 14));

  // Determine target clients
  let clientIds: string[] = [];
  if (body.client_id) clientIds = [body.client_id];
  else {
    const { data } = await sb.from("clients").select("id").eq("status", "active");
    clientIds = (data ?? []).map((c) => c.id as string);
  }
  if (!clientIds.length) return j({ error: "no active clients found" }, 400);

  const { prompt, model } = await loadSystemPrompt(sb);

  // Create run row
  const { data: runRow, error: runErr } = await sb.from("media_buyer_runs")
    .insert({ client_id: body.client_id ?? null, run_type: runType, status: "running" })
    .select("id").single();
  if (runErr || !runRow) return j({ error: `run create failed: ${runErr?.message}` }, 500);
  const runId = runRow.id as string;

  try {
    const context = await loadContext(sb, clientIds, lookbackDays);
    const instruction = RUN_TYPE_INSTRUCTIONS[runType];
    const { output, cost_usd, raw } = await callLLM(prompt, instruction, { run_type: runType, lookback_days: lookbackDays, ...context }, model);

    await persistFindings(sb, runId, body.client_id ?? null, output);

    let tasksCreated = 0;
    if (runType === "pixel_audit") {
      const structured = (output as unknown as { structured_findings?: Record<string, unknown> }).structured_findings ?? {};
      tasksCreated = await createPixelAuditTasks(sb, clientIds, structured);
    }

    const queued = await queueProposals(sb, body.client_id ?? null, output.proposals ?? []);

    await sb.from("media_buyer_runs").update({
      status: "complete",
      finished_at: new Date().toISOString(),
      findings_md: output.findings_md ?? null,
      structured_findings: {
        run_type: runType,
        lookback_days: lookbackDays,
        clients_scanned: clientIds.length,
        classifications: output.ad_classifications?.length ?? 0,
        creative_intel: output.creative_intel?.length ?? 0,
        proposals_returned: output.proposals?.length ?? 0,
        proposals_queued: queued,
        pixel_tasks_created: tasksCreated,
        raw_len: raw.length,
      },
      proposals_created: queued,
      cost_usd,
    }).eq("id", runId);

    return j({ ok: true, run_id: runId, clients_scanned: clientIds.length, classifications: output.ad_classifications?.length ?? 0, creative_intel: output.creative_intel?.length ?? 0, proposals_returned: output.proposals?.length ?? 0, proposals_queued: queued, pixel_tasks_created: tasksCreated });
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    await sb.from("media_buyer_runs").update({ status: "failed", finished_at: new Date().toISOString(), error_message: msg.slice(0, 2000) }).eq("id", runId);
    return j({ ok: false, run_id: runId, error: msg }, 500);
  }
});