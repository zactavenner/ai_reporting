// Agency persona registry management (operator-gated).
//
// `agency_personas` holds persona MCP endpoints whose URL embeds a bearer token,
// so the table is service-role only and every read/write goes through here. The
// token is NEVER returned to the browser: list responses come from the masked
// `v_agency_personas` view.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { authorizeOperator } from "../_shared/operatorAuth.ts";
import { resolvePersona, maskPersonaUrl } from "../_shared/personas.ts";
import { askUtariPersona } from "../_shared/utariPersona.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-dashboard-token",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function slugify(input: string): string {
  return String(input || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function validEndpoint(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:";
  } catch {
    return false;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supa = createClient(SUPABASE_URL, SERVICE_KEY);
  let body: any = {};
  try {
    body = req.method === "POST" ? await req.json() : {};
  } catch {
    body = {};
  }

  const auth = await authorizeOperator(req, supa, createClient, body);
  if (!auth.ok) return json({ error: auth.error, code: auth.code }, auth.status);

  const action = String(body?.action || "list");

  try {
    if (action === "list") {
      const { data, error } = await supa
        .from("v_agency_personas")
        .select("*")
        .order("is_default", { ascending: false })
        .order("name", { ascending: true });
      if (error) throw error;
      return json({ personas: data ?? [] });
    }

    if (action === "upsert") {
      const name = String(body?.name || "").trim();
      if (!name) return json({ error: "name is required" }, 400);
      const slug = slugify(body?.slug || name);
      if (!slug) return json({ error: "slug could not be derived from name" }, 400);

      const mcpUrl = String(body?.mcp_url || "").trim();
      const isNew = !body?.id;
      if (isNew && !mcpUrl) return json({ error: "mcp_url is required" }, 400);
      if (mcpUrl && !validEndpoint(mcpUrl)) {
        return json({ error: "mcp_url must be an absolute https URL" }, 400);
      }

      const patch: Record<string, unknown> = {
        name,
        slug,
        description: body?.description ? String(body.description).slice(0, 2000) : null,
        is_active: body?.is_active !== false,
        updated_at: new Date().toISOString(),
      };
      // Empty mcp_url on an edit means "keep the stored endpoint".
      if (mcpUrl) patch.mcp_url = mcpUrl;

      const { data, error } = body?.id
        ? await supa.from("agency_personas").update(patch).eq("id", body.id).select("id, slug").maybeSingle()
        : await supa.from("agency_personas").insert(patch).select("id, slug").maybeSingle();
      if (error) throw error;

      if (body?.is_default === true && data?.id) {
        await supa.from("agency_personas").update({ is_default: false }).neq("id", data.id);
        await supa.from("agency_personas").update({ is_default: true }).eq("id", data.id);
      }
      return json({ ok: true, persona: data });
    }

    if (action === "set_default") {
      const id = String(body?.id || "");
      if (!id) return json({ error: "id is required" }, 400);
      await supa.from("agency_personas").update({ is_default: false }).neq("id", id);
      const { error } = await supa
        .from("agency_personas")
        .update({ is_default: true, is_active: true, updated_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
      return json({ ok: true });
    }

    if (action === "delete") {
      const id = String(body?.id || "");
      if (!id) return json({ error: "id is required" }, 400);
      const { data: row } = await supa
        .from("agency_personas")
        .select("is_default")
        .eq("id", id)
        .maybeSingle();
      if ((row as any)?.is_default) {
        return json({ error: "Set another persona as default before deleting this one" }, 400);
      }
      const { error } = await supa.from("agency_personas").delete().eq("id", id);
      if (error) throw error;
      return json({ ok: true });
    }

    if (action === "test") {
      const slug = body?.slug ? String(body.slug) : null;
      const persona = await resolvePersona(supa, slug);
      const started = Date.now();
      const r = await askUtariPersona({
        message: String(body?.message || "Connectivity check from the HPA reporting app. Reply with one short line."),
        mcpUrl: persona.mcpUrl,
        timeoutMs: 90_000,
      });
      return json({
        ok: true,
        persona: { slug: persona.slug, name: persona.name, endpoint: maskPersonaUrl(persona.mcpUrl) },
        reply: r.reply,
        polls: r.polls,
        elapsed_ms: Date.now() - started,
      });
    }

    return json({ error: `Unknown action "${action}"` }, 400);
  } catch (e: any) {
    return json({ error: e?.message || String(e) }, 500);
  }
});
