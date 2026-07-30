import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { last10, toE164 } from "../_shared/phone.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-webhook-secret",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function pick<T = unknown>(obj: Record<string, any>, keys: string[]): T | null {
  for (const k of keys) {
    const v = k.split(".").reduce<any>((acc, part) => (acc == null ? acc : acc[part]), obj);
    if (v !== undefined && v !== null && v !== "") return v as T;
  }
  return null;
}

function normalizeDirection(raw: unknown): "inbound" | "outbound" {
  if (typeof raw === "string") return raw.toLowerCase().startsWith("in") ? "inbound" : "outbound";
  if (raw === 1) return "inbound";
  return "outbound";
}

function eventTypeFor(messageType: string): "sms" | "email" | "call" | "message" {
  const t = (messageType || "").toLowerCase();
  if (t.includes("email")) return "email";
  if (t.includes("call") || t.includes("voicemail")) return "call";
  if (t.includes("sms") || t.includes("whatsapp") || t.includes("gmb") || t.includes("ig") || t.includes("fb")) return "sms";
  return "message";
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const url = new URL(req.url);
    const expected = Deno.env.get("GHL_WEBHOOK_SECRET");
    if (expected) {
      const provided = req.headers.get("x-webhook-secret") || url.searchParams.get("k");
      if (provided !== expected) return json({ error: "unauthorized" }, 401);
    }

    const payload = await req.json().catch(() => ({}));
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const locationId = pick<string>(payload, ["locationId", "location_id", "location.id", "companyId"]);
    if (!locationId) return json({ error: "locationId missing" }, 400);

    const { data: client } = await sb
      .from("clients")
      .select("id")
      .eq("ghl_location_id", locationId)
      .maybeSingle();
    if (!client) {
      console.warn(`[ghl-conversation-webhook] unknown locationId ${locationId}`);
      return json({ ok: true, skipped: "unknown_location" });
    }

    const messageId = pick<string>(payload, ["messageId", "message_id", "id", "message.id"]);
    const contactId = pick<string>(payload, ["contactId", "contact_id", "contact.id"]);
    const messageType = String(pick<string>(payload, ["messageType", "message_type", "type", "message.type"]) || "SMS");
    const direction = normalizeDirection(pick(payload, ["direction", "message.direction"]));
    const bodyText = pick<string>(payload, ["body", "message", "message.body", "text", "snippet"]) || "";
    const subject = pick<string>(payload, ["subject", "message.subject"]);
    const phone = toE164(pick<string>(payload, ["phone", "from", "contact.phone", "call.to", "message.from"]));
    const email = pick<string>(payload, ["email", "contact.email"]);
    const status = pick<string>(payload, ["status", "message.status", "call.status", "deliveryStatus"]);
    const eventAt = pick<string>(payload, ["dateAdded", "date_added", "date", "timestamp"]) || new Date().toISOString();

    // Resolve the lead: ghl_contact_id first, then phone (last 10), then email.
    let leadId: string | null = null;
    if (contactId) {
      const { data } = await sb
        .from("leads")
        .select("id")
        .eq("client_id", client.id)
        .eq("ghl_contact_id", contactId)
        .maybeSingle();
      leadId = data?.id || null;
    }
    if (!leadId && phone) {
      const tail = last10(phone);
      if (tail) {
        const { data } = await sb
          .from("leads")
          .select("id")
          .eq("client_id", client.id)
          .ilike("phone", `%${tail}`)
          .order("created_at", { ascending: false })
          .limit(1);
        leadId = data?.[0]?.id || null;
      }
    }
    if (!leadId && email) {
      const { data } = await sb
        .from("leads")
        .select("id")
        .eq("client_id", client.id)
        .ilike("email", email)
        .order("created_at", { ascending: false })
        .limit(1);
      leadId = data?.[0]?.id || null;
    }

    const row = {
      client_id: client.id,
      lead_id: leadId,
      ghl_contact_id: contactId,
      event_type: eventTypeFor(messageType),
      event_subtype: direction,
      title: subject || (direction === "inbound" ? "Inbound message" : "Outbound message"),
      body: String(bodyText).slice(0, 2000),
      event_at: new Date(eventAt).toISOString(),
      metadata: {
        via: "ghl_webhook",
        provider: "ghl",
        ghl_message_id: messageId,
        messageType,
        status: status || null,
        phone,
        email,
        matched: leadId ? "lead" : "unmatched",
      },
    };

    if (messageId) {
      const { error } = await sb
        .from("contact_timeline_events")
        .upsert(row as any, { onConflict: "client_id,(metadata->>'ghl_message_id')", ignoreDuplicates: false });
      if (error) {
        // Fallback: index-based upsert targets are not always expressible; insert and ignore dupes.
        const { error: insErr } = await sb.from("contact_timeline_events").insert(row as any);
        if (insErr && !String(insErr.message).includes("duplicate")) throw insErr;
      }
    } else {
      const { error } = await sb.from("contact_timeline_events").insert(row as any);
      if (error) throw error;
    }

    return json({ ok: true, lead_id: leadId, matched: !!leadId });
  } catch (e) {
    console.error("[ghl-conversation-webhook]", (e as Error)?.message || e);
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});