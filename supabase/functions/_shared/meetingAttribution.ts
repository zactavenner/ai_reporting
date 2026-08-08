/**
 * Deterministic attribution of a recorded MeetGeek meeting back to the
 * notetaker invite job that created it.
 *
 * Match order (first hit wins, most deterministic first):
 *   1. The invite UID embedded in the meeting title/description.
 *   2. The structured "[SHORTCODE] Calendar — Contact" title exactly matching a
 *      job's stored invite_summary within the scheduling window.
 *   3. Time-window overlap (±30 min) plus the same meeting URL.
 *   4. Time-window overlap alone, only when exactly one job matches.
 *
 * Ambiguity never guesses: 0 or 2+ candidates leaves the meeting unattributed.
 */
const WINDOW_MS = 30 * 60 * 1000;

export interface AttributionOutcome {
  ok: boolean;
  method: string | null;
  job_id?: string;
  reason?: string;
}

function normalizeUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = String(url).match(/https?:\/\/[^\s<>"']+/);
  if (!m) return null;
  return m[0].replace(/[.,;)]+$/, '').toLowerCase();
}

function normalizeTitle(title: string | null | undefined): string {
  return String(title || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

export async function attributeMeetingRecord(supabase: any, meetingRecordId: string): Promise<AttributionOutcome> {
  const { data: meeting } = await supabase
    .from('meeting_records')
    .select('id, client_id, title, summary, started_at, ended_at, source_url, recording_url, guest_invite_job_id')
    .eq('id', meetingRecordId)
    .maybeSingle();
  if (!meeting) return { ok: false, method: null, reason: 'meeting_not_found' };
  if (meeting.guest_invite_job_id) return { ok: true, method: 'already_attributed', job_id: meeting.guest_invite_job_id };

  const haystack = `${meeting.title || ''} ${meeting.summary || ''}`;
  const uidMatch = haystack.match(
    /hpa-mg-[0-9a-f-]{36}-[A-Za-z0-9._-]+@reporting\.highperformanceads\.com/i,
  );

  const select =
    'id, client_id, ghl_appointment_id, ghl_calendar_id, ghl_calendar_name, ghl_location_id, ghl_contact_id, ' +
    'contact_name, contact_email, assigned_user_id, assigned_user_name, invite_summary, invite_uid, ' +
    'scheduled_start, scheduled_end, meeting_url';

  let job: any = null;
  let method: string | null = null;

  if (uidMatch) {
    const { data } = await supabase.from('meetgeek_guest_invite_jobs').select(select).eq('invite_uid', uidMatch[0]).maybeSingle();
    if (data) {
      job = data;
      method = 'invite_uid';
    }
  }

  const startMs = meeting.started_at ? Date.parse(meeting.started_at) : NaN;
  let candidates: any[] = [];
  if (!job && Number.isFinite(startMs)) {
    let q = supabase
      .from('meetgeek_guest_invite_jobs')
      .select(select)
      .gte('scheduled_start', new Date(startMs - WINDOW_MS).toISOString())
      .lte('scheduled_start', new Date(startMs + WINDOW_MS).toISOString())
      .limit(25);
    if (meeting.client_id) q = q.eq('client_id', meeting.client_id);
    const { data } = await q;
    candidates = data || [];

    const title = normalizeTitle(meeting.title);
    const byTitle = candidates.filter((c) => title && normalizeTitle(c.invite_summary) === title);
    if (byTitle.length === 1) {
      job = byTitle[0];
      method = 'structured_title';
    }

    if (!job) {
      const url = normalizeUrl(meeting.source_url) || normalizeUrl(meeting.recording_url);
      const byUrl = url ? candidates.filter((c) => normalizeUrl(c.meeting_url) === url) : [];
      if (byUrl.length === 1) {
        job = byUrl[0];
        method = 'window_and_url';
      }
    }

    if (!job && candidates.length === 1) {
      job = candidates[0];
      method = 'window_only';
    }
  }

  if (!job) {
    return { ok: false, method: null, reason: candidates.length > 1 ? 'ambiguous_candidates' : 'no_candidate' };
  }

  await supabase
    .from('meeting_records')
    .update({
      guest_invite_job_id: job.id,
      client_id: meeting.client_id || job.client_id,
      ghl_appointment_id: job.ghl_appointment_id,
      ghl_calendar_id: job.ghl_calendar_id,
      ghl_calendar_name: job.ghl_calendar_name,
      ghl_location_id: job.ghl_location_id,
      ghl_contact_id: job.ghl_contact_id,
      contact_name: job.contact_name,
      contact_email: job.contact_email,
      sales_agent_id: job.assigned_user_id,
      sales_agent_name: job.assigned_user_name,
      attribution_method: method,
      attributed_at: new Date().toISOString(),
    })
    .eq('id', meeting.id);

  // Reschedules/cancels update this SAME job row, so the link stays 1:1.
  await supabase
    .from('meetgeek_guest_invite_jobs')
    .update({ meeting_record_id: meeting.id, matched_at: new Date().toISOString(), match_method: method })
    .eq('id', job.id);

  return { ok: true, method, job_id: job.id };
}

/** Backfill/sweep: attribute recent meetings that have no job link yet. */
export async function attributeRecentMeetings(supabase: any, limit = 100): Promise<{ scanned: number; attributed: number }> {
  const { data } = await supabase
    .from('meeting_records')
    .select('id')
    .is('guest_invite_job_id', null)
    .order('started_at', { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 500));
  let attributed = 0;
  for (const row of data || []) {
    const res = await attributeMeetingRecord(supabase, row.id);
    if (res.ok && res.method !== 'already_attributed') attributed += 1;
  }
  return { scanned: (data || []).length, attributed };
}
