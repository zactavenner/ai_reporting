// Performance health classification used across ads manager tables.
export type AdHealth = "winner" | "underperforming" | "learning" | "neutral";

export function calcRoas(row: any): number {
  const spend = Number(row?.spend) || 0;
  const dollars = Number(row?.attributed_funded_dollars) || 0;
  return spend > 0 ? dollars / spend : 0;
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