import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const INTERNAL_PASSWORD = "HPA1234$";
const GHL_BASE = "https://services.leadconnectorhq.com";
const GHL_VERSION = "2021-07-28";

async function ghl(path: string, init: RequestInit) {
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
  if (!res.ok) throw new Error(`GHL ${res.status}: ${text.slice(0, 400)}`);
  return data;
}

async function upsertContact(locationId: string, payload: { email?: string; phone?: string; name?: string }) {
  const body: any = {
    locationId,
    firstName: payload.name?.split(" ")[0],
    lastName: payload.name?.split(" ").slice(1).join(" ") || undefined,
  };
  if (payload.email) body.email = payload.email;
  if (payload.phone) body.phone = payload.phone;
  const data = await ghl(`/contacts/upsert`, { method: "POST", body: JSON.stringify(body) });
  return data?.contact?.id || data?.id;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const body = await req.json();
    if (body?.password !== INTERNAL_PASSWORD) {
      return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const { channel, to_email, to_phone, name, subject, html, text } = body;
    const locationId = Deno.env.get("AGENCY_GHL_LOCATION_ID");
    if (!locationId) throw new Error("AGENCY_GHL_LOCATION_ID missing");
    if (!["email", "sms"].includes(channel)) throw new Error("invalid channel");

    const contactId = await upsertContact(locationId, { email: to_email, phone: to_phone, name });
    if (!contactId) throw new Error("contact upsert failed");

    const msgBody: any = { contactId, type: channel === "email" ? "Email" : "SMS" };
    if (channel === "email") {
      msgBody.subject = subject || "Performance Recap";
      msgBody.html = html;
      msgBody.emailTo = to_email;
    } else {
      msgBody.message = text;
      msgBody.toNumber = to_phone;
    }
    const sent = await ghl(`/conversations/messages`, { method: "POST", body: JSON.stringify(msgBody) });
    return new Response(JSON.stringify({ ok: true, messageId: sent?.messageId || sent?.id, contactId }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e?.message || e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});