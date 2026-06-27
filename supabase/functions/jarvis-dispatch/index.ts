// Jarvis dispatcher — drains pending rows from agent_tasks and routes them to
// the assigned agent's run-agent invocation. Concurrency-safe via claimed_by.
//
// Fired by pg_cron every minute. Every dispatch attempt is logged to
// cron_run_log so we can confirm the orchestrator is actually firing.
//
// Task row contract (public.agent_tasks):
//   - assigned_to_agent: agent name OR uuid (we match both)
//   - task_type: free-form string forwarded to run-agent in payload
//   - payload: jsonb forwarded verbatim to run-agent as task_payload
//   - status: 'pending' | 'queued' | 'in_progress' | 'completed' | 'failed'
//   - max_attempts: default 3
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supa = createClient(SUPABASE_URL, SERVICE_KEY);

const WORKER_ID = `jarvis-${crypto.randomUUID().slice(0, 8)}`;
const MAX_TASKS_PER_SWEEP = 10;

interface AgentTask {
  id: string;
  assigned_to_agent: string | null;
  task_type: string | null;
  payload: any;
  attempts: number | null;
  max_attempts: number | null;
}

async function resolveAgentId(assignedTo: string): Promise<string | null> {
  // Try uuid first
  if (/^[0-9a-f]{8}-/.test(assignedTo)) {
    const { data } = await supa.from("agents").select("id").eq("id", assignedTo).maybeSingle();
    if (data?.id) return data.id;
  }
  // Then by name (case-insensitive, agency-scoped agents preferred)
  const { data } = await supa
    .from("agents")
    .select("id, client_id")
    .ilike("name", assignedTo)
    .order("client_id", { ascending: true, nullsFirst: true })
    .limit(1)
    .maybeSingle();
  return data?.id ?? null;
}

async function claimNext(): Promise<AgentTask[]> {
  // Lightweight claim: update N pending rows to in_progress where claim is still free.
  // SKIP LOCKED is not exposed via PostgREST, so we narrow by id list after a snapshot.
  const { data: snapshot } = await supa
    .from("agent_tasks")
    .select("id")
    .in("status", ["pending", "queued"])
    .is("claimed_by", null)
    .order("priority", { ascending: true, nullsFirst: true })
    .order("created_at", { ascending: true })
    .limit(MAX_TASKS_PER_SWEEP);
  const ids = (snapshot ?? []).map((r: any) => r.id);
  if (ids.length === 0) return [];

  const { data: claimed } = await supa
    .from("agent_tasks")
    .update({
      status: "in_progress",
      claimed_by: WORKER_ID,
      claimed_at: new Date().toISOString(),
      started_at: new Date().toISOString(),
    })
    .in("id", ids)
    .is("claimed_by", null)
    .select("id, assigned_to_agent, task_type, payload, attempts, max_attempts");

  return (claimed ?? []) as AgentTask[];
}

async function executeTask(task: AgentTask): Promise<{ ok: boolean; status: number; error?: string; result?: any }> {
  if (!task.assigned_to_agent) {
    return { ok: false, status: 400, error: "assigned_to_agent is null" };
  }
  const agentId = await resolveAgentId(task.assigned_to_agent);
  if (!agentId) {
    return { ok: false, status: 404, error: `agent not found: ${task.assigned_to_agent}` };
  }
  const r = await fetch(`${SUPABASE_URL}/functions/v1/run-agent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SERVICE_KEY}`,
      apikey: SERVICE_KEY,
    },
    body: JSON.stringify({
      agent_id: agentId,
      task_id: task.id,
      task_type: task.task_type,
      task_payload: task.payload,
    }),
  });
  if (!r.ok) {
    let body = "";
    try { body = (await r.text()).slice(0, 500); } catch {}
    return { ok: false, status: r.status, error: body || `HTTP ${r.status}` };
  }
  let result: any = null;
  try { result = await r.json(); } catch {}
  return { ok: true, status: r.status, result };
}

async function finishTask(task: AgentTask, outcome: { ok: boolean; status: number; error?: string; result?: any }) {
  const attempts = (task.attempts ?? 0) + 1;
  const maxAttempts = task.max_attempts ?? 3;
  const patch: Record<string, any> = {
    attempts,
    result: outcome.result ?? null,
  };
  if (outcome.ok) {
    patch.status = "completed";
    patch.completed_at = new Date().toISOString();
    patch.claimed_by = null;
  } else if (attempts >= maxAttempts) {
    patch.status = "failed";
    patch.completed_at = new Date().toISOString();
    patch.result = { error: outcome.error, status: outcome.status };
    patch.claimed_by = null;
  } else {
    // Release for retry on next sweep
    patch.status = "pending";
    patch.claimed_by = null;
    patch.result = { error: outcome.error, status: outcome.status, will_retry: true };
  }
  await supa.from("agent_tasks").update(patch).eq("id", task.id);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const sweepStart = Date.now();
  try {
    const tasks = await claimNext();
    const outcomes: any[] = [];
    for (const t of tasks) {
      const outcome = await executeTask(t);
      await finishTask(t, outcome);
      outcomes.push({ id: t.id, assigned: t.assigned_to_agent, type: t.task_type, ok: outcome.ok, status: outcome.status });
    }
    await supa.rpc("log_cron_run", {
      p_job_name: "jarvis-dispatch",
      p_status: "success",
      p_status_code: 200,
      p_response_body: JSON.stringify({ worker: WORKER_ID, claimed: tasks.length, outcomes: outcomes.length }),
      p_error_message: null,
      p_duration_ms: Date.now() - sweepStart,
    });
    return new Response(JSON.stringify({ ok: true, worker: WORKER_ID, claimed: tasks.length, outcomes }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await supa.rpc("log_cron_run", {
      p_job_name: "jarvis-dispatch",
      p_status: "failed",
      p_status_code: 500,
      p_response_body: null,
      p_error_message: msg,
      p_duration_ms: Date.now() - sweepStart,
    });
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});