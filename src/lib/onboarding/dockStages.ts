/**
 * Stage model for the AI Studio onboarding dock.
 *
 * The dock is a single long scroll (modelled on the daily huddle) where every
 * stage is always rendered. Stage status is derived from real rows, never from
 * local component state, so a refresh restores exactly the same picture.
 */

export const ONBOARDING_STATIC_BUDGET = 10;
export const ONBOARDING_VIDEO_BUDGET = 5;

export type StageStatus = 'complete' | 'active' | 'blocked' | 'pending';

export interface StageDef {
  key: string;
  label: string;
  hint: string;
  /** client_assets.asset_type rows that belong to this stage. */
  assetTypes?: string[];
}

export const ONBOARDING_STAGES: StageDef[] = [
  {
    key: 'offer_review',
    label: 'Offer review',
    hint: 'Confirm the offer every asset is generated from',
  },
  {
    key: 'strategy',
    label: 'Strategy & angles',
    hint: 'Offer summary, location, unique strategy, credibility, 5 angles',
    assetTypes: ['offer_summary', 'angles'],
  },
  {
    key: 'copy',
    label: 'Copy & nurture',
    hint: '5 ad copy variants, 10 nurture emails, reminders, VSL',
    assetTypes: ['ad_copy', 'nurture_emails', 'appointment_reminders', 'vsl'],
  },
  {
    key: 'statics',
    label: 'Static ads',
    hint: `Direction + ${ONBOARDING_STATIC_BUDGET} statics`,
    assetTypes: ['static_ad_brief'],
  },
  {
    key: 'avatar',
    label: 'Client avatar',
    hint: 'Spokesperson avatar assigned to this client',
  },
  {
    key: 'scripts',
    label: 'Video scripts',
    hint: '5 video ad scripts + 5 FAQ scripts — needs your approval',
    assetTypes: ['video_scripts', 'faq_scripts'],
  },
  {
    key: 'videos',
    label: 'Avatar videos',
    hint: `${ONBOARDING_VIDEO_BUDGET} × 30s — podcast, street interview, walk-and-talk, b-roll, split screen`,
  },
  {
    key: 'ready',
    label: 'Launch ready',
    hint: 'Everything generated, reviewed and on the canvas',
  },
];

export interface OnboardingSnapshot {
  offer: any | null;
  assets: any[];
  statics: any[];
  videoJobs: any[];
  avatar: any | null;
  approvals: any[];
  goal: any | null;
  events: any[];
}

export const EMPTY_SNAPSHOT: OnboardingSnapshot = {
  offer: null,
  assets: [],
  statics: [],
  videoJobs: [],
  avatar: null,
  approvals: [],
  goal: null,
  events: [],
};

export function assetsForStage(snap: OnboardingSnapshot, stage: StageDef) {
  if (!stage.assetTypes) return [];
  return snap.assets.filter((a) => stage.assetTypes!.includes(a.asset_type));
}

/** Pending script approval blocks the video agent — same rule the backend enforces. */
export function scriptApprovalState(snap: OnboardingSnapshot): 'none' | 'pending' | 'approved' | 'rejected' {
  const rows = snap.approvals.filter((a) => a.queue_type === 'video_scripts');
  if (rows.length === 0) return 'none';
  if (rows.some((a) => a.status === 'pending')) return 'pending';
  if (rows.some((a) => a.status === 'approved')) return 'approved';
  return 'rejected';
}

function isStageComplete(snap: OnboardingSnapshot, stage: StageDef): boolean {
  switch (stage.key) {
    case 'offer_review':
      return !!snap.offer?.offer_reviewed_at;
    case 'statics':
      return snap.statics.length >= ONBOARDING_STATIC_BUDGET;
    case 'avatar':
      return !!snap.avatar;
    case 'videos':
      return snap.videoJobs.filter((j) => j.status === 'completed').length >= ONBOARDING_VIDEO_BUDGET;
    case 'ready':
      return snap.goal?.status === 'completed';
    default: {
      const types = stage.assetTypes ?? [];
      const present = new Set(assetsForStage(snap, stage).map((a) => a.asset_type));
      return types.length > 0 && types.every((t) => present.has(t));
    }
  }
}

/**
 * Derives a status for every stage. Exactly one stage is 'active' — the first
 * one that isn't complete and isn't blocked by a human gate.
 */
export function computeStageStatuses(snap: OnboardingSnapshot): Record<string, StageStatus> {
  const offerReviewed = !!snap.offer?.offer_reviewed_at;
  const scripts = scriptApprovalState(snap);
  const out: Record<string, StageStatus> = {};
  let activeAssigned = false;

  for (const stage of ONBOARDING_STAGES) {
    if (isStageComplete(snap, stage)) {
      out[stage.key] = 'complete';
      continue;
    }
    const blocked =
      (stage.key !== 'offer_review' && !offerReviewed) ||
      (stage.key === 'videos' && scripts === 'pending');

    if (blocked) {
      out[stage.key] = 'blocked';
      continue;
    }
    if (!activeAssigned) {
      out[stage.key] = 'active';
      activeAssigned = true;
    } else {
      out[stage.key] = 'pending';
    }
  }
  return out;
}

export function fmtStageDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

/** Renders a client_assets.content jsonb blob as readable label/value blocks. */
export function flattenAssetContent(content: any): { label: string; body: string }[] {
  if (content == null) return [];
  if (typeof content === 'string') return [{ label: '', body: content }];
  if (Array.isArray(content)) {
    return content.map((item, i) => ({
      label: `${i + 1}`,
      body: typeof item === 'string' ? item : stringifyValue(item),
    }));
  }
  if (typeof content === 'object') {
    return Object.entries(content).map(([k, v]) => ({
      label: k.replace(/_/g, ' '),
      body: stringifyValue(v),
    }));
  }
  return [{ label: '', body: String(content) }];
}

function stringifyValue(v: any): string {
  if (v == null) return '—';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) {
    return v
      .map((item, i) => `${i + 1}. ${typeof item === 'string' ? item : stringifyValue(item)}`)
      .join('\n');
  }
  return Object.entries(v)
    .map(([k, val]) => `${k.replace(/_/g, ' ')}: ${typeof val === 'string' ? val : stringifyValue(val)}`)
    .join('\n');
}