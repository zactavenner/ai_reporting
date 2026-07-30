import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { toE164 } from "../_shared/phone.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const INTERNAL_PASSWORD = "HPA1234$";
const GHL_BASE = "https://services.leadconnectorhq.com";
const GHL_VERSION = "2021-07-28";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const body = await req.json();
    if (body?.password !== INTERNAL_PASSWORD) return json({ error: "unauthorized" }, 401);

    const { client_id, lead_id, to_phone, name, setter_name, setter_phone } = body;
    if (!client_id) throw new Error("client_id required");
    const toNumber = toE164(to_phone);
    if (!toNumber) throw new Error("valid destination phone required");

    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const [{ data: client }, { data: settings }] = await Promise.all([
      sb.from("clients").select("id, name, ghl_api_key, ghl_location_id").eq("id", client_id).maybeSingle(),
      sb
        .from("client_settings")
        .select("call_workflow_webhook_url, outbound_caller_number")
        .eq("client_id", client_id)
        .maybeSingle(),
    ]);
    if (!client) throw new Error("client not found");

    const fromNumber = toE164(settings?.outbound_caller_number) || null;
    const bridgeUrl = settings?.call_workflow_webhook_url || null;
    const agentPhone = toE164(setter_phone);

    // 1) Make sure the contact exists in the client's GHL location.
    let contactId: string | null = null;
    if (client.ghl_api_key && client.ghl_location_id) {
      const upsertBody: Record<string, unknown> = {
        locationId: client.ghl_location_id,
        phone: toNumber,
      };
      if (name) {
        upsertBody.firstName = String(name).split(" ")[0];
        const rest = String(name).split(" ").slice(1).join(" ");
        if (rest) upsertBody.lastName = rest;
      }
      const res = await fetch(`${GHL_BASE}/contacts/upsert`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${client.ghl_api_key}`,
          Version: GHL_VERSION,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(upsertBody),
      });
      const text = await res.text();
      if (res.ok) {
        const j = text ? JSON.parse(text) : {};
        contactId = j?.contact?.id || j?.id || null;
      } else {
        console.error(`[setter-place-call] contact upsert failed [${res.status}]: ${text.slice(0, 300)}`);
      }
    }

    // 2) Trigger the client's GHL bridge workflow (Inbound Webhook -> Call action).
    let bridged = false;
    let bridgeError: string | null = null;
    if (bridgeUrl) {
      if (!agentPhone) {
        bridgeError = "no setter callback phone on your profile";
      } else {
        try {
          const res = await fetch(bridgeUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contact_id: contactId,
              phone: toNumber,
              from_number: fromNumber,
              setter_phone: agentPhone,
              setter_name: setter_name || null,
              lead_id: lead_id || null,
              client_id,
              source: "reporting-setter",
            }),
          });
          const t = await res.text();
          if (!res.ok) bridgeError = `bridge webhook [${res.status}]: ${t.slice(0, 200)}`;
          else bridged = true;
        } catch (e) {
          bridgeError = String((e as Error)?.message || e);
        }
      }
    }

    const nowIso = new Date().toISOString();

    // 3) Log the attempt locally so the timeline + speed-to-lead update instantly.
    const { data: logged } = await sb
      .from("contact_timeline_events")
      .insert({
        client_id,
        lead_id: lead_id || null,
        ghl_contact_id: contactId,
        event_type: "call",
        event_subtype: "outbound",
        title: bridged
          ? `Dialing${setter_name ? ` · ${setter_name}` : ""}`
          : `Call started${setter_name ? ` · ${setter_name}` : ""} (device)`,
        body: null,
        event_at: nowIso,
        metadata: {
          via: "setter",
          mode: bridged ? "ghl_bridge" : "device",
          status: "dialing",
          to: toNumber,
          from: fromNumber,
          setter_phone: agentPhone,
          bridge_error: bridgeError,
        },
      })
      .select("id")
      .maybeSingle();

    // 4) Mirror the activity into GHL's conversation so both systems agree.
    if (contactId && client.ghl_api_key) {
      try {
        const res = await fetch(`${GHL_BASE}/conversations/messages/outbound`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${client.ghl_api_key}`,
            Version: GHL_VERSION,
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            type: "Call",
            conversationProviderId: undefined,
            contactId,
            date: nowIso,
            call: { to: toNumber, from: fromNumber || undefined, status: "pending" },
          }),
        });
        if (!res.ok) console.error(`[setter-place-call] GHL call log [${res.status}]: ${(await res.text()).slice(0, 300)}`);
      } catch (e) {
        console.error("[setter-place-call] GHL call log failed", (e as Error)?.message);
      }
    }

    return json({
      ok: true,
      mode: bridged ? "bridge" : "device",
      fallback: bridged ? null : "device",
      dial: toNumber,
      contactId,
      timeline_event_id: logged?.id || null,
      bridge_error: bridgeError,
    });
  } catch (e) {
    console.error("[setter-place-call]", (e as Error)?.message || e);
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});