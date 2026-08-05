import { useQuery } from '@tanstack/react-query';
import { format, subDays } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { scoreLead, type LeadQualityResult } from '@/lib/leadQuality';

export interface WeeklyWindowMetrics {
  adSpend: number;
  leads: number;
  validLeads: number;
  spamLeads: number;
  discoveryCalls: number;
  reconnectCalls: number;
  showedCalls: number;
  commitments: number;
  commitmentDollars: number;
  fundedInvestors: number;
  fundedDollars: number;
}

export interface WeeklyLeadRow {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  createdAt: string;
  source: string | null;
  campaign: string | null;
  disposition: string | null;
  isSpam: boolean;
  booked: boolean;
  showed: boolean;
  funded: boolean;
  score: number;
  storedScore: number | null;
  reasons: LeadQualityResult['reasons'];
  statedLow: number;
}

export interface WeeklyFreshness {
  lastSpendDay: string | null;
  lastCrmSync: string | null;
  lastSheetWrite: string | null;
  lastSheetStatus: string | null;
  spendDaysStale: number | null;
  openDiscrepancies: number;
}

export interface WeeklyReportData {
  current: WeeklyWindowMetrics;
  prior: WeeklyWindowMetrics;
  leads: WeeklyLeadRow[];
  dispositionMix: [string, number][];
  freshness: WeeklyFreshness;
  range: { from: string; to: string };
  priorRange: { from: string; to: string };
}

const EMPTY: WeeklyWindowMetrics = {
  adSpend: 0, leads: 0, validLeads: 0, spamLeads: 0, discoveryCalls: 0,
  reconnectCalls: 0, showedCalls: 0, commitments: 0, commitmentDollars: 0,
  fundedInvestors: 0, fundedDollars: 0,
};

function dayStr(d: Date) { return format(d, 'yyyy-MM-dd'); }

/**
 * Last 7 days (ending yesterday, so no partial day) vs the prior 7 days,
 * merging Meta ad spend with CRM records, plus a scored lead list and a
 * data-freshness read so a stale pipeline can't be reported as fact.
 */
