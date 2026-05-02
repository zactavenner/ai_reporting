import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ============================================================
// process-lead-upsert
// Single idempotent writer for the leads table.
// All ingestion paths (webhook, cursor sync, master sync, manual)
// MUST go through this function so that:
//   - Upserts are deduplicated on (client_id, external_id)
//   - Original created_at is preserved
//   - Every change is recorded in lead_change_log
//   - Empty/null incoming values do NOT clobber existing data
// ============================================================

type LeadPayload = {
  client_id: string;
  external_id: string; // GHL contact id or provider equivalent
  source: string;       // webhook | cursor_sync | master_sync | manual | reconciliation
  provider?: string;    // ghl | meta | manual
  job_id?: string;      // sync_queue.id if invoked from queue
  fields: Record<string, unknown>; // columns to write on the leads row
};

// Fields that must never be overwritten with null/empty values from a partial payload.
// (We only update them when the incoming value is non-empty.)
const PRESERVE_IF_EMPTY = new Set([
  "lead_name", "first_name", "last_name", "email", "phone",
  "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term",
  "source", "ad_id", "adset_id", "campaign_id",
]);

function isEmpty(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === "string" && v.trim() === "");
}

function diffFields(
  existing: Record<string, unknown> | null,
  incoming: Record<string, unknown>,
): { changed: Record<string, { from: unknown; to: unknown }>; toWrite: Record<string, unknown> } {
  const changed: Record<string, { from: unknown; to: unknown }> = {};
  const toWrite: Record<string, unknown> = {};

  for (const [key, newVal] of Object.entries(incoming)) {
    if (key === "id" || key === "created_at") continue;

    // Don't clobber existing data with empty incoming values
    if (PRESERVE_IF_EMPTY.has(key) && isEmpty(newVal)) continue;

    const oldVal = existing ? existing[key] : undefined;
    // Cheap deep-ish compare via JSON
    if (JSON.stringify(oldVal ?? null) !== JSON.stringify(newVal ?? null)) {
      changed[key] = { from: oldVal ?? null, to: newVal ?? null };
      toWrite[key] = newVal;
    }
  }

  return { changed, toWrite };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceKey);

  let payload: LeadPayload;
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: "invalid_json" }, 400);
  }

  // Validate
  if (!payload?.client_id || !payload?.external_id || !payload?.source || !payload?.fields) {
    return jsonResponse({
      error: "missing_required_fields",
      required: ["client_id", "external_id", "source", "fields"],
    }, 400);
  }

  const { client_id, external_id, source, provider, job_id, fields } = payload;

  try {
    // 1. Fetch existing row (if any)
    const { data: existing, error: fetchErr } = await supabase
      .from("leads")
      .select("*")
      .eq("client_id", client_id)
      .eq("external_id", external_id)
      .maybeSingle();

    if (fetchErr) {
      console.error("[process-lead-upsert] fetch error:", fetchErr);
      return jsonResponse({ error: "fetch_failed", details: fetchErr.message }, 500);
    }

    // 2. Diff
    const incoming = { ...fields, client_id, external_id };
    const { changed, toWrite } = diffFields(existing as Record<string, unknown> | null, incoming);

    let action: "insert" | "update" | "no_op" = "no_op";
    let leadId: string | null = (existing as { id?: string } | null)?.id ?? null;

    if (!existing) {
      // INSERT — preserve incoming created_at if provided, otherwise default
      const insertRow: Record<string, unknown> = {
        client_id,
        external_id,
        ...fields,
      };
      const { data: inserted, error: insertErr } = await supabase
        .from("leads")
        .insert(insertRow)
        .select("id")
        .single();

      if (insertErr) {
        // Race: another worker inserted first. Re-fetch and treat as update.
        if (insertErr.code === "23505") {
          const { data: raceExisting } = await supabase
            .from("leads")
            .select("*")
            .eq("client_id", client_id)
            .eq("external_id", external_id)
            .maybeSingle();
          if (raceExisting) {
            const raced = diffFields(raceExisting as Record<string, unknown>, incoming);
            if (Object.keys(raced.toWrite).length > 0) {
              const { error: upErr } = await supabase
                .from("leads")
                .update(raced.toWrite)
                .eq("id", (raceExisting as { id: string }).id);
              if (upErr) {
                return jsonResponse({ error: "race_update_failed", details: upErr.message }, 500);
              }
              action = "update";
              leadId = (raceExisting as { id: string }).id;
            } else {
              action = "no_op";
              leadId = (raceExisting as { id: string }).id;
            }
          }
        } else {
          console.error("[process-lead-upsert] insert error:", insertErr);
          return jsonResponse({ error: "insert_failed", details: insertErr.message }, 500);
        }
      } else {
        action = "insert";
        leadId = inserted.id;
      }
    } else if (Object.keys(toWrite).length > 0) {
      // UPDATE only changed fields
      const { error: updateErr } = await supabase
        .from("leads")
        .update(toWrite)
        .eq("id", (existing as { id: string }).id);

      if (updateErr) {
        console.error("[process-lead-upsert] update error:", updateErr);
        return jsonResponse({ error: "update_failed", details: updateErr.message }, 500);
      }
      action = "update";
    }

    // 3. Audit log (only when something actually changed)
    if (action !== "no_op") {
      await supabase.from("lead_change_log").insert({
        lead_id: leadId,
        client_id,
        external_id,
        source,
        provider: provider ?? null,
        action,
        changed_fields: changed,
        job_id: job_id ?? null,
      });
    }

    return jsonResponse({
      ok: true,
      action,
      lead_id: leadId,
      changed_field_count: Object.keys(changed).length,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    console.error("[process-lead-upsert] unhandled:", msg);
    return jsonResponse({ error: "unhandled", details: msg }, 500);
  }
});
