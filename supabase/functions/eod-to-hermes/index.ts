// eod-to-hermes: forwards an EOD report from a team member directly to
// Zac's phone via SMS through the agency GoHighLevel sub-account.
// Uses the GHL v2 LeadConnector API with a Private Integration Token (PIT).
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GHL_API = "https://services.leadconnectorhq.com";
const GHL_VERSION = "2021-07-28";
const ZAC_PHONE_FALLBACK = "+19167097345";
const ZAC_NAME = "Zac";

async function ghlFetch(path: string, init: RequestInit, token: string) {
  return fetch(`${GHL_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Version: GHL_VERSION,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
}

async function findOrCreateContact(token: string, locationId: string, phone: string, name: string): Promise<{ id: string | null; debug: string }> {
  let debug = "";
  try {
    const res = await ghlFetch(`/contacts/upsert`, {
      method: "POST",
      body: JSON.stringify({ locationId, phone, firstName: name, source: "EOD Bot" }),
    }, token);
    const txt = await res.text();
    if (res.ok) {
      const j = txt ? JSON.parse(txt) : {};
      const id = j?.contact?.id || j?.id || null;
      return { id, debug: "upsert ok" };
    }
    debug += `upsert ${res.status}: ${txt.slice(0, 240)}; `;
  } catch (e) {
    debug += `upsert threw ${e instanceof Error ? e.message : e}; `;
  }
  return { id: null, debug };
}

async function sendGhlSms(token: string, contactId: string, message: string) {
  return ghlFetch(`/conversations/messages`, {
    method: "POST",
    body: JSON.stringify({ type: "SMS", contactId, message }),
  }, token);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supa = createClient(SUPABASE_URL, SERVICE_KEY);

    const GHL_TOKEN = Deno.env.get("AGENCY_GHL_PIT_TOKEN") || Deno.env.get("AGENCY_GHL_API_KEY") || "";
    const GHL_LOCATION_ID = Deno.env.get("AGENCY_GHL_LOCATION_ID") || "";

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

    // Resolve Zac's number — prefer agency_members record, fallback hard-coded.
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

    if (!GHL_TOKEN) {
      deliveryError = "Agency GHL not configured (missing AGENCY_GHL_PIT_TOKEN)";
    } else if (!GHL_LOCATION_ID) {
      deliveryError = "Agency GHL not configured (missing AGENCY_GHL_LOCATION_ID)";
    } else {
      try {
        const r0 = await findOrCreateContact(GHL_TOKEN, GHL_LOCATION_ID, phone, ZAC_NAME);
        contactId = r0.id;
        if (!contactId) throw new Error(`Failed to find or create GHL contact — ${r0.debug}`);
        const r = await sendGhlSms(GHL_TOKEN, contactId, text);
        delivered = r.ok;
        if (!r.ok) {
          const errBody = await r.text().catch(() => "");
          deliveryError = `GHL SMS ${r.status}: ${errBody.slice(0, 300)}`;
        }
      } catch (e) {
        deliveryError = e instanceof Error ? e.message : String(e);
      }
    }

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
