// Show / no-show attendance for booked appointments, read from the CRM.
//
// GHL owns the appointment outcome (`appointmentStatus`): confirmed, showed,
// noshow, cancelled, invalid. The notetaker pipeline already stores one job row
// per appointment, so attendance is synced onto those rows and every analytics
// surface (AI Meetings KPIs, "no join link" list, per-client rollups) reads a
// single normalized value instead of calling GHL again.
import { listLocationCalendars } from './ghlAttribution.ts';

const GHL_BASE = 'https://services.leadconnectorhq.com';

export type Attendance = 'showed' | 'noshow' | 'cancelled' | 'confirmed' | 'booked' | 'unknown';

/** Normalize the CRM's free-form appointment status into an attendance result. */
export function normalizeAttendance(raw: string | null | undefined): Attendance {
  const s = String(raw || '').trim().toLowerCase().replace(/[\s-]/g, '_');
  if (!s) return 'unknown';
  if (/cancel/.test(s)) return 'cancelled';
  if (/(noshow|no_show|didn_?t_show)/.test(s)) return 'noshow';
  if (/show/.test(s)) return 'showed';
  if (/confirm/.test(s)) return 'confirmed';
  if (/(new|booked|pending|unconfirmed|invalid)/.test(s)) return 'booked';
  return 'unknown';
}

export interface AttendanceRollup {
  showed: number;
  noshow: number;
  cancelled: number;
  awaiting: number;
  total: number;
  /** showed / (showed + noshow) as a percentage, null when nothing is decided. */
  show_rate: number | null;
}

export function rollupAttendance(rows: { attendance_status?: string | null }[]): AttendanceRollup {
  const r: AttendanceRollup = { showed: 0, noshow: 0, cancelled: 0, awaiting: 0, total: 0, show_rate: null };
  for (const row of rows) {
    r.total += 1;
    switch (normalizeAttendance(row.attendance_status)) {
      case 'showed': r.showed += 1; break;
      case 'noshow': r.noshow += 1; break;
      case 'cancelled': r.cancelled += 1; break;
      default: r.awaiting += 1;
    }
  }
  const decided = r.showed + r.noshow;
  r.show_rate = decided ? Math.round((r.showed / decided) * 1000) / 10 : null;
  return r;
}

async function fetchEventsInWindow(args: {
  apiKey: string;
  locationId: string;
  calendarId: string;
  startMs: number;
  endMs: number;
}): Promise<any[]> {
  const url =
    `${GHL_BASE}/calendars/events?locationId=${encodeURIComponent(args.locationId)}` +
    `&calendarId=${encodeURIComponent(args.calendarId)}&startTime=${args.startMs}&endTime=${args.endMs}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${args.apiKey}`, Version: '2021-07-28', Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`ghl_events_${res.status}: ${(await res.text()).slice(0, 160)}`);
  const data = await res.json().catch(() => null);
  const events: any[] = data?.events || data?.appointments || [];
  return events.filter((e) => e?.id);
}

export interface AttendanceSyncClientResult {
  client_id: string;
  client_name: string;
  calendars: number;
  events: number;
  jobs_updated: number;
  errors: string[];
}

/**
 * Pull the CRM appointment outcome for a date window and write it onto the
 * matching invite jobs. Safe to re-run: it only writes status fields.
 */
export async function syncGhlAttendance(args: {
  supabase: any;
  clientId?: string | null;
  startIso: string;
  endIso: string;
}): Promise<{ window: { from: string; to: string }; clients: AttendanceSyncClientResult[]; totals: { events: number; jobs_updated: number } }> {
  const { supabase } = args;
  const startMs = new Date(args.startIso).getTime();
  const endMs = new Date(args.endIso).getTime();

  let clientQ = supabase.from('clients').select('id, name, status, ghl_api_key, ghl_location_id');
  if (args.clientId) clientQ = clientQ.eq('id', args.clientId);
  const { data: clients } = await clientQ;

  const out: AttendanceSyncClientResult[] = [];
  let totalEvents = 0;
  let totalUpdated = 0;

  for (const client of clients || []) {
    if (!client.ghl_api_key || !client.ghl_location_id) continue;
    const result: AttendanceSyncClientResult = {
      client_id: client.id,
      client_name: client.name,
      calendars: 0,
      events: 0,
      jobs_updated: 0,
      errors: [],
    };

    let calendars: { id: string; name: string; isActive?: boolean }[] = [];
    try {
      calendars = (await listLocationCalendars(client.ghl_api_key, client.ghl_location_id)).filter((c: any) => c.isActive !== false);
    } catch (e) {
      result.errors.push(String((e as Error).message).slice(0, 160));
    }
    result.calendars = calendars.length;

    const statusByAppointment = new Map<string, string>();
    // Calendars are fetched with bounded concurrency: locations can carry 20+
    // booking calendars and serial fetches blow the edge-function timeout.
    const CONCURRENCY = 6;
    for (let i = 0; i < calendars.length; i += CONCURRENCY) {
      const batch = calendars.slice(i, i + CONCURRENCY);
      const settled = await Promise.all(
        batch.map(async (cal) => {
          try {
            const events = await fetchEventsInWindow({
              apiKey: client.ghl_api_key,
              locationId: client.ghl_location_id,
              calendarId: cal.id,
              startMs,
              endMs,
            });
            return { events, error: null as string | null };
          } catch (e) {
            return { events: [] as any[], error: `${cal.name}: ${String((e as Error).message).slice(0, 120)}` };
          }
        }),
      );
      for (const s of settled) {
        if (s.error) result.errors.push(s.error);
        result.events += s.events.length;
        for (const e of s.events) {
          statusByAppointment.set(String(e.id), String(e.appointmentStatus || e.status || ''));
        }
      }
    }

    // One write per distinct raw status instead of one per appointment.
    const nowIso = new Date().toISOString();
    const idsByStatus = new Map<string, string[]>();
    for (const [appointmentId, rawStatus] of statusByAppointment) {
      const key = rawStatus || '';
      const list = idsByStatus.get(key) || [];
      list.push(appointmentId);
      idsByStatus.set(key, list);
    }
    for (const [rawStatus, ids] of idsByStatus) {
      for (let i = 0; i < ids.length; i += 200) {
        const { data: updated } = await supabase
          .from('meetgeek_guest_invite_jobs')
          .update({
            ghl_appointment_status: rawStatus || null,
            attendance_status: normalizeAttendance(rawStatus),
            attendance_checked_at: nowIso,
          })
          .eq('client_id', client.id)
          .in('ghl_appointment_id', ids.slice(i, i + 200))
          .select('id');
        result.jobs_updated += (updated || []).length;
      }
    }

    totalEvents += result.events;
    totalUpdated += result.jobs_updated;
    out.push(result);
  }

  return {
    window: { from: args.startIso, to: args.endIso },
    clients: out,
    totals: { events: totalEvents, jobs_updated: totalUpdated },
  };
}
