// Deterministic HNWI capital-raising OPERATIONAL QA scorecard.
//
// This is sales-execution QA only. It is NEVER investor suitability,
// accreditation verification, or any compliance approval.
//
// Hard rules:
//  * Score is derived ONLY from actual MeetGeek artifacts: transcript text,
//    provider summary, provider action items and provider analytics/KPIs.
//  * Nothing may be inferred from duration, summary length, recording presence
//    or CRM/lead matching quality. Missing evidence scores 0 and is tagged
//    `insufficient_evidence`.
//  * 100-point scale, fixed category maxima. N/A reweight is allowed only for
//    the two categories that can be objectively inapplicable.

export type QaCategoryKey =
  | 'offer_fit'
  | 'non_promissory'
  | 'discovery'
  | 'risk_timing_liquidity'
  | 'next_step'
  | 'engagement'
  | 'objection_handling'
  | 'crm_handoff';

export const QA_CATEGORY_MAX: Record<QaCategoryKey, number> = {
  offer_fit: 15,
  non_promissory: 15,
  discovery: 15,
  risk_timing_liquidity: 10,
  next_step: 15,
  engagement: 10,
  objection_handling: 10,
  crm_handoff: 10,
};

export const QA_CATEGORY_LABELS: Record<QaCategoryKey, string> = {
  offer_fit: 'Offer clarity & prospect fit',
  non_promissory: 'Non-promissory communication',
  discovery: 'Qualification discovery',
  risk_timing_liquidity: 'Risk, timing & liquidity',
  next_step: 'Next-step commitment',
  engagement: 'Engagement',
  objection_handling: 'Objection handling',
  crm_handoff: 'CRM handoff',
};

/** Only these two may be marked N/A and reweighted. */
export const QA_NA_ELIGIBLE: QaCategoryKey[] = ['risk_timing_liquidity', 'objection_handling'];

export const QA_CATEGORY_KEYS = Object.keys(QA_CATEGORY_MAX) as QaCategoryKey[];
export const QA_TOTAL_MAX = 100;
export const QA_PASS_THRESHOLD = 70;
export const INSUFFICIENT_EVIDENCE = 'insufficient_evidence';
/** A transcript shorter than this is not material evidence. */
export const MATERIAL_TRANSCRIPT_MIN_CHARS = 400;
/** Rep monologue share that forces manual review. */
export const REP_TALK_MANUAL_REVIEW_RATIO = 0.8;

export type QaGateStatus = 'pass' | 'fail' | 'manual_review';

export type QaHardFailCode =
  | 'promissory_guarantee'
  | 'accreditation_or_suitability_claim'
  | 'fabricated_evidence'
  | 'legal_tax_financial_advice'
  | 'zero_discovery'
  | 'no_committed_next_step';

export type QaReviewCode =
  | 'red_flag_present'
  | 'missing_material_transcript'
  | 'unresolved_risk'
  | 'unclear_offer'
  | 'rep_dominated_talk_time'
  | 'below_pass_threshold';

export interface QaRedFlag {
  code: QaHardFailCode | QaReviewCode;
  hardFail: boolean;
  detail: string;
  /** Verbatim source excerpt, or null when the flag is an absence of evidence. */
  evidence: string | null;
}

export interface QaCategoryScore {
  key: QaCategoryKey;
  label: string;
  max: number;
  points: number;
  /** true when the category was objectively inapplicable and reweighted away. */
  na: boolean;
  insufficientEvidence: boolean;
  evidence: string[];
}

export interface QaActionOwner {
  item: string;
  owner: string | null;
  deadline: string | null;
}

export interface QaNextStep {
  committed: boolean;
  detail: string | null;
  evidence: string | null;
}

export interface QaNaRedistribution {
  naKeys: QaCategoryKey[];
  removedMax: number;
  scoredMax: number;
  scale: number;
}

