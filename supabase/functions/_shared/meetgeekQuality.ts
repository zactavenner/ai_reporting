// Deterministic meeting-quality rubric (1–10) for MeetGeek call activity.
// Pure logic only, so the webhook and the UI can never disagree on a rating.

import type { NormalizedMeeting } from './meetgeekIngest.ts';

export interface QualityRubricItem {
  label: string;
  points: number;
  max: number;
}

export interface MeetingQuality {
  rating: number;
  rubric: QualityRubricItem[];
  summary: string;
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/**
 * Scores a completed meeting on evidence we actually hold:
 * real talk time, a usable summary, action items, artifacts and lead match.
 */
export function scoreMeetingQuality(input: {
  meeting: NormalizedMeeting;
  matched: boolean;
  attendeeCount?: number;
}): MeetingQuality {
  const { meeting, matched } = input;
  const rubric: QualityRubricItem[] = [];

  const minutes = meeting.durationMinutes ?? 0;
  let durationPoints = 0;
  if (minutes >= 20) durationPoints = 3;
  else if (minutes >= 10) durationPoints = 2;
  else if (minutes >= 4) durationPoints = 1;
  rubric.push({ label: `Talk time (${minutes} min)`, points: durationPoints, max: 3 });

  const summaryLength = (meeting.summary || '').trim().length;
  let summaryPoints = 0;
  if (summaryLength >= 600) summaryPoints = 2;
  else if (summaryLength >= 150) summaryPoints = 1.5;
  else if (summaryLength > 0) summaryPoints = 0.5;
  rubric.push({ label: 'AI summary depth', points: summaryPoints, max: 2 });

  const items = meeting.actionItems?.length ?? 0;
  const actionPoints = items >= 3 ? 2 : items >= 1 ? 1 : 0;
  rubric.push({ label: `Action items (${items})`, points: actionPoints, max: 2 });

  const artifacts =
    (meeting.recordingUrl ? 1 : 0) + (meeting.transcriptUrl || meeting.sourceUrl ? 0.5 : 0);
  rubric.push({ label: 'Recording + transcript', points: artifacts, max: 1.5 });

  const attendees = input.attendeeCount ?? meeting.participants.length;
  const attendeePoints = attendees >= 2 ? 0.5 : 0;
  rubric.push({ label: `Attendees present (${attendees})`, points: attendeePoints, max: 0.5 });

  rubric.push({ label: 'Matched to a CRM lead', points: matched ? 1 : 0, max: 1 });

  const raw = rubric.reduce((sum, r) => sum + r.points, 0);
  const rating = clamp(Math.round(1 + raw), 1, 10);

  const gaps = rubric.filter((r) => r.points < r.max).map((r) => r.label);
  const summary = gaps.length
    ? `Rated ${rating}/10. Weakest signals: ${gaps.slice(0, 3).join(', ')}.`
    : `Rated ${rating}/10. Full meeting evidence captured.`;

  return { rating, rubric, summary };
}

export function qualityTone(rating: number): string {
  if (rating >= 8) return 'text-emerald-600 border-emerald-500/30';
  if (rating >= 6) return 'text-primary border-primary/30';
  if (rating >= 4) return 'text-amber-600 border-amber-500/30';
  return 'text-destructive border-destructive/30';
}
