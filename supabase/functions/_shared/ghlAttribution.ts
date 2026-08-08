/**
 * Server-only GHL attribution helpers for the notetaker pipeline.
 *
 * Every recorded meeting must trace back to: client → contact/lead →
 * appointment/calendar/location → assigned sales agent. These read-only helpers
 * resolve the contact and assigned user for an appointment, plus the list of
 * active booking calendars in a location so ALL of them can be polled.
 *
 * Nothing here is ever returned to a browser unmasked; credentials stay server side.
 */
const GHL_BASE = 'https://services.leadconnectorhq.com';

export interface GhlCalendarLite {
  id: string;
  name: string;
  isActive: boolean;
}

export interface AppointmentAttribution {
  contactId: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  assignedUserId: string | null;
  assignedUserName: string | null;
  assignedUserEmail: string | null;
}

async function ghlGet(path: string, apiKey: string): Promise<any | null> {
  try {
    const res = await fetch(`${GHL_BASE}${path}`, {
      headers: { Authorization: `Bearer ${apiKey}`, Version: '2021-07-28', Accept: 'application/json' },
    });
    if (!res.ok) return null;
    return await res.json().catch(() => null);
  } catch {
    return null;
  }
}

/** All booking calendars in a location. Empty array when the call fails. */
export async function listLocationCalendars(apiKey: string, locationId: string): Promise<GhlCalendarLite[]> {
  const body = await ghlGet(`/calendars/?locationId=${encodeURIComponent(locationId)}`, apiKey);
  const raw: any[] = Array.isArray(body?.calendars) ? body.calendars : [];
  return raw
    .filter((c) => c?.id && (!c.locationId || String(c.locationId) === locationId))
    .map((c) => ({
      id: String(c.id),
      name: String(c.name || 'Untitled calendar'),
      isActive: c?.isActive !== false,
    }));
}

/** Per-run caches so a busy location resolves each user/contact only once. */
export interface AttributionCache {
  users: Map<string, { name: string | null; email: string | null }>;
  contacts: Map<string, { name: string | null; email: string | null; phone: string | null }>;
}

export function newAttributionCache(): AttributionCache {
  return { users: new Map(), contacts: new Map() };
}

async function resolveUser(apiKey: string, userId: string, cache: AttributionCache) {
  const hit = cache.users.get(userId);
  if (hit) return hit;
  const body = await ghlGet(`/users/${encodeURIComponent(userId)}`, apiKey);
  const u = body?.user || body || {};
  const name = [u?.firstName, u?.lastName].filter(Boolean).join(' ').trim() || u?.name || null;
  const value = { name: name ? String(name) : null, email: u?.email ? String(u.email) : null };
  cache.users.set(userId, value);
  return value;
}

async function resolveContact(apiKey: string, contactId: string, cache: AttributionCache) {
  const hit = cache.contacts.get(contactId);
  if (hit) return hit;
  const body = await ghlGet(`/contacts/${encodeURIComponent(contactId)}`, apiKey);
  const c = body?.contact || body || {};
  const name =
    [c?.firstName, c?.lastName].filter(Boolean).join(' ').trim() ||
    c?.name ||
    c?.contactName ||
    null;
  const value = {
    name: name ? String(name) : null,
    email: c?.email ? String(c.email) : null,
    phone: c?.phone ? String(c.phone) : null,
  };
  cache.contacts.set(contactId, value);
  return value;
}

/**
 * Resolves attribution for one appointment. The raw event object usually already
 * carries contactId/assignedUserId; anything missing is fetched by id.
 */
export async function resolveAppointmentAttribution(args: {
  apiKey: string;
  event: any;
  cache: AttributionCache;
}): Promise<AppointmentAttribution> {
  const { apiKey, event, cache } = args;
  const contactId = event?.contactId ? String(event.contactId) : null;
  const assignedUserId =
    (event?.assignedUserId && String(event.assignedUserId)) ||
    (event?.userId && String(event.userId)) ||
    (Array.isArray(event?.assignedResources) && event.assignedResources[0]
      ? String(event.assignedResources[0])
      : null);

  let contactName: string | null = event?.contactName ? String(event.contactName) : null;
  let contactEmail: string | null = event?.email ? String(event.email) : null;
  let contactPhone: string | null = event?.phone ? String(event.phone) : null;
  if (contactId && (!contactName || !contactEmail)) {
    const c = await resolveContact(apiKey, contactId, cache);
    contactName = contactName || c.name;
    contactEmail = contactEmail || c.email;
    contactPhone = contactPhone || c.phone;
  }

  let assignedUserName: string | null = null;
  let assignedUserEmail: string | null = null;
  if (assignedUserId) {
    const u = await resolveUser(apiKey, assignedUserId, cache);
    assignedUserName = u.name;
    assignedUserEmail = u.email;
  }

  return {
    contactId,
    contactName,
    contactEmail,
    contactPhone,
    assignedUserId,
    assignedUserName,
    assignedUserEmail,
  };
}

/** Short, stable client code used in the shadow-invite meeting title. */
export function clientShortcode(name: string | null | undefined): string {
  const words = String(name || 'CLIENT')
    .replace(/[^A-Za-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return 'CLIENT';
  const initials = words.slice(0, 3).map((w) => w[0].toUpperCase()).join('');
  return initials.length >= 2 ? initials : words[0].slice(0, 4).toUpperCase();
}

/** Structured shadow-event title that carries attribution into MeetGeek. */
export function buildAttributedSummary(args: {
  clientName: string | null;
  calendarName: string | null;
  contactName: string | null;
  fallbackTitle: string | null;
}): string {
  const parts = [`[${clientShortcode(args.clientName)}]`];
  if (args.calendarName) parts.push(args.calendarName);
  const who = args.contactName || args.fallbackTitle || 'Client call';
  return `${parts.join(' ')} — ${who}`;
}

/** GHL deep link back to the appointment for UI drill-through. */
export function ghlAppointmentUrl(locationId: string | null, appointmentId: string | null): string | null {
  if (!locationId || !appointmentId || appointmentId.startsWith('gcal:')) return null;
  return `https://app.gohighlevel.com/v2/location/${locationId}/calendars/view/appointment/${appointmentId}`;
}
