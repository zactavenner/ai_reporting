export function formatDuration(seconds: number | null | undefined) {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m >= 60) return `${Math.floor(m / 60)}h ${m % 60}m`;
  return `${m}m ${String(rem).padStart(2, '0')}s`;
}

export function intentLabel(score: number | null | undefined) {
  const n = Number(score);
  if (!Number.isFinite(n)) return 'Unscored';
  if (n >= 80) return 'High Intent';
  if (n >= 50) return 'Medium Intent';
  return 'Low Intent';
}

export function sentimentTone(sentiment: string | null | undefined): 'default' | 'secondary' | 'destructive' | 'outline' {
  const s = (sentiment || '').toLowerCase();
  if (s.includes('positive')) return 'default';
  if (s.includes('negative')) return 'destructive';
  return 'secondary';
}

export const CALL_OUTCOMES = [
  'Qualified', 'Not Qualified', 'Interested', 'Follow-Up Required', 'Appointment Booked',
  'Reconnect Required', 'Committed', 'Funded', 'Not Interested', 'No Decision',
];

export const CALL_SENTIMENTS = ['Very Positive', 'Positive', 'Neutral', 'Negative', 'Very Negative'];
