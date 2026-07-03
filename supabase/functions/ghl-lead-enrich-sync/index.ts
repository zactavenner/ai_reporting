import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GHL_BASE_URL = "https://services.leadconnectorhq.com";
const GHL_API_VERSION = "2021-07-28";

/**
 * Bi-directional GHL sync with enrichment.
 *
 * Two modes:
 *
 * A) ENQUEUE mode (called by ghl-webhook-router on new lead):
 *    POST with { clientId, leadId, ghlContactId, operation: "enrich_and_sync_back" }
 *    → Writes a job to ghl_sync_queue for durable retry
 *
 * B) PROCESS mode (called by scheduled worker, every 1 minute):
 *    POST with { processQueue: true, limit: 20 }
 *    → Claims pending jobs from queue, processes each with exponential backoff
 *
 * Operations supported:
 *   - enrich_and_sync_back: pull enrichment data from Retargetiq or similar, push back to GHL
 *   - push_field: update a specific GHL custom field
 *   - add_tag / remove_tag: tag management
 *   - update_stage: move opportunity in pipeline
 */

interface GhlJob {
  id: string;
  client_id: string;
  lead_id: string | null;
  ghl_contact_id: string | null;
  operation: string;
  payload: Record<string, any>;
  attempts: number;
  max_attempts: number;
}

// ── GHL API helpers ──

async function ghlUpdateContact(
  apiKey: string,
  locationId: string,
  contactId: string,
  updates: Record<string, any>,
): Promise<{ ok: boolean; status: number; body: any }> {
  const res = await fetch(`${GHL_BASE_URL}/contacts/${contactId}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Version: GHL_API_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ...updates, locationId }),
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body };
}

async function ghlAddTag(
  apiKey: string,
  contactId: string,
  tags: string[],
): Promise<{ ok: boolean; status: number; body: any }> {
  const res = await fetch(`${GHL_BASE_URL}/contacts/${contactId}/tags`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Version: GHL_API_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ tags }),
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body };
}

async function ghlRemoveTag(
  apiKey: string,
  contactId: string,
  tags: string[],
): Promise<{ ok: boolean; status: number; body: any }> {
  const res = await fetch(`${GHL_BASE_URL}/contacts/${contactId}/tags`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Version: GHL_API_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ tags }),
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body };
}

// ── Enrichment ──
// Calls the existing enrich-lead-retargetiq edge function (RetargetIQ v2 API:
// GetDataByPhone/GetDataByEmail with api_key + website slug in the body).
// Requires the lead's email/phone and the client's retargetiq_website_slug.
async function enrichLead(
  supabase: any,
  supabaseUrl: string,
  supabaseKey: string,
  clientId: string,
  leadId: string,
): Promise<Record<string, any> | null> {
  try {
    const { data: lead } = await supabase
      .from("leads")
      .select("id, external_id, email, phone, name")
      .eq("id", leadId)
      .maybeSingle();
    if (!lead || (!lead.email && !lead.phone)) return null;

    const { data: settings } = await supabase
      .from("client_settings")
      .select("retargetiq_website_slug")
      .eq("client_id", clientId)
      .maybeSingle();

    const res = await fetch(`${supabaseUrl}/functions/v1/enrich-lead-retargetiq`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${supabaseKey}`,
      },
      body: JSON.stringify({
        client_id: clientId,
        lead_id: leadId,
        external_id: lead.external_id,
        email: lead.email,
        phone: lead.phone,
        website_slug: settings?.retargetiq_website_slug || undefined,
      }),
    });
    if (!res.ok) {
      console.warn(`[ghl-lead-enrich-sync] Enrichment failed for lead ${leadId}: ${res.status}`);
      return null;
    }
    const data = await res.json();
    return data.enrichment || data.identity || data.data || null;
  } catch (err) {
    console.warn(`[ghl-lead-enrich-sync] Enrichment error for lead ${leadId}:`, err);
    return null;
  }
}

// Write the enrichment summary as a note on the GHL contact so reps see it
// in the CRM without leaving GHL.
async function ghlCreateNote(
  apiKey: string,
  contactId: string,
  noteBody: string,
): Promise<{ ok: boolean; status: number }> {
  const res = await fetch(`${GHL_BASE_URL}/contacts/${contactId}/notes`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Version: GHL_API_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ body: noteBody }),
  });
  return { ok: res.ok, status: res.status };
}

// Format RetargetIQ identity data as a readable CRM note
function formatEnrichmentNote(e: Record<string, any>): string {
  const lines: string[] = ["🔎 RetargetIQ Enrichment"];
  const d = e.data || e;
  const fin = e.finances || d.finances || {};
  const add = (label: string, v: any) => { if (v !== undefined && v !== null && `${v}`.trim() !== "") lines.push(`${label}: ${v}`); };
  add("Name", [e.firstName, e.lastName].filter(Boolean).join(" "));
  add("Location", [e.city, e.state, e.zip].filter(Boolean).join(", "));
  add("Age", d.age);
  add("Occupation", d.occupation || d.jobTitle);
  add("Household Income", fin.householdIncome || d.householdIncome || d.income_range);
  add("Net Worth", fin.netWorth || d.netWorth || d.net_worth);
  add("Credit Range", fin.creditRange || d.creditRange);
  add("Investments", fin.investmentActivity || d.investments);
  const company = (e.companies || [])[0] || {};
  add("Company", company.company || company.name || e.company_name);
  add("Title", company.title || e.job_title);
  add("LinkedIn", company.linkedin || e.linkedin_url);
  add("Accredited (est.)", e.accredited);
  lines.push(`— synced ${new Date().toISOString().split("T")[0]}`);
  return lines.join("\n");
}

// ── Process a single job ──
async function processJob(supabase: any, supabaseUrl: string, supabaseKey: string, job: GhlJob): Promise<void> {
  // Load client credentials
  const { data: client, error: clientErr } = await supabase
    .from("clients")
    .select("id, name, ghl_api_key, ghl_location_id")
    .eq("id", job.client_id)
    .maybeSingle();

  if (clientErr || !client) {
    throw new Error(`Client ${job.client_id} not found or inaccessible`);
  }
  if (!client.ghl_api_key || !client.ghl_location_id) {
    throw new Error(`Client ${client.name} has no GHL credentials configured`);
  }

  const ghlContactId = job.ghl_contact_id || job.payload.ghl_contact_id;
  if (!ghlContactId && job.operation !== "enrich_and_sync_back") {
    throw new Error(`Job ${job.id} missing ghl_contact_id for operation ${job.operation}`);
  }

  switch (job.operation) {
    case "enrich_and_sync_back": {
      if (!job.lead_id) throw new Error("enrich_and_sync_back requires lead_id");

      // Step 1: Enrich the lead
      const enrichment = await enrichLead(supabase, supabaseUrl, supabaseKey, job.client_id, job.lead_id);
      if (!enrichment) {
        // Enrichment unavailable — not a hard failure, just log and succeed
        console.log(`[ghl-lead-enrich-sync] No enrichment data for lead ${job.lead_id}; skipping write-back`);
        await supabase.rpc("ghl_queue_mark_succeeded", {
          p_job_id: job.id,
          p_response: { skipped: true, reason: "no_enrichment_data" },
        });
        return;
      }

      // Step 2: Resolve ghl_contact_id if not provided
      let resolvedContactId = ghlContactId;
      if (!resolvedContactId) {
        const { data: lead } = await supabase
          .from("leads")
          .select("external_id, metadata")
          .eq("id", job.lead_id)
          .maybeSingle();
        resolvedContactId = lead?.external_id || lead?.metadata?.ghl_contact_id || null;
      }
      if (!resolvedContactId) {
        throw new Error(`Lead ${job.lead_id} has no GHL contact ID to sync back to`);
      }

      // Step 3: Build GHL update payload from enrichment data
      const updates: Record<string, any> = {};
      const customFields: Array<{ key: string; field_value: any }> = [];

      if (enrichment.company_name) customFields.push({ key: "company_name", field_value: enrichment.company_name });
      if (enrichment.income_range) customFields.push({ key: "income_range", field_value: enrichment.income_range });
      if (enrichment.net_worth) customFields.push({ key: "net_worth", field_value: enrichment.net_worth });
      if (enrichment.accredited !== undefined) customFields.push({ key: "accredited_investor", field_value: String(enrichment.accredited) });
      if (enrichment.linkedin_url) customFields.push({ key: "linkedin_url", field_value: enrichment.linkedin_url });
      if (enrichment.job_title) customFields.push({ key: "job_title", field_value: enrichment.job_title });

      if (customFields.length > 0) {
        updates.customFields = customFields;
      }

      // Also add enrichment tags for segmentation
      const tags: string[] = [];
      if (enrichment.accredited === true) tags.push("accredited");
      if (enrichment.high_net_worth === true) tags.push("high-net-worth");
      tags.push("enriched");

      // Step 4: Write back to GHL
      const updateResult = await ghlUpdateContact(client.ghl_api_key, client.ghl_location_id, resolvedContactId, updates);
      if (!updateResult.ok) {
        throw new Error(`GHL update failed (${updateResult.status}): ${JSON.stringify(updateResult.body).substring(0, 300)}`);
      }

      if (tags.length > 0) {
        const tagResult = await ghlAddTag(client.ghl_api_key, resolvedContactId, tags);
        if (!tagResult.ok) {
          console.warn(`[ghl-lead-enrich-sync] Tag add failed (non-fatal): ${tagResult.status}`);
        }
      }

      // Step 5: Write the enrichment summary as a GHL note (once per lead —
      // enrichment_note_synced_at guards against duplicate notes on retries)
      let noteWritten = false;
      const { data: leadRow } = await supabase
        .from("leads")
        .select("enrichment_note_synced_at")
        .eq("id", job.lead_id)
        .maybeSingle();
      if (!leadRow?.enrichment_note_synced_at) {
        const noteResult = await ghlCreateNote(
          client.ghl_api_key,
          resolvedContactId,
          formatEnrichmentNote(enrichment),
        );
        noteWritten = noteResult.ok;
        if (noteResult.ok) {
          await supabase.from("leads").update({
            enrichment_note_synced_at: new Date().toISOString(),
          }).eq("id", job.lead_id);
        } else {
          console.warn(`[ghl-lead-enrich-sync] Note create failed (non-fatal): ${noteResult.status}`);
        }
      }

      // Mark succeeded
      await supabase.rpc("ghl_queue_mark_succeeded", {
        p_job_id: job.id,
        p_response: { updates, tags, noteWritten, enrichment_fields: Object.keys(enrichment) },
      });

      // Also update local lead metadata for future reference
      await supabase.from("leads").update({
        metadata: { enriched_at: new Date().toISOString(), enrichment_data: enrichment },
      }).eq("id", job.lead_id);

      break;
    }

    case "push_field": {
      const { field_key, field_value } = job.payload;
      if (!field_key) throw new Error("push_field requires payload.field_key");

      const result = await ghlUpdateContact(client.ghl_api_key, client.ghl_location_id, ghlContactId!, {
        customFields: [{ key: field_key, field_value }],
      });
      if (!result.ok) {
        throw new Error(`GHL field update failed (${result.status}): ${JSON.stringify(result.body).substring(0, 300)}`);
      }
      await supabase.rpc("ghl_queue_mark_succeeded", { p_job_id: job.id, p_response: result.body });
      break;
    }

    case "add_tag": {
      const tags: string[] = job.payload.tags || [];
      if (tags.length === 0) throw new Error("add_tag requires payload.tags[]");
      const result = await ghlAddTag(client.ghl_api_key, ghlContactId!, tags);
      if (!result.ok) {
        throw new Error(`GHL add_tag failed (${result.status}): ${JSON.stringify(result.body).substring(0, 300)}`);
      }
      await supabase.rpc("ghl_queue_mark_succeeded", { p_job_id: job.id, p_response: result.body });
      break;
    }

    case "remove_tag": {
      const tags: string[] = job.payload.tags || [];
      if (tags.length === 0) throw new Error("remove_tag requires payload.tags[]");
      const result = await ghlRemoveTag(client.ghl_api_key, ghlContactId!, tags);
      if (!result.ok) {
        throw new Error(`GHL remove_tag failed (${result.status}): ${JSON.stringify(result.body).substring(0, 300)}`);
      }
      await supabase.rpc("ghl_queue_mark_succeeded", { p_job_id: job.id, p_response: result.body });
      break;
    }

    default:
      throw new Error(`Unsupported operation: ${job.operation}`);
  }
}

