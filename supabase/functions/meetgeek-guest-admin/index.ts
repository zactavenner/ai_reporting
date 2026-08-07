// Operator-gated admin bridge for the guest-only calendar orchestration.
// Returns ONLY redacted connection metadata — never tokens.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { authorizeOperator } from '../_shared/operatorAuth.ts';
import { normalizeEmail, redactConnection } from '../_shared/calendarGuest.ts';
import { verifyConnection } from '../_shared/googleCalendarClient.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const auth = await authorizeOperator(req, supabase, createClient);
  if (!auth.ok) return json({ error: auth.error, code: auth.code }, auth.status);

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return json({ error: 'JSON body required' }, 400);
  }
  const action = String(body?.action || '');
  const clientId = body?.client_id ? String(body.client_id) : null;

  try {
    switch (action) {
      case 'gc_list_connections': {
        const { data } = await supabase
          .from('google_calendar_connections')
          .select('id, organizer_email, display_name, status, scope, refresh_token, access_token_expires_at, last_verified_at, last_error, created_at')
          .order('created_at', { ascending: false });
        return json({ connections: (data || []).map(redactConnection) });
      }

      case 'gc_verify_connection': {
        const id = String(body?.connection_id || '');
        if (!id) return json({ error: 'connection_id required' }, 400);
        const result = await verifyConnection(supabase, id);
        return json(result);
      }

      case 'gc_disconnect': {
        const id = String(body?.connection_id || '');
        if (!id) return json({ error: 'connection_id required' }, 400);
        // Disabling every dependent client config is part of disconnecting.
        await supabase
          .from('client_meetgeek_guest_configs')
          .update({ enabled: false, validation_status: 'connection_removed' })
          .eq('calendar_connection_id', id);
        await supabase.from('google_calendar_connections').delete().eq('id', id);
        return json({ success: true });
      }

      case 'gc_get_guest_config': {
        if (!clientId) return json({ error: 'client_id required' }, 400);
        const { data: config } = await supabase
          .from('client_meetgeek_guest_configs')
          .select('*')
          .eq('client_id', clientId)
          .maybeSingle();
        const { data: mapping } = await supabase
          .from('client_settings')
          .select('ghl_location_id')
          .eq('client_id', clientId)
          .maybeSingle();
        const { data: jobs } = await supabase
          .from('meetgeek_guest_invite_jobs')
          .select('id, ghl_appointment_id, google_event_id, status, attempts, rejection_reason, error_message, scheduled_start, created_at, completed_at')
          .eq('client_id', clientId)
          .order('created_at', { ascending: false })
          .limit(20);
        return json({
          config: config
            ? {
                id: config.id,
                client_id: config.client_id,
                ghl_location_id: config.ghl_location_id,
                ghl_calendar_id: config.ghl_calendar_id,
                calendar_connection_id: config.calendar_connection_id,
                organizer_calendar_id: config.organizer_calendar_id,
                bot_guest_email: config.bot_guest_email,
                enabled: config.enabled,
                validation_status: config.validation_status,
                validation_error: config.validation_error,
                last_validated_at: config.last_validated_at,
                last_invite_at: config.last_invite_at,
                last_error: config.last_error,
              }
            : null,
          location_mapped: !!mapping?.ghl_location_id,
          webhook_secret_configured: !!Deno.env.get('GHL_APPOINTMENT_WEBHOOK_SECRET'),
          jobs: jobs || [],
        });
      }

      case 'gc_save_guest_config': {
        if (!clientId) return json({ error: 'client_id required' }, 400);
        const { data: mapping } = await supabase
          .from('client_settings')
          .select('ghl_location_id')
          .eq('client_id', clientId)
          .maybeSingle();
        const locationId = mapping?.ghl_location_id || null;

        const connectionId = body?.calendar_connection_id ? String(body.calendar_connection_id) : null;
        const botEmail = normalizeEmail(body?.bot_guest_email);
        const ghlCalendarId = body?.ghl_calendar_id ? String(body.ghl_calendar_id) : null;
        const organizerCalendarId = body?.organizer_calendar_id ? String(body.organizer_calendar_id) : 'primary';
        const wantEnabled = !!body?.enabled;

        let connectionOk = false;
        if (connectionId) {
          const result = await verifyConnection(supabase, connectionId);
          connectionOk = result.ok;
        }

        // Fail-closed: enabling requires a full, verified mapping.
        const blockers: string[] = [];
        if (!locationId) blockers.push('no CRM location mapped');
        if (!ghlCalendarId) blockers.push('no CRM calendar selected');
        if (!connectionId) blockers.push('no organizer calendar connection');
        else if (!connectionOk) blockers.push('organizer calendar connection failed verification');
        if (!botEmail) blockers.push('no notetaker guest email');
        if (!Deno.env.get('GHL_APPOINTMENT_WEBHOOK_SECRET')) blockers.push('webhook signing secret not configured');

        const enabled = wantEnabled && blockers.length === 0;
        const { error } = await supabase.from('client_meetgeek_guest_configs').upsert(
          {
            client_id: clientId,
            ghl_location_id: locationId,
            ghl_calendar_id: ghlCalendarId,
            calendar_connection_id: connectionId,
            organizer_calendar_id: organizerCalendarId,
            bot_guest_email: botEmail,
            enabled,
            validation_status: blockers.length === 0 ? 'validated' : 'blocked',
            validation_error: blockers.length ? blockers.join('; ') : null,
            last_validated_at: new Date().toISOString(),
          },
          { onConflict: 'client_id' },
        );
        if (error) return json({ error: error.message }, 500);
        return json({
          success: true,
          enabled,
          blockers,
          note: wantEnabled && !enabled ? 'Saved but kept disabled until every blocker is cleared.' : undefined,
        });
      }

      default:
        return json({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (e) {
    console.error('meetgeek-guest-admin failure', String((e as Error).message).slice(0, 200));
    return json({ error: 'Request failed' }, 500);
  }
});