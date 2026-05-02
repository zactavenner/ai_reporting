import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { enqueueLeadUpsert } from "../_shared/enqueue-sync-job.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ============================================================
// WEBHOOK PROCESSING
// ============================================================
// URL formats supported:
//   1. NEW:    /webhook-ingest/<client-slug>-<event>
//              e.g. /webhook-ingest/jj-dental-lead
//   2. LEGACY: /webhook-ingest/<client-uuid>/<event>
//              e.g. /webhook-ingest/abc-123-uuid/lead
//
// Allowed events: lead, booked, showed, reconnect, reconnect-showed,
//   committed, funded, ad_spend, ad-spend, bad-lead, opportunity, appointment,
//   contact, contacts, plus full GHL webhook event names (ContactCreate, etc.)
// ============================================================

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Canonical event allowlist (case-insensitive). Multi-word events like
// "reconnect-showed" or "ad-spend" must be listed so the slug parser knows
// to peel off two trailing tokens instead of one.
const EVENT_ALLOWLIST = new Set<string>([
  'lead', 'booked', 'showed', 'reconnect', 'reconnect-showed',
  'committed', 'funded', 'ad-spend', 'ad_spend', 'bad-lead',
  'opportunity', 'appointment', 'contact', 'contacts',
]);

// Normalize event token to internal type
function normalizeEvent(ev: string): string {
  const e = ev.toLowerCase();
  if (e === 'ad-spend') return 'ad_spend';
  return e;
}

/**
 * Try to parse "<slug>-<event>" by greedily matching the longest known
 * event suffix. Returns { slug, event } or null if no allowlisted event matches.
 */
function parseSlugEvent(identifier: string): { slug: string; event: string } | null {
  const lower = identifier.toLowerCase();
  // Try 2-token events first (reconnect-showed, ad-spend, bad-lead), then 1-token
  const candidates = [...EVENT_ALLOWLIST].sort((a, b) => b.length - a.length);
  for (const ev of candidates) {
    const suffix = `-${ev}`;
    if (lower.endsWith(suffix) && lower.length > suffix.length) {
      return { slug: lower.slice(0, -suffix.length), event: normalizeEvent(ev) };
    }
  }
  return null;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const url = new URL(req.url);
    const pathParts = url.pathname.split('/').filter(Boolean);
    // pathParts[0] === 'webhook-ingest'
    const seg1 = pathParts[1];
    const seg2 = pathParts[2];

    let clientId: string | null = null;
    let webhookType: string | null = null;
    let resolvedSlug: string | null = null;

    if (!seg1) {
      return new Response(
        JSON.stringify({ error: 'Missing path segment. Use /webhook-ingest/<slug>-<event>' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (UUID_RE.test(seg1) && seg2) {
      // Legacy: /webhook-ingest/<uuid>/<event>
      clientId = seg1;
      webhookType = seg2;
    } else {
      // New slug-based: /webhook-ingest/<slug>-<event>
      const parsed = parseSlugEvent(seg1);
      if (!parsed) {
        return new Response(
          JSON.stringify({
            error: 'Invalid webhook path. Expected /webhook-ingest/<client-slug>-<event>',
            allowed_events: [...EVENT_ALLOWLIST],
            received: seg1,
          }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      resolvedSlug = parsed.slug;
      webhookType = parsed.event;

      // Resolve slug → client_id (case-insensitive). Try exact first.
      const { data: bySlug } = await supabase
        .from('clients')
        .select('id, slug')
        .ilike('slug', parsed.slug)
        .limit(1)
        .maybeSingle();

      if (bySlug) {
        clientId = bySlug.id;
      } else {
        // Fuzzy fallback: longest slug that is a prefix of identifier.
        // Useful if event token contained extra hyphens.
        const { data: candidates } = await supabase
          .from('clients')
          .select('id, slug')
          .not('slug', 'is', null);
        if (candidates && candidates.length) {
          const lowerId = seg1.toLowerCase();
          const match = candidates
            .filter(c => c.slug && lowerId.startsWith(c.slug.toLowerCase() + '-'))
            .sort((a, b) => (b.slug?.length ?? 0) - (a.slug?.length ?? 0))[0];
          if (match) {
            clientId = match.id;
            resolvedSlug = match.slug;
            const trailing = lowerId.slice((match.slug?.length ?? 0) + 1);
            if (EVENT_ALLOWLIST.has(trailing)) {
              webhookType = normalizeEvent(trailing);
            }
          }
        }
      }

      if (!clientId) {
        return new Response(
          JSON.stringify({
            error: `No client found for slug "${parsed.slug}"`,
            hint: 'Check the client slug in Settings → Webhooks',
          }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    let payload: any;
    try {
      payload = await req.json();
    } catch {
      return new Response(
        JSON.stringify({ error: 'Invalid JSON payload' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Verify client exists
    const { data: client, error: clientError } = await supabase
      .from('clients')
      .select('id, name, ghl_api_key, ghl_location_id')
      .eq('id', clientId)
      .single();

    if (clientError || !client) {
      console.error('Client not found:', clientId);
      return new Response(
        JSON.stringify({ error: 'Client not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Always log every inbound webhook hit so Sync Health → Webhook Feed populates.
    // Best-effort: never let a logging failure break ingestion.
    const logHit = async (status: 'success' | 'error', errorMessage?: string) => {
      try {
        await supabase.from('webhook_logs').insert({
          client_id: clientId,
          webhook_type: webhookType,
          status,
          payload: payload ?? {},
          error_message: errorMessage ?? null,
          processed_at: new Date().toISOString(),
        });
      } catch (e) {
        console.error('webhook_logs insert failed:', e);
      }
    };

    // Lightweight per-client rate limit (200 req/min) using api_usage table.
    try {
      const oneMinAgo = new Date(Date.now() - 60_000).toISOString();
      const { count } = await supabase
        .from('api_usage')
        .select('id', { count: 'exact', head: true })
        .eq('client_id', clientId)
        .eq('service', 'webhook-ingest')
        .gte('created_at', oneMinAgo);
      if ((count ?? 0) > 200) {
        await logHit('error', 'rate_limit_exceeded');
        return new Response(
          JSON.stringify({ error: 'Rate limit exceeded (200 req/min per client)' }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      await supabase.from('api_usage').insert({
        api_name: 'webhook-ingest',
        service: 'webhook-ingest',
        client_id: clientId,
        endpoint: webhookType,
        success: true,
      });
    } catch (rlErr) {
      console.warn('Rate limit check failed (continuing):', rlErr);
    }

    // ============================================================
    // AD SPEND WEBHOOKS - Process inline
    // ============================================================
    if (webhookType === 'ad_spend') {
      console.log(`[ACTIVE] Ad spend webhook - Client: ${client.name} (${clientId})`);
      
      const records = Array.isArray(payload) ? payload : [payload];
      let insertedCount = 0;
      
      for (const record of records) {
        const reportedAt = record.reported_at || record.date || new Date().toISOString().split('T')[0];
        
        const adSpendRecord = {
          client_id: clientId,
          reported_at: reportedAt,
          spend: parseFloat(record.spend) || 0,
          impressions: parseInt(record.impressions) || null,
          clicks: parseInt(record.clicks) || null,
          platform: record.platform || 'facebook',
          campaign_name: record.campaign_name || record.campaign || null,
          ad_set_name: record.ad_set_name || record.adset || null,
        };

        const { error: insertError } = await supabase
          .from('ad_spend_reports')
          .upsert(adSpendRecord, { 
            onConflict: 'client_id,reported_at,platform,campaign_name',
            ignoreDuplicates: false 
          });

        if (insertError) {
          console.error('Error inserting ad spend:', insertError);
        } else {
          insertedCount++;
        }
      }
      await logHit('success');

      return new Response(
        JSON.stringify({
          success: true,
          status: 'processed',
          message: `Processed ${insertedCount} ad spend records`,
          webhook_type: webhookType,
          client_id: clientId,
          slug: resolvedSlug,
          received_at: new Date().toISOString(),
        }),
        { 
          status: 200, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    // ============================================================
    // CONTACT & OPPORTUNITY WEBHOOKS - Auto-sync everything
    // ============================================================
    const contactWebhookTypes = [
      'contact', 'contacts', 'contact_created', 'contact_updated',
      'ContactCreate', 'ContactUpdate', 'ContactDndUpdate',
      'ContactTagUpdate', 'ContactDelete',
      'opportunity', 'opportunities', 'opportunity_created', 'opportunity_updated',
      'OpportunityCreate', 'OpportunityUpdate', 'OpportunityStageUpdate',
      'OpportunityStatusUpdate', 'OpportunityMonetaryValueUpdate',
      'appointment', 'appointments', 'AppointmentCreate', 'AppointmentUpdate',
      'TaskCreate', 'TaskUpdate', 'NoteCreate', 'NoteUpdate',
    ];

    // Extract the GHL contact ID from various webhook payload formats
    const extractContactId = (payload: any): string | null => {
      // Direct contactId field
      if (payload.contactId) return payload.contactId;
      if (payload.contact_id) return payload.contact_id;
      // Contact object with id
      if (payload.contact?.id) return payload.contact.id;
      // For opportunity webhooks
      if (payload.opportunity?.contactId) return payload.opportunity.contactId;
      if (payload.opportunity?.contact_id) return payload.opportunity.contact_id;
      // For appointment webhooks
      if (payload.appointment?.contactId) return payload.appointment.contactId;
      // The payload itself might be the contact
      if (payload.id && (payload.firstName || payload.lastName || payload.email || payload.phone)) {
        return payload.id;
      }
      return null;
    };

    if (contactWebhookTypes.some(t => webhookType.toLowerCase().includes(t.toLowerCase()) || webhookType === t)) {
      const contactId = extractContactId(payload);
      
      console.log(`[AUTO-SYNC] ${webhookType} webhook - Client: ${client.name}, ContactId: ${contactId || 'unknown'}`);
      
      // ── Bulletproof safety net ──────────────────────────────────────
      // Always enqueue a `lead_upsert` job so the queue/dispatcher
      // guarantees this contact's basic info lands in `leads` even if
      // the inline `sync-ghl-contacts` call below times out or fails.
      // Webhook deduplication uses provider event id when present.
      if (contactId) {
        try {
          // 1. Dedup: record the inbound webhook (best-effort)
          const providerEventId =
            (payload as any).webhookId ||
            (payload as any).id ||
            `${webhookType}:${contactId}:${Date.now()}`;
          await supabase
            .from("webhook_events")
            .insert({
              provider: "ghl",
              provider_event_id: String(providerEventId),
              event_type: webhookType,
              client_id: clientId,
              raw_payload: payload,
            })
            .select("id")
            .maybeSingle();

          // 2. Enqueue a lead_upsert job with whatever data we already have
          const fields: Record<string, unknown> = {};
          const c = (payload as any).contact || payload;
          const fullName = [c.firstName ?? c.first_name, c.lastName ?? c.last_name]
            .filter(Boolean).join(" ").trim();
          if (fullName) fields.name = fullName;
          else if (c.name) fields.name = c.name;
          if (c.email) fields.email = c.email;
          if (c.phone) fields.phone = c.phone;
          if (c.source) fields.source = c.source;
          if ((c as any).utm_source) fields.utm_source = (c as any).utm_source;
          if ((c as any).utm_campaign) fields.utm_campaign = (c as any).utm_campaign;
          if ((c as any).utm_medium) fields.utm_medium = (c as any).utm_medium;

          await enqueueLeadUpsert(supabase, {
            client_id: clientId,
            external_id: contactId,
            source: "webhook",
            provider: "ghl",
            fields,
          });
        } catch (e) {
          console.error("[webhook-ingest] enqueue safety net failed:", e);
        }
      }
      // ────────────────────────────────────────────────────────────────

      if (contactId && client.ghl_api_key && client.ghl_location_id) {
        // Fire-and-forget: call sync-ghl-contacts with single_contact mode
        // This runs the comprehensive sync (contact info, fields, pipelines, value, timelines)
        const syncUrl = `${supabaseUrl}/functions/v1/sync-ghl-contacts`;
        
        const syncPayload = {
          mode: 'single',
          client_id: clientId,
          contactId: contactId,
        };
        
        // Use EdgeRuntime.waitUntil for background execution so we respond immediately
        const syncPromise = fetch(syncUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
          },
          body: JSON.stringify(syncPayload),
        }).then(async (res) => {
          const result = await res.text();
          console.log(`[AUTO-SYNC] Single contact sync completed for ${contactId}: ${res.status} - ${result.substring(0, 200)}`);
          
          // Trigger metric refresh for this client + today so dashboard updates in near real-time
          const today = new Date().toISOString().split('T')[0];
          const recalcUrl = `${supabaseUrl}/functions/v1/recalculate-daily-metrics`;
          try {
            const recalcRes = await fetch(recalcUrl, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
              },
              body: JSON.stringify({ clientId, startDate: today, endDate: today }),
            });
            console.log(`[AUTO-SYNC] Metric refresh for ${clientId} on ${today}: ${recalcRes.status}`);
          } catch (recalcErr) {
            console.error(`[AUTO-SYNC] Metric refresh failed for ${clientId}:`, recalcErr);
          }
        }).catch((err) => {
          console.error(`[AUTO-SYNC] Single contact sync failed for ${contactId}:`, err);
        });

        // @ts-ignore - EdgeRuntime is available in Supabase Edge Functions
        if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime.waitUntil) {
          // @ts-ignore
          EdgeRuntime.waitUntil(syncPromise);
        }
        // If EdgeRuntime not available, the fetch is already fire-and-forget
        
        await logHit('success');
        return new Response(
          JSON.stringify({
            success: true,
            status: 'auto_sync_triggered',
            message: `Webhook received. Full contact sync triggered for ${contactId} (contact info, fields, pipelines, value, timelines).`,
            webhook_type: webhookType,
            client_id: clientId,
            contact_id: contactId,
            received_at: new Date().toISOString(),
          }),
          { 
            status: 200, 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          }
        );
      } else {
        // No contact ID or no GHL credentials - acknowledge but can't sync
        console.log(`[AUTO-SYNC] Cannot sync - contactId: ${contactId}, hasApiKey: ${!!client.ghl_api_key}, hasLocationId: ${!!client.ghl_location_id}`);
        await logHit('success');
        
        return new Response(
          JSON.stringify({
            success: true,
            status: 'acknowledged',
            message: contactId 
              ? 'Webhook received but client has no GHL credentials configured for auto-sync.'
              : 'Webhook received but no contact ID could be extracted from payload.',
            webhook_type: webhookType,
            client_id: clientId,
            received_at: new Date().toISOString(),
          }),
          { 
            status: 200, 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          }
        );
      }
    }

    // All other webhook types - acknowledge without processing
    console.log(`[ACK] Webhook received - Type: ${webhookType}, Client: ${client.name} (${clientId})`);
    await logHit('success');

    return new Response(
      JSON.stringify({
        success: true,
        status: 'acknowledged',
        message: 'Webhook acknowledged.',
        webhook_type: webhookType,
        client_id: clientId,
        received_at: new Date().toISOString(),
      }),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );

  } catch (error) {
    console.error('Webhook error:', error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