// ── Enqueue a job ──
async function enqueueJob(supabase: any, input: {
  clientId: string;
  leadId?: string;
  ghlContactId?: string;
  operation: string;
  payload?: Record<string, any>;
  dedupKey?: string;
  priority?: number;
}): Promise<{ jobId: string; duplicate: boolean }> {
  // Build a natural dedup key if none provided (lead + operation + hour bucket)
  const autoDedupKey = input.dedupKey || (input.leadId
    ? `${input.clientId}|${input.leadId}|${input.operation}|${Math.floor(Date.now() / 3_600_000)}`
    : null);

  const { data, error } = await supabase
    .from("ghl_sync_queue")
    .insert({
      client_id: input.clientId,
      lead_id: input.leadId || null,
      ghl_contact_id: input.ghlContactId || null,
      operation: input.operation,
      payload: input.payload || {},
      dedup_key: autoDedupKey,
      priority: input.priority || 0,
    })
    .select("id")
    .single();

  if (error) {
    // Duplicate on dedup_key is OK — it means the job was already enqueued
    if (error.code === "23505") {
      return { jobId: "", duplicate: true };
    }
    throw new Error(`Failed to enqueue job: ${error.message}`);
  }
  return { jobId: data.id, duplicate: false };
}

// ── Handler ──
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const body = await req.json();

    // Process mode: claim and process a batch of pending jobs
    if (body.processQueue) {
      const limit = body.limit || 20;
      const { data: jobs, error: claimErr } = await supabase.rpc("ghl_queue_claim_jobs", { p_limit: limit });

      if (claimErr) throw new Error(`Failed to claim jobs: ${claimErr.message}`);
      if (!jobs || jobs.length === 0) {
        return new Response(JSON.stringify({ success: true, processed: 0 }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const results: Array<{ jobId: string; status: string; error?: string }> = [];
      for (const job of jobs as GhlJob[]) {
        try {
          await processJob(supabase, supabaseUrl, supabaseKey, job);
          results.push({ jobId: job.id, status: "succeeded" });
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : "Unknown error";
          console.error(`[ghl-lead-enrich-sync] Job ${job.id} failed (attempt ${job.attempts}/${job.max_attempts}):`, errMsg);
          await supabase.rpc("ghl_queue_mark_failed", { p_job_id: job.id, p_error: errMsg });
          results.push({ jobId: job.id, status: "failed", error: errMsg });
        }
      }

      return new Response(JSON.stringify({
        success: true,
        processed: jobs.length,
        succeeded: results.filter(r => r.status === "succeeded").length,
        failed: results.filter(r => r.status === "failed").length,
        results,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Enqueue mode: add a job to the queue
    const { clientId, leadId, ghlContactId, operation, payload, dedupKey, priority } = body;
    if (!clientId || !operation) {
      return new Response(JSON.stringify({ success: false, error: "clientId and operation required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const result = await enqueueJob(supabase, { clientId, leadId, ghlContactId, operation, payload, dedupKey, priority });
    return new Response(JSON.stringify({
      success: true,
      jobId: result.jobId,
      duplicate: result.duplicate,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    console.error("[ghl-lead-enrich-sync] Error:", error);
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
