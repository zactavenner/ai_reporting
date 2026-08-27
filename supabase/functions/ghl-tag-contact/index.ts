import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const INTERNAL_PASSWORD = "HPA1234$";
const GHL_BASE = "https://services.leadconnectorhq.com";
const GHL_VERSION = "2021-07-28";

async function ghl(path: string, init: RequestInit = {}) {
  const token = Deno.env.get("AGENCY_GHL_PIT_TOKEN") || Deno.env.get("AGENCY_GHL_API_KEY");
  if (!token) throw new Error("AGENCY_GHL_PIT_TOKEN missing");
  const res = await fetch(`${GHL_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Version: GHL_VERSION,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(`GHL ${res.status} ${path}: ${text.slice(0, 400)}`);
  return data;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const body = await req.json();
    if (body?.password !== INTERNAL_PASSWORD) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const tag: string = String(body.tag || "").trim();
    if (!tag) throw new Error("tag required");
    const locationId: string = body.location_id || Deno.env.get("AGENCY_GHL_LOCATION_ID") || "";
    if (!locationId) throw new Error("location_id missing");

    let contacts: any[] = [];
    if (body.contact_id) {
      const c = await ghl(`/contacts/${body.contact_id}`);
      if (c?.contact) contacts = [c.contact];
    } else {
      const query = String(body.query || body.name || body.email || "").trim();
      if (!query) throw new Error("query, name, email or contact_id required");
      const search = await ghl(
        `/contacts/?locationId=${encodeURIComponent(locationId)}&query=${encodeURIComponent(query)}&limit=20`,
      );
      contacts = search?.contacts || [];
    }

    if (contacts.length === 0) {
      return new Response(JSON.stringify({ ok: false, error: "no_contact_found", matches: 0 }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (contacts.length > 1 && !body.apply_all) {
      return new Response(JSON.stringify({
        ok: false,
        error: "multiple_matches",
        matches: contacts.map((c) => ({ id: c.id, name: `${c.firstName || ""} ${c.lastName || ""}`.trim() || c.contactName, email: c.email, phone: c.phone, tags: c.tags })),
      }), { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const results: any[] = [];
    for (const c of contacts) {
      const existing: string[] = Array.isArray(c.tags) ? c.tags : [];
      if (existing.some((t) => String(t).toLowerCase() === tag.toLowerCase())) {
        results.push({ contact_id: c.id, tag, status: "already_tagged", tags: existing });
        continue;
      }
      const nextTags = [...existing, tag];
      const updated = await ghl(`/contacts/${c.id}`, {
        method: "PUT",
        body: JSON.stringify({ tags: nextTags }),
      });
      results.push({
        contact_id: c.id,
        tag,
        status: "tagged",
        tags: updated?.contact?.tags || nextTags,
      });
    }

    return new Response(JSON.stringify({ ok: true, location_id: locationId, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: String(e?.message || e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
