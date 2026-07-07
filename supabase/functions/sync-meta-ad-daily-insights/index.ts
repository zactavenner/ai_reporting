// Fetches ad-level daily insights from Meta Graph API for the trailing N days
// and upserts into public.meta_ad_daily_insights.
// Called by sync-meta-ads-daily (fire-and-forget) and available for backfill.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { META_GRAPH_BASE, metaFetch, resolveMetaToken } from "../_shared/meta.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

declare const EdgeRuntime: { waitUntil: (p: Promise<unknown>) => void } | undefined;

interface Body {
  days?: number;      // trailing window (default 7)
  client_id?: string; // optional single client
}

function ymd(d: Date) { return d.toISOString().slice(0, 10); }

function extractLeads(actions: any[] | undefined): number {
  if (!Array.isArray(actions)) return 0;
  let total = 0;
  for (const a of actions) {
    const t = String(a?.action_type ?? "");
    if (t === "lead" || t === "onsite_conversion.lead_grouped" || t.endsWith(".lead") || t === "offsite_conversion.fb_pixel_lead") {
      total += Number(a?.value ?? 0) || 0;
    }
  }
  return total;
}

function extractVideo(actions: any[] | undefined, video: any[] | undefined, keyContains: string): number {
  const scan = (arr: any[] | undefined) => {
    if (!Array.isArray(arr)) return 0;
    let n = 0;
    for (const a of arr) {
      const t = String(a?.action_type ?? "");
      if (t.includes(keyContains)) n += Number(a?.value ?? 0) || 0;
    }
    return n;
  };
  return scan(actions) || scan(video);
}

async function fetchAllPages(url: string) {
  const rows: any[] = [];
  let next: string | null = url;
  let guard = 0;
  while (next && guard < 50) {
    const res = await metaFetch(next);
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`Meta ${res.status}: ${t.slice(0, 300)}`);
    }
    const body = await res.json();
    if (Array.isArray(body?.data)) rows.push(...body.data);
    next = body?.paging?.next ?? null;
    guard++;
  }
  return rows;
}

async function syncClient(sb: any, client: any, days: number) {
  const { token } = resolveMetaToken(client);
  if (!token) return { rows: 0, skipped: "no_token" };
  const acct = String(client.meta_ad_account_id);
  const acctPath = acct.startsWith("act_") ? acct : `act_${acct}`;

  const end = new Date();
  const start = new Date(end.getTime() - (days - 1) * 86400_000);
  const url = new URL(`${META_GRAPH_BASE}/${acctPath}/insights`);
  url.searchParams.set("level", "ad");
  url.searchParams.set("time_increment", "1");
  url.searchParams.set("time_range", JSON.stringify({ since: ymd(start), until: ymd(end) }));
  url.searchParams.set("fields", "date_start,ad_id,adset_id,campaign_id,spend,impressions,reach,frequency,clicks,ctr,cpc,cpm,actions,video_3_sec_watched_actions,video_thruplay_watched_actions");
  url.searchParams.set("limit", "500");
  url.searchParams.set("access_token", token);

  const data = await fetchAllPages(url.toString());
  if (!data.length) return { rows: 0 };

  const rows = data.map((d) => {
    const leads = extractLeads(d.actions);
    const spend = Number(d.spend ?? 0) || 0;
    return {
      date: d.date_start,
      client_id: client.id,
      meta_ad_id: String(d.ad_id),
      meta_adset_id: d.adset_id ?? null,
      meta_campaign_id: d.campaign_id ?? null,
      spend,
      impressions: Number(d.impressions ?? 0) || 0,
      reach: Number(d.reach ?? 0) || 0,
      frequency: Number(d.frequency ?? 0) || 0,
      clicks: Number(d.clicks ?? 0) || 0,
      ctr: Number(d.ctr ?? 0) || 0,
      cpc: Number(d.cpc ?? 0) || 0,
      cpm: Number(d.cpm ?? 0) || 0,
      leads,
      cost_per_lead: leads > 0 ? spend / leads : 0,
      video_3s_views: extractVideo(d.actions, d.video_3_sec_watched_actions, "video_view") || null,
      video_thruplay: extractVideo(d.actions, d.video_thruplay_watched_actions, "video_thruplay") || null,
    };
  });

  // Upsert in chunks
  let inserted = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const { error } = await sb.from("meta_ad_daily_insights")
      .upsert(chunk, { onConflict: "date,meta_ad_id" });
    if (error) throw new Error(error.message);
    inserted += chunk.length;
  }
  return { rows: inserted };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  let body: Body = {};
  try { body = await req.json(); } catch { /* allow empty */ }
  const days = Math.max(1, Math.min(90, body.days ?? 7));

  let q = sb.from("clients").select("id, name, meta_ad_account_id, meta_access_token, meta_system_user_token, meta_token_type")
    .not("meta_ad_account_id", "is", null)
    .in("status", ["active", "onboarding"]);
  if (body.client_id) q = q.eq("id", body.client_id);
  const { data: clients, error } = await q;
  if (error) return new Response(JSON.stringify({ success: false, error: error.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const doWork = async () => {
    const results: any[] = [];
    for (const c of clients ?? []) {
      try {
        const r = await syncClient(sb, c, days);
        results.push({ client_id: c.id, name: c.name, ...r });
        console.log(`[insights] ${c.name}: ${JSON.stringify(r)}`);
      } catch (e) {
        const msg = (e as Error).message;
        console.error(`[insights] ${c.name} failed: ${msg}`);
        await sb.from("sync_errors").insert({
          integration_name: "sync-meta-ad-daily-insights",
          client_id: c.id,
          endpoint: `insights?days=${days}`,
          error_message: msg.slice(0, 1000),
        }).then(() => {}).catch(() => {});
        results.push({ client_id: c.id, name: c.name, error: msg });
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    return results;
  };

  if (typeof EdgeRuntime !== "undefined" && !body.client_id) {
    EdgeRuntime.waitUntil(doWork());
    return new Response(JSON.stringify({ success: true, started: true, clients: clients?.length ?? 0, days }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
  const results = await doWork();
  return new Response(JSON.stringify({ success: true, days, results }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});