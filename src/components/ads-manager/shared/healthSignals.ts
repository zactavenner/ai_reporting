// Performance health classification used across ads manager tables.
export type AdHealth = "winner" | "underperforming" | "learning" | "neutral";

export function calcRoas(row: any): number {
  const spend = Number(row?.spend) || 0;
  const dollars = Number(row?.attributed_funded_dollars) || 0;
  return spend > 0 ? dollars / spend : 0;
}

// Unified "winner" definition used by chips, badges, and task priority.
// Aligns with getAdHealth("winner") so signals never disagree.
export function isWinningAd(row: any): boolean {
  return getAdHealth(row) === "winner";
}

// Attribution-quality % — how much CRM attribution covers Meta's own
// reported lead count for the row. 100 = perfect coverage. null when
// Meta has no reported leads (nothing to compare against).
export function attributionQualityPct(row: any): number | null {
  const metaLeads = Number(row?.meta_reported_leads) || 0;
  if (metaLeads <= 0) return null;
  const crmLeads = Number(row?.attributed_leads) || 0;
  return Math.min(999, (crmLeads / metaLeads) * 100);
}

// Creative-fatigue classification by Meta frequency value.
// none < 2.5, watch 2.5–3.5, warn 3.5–4.5, fatigued ≥ 4.5.
export type FatigueLevel = "none" | "watch" | "warn" | "fatigued";
export function fatigueLevel(frequency: number | null | undefined): FatigueLevel {
  const f = Number(frequency) || 0;
  if (f >= 4.5) return "fatigued";
  if (f >= 3.5) return "warn";
  if (f >= 2.5) return "watch";
  return "none";
}

export function getAdHealth(row: any): AdHealth {
  const spend = Number(row?.spend) || 0;
  const ctr = Number(row?.ctr) || 0;
  const funded = Number(row?.attributed_funded) || 0;
  const created = row?.created_time || row?.synced_at;
  const ageDays = created ? (Date.now() - new Date(created).getTime()) / (1000 * 60 * 60 * 24) : 0;
  const roas = calcRoas(row);

  if (spend < 50 || ageDays < 3) return "learning";
  if (roas > 3 || (spend > 1000 && ctr > 1 && funded > 0)) return "winner";
  if (spend > 500 && funded === 0 && ageDays > 7) return "underperforming";
  return "neutral";
}

export const HEALTH_LABEL: Record<AdHealth, string> = {
  winner: "Winner",
  underperforming: "Underperforming",
  learning: "Learning",
  neutral: "Steady",
};