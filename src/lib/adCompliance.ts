// Ad compliance helpers for investment-adjacent Meta campaigns.
// Enforces: exemption gating, mandatory "Accredited Investor:" prefix,
// forbidden claim scan, and default risk disclosure.

export const ACCREDITED_PREFIX = "Accredited Investor:";

export const DEFAULT_DISCLOSURE =
  "All investments involve risk, including possible loss of principal. Past performance does not guarantee future results. This opportunity is intended only for accredited investors. Any offer or sale of securities will be made only through the applicable offering documents. Prospective investors should review all offering materials, conduct independent due diligence and consult their legal, tax and financial advisers.";

// Case-insensitive substring / phrase matches. These trigger blocking errors.
const FORBIDDEN_PATTERNS: { pattern: RegExp; reason: string }[] = [
  { pattern: /\bguaranteed?\b/i,          reason: "'Guaranteed' is not allowed for investment ads." },
  { pattern: /\brisk[- ]?free\b/i,        reason: "'Risk-free' is not allowed for investment ads." },
  { pattern: /\bsafe investment\b/i,      reason: "'Safe investment' implies no risk." },
  { pattern: /\bsecure returns?\b/i,      reason: "'Secure returns' implies no risk." },
  { pattern: /\bno[- ]risk\b/i,           reason: "'No-risk' is not allowed." },
  { pattern: /\bassured returns?\b/i,     reason: "'Assured returns' is not allowed." },
  { pattern: /\bwill (double|triple)\b/i, reason: "Unsupported performance claim." },
  { pattern: /\bcan't lose\b/i,           reason: "'Can't lose' implies no risk." },
  { pattern: /\bhurry\b|\blast chance\b|\bonly \d+ (spots|seats) left\b/i,
    reason: "Misleading urgency claim." },
];

export type Exemption = "506c" | "506b" | "other" | "";

export type ComplianceIssue = {
  severity: "blocking" | "warning";
  code: string;
  message: string;
};

/**
 * Validate primary body copy for an investment ad.
 */
export function scanBodyCopy(text: string): ComplianceIssue[] {
  const issues: ComplianceIssue[] = [];
  const t = (text || "").trim();
  if (!t.startsWith(ACCREDITED_PREFIX)) {
    issues.push({
      severity: "blocking",
      code: "missing_accredited_prefix",
      message: `Primary text must begin exactly with "${ACCREDITED_PREFIX}"`,
    });
  }
  for (const { pattern, reason } of FORBIDDEN_PATTERNS) {
    if (pattern.test(t)) {
      issues.push({ severity: "blocking", code: "forbidden_claim", message: reason });
    }
  }
  return issues;
}

export function ensureAccreditedPrefix(text: string): string {
  const t = (text || "").trim();
  if (t.startsWith(ACCREDITED_PREFIX)) return text;
  return `${ACCREDITED_PREFIX} ${t}`.trim();
}

/**
 * Returns blocking issues for the given exemption. 506(b) blocks public Meta
 * ads unless a documented compliance approval exists.
 */
export function checkExemptionForPublicAds(
  exemption: Exemption,
  complianceApprovalId?: string | null,
): ComplianceIssue[] {
  const issues: ComplianceIssue[] = [];
  if (!exemption) {
    issues.push({
      severity: "blocking",
      code: "missing_exemption",
      message: "Select the offering exemption (506(c), 506(b), or other).",
    });
    return issues;
  }
  if (exemption === "506b" && !complianceApprovalId) {
    issues.push({
      severity: "blocking",
      code: "506b_public_ads_blocked",
      message:
        "Rule 506(b) prohibits general solicitation. Public Meta ads are blocked without a documented compliance override.",
    });
  }
  if (exemption === "other" && !complianceApprovalId) {
    issues.push({
      severity: "warning",
      code: "other_exemption_requires_review",
      message: "Exemption 'Other' requires compliance review before launch.",
    });
  }
  return issues;
}

/**
 * Combine issue lists.
 */
export function collectIssues(...groups: ComplianceIssue[][]): ComplianceIssue[] {
  return groups.flat();
}

export function hasBlocking(issues: ComplianceIssue[]): boolean {
  return issues.some((i) => i.severity === "blocking");
}

/**
 * Append disclosure if it isn't already at the tail.
 */
export function withDisclosure(text: string, disclosure = DEFAULT_DISCLOSURE): string {
  const t = (text || "").trim();
  if (!t) return disclosure;
  if (t.includes(disclosure.slice(0, 40))) return text;
  return `${t}\n\n${disclosure}`;
}

// Simple UUID-ish key for idempotent launches.
export function makeIdempotencyKey(prefix = "launch"): string {
  const rand = crypto.getRandomValues(new Uint8Array(8));
  const hex = Array.from(rand).map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${prefix}_${Date.now().toString(36)}_${hex}`;
}