/**
 * Agency persona registry (server side).
 *
 * Persona MCP endpoints used to be hardcoded in edge function source. They are
 * now rows in `public.agency_personas` (service-role only, because the endpoint
 * URL embeds a bearer token), so an operator can add / rotate / switch personas
 * from Settings → Personas without a code change.
 *
 * Resolution order: explicit slug → the persona flagged default → the single
 * active persona → the `PERSONA_MCP_URL` env fallback. If nothing resolves we
 * fail loudly instead of silently talking to some other persona.
 */

export type AgencyPersona = {
  id: string | null;
  slug: string;
  name: string;
  mcpUrl: string;
};

export class PersonaNotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PersonaNotConfiguredError";
  }
}

function envFallback(): AgencyPersona | null {
  const url = (Deno.env.get("PERSONA_MCP_URL") || "").trim();
  if (!url) return null;
  return { id: null, slug: "env", name: "Configured endpoint (env)", mcpUrl: url };
}

/** Load one persona by slug (or the default) using a service-role client. */
export async function resolvePersona(
  supa: any,
  slug?: string | null,
): Promise<AgencyPersona> {
  const wanted = (slug || "").trim();

  if (wanted) {
    const { data } = await supa
      .from("agency_personas")
      .select("id, slug, name, mcp_url, is_active")
      .eq("slug", wanted)
      .maybeSingle();
    if (data?.mcp_url && data.is_active !== false) {
      return { id: data.id, slug: data.slug, name: data.name, mcpUrl: data.mcp_url };
    }
  }

  const { data: rows } = await supa
    .from("agency_personas")
    .select("id, slug, name, mcp_url, is_default")
    .eq("is_active", true)
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(1);
  const row = Array.isArray(rows) ? rows[0] : null;
  if (row?.mcp_url) {
    return { id: row.id, slug: row.slug, name: row.name, mcpUrl: row.mcp_url };
  }

  const fallback = envFallback();
  if (fallback) return fallback;

  throw new PersonaNotConfiguredError(
    wanted
      ? `Persona "${wanted}" is not configured or is inactive. Add it in Settings → Personas.`
      : "No active persona endpoint is configured. Add one in Settings → Personas.",
  );
}

/** Never log or return the token portion of a persona endpoint. */
export function maskPersonaUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return "(invalid url)";
  }
}

/**
 * Persist the persona-side conversation id for a (agent, client, persona) scope.
 * The uniqueness index is an expression index (COALESCE on client_id), which
 * PostgREST upsert can't target, so we update-then-insert instead.
 */
export async function savePersonaConversation(
  supa: any,
  opts: { agentId: string; clientId: string | null; personaSlug: string; conversationId: string },
): Promise<void> {
  const now = new Date().toISOString();
  const match = supa
    .from("agent_mcp_conversations")
    .update({ conversation_id: opts.conversationId, updated_at: now })
    .eq("agent_id", opts.agentId)
    .eq("persona_slug", opts.personaSlug);
  const { data } = await (opts.clientId
    ? match.eq("client_id", opts.clientId)
    : match.is("client_id", null)
  ).select("id");
  if (Array.isArray(data) && data.length > 0) return;
  await supa.from("agent_mcp_conversations").insert({
    agent_id: opts.agentId,
    client_id: opts.clientId,
    persona_slug: opts.personaSlug,
    conversation_id: opts.conversationId,
    updated_at: now,
  });
}

