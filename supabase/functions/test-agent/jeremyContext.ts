// Pure context builder for the Utari Persona (Jeremy AI) branch of test-agent.
// Extracted so it can be unit-tested: the contract is that the FULL client +
// offer context is re-sent on EVERY turn (the MCP conversation is long-lived
// and offers change over time), each offer stamped with its own
// created/updated timestamps so Jeremy knows which version is most recent.

export type JeremyOffer = Record<string, any>;

export type JeremyContextInput = {
  clientName?: string | null;
  brain?: { voice?: string | null; icp?: string | null; brand_guidelines?: string | null; do_not_say?: string | null } | null;
  offers?: JeremyOffer[] | null;
  clientId?: string | null;
  now?: Date;
};

function fmt(ts: any): string | null {
  if (!ts) return null;
  const d = new Date(ts);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().replace(".000", "");
}

export function buildJeremyContextLines(input: JeremyContextInput): string[] {
  const { clientName, brain, clientId } = input;
  const offers = input.offers || [];
  const lines: string[] = [];
  const now = input.now || new Date();
  lines.push(`Context timestamp (UTC): ${now.toISOString()}`);
  if (clientName) lines.push(`Client in scope: ${clientName}`);
  if (brain?.voice) lines.push(`Brand voice: ${brain.voice}`);
  if (brain?.icp) lines.push(`ICP: ${brain.icp}`);
  if (brain?.brand_guidelines) lines.push(`Brand guidelines: ${brain.brand_guidelines}`);
  if (brain?.do_not_say) lines.push(`Do NOT say: ${brain.do_not_say}`);

  if (offers.length) {
    // Newest first so the most recent offer version is what Jeremy reads first.
    const sorted = [...offers].sort((a, b) => {
      const av = new Date(a.updated_at || a.created_at || 0).getTime();
      const bv = new Date(b.updated_at || b.created_at || 0).getTime();
      return bv - av;
    });
    lines.push(`Active offer(s) — newest first, treat the first entry as the current source of truth:`);
    sorted.forEach((o, i) => {
      const updated = fmt(o.updated_at);
      const created = fmt(o.created_at);
      const bits = [
        i === 0 && (updated || created) && `MOST RECENT`,
        updated && `Last updated: ${updated}`,
        created && `Created: ${created}`,
        o.title && `Title: ${o.title}`,
        o.offer_type && `Offer type: ${o.offer_type}`,
        o.fund_name && `Fund: ${o.fund_name}`,
        o.fund_type && `Type: ${o.fund_type}`,
        o.raise_amount && `Raise: ${o.raise_amount}`,
        o.target_investor && `Target investor: ${o.target_investor}`,
        o.targeted_returns && `Targeted returns: ${o.targeted_returns}`,
        o.min_investment && `Min investment: ${o.min_investment}`,
        o.investment_range && `Investment range: ${o.investment_range}`,
        o.hold_period && `Hold: ${o.hold_period}`,
        o.distribution_schedule && `Distributions: ${o.distribution_schedule}`,
        o.tax_advantages && `Tax advantages: ${o.tax_advantages}`,
        o.credibility && `Credibility: ${o.credibility}`,
        o.timeline && `Timeline: ${o.timeline}`,
        o.accredited_only != null && `Accredited only: ${o.accredited_only ? "yes" : "no"}`,
        o.reg_d_type && `Reg D: ${o.reg_d_type}`,
        o.industry_focus && `Industry: ${o.industry_focus}`,
        o.status && `Status: ${o.status}`,
        o.description && `Description: ${o.description}`,
        o.additional_notes && `Notes: ${o.additional_notes}`,
      ].filter(Boolean).join(" | ");
      if (bits) lines.push(`- ${bits}`);
    });
  } else if (clientId) {
    lines.push(`No offer is configured for this client yet — ask for the offer details before making offer-specific recommendations.`);
  }
  return lines;
}

/** Wraps the last user message with the full context block. Called on every turn. */
export function buildJeremyOutbound(lastUser: string, input: JeremyContextInput): string {
  const lines = buildJeremyContextLines(input);
  const block = lines.length
    ? `[CONTEXT — refreshed this turn, use this to ground your reply]\n${lines.join("\n")}\n\n[MESSAGE]\n`
    : "";
  return `${block}${lastUser}`;
}
