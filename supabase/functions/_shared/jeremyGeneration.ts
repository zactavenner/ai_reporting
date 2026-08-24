/**
 * Jeremy real creative generation — derivative image/video production.
 *
 * Safety rules that are enforced deterministically, not by prompt wording:
 *  - competitor / scraped source media is NEVER passed as an image reference and
 *    never used as a video source frame; only the client's own approved assets
 *    or a Jeremy-generated image may be referenced;
 *  - a generation only happens for a persisted candidate with an approved,
 *    unexpired cost quote and a positive per-run + monthly policy cap;
 *  - the produced asset is copied to durable project storage BEFORE the
 *    candidate is marked generated, so no expiring provider URL is ever stored;
 *  - the actual cost and the provider receipt are always recorded.
 *
 * Providers and storage are injected, so tests exercise every branch without
 * calling a model or spending a cent.
 */
import {
  authorizeJobExecution,
  claimJob,
  completeJob,
  failJob,
  markJobRunning,
  type JeremyExternalJob,
  type JeremyJobKind,
} from "./jeremyExternalJobs.ts";
import type { JeremyPolicy } from "./jeremyPolicy.ts";

// deno-lint-ignore no-explicit-any
type Db = any;

export type GenerationKind = "static_image" | "video";

export const DURABLE_BUCKET = "creatives";

export const DEFAULT_IMAGE_MODEL = "google/gemini-3.1-flash-image-preview";
export const DEFAULT_VIDEO_MODEL = "bytedance/seedance-2.0";

const round2 = (v: number) => Math.round(v * 100) / 100;

export function jobKindFor(kind: GenerationKind): JeremyJobKind {
  return kind === "video" ? "video_generation" : "image_generation";
}

/**
 * A configured, versioned model price. Prices live in `jeremy_model_costs`
 * (agency-owned, service-role writable) — never in code constants — so a quote
 * always records where its number came from and refuses when it is unknown.
 */
export interface ModelRate {
  kind: GenerationKind;
  model: string;
  unit: "per_image" | "per_second";
  unitCostUsd: number;
  source: string;
  version: string;
}

export async function loadModelRates(db: Db, kind: GenerationKind): Promise<ModelRate[]> {
  const { data } = await db
    .from("jeremy_model_costs")
    .select("kind, model, unit, unit_cost_usd, cost_source, cost_version, is_active")
    .eq("kind", kind)
    .eq("is_active", true);
  return ((data ?? []) as Record<string, unknown>[])
    .map((r) => ({
      kind: String(r.kind) as GenerationKind,
      model: String(r.model),
      unit: String(r.unit) as ModelRate["unit"],
      unitCostUsd: Number(r.unit_cost_usd),
      source: String(r.cost_source || "jeremy_model_costs"),
      version: String(r.cost_version || "unversioned"),
    }))
    .filter((r) => r.model && Number.isFinite(r.unitCostUsd) && r.unitCostUsd > 0);
}

export async function loadModelRate(db: Db, kind: GenerationKind, model: string): Promise<ModelRate | null> {
  const rates = await loadModelRates(db, kind);
  return rates.find((r) => r.model === String(model)) ?? null;
}

/** The exact maximum cost of one generation from a configured rate. */
export function quoteGenerationCostUsd(rate: ModelRate | null, durationSeconds = 5): number {
  if (!rate || !Number.isFinite(rate.unitCostUsd) || rate.unitCostUsd <= 0) return NaN;
  if (rate.unit === "per_image") return round2(rate.unitCostUsd);
  const secs = Math.max(1, Math.min(30, Math.floor(Number(durationSeconds) || 0)));
  return round2(rate.unitCostUsd * secs);
}


// ─────────────────────────────────────────────────────────────────────────────
// Client-owned asset resolution
// ─────────────────────────────────────────────────────────────────────────────

export interface ClientBrandKit {
  client_id: string;
  brand_colors: string[];
  brand_fonts: string[];
  /** Only assets that belong to this client and are approved for reuse. */
  owned_asset_urls: string[];
  offer_description: string | null;
  destination_url: string | null;
  disclaimer: string | null;
}

