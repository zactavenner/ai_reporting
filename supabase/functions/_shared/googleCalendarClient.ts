// Server-only Google Calendar access. Refresh tokens never leave this module.
import {
  buildAttendeePatch,
  buildTaggedEventSearch,
  buildTimeWindowSearch,
  assertOwnerPreserved,
  type GhlAppointmentLite,
  type GoogleEventLite,
} from './calendarGuest.ts';

const CAL_BASE = 'https://www.googleapis.com/calendar/v3';

export async function getAccessToken(supabase: any, connectionId: string): Promise<{ token: string; email: string }> {
  const { data: conn, error } = await supabase
    .from('google_calendar_connections')
    .select('id, organizer_email, refresh_token, access_token, access_token_expires_at, status')
    .eq('id', connectionId)
    .maybeSingle();
  if (error || !conn) throw new Error('calendar_connection_missing');
  if (conn.status !== 'active') throw new Error('calendar_connection_inactive');

  const expires = conn.access_token_expires_at ? Date.parse(conn.access_token_expires_at) : 0;
  if (conn.access_token && expires - Date.now() > 60_000) {
    return { token: conn.access_token, email: conn.organizer_email };
  }

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: Deno.env.get('GOOGLE_OAUTH_CLIENT_ID') || '',
      client_secret: Deno.env.get('GOOGLE_OAUTH_CLIENT_SECRET') || '',
      refresh_token: conn.refresh_token,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) {
    await supabase
      .from('google_calendar_connections')
      .update({ status: 'reauth_required', last_error: `refresh_failed_${res.status}`, last_error_at: new Date().toISOString() })
      .eq('id', connectionId);
    throw new Error('calendar_token_refresh_failed');
  }
  const tok = await res.json();
  await supabase
    .from('google_calendar_connections')
    .update({
      access_token: tok.access_token,
      access_token_expires_at: new Date(Date.now() + (tok.expires_in ?? 3500) * 1000).toISOString(),
      last_refreshed_at: new Date().toISOString(),
      last_error: null,
    })
    .eq('id', connectionId);
  return { token: tok.access_token, email: conn.organizer_email };
}

async function calFetch(token: string, path: string, init?: RequestInit & { query?: Record<string, string> }) {
  const url = new URL(`${CAL_BASE}${path}`);
  for (const [k, v] of Object.entries(init?.query || {})) url.searchParams.set(k, v);
  const res = await fetch(url.toString(), {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init?.headers || {}) },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`google_calendar_${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

export async function listEvents(
  token: string,
  calendarId: string,
  query: Record<string, string>,
): Promise<GoogleEventLite[]> {
  const data = await calFetch(token, `/calendars/${encodeURIComponent(calendarId)}/events`, { query });
  return (data?.items || []) as GoogleEventLite[];
}

export async function findEventCandidates(args: {
  token: string;
  calendarId: string;
  appointment: GhlAppointmentLite;
}) {
  const tagged = await listEvents(args.token, args.calendarId, buildTaggedEventSearch(args.appointment.appointmentId));
  const windowEvents = tagged.length
    ? []
    : await listEvents(args.token, args.calendarId, buildTimeWindowSearch(args.appointment));
  return { tagged, windowEvents };
}

/**
 * Reads a single organizer event. Required before patching: a PATCH must carry
 * the event's REAL attendee list, otherwise Google replaces attendees with
 * whatever we send and existing guests are removed.
 */
export async function getEvent(args: {
  token: string;
  calendarId: string;
  eventId: string;
}): Promise<GoogleEventLite | null> {
  try {
    return (await calFetch(
      args.token,
      `/calendars/${encodeURIComponent(args.calendarId)}/events/${encodeURIComponent(args.eventId)}`,
    )) as GoogleEventLite;
  } catch (e) {
    if (/google_calendar_40[34]/.test(String((e as Error).message))) return null;
    throw e;
  }
}

/** Adds the notetaker as a guest. Ownership fields are never sent. */
export async function patchAttendee(args: {
  token: string;
  calendarId: string;
  event: GoogleEventLite;
  botGuestEmail: string;
  appointmentId: string;
  clientId: string;
}): Promise<GoogleEventLite> {
  const patch = buildAttendeePatch({
    event: args.event,
    botGuestEmail: args.botGuestEmail,
    appointmentId: args.appointmentId,
    clientId: args.clientId,
  });
  assertOwnerPreserved(patch as unknown as Record<string, unknown>, args.botGuestEmail);
  return (await calFetch(
    args.token,
    `/calendars/${encodeURIComponent(args.calendarId)}/events/${encodeURIComponent(args.event.id)}`,
    // sendUpdates=all so the notetaker actually receives its guest invitation.
    { method: 'PATCH', body: JSON.stringify(patch), query: { sendUpdates: 'all', conferenceDataVersion: '1' } },
  )) as GoogleEventLite;
}

export async function verifyConnection(supabase: any, connectionId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const { token } = await getAccessToken(supabase, connectionId);
    await calFetch(token, '/users/me/calendarList', { query: { maxResults: '1' } });
    await supabase
      .from('google_calendar_connections')
      .update({ last_verified_at: new Date().toISOString(), last_error: null })
      .eq('id', connectionId);
    return { ok: true };
  } catch (e) {
    const message = String((e as Error).message || 'verify_failed').slice(0, 200);
    await supabase
      .from('google_calendar_connections')
      .update({ last_error: message, last_error_at: new Date().toISOString() })
      .eq('id', connectionId);
    return { ok: false, error: message };
  }
}