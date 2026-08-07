// Executes a single agent connector (test run or context fetch).
// Direct Supabase queries with the service role — no external-data-api hop.
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

/** Composite RPCs an agent connector may call. */
const COMPOSITE_RPCS = new Set([
  "get_top_performers",
  "get_client_source_metrics",
  "get_client_spend_days",
  "get_client_spend_freshness",
  "get_sync_queue_stats",
  "agent_cost_mtd",
  "find_unenriched_leads",
  "get_lead_call_transcripts",
]);

type Filters = Record<string, any>;

function applyFilters(q: any, filters: Filters, clientId: string | null) {
  for (const [field, raw] of Object.entries(filters || {})) {
    if (raw === null || raw === undefined || raw === "") continue;
    const spec = typeof raw === "object" && !Array.isArray(raw) ? raw : { op: "eq", value: raw };
    const op = String(spec.op || "eq");
    let value = spec.value;
    if (value === "{{client_id}}") value = clientId;
    if (value === null || value === undefined || value === "") continue;
    switch (op) {
      case "gt": q = q.gt(field, value); break;
      case "gte": q = q.gte(field, value); break;
      case "lt": q = q.lt(field, value); break;
      case "lte": q = q.lte(field, value); break;
      case "neq": q = q.neq(field, value); break;
      case "like": q = q.like(field, value); break;
      case "ilike": q = q.ilike(field, value); break;
      case "in": q = q.in(field, Array.isArray(value) ? value : String(value).split(",").map((s) => s.trim())); break;
      case "is": q = q.is(field, value === "null" ? null : value); break;
      default: q = q.eq(field, value);
    }
  }
  return q;
}

async function runConnector(c: any, clientId: string | null) {
  const limit = Math.min(Math.max(Number(c.row_limit) || 50, 1), 500);
  const filters: Filters = c.filters || {};

  if (c.kind === "supabase_table") {
    let q = sb.from(c.target).select("*").limit(limit);
    if (clientId && !("client_id" in filters)) {
      // Scope to the client when the table supports it; ignore if the column is absent.
      const probe = await sb.from(c.target).select("client_id").limit(1);
      if (!probe.error) q = q.eq("client_id", clientId);
    }
    q = applyFilters(q, filters, clientId);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return data || [];
  }

  if (c.kind === "supabase_composite") {
    if (!COMPOSITE_RPCS.has(c.target)) throw new Error(`Composite action "${c.target}" is not allowed`);
    const args: Record<string, any> = {};
    for (const [k, v] of Object.entries(filters)) {
      args[k] = v === "{{client_id}}" ? clientId : (typeof v === "object" && v ? (v as any).value : v);
    }
    const { data, error } = await sb.rpc(c.target, args);
    if (error) throw new Error(error.message);
    return Array.isArray(data) ? data.slice(0, limit) : data;
  }

  if (c.kind === "storage") {
    const prefix = typeof filters.prefix === "string" ? filters.prefix : "";
    const { data, error } = await sb.storage.from(c.target).list(prefix, { limit });
    if (error) throw new Error(error.message);
    return data || [];
  }

  if (c.kind === "webhook") {
    let q = sb.from("webhook_logs").select("*").order("created_at", { ascending: false }).limit(limit);
    if (c.target) q = q.eq("source", c.target);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return data || [];
  }

  throw new Error(`Unknown connector kind: ${c.kind}`);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const body = await req.json().catch(() => ({}));
    const connectorId: string | undefined = body.connector_id;
    const agentId: string | undefined = body.agent_id;
    const clientId: string | null = body.client_id ?? null;
    if (!connectorId && !agentId) return json({ error: "connector_id or agent_id is required" }, 400);

    let q = sb.from("agent_connectors").select("*");
    q = connectorId ? q.eq("id", connectorId) : q.eq("agent_id", agentId).eq("is_active", true);
    const { data: connectors, error } = await q;
    if (error) return json({ error: error.message }, 500);
    if (!connectors?.length) return json({ error: "No connectors found" }, 404);

    const results: any[] = [];
    for (const c of connectors) {
      const startedAt = Date.now();
      try {
        const rows = await runConnector(c, clientId ?? c.client_id ?? null);
        const count = Array.isArray(rows) ? rows.length : 1;
        await sb.from("agent_connectors").update({
          last_tested_at: new Date().toISOString(),
          last_status: "ok",
          last_error: null,
          last_row_count: count,
        }).eq("id", c.id);
        results.push({
          connector_id: c.id, label: c.label, kind: c.kind, target: c.target,
          status: "ok", row_count: count, duration_ms: Date.now() - startedAt,
          sample: Array.isArray(rows) ? rows.slice(0, 5) : rows,
        });
      } catch (e: any) {
        const message = String(e?.message || e).slice(0, 500);
        await sb.from("agent_connectors").update({
          last_tested_at: new Date().toISOString(),
          last_status: "error",
          last_error: message,
        }).eq("id", c.id);
        results.push({ connector_id: c.id, label: c.label, kind: c.kind, target: c.target, status: "error", error: message });
      }
    }

    return json({ results });
  } catch (e: any) {
    return json({ error: String(e?.message || e) }, 500);
  }
});