export function useWeeklyReport(clientId: string | undefined) {
  const yesterday = subDays(new Date(), 1);
  const from = dayStr(subDays(yesterday, 6));
  const to = dayStr(yesterday);
  const priorFrom = dayStr(subDays(yesterday, 13));
  const priorTo = dayStr(subDays(yesterday, 7));

  return useQuery<WeeklyReportData>({
    queryKey: ['weekly-report', clientId, from, to],
    enabled: !!clientId,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const startIso = (d: string) => `${d}T00:00:00.000Z`;
      const endIso = (d: string) => `${d}T23:59:59.999Z`;

      const [spendRes, leadRes, callRes, fundedRes, syncRes, discRes] = await Promise.all([
        supabase
          .from('ad_spend_daily')
          .select('date, spend')
          .eq('client_id', clientId!)
          .gte('date', priorFrom)
          .lte('date', to),
        supabase
          .from('leads')
          .select('id, external_id, name, email, phone, created_at, source, campaign_name, is_spam, questions, current_disposition, quality_score')
          .eq('client_id', clientId!)
          .gte('created_at', startIso(priorFrom))
          .lte('created_at', endIso(to))
          .limit(5000),
        supabase
          .from('calls')
          .select('id, lead_id, booked_at, showed, showed_at, is_reconnect')
          .eq('client_id', clientId!)
          .gte('booked_at', startIso(priorFrom))
          .lte('booked_at', endIso(to))
          .limit(5000),
        supabase
          .from('funded_investors')
          .select('id, lead_id, funded_at, funded_amount, commitment_amount')
          .eq('client_id', clientId!)
          .gte('funded_at', startIso(priorFrom))
          .lte('funded_at', endIso(to))
          .limit(2000),
        supabase
          .from('ad_spend_sync_runs')
          .select('sync_date, finished_at, status, sheet_status, sheet_error')
          .eq('client_id', clientId!)
          .order('finished_at', { ascending: false })
          .limit(1),
        supabase
          .from('data_discrepancies')
          .select('id', { count: 'exact', head: true })
          .eq('client_id', clientId!)
          .eq('status', 'open'),
      ]);

      const spendRows = (spendRes.data ?? []) as any[];
      const leadRows = (leadRes.data ?? []) as any[];
      const callRows = (callRes.data ?? []) as any[];
      const fundedRows = (fundedRes.data ?? []) as any[];

      // Enrichment for scoring
      const externalIds = leadRows.map((l) => l.external_id).filter(Boolean);
      const enrichment = new Map<string, any>();
      if (externalIds.length) {
        const { data: le } = await supabase
          .from('lead_enrichment')
          .select('external_id, is_investor, owns_investments, accredited_probability, net_worth_midpoint, household_income_midpoint, investor_score')
          .eq('client_id', clientId!)
          .in('external_id', externalIds.slice(0, 1000));
        for (const e of (le ?? []) as any[]) if (e.external_id) enrichment.set(e.external_id, e);
      }

      const bookedLeads = new Set<string>();
      const showedLeads = new Set<string>();
      for (const c of callRows) {
        if (!c.lead_id) continue;
        if (!c.is_reconnect) bookedLeads.add(c.lead_id);
        if (c.showed) showedLeads.add(c.lead_id);
      }
      const fundedLeads = new Set<string>(fundedRows.map((f) => f.lead_id).filter(Boolean));

      const inWindow = (value: string | null | undefined, a: string, b: string) => {
        if (!value) return false;
        const d = value.slice(0, 10);
        return d >= a && d <= b;
      };

      const build = (a: string, b: string): WeeklyWindowMetrics => {
        const m: WeeklyWindowMetrics = { ...EMPTY };
        m.adSpend = spendRows
          .filter((r) => inWindow(r.date, a, b))
          .reduce((s, r) => s + Number(r.spend || 0), 0);

        const windowLeads = leadRows.filter((l) => inWindow(l.created_at, a, b));
        m.leads = windowLeads.length;
        m.spamLeads = windowLeads.filter((l) => l.is_spam).length;
        m.validLeads = windowLeads.filter((l) => !l.is_spam && l.email && l.phone).length;

        const windowCalls = callRows.filter((c) => inWindow(c.booked_at, a, b));
        m.discoveryCalls = windowCalls.filter((c) => !c.is_reconnect).length;
        m.reconnectCalls = windowCalls.filter((c) => c.is_reconnect).length;
        m.showedCalls = windowCalls.filter((c) => c.showed).length;

        const windowFunded = fundedRows.filter((f) => inWindow(f.funded_at, a, b));
        const committed = windowFunded.filter((f) => Number(f.commitment_amount || 0) > 0);
        m.commitments = committed.length;
        m.commitmentDollars = committed.reduce((s, f) => s + Number(f.commitment_amount || 0), 0);
        const actuallyFunded = windowFunded.filter((f) => Number(f.funded_amount || 0) > 0);
        m.fundedInvestors = actuallyFunded.length;
        m.fundedDollars = actuallyFunded.reduce((s, f) => s + Number(f.funded_amount || 0), 0);
        return m;
      };

      const currentLeadRows = leadRows.filter((l) => inWindow(l.created_at, from, to));
      const leads: WeeklyLeadRow[] = currentLeadRows.map((l) => {
        const booked = bookedLeads.has(l.id);
        const showed = showedLeads.has(l.id);
        const funded = fundedLeads.has(l.id);
        const result = scoreLead({
          is_spam: l.is_spam,
          email: l.email,
          phone: l.phone,
          questions: l.questions,
          disposition: l.current_disposition,
          booked,
          showed,
          funded,
          enrichment: l.external_id ? enrichment.get(l.external_id) ?? null : null,
        });
        return {
          id: l.id,
          name: l.name || 'Unnamed lead',
          email: l.email,
          phone: l.phone,
          createdAt: l.created_at,
          source: l.source,
          campaign: l.campaign_name,
          disposition: l.current_disposition,
          isSpam: !!l.is_spam,
          booked, showed, funded,
          score: l.quality_score ?? result.score,
          storedScore: l.quality_score ?? null,
          reasons: result.reasons,
          statedLow: result.statedLow,
        };
      }).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

      const mix = new Map<string, number>();
      for (const l of leads) {
        const key = l.isSpam
          ? 'Spam'
          : l.disposition
            ? l.disposition.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
            : l.email && l.phone ? 'Contactable' : 'Missing Contact';
        mix.set(key, (mix.get(key) || 0) + 1);
      }

      const syncRow = (syncRes.data ?? [])[0] as any | undefined;
      const lastSpendDay = spendRows.length
        ? spendRows.map((r) => String(r.date).slice(0, 10)).sort().slice(-1)[0]
        : null;
      const spendDaysStale = lastSpendDay
        ? Math.round((new Date(`${to}T00:00:00Z`).getTime() - new Date(`${lastSpendDay}T00:00:00Z`).getTime()) / 86_400_000)
        : null;

      return {
        current: build(from, to),
        prior: build(priorFrom, priorTo),
        leads,
        dispositionMix: [...mix.entries()].sort((a, b) => b[1] - a[1]),
        freshness: {
          lastSpendDay,
          lastCrmSync: leadRows.length
            ? leadRows.map((l) => l.created_at).sort().slice(-1)[0]
            : null,
          lastSheetWrite: syncRow?.finished_at ?? null,
          lastSheetStatus: syncRow?.sheet_status ?? syncRow?.status ?? null,
          spendDaysStale,
          openDiscrepancies: discRes.count ?? 0,
        },
        range: { from, to },
        priorRange: { from: priorFrom, to: priorTo },
      };
    },
  });
}
