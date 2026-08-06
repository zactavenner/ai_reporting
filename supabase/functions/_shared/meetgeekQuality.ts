// Deterministic meeting-quality score derived ONLY from MeetGeek's own
// `insights` KPI values (`GET /v1/meetings/{id}/insights`).
//
// Hard rules enforced here (operational review):
//  * Nothing about duration, summary length, recording presence, transcript
//    presence or CRM/lead matching may influence the score.
//  * Each KPI arrives on MeetGeek's 0–5 scale. Per-metric score = (value / 5) * 10.
//  * The composite is the weighted mean of the AVAILABLE metrics only.
//  * A real 0 stays 0 — it is never floored to 1.
//  * If the weight of missing metrics exceeds 30% we refuse to score: rating,
//    rubric and summary are null / 'insufficient source data'.

export type MeetgeekKpiKey =
  | 'engagement'
  | 'productivity'
  | 'agenda_follow_through'
  | 'clear_project_scope'
  | 'risk_awareness'
  | 'task_ownership'
  | 'milestones_identified'
  | 'speaker_distribution';

/** Weights sum to 1.00. */
export const MEETGEEK_KPI_WEIGHTS: Record<MeetgeekKpiKey, number> = {
  engagement: 0.20,
  productivity: 0.15,
  agenda_follow_through: 0.15,
  clear_project_scope: 0.10,
  risk_awareness: 0.05,
  task_ownership: 0.20,
  milestones_identified: 0.10,
  speaker_distribution: 0.05,
};

export const MEETGEEK_KPI_LABELS: Record<MeetgeekKpiKey, string> = {
  engagement: 'Engagement',
  productivity: 'Productivity',
  agenda_follow_through: 'Agenda follow-through',
  clear_project_scope: 'Clear project scope',
  risk_awareness: 'Risk awareness',
  task_ownership: 'Task ownership',
  milestones_identified: 'Milestones identified',
  speaker_distribution: 'Speaker distribution',
};

/**
 * Documented contextual limitation: MeetGeek's speaker-distribution KPI rewards
 * an even split, which is not always the desirable shape of a call (a demo,
 * a pitch, or a one-way status readout can be excellent while lopsided).
 * It therefore carries only 5% of the composite and must never be read as a
 * standalone verdict on call quality.
 */
export const MEETGEEK_KPI_NOTES: Partial<Record<MeetgeekKpiKey, string>> = {
  speaker_distribution:
    'Contextual only — weighted 5%: an even talk split is not always better (demos, pitches, readouts).',
};

export const MEETGEEK_KPI_KEYS = Object.keys(MEETGEEK_KPI_WEIGHTS) as MeetgeekKpiKey[];

/** Maximum share of weight that may be missing before we refuse to score. */
export const MAX_MISSING_WEIGHT = 0.30;
export const INSUFFICIENT_SOURCE_DATA = 'insufficient source data';
/** MeetGeek reports each KPI on a 0–5 scale. */
export const MEETGEEK_KPI_SCALE_MAX = 5;

export type MeetgeekKpiValues = Partial<Record<MeetgeekKpiKey, number | null>>;

export interface MeetgeekMeetingInsights {
  /** Raw KPI values on MeetGeek's 0–5 scale. Missing/unknown must be null. */
  kpis: MeetgeekKpiValues;
  /** Action items reported by the provider, used only for owner coverage text. */
  actionItemsTotal?: number | null;
  actionItemsWithOwner?: number | null;
}

export interface QualityRubricItem {
  key: MeetgeekKpiKey;
  label: string;
  /** Raw provider value on the 0–5 scale, or null when not reported. */
  value: number | null;
  weight: number;
  /** (value / 5) * 10, or null when not reported. */
  score: number | null;
  note?: string;
}

export interface MeetingQuality {
  /** 0–10 composite, one decimal. Null when source data is insufficient. */
  rating: number | null;
  rubric: QualityRubricItem[] | null;
  summary: string | null;
  availableWeight: number;
  missingWeight: number;
  availableCount: number;
}

function readKpi(values: MeetgeekKpiValues, key: MeetgeekKpiKey): number | null {
  const raw = values?.[key];
  if (raw === null || raw === undefined) return null;
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) return null;
  if (n < 0 || n > MEETGEEK_KPI_SCALE_MAX) return null;
  return n;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

function ownerCoverageText(insights: MeetgeekMeetingInsights): string {
  const total = insights.actionItemsTotal;
  const owned = insights.actionItemsWithOwner;
  if (typeof total !== 'number' || total < 0) {
    return 'Action-owner coverage: not reported by the provider.';
  }
  if (total === 0) return 'Action-owner coverage: no action items were captured.';
  const withOwner = typeof owned === 'number' && owned >= 0 ? Math.min(owned, total) : 0;
  const pct = Math.round((withOwner / total) * 100);
  return `Action-owner coverage: ${withOwner}/${total} action items have an owner (${pct}%).`;
}

/**
 * Scores a meeting from provider insights only.
 * `insights` absent/empty ⇒ null rating with 'insufficient source data'.
 */
