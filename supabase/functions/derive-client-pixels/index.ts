// Auto-populate clients.meta_pixel_id by querying Meta Graph API for each client's ad account pixels.
// - If exactly one distinct pixel across all their ad accounts -> auto-populate (only when currently null)
// - If multiple distinct -> queue an approval via agent-gatekeeper
// - Also caches pixel list into meta_ad_accounts.pixels jsonb
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { META_GRAPH_BASE, resolveMetaToken } from "../_shared/meta.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface PixelHit { id: string; name?: string | null; last_fired_time?: string | null; source: string }

async function safeJson(r: Response) { try { return await r.json(); } catch { return null; } }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  let body: any = {};
  try { body = await req.json(); } catch { /* ignore */ }
  const onlyClientId: string | undefined = body?.client_id;
  const overwrite: boolean = !!body?.overwrite;

  let q = sb.from("clients")
    .select("id, name, status, meta_pixel_id, meta_access_token, meta_system_user_token, meta_ad_account_id, meta_ad_account_ids")
    .eq("status", "active");
  if (onlyClientId) q = q.eq("id", onlyClientId);
  const { data: clients, error } = await q;
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const summary = { populated: 0, ambiguous_queued: 0, none_found: 0, already_set: 0, errors: 0, details: [] as any[] };

  for (const c of clients ?? []) {
    if (c.meta_pixel_id && !overwrite) {
      summary.already_set++;
      summary.details.push({ client: c.name, client_id: c.id, existing_pixel: c.meta_pixel_id, action: "already_set" });
      continue;
    }

    const { token } = resolveMetaToken(c as any);
    if (!token) {
      summary.errors++;
      summary.details.push({ client: c.name, client_id: c.id, action: "no_token" });
      continue;
    }

    const accounts: string[] = [];
    if (c.meta_ad_account_id) accounts.push(String(c.meta_ad_account_id).replace(/^act_/, ""));
    for (const a of (c.meta_ad_account_ids ?? []) as string[]) if (a) accounts.push(String(a).replace(/^act_/, ""));
    const uniqueAccts = Array.from(new Set(accounts));
    if (uniqueAccts.length === 0) {
      summary.none_found++;
      summary.details.push({ client: c.name, client_id: c.id, action: "no_ad_account" });
      continue;
    }

    const hits: PixelHit[] = [];
    const errs: string[] = [];
    for (const accId of uniqueAccts) {
      const url = `${META_GRAPH_BASE}/act_${accId}/adspixels?fields=id,name,last_fired_time&limit=50&access_token=${encodeURIComponent(token)}`;
      const res = await fetch(url);
      const j = await safeJson(res);
      if (!res.ok || j?.error) {
        errs.push(`act_${accId}: ${j?.error?.message || res.status}`);
        continue;
      }
      for (const p of (j?.data ?? [])) {
        hits.push({ id: String(p.id), name: p.name ?? null, last_fired_time: p.last_fired_time ?? null, source: `act_${accId}` });
      }
      // Cache into meta_ad_accounts
      try {
        await sb.from("meta_ad_accounts").upsert({
          ad_account_id: accId,
          pixels: (j?.data ?? []).map((p: any) => ({ id: p.id, name: p.name ?? null, last_fired_time: p.last_fired_time ?? null })),
          assets_synced_at: new Date().toISOString(),
        }, { onConflict: "ad_account_id" });
      } catch { /* non-critical */ }
    }

    const distinct = Array.from(new Set(hits.map((h) => h.id)));
    if (distinct.length === 0) {
      summary.none_found++;
      summary.details.push({ client: c.name, client_id: c.id, action: "no_pixels_found", errors: errs });
      continue;
    }
    if (distinct.length === 1) {
      const pid = distinct[0];
      const src = hits.find((h) => h.id === pid);
      const { error: uErr } = await sb.from("clients").update({ meta_pixel_id: pid }).eq("id", c.id).is("meta_pixel_id", null);
      if (uErr) {
        summary.errors++;
        summary.details.push({ client: c.name, client_id: c.id, action: "update_failed", error: uErr.message });
        continue;
      }
      summary.populated++;
      summary.details.push({ client: c.name, client_id: c.id, pixel_id: pid, pixel_name: src?.name, source: src?.source, action: "populated" });
      try {
        await sb.from("autonomous_audit_log").insert({
          agent_name: "pixel-config",
          action_type: "report",
          client_id: c.id,
          reasoning: `Auto-derived Meta pixel ${pid} (${src?.name ?? "unnamed"}) from ${src?.source}. Only pixel discovered across ${uniqueAccts.length} ad account(s).`,
          inputs: { candidates: hits },
          outputs: { pixel_id: pid },
          approval_status: "not_required",
        });
      } catch { /* ignore */ }
      continue;
    }

    // ambiguous
    summary.ambiguous_queued++;
    const candidatePayload = distinct.map((id) => {
      const matches = hits.filter((h) => h.id === id);
      return { pixel_id: id, name: matches[0]?.name ?? null, last_fired_time: matches[0]?.last_fired_time ?? null, seen_in: Array.from(new Set(matches.map((m) => m.source))) };
    });
    try {
      const gwUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/agent-gatekeeper`;
      await fetch(gwUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
        body: JSON.stringify({
          agent_name: "pixel-config",
          action_type: "task_created",
          client_id: c.id,
          reasoning: `Multiple Meta pixels detected for ${c.name}. A human must pick the primary pixel for CAPI events.`,
          inputs: { candidates: candidatePayload, ad_accounts: uniqueAccts },
          proposed_action: {
            queue_type: "report",
            title: `Choose primary Meta pixel for ${c.name}`,
            summary: `${distinct.length} pixels detected across ${uniqueAccts.length} ad account(s). Select which one to use for Conversions API events.`,
            priority: 2,
            preview_payload: { candidates: candidatePayload },
          },
        }),
      });
    } catch (e) {
      summary.errors++;
      summary.details.push({ client: c.name, client_id: c.id, action: "queue_failed", error: (e as Error).message });
      continue;
    }
    summary.details.push({ client: c.name, client_id: c.id, action: "ambiguous_queued", candidates: candidatePayload });
  }

  return new Response(JSON.stringify({ success: true, ...summary }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
