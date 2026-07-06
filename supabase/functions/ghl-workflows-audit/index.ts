// GHL Workflow Audit — pulls workflow metadata for all active clients from the
// GoHighLevel public API and caches it. Per-client failures are captured; a
// single client error does not abort the loop.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const GHL_BASE = "https://services.leadconnectorhq.com";
const GHL_VERSION = "2021-07-28";

interface GhlWorkflow {
  id: string;
  name: string;
  status?: string;
  version?: number;
  createdAt?: string;
  updatedAt?: string;
  locationId?: string;
}

async function syncOneClient(
  supabase: ReturnType<typeof createClient>,
  client: { id: string; name: string; ghl_api_key: string; ghl_location_id: string },
): Promise<{ ok: true; count: number } | { ok: false; error: string; httpStatus?: number }> {
  const startedAt = new Date().toISOString();
  let res: Response;
  try {
    res = await fetch(
      `${GHL_BASE}/workflows/?locationId=${encodeURIComponent(client.ghl_location_id)}`,
      {
        headers: {
          Authorization: `Bearer ${client.ghl_api_key}`,
          Version: GHL_VERSION,
          Accept: "application/json",
        },
      },
    );
  } catch (e) {
    const err = (e as Error).message;
    await supabase.from("ghl_workflow_sync_runs").insert({
      client_id: client.id, started_at: startedAt, finished_at: new Date().toISOString(),
      status: "error", error_message: `Network error: ${err}`,
    });
    return { ok: false, error: `Network error: ${err}` };
  }

  const text = await res.text();
  if (!res.ok) {
    await supabase.from("ghl_workflow_sync_runs").insert({
      client_id: client.id, started_at: startedAt, finished_at: new Date().toISOString(),
      status: "error", http_status: res.status,
      error_message: `${res.status} ${text.slice(0, 300)}`,
    });
    return { ok: false, error: `${res.status} ${text.slice(0, 200)}`, httpStatus: res.status };
  }

  let body: { workflows?: GhlWorkflow[] };
  try { body = text ? JSON.parse(text) : {}; } catch {
    await supabase.from("ghl_workflow_sync_runs").insert({
      client_id: client.id, started_at: startedAt, finished_at: new Date().toISOString(),
      status: "error", error_message: "Invalid JSON response",
    });
    return { ok: false, error: "Invalid JSON response" };
  }
  const workflows = body.workflows ?? [];

  // Load existing for diff detection
  const { data: existing } = await supabase
    .from("ghl_workflows")
    .select("workflow_id, status, version, ghl_updated_at")
    .eq("client_id", client.id);
  const existingMap = new Map(
    (existing ?? []).map((r: { workflow_id: string; status: string | null; version: number | null; ghl_updated_at: string | null }) =>
      [r.workflow_id, r]),
  );

  const historyRows: Array<Record<string, unknown>> = [];
  const upsertRows = workflows.map((w) => {
    const prev = existingMap.get(w.id);
    if (prev) {
      if ((prev.status ?? null) !== (w.status ?? null)) {
        historyRows.push({ client_id: client.id, workflow_id: w.id, field: "status", old_value: prev.status, new_value: w.status ?? null });
      }
      if ((prev.version ?? null) !== (w.version ?? null)) {
        historyRows.push({ client_id: client.id, workflow_id: w.id, field: "version", old_value: String(prev.version ?? ''), new_value: String(w.version ?? '') });
      }
      const prevU = prev.ghl_updated_at ? new Date(prev.ghl_updated_at).toISOString() : null;
      const newU = w.updatedAt ? new Date(w.updatedAt).toISOString() : null;
      if (prevU !== newU) {
        historyRows.push({ client_id: client.id, workflow_id: w.id, field: "ghl_updated_at", old_value: prevU, new_value: newU });
      }
    }
    return {
      client_id: client.id,
      workflow_id: w.id,
      name: w.name ?? "(unnamed)",
      status: w.status ?? null,
      version: typeof w.version === "number" ? w.version : null,
      ghl_created_at: w.createdAt ?? null,
      ghl_updated_at: w.updatedAt ?? null,
      fetched_at: new Date().toISOString(),
      raw: w as unknown as Record<string, unknown>,
    };
  });

  if (upsertRows.length > 0) {
    const { error: upErr } = await supabase
      .from("ghl_workflows")
      .upsert(upsertRows, { onConflict: "client_id,workflow_id" });
    if (upErr) {
      await supabase.from("ghl_workflow_sync_runs").insert({
        client_id: client.id, started_at: startedAt, finished_at: new Date().toISOString(),
        status: "error", error_message: `Upsert failed: ${upErr.message}`,
      });
      return { ok: false, error: `Upsert failed: ${upErr.message}` };
    }
  }
  if (historyRows.length > 0) {
    await supabase.from("ghl_workflow_history").insert(historyRows);
  }

  await supabase.from("ghl_workflow_sync_runs").insert({
    client_id: client.id, started_at: startedAt, finished_at: new Date().toISOString(),
    status: "success", workflow_count: workflows.length, http_status: 200,
  });
  return { ok: true, count: workflows.length };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let clientId: string | undefined;
  try {
    if (req.headers.get("content-type")?.includes("application/json")) {
      const b = await req.json().catch(() => ({}));
      clientId = b?.clientId;
    }
  } catch { /* no-op */ }

  let query = supabase
    .from("clients")
    .select("id, name, ghl_api_key, ghl_location_id, status")
    .not("ghl_api_key", "is", null)
    .not("ghl_location_id", "is", null);
  if (clientId) query = query.eq("id", clientId);
  else query = query.in("status", ["active", "onboarding", "paused"]);

  const { data: clients, error } = await query;
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const errors: Array<{ clientId: string; clientName: string; error: string }> = [];
  let successful = 0;
  let totalWorkflows = 0;
  for (const c of clients ?? []) {
    const result = await syncOneClient(supabase, c as { id: string; name: string; ghl_api_key: string; ghl_location_id: string });
    if (result.ok) { successful++; totalWorkflows += result.count; }
    else errors.push({ clientId: c.id, clientName: c.name, error: result.error });
  }

  return new Response(JSON.stringify({
    clients: clients?.length ?? 0,
    workflows: totalWorkflows,
    successful,
    errors,
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});