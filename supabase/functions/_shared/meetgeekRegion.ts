// Server-only MeetGeek regional endpoint resolver.
//
// MeetGeek API keys are region-scoped and the DEFAULT account region is Europe
// (https://api.meetgeek.ai). Keys are not guaranteed to carry any region prefix,
// so prefix guessing is unsafe: a US-region key silently 401s against EU and
// vice versa. This module resolves the correct base URL once per isolate by
// probing an authenticated meeting read, EU first, then US only when the failure
// looks like a regional mismatch (401/403/404).
//
// Nothing here ever logs, returns or embeds the API key or a provider response
// body — callers receive only a base URL, a region label and a safe code.

export type MeetgeekRegion = 'eu' | 'us';

export const MEETGEEK_BASE_URLS: Record<MeetgeekRegion, string> = {
  // Documented default endpoint (Europe).
  eu: 'https://api.meetgeek.ai',
  us: 'https://api-us.meetgeek.ai',
};

/** Probe order: documented default first, US only as a mismatch fallback. */
export const MEETGEEK_REGION_ORDER: MeetgeekRegion[] = ['eu', 'us'];

export function normalizeMeetgeekRegion(value: unknown): MeetgeekRegion | null {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return null;
  if (raw === 'eu' || raw === 'europe' || raw === 'api-eu' || raw === 'api.meetgeek.ai') return 'eu';
  if (raw === 'us' || raw === 'usa' || raw === 'api-us' || raw === 'api-us.meetgeek.ai') return 'us';
  return null;
}

export function regionBaseUrl(region: MeetgeekRegion): string {
  return MEETGEEK_BASE_URLS[region];
}

/**
 * Only an authentication/not-found style status may trigger the alternate
 * region. Network errors, 429 and 5xx are transient/provider-side: retrying the
 * other region would double the load and can mislabel the account region.
 */
export function isRegionalMismatch(probe: MeetgeekProbeResult): boolean {
  if (probe.ok) return false;
  if (probe.errorKind) return false; // network / parse
  const s = Number(probe.status || 0);
  return s === 401 || s === 403 || s === 404;
}

export interface MeetgeekProbeResult {
  ok: boolean;
  status?: number | null;
  errorKind?: 'network' | 'parse' | null;
  /** Parsed body when the probe succeeded (never logged by this module). */
  body?: unknown;
}

export interface MeetgeekRegionResolution {
  region: MeetgeekRegion;
  baseUrl: string;
  /** 'explicit' when MEETGEEK_REGION pinned it, otherwise 'probe'. */
  source: 'explicit' | 'probe';
  /** Successful probe body, so the caller need not re-fetch the meeting. */
  body?: unknown;
  /** Last failing probe, for safe diagnostics when resolution failed. */
  failure?: MeetgeekProbeResult | null;
  ok: boolean;
}

/**
 * Resolves the base URL for an authenticated MeetGeek read.
 *
 * - `explicitRegion` (from MEETGEEK_REGION) short-circuits all probing.
 * - Otherwise probes EU, then US ONLY on a regional-mismatch status.
 */
export async function resolveMeetgeekRegion(args: {
  explicitRegion?: unknown;
  probe: (baseUrl: string, region: MeetgeekRegion) => Promise<MeetgeekProbeResult>;
}): Promise<MeetgeekRegionResolution> {
  const explicit = normalizeMeetgeekRegion(args.explicitRegion);
  if (explicit) {
    return { region: explicit, baseUrl: regionBaseUrl(explicit), source: 'explicit', ok: true };
  }

  let failure: MeetgeekProbeResult | null = null;
  for (let i = 0; i < MEETGEEK_REGION_ORDER.length; i += 1) {
    const region = MEETGEEK_REGION_ORDER[i];
    const result = await args.probe(regionBaseUrl(region), region);
    if (result.ok) {
      return {
        region,
        baseUrl: regionBaseUrl(region),
        source: 'probe',
        body: result.body,
        ok: true,
      };
    }
    failure = result;
    // Transient/provider-side failures must NOT flip regions.
    if (!isRegionalMismatch(result)) break;
  }

  return {
    region: MEETGEEK_REGION_ORDER[0],
    baseUrl: regionBaseUrl(MEETGEEK_REGION_ORDER[0]),
    source: 'probe',
    ok: false,
    failure,
  };
}

/**
 * Per-isolate memo of a successfully resolved region so subsequent reads
 * (insights, summary, transcript pages) never re-probe.
 */
const cache = new Map<string, MeetgeekRegion>();

/** Fingerprint must never be the key itself. */
export function regionCacheKey(keyFingerprint: string): string {
  return `mg:${keyFingerprint}`;
}

export function getCachedRegion(keyFingerprint: string): MeetgeekRegion | null {
  return cache.get(regionCacheKey(keyFingerprint)) ?? null;
}

export function setCachedRegion(keyFingerprint: string, region: MeetgeekRegion): void {
  cache.set(regionCacheKey(keyFingerprint), region);
}

export function clearRegionCache(): void {
  cache.clear();
}

/** Non-reversible, short fingerprint used only as a cache key. */
export async function fingerprintApiKey(apiKey: string): Promise<string> {
  try {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(apiKey));
    return Array.from(new Uint8Array(buf)).slice(0, 6)
      .map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return `len${apiKey.length}`;
  }
}
