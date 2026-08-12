// TwiML for both legs of the appointment call bridge.
// user leg   -> short hold message, then join the conference
// contact leg-> join the same conference (bridging the two parties)
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { corsHeaders, escapeXml, serviceClient, xml, logEvent } from '../_shared/callBridge.ts';

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const url = new URL(req.url);
  const bridgeId = url.searchParams.get('bridge') || '';
  const leg = url.searchParams.get('leg') || 'user';

  const sb = serviceClient();
  const { data: bridge } = await sb
    .from('appointment_call_bridges')
    .select('*')
    .eq('id', bridgeId)
    .maybeSingle();

  if (!bridge) {
    return xml('<?xml version="1.0" encoding="UTF-8"?><Response><Say>This appointment call is no longer available.</Say><Hangup/></Response>');
  }

  const conference = bridge.conference_name || `appt-${bridge.id}`;
  const contactName = bridge.contact_name || 'your contact';

  const conferenceXml = `<Dial timeLimit="3600"><Conference startConferenceOnEnter="true" endConferenceOnExit="true" beep="false" waitUrl="">${escapeXml(conference)}</Conference></Dial>`;

  if (leg === 'user') {
    await logEvent(sb, bridge.id, 'user_greeting_played', { leg: 'user', callSid: bridge.user_call_sid });
    return xml(
      `<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="Polly.Joanna">You have a scheduled appointment with ${escapeXml(
        contactName,
      )}. Please hold while we connect your call.</Say>${conferenceXml}</Response>`,
    );
  }

  return xml(`<?xml version="1.0" encoding="UTF-8"?><Response>${conferenceXml}</Response>`);
});