import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

const SAFE_AUTO_ACTIONS = new Set(['creative_kill', 'report']);

interface ProposedAction {
  title?: string;
  summary?: string;
  queue_type: string;
  priority?: number;
  preview_payload?: unknown;
  compliance_check_result?: unknown;
}

interface RequestBody {
  agent_name: string;
  action_type: string;
  client_id?: string | null;
  reasoning: string;
  inputs?: Record<string, unknown>;
  proposed_action: ProposedAction;
}

function passesGuardrails(inputs: Record<string, unknown> | undefined, guardrails: any): { ok: boolean; reason?: string } {
  if (!inputs) return { ok: true };
  const maxPct = Number(guardrails?.max_budget_delta_pct ?? 20);
  const never: string[] = Array.isArray(guardrails?.never_touch_ad_ids) ? guardrails.never_touch_ad_ids : [];

  const deltaPct = Number((inputs as any).budget_delta_pct);
  if (!Number.isNaN(deltaPct) && Math.abs(deltaPct) > maxPct) {
    return { ok: false, reason: `budget_delta_pct ${deltaPct} exceeds max ${maxPct}` };
  }
  const targetAdId = (inputs as any).target_ad_id;
  if (targetAdId && never.includes(String(targetAdId))) {
    return { ok: false, reason: `target_ad_id ${targetAdId} is in never_touch_ad_ids` };
  }
  return { ok: true };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const body = (await req.json()) as RequestBody;
    if (!body?.agent_name || !body?.action_type || !body?.reasoning || !body?.proposed_action?.queue_type) {
      return new Response(JSON.stringify({ error: 'missing required fields' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // Load lessons
    const { data: lessons } = await supabase
      .from('agent_lessons')
      .select('id, lesson, source, context, created_at')
      .eq('agent_name', body.agent_name)
      .eq('active', true)
      .order('created_at', { ascending: false })
      .limit(50);

    // Load client KPI targets (may be missing)
    let targets: any = null;
    if (body.client_id) {
      const { data } = await supabase
        .from('client_kpi_targets')
        .select('*')
        .eq('client_id', body.client_id)
        .maybeSingle();
      targets = data;
    }

    const autonomyMode: string = targets?.autonomy_mode ?? 'copilot';
    const guardrails = targets?.guardrails ?? { max_budget_delta_pct: 20, never_touch_ad_ids: [], min_spend_before_kill: 150 };
    const guardrailResult = passesGuardrails(body.inputs, guardrails);

    const canAuto =
      autonomyMode === 'autopilot' &&
      (SAFE_AUTO_ACTIONS.has(body.action_type) || guardrailResult.ok);

    // Insert audit log row
    const auditRow = {
      agent_name: body.agent_name,
      action_type: body.action_type,
      client_id: body.client_id ?? null,
      reasoning: body.reasoning,
      inputs: body.inputs ?? null,
      approval_status: canAuto ? 'auto_approved' : 'pending',
    };
    const { data: audit, error: auditErr } = await supabase
      .from('autonomous_audit_log')
      .insert(auditRow)
      .select('id')
      .single();
    if (auditErr) throw auditErr;

    if (canAuto) {
      return new Response(
        JSON.stringify({ execute: true, audit_id: audit.id, autonomy_mode: autonomyMode, lessons: lessons ?? [] }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Queue for approval
    const { data: queued, error: queueErr } = await supabase
      .from('approval_queue')
      .insert({
        audit_log_id: audit.id,
        client_id: body.client_id ?? null,
        queue_type: body.proposed_action.queue_type,
        title: body.proposed_action.title ?? null,
        summary: body.proposed_action.summary ?? null,
        agent_reasoning: body.reasoning,
        compliance_check_result: body.proposed_action.compliance_check_result ?? null,
        preview_payload: body.proposed_action.preview_payload ?? null,
        priority: body.proposed_action.priority ?? 3,
      })
      .select('id')
      .single();
    if (queueErr) throw queueErr;

    return new Response(
      JSON.stringify({
        execute: false,
        queued: true,
        queue_id: queued.id,
        audit_id: audit.id,
        autonomy_mode: autonomyMode,
        guardrail_result: guardrailResult,
        lessons: lessons ?? [],
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (e) {
    console.error('agent-gatekeeper error', e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});