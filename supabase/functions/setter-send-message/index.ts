import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const INTERNAL_PASSWORD = "HPA1234$";
const GHL_BASE = "https://services.leadconnectorhq.com";
const GHL_VERSION = "2021-07-28";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const body = await req.json();
    if (body?.password !== INTERNAL_PASSWORD) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { client_id, lead_id, channel, to_email, to_phone, name, subject, text, html, sender_name } = body;
    if (!client_id) throw new Error("client_id required");
    if (!["sms", "email"].includes(channel)) throw new Error("channel must be sms|email");

    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: client, error: cErr } = await sb
      .from("clients")
      .select("id, name, ghl_api_key, ghl_location_id")
      .eq("id", client_id)
      .maybeSingle();
    if (cErr || !client) throw new Error("client not found");
    if (!client.ghl_api_key || !client.ghl_location_id) throw new Error("client missing GHL creds");

    // Upsert contact in this client's location
    const upsertBody: any = { locationId: client.ghl_location_id };
    if (name) {
      upsertBody.firstName = name.split(" ")[0];
      const rest = name.split(" ").slice(1).join(" ");
      if (rest) upsertBody.lastName = rest;
    }
    if (to_email) upsertBody.email = to_email;
    if (to_phone) upsertBody.phone = to_phone;

    const upsertRes = await fetch(`${GHL_BASE}/contacts/upsert`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${client.ghl_api_key}`,
        Version: GHL_VERSION,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(upsertBody),
    });
    const upsertText = await upsertRes.text();
    if (!upsertRes.ok) {
      return new Response(JSON.stringify({ error: `contact upsert failed [${upsertRes.status}]`, details: upsertText }), {
        status: upsertRes.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const upsertJson = upsertText ? JSON.parse(upsertText) : {};
    const contactId = upsertJson?.contact?.id || upsertJson?.id;
    if (!contactId) throw new Error("no contactId returned");

    const msgBody: any = { contactId, type: channel === "email" ? "Email" : "SMS" };
    if (channel === "email") {
      msgBody.subject = subject || "Following up";
      msgBody.html = html || (text ? `<p>${text.replace(/\n/g, "<br/>")}</p>` : "");
      if (to_email) msgBody.emailTo = to_email;
    } else {
      msgBody.message = text || "";
      if (to_phone) msgBody.toNumber = to_phone;
    }

    const sendRes = await fetch(`${GHL_BASE}/conversations/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${client.ghl_api_key}`,
        Version: GHL_VERSION,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(msgBody),
    });
    const sendText = await sendRes.text();
    if (!sendRes.ok) {
      return new Response(JSON.stringify({ error: `send failed [${sendRes.status}]`, details: sendText }), {
        status: sendRes.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const sendJson = sendText ? JSON.parse(sendText) : {};

    // Log to timeline so speed-to-lead reflects immediately
    if (lead_id) {
      await sb.from("contact_timeline_events").insert({
        client_id,
        lead_id,
        ghl_contact_id: contactId,
        event_type: channel === "email" ? "email" : "sms",
        event_subtype: "outbound",
        title: sender_name ? `Sent by ${sender_name}` : `Outbound ${channel}`,
        body: (text || subject || "").slice(0, 500),
        event_at: new Date().toISOString(),
        metadata: { via: "setter", messageId: sendJson?.messageId || sendJson?.id || null },
      });
    }

    return new Response(JSON.stringify({ ok: true, contactId, messageId: sendJson?.messageId || sendJson?.id || null }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("[setter-send-message]", e?.message || e);
    return new Response(JSON.stringify({ error: String(e?.message || e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});