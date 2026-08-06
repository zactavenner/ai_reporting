// OpenRouter video-job response mapping for the H3 run manager.
//
// These jobs are submitted through OpenRouter (not directly to MiniMax), and
// this module holds the pure, side-effect-free half of the polling contract so
// it can be unit-tested against real recorded provider payloads. It contains no
// credentials and no Deno/network APIs.

/** Shape actually returned by GET https://openrouter.ai/api/v1/videos/{id}. */
export type OpenRouterVideoJob = {
  id?: string;
  generation_id?: string;
  polling_url?: string;
  status?: string;
  unsigned_urls?: unknown;
  signed_urls?: unknown;
  urls?: unknown;
  content?: unknown;
  output?: unknown;
  error?: unknown;
  usage?: { cost?: number; is_byok?: boolean };
};

/** Read-only poll endpoint for an already-submitted job. Never a POST target. */
export const openRouterPollUrl = (jobId: string) =>
  `https://openrouter.ai/api/v1/videos/${encodeURIComponent(jobId)}`;

const isHttpUrl = (v: unknown): v is string =>
  typeof v === "string" && /^https?:\/\//.test(v);

/**
 * The authorized OpenRouter content URL for this job. It 401s without the
 * server key, so it is a server-side handle and not browser-playable.
 */
export function extractContentUrl(payload: OpenRouterVideoJob): string | null {
  for (const c of [payload?.unsigned_urls, payload?.signed_urls, payload?.urls, payload?.content, payload?.output]) {
    if (isHttpUrl(c)) return c;
    if (Array.isArray(c)) {
      for (const item of c) {
        if (isHttpUrl(item)) return item;
        const nested = (item as any)?.url ?? (item as any)?.video?.url;
        if (isHttpUrl(nested)) return nested;
      }
    }
  }
  return null;
}

export function extractProviderError(payload: OpenRouterVideoJob): string | null {
  const e = payload?.error;
  if (!e) return null;
  return (typeof e === "string" ? e : JSON.stringify(e)).slice(0, 400);
}

export function extractCostUsd(payload: OpenRouterVideoJob): number | null {
  const cost = payload?.usage?.cost;
  return typeof cost === "number" ? cost : null;
}

export type H3ProviderState = "submitted" | "rendering" | "downloaded";

/**
 * Normalized workflow state from an OpenRouter status.
 *   pending     -> Submitted (holds position)
 *   in_progress -> Rendering
 *   completed   -> Downloaded, ONLY when a downloadable source asset is
 *                  actually confirmed present. A bare "completed" claim with no
 *                  verified asset never advances the record.
 * Returns null to mean "hold where you are".
 */
export function nextWorkflowState(args: {
  current: string;
  providerStatus: string;
  assetVerified: boolean;
}): H3ProviderState | null {
  const { current, providerStatus, assetVerified } = args;
  if (current !== "submitted" && current !== "rendering") return null;
  const status = (providerStatus ?? "").toLowerCase();

  if (status === "completed") return assetVerified ? "downloaded" : null;
  if (/in_progress|processing|rendering|running/.test(status)) {
    return current === "submitted" ? "rendering" : null;
  }
  return null; // pending, queued, failed, unknown -> hold
}

/** Content-types we accept as a real downloadable render. */
export function isVideoContentType(type: string): boolean {
  return /^(video|application\/octet-stream|binary)/i.test(type ?? "");
}
