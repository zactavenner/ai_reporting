import type { AgendaSegment } from './types';

interface SummaryInput {
  date: string;
  actual_duration_s: number | null;
  planned_duration_s: number;
  attendance: { member_name: string | null }[];
  wins: { member_name: string | null; text: string }[];
  flags: { client_name?: string | null; reason: string | null }[];
  new_tasks: { title: string; owner_name?: string | null; due_date?: string | null }[];
  blockers: { description: string; unblocker_name?: string | null }[];
  ratings: { rating: number }[];
  agenda: AgendaSegment[];
}

function fmt(s: number | null) {
  if (!s && s !== 0) return '—';
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}m ${sec.toString().padStart(2, '0')}s`;
}

export function buildSummary(input: SummaryInput): string {
  const avgRating = input.ratings.length
    ? (input.ratings.reduce((a, r) => a + r.rating, 0) / input.ratings.length).toFixed(1)
    : '—';
  const lines: string[] = [];
  lines.push(`Daily Huddle — ${input.date}`);
  lines.push(`Duration: ${fmt(input.actual_duration_s)} (planned ${fmt(input.planned_duration_s)})`);
  lines.push(`Attendance: ${input.attendance.length} — ${input.attendance.map(a => a.member_name).filter(Boolean).join(', ') || '—'}`);
  lines.push(`Avg rating: ${avgRating}/10`);
  lines.push('');
  lines.push('WINS');
  if (input.wins.length === 0) lines.push('  (none)');
  input.wins.forEach(w => lines.push(`  • ${w.member_name || 'Team'}: ${w.text}`));
  lines.push('');
  lines.push('FLAGGED CLIENTS');
  if (input.flags.length === 0) lines.push('  (none)');
  input.flags.forEach(f => lines.push(`  • ${f.client_name || 'Client'}${f.reason ? ` — ${f.reason}` : ''}`));
  lines.push('');
  lines.push('NEW COMMITMENTS');
  if (input.new_tasks.length === 0) lines.push('  (none)');
  input.new_tasks.forEach(t =>
    lines.push(`  • ${t.title}${t.owner_name ? ` (@${t.owner_name})` : ''}${t.due_date ? ` — due ${t.due_date}` : ''}`)
  );
  lines.push('');
  lines.push('BLOCKERS');
  if (input.blockers.length === 0) lines.push('  (none)');
  input.blockers.forEach(b => lines.push(`  • ${b.description}${b.unblocker_name ? ` → ${b.unblocker_name}` : ''}`));
  return lines.join('\n');
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}