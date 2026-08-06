// H3 creative run workflow: strict state machine + fund claim-review guardrails.
// Mirrors the DB enum public.h3_workflow_state and the BEFORE UPDATE trigger
// public.h3_enforce_state_machine(). Keep both in lockstep.

export const H3_STATES = [
  "draft",
  "claim_review",
  "submitted",
  "rendering",
  "downloaded",
  "qa",
  "ready_for_review",
  "approved",
  "meta_ready",
] as const;

export type H3State = (typeof H3_STATES)[number];

export const H3_STATE_LABELS: Record<H3State, string> = {
  draft: "Draft",
  claim_review: "Claim Review",
  submitted: "Submitted",
  rendering: "Rendering",
  downloaded: "Downloaded",
  qa: "QA",
  ready_for_review: "Ready for Review",
  approved: "Approved",
  meta_ready: "Meta Ready",
};

export const H3_STATE_HINTS: Record<H3State, string> = {
  draft: "Build spec, script and first frame.",
  claim_review: "Claim checks + counsel-pending tag required before submission.",
  submitted: "Handed to provider. Status only — no re-generation.",
  rendering: "Provider is rendering. Status only — no re-generation.",
  downloaded: "Source pulled. Final 720×1280 transcode required before QA.",
  qa: "Automated decode checks + manual review.",
  ready_for_review: "A separate reviewer approves or rejects.",
  approved: "Packaging validation.",
  meta_ready: "Packaged for manual handoff only. No ad is created or launched.",
};

export function stateIndex(s: H3State): number {
  return H3_STATES.indexOf(s);
}

export function nextState(s: H3State): H3State | null {
  const i = stateIndex(s);
  return i >= 0 && i < H3_STATES.length - 1 ? H3_STATES[i + 1] : null;
}

/** Provider-owned states: the operator may never advance or re-generate here. */
export function isProviderOwned(s: H3State): boolean {
  return s === "submitted" || s === "rendering";
}

export const H3_REJECTION_CATEGORIES = [
  { value: "claim_violation", label: "Claim violation" },
  { value: "off_script", label: "Off approved script" },
  { value: "audio_issue", label: "Audio issue" },
  { value: "caption_issue", label: "Caption issue" },
  { value: "disclosure_missing", label: "Disclosure missing" },
  { value: "avatar_continuity", label: "Avatar continuity" },
  { value: "visual_artifact", label: "Visual artifact" },
  { value: "duration_mismatch", label: "Duration mismatch" },
  { value: "resolution_mismatch", label: "Resolution mismatch" },
  { value: "other", label: "Other" },
] as const;

export type H3RejectionCategory = (typeof H3_REJECTION_CATEGORIES)[number]["value"];

// ---------------------------------------------------------------- QA checklist

export const H3_QA_CHECKS = [
  { key: "decode", label: "Final MP4 decodes cleanly" },
  { key: "duration", label: "Duration 15s (±1s tolerance)" },
  { key: "aspect", label: "Aspect ratio 9:16" },
  { key: "resolution", label: "Final master 720×1280" },
  { key: "audio", label: "Audio presence matches expectation" },
  { key: "transcript", label: "Transcript matches approved script" },
  { key: "captions", label: "Captions embedded" },
  { key: "disclosures", label: "Disclosures embedded" },
  { key: "avatar", label: "Avatar continuity held" },
  { key: "artifacts", label: "No visual artifacts" },
] as const;

export type H3QaKey = (typeof H3_QA_CHECKS)[number]["key"];
export type H3QaResults = Partial<Record<H3QaKey, boolean>>;

export function qaComplete(r: H3QaResults): boolean {
  return H3_QA_CHECKS.every((c) => r[c.key] === true);
}

export function durationWithinTolerance(actual: number, target = 15, tol = 1): boolean {
  return Math.abs(actual - target) <= tol;
}

// ------------------------------------------------- Fund claim-review guardrails

export const H3_ACCREDITED_CALLOUT = "Accredited Investor:";

/** Counsel-pending proposed terms. Never presented as final or approved. */
export const AMT_PROPOSED_TERMS = [
  "Accredited investors only",
  "$50,000 minimum",
  "Stated preferred annual return, paid quarterly, before sponsor promote",
] as const;

export const H3_COUNSEL_NOTICE =
  "Counsel review required. Proposed terms are counsel-pending only. Reporting 5.0 is not SEC or FINRA approved and does not provide compliance approval.";

export type H3ClaimIssue = {
  severity: "blocking" | "warning";
  code: string;
  message: string;
};

const TERMS_SIGNALS =
  /(\$\s?\d|\bminimum\b|\bpreferred return\b|\breturn\b|\bdistribution\b|\bquarterly\b|\bpromote\b|\byield\b|\birr\b|\binvestors?\b)/i;

const BLOCKED_WORDING: { pattern: RegExp; message: string }[] = [
  // "fixed return", "fixed annual yield", "fixed 8% quarterly income", ...
  { pattern: /\bfixed\b(?=[^.]{0,40}\b(returns?|income|yield|rate|distributions?)\b)/i, message: "'Fixed' return wording is blocked." },
  { pattern: /\bguarantee(d|s)?\b/i, message: "'Guaranteed' is blocked." },
  { pattern: /\brisk[- ]?free\b/i, message: "'Risk-free' is blocked." },
  { pattern: /\bno[- ]risk\b/i, message: "'No-risk' is blocked." },
  { pattern: /\bassured\b/i, message: "'Assured' is blocked." },
  { pattern: /\bsafe investment\b/i, message: "'Safe investment' is blocked." },
  { pattern: /\bsecure returns?\b/i, message: "'Secure returns' is blocked." },
  { pattern: /\bcan'?t lose\b/i, message: "'Can't lose' is blocked." },
];

const DC_COMPARATIVE: { pattern: RegExp; message: string }[] = [
  { pattern: /\bbest place to invest\b/i, message: "'Best place to invest' is a comparative claim — blocked." },
  { pattern: /\bstrongest market\b/i, message: "'Strongest market' is a comparative claim — blocked." },
  { pattern: /\b(best|top|strongest|safest|hottest)\s+(market|city|metro|investment)\b/i, message: "Comparative market superlative — blocked." },
  { pattern: /\boutperform(s|ed|ing)?\b/i, message: "Performance comparison — blocked." },
  { pattern: /\b(beat(s|en)?|better than)\s+(the\s+)?(market|s&p|nasdaq|index)\b/i, message: "Performance comparison — blocked." },
];

/**
 * Deterministic claim scan for fund creative copy/script.
 * Washington, DC may only appear as thesis context — never comparative.
 */
export function scanFundClaims(text: string): H3ClaimIssue[] {
  const t = (text || "").trim();
  const issues: H3ClaimIssue[] = [];
  if (!t) return issues;

  for (const { pattern, message } of BLOCKED_WORDING) {
    if (pattern.test(t)) issues.push({ severity: "blocking", code: "blocked_wording", message });
  }
  for (const { pattern, message } of DC_COMPARATIVE) {
    if (pattern.test(t)) issues.push({ severity: "blocking", code: "comparative_claim", message });
  }
  if (TERMS_SIGNALS.test(t) && !t.includes(H3_ACCREDITED_CALLOUT)) {
    issues.push({
      severity: "blocking",
      code: "missing_accredited_callout",
      message: `Investment terms appear — the market callout "${H3_ACCREDITED_CALLOUT}" is required.`,
    });
  }
  if (/\bwashington,?\s?d\.?c\.?\b/i.test(t)) {
    issues.push({
      severity: "warning",
      code: "dc_thesis_context",
      message: "Washington, DC must read as thesis context only — no market ranking or performance claim.",
    });
  }
  // de-dupe identical messages
  const seen = new Set<string>();
  return issues.filter((i) => (seen.has(i.message) ? false : (seen.add(i.message), true)));
}

export function hasBlockingClaims(issues: H3ClaimIssue[]): boolean {
  return issues.some((i) => i.severity === "blocking");
}