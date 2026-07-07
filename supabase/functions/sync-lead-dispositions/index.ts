// Hourly disposition sync. Reads leads with a recent ghl_synced_at and applies
// disposition_mappings against opportunity_stage / tags / custom_fields.
// Inserts a lead_dispositions row on change and updates leads.current_disposition.
// Additive only — does not modify GHL sync functions.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface Mapping {
  client_id: string | null;
  match_type: "stage_contains" | "tag_equals" | "field_equals";
  match_value: string;
  disposition: string;
}

function extractTags(cf: any): string[] {
  if (!cf) return [];
  const tags: string[] = [];
  const push = (v: any) => {
    if (typeof v === "string") tags.push(v.toLowerCase());
    else if (Array.isArray(v)) v.forEach(push);
  };
  if (Array.isArray(cf?.tags)) push(cf.tags);
  if (typeof cf?.tags === "string") push(cf.tags);
  return tags;
}

function resolveDisposition(
  lead: any,
  mappings: Mapping[],
): { disposition: string; reason: string } | null {
  const stage = (lead.opportunity_stage ?? "").toLowerCase();
  const status = (lead.opportunity_status ?? "").toLowerCase();
  const tags = extractTags(lead.custom_fields);

  // client-specific overrides first
  const sorted = [...mappings].sort((a, b) => (a.client_id ? -1 : 1) - (b.client_id ? -1 : 1));

  for (const m of sorted) {
    if (m.client_id && m.client_id !== lead.client_id) continue;
    const val = m.match_value.toLowerCase();
    if (m.match_type === "stage_contains") {
      if (stage.includes(val) || status.includes(val)) {
        return { disposition: m.disposition, reason: `stage:${lead.opportunity_stage ?? lead.opportunity_status}` };
      }
    } else if (m.match_type === "tag_equals") {
      if (tags.includes(val)) return { disposition: m.disposition, reason: `tag:${val}` };
    } else if (m.match_type === "field_equals") {
      const cf = lead.custom_fields ?? {};
      for (const [k, v] of Object.entries(cf)) {
        if (typeof v === "string" && v.toLowerCase() === val) return { disposition: m.disposition, reason: `field:${k}` };
      }
    }
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  let body: any = {};
  try { body = await req.json(); } catch { /* empty */ }
  const lookbackHours = Math.max(1, Math.min(720, Number(body.lookback_hours ?? 24)));
  const specificClient = body.client_id as string | undefined;
  const since = new Date(Date.now() - lookbackHours * 3600_000).toISOString();

  const { data: mappings, error: mErr } = await sb
    .from("disposition_mappings")
    .select("client_id, match_type, match_value, disposition")
    .eq("active", true);
  if (mErr) return new Response(JSON.stringify({ success: false, error: mErr.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  let q = sb.from("leads")
    .select("id, client_id, name, opportunity_stage, opportunity_status, custom_fields, current_disposition, assigned_user, ghl_synced_at, updated_at")
    .or(`ghl_synced_at.gte.${since},updated_at.gte.${since}`)
    .limit(5000);
  if (specificClient) q = q.eq("client_id", specificClient);

  const { data: leads, error: lErr } = await q;
  if (lErr) return new Response(JSON.stringify({ success: false, error: lErr.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  let detected = 0, changed = 0, unchanged = 0, nomatch = 0;
  const inserts: any[] = [];
  const leadUpdates: { id: string; disposition: string }[] = [];

  for (const lead of leads ?? []) {
    const resolved = resolveDisposition(lead, (mappings ?? []) as Mapping[]);
    if (!resolved) { nomatch++; continue; }
    detected++;
    if (lead.current_disposition === resolved.disposition) { unchanged++; continue; }
    changed++;
    inserts.push({
      lead_id: lead.id,
      client_id: lead.client_id,
      disposition: resolved.disposition,
      disposition_reason: resolved.reason,
      disposed_by: lead.assigned_user ?? null,
      source: "ghl",
      ghl_raw: { opportunity_stage: lead.opportunity_stage, opportunity_status: lead.opportunity_status, custom_fields: lead.custom_fields },
    });
    leadUpdates.push({ id: lead.id, disposition: resolved.disposition });
  }

  // Insert in chunks
  for (let i = 0; i < inserts.length; i += 500) {
    const chunk = inserts.slice(i, i + 500);
    const { error } = await sb.from("lead_dispositions").insert(chunk);
    if (error) console.error("[dispositions] insert error:", error.message);
  }
  // Update leads
  const now = new Date().toISOString();
  for (const u of leadUpdates) {
    await sb.from("leads").update({ current_disposition: u.disposition, disposition_updated_at: now }).eq("id", u.id);
  }

  return new Response(JSON.stringify({
    success: true,
    since,
    leads_scanned: leads?.length ?? 0,
    detected, changed, unchanged, no_match: nomatch,
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});