// Sends Meta Conversions API events for qualifying lead_dispositions rows.
// Skips silently if a client has no meta_pixel_id. Exactly-once via capi_events_sent.lead_disposition_id UNIQUE.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { META_GRAPH_BASE } from "../_shared/meta.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const EVENT_MAP: Record<string, string> = {
  qualified: "QualifiedLead",
  booked: "BookedCall",
  showed: "ShowedCall",
  funded: "Funded",
};

async function sha256(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input.trim().toLowerCase());
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function normalizePhone(p: string): string {
  return p.replace(/[^0-9]/g, "");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const shared = Deno.env.get("META_SHARED_ACCESS_TOKEN")?.trim() || null;

  let body: any = {};
  try { body = await req.json(); } catch { /* empty */ }
  const lookbackHours = Math.max(1, Math.min(720, Number(body.lookback_hours ?? 24)));
  const since = new Date(Date.now() - lookbackHours * 3600_000).toISOString();

  const { data: dispositions, error } = await sb
    .from("lead_dispositions")
    .select("id, client_id, disposition, disposed_at, lead_id")
    .in("disposition", Object.keys(EVENT_MAP))
    .gte("disposed_at", since)
    .limit(2000);
  if (error) return new Response(JSON.stringify({ success: false, error: error.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  if (!dispositions?.length) {
    return new Response(JSON.stringify({ success: true, sent: 0, skipped: 0, failed: 0 }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  // Pre-filter: dispositions already sent
  const dispIds = dispositions.map((d) => d.id);
  const { data: alreadySent } = await sb.from("capi_events_sent").select("lead_disposition_id").in("lead_disposition_id", dispIds);
  const sentSet = new Set((alreadySent ?? []).map((r: any) => r.lead_disposition_id));

  // Client cache
  const clientIds = [...new Set(dispositions.map((d) => d.client_id).filter(Boolean))];
  const { data: clients } = await sb.from("clients").select("id, meta_pixel_id, meta_capi_access_token").in("id", clientIds);
  const clientMap = new Map((clients ?? []).map((c: any) => [c.id, c]));

  // Lead cache
  const leadIds = dispositions.map((d) => d.lead_id).filter(Boolean);
  const { data: leads } = await sb.from("leads").select("id, email, phone, custom_fields").in("id", leadIds);
  const leadMap = new Map((leads ?? []).map((l: any) => [l.id, l]));

  let sent = 0, skipped = 0, failed = 0;
  const byEvent: Record<string, number> = {};

  for (const d of dispositions) {
    if (sentSet.has(d.id)) continue;
    const eventName = EVENT_MAP[d.disposition];
    if (!eventName) { skipped++; continue; }
    const client = clientMap.get(d.client_id);
    if (!client?.meta_pixel_id) { skipped++; continue; }
    const token = (client.meta_capi_access_token as string | null)?.trim() || shared;
    if (!token) { skipped++; continue; }
    const lead = leadMap.get(d.lead_id);
    if (!lead) { skipped++; continue; }

    const user_data: Record<string, any> = {};
    if (lead.email) user_data.em = [await sha256(lead.email)];
    if (lead.phone) user_data.ph = [await sha256(normalizePhone(lead.phone))];
    const fbc = lead.custom_fields?.fbc || lead.custom_fields?.fbclid;
    const fbp = lead.custom_fields?.fbp;
    if (fbc) user_data.fbc = fbc;
    if (fbp) user_data.fbp = fbp;
    if (!user_data.em && !user_data.ph && !user_data.fbc) { skipped++; continue; }

    const url = `${META_GRAPH_BASE}/${client.meta_pixel_id}/events?access_token=${encodeURIComponent(token)}`;
    const payload = {
      data: [{
        event_name: eventName,
        event_time: Math.floor(new Date(d.disposed_at).getTime() / 1000),
        event_id: d.id,
        action_source: "system_generated",
        user_data,
      }],
    };

    let success = true;
    let respJson: any = null;
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      respJson = await res.json().catch(() => ({}));
      success = res.ok && !respJson?.error;
    } catch (e) {
      success = false;
      respJson = { error: (e as Error).message };
    }

    await sb.from("capi_events_sent").insert({
      lead_disposition_id: d.id,
      client_id: d.client_id,
      event_name: eventName,
      meta_response: respJson,
      success,
    }).then(() => {}).catch(() => {});

    if (success) { sent++; byEvent[eventName] = (byEvent[eventName] ?? 0) + 1; }
    else failed++;
  }

  return new Response(JSON.stringify({ success: true, since, scanned: dispositions.length, sent, skipped, failed, by_event: byEvent }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});