import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const GHL_BASE_URL = 'https://services.leadconnectorhq.com';

// Retry helper for GHL API calls — handles 429 rate limiting with exponential backoff
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  maxRetries: number = 3
): Promise<Response> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, options);
    if (response.status === 429 && attempt < maxRetries) {
      const retryAfter = parseInt(response.headers.get('retry-after') || '0', 10);
      const delayMs = retryAfter > 0 ? retryAfter * 1000 : Math.min(2000 * Math.pow(2, attempt), 30000);
      console.warn(`[sync-calendar] 429 rate limited, retrying in ${delayMs}ms (attempt ${attempt + 1}/${maxRetries})`);
      await new Promise(r => setTimeout(r, delayMs));
      continue;
    }
    return response;
  }
  return fetch(url, options);
}

// Fix 4: Configurable GHL status mapping — normalized to lowercase, trimmed
const GHL_STATUS_MAP: Record<string, { outcome: string; showed: boolean }> = {
  'showed': { outcome: 'showed', showed: true },
  'completed': { outcome: 'showed', showed: true },
  'noshow': { outcome: 'no_show', showed: false },
  'no-show': { outcome: 'no_show', showed: false },
  'no_show': { outcome: 'no_show', showed: false },
  'cancelled': { outcome: 'cancelled', showed: false },
  'canceled': { outcome: 'cancelled', showed: false },
  'confirmed': { outcome: 'booked', showed: false },
  'booked': { outcome: 'booked', showed: false },
  'new': { outcome: 'booked', showed: false },
  'pending': { outcome: 'booked', showed: false },
  'rescheduled': { outcome: 'rescheduled', showed: false },
};

interface AppointmentResult {
  created: number;
  updated: number;
  skipped: number;
  statusChanges: number;
  errors: string[];
  appointments: any[];
}

// Fetch all appointments from a specific GHL calendar using the /calendars/events endpoint
async function fetchCalendarAppointments(
  apiKey: string,
  locationId: string,
  calendarId: string
): Promise<any[]> {
  const headers = {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'Version': '2021-07-28',
  };
  
  const appointments: any[] = [];
  
  try {
    // Use date range: last 365 days to future 30 days (UTC to avoid timezone drift)
    const startTime = new Date();
    startTime.setUTCDate(startTime.getUTCDate() - 365);
    const endTime = new Date();
    endTime.setUTCDate(endTime.getUTCDate() + 30);
    
    // Use the correct GHL API endpoint: /calendars/events
    const url = `${GHL_BASE_URL}/calendars/events?locationId=${locationId}&calendarId=${calendarId}&startTime=${startTime.getTime()}&endTime=${endTime.getTime()}`;
    
    console.log(`Fetching appointments from calendar ${calendarId} (${startTime.toISOString()} to ${endTime.toISOString()})`);
    const response = await fetchWithRetry(url, { method: 'GET', headers });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`GHL calendar events fetch error: ${response.status} - ${errorText}`);
      return [];
    }
    
    const data = await response.json();
    const events = data.events || [];
    console.log(`Fetched ${events.length} events from calendar ${calendarId}`);
    
    // Filter for appointments only (not blocked slots)
    for (const event of events) {
      if (event.appointmentStatus || event.status || event.contactId) {
        appointments.push({ ...event, calendarId });
      }
    }
    
    console.log(`Found ${appointments.length} appointments (filtered from ${events.length} events)`);
  } catch (err) {
    console.error(`Error fetching appointments for calendar ${calendarId}:`, err);
  }
  
  console.log(`Total appointments fetched from calendar ${calendarId}: ${appointments.length}`);
  return appointments;
}

// Fetch contact details from GHL
async function fetchGHLContact(apiKey: string, contactId: string): Promise<{ name: string | null; email: string | null; phone: string | null } | null> {
  try {
    const response = await fetchWithRetry(`${GHL_BASE_URL}/contacts/${contactId}`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Version': '2021-07-28',
      },
    });
    if (!response.ok) {
      await response.text();
      return null;
    }
    const data = await response.json();
    const c = data.contact || data;
    return {
      name: c.name || `${c.firstName || ''} ${c.lastName || ''}`.trim() || null,
      email: c.email || null,
      phone: c.phone || null,
    };
  } catch {
    return null;
  }
}

// Sync appointment to call record
// Fix 4: Uses configurable GHL_STATUS_MAP, logs unknown statuses
async function syncAppointmentToCall(
  supabase: any,
  clientId: string,
  appt: any,
  leadsByContactId: Map<string, { id: string; name: string | null; email: string | null; phone: string | null }>,
  isReconnect: boolean,
  apiKey: string
): Promise<{ action: 'created' | 'updated' | 'skipped'; statusChanged?: boolean }> {
  const appointmentId = appt.id;
  const calendarId = appt.calendarId;
  const contactId = appt.contactId;
  const rawStatus = (appt.status || appt.appointmentStatus || '').trim();
  const status = rawStatus.toLowerCase();
  
  // Fix 4: Use configurable status map with normalized lookup
  const mapped = GHL_STATUS_MAP[status];
  let outcome: string;
  let showed: boolean;
  
  if (mapped) {
    outcome = isReconnect && mapped.showed ? 'reconnect_showed' : 
              isReconnect && !mapped.showed && mapped.outcome === 'booked' ? 'reconnect_booked' :
              mapped.outcome;
    showed = mapped.showed;
  } else {
    // Unknown status — log warning and default to booked
    console.warn(`[sync-calendar] Unknown GHL status: "${rawStatus}" for appointment ${appointmentId}`);
    outcome = isReconnect ? 'reconnect_booked' : 'booked';
    showed = false;
    
    // Log to sync_warnings table
    try {
      await supabase.from('sync_warnings').insert({
        client_id: clientId,
        warning_type: 'unknown_appointment_status',
        message: `Unknown GHL appointment status: "${rawStatus}"`,
        metadata: { appointmentId, rawStatus, contactId },
      });
    } catch (e) {
      console.error('Failed to log sync warning:', e);
    }
  }
  
  // Find lead by contact ID
  const lead = contactId ? leadsByContactId.get(contactId) : null;
  const leadId = lead?.id || null;
  
  // Get contact details from lead data or appointment data (NO extra API call)
  let contactName = lead?.name || null;
  let contactEmail = lead?.email || null;
  let contactPhone = lead?.phone || null;
  
  // Try to get from appointment data
  if (appt.contact) {
    contactName = contactName || appt.contact.name || `${appt.contact.firstName || ''} ${appt.contact.lastName || ''}`.trim() || null;
    contactEmail = contactEmail || appt.contact.email || null;
    contactPhone = contactPhone || appt.contact.phone || null;
  }
  
  // Use title to extract name if still missing
  if (!contactName && appt.title) {
    const titleMatch = appt.title.match(/with\s+(.+?)\s+x\s+/i);
    if (titleMatch) contactName = titleMatch[1].trim();
  }
  
  // Use GHL dateAdded as the original creation date
  const ghlCreatedAt = appt.dateAdded || appt.createdAt || new Date().toISOString();
  
  const callData = {
    client_id: clientId,
    lead_id: leadId,
    external_id: appointmentId,
    ghl_appointment_id: appointmentId,
    ghl_calendar_id: calendarId,
    scheduled_at: appt.startTime || appt.dateAdded,
    appointment_status: status,
    showed,
    outcome,
    is_reconnect: isReconnect,
    booked_at: ghlCreatedAt,
    showed_at: showed ? (appt.startTime || new Date().toISOString()) : null,
    ghl_synced_at: new Date().toISOString(),
    contact_name: contactName,
    contact_email: contactEmail,
    contact_phone: contactPhone,
  };
  
  // Check if call already exists by appointment ID
  const { data: existingCall } = await supabase
    .from('calls')
    .select('id, created_at')
    .eq('client_id', clientId)
    .eq('ghl_appointment_id', appointmentId)
    .maybeSingle();
  
  if (existingCall) {
    // Fix 4: Track whether status actually changed for metrics recalculation
    const { data: prevCall } = await supabase
      .from('calls')
      .select('showed, outcome')
      .eq('id', existingCall.id)
      .single();
    
    const statusChanged = prevCall && (prevCall.showed !== callData.showed || prevCall.outcome !== callData.outcome);
    
    // Update existing call
    const { error: updateError } = await supabase
      .from('calls')
      .update({
        lead_id: callData.lead_id,
        scheduled_at: callData.scheduled_at,
        appointment_status: callData.appointment_status,
        showed: callData.showed,
        showed_at: callData.showed_at,
        outcome: callData.outcome,
        is_reconnect: callData.is_reconnect,
        booked_at: callData.booked_at,
        ghl_synced_at: callData.ghl_synced_at,
        contact_name: callData.contact_name || undefined,
        contact_email: callData.contact_email || undefined,
        contact_phone: callData.contact_phone || undefined,
      })
      .eq('id', existingCall.id);
    
    if (updateError) {
      console.error(`Failed to update call ${appointmentId}:`, updateError);
      return { action: 'skipped' };
    }
    
    if (statusChanged) {
      console.log(`[sync-calendar] Status changed for ${appointmentId}: ${prevCall?.outcome} → ${callData.outcome}`);
    }
    return { action: 'updated', statusChanged: !!statusChanged };
  }
  
  // Create new call
  const { error: insertError } = await supabase
    .from('calls')
    .insert({
      ...callData,
      created_at: ghlCreatedAt,
    });
  
  if (insertError) {
    console.error(`Failed to create call ${appointmentId}:`, insertError);
    return { action: 'skipped' };
  }
  
  return { action: 'created' };
}

// Recalculate daily_metrics for a client based on actual calls data
async function recalculateClientMetrics(supabase: any, clientId: string) {
  // Get all calls for this client - need booked_at, scheduled_at, created_at, outcome
  const { data: callStats } = await supabase
    .from('calls')
    .select('booked_at, scheduled_at, created_at, showed, is_reconnect, outcome')
    .eq('client_id', clientId);

  if (!callStats || callStats.length === 0) {
    console.log('No calls to recalculate');
    return;
  }

  // Aggregate booked calls by booked_at date, showed calls by scheduled_at date
  const metricsByDate = new Map<string, {
    calls: number;
    showed_calls: number;
    reconnect_calls: number;
    reconnect_showed: number;
  }>();

  const ensureDate = (dateStr: string) => {
    const date = dateStr.split('T')[0];
    if (!metricsByDate.has(date)) {
      metricsByDate.set(date, { calls: 0, showed_calls: 0, reconnect_calls: 0, reconnect_showed: 0 });
    }
    return metricsByDate.get(date)!;
  };

  for (const call of callStats) {
    // Skip cancelled calls from booked counts
    const outcome = (call.outcome || '').toLowerCase();
    if (outcome === 'cancelled' || outcome === 'canceled') continue;

    // Use booked_at, fall back to created_at for legacy calls
    const bookedDate = call.booked_at || call.created_at;
    if (bookedDate) {
      const metrics = ensureDate(bookedDate);
      if (call.is_reconnect) {
        metrics.reconnect_calls++;
      } else {
        metrics.calls++;
      }
    }

    // Count showed by scheduled_at date (fall back to booked_at then created_at)
    if (call.showed) {
      const showDate = call.scheduled_at || call.booked_at || call.created_at;
      if (showDate) {
        const metrics = ensureDate(showDate);
        if (call.is_reconnect) {
          metrics.reconnect_showed++;
        } else {
          metrics.showed_calls++;
        }
      }
    }
  }

  console.log(`Updating metrics for ${metricsByDate.size} dates`);

  // Update daily_metrics for each date
  for (const [date, metrics] of metricsByDate) {
    const { data: existing } = await supabase
      .from('daily_metrics')
      .select('id')
      .eq('client_id', clientId)
      .eq('date', date)
      .maybeSingle();

    if (existing) {
      await supabase
        .from('daily_metrics')
        .update({
          calls: metrics.calls,
          showed_calls: metrics.showed_calls,
          reconnect_calls: metrics.reconnect_calls,
          reconnect_showed: metrics.reconnect_showed,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id);
    } else {
      await supabase
        .from('daily_metrics')
        .insert({
          client_id: clientId,
          date,
          calls: metrics.calls,
          showed_calls: metrics.showed_calls,
          reconnect_calls: metrics.reconnect_calls,
          reconnect_showed: metrics.reconnect_showed,
        });
    }
  }

  console.log('Metrics recalculation complete');
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { clientId } = await req.json();

    if (!clientId) {
      return new Response(
        JSON.stringify({ error: 'clientId is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Fetch client and settings
    const { data: client, error: clientError } = await supabase
      .from('clients')
      .select('id, name, ghl_api_key, ghl_location_id')
      .eq('id', clientId)
      .single();

    if (clientError || !client) {
      return new Response(
        JSON.stringify({ error: 'Client not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!client.ghl_api_key || !client.ghl_location_id) {
      return new Response(
        JSON.stringify({ error: 'Client has no GHL credentials configured' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { data: settings } = await supabase
      .from('client_settings')
      .select('tracked_calendar_ids, reconnect_calendar_ids')
      .eq('client_id', clientId)
      .single();

    const trackedCalendarIds = settings?.tracked_calendar_ids || [];
    const reconnectCalendarIds = settings?.reconnect_calendar_ids || [];

    if (trackedCalendarIds.length === 0 && reconnectCalendarIds.length === 0) {
      return new Response(
        JSON.stringify({ 
          error: 'No calendars configured for tracking',
          tracked: trackedCalendarIds.length,
          reconnect: reconnectCalendarIds.length
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Starting calendar sync for ${client.name}: tracked=${trackedCalendarIds.length}, reconnect=${reconnectCalendarIds.length}`);

    // Build lead lookup map — paginated to handle >1000 leads
    const allLeads: any[] = [];
    let leadFrom = 0;
    const LEAD_PAGE = 1000;
    let hasMoreLeads = true;
    while (hasMoreLeads) {
      const { data: leadsPage } = await supabase
        .from('leads')
        .select('id, external_id, name, email, phone')
        .eq('client_id', clientId)
        .not('external_id', 'is', null)
        .range(leadFrom, leadFrom + LEAD_PAGE - 1);
      if (!leadsPage || leadsPage.length === 0) break;
      allLeads.push(...leadsPage);
      hasMoreLeads = leadsPage.length === LEAD_PAGE;
      leadFrom += LEAD_PAGE;
    }

    const leadsByContactId = new Map<string, { id: string; name: string | null; email: string | null; phone: string | null }>();
    for (const lead of allLeads) {
      if (lead.external_id) {
        leadsByContactId.set(lead.external_id, {
          id: lead.id,
          name: lead.name,
          email: lead.email,
          phone: lead.phone,
        });
      }
    }
    console.log(`Built lead lookup map with ${leadsByContactId.size} entries (paginated)`);

    const result: AppointmentResult = {
      created: 0,
      updated: 0,
      skipped: 0,
      statusChanges: 0,
      errors: [],
      appointments: [],
    };
    
    // Fix 4: Track dates with status changes for metrics recalculation
    const datesWithStatusChanges = new Set<string>();

    // Process tracked calendars (booked calls)
    for (const calendarId of trackedCalendarIds) {
      try {
        console.log(`Processing tracked calendar: ${calendarId}`);
        const appointments = await fetchCalendarAppointments(
          client.ghl_api_key,
          client.ghl_location_id,
          calendarId
        );

        for (const appt of appointments) {
          const syncResult = await syncAppointmentToCall(supabase, clientId, appt, leadsByContactId, false, client.ghl_api_key);
          if (syncResult.action === 'created') result.created++;
          else if (syncResult.action === 'updated') result.updated++;
          else result.skipped++;
          
          if (syncResult.statusChanged && appt.startTime) {
            result.statusChanges++;
            datesWithStatusChanges.add(appt.startTime.split('T')[0]);
          }
          
          result.appointments.push({
            id: appt.id,
            contactId: appt.contactId,
            startTime: appt.startTime,
            status: appt.status || appt.appointmentStatus,
            action: syncResult.action,
          });
        }
      } catch (err) {
        const errorMsg = `Calendar ${calendarId}: ${err instanceof Error ? err.message : 'Unknown error'}`;
        console.error(errorMsg);
        result.errors.push(errorMsg);
      }
    }

    // Process reconnect calendars
    for (const calendarId of reconnectCalendarIds) {
      try {
        console.log(`Processing reconnect calendar: ${calendarId}`);
        const appointments = await fetchCalendarAppointments(
          client.ghl_api_key,
          client.ghl_location_id,
          calendarId
        );

        for (const appt of appointments) {
          const syncResult = await syncAppointmentToCall(supabase, clientId, appt, leadsByContactId, true, client.ghl_api_key);
          if (syncResult.action === 'created') result.created++;
          else if (syncResult.action === 'updated') result.updated++;
          else result.skipped++;
          
          if (syncResult.statusChanged && appt.startTime) {
            result.statusChanges++;
            datesWithStatusChanges.add(appt.startTime.split('T')[0]);
          }
          
          result.appointments.push({
            id: appt.id,
            contactId: appt.contactId,
            startTime: appt.startTime,
            status: appt.status || appt.appointmentStatus,
            isReconnect: true,
            action: syncResult.action,
          });
        }
      } catch (err) {
        const errorMsg = `Reconnect calendar ${calendarId}: ${err instanceof Error ? err.message : 'Unknown error'}`;
        console.error(errorMsg);
        result.errors.push(errorMsg);
      }
    }

    // Update sync timestamp
    await supabase
      .from('client_settings')
      .update({ ghl_last_calls_sync: new Date().toISOString() })
      .eq('client_id', clientId);

    console.log(`Calendar sync complete for ${client.name}: created=${result.created}, updated=${result.updated}, skipped=${result.skipped}, statusChanges=${result.statusChanges}`);

    // Fix 4: Recalculate metrics for dates with status changes
    if (datesWithStatusChanges.size > 0) {
      console.log(`[sync-calendar] Recalculating metrics for ${datesWithStatusChanges.size} dates with status changes`);
      await recalculateClientMetrics(supabase, clientId);
    }

    // ============================================================
    // DEEP CONTACT SYNC: Trigger full contact + timeline sync
    // for all unique contacts from booked/showed appointments
    // ============================================================
    const uniqueContactIds = new Set<string>();
    for (const appt of result.appointments) {
      if (appt.contactId) {
        const status = (appt.status || '').toLowerCase();
        // Sync all contacts that have booked or showed appointments
        if (status === 'booked' || status === 'confirmed' || status === 'showed' || status === 'completed' || appt.action === 'created') {
          uniqueContactIds.add(appt.contactId);
        }
      }
    }

    if (uniqueContactIds.size > 0) {
      console.log(`Triggering deep sync for ${uniqueContactIds.size} unique contacts...`);
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
      
      // Cap deep syncs to prevent CPU timeout and rate limits
      const contactIds = Array.from(uniqueContactIds);
      const MAX_DEEP_SYNCS = 30; // Limit to prevent timeout
      const batchSize = 3; // Reduced concurrency to avoid rate limits
      const truncated = contactIds.length > MAX_DEEP_SYNCS;
      const syncList = contactIds.slice(0, MAX_DEEP_SYNCS);
      let syncedContacts = 0;
      
      if (truncated) {
        console.log(`Capping deep sync to ${MAX_DEEP_SYNCS} of ${contactIds.length} contacts to prevent timeout`);
      }
      
      for (let i = 0; i < syncList.length; i += batchSize) {
        const batch = syncList.slice(i, i + batchSize);
        const promises = batch.map(contactId => 
          fetch(`${supabaseUrl}/functions/v1/sync-ghl-contacts`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${serviceRoleKey}`,
            },
            body: JSON.stringify({
              mode: 'single',
              client_id: clientId,
              contactId: contactId,
            }),
          }).then(async (res) => {
            if (res.ok) {
              syncedContacts++;
            } else {
              const text = await res.text();
              console.error(`Deep sync failed for contact ${contactId}: ${res.status} - ${text.substring(0, 100)}`);
            }
          }).catch(err => {
            console.error(`Deep sync error for contact ${contactId}:`, err);
          })
        );
        await Promise.all(promises);
        // Add delay between batches to avoid rate limits
        if (i + batchSize < syncList.length) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
      
      console.log(`Deep contact sync complete: ${syncedContacts}/${syncList.length} contacts synced${truncated ? ` (${contactIds.length - MAX_DEEP_SYNCS} deferred)` : ''}`);
    }

    // Recalculate daily_metrics for this client
    console.log(`Recalculating daily_metrics for ${client.name}...`);
    await recalculateClientMetrics(supabase, clientId);

    return new Response(
      JSON.stringify({
        success: true,
        client: client.name,
        trackedCalendars: trackedCalendarIds,
        reconnectCalendars: reconnectCalendarIds,
        created: result.created,
        updated: result.updated,
        skipped: result.skipped,
        errors: result.errors,
        totalAppointments: result.appointments.length,
        sampleAppointments: result.appointments.slice(0, 10),
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('Calendar sync error:', err);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: err instanceof Error ? err.message : 'Unknown error' 
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