export interface QaScorecard {
  /** 0–100 integer. Never null: absent evidence scores 0. */
  total: number;
  gateStatus: QaGateStatus;
  categories: QaCategoryScore[];
  evidenceTags: string[];
  naRedistribution: QaNaRedistribution | null;
  redFlags: QaRedFlag[];
  nextStep: QaNextStep | null;
  actionOwners: QaActionOwner[];
  /** The ACTUAL MeetGeek summary, never a generated substitute. */
  meetgeekSummary: string | null;
  pipelineOutcome: string;
  narrative: string;
}

// ---------------------------------------------------------------------------
// Provider analytics (MeetGeek insights)
// ---------------------------------------------------------------------------

export type MeetgeekKpiKey =
  | 'engagement'
  | 'productivity'
  | 'agenda_follow_through'
  | 'clear_project_scope'
  | 'risk_awareness'
  | 'task_ownership'
  | 'milestones_identified'
  | 'speaker_distribution';

export const MEETGEEK_KPI_KEYS: MeetgeekKpiKey[] = [
  'engagement',
  'productivity',
  'agenda_follow_through',
  'clear_project_scope',
  'risk_awareness',
  'task_ownership',
  'milestones_identified',
  'speaker_distribution',
];

/** MeetGeek reports each KPI on a 0–5 scale. */
export const MEETGEEK_KPI_SCALE_MAX = 5;

export type MeetgeekKpiValues = Partial<Record<MeetgeekKpiKey, number | null>>;

export interface MeetgeekMeetingInsights {
  kpis: MeetgeekKpiValues;
  actionItemsTotal?: number | null;
  actionItemsWithOwner?: number | null;
  /** Share of speech attributable to the host/rep, 0–1, when reported. */
  repTalkRatio?: number | null;
}

export interface QaCrmContext {
  leadMatched?: boolean;
  ghlContactId?: string | null;
  noteWritten?: boolean;
}

export interface QaInput {
  transcript?: string | null;
  summary?: string | null;
  actionItems?: string[] | null;
  analytics?: MeetgeekMeetingInsights | null;
  crm?: QaCrmContext | null;
}

// ---------------------------------------------------------------------------
// Deterministic language patterns
// ---------------------------------------------------------------------------

const PROMISSORY = /(?<!\b(?:not|never|no|isn't|aren't|cannot|non-)\s?)\b(guarantee[ds]?|guaranteeing|risk[-\s]?free|no\s+risk|can(?:no|')t\s+lose|cannot\s+lose|assured\s+returns?|we\s+promise|i\s+promise\s+you|locked[-\s]in\s+returns?)\b/i;
const ACCREDITATION_CLAIM = /\b(?:you(?:'re| are)\s+(?:already\s+)?(?:verified|confirmed)\s+accredited|we(?:'ve| have)\s+verified\s+your\s+accreditation|accreditation\s+(?:is\s+)?(?:verified|confirmed)|suitability\s+(?:is\s+)?(?:verified|confirmed|approved)|you(?:'re| are)\s+approved\s+as\s+an\s+accredited\s+investor)\b/i;
const ADVICE = /\b(?:as\s+your\s+(?:financial|tax|legal)\s+(?:advisor|adviser|attorney)|you\s+should\s+(?:liquidate|sell\s+your|move\s+your\s+401|invest\s+your\s+retirement)|this\s+is\s+tax[-\s]free|i(?:'m| am)\s+advising\s+you\s+legally|my\s+legal\s+advice\s+is)\b/i;
const FABRICATION = /\b(?:as\s+(?:stated|confirmed|quoted)\s+in\s+the\s+transcript|per\s+the\s+call\s+recording\s+transcript|the\s+transcript\s+shows)\b/i;

const COMPLIANT_QUALIFIERS = /\b(target(?:ed)?\s+returns?|projected|pro\s?forma|no\s+guarantee|not\s+guaranteed|risk\s+of\s+loss|past\s+performance|forward[-\s]looking|subject\s+to\s+the\s+(?:ppm|offering\s+documents)|illiquid)\b/i;

const OFFER_TERMS = /\b(offering|fund|ppm|private\s+placement|minimum\s+investment|allocation|cap\s+rate|preferred\s+return|equity|debt|note|asset\s+class|strategy|deal|portfolio)\b/i;
const FIT_TERMS = /\b(your\s+goals?|objectives?|capital\s+available|allocate|allocation\s+size|ticket\s+size|investable|portfolio\s+mix|time\s+horizon|check\s+size)\b/i;

const DISCOVERY_TERMS = /\b(how\s+much|what\s+are\s+you\s+looking|why|when\s+would\s+you|what(?:'s| is)\s+your|tell\s+me\s+about|have\s+you\s+(?:invested|deployed)|walk\s+me\s+through|what\s+matters)\b/i;

const RISK_TERMS = /\b(risk|downside|liquidity|illiquid|lock[-\s]?up|hold\s+period|timeline|time\s+horizon|distributions?|capital\s+call|worst\s+case|drawdown)\b/i;
const RISK_INAPPLICABLE_HINT = /\b(internal\s+(?:sync|standup|huddle)|operations\s+review|pipeline\s+review|no\s+offer\s+discussed)\b/i;

const NEXT_STEP_TERMS = /\b(next\s+(?:call|meeting|step)|follow[-\s]?up|schedul(?:e|ed|ing)|calendar\s+invite|book(?:ed|ing)?|we(?:'ll| will)\s+(?:speak|meet|reconnect)|send\s+(?:over\s+)?the\s+(?:ppm|documents?|deck))\b/i;
const TIME_ANCHOR = /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|next\s+week|this\s+week|jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|\d{1,2}\/\d{1,2}|\d{1,2}(?::\d{2})?\s?(?:am|pm)|\d{4}-\d{2}-\d{2})\b/i;

const OBJECTION_TERMS = /\b(concerned?|concerns?|worried|worry|hesitant|not\s+sure|too\s+(?:high|risky|much)|i\s+need\s+to\s+think|what\s+if|the\s+problem\s+is|push\s?back|skeptical)\b/i;
const RESOLUTION_TERMS = /\b(does\s+that\s+(?:help|address|make\s+sense)|to\s+address\s+that|here(?:'s| is)\s+how\s+we|that\s+makes\s+sense\s+now|answer(?:s|ed)?\s+your\s+(?:question|concern)|clarif(?:y|ied|ies))\b/i;
const RISK_RESOLUTION = /\b(we(?:'ll| will)\s+(?:send|share)\s+the\s+(?:ppm|risk\s+factors)|risk\s+factors\s+are\s+(?:in|outlined)|hold\s+period\s+is|liquidity\s+(?:is|works)|distributions?\s+(?:begin|are\s+paid))\b/i;

const OWNER_PATTERN = /^\s*(?:\[?(?<owner>[A-Z][\w.'-]*(?:\s+[A-Z][\w.'-]*)?)\]?\s*[:\u2013-]\s*)/;
const DEADLINE_PATTERN = /\b(?:by|before|due|on)\s+(?<deadline>(?:mon|tues|wednes|thurs|fri|satur|sun)day|tomorrow|next\s+week|this\s+week|eod|eow|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?|\d{4}-\d{2}-\d{2}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2})\b/i;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function text(value?: string | null): string {
  return typeof value === 'string' ? value : '';
}

function excerpt(source: string, pattern: RegExp, width = 160): string | null {
  const m = pattern.exec(source);
  if (!m) return null;
  const start = Math.max(0, (m.index ?? 0) - 40);
  return source.slice(start, start + width).replace(/\s+/g, ' ').trim();
}

function countQuestions(transcript: string): number {
  return (transcript.match(/\?/g) || []).length;
}

function clampKpi(values: MeetgeekKpiValues | undefined, key: MeetgeekKpiKey): number | null {
  const raw = values?.[key];
  if (raw === null || raw === undefined) return null;
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > MEETGEEK_KPI_SCALE_MAX) return null;
  return n;
}

function cat(
  key: QaCategoryKey,
  points: number,
  evidence: string[],
  opts?: { na?: boolean; insufficient?: boolean },
): QaCategoryScore {
  const max = QA_CATEGORY_MAX[key];
  return {
    key,
    label: QA_CATEGORY_LABELS[key],
    max,
    points: Math.max(0, Math.min(max, Math.round(points))),
    na: !!opts?.na,
    insufficientEvidence: !!opts?.insufficient,
    evidence: evidence.filter(Boolean).slice(0, 4),
  };
}

/** Parses provider action items into owner/deadline triples (no inference). */
export function parseActionOwners(items: string[] | null | undefined): QaActionOwner[] {
  return (items || [])
    .map((raw) => String(raw || '').trim())
    .filter((s) => s.length > 2)
    .slice(0, 25)
    .map((item) => {
      const owner = OWNER_PATTERN.exec(item)?.groups?.owner ?? null;
      const deadline = DEADLINE_PATTERN.exec(item)?.groups?.deadline ?? null;
      return { item: item.slice(0, 240), owner, deadline };
    });
}

// ---------------------------------------------------------------------------
// Scorer
// ---------------------------------------------------------------------------

export function scoreCapitalRaisingQA(input: QaInput): QaScorecard {
  const transcript = text(input.transcript);
  const summary = text(input.summary);
  const actionItems = (input.actionItems || []).map((i) => String(i || '').trim()).filter(Boolean);
  const analytics = input.analytics ?? null;
  const crm = input.crm ?? null;

  const transcriptMaterial = transcript.replace(/\s+/g, ' ').trim().length >= MATERIAL_TRANSCRIPT_MIN_CHARS;
  const corpus = [transcriptMaterial ? transcript : '', summary, actionItems.join('\n')]
    .filter(Boolean)
    .join('\n');
  const spoken = transcriptMaterial ? transcript : '';

  const evidenceTags: string[] = [];
  if (transcriptMaterial) evidenceTags.push('transcript');
  if (summary) evidenceTags.push('meetgeek_summary');
  if (actionItems.length) evidenceTags.push('action_items');
  if (analytics && Object.keys(analytics.kpis || {}).length) evidenceTags.push('meetgeek_analytics');

  const redFlags: QaRedFlag[] = [];
  const flag = (code: QaRedFlag['code'], hardFail: boolean, detail: string, evidence: string | null) => {
    redFlags.push({ code, hardFail, detail, evidence });
  };

  // ---- hard-fail language checks (verbatim evidence required) --------------
  const promissory = excerpt(corpus, PROMISSORY);
  if (promissory) flag('promissory_guarantee', true, 'Explicit guarantee / promissory return language.', promissory);

  const accreditation = excerpt(corpus, ACCREDITATION_CLAIM);
  if (accreditation) {
    flag('accreditation_or_suitability_claim', true, 'Rep asserted accreditation or suitability was verified.', accreditation);
  }

  const advice = excerpt(corpus, ADVICE);
  if (advice) flag('legal_tax_financial_advice', true, 'Legal, tax or financial advice was given.', advice);

  const fabricated = !transcriptMaterial ? excerpt(summary, FABRICATION) : null;
  if (fabricated) {
    flag('fabricated_evidence', true, 'Summary cites transcript evidence that does not exist.', fabricated);
  }

  // ---- categories ---------------------------------------------------------
  const categories: QaCategoryScore[] = [];

  // offer / fit (15)
  const offerHit = excerpt(corpus, OFFER_TERMS);
  const fitHit = excerpt(corpus, FIT_TERMS);
  if (!offerHit && !fitHit) {
    categories.push(cat('offer_fit', 0, [], { insufficient: true }));
    flag('unclear_offer', false, 'No offer or prospect-fit evidence in transcript or summary.', null);
  } else {
    let pts = 0;
    const ev: string[] = [];
    if (offerHit) { pts += 9; ev.push(`offer terms: ${offerHit}`); }
    if (fitHit) { pts += 6; ev.push(`fit signals: ${fitHit}`); }
    categories.push(cat('offer_fit', pts, ev));
    if (!offerHit) flag('unclear_offer', false, 'Prospect fit discussed without a clearly stated offer.', fitHit);
  }

  // non-promissory (15)
  if (promissory) {
    categories.push(cat('non_promissory', 0, [`promissory language: ${promissory}`]));
  } else if (!corpus) {
    categories.push(cat('non_promissory', 0, [], { insufficient: true }));
  } else {
    const qualifier = excerpt(corpus, COMPLIANT_QUALIFIERS);
    categories.push(cat('non_promissory', qualifier ? 15 : 10, [
      'no promissory or guarantee language detected',
      qualifier ? `qualifying language: ${qualifier}` : 'no explicit risk-qualifying language present',
    ]));
  }

  // discovery (15)
  const questions = countQuestions(spoken);
  const discoveryHit = excerpt(spoken, DISCOVERY_TERMS);
  if (!transcriptMaterial) {
    categories.push(cat('discovery', 0, [], { insufficient: true }));
  } else if (questions === 0 && !discoveryHit) {
    categories.push(cat('discovery', 0, ['no questions asked in the transcript']));
    flag('zero_discovery', true, 'No qualification questions were asked.', null);
  } else {
    let pts = 0;
    if (questions >= 1) pts += 5;
    if (questions >= 5) pts += 4;
    if (discoveryHit) pts += 6;
    categories.push(cat('discovery', pts, [
      `${questions} question(s) in transcript`,
      discoveryHit ? `discovery: ${discoveryHit}` : '',
    ]));
  }

  // risk / timing / liquidity (10) — N/A eligible
  const riskHit = excerpt(corpus, RISK_TERMS);
  const riskInapplicable = transcriptMaterial
    && !riskHit
    && !offerHit
    && !!excerpt(corpus, RISK_INAPPLICABLE_HINT);
  if (riskInapplicable) {
    categories.push(cat('risk_timing_liquidity', 0, ['no offer discussed — risk/liquidity objectively not warranted'], { na: true }));
  } else if (!transcriptMaterial && !summary) {
    categories.push(cat('risk_timing_liquidity', 0, [], { insufficient: true }));
  } else if (!riskHit) {
    categories.push(cat('risk_timing_liquidity', 0, ['risk, timing and liquidity were not covered']));
    flag('unresolved_risk', false, 'Risk, timing and liquidity were never addressed.', null);
  } else {
    const resolved = excerpt(corpus, RISK_RESOLUTION);
    categories.push(cat('risk_timing_liquidity', resolved ? 10 : 6, [
      `risk topics: ${riskHit}`,
      resolved ? `resolution: ${resolved}` : 'raised but not resolved',
    ]));
    if (!resolved) flag('unresolved_risk', false, 'Risk/liquidity raised but left unresolved.', riskHit);
  }

  // next-step commitment (15)
  const nextHit = excerpt(corpus, NEXT_STEP_TERMS);
  const timeHit = nextHit ? excerpt(corpus, TIME_ANCHOR) : null;
  let nextStep: QaNextStep | null = null;
  if (!transcriptMaterial) {
    // Without a material transcript there is no evidence either way — never infer.
    categories.push(cat('next_step', 0, [], { insufficient: true }));
  } else if (!nextHit) {
    categories.push(cat('next_step', 0, ['no next step was agreed']));
    flag('no_committed_next_step', true, 'No committed next step in the call.', null);
    nextStep = { committed: false, detail: null, evidence: null };
  } else {
    const pts = timeHit ? 15 : 8;
    categories.push(cat('next_step', pts, [
      `next step: ${nextHit}`,
      timeHit ? `time anchor: ${timeHit}` : 'no date or time committed',
    ]));
    nextStep = { committed: !!timeHit, detail: nextHit, evidence: timeHit ?? nextHit };
    if (!timeHit) flag('no_committed_next_step', true, 'Next step mentioned without a committed date/time.', nextHit);
  }

  // engagement (10) — provider analytics only
  const engagementKpi = clampKpi(analytics?.kpis, 'engagement');
  if (engagementKpi === null) {
    categories.push(cat('engagement', 0, [], { insufficient: true }));
  } else {
    categories.push(cat('engagement', (engagementKpi / MEETGEEK_KPI_SCALE_MAX) * 10, [
      `MeetGeek engagement KPI ${engagementKpi}/${MEETGEEK_KPI_SCALE_MAX}`,
    ]));
  }

  const repRatio = typeof analytics?.repTalkRatio === 'number' && Number.isFinite(analytics.repTalkRatio)
    ? Math.max(0, Math.min(1, analytics.repTalkRatio))
    : null;
  if (repRatio !== null && repRatio >= REP_TALK_MANUAL_REVIEW_RATIO) {
    flag('rep_dominated_talk_time', false, `Rep talk share ${Math.round(repRatio * 100)}% ≥ 80%.`, null);
  }

  // objection handling (10) — N/A eligible
  const objectionHit = excerpt(corpus, OBJECTION_TERMS);
  if (!transcriptMaterial) {
    categories.push(cat('objection_handling', 0, [], { insufficient: true }));
  } else if (!objectionHit) {
    categories.push(cat('objection_handling', 0, ['no objection was raised — objectively not applicable'], { na: true }));
  } else {
    const resolved = excerpt(corpus, RESOLUTION_TERMS);
    categories.push(cat('objection_handling', resolved ? 10 : 5, [
      `objection: ${objectionHit}`,
      resolved ? `handled: ${resolved}` : 'objection not visibly addressed',
    ]));
  }

  // CRM handoff (10) — action items with owners/deadlines + recorded write-back
  const actionOwners = parseActionOwners(actionItems);
  if (actionOwners.length === 0) {
    categories.push(cat('crm_handoff', 0, [], { insufficient: true }));
  } else {
    const owned = actionOwners.filter((a) => a.owner).length;
    const dated = actionOwners.filter((a) => a.deadline).length;
    let pts = 4;
    if (owned > 0) pts += 3;
    if (dated > 0) pts += 2;
    if (crm?.noteWritten) pts += 1;
    categories.push(cat('crm_handoff', pts, [
      `${actionOwners.length} action item(s), ${owned} with owner, ${dated} with deadline`,
      crm?.noteWritten ? 'CRM note write-back recorded' : 'no CRM note write-back recorded',
    ]));
  }

  // ---- totals + N/A reweight ---------------------------------------------
  const ordered = QA_CATEGORY_KEYS.map((k) => categories.find((c) => c.key === k)!)
    .filter(Boolean) as QaCategoryScore[];

  const naCats = ordered.filter((c) => c.na && QA_NA_ELIGIBLE.includes(c.key));
  const scored = ordered.filter((c) => !naCats.includes(c));
  const scoredMax = scored.reduce((s, c) => s + c.max, 0);
  const removedMax = naCats.reduce((s, c) => s + c.max, 0);
  const earned = scored.reduce((s, c) => s + c.points, 0);

  const naRedistribution: QaNaRedistribution | null = naCats.length
    ? {
        naKeys: naCats.map((c) => c.key),
        removedMax,
        scoredMax,
        scale: scoredMax > 0 ? Math.round((QA_TOTAL_MAX / scoredMax) * 1000) / 1000 : 0,
      }
    : null;

  let total = scoredMax > 0 ? Math.round((earned / scoredMax) * QA_TOTAL_MAX) : 0;
  total = Math.max(0, Math.min(QA_TOTAL_MAX, total));

  // ---- gate ---------------------------------------------------------------
  const hardFail = redFlags.some((f) => f.hardFail);
  if (!transcriptMaterial) {
    flag('missing_material_transcript', false, 'No material transcript was available for scoring.', null);
    for (const c of ordered) if (c.insufficientEvidence && !evidenceTags.includes(INSUFFICIENT_EVIDENCE)) evidenceTags.push(INSUFFICIENT_EVIDENCE);
  }
  if (ordered.some((c) => c.insufficientEvidence) && !evidenceTags.includes(INSUFFICIENT_EVIDENCE)) {
    evidenceTags.push(INSUFFICIENT_EVIDENCE);
  }

  let gateStatus: QaGateStatus;
  if (hardFail) {
    gateStatus = 'fail';
    total = 0;
  } else if (redFlags.length > 0 || !transcriptMaterial || total < QA_PASS_THRESHOLD) {
    gateStatus = 'manual_review';
    if (total < QA_PASS_THRESHOLD && !redFlags.some((f) => f.code === 'below_pass_threshold')) {
      flag('below_pass_threshold', false, `Total ${total}/100 is below the ${QA_PASS_THRESHOLD} pass threshold.`, null);
    }
  } else {
    gateStatus = 'pass';
  }

  const pipelineOutcome = hardFail
    ? 'blocked_hard_fail'
    : gateStatus === 'manual_review'
      ? 'needs_manual_review'
      : nextStep?.committed
        ? 'advanced_next_step_committed'
        : 'no_committed_advance';

  const narrative = [
    `Operational QA ${total}/100 (${gateStatus.replace('_', ' ')}).`,
    `Evidence: ${evidenceTags.length ? evidenceTags.join(', ') : 'none'}.`,
    naCats.length ? `N/A reweighted: ${naCats.map((c) => c.label).join(', ')}.` : '',
    redFlags.length ? `Flags: ${redFlags.map((f) => f.code).join(', ')}.` : 'No flags.',
    'Sales-execution QA only — not investor suitability, accreditation or compliance approval.',
  ].filter(Boolean).join(' ');

  return {
    total,
    gateStatus,
    categories: ordered,
    evidenceTags,
    naRedistribution,
    redFlags,
    nextStep,
    actionOwners,
    meetgeekSummary: summary ? summary.slice(0, 8000) : null,
    pipelineOutcome,
    narrative,
  };
}

// ---------------------------------------------------------------------------
// Provider payload parsing
// ---------------------------------------------------------------------------

/** Parses a raw MeetGeek insights API payload into KPI values + talk share. */
export function parseMeetgeekInsights(payload: unknown): MeetgeekMeetingInsights | null {
  if (!payload || typeof payload !== 'object') return null;
  const root = payload as Record<string, any>;
  const buckets: Record<string, any>[] = [root];
  for (const k of ['insights', 'kpis', 'metrics', 'meeting_insights', 'scores', 'data']) {
    const v = root[k];
    if (v && typeof v === 'object' && !Array.isArray(v)) buckets.push(v as Record<string, any>);
    if (Array.isArray(v)) {
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

  const repTalkRatio = parseRepTalkRatio(root);

  if (!found && actionItemsTotal === null && repTalkRatio === null) return null;
  return { kpis, actionItemsTotal, actionItemsWithOwner, repTalkRatio };
}

/** Host/rep share of speech, from provider talk-time data only. */
function parseRepTalkRatio(root: Record<string, any>): number | null {
  const list = Array.isArray(root.speakers)
    ? root.speakers
    : Array.isArray(root.talk_time) ? root.talk_time : null;
  if (!list || list.length === 0) return null;
  let totalSecs = 0;
  let hostSecs = 0;
  for (const s of list) {
    const secs = Number(s?.talk_time_seconds ?? s?.seconds ?? s?.duration ?? NaN);
    if (!Number.isFinite(secs) || secs < 0) continue;
    totalSecs += secs;
    const isHost = s?.is_host === true || /host|rep|internal/i.test(String(s?.role || ''));
    if (isHost) hostSecs += secs;
  }
  if (totalSecs <= 0) return null;
  return Math.round((hostSecs / totalSecs) * 1000) / 1000;
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
