// Shared Meta Graph API helpers.
// - Pins API version in one place so we never drift to deprecated /v18, /v19.
// - Resolves the best access token for a client (System User → long-lived → master).
// - Wraps fetch with 429 / rate-limit (error subcode 2446079) exponential backoff.
//
// Import as:
//   import { META_API_VERSION, metaFetch, resolveMetaToken } from "../_shared/meta.ts";

export const META_API_VERSION = "v21.0";
export const META_GRAPH_BASE = `https://graph.facebook.com/${META_API_VERSION}`;

export interface MetaTokenClient {
  id?: string;
  meta_system_user_token?: string | null;
  meta_access_token?: string | null;
  meta_token_type?: string | null;
}

/**
 * Returns the best available token for a client.
 * Precedence: System User token → per-client long-lived token → shared master token.
 */
export function resolveMetaToken(client: MetaTokenClient | null | undefined): {
  token: string | null;
  source: "system_user" | "client" | "master" | "none";
} {
  const sys = client?.meta_system_user_token?.trim();
  if (sys) return { token: sys, source: "system_user" };
  const own = client?.meta_access_token?.trim();
  if (own) return { token: own, source: "client" };
  const master = Deno.env.get("META_SHARED_ACCESS_TOKEN")?.trim();
  if (master) return { token: master, source: "master" };
  return { token: null, source: "none" };
}

function parseRetryAfter(h: string | null): number | null {
  if (!h) return null;
  const n = Number(h);
  if (Number.isFinite(n)) return Math.max(0, n) * 1000;
  const t = Date.parse(h);
  if (Number.isFinite(t)) return Math.max(0, t - Date.now());
  return null;
}

function isMetaRateLimited(status: number, body: any): boolean {
  if (status === 429) return true;
  const err = body?.error;
  if (!err) return false;
  // App-level / ad-account-level throttling
  // 4 = APP rate limit, 17 = USER rate limit, 32 = page rate limit, 613 = custom rate
  // subcode 2446079 = ads insights rate limit
  if ([4, 17, 32, 613].includes(err.code)) return true;
  if (err.error_subcode === 2446079) return true;
  // 80004 / 80008 = ad insights throttling buckets
  if ([80000, 80001, 80002, 80003, 80004, 80008, 80014].includes(err.code)) return true;
  return false;
}

export interface MetaFetchOptions extends RequestInit {
  /** Max retry attempts on 429 / rate-limited responses. Default 4. */
  maxRetries?: number;
  /** Base backoff in ms. Default 1000ms (1s, 2s, 4s, 8s…). */
  baseBackoffMs?: number;
}

/**
 * fetch() that retries on Meta rate-limit responses with exponential backoff.
 * Returns the final Response (caller still inspects status). Throws only on network errors.
 */
export async function metaFetch(url: string, opts: MetaFetchOptions = {}): Promise<Response> {
  const { maxRetries = 4, baseBackoffMs = 1000, ...init } = opts;

  // Soft assert: callers should use META_GRAPH_BASE so deprecated versions can't sneak in.
  if (url.includes("graph.facebook.com/v")) {
    const m = url.match(/graph\.facebook\.com\/v(\d+)\.\d+/);
    const ver = m ? Number(m[1]) : null;
    if (ver && ver < 21) {
      console.warn(`[metaFetch] deprecated Meta API version v${ver} detected in url; upgrade to ${META_API_VERSION}`);
    }
  }

  let lastResp: Response | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const resp = await fetch(url, init);
    lastResp = resp;
    if (resp.ok) return resp;

    // Peek at body without consuming the original Response stream
    const clone = resp.clone();
    let body: any = null;
    try { body = await clone.json(); } catch { /* not JSON */ }

    const limited = isMetaRateLimited(resp.status, body);
    if (!limited || attempt === maxRetries) return resp;

    const retryAfter = parseRetryAfter(resp.headers.get("retry-after"))
      ?? parseRetryAfter(resp.headers.get("x-business-use-case-usage"));
    const backoff = retryAfter ?? baseBackoffMs * Math.pow(2, attempt) + Math.floor(Math.random() * 250);
    console.warn(`[metaFetch] rate-limited (status=${resp.status} code=${body?.error?.code}); retry ${attempt + 1}/${maxRetries} after ${backoff}ms`);
    await new Promise((r) => setTimeout(r, backoff));
  }
  return lastResp!;
}

/** Convenience: build a Graph URL on the pinned version. Caller passes path beginning with "/". */
export function metaUrl(path: string, params?: Record<string, string | number | undefined>): string {
  const u = new URL(`${META_GRAPH_BASE}${path.startsWith("/") ? path : `/${path}`}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null || v === "") continue;
      u.searchParams.set(k, String(v));
    }
  }
  return u.toString();
}