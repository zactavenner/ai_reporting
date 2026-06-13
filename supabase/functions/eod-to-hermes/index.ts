// eod-to-hermes: forwards an EOD report from a team member to Hermes,
// which fans it out to Joe's WhatsApp. Falls back gracefully when
// Hermes isn't configured.
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supa = createClient(SUPABASE_URL, SERVICE_KEY);

    const body = await req.json();
    const {
      member_name,
      wins,
      self_rating,
      touchpoints,
      touchpoint_notes,
      message_for_joe,
      completed_today = [],
      blocked = [],
      overdue = [],
    } = body || {};

    const { data: cfg } = await supa
      .from("agency_settings")
      .select("hermes_callback_url, hermes_enabled, whatsapp_owner_number, eod_send_to_hermes")
      .limit(1)
      .maybeSingle();

    const phone = cfg?.whatsapp_owner_number || "+19167097345";
    const callback = cfg?.hermes_callback_url;

    // Compose human-friendly WhatsApp text
    const lines: string[] = [];
    lines.push(`📋 *EOD — ${member_name}* (${new Date().toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })})`);
    lines.push(`Day rating: ${self_rating ?? "—"}/10 · Touchpoints: ${touchpoints ?? 0}`);
    if (wins) lines.push(`\n✨ *Win:* ${wins}`);
    if (completed_today.length) lines.push(`\n✅ *Done (${completed_today.length})*\n` + completed_today.slice(0, 6).map((t: any) => `• ${t.title}`).join("\n"));
    if (blocked.length) lines.push(`\n🚫 *Stuck (${blocked.length})*\n` + blocked.slice(0, 6).map((t: any) => `• ${t.title}${t.description ? ` — ${String(t.description).slice(0, 140)}` : ""}`).join("\n"));
    if (overdue.length) lines.push(`\n⏰ *Overdue (${overdue.length})*\n` + overdue.slice(0, 6).map((t: any) => `• ${t.title}`).join("\n"));
    if (touchpoint_notes) lines.push(`\n🗣 ${touchpoint_notes}`);
    if (message_for_joe) lines.push(`\n💬 *For Joe:* ${message_for_joe}`);
    const text = lines.join("\n");

    let delivered = false;
    let deliveryError: string | null = null;

    if (cfg?.eod_send_to_hermes !== false && cfg?.hermes_enabled && callback) {
      try {
        const r = await fetch(callback, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            event: "eod_report",
            channel: "whatsapp",
            to: phone,
            text,
            payload: { member_name, wins, self_rating, touchpoints, touchpoint_notes, message_for_joe, completed_today, blocked, overdue },
          }),
        });
        delivered = r.ok;
        if (!r.ok) deliveryError = `Hermes responded ${r.status}`;
      } catch (e) {
        deliveryError = e instanceof Error ? e.message : String(e);
      }
    } else {
      deliveryError = "Hermes not enabled or callback URL not configured";
    }

    // Always log so Joe sees it even if Hermes is down
    await supa.from("slack_activity_log").insert({
      client_id: null,
      channel_id: null,
      action: "eod_to_hermes",
      details: { member_name, delivered, error: deliveryError, phone, length: text.length },
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