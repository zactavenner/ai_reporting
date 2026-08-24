/**
 * Exact-model plumbing shared by Jeremy's executors and the generator endpoints.
 *
 * Rule: the model string that was QUOTED and APPROVED is the model string the
 * provider receives. There is no aliasing, no silent default and no fallback
 * chain on this path — an unknown or inactive model is refused before a single
 * credit is spent, and the provider request body is built from the exact model.
 *
 * All builders are pure so a test can inspect the outgoing request body and
 * prove byte-exact model equality without calling any provider.
 */

// deno-lint-ignore no-explicit-any
type Db = any;

export type ExactModelKind = "static_image" | "video";

/**
 * The allowlist is the agency-configured, ACTIVE price table — a model with no
 * active configured rate can neither be priced nor invoked.
 */
export async function loadActiveModelAllowlist(db: Db, kind: ExactModelKind): Promise<string[]> {
  const { data, error } = await db
    .from("jeremy_model_costs")
    .select("model, kind, is_active")
    .eq("kind", kind)
    .eq("is_active", true);
  if (error) throw new Error(`Could not load the configured model allowlist: ${error.message}`);
  return ((data ?? []) as Array<Record<string, unknown>>)
    .map((r) => String(r.model ?? "").trim())
    .filter((m) => m.length > 0);
}

/**
 * Returns the requested model unchanged when it is on the allowlist, otherwise
 * throws. Never substitutes, never lowercases, never maps.
 */
export function assertExactModelAllowed(kind: ExactModelKind, requested: unknown, allowlist: string[]): string {
  const model = String(requested ?? "").trim();
  if (!model) {
    throw new Error(`No exact ${kind} model was supplied; refusing to choose one implicitly.`);
  }
  if (!allowlist.length) {
    throw new Error(`No active ${kind} model is configured; refusing to invoke an unpriced model.`);
  }
  if (!allowlist.includes(model)) {
    throw new Error(
      `Model ${model} is not an active configured ${kind} model (allowed: ${allowlist.join(", ")}); refusing to invoke it.`,
    );
  }
  return model;
}

/** Convenience: load the allowlist and validate in one step. */
export async function resolveExactModel(db: Db, kind: ExactModelKind, requested: unknown): Promise<string> {
  return assertExactModelAllowed(kind, requested, await loadActiveModelAllowlist(db, kind));
}

// ─────────────────────────────────────────────────────────────────────────────
// Provider request builders — the model is copied through verbatim.
// ─────────────────────────────────────────────────────────────────────────────

export interface ImageRequestInput {
  exactModel: string;
  // deno-lint-ignore no-explicit-any
  contentParts: any[];
}

/**
 * OpenRouter chat-completions image request. `models` contains ONLY the exact
 * model: a fallback chain would mean the provider could run something other
 * than the approved model.
 */
export function buildExactImageRequest(input: ImageRequestInput): Record<string, unknown> {
  const model = String(input.exactModel ?? "").trim();
  if (!model) throw new Error("buildExactImageRequest requires an exact model.");
  return {
    model,
    models: [model],
    messages: [{ role: "user", content: input.contentParts }],
    modalities: ["image", "text"],
  };
}

export interface VideoRequestInput {
  exactModel: string;
  prompt: string;
  aspectRatio?: string | null;
  durationSeconds?: number | null;
  resolution?: string | null;
  firstFrameUrl?: string | null;
  lastFrameUrl?: string | null;
  referenceImageUrls?: string[] | null;
}

/**
 * OpenRouter /videos request. Hailuo/MiniMax and Seedance reject
 * `frame_images` and `reference_images` in the same call, so a request that asks
 * for both is refused loudly instead of silently dropping one.
 */
export function buildExactVideoRequest(input: VideoRequestInput): Record<string, unknown> {
  const model = String(input.exactModel ?? "").trim();
  if (!model) throw new Error("buildExactVideoRequest requires an exact model.");

  const frames: Array<Record<string, unknown>> = [];
  if (input.firstFrameUrl) {
    frames.push({ type: "image_url", image_url: { url: input.firstFrameUrl }, frame_type: "first_frame" });
  }
  if (input.lastFrameUrl) {
    frames.push({ type: "image_url", image_url: { url: input.lastFrameUrl }, frame_type: "last_frame" });
  }
  const references = (input.referenceImageUrls ?? []).filter((u) => typeof u === "string" && u.length > 0);
  if (frames.length && references.length) {
    throw new Error(
      "This model cannot accept pinned frame images and subject reference images in the same request; choose one.",
    );
  }

  const body: Record<string, unknown> = {
    model,
    prompt: String(input.prompt ?? "").trim() || "Cinematic short-form ad clip.",
    aspect_ratio: input.aspectRatio || "9:16",
    duration: Math.max(1, Math.min(30, Math.floor(Number(input.durationSeconds) || 5))),
    resolution: input.resolution || "1080p",
  };
  if (frames.length) body.frame_images = frames;
  if (references.length) body.reference_images = references.map((url) => ({ type: "image_url", image_url: { url } }));
  return body;
}

/**
 * Guard used by the callers of a generator: the receipt's model must equal the
 * model that was approved and requested.
 */
export function assertReceiptModelMatches(expected: string, receipt: Record<string, unknown> | null | undefined): void {
  const reported = String(receipt?.model ?? "").trim();
  if (!reported) {
    throw new Error(`The generator did not report which model it ran; ${expected} cannot be verified.`);
  }
  if (reported !== String(expected).trim()) {
    throw new Error(`Provider ran ${reported} but ${expected} was approved; refusing to accept the result.`);
  }
}
