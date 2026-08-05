/**
 * Deterministic lead quality scoring (1–10).
 *
 * The exact same rule table lives in
 * `supabase/functions/_shared/leadQuality.ts` so the nightly scorer that
 * writes `leads.quality_score` and the UI that explains a score can never
 * disagree. If you change one, change both.
 */

export interface LeadQualitySignals {
  is_spam?: boolean | null;
  email?: string | null;
  phone?: string | null;
  questions?: any;
  disposition?: string | null;
  booked?: boolean;
  showed?: boolean;
  funded?: boolean;
  enrichment?: {
    is_investor?: boolean | null;
    owns_investments?: boolean | null;
    accredited_probability?: number | null;
    net_worth_midpoint?: number | null;
    household_income_midpoint?: number | null;
    investor_score?: number | null;
  } | null;
}

export interface LeadQualityResult {
  score: number;
  reasons: { label: string; points: number }[];
  statedLow: number;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

function validEmail(v?: string | null) {
  return !!v && EMAIL_RE.test(v.trim());
}
function validPhone(v?: string | null) {
  const digits = String(v || '').replace(/\D/g, '');
  return digits.length >= 10;
}

/** Lowest dollar figure mentioned in an answer like "$50k – $100k". */
export function parseLowestDollarAmount(answer: string): number {
  const matches = String(answer).match(/\$?\s?([\d,.]+)\s?([kmKM])?/g) || [];
  let low = 0;
  for (const raw of matches) {
    const m = raw.match(/([\d,.]+)\s?([kmKM])?/);
    if (!m) continue;
    let n = Number(m[1].replace(/,/g, ''));
    if (!isFinite(n) || n <= 0) continue;
    const suffix = (m[2] || '').toLowerCase();
    if (suffix === 'k') n *= 1_000;
    if (suffix === 'm') n *= 1_000_000;
    if (n < 1000) continue;
    if (low === 0 || n < low) low = n;
  }
  return low;
}

function statedInvestmentLow(questions: any): number {
  if (!Array.isArray(questions)) return 0;
  let low = 0;
  for (const q of questions) {
    const question = String(q?.question || '');
    const answer = String(q?.answer || '').trim();
    if (!answer) continue;
    if (!/investment range|amount.*invest|ready to invest|how much.*invest|capital.*deploy/i.test(question)) continue;
    const n = parseLowestDollarAmount(answer);
    if (n > 0 && (low === 0 || n < low)) low = n;
  }
  return low;
}

const BAD_DISPOSITIONS = new Set(['bad_lead', 'bad_contact_info', 'unqualified', 'not_accredited', 'spam']);

export function scoreLead(signals: LeadQualitySignals): LeadQualityResult {
  const reasons: { label: string; points: number }[] = [];
  const add = (label: string, points: number) => {
    if (points !== 0) reasons.push({ label, points });
  };

  const statedLow = statedInvestmentLow(signals.questions);

  if (signals.is_spam) {
    return { score: 1, reasons: [{ label: 'Flagged as spam', points: 0 }], statedLow };
  }

  let points = 1;

  const hasEmail = validEmail(signals.email);
  const hasPhone = validPhone(signals.phone);
  if (hasEmail) { points += 1; add('Valid email', 1); }
  if (hasPhone) { points += 1; add('Valid phone', 1); }
  if (!hasEmail && !hasPhone) add('No reachable contact info', 0);

  if (statedLow >= 250_000) { points += 2.5; add('Stated $250k+ investment range', 2.5); }
  else if (statedLow >= 100_000) { points += 2; add('Stated $100k+ investment range', 2); }
  else if (statedLow >= 50_000) { points += 1.5; add('Stated $50k+ investment range', 1.5); }
  else if (statedLow > 0) { points += 0.5; add('Stated investment range', 0.5); }

  const e = signals.enrichment;
  if (e) {
    if (e.is_investor) { points += 1; add('Enrichment: known investor', 1); }
    if (e.owns_investments) { points += 0.5; add('Enrichment: owns investments', 0.5); }
    if ((e.accredited_probability ?? 0) >= 0.5) { points += 1; add('Enrichment: likely accredited', 1); }
    if ((e.net_worth_midpoint ?? 0) >= 1_000_000) { points += 1.5; add('Enrichment: $1M+ net worth', 1.5); }
    else if ((e.net_worth_midpoint ?? 0) >= 500_000) { points += 0.75; add('Enrichment: $500k+ net worth', 0.75); }
    if ((e.household_income_midpoint ?? 0) >= 250_000) { points += 0.5; add('Enrichment: $250k+ household income', 0.5); }
  } else {
    add('Not enriched yet', 0);
  }

  if (signals.booked) { points += 1; add('Discovery call booked', 1); }
  if (signals.showed) { points += 1.5; add('Showed for call', 1.5); }
  if (signals.funded) { points += 3; add('Funded investor', 3); }

  const disposition = (signals.disposition || '').toLowerCase();
  let score = Math.max(1, Math.min(10, Math.round(points)));
  if (BAD_DISPOSITIONS.has(disposition)) {
    score = Math.min(score, 2);
    add(`Disposition: ${disposition.replace(/_/g, ' ')}`, 0);
  }
  if (signals.funded) score = Math.max(score, 9);

  return { score, reasons, statedLow };
}

export function qualityTone(score: number): string {
  if (score >= 8) return 'bg-emerald-500/15 text-emerald-600 border-emerald-500/30';
  if (score >= 6) return 'bg-primary/15 text-primary border-primary/30';
  if (score >= 4) return 'bg-amber-500/15 text-amber-600 border-amber-500/30';
  return 'bg-destructive/10 text-destructive border-destructive/30';
}