export function scoreMeetingQuality(input: {
  insights?: MeetgeekMeetingInsights | null;
}): MeetingQuality {
  const insights = input.insights;
  const values = insights?.kpis || {};

  const rubric: QualityRubricItem[] = MEETGEEK_KPI_KEYS.map((key) => {
    const value = readKpi(values, key);
    return {
      key,
      label: MEETGEEK_KPI_LABELS[key],
      value,
      weight: MEETGEEK_KPI_WEIGHTS[key],
      score: value === null ? null : round1((value / MEETGEEK_KPI_SCALE_MAX) * 10),
      ...(MEETGEEK_KPI_NOTES[key] ? { note: MEETGEEK_KPI_NOTES[key] } : {}),
    };
  });

  const available = rubric.filter((r) => r.value !== null);
  const availableWeight = round2(available.reduce((s, r) => s + r.weight, 0));
  const missingWeight = round2(1 - availableWeight);

  if (!insights || available.length === 0 || missingWeight > MAX_MISSING_WEIGHT) {
    return {
      rating: null,
      rubric: null,
      summary: INSUFFICIENT_SOURCE_DATA,
      availableWeight,
      missingWeight,
      availableCount: available.length,
    };
  }

  const weighted = available.reduce((s, r) => s + r.weight * (r.score as number), 0);
  const rating = round1(weighted / availableWeight);

  const lowest = [...available]
    .sort((a, b) => (a.score as number) - (b.score as number) || a.label.localeCompare(b.label))
    .slice(0, 2)
    .map((r) => `${r.label} ${r.score}/10`);

  const summary = [
    `Composite ${rating}/10 from ${available.length} of ${MEETGEEK_KPI_KEYS.length} MeetGeek KPIs.`,
    `Lowest: ${lowest.join(', ')}.`,
    ownerCoverageText(insights),
    MEETGEEK_KPI_NOTES.speaker_distribution
      ? `Note: speaker distribution is ${MEETGEEK_KPI_NOTES.speaker_distribution}`
      : '',
  ].filter(Boolean).join(' ');

  return { rating, rubric, summary, availableWeight, missingWeight, availableCount: available.length };
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

/** Parses a raw MeetGeek insights API payload into KPI values. */
export function parseMeetgeekInsights(payload: unknown): MeetgeekMeetingInsights | null {
  if (!payload || typeof payload !== 'object') return null;
  const root = payload as Record<string, any>;
  const buckets: Record<string, any>[] = [root];
  for (const k of ['insights', 'kpis', 'metrics', 'meeting_insights', 'scores', 'data']) {
    const v = root[k];
    if (v && typeof v === 'object' && !Array.isArray(v)) buckets.push(v as Record<string, any>);
    if (Array.isArray(v)) {
      // Shape: [{ name|key|metric, value|score }]
      const flat: Record<string, any> = {};
      for (const item of v) {
        const name = item?.name ?? item?.key ?? item?.metric ?? item?.type;
        const value = item?.value ?? item?.score ?? item?.rating;
        if (typeof name === 'string') flat[normalizeKey(name)] = value;
      }
      buckets.push(flat);
    }
  }

  const kpis: MeetgeekKpiValues = {};
  let found = false;
  for (const key of MEETGEEK_KPI_KEYS) {
    for (const bucket of buckets) {
      const raw = pickKey(bucket, key);
      if (raw === undefined) continue;
      const n = typeof raw === 'number' ? raw : Number(raw);
      if (!Number.isFinite(n)) continue;
      kpis[key] = n;
      found = true;
      break;
    }
  }

  const items = Array.isArray(root.action_items)
    ? root.action_items
    : Array.isArray(root.tasks) ? root.tasks : null;
  const actionItemsTotal = items ? items.length : null;
  const actionItemsWithOwner = items
    ? items.filter((i: any) => {
        const owner = i?.assignee ?? i?.owner ?? i?.assigned_to ?? i?.speaker;
        return typeof owner === 'string' && owner.trim().length > 0;
      }).length
    : null;

  if (!found && actionItemsTotal === null) return null;
  return { kpis, actionItemsTotal, actionItemsWithOwner };
}

function normalizeKey(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

const KEY_ALIASES: Record<MeetgeekKpiKey, string[]> = {
  engagement: ['engagement', 'engagement_score'],
  productivity: ['productivity', 'productivity_score'],
  agenda_follow_through: ['agenda_follow_through', 'agenda_followthrough', 'agenda', 'agenda_adherence'],
  clear_project_scope: ['clear_project_scope', 'project_scope', 'scope_clarity'],
  risk_awareness: ['risk_awareness', 'risks', 'risk'],
  task_ownership: ['task_ownership', 'ownership', 'action_item_ownership'],
  milestones_identified: ['milestones_identified', 'milestones'],
  speaker_distribution: ['speaker_distribution', 'talk_distribution', 'speaking_distribution', 'balance'],
};

function pickKey(bucket: Record<string, any>, key: MeetgeekKpiKey): unknown {
  const normalized: Record<string, any> = {};
  for (const [k, v] of Object.entries(bucket)) normalized[normalizeKey(k)] = v;
  for (const alias of KEY_ALIASES[key]) {
    const v = normalized[alias];
    if (v === undefined || v === null) continue;
    if (typeof v === 'object' && !Array.isArray(v)) {
      const inner = (v as any).value ?? (v as any).score ?? (v as any).rating;
      if (inner !== undefined && inner !== null) return inner;
      continue;
    }
    return v;
  }
  return undefined;
}

export function qualityTone(rating: number | null): string {
  if (rating === null) return 'text-muted-foreground border-border';
  if (rating >= 8) return 'text-emerald-600 border-emerald-500/30';
  if (rating >= 6) return 'text-primary border-primary/30';
  if (rating >= 4) return 'text-amber-600 border-amber-500/30';
  return 'text-destructive border-destructive/30';
}
