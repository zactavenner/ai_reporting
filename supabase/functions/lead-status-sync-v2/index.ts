import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GHL_BASE_URL = "https://services.leadconnectorhq.com";
const GHL_VERSION = "2021-07-28";

/**
 * Lead Status Sync v2 — agent-callable API for pipeline-stage reconciliation.
 *
 * Pulls the CURRENT state of a lead from GHL (contact + appointments +
 * opportunities), derives the pipeline stage, and writes it into the
 * reporting tables the dashboard reads:
 *   leads.pipeline_status, calls (booked/showed), funded_investors (committed/funded),
 *   lead_status_history (transition log), lead_touchpoints (attribution feed).
 * On stage transitions it also fires Meta CAPI events so ad optimization
 * learns from the funnel, then flags affected dates for metric recalculation.
 *
 * Modes:
 *   Single: { clientId, leadId | ghlContactId | email }
 *   Batch:  { clientId, syncAll: true, sinceDays?: 7, limit?: 200 }
 *   Read:   { clientId, leadId | email, readOnly: true }  — no GHL call, view only
 *
 * Response (single): { success, leadId, previousStatus, currentStatus,
 *   transitions: [...], facts: { calls, showed, committed$, funded$ } }
 *
 * Pipeline stage derivation (highest stage wins):
 *   funded     — opportunity in a won/funded stage with monetaryValue, or funded_investors row
 *   committed  — opportunity has monetaryValue in a commit-pattern stage
 *   call_showed— any appointment with status showed/completed
 *   call_booked— any appointment exists (confirmed/new)
 *   contacted  — GHL contact has outbound activity tags
 *   new        — none of the above
 *   lost       — opportunity in lost/abandoned stage AND nothing higher
 */

const STAGE_ORDER = ["new", "contacted", "call_booked", "call_showed", "committed", "funded"];
const FUNDED_PATTERNS = ["funded", "won", "closed won", "closed-won", "invested"];
const COMMIT_PATTERNS = ["commit", "verbal", "soft circle", "reserved"];
const LOST_PATTERNS = ["lost", "abandoned", "closed lost", "dead", "unqualified"];

async function ghlGet(apiKey: string, path: string): Promise<any> {
  const res = await fetch(`${GHL_BASE_URL}${path}`, {
    headers: { Authorization: `Bearer ${apiKey}`, Version: GHL_VERSION, Accept: "application/json" },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GHL ${res.status} on ${path.split("?")[0]}: ${body.substring(0, 200)}`);
  }
  return res.json();
}

interface LeadFacts {
  appointments: any[];
  opportunities: any[];
  contact: any;
}

interface DerivedStatus {
  status: string;
  commitmentAmount: number;
  fundedAmount: number;
  fundedAt: string | null;
  showedCount: number;
  bookedCount: number;
  evidence: Record<string, any>;
}

function deriveStatus(facts: LeadFacts): DerivedStatus {
  const appts = facts.appointments || [];
  const opps = facts.opportunities || [];

  const bookedCount = appts.length;
  const showedCount = appts.filter((a: any) => {
    const s = (a.appointmentStatus || a.status || "").toLowerCase();
    return s === "showed" || s === "completed" || s === "show";
  }).length;

  let commitmentAmount = 0;
  let fundedAmount = 0;
  let fundedAt: string | null = null;
  let isLost = false;

  for (const opp of opps) {
    const stage = (opp.pipelineStageName || opp.stageName || opp.status || "").toLowerCase();
    const value = Number(opp.monetaryValue) || 0;
    if (FUNDED_PATTERNS.some(p => stage.includes(p))) {
      fundedAmount += value;
      fundedAt = opp.lastStatusChangeAt || opp.updatedAt || fundedAt;
    } else if (COMMIT_PATTERNS.some(p => stage.includes(p))) {
      commitmentAmount += value;
    } else if (LOST_PATTERNS.some(p => stage.includes(p))) {
      isLost = true;
    }
  }

  let status = "new";
  if (fundedAmount > 0) status = "funded";
  else if (commitmentAmount > 0) status = "committed";
  else if (showedCount > 0) status = "call_showed";
  else if (bookedCount > 0) status = "call_booked";
  else if (isLost) status = "lost";
  else if ((facts.contact?.tags || []).length > 0) status = "contacted";

  return {
    status, commitmentAmount, fundedAmount, fundedAt, showedCount, bookedCount,
    evidence: {
      appointments: appts.length,
      opportunities: opps.map((o: any) => ({
        stage: o.pipelineStageName || o.stageName || o.status,
        value: o.monetaryValue,
      })),
    },
  };
}

async function syncOneLead(
  supabase: any, supabaseUrl: string, supabaseKey: string,
  client: { id: string; ghl_api_key: string; ghl_location_id: string },
  lead: { id: string; external_id: string; email: string | null; pipeline_status: string; created_at: string },
): Promise<any> {
  const contactId = lead.external_id;

  // 1. Pull current state from GHL (contact, appointments, opportunities)
  const [contactRes, apptsRes, oppsRes] = await Promise.allSettled([
    ghlGet(client.ghl_api_key, `/contacts/${contactId}`),
    ghlGet(client.ghl_api_key, `/contacts/${contactId}/appointments`),
    ghlGet(client.ghl_api_key, `/opportunities/search?location_id=${client.ghl_location_id}&contact_id=${contactId}&limit=20`),
  ]);

  if (contactRes.status === "rejected") {
    throw new Error(`Contact fetch failed: ${contactRes.reason?.message || contactRes.reason}`);
  }

  const facts: LeadFacts = {
    contact: contactRes.value?.contact || contactRes.value,
    appointments: apptsRes.status === "fulfilled" ? (apptsRes.value?.events || apptsRes.value?.appointments || []) : [],
    opportunities: oppsRes.status === "fulfilled" ? (oppsRes.value?.opportunities || []) : [],
  };

  const derived = deriveStatus(facts);
  const previousStatus = lead.pipeline_status || "new";
  const transitions: string[] = [];

  // 2. Persist derived state — never downgrade a lead below funded/committed
  //    unless GHL explicitly says lost (protects against GHL data hiccups)
  const prevRank = STAGE_ORDER.indexOf(previousStatus);
  const newRank = STAGE_ORDER.indexOf(derived.status);
  const isDowngrade = newRank >= 0 && prevRank > newRank && derived.status !== "lost";
  const finalStatus = isDowngrade ? previousStatus : derived.status;

  if (finalStatus !== previousStatus) {
    transitions.push(`${previousStatus} → ${finalStatus}`);
    await supabase.from("leads").update({
      pipeline_status: finalStatus,
      pipeline_status_updated_at: new Date().toISOString(),
      ghl_last_synced_at: new Date().toISOString(),
    }).eq("id", lead.id);

    await supabase.from("lead_status_history").insert({
      lead_id: lead.id,
      client_id: client.id,
      old_status: previousStatus,
      new_status: finalStatus,
      source: "ghl_pull",
      metadata: derived.evidence,
    });

    // Touchpoint for attribution on meaningful stage entries
    const touchpointType = finalStatus === "funded" ? "funded"
      : finalStatus === "committed" ? "commitment"
      : finalStatus === "call_showed" ? "call_showed"
      : finalStatus === "call_booked" ? "call_booked" : null;
    if (touchpointType) {
      await supabase.from("lead_touchpoints").insert({
        lead_id: lead.id,
        client_id: client.id,
        touchpoint_type: touchpointType,
        timestamp: new Date().toISOString(),
        metadata: { source: "lead-status-sync-v2", value: derived.fundedAmount || derived.commitmentAmount || undefined },
      });
    }

    // CAPI event on transition (fire-and-forget; skipped if CAPI not configured)
    const capiEvent = finalStatus === "funded" ? { name: "Purchase", data: { value: derived.fundedAmount } }
      : finalStatus === "call_showed" ? { name: "CompleteRegistration", data: {} }
      : finalStatus === "call_booked" ? { name: "Schedule", data: {} } : null;
    if (capiEvent) {
      fetch(`${supabaseUrl}/functions/v1/meta-conversion-api`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${supabaseKey}` },
        body: JSON.stringify({ clientId: client.id, leadId: lead.id, eventName: capiEvent.name, eventData: capiEvent.data }),
      }).catch(() => {});
    }
  } else {
    // No transition — still stamp the sync time
    await supabase.from("leads").update({
      ghl_last_synced_at: new Date().toISOString(),
    }).eq("id", lead.id);
  }

  // 3. Reconcile calls rows against GHL appointments
  for (const appt of facts.appointments) {
    const apptId = appt.id || appt.appointmentId;
    if (!apptId) continue;
    const s = (appt.appointmentStatus || appt.status || "").toLowerCase();
    const showed = s === "showed" || s === "completed" || s === "show";
    await supabase.from("calls").upsert({
      client_id: client.id,
      lead_id: lead.id,
      external_id: String(apptId),
      scheduled_at: appt.startTime ? new Date(appt.startTime).toISOString() : null,
      showed,
    }, { onConflict: "client_id,external_id" });
  }

  // 4. Reconcile funded_investors against committed/funded amounts
  if (derived.fundedAmount > 0 || derived.commitmentAmount > 0) {
    await supabase.from("funded_investors").upsert({
      client_id: client.id,
      lead_id: lead.id,
      external_id: `ghl-${contactId}`,
      name: facts.contact?.name || facts.contact?.firstName || null,
      funded_amount: derived.fundedAmount,
      commitment_amount: derived.commitmentAmount,
      funded_at: derived.fundedAt || new Date().toISOString(),
    }, { onConflict: "client_id,external_id" });
  }

  return {
    leadId: lead.id,
    previousStatus,
    currentStatus: finalStatus,
    downgradeBlocked: isDowngrade,
    transitions,
    facts: {
      bookedCalls: derived.bookedCount,
      showedCalls: derived.showedCount,
      committedDollars: derived.commitmentAmount,
      fundedDollars: derived.fundedAmount,
    },
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const body = await req.json();
    const { clientId, leadId, ghlContactId, email, syncAll, sinceDays = 7, limit = 200, readOnly } = body;

    if (!clientId) {
      return new Response(JSON.stringify({ success: false, error: "clientId required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Read-only mode: current status from the view, no GHL call
    if (readOnly) {
      let q = supabase.from("v_lead_pipeline_status").select("*").eq("client_id", clientId);
      if (leadId) q = q.eq("lead_id", leadId);
      else if (email) q = q.eq("email", email.trim().toLowerCase());
      else return new Response(JSON.stringify({ success: false, error: "leadId or email required for readOnly" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
      const { data, error } = await q.limit(1).maybeSingle();
      if (error) throw error;
      return new Response(JSON.stringify({ success: true, lead: data }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: client } = await supabase
      .from("clients")
      .select("id, name, ghl_api_key, ghl_location_id")
      .eq("id", clientId).maybeSingle();
    if (!client?.ghl_api_key || !client?.ghl_location_id) {
      return new Response(JSON.stringify({ success: false, error: "Client missing GHL credentials" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Batch mode: reconcile leads not synced recently, oldest-synced first
    if (syncAll) {
      const cutoff = new Date(Date.now() - sinceDays * 86400_000).toISOString();
      const { data: staleLeads, error: staleErr } = await supabase
        .from("leads")
        .select("id, external_id, email, pipeline_status, created_at")
        .eq("client_id", clientId)
        .eq("is_spam", false)
        .not("external_id", "is", null)
        .not("pipeline_status", "in", '("funded","lost")') // terminal states don't need re-sync
        .gte("created_at", cutoff)
        .order("ghl_last_synced_at", { ascending: true, nullsFirst: true })
        .limit(Math.min(limit, 500));
      if (staleErr) throw staleErr;

      const results: any[] = [];
      let transitions = 0;
      for (const lead of staleLeads || []) {
        try {
          const r = await syncOneLead(supabase, supabaseUrl, supabaseKey, client, lead);
          if (r.transitions.length > 0) transitions++;
          results.push(r);
          await new Promise(r2 => setTimeout(r2, 250)); // GHL rate-limit courtesy
        } catch (err) {
          results.push({ leadId: lead.id, error: err instanceof Error ? err.message : "unknown" });
        }
      }

      await supabase.from("sync_runs").insert({
        client_id: clientId,
        source: "ghl",
        function_name: "lead-status-sync-v2",
        finished_at: new Date().toISOString(),
        status: "success",
        rows_written: transitions,
        metadata: { mode: "batch", leadsChecked: results.length, transitions, sinceDays },
      }).then(() => {});

      return new Response(JSON.stringify({
        success: true, mode: "batch",
        leadsChecked: results.length, transitions,
        results: results.filter(r => r.transitions?.length > 0 || r.error), // only interesting rows
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Single mode: resolve the lead
    let leadQuery = supabase.from("leads")
      .select("id, external_id, email, pipeline_status, created_at")
      .eq("client_id", clientId);
    if (leadId) leadQuery = leadQuery.eq("id", leadId);
    else if (ghlContactId) leadQuery = leadQuery.eq("external_id", ghlContactId);
    else if (email) leadQuery = leadQuery.eq("email", email.trim().toLowerCase());
    else {
      return new Response(JSON.stringify({ success: false, error: "leadId, ghlContactId, or email required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: lead } = await leadQuery.order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (!lead) {
      return new Response(JSON.stringify({ success: false, error: "Lead not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!lead.external_id) {
      return new Response(JSON.stringify({ success: false, error: "Lead has no GHL contact ID (external_id)" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const result = await syncOneLead(supabase, supabaseUrl, supabaseKey, client, lead);
    return new Response(JSON.stringify({ success: true, ...result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[lead-status-sync-v2] Error:", error);
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
