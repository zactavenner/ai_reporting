// Computes deterministic 1-10 lead quality scores and writes them to
// leads.quality_score. Runs nightly via pg_cron, or on demand from the
// Weekly Report card with { client_id, days }.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { scoreLead } from "../_shared/leadQuality.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const body = await req.json().catch(() => ({}));
    const clientId: string | undefined = body?.client_id;
    const days = Math.min(Math.max(Number(body?.days ?? 45), 1), 365);
    const since = new Date(Date.now() - days * 86_400_000).toISOString();

    // PostgREST caps a response at 1000 rows, so page explicitly.
    const PAGE = 1000;
    const MAX_ROWS = 20000;
    const rows: any[] = [];
    for (let offset = 0; offset < MAX_ROWS; offset += PAGE) {
      let leadQuery = sb
        .from("leads")
        .select("id, client_id, external_id, email, phone, is_spam, questions, current_disposition")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .range(offset, offset + PAGE - 1);
      if (clientId) leadQuery = leadQuery.eq("client_id", clientId);
      const { data: page, error } = await leadQuery;
      if (error) throw new Error(error.message);
      rows.push(...(page ?? []));
      if ((page?.length ?? 0) < PAGE) break;
    }
    if (rows.length === 0) {
      return new Response(JSON.stringify({ success: true, scored: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const leadIds = rows.map((l: any) => l.id);
    const externalIds = rows.map((l: any) => l.external_id).filter(Boolean);

    // Calls (booked / showed) keyed by lead_id
    const booked = new Set<string>();
    const showed = new Set<string>();
    for (let i = 0; i < leadIds.length; i += 500) {
      const chunk = leadIds.slice(i, i + 500);
      const { data: calls } = await sb
        .from("calls")
        .select("lead_id, showed, is_reconnect")
        .in("lead_id", chunk);
      for (const c of calls ?? []) {
        if (!c.lead_id) continue;
        if (!c.is_reconnect) booked.add(c.lead_id);
        if (c.showed) showed.add(c.lead_id);
      }
    }

    // Funded investors keyed by lead_id
    const funded = new Set<string>();
    for (let i = 0; i < leadIds.length; i += 500) {
      const chunk = leadIds.slice(i, i + 500);
      const { data: fi } = await sb
        .from("funded_investors")
        .select("lead_id")
        .in("lead_id", chunk);
      for (const f of fi ?? []) if (f.lead_id) funded.add(f.lead_id);
    }

    // Enrichment keyed by external_id
    const enrichment = new Map<string, any>();
    for (let i = 0; i < externalIds.length; i += 500) {
      const chunk = externalIds.slice(i, i + 500);
      const { data: le } = await sb
        .from("lead_enrichment")
        .select("external_id, is_investor, owns_investments, accredited_probability, net_worth_midpoint, household_income_midpoint, investor_score")
        .in("external_id", chunk);
      for (const e of le ?? []) if (e.external_id) enrichment.set(e.external_id, e);
    }

    let scored = 0;
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500).map((l: any) => {
        const { score } = scoreLead({
          is_spam: l.is_spam,
          email: l.email,
          phone: l.phone,
          questions: l.questions,
          disposition: l.current_disposition,
          booked: booked.has(l.id),
          showed: showed.has(l.id),
          funded: funded.has(l.id),
          enrichment: l.external_id ? enrichment.get(l.external_id) ?? null : null,
        });
        return { id: l.id, quality_score: score };
      });

      // Update-only (no upsert) so we never touch other lead columns.
      // Group by score so one statement covers many leads.
      const byScore = new Map<number, string[]>();
      for (const r of chunk) {
        const list = byScore.get(r.quality_score) ?? [];
        list.push(r.id);
        byScore.set(r.quality_score, list);
      }
      for (const [score, ids] of byScore) {
        const { error: uErr } = await sb
          .from("leads")
          .update({ quality_score: score })
          .in("id", ids);
        if (!uErr) scored += ids.length;
        else console.error("score update failed:", uErr.message);
      }
    }

    return new Response(
      JSON.stringify({ success: true, scored, considered: rows.length, days, client_id: clientId ?? null }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("score-lead-quality failed:", (e as Error).message);
    return new Response(JSON.stringify({ success: false, error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