export async function loadClientBrandKit(db: Db, clientId: string): Promise<ClientBrandKit> {
  const [{ data: settings }, { data: creatives }, { data: assets }] = await Promise.all([
    db.from("client_settings").select("*").eq("client_id", clientId).maybeSingle(),
    db
      .from("creatives")
      .select("id, file_url, status, client_id")
      .eq("client_id", clientId)
      .in("status", ["approved", "live", "ready"])
      .limit(20),
    db.from("client_assets").select("id, file_url, client_id").eq("client_id", clientId).limit(20),
  ]);

  const urls = [
    ...(creatives ?? []).map((c: Record<string, unknown>) => String(c.file_url ?? "")),
    ...(assets ?? []).map((a: Record<string, unknown>) => String(a.file_url ?? "")),
  ].filter((u) => /^https?:\/\//.test(u));

  const s = (settings ?? {}) as Record<string, unknown>;
  const colors = Array.isArray(s.brand_colors) ? (s.brand_colors as unknown[]).map(String) : [];
  const fonts = Array.isArray(s.brand_fonts) ? (s.brand_fonts as unknown[]).map(String) : [];
  return {
    client_id: clientId,
    brand_colors: colors,
    brand_fonts: fonts,
    owned_asset_urls: [...new Set(urls)],
    offer_description: (s.offer_description as string) ?? (s.offer_summary as string) ?? null,
    destination_url: (s.funnel_url as string) ?? (s.landing_page_url as string) ?? null,
    disclaimer: (s.compliance_disclaimer as string) ?? null,
  };
}

export interface MediaSafetyResult {
  ok: boolean;
  reason: string;
  /** The references that may actually be sent to the provider. */
  safe_reference_urls: string[];
  rejected: string[];
}

/**
 * The hard guard: a candidate's own `source_url` (and any scraped/competitor
 * media in its evidence) can never be sent to a provider as a reference or a
 * source frame. Only URLs in the client's owned-asset set are allowed through.
 */
export function assertClientOwnedMedia(
  candidate: { source_url?: string | null; source_type?: string | null; evidence?: Record<string, unknown> | null },
  requestedReferenceUrls: string[],
  ownedAssetUrls: string[],
): MediaSafetyResult {
  const forbidden = new Set<string>();
  if (candidate.source_url) forbidden.add(String(candidate.source_url));
  const ev = (candidate.evidence ?? {}) as Record<string, unknown>;
  for (const key of ["media", "thumbnail", "image_url", "video_url", "media_url"]) {
    if (ev[key]) forbidden.add(String(ev[key]));
  }
  const owned = new Set(ownedAssetUrls.filter(Boolean));
  const safe: string[] = [];
  const rejected: string[] = [];
  for (const url of requestedReferenceUrls.filter(Boolean)) {
    if (forbidden.has(url) || !owned.has(url)) rejected.push(url);
    else safe.push(url);
  }
  return {
    ok: rejected.length === 0,
    reason: rejected.length
      ? `Refusing to reference media that is not a client-owned approved asset: ${rejected.slice(0, 3).join(", ")}`
      : "All references are client-owned approved assets.",
    safe_reference_urls: safe,
    rejected,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Executors (injected)
// ─────────────────────────────────────────────────────────────────────────────

export interface ProviderOutput {
  url: string;
  receipt: Record<string, unknown>;
  actual_cost_usd?: number | null;
  provider_job_id?: string | null;
}

export interface GenerationExecutors {
  generateImage(input: {
    clientId: string;
    prompt: string;
    aspectRatio: string;
    model: string;
    brandColors: string[];
    brandFonts: string[];
    referenceImages: string[];
    disclaimer: string | null;
  }): Promise<ProviderOutput>;
  generateVideo(input: {
    clientId: string;
    prompt: string;
    aspectRatio: string;
    model: string;
    durationSeconds: number;
    sourceFrameUrl: string | null;
  }): Promise<ProviderOutput>;
  /** MUST copy the provider asset into durable project storage and return its permanent URL. */
  persistToDurableStorage(input: { url: string; clientId: string; candidateId: string; kind: GenerationKind }): Promise<string>;
}

export interface RunGenerationInput {
  clientId: string;
  jobId: string;
  candidateId: string;
  kind: GenerationKind;
  model: string;
  aspectRatio: string;
  durationSeconds?: number;
  actor: string;
  /** Optional client-owned references the operator chose; validated, never trusted. */
  referenceImageUrls?: string[];
}

export interface RunGenerationResult {
  success: boolean;
  reason: string;
  job_id: string;
  candidate_id: string;
  creative_url?: string;
  creative_id?: string;
  actual_cost_usd?: number | null;
  gates?: Array<{ gate: string; allowed: boolean; reason: string }>;
}

/** Turns the derivative brief into a provider prompt. Copy is the client's own. */
export function buildGenerationPrompt(candidate: Record<string, unknown>, kit: ClientBrandKit): string {
  const brief = (candidate.recreation_brief ?? {}) as Record<string, unknown>;
  const mech = (brief.mechanism ?? {}) as Record<string, unknown>;
  const guardrails = Array.isArray(brief.guardrails) ? (brief.guardrails as unknown[]).map(String) : [];
  return [
    `Create an original ${mech.format ?? "ad creative"} for this advertiser.`,
    `Hook/angle to express in the advertiser's OWN words: ${mech.hook ?? candidate.title ?? ""}`,
    `Message: ${mech.angle ?? ""}`,
    `Proof structure: ${mech.proof_structure ?? ""}`,
    `Pacing: ${mech.pacing ?? ""}`,
    kit.offer_description ? `Offer: ${kit.offer_description}` : "",
    kit.brand_colors.length ? `Brand colors: ${kit.brand_colors.join(", ")}` : "",
    `${brief.derivative_instructions ?? "Recreate the mechanism only; never reproduce another advertiser's assets, branding or likeness."}`,
    guardrails.length ? `Hard guardrails: ${guardrails.join(" ")}` : "",
    kit.disclaimer ? `Include this disclaimer verbatim: ${kit.disclaimer}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Executes ONE approved generation job end-to-end and writes a usable creative
 * back to the candidate plus a normal `creatives` row.
 */
export async function runGenerationJob(
  db: Db,
  policy: JeremyPolicy,
  executors: GenerationExecutors,
  input: RunGenerationInput,
): Promise<RunGenerationResult> {
  const kindKey = jobKindFor(input.kind);
  const target = generationTarget(input);

  const auth = await authorizeJobExecution(db, policy, input.jobId, {
    clientId: input.clientId,
    kind: kindKey,
    target,
    actor: input.actor,
  });
  if (!auth.allowed) {
    return { success: false, reason: auth.reason, job_id: input.jobId, candidate_id: input.candidateId, gates: auth.gates };
  }

  const { data: candidate } = await db
    .from("jeremy_creative_candidates")
    .select("*")
    .eq("id", input.candidateId)
    .eq("client_id", input.clientId)
    .maybeSingle();
  if (!candidate) {
    return { success: false, reason: "Candidate not found for this client.", job_id: input.jobId, candidate_id: input.candidateId, gates: auth.gates };
  }

  const kit = await loadClientBrandKit(db, input.clientId);
  const safety = assertClientOwnedMedia(candidate, input.referenceImageUrls ?? [], kit.owned_asset_urls);
  if (!safety.ok) {
    return { success: false, reason: safety.reason, job_id: input.jobId, candidate_id: input.candidateId, gates: [...auth.gates, { gate: "media_provenance", allowed: false, reason: safety.reason }] };
  }
  const gates = [...auth.gates, { gate: "media_provenance", allowed: true, reason: safety.reason }];

  // Video source frames must be Jeremy-generated or client-owned — never the source ad.
  let sourceFrameUrl: string | null = null;
  if (input.kind === "video") {
    const generated = candidate.generation_reference ? String(candidate.generation_reference) : null;
    const candidateFrame = generated ?? safety.safe_reference_urls[0] ?? kit.owned_asset_urls[0] ?? null;
    if (candidateFrame && candidate.source_url && candidateFrame === String(candidate.source_url)) {
      const reason = "Refusing to use the competitor source media as a video source frame.";
      return { success: false, reason, job_id: input.jobId, candidate_id: input.candidateId, gates: [...gates, { gate: "video_source_frame", allowed: false, reason }] };
    }
    sourceFrameUrl = candidateFrame;
    gates.push({
      gate: "video_source_frame",
      allowed: true,
      reason: sourceFrameUrl ? "Source frame is a Jeremy-generated or client-owned asset." : "No source frame; text-to-video.",
    });
  }

  const claimed = await claimJob(db, input.jobId, input.actor);
  if (!claimed) {
    return { success: false, reason: "Job was already claimed or executed by another request (idempotency).", job_id: input.jobId, candidate_id: input.candidateId, gates };
  }

  try {
    await markJobRunning(db, input.jobId, null);
    await db.from("jeremy_creative_candidates").update({ generation_status: "generating" }).eq("id", input.candidateId);

    const prompt = buildGenerationPrompt(candidate, kit);
    const output = input.kind === "static_image"
      ? await executors.generateImage({
        clientId: input.clientId,
        prompt,
        aspectRatio: input.aspectRatio,
        model: input.model,
        brandColors: kit.brand_colors,
        brandFonts: kit.brand_fonts,
        referenceImages: safety.safe_reference_urls,
        disclaimer: kit.disclaimer,
      })
      : await executors.generateVideo({
        clientId: input.clientId,
        prompt,
        aspectRatio: input.aspectRatio,
        model: input.model,
        durationSeconds: Math.max(1, Math.min(30, Number(input.durationSeconds) || 5)),
        sourceFrameUrl,
      });

    if (!output?.url) throw new Error("Provider returned no asset URL.");

    // Durable storage BEFORE anything is marked generated.
    const durableUrl = await executors.persistToDurableStorage({
      url: output.url,
      clientId: input.clientId,
      candidateId: input.candidateId,
      kind: input.kind,
    });
    if (!durableUrl || !/^https?:\/\//.test(durableUrl)) {
      throw new Error("Durable storage did not return a permanent URL; refusing to mark the candidate generated.");
    }

    const actualCost = Number.isFinite(Number(output.actual_cost_usd))
      ? round2(Number(output.actual_cost_usd))
      : Number(auth.job?.estimated_cost_usd ?? NaN);

    const { data: creative } = await db
      .from("creatives")
      .insert({
        client_id: input.clientId,
        title: `[Jeremy] ${String(candidate.title ?? "Derivative creative").slice(0, 100)}`,
        file_url: durableUrl,
        creative_type: input.kind === "video" ? "video" : "image",
        status: "pending_review",
        headline: ((candidate.recreation_brief as Record<string, any>)?.mechanism?.hook ?? candidate.title ?? "").toString().slice(0, 255),
        body_copy: ((candidate.recreation_brief as Record<string, any>)?.mechanism?.angle ?? "").toString().slice(0, 2000),
        source: "jeremy_autonomous",
      })
      .select("id")
      .maybeSingle();

    await db
      .from("jeremy_creative_candidates")
      .update({
        generation_status: "generated",
        generation_reference: durableUrl,
        actual_cost_usd: Number.isFinite(actualCost) ? actualCost : null,
        evidence: { ...(candidate.evidence ?? {}), generation: { model: input.model, kind: input.kind, creative_id: creative?.id ?? null, durable_url: durableUrl } },
      })
      .eq("id", input.candidateId);

    await completeJob(db, input.jobId, {
      status: "succeeded",
      actualCostUsd: Number.isFinite(actualCost) ? actualCost : null,
      providerJobId: output.provider_job_id ?? null,
      providerResponse: output.receipt ?? null,
      verification: { durable_url: durableUrl, durable_storage: true, creative_id: creative?.id ?? null },
      resultSummary: { candidate_id: input.candidateId, kind: input.kind, model: input.model },
    });

    return {
      success: true,
      reason: "Generated, persisted to durable storage and written back to the candidate.",
      job_id: input.jobId,
      candidate_id: input.candidateId,
      creative_url: durableUrl,
      creative_id: creative?.id ? String(creative.id) : undefined,
      actual_cost_usd: Number.isFinite(actualCost) ? actualCost : null,
      gates,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await failJob(db, input.jobId, message);
    await db.from("jeremy_creative_candidates").update({ generation_status: "failed" }).eq("id", input.candidateId);
    return { success: false, reason: message, job_id: input.jobId, candidate_id: input.candidateId, gates };
  }
}

/** The exact target descriptor a generation quote binds to. */
export function generationTarget(input: {
  candidateId: string;
  kind: GenerationKind;
  model: string;
  aspectRatio: string;
  durationSeconds?: number;
}): Record<string, unknown> {
  return {
    candidate_id: input.candidateId,
    kind: input.kind,
    model: input.model,
    aspect_ratio: input.aspectRatio,
    duration_seconds: input.kind === "video" ? Math.max(1, Math.min(30, Number(input.durationSeconds) || 5)) : null,
  };
}

/** Only a model with a configured, active price may be selected. */
export async function pickGenerationModel(db: Db, kind: GenerationKind, requested?: unknown): Promise<string | null> {
  const rates = await loadModelRates(db, kind);
  if (!rates.length) return null;
  const wanted = String(requested ?? "");
  if (rates.some((r) => r.model === wanted)) return wanted;
  const fallback = kind === "static_image" ? DEFAULT_IMAGE_MODEL : DEFAULT_VIDEO_MODEL;
  return rates.some((r) => r.model === fallback) ? fallback : rates[0].model;
}

