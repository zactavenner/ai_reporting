// eod-to-hermes: forwards an EOD report from a team member directly to
// Zac's phone via SMS through the agency GoHighLevel sub-account.
// (Name kept for backwards compatibility with the EOD client invoker.)
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GHL_API = "https://services.leadconnectorhq.com";
// Conversations/messages endpoints want 2021-04-15; Contacts endpoints want 2021-07-28.
const GHL_VERSION_MESSAGES = "2021-04-15";
const GHL_VERSION_CONTACTS = "2021-07-28";

// Hard-coded fallback so the message lands even if agency_settings is empty.
const ZAC_PHONE_FALLBACK = "+19167097345";
const ZAC_NAME = "Zac";

async function ghlFetch(path: string, init: RequestInit, token: string, version: string) {
  return fetch(`${GHL_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Version: version,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
}

async function findOrCreateContact(
  locationId: string,
  token: string,
  phone: string,
  name: string,
): Promise<{ id: string | null; debug: string }> {
  let debug = "";
  // 1. Try lookup by phone
  try {
    const search = await ghlFetch(
      `/contacts/search/duplicate?locationId=${encodeURIComponent(locationId)}&number=${encodeURIComponent(phone)}`,
      { method: "GET" },
      token,
      GHL_VERSION_CONTACTS,
    );
    const sTxt = await search.text();
    if (search.ok) {
      const j = sTxt ? JSON.parse(sTxt) : {};
      const id = j?.contact?.id || j?.contacts?.[0]?.id;
      if (id) return { id, debug: "found via duplicate search" };
      debug += `dup-search ok no-id; `;
    } else {
      debug += `dup-search ${search.status}: ${sTxt.slice(0, 160)}; `;
    }
  } catch (e) {
    debug += `dup-search threw ${e instanceof Error ? e.message : e}; `;
  }

  // 2. Create
  try {
    const create = await ghlFetch(`/contacts/`, {
      method: "POST",
      body: JSON.stringify({
        locationId,
        phone,
        firstName: name,
        source: "EOD Bot",
      }),
    }, token, GHL_VERSION_CONTACTS);
    const cTxt = await create.text();
    if (create.ok) {
      const j = cTxt ? JSON.parse(cTxt) : {};
      const id = j?.contact?.id || j?.id || null;
      return { id, debug: debug + "created" };
    }
    // Duplicate? Try search again
    if (create.status === 400 || create.status === 409) {
      try {
        const j = JSON.parse(cTxt);
        const id = j?.meta?.contactId || j?.contact?.id;
        if (id) return { id, debug: debug + "dup-on-create" };
      } catch { /* noop */ }
    }
    debug += `create ${create.status}: ${cTxt.slice(0, 200)}; `;
  } catch (e) {
    debug += `create threw ${e instanceof Error ? e.message : e}; `;
  }
  return { id: null, debug };
}

async function sendGhlSms(locationId: string, token: string, contactId: string, message: string) {
  return ghlFetch(`/conversations/messages`, {
    method: "POST",
    body: JSON.stringify({
      type: "SMS",
      contactId,
      locationId,
      message,
    }),
  }, token, GHL_VERSION_MESSAGES);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supa = createClient(SUPABASE_URL, SERVICE_KEY);

    const GHL_TOKEN = Deno.env.get("AGENCY_GHL_API_KEY") || "";
    const GHL_LOCATION = Deno.env.get("AGENCY_GHL_LOCATION_ID") || "";

    const body = await req.json();
    const {
      member_name,
      wins,
      self_rating,
      touchpoints,
      team_feedback,
      client_touchpoints = [],
      completed_today = [],
      blocked = [],
      overdue = [],
    } = body || {};

    // Resolve Zac's number — prefer agency_members record, then settings, then fallback.
    let phone = ZAC_PHONE_FALLBACK;
    try {
      const { data: zac } = await supa
        .from("agency_members")
        .select("phone, name")
        .or("name.ilike.%zac%,name.ilike.%zach%")
        .limit(1)
        .maybeSingle();
      if (zac?.phone) phone = zac.phone as string;
    } catch { /* noop */ }

    // Compose human-friendly SMS text (kept short — GHL SMS will segment).
    const lines: string[] = [];
    lines.push(`📋 EOD — ${member_name} (${new Date().toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })})`);
    lines.push(`Day rating: ${self_rating ?? "—"}/10 · Touchpoints: ${touchpoints ?? 0}`);
    if (wins) lines.push(`\n✨ Win: ${wins}`);
    if (client_touchpoints.length) {
      lines.push(`\n👥 Clients:`);
      for (const c of client_touchpoints.slice(0, 12)) {
        const ch = (c.channels || []).join(", ");
        lines.push(`• ${c.client_name}: ${ch || "none"}`);
      }
    }
    if (completed_today.length) lines.push(`\n✅ Done (${completed_today.length})\n` + completed_today.slice(0, 6).map((t: any) => `• ${t.title}`).join("\n"));
    if (blocked.length) lines.push(`\n🚫 Stuck (${blocked.length})\n` + blocked.slice(0, 6).map((t: any) => `• ${t.title}${t.description ? ` — ${String(t.description).slice(0, 140)}` : ""}`).join("\n"));
    if (overdue.length) lines.push(`\n⏰ Overdue (${overdue.length})\n` + overdue.slice(0, 6).map((t: any) => `• ${t.title}`).join("\n"));
    if (team_feedback) lines.push(`\n🗣 Team feedback: ${team_feedback}`);
    const text = lines.join("\n");

    let delivered = false;
    let deliveryError: string | null = null;
    let contactId: string | null = null;

    if (!GHL_TOKEN || !GHL_LOCATION) {
      deliveryError = "Agency GHL not configured (missing AGENCY_GHL_API_KEY / AGENCY_GHL_LOCATION_ID)";
    } else {
      try {
        const r0 = await findOrCreateContact(GHL_LOCATION, GHL_TOKEN, phone, ZAC_NAME);
        contactId = r0.id;
        if (!contactId) throw new Error(`Failed to find or create GHL contact for Zac — ${r0.debug}`);
        const r = await sendGhlSms(GHL_LOCATION, GHL_TOKEN, contactId, text);
        delivered = r.ok;
        if (!r.ok) {
          const errBody = await r.text().catch(() => "");
          deliveryError = `GHL responded ${r.status}: ${errBody.slice(0, 300)}`;
        }
      } catch (e) {
        deliveryError = e instanceof Error ? e.message : String(e);
      }
    }

    // Always log so Joe sees it even if SMS delivery fails.
    await supa.from("slack_activity_log").insert({
      client_id: null,
      channel_id: null,
      action: "eod_sms_to_zac",
      details: { member_name, delivered, error: deliveryError, phone, contact_id: contactId, length: text.length },
    } as any).then(() => {}, () => {});

    return new Response(JSON.stringify({ ok: true, delivered, error: deliveryError, preview: text }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});