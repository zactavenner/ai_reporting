/**
 * Model-credit spend boundary for the generation functions.
 *
 * These endpoints spend real model credits, so an unauthenticated public caller
 * must never reach them. Three identities are accepted, and nothing else:
 *
 *  1. the dashboard's HMAC-signed session token — the established agency UI auth;
 *  2. the service role key — internal server-to-server pipelines (Jeremy,
 *     Hermes, fulfilment, onboarding);
 *  3. the internal function password — the established internal pipeline secret
 *     used by functions that invoke each other with the anon key.
 *
 * The check runs BEFORE any provider key is read, and it never reveals which
 * identity was missing.
 */
import { verifyDashboardToken, readDashboardToken } from "./dashboardToken.ts";

export type GenerationCaller =
  | { ok: true; via: "dashboard" | "service_role" | "internal_secret"; actor: string }
  | { ok: false; status: 401; error: string };

function bearer(req: Request): string {
  const header = req.headers.get("Authorization") || "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
}

export async function authorizeGenerationCaller(req: Request, body?: unknown): Promise<GenerationCaller> {
  const payload = (body ?? {}) as Record<string, unknown>;

  const serviceKey = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "").trim();
  const token = bearer(req);
  if (serviceKey && token && token === serviceKey) {
    return { ok: true, via: "service_role", actor: "service_role" };
  }

  const internal = (Deno.env.get("INTERNAL_FUNCTION_PASSWORD") || "").trim();
  const provided = String(req.headers.get("x-internal-secret") || payload.internal_secret || payload.password || "").trim();
  if (internal && provided && provided === internal) {
    return { ok: true, via: "internal_secret", actor: "internal_pipeline" };
  }

  const dashboardToken = readDashboardToken(req, body);
  if (dashboardToken) {
    const member = await verifyDashboardToken(dashboardToken);
    if (member) return { ok: true, via: "dashboard", actor: `dashboard:${member.name ?? member.id}` };
  }

  return {
    ok: false,
    status: 401,
    error: "Unauthorized: generation requires an agency dashboard session or an internal service identity.",
  };
}
