import type { AiCallRecord } from '@/hooks/useAiCallerCalls';

export const CALL_STATUSES = [
  'scheduled', 'calling', 'answered', 'no_answer', 'busy', 'voicemail', 'failed', 'completed',
] as const;

export const CALL_OUTCOMES = [
  'Appointment Booked', 'Interested — Follow Up', 'Qualified — Not Booked', 'Not Interested',
  'Call Back Requested', 'Wrong Number', 'Do Not Contact', 'Voicemail', 'No Answer', 'Disqualified',
] as const;

export const APPOINTMENT_STATUSES = [
  'Booked', 'Confirmed', 'Showed', 'No Show', 'Canceled', 'Rescheduled',
] as const;

export function statusLabel(status: string | null | undefined) {
  if (!status) return '—';
  return status
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export function statusTone(
  status: string | null | undefined,
): 'default' | 'secondary' | 'destructive' | 'outline' {
  const s = (status || '').toLowerCase();
  if (['answered', 'completed'].includes(s)) return 'default';
  if (['failed', 'busy'].includes(s)) return 'destructive';
  if (['no_answer', 'voicemail'].includes(s)) return 'secondary';
  return 'outline';
}

export function appointmentTone(
  status: string | null | undefined,
): 'default' | 'secondary' | 'destructive' | 'outline' {
  const s = (status || '').toLowerCase();
  if (s === 'showed' || s === 'confirmed') return 'default';
  if (s === 'no show' || s === 'canceled') return 'destructive';
  if (s === 'rescheduled') return 'secondary';
  return 'outline';
}

export function formatDuration(seconds: number | null | undefined) {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rem = s % 60;
  if (h) return `${h}h ${String(m).padStart(2, '0')}m`;
  return `${m}m ${String(rem).padStart(2, '0')}s`;
}

export function pct(numerator: number, denominator: number) {
  if (!denominator) return '0.0%';
  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

export function intentLabel(score: number | null | undefined) {
  const n = Number(score);
  if (!Number.isFinite(n)) return 'Unscored';
  if (n >= 80) return 'High Intent';
  if (n >= 50) return 'Medium Intent';
  return 'Low Intent';
}

export function intentTone(
  score: number | null | undefined,
): 'default' | 'secondary' | 'destructive' | 'outline' {
  const n = Number(score);
  if (!Number.isFinite(n)) return 'outline';
  if (n >= 80) return 'default';
  if (n >= 50) return 'secondary';
  return 'destructive';
}

export function isAnswered(call: AiCallRecord) {
  if (call.answered !== null && call.answered !== undefined) return !!call.answered;
  if (call.connected) return true;
  return ['answered', 'completed'].includes((call.call_status || '').toLowerCase());
}

export function isQualified(call: AiCallRecord) {
  if (call.qualified !== null && call.qualified !== undefined) return !!call.qualified;
  return call.outcome === 'Appointment Booked' || call.outcome === 'Qualified — Not Booked';
}

export function isBooked(call: AiCallRecord) {
  return !!call.appointment_booked || call.outcome === 'Appointment Booked';
}

/** Speaker-separated transcript segments (AI Caller vs Prospect). */
export function transcriptSegments(call: AiCallRecord) {
  if (call.speaker_segments?.length) {
    return call.speaker_segments.map((s) => ({
      speaker: /(ai|agent|assistant|bot|caller|rep|user)/i.test(s.speaker) ? 'AI Caller' : 'Prospect',
      text: s.text,
    }));
  }
  return (call.transcript || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line, i) => {
      const m = line.match(/^([A-Za-z .]{1,30})\s*:\s*(.+)$/);
      if (m) {
        return {
          speaker: /(ai|agent|assistant|bot|caller|rep|user)/i.test(m[1]) ? 'AI Caller' : 'Prospect',
          text: m[2],
        };
      }
      return { speaker: i % 2 === 0 ? 'AI Caller' : 'Prospect', text: line };
    });
}

export interface AiCallerKpis {
  total: number;
  answered: number;
  pickupRate: number;
  qualified: number;
  booked: number;
  bookingRateAnswered: number;
  bookingRateTotal: number;
  noAnswer: number;
  busy: number;
  failed: number;
  voicemail: number;
  showed: number;
  talkTime: number;
  avgDuration: number;
  followUps: number;
}

export function computeKpis(calls: AiCallRecord[]): AiCallerKpis {
  const answeredCalls = calls.filter(isAnswered);
  const booked = calls.filter(isBooked);
  const talkTime = answeredCalls.reduce((sum, c) => sum + (c.duration_seconds || 0), 0);
  const statusCount = (s: string) =>
    calls.filter((c) => (c.call_status || '').toLowerCase() === s).length;

  return {
    total: calls.length,
    answered: answeredCalls.length,
    pickupRate: calls.length ? answeredCalls.length / calls.length : 0,
    qualified: calls.filter(isQualified).length,
    booked: booked.length,
    bookingRateAnswered: answeredCalls.length ? booked.length / answeredCalls.length : 0,
    bookingRateTotal: calls.length ? booked.length / calls.length : 0,
    noAnswer: statusCount('no_answer'),
    busy: statusCount('busy'),
    failed: statusCount('failed'),
    voicemail: statusCount('voicemail'),
    showed: booked.filter((c) => (c.appointment_status || '').toLowerCase() === 'showed').length,
    talkTime,
    avgDuration: answeredCalls.length ? Math.round(talkTime / answeredCalls.length) : 0,
    followUps: calls.filter((c) => c.follow_up_required).length,
  };
}

export function dateRangeForPreset(preset: string): { start: string; end: string } | null {
  const now = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  switch (preset) {
    case 'today':
      return { start: iso(today), end: iso(today) };
    case 'yesterday': {
      const y = new Date(today);
      y.setUTCDate(y.getUTCDate() - 1);
      return { start: iso(y), end: iso(y) };
    }
    case '7d': {
      const s = new Date(today);
      s.setUTCDate(s.getUTCDate() - 6);
      return { start: iso(s), end: iso(today) };
    }
    case '30d': {
      const s = new Date(today);
      s.setUTCDate(s.getUTCDate() - 29);
      return { start: iso(s), end: iso(today) };
    }
    case 'month': {
      const s = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
      return { start: iso(s), end: iso(today) };
    }
    default:
      return null;
  }
}
