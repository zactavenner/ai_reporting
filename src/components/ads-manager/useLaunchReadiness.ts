import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export type ReadinessGate = {
  key: string;
  label: string;
  ok: boolean;
  detail: string;
};

export type LaunchReadiness = {
  gates: ReadinessGate[];
  blocking: ReadinessGate[];
  hold: boolean;
  adAccountId: string | null;
  assetsSyncedAt: string | null;
  assetsStale: boolean;
  pagesCount: number;
  pixelsCount: number;
  pendingApproval: {
    id: string;
    title: string;
    summary: string | null;
    created_at: string;
    preview_payload: any;
  } | null;
};

const STALE_MS = 24 * 60 * 60 * 1000;

/**
 * Read-only readiness signals for a client's Meta launch path.
 * Never returns tokens or credentials.
 */
export function useLaunchReadiness(clientId: string | undefined) {
  return useQuery<LaunchReadiness>({
    queryKey: ['launch-readiness', clientId],
    enabled: !!clientId,
    staleTime: 30_000,
    queryFn: async () => {
      const { data: client } = await supabase
        .from('clients')
        .select('meta_ad_account_id')
        .eq('id', clientId!)
        .maybeSingle();

      const adAccountId = client?.meta_ad_account_id
        ? String(client.meta_ad_account_id).replace(/^act_/, '')
        : null;

      let pagesCount = 0;
      let pixelsCount = 0;
      let assetsSyncedAt: string | null = null;
      if (adAccountId) {
        const { data: acct } = await supabase
          .from('meta_ad_accounts')
          .select('pages, pixels, assets_synced_at')
          .eq('ad_account_id', adAccountId)
          .maybeSingle();
        pagesCount = Array.isArray(acct?.pages) ? (acct!.pages as any[]).length : 0;
        pixelsCount = Array.isArray(acct?.pixels) ? (acct!.pixels as any[]).length : 0;
        assetsSyncedAt = (acct?.assets_synced_at as string) || null;
      }

      const assetsStale =
        !assetsSyncedAt || Date.now() - new Date(assetsSyncedAt).getTime() > STALE_MS;

      const { data: offer } = await supabase
        .from('client_offers')
        .select('id, title, fund_type, min_investment, targeted_returns, reg_d_type, accredited_only, status, updated_at')
        .eq('client_id', clientId!)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      const missingOfferFields = offer
        ? (['fund_type', 'min_investment', 'targeted_returns', 'reg_d_type'] as const).filter(
            (f) => !(offer as any)[f],
          )
        : [];

      const { data: approvals } = await supabase
        .from('compliance_approvals')
        .select('id, approver_name, created_at')
        .eq('client_id', clientId!)
        .order('created_at', { ascending: false })
        .limit(1);

      const { count: leadFormCount } = await supabase
        .from('meta_lead_forms')
        .select('id', { count: 'exact', head: true })
        .eq('client_id', clientId!);

      const { data: queueItem } = await supabase
        .from('approval_queue')
        .select('id, title, summary, created_at, preview_payload')
        .eq('client_id', clientId!)
        .eq('queue_type', 'launch')
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      const gates: ReadinessGate[] = [
        {
          key: 'ad_account',
          label: 'Meta ad account mapped',
          ok: !!adAccountId,
          detail: adAccountId ? `act_${adAccountId}` : 'No ad account on the client record',
        },
        {
          key: 'assets_fresh',
          label: 'Account assets pulled in the last 24h',
          ok: !assetsStale,
          detail: assetsSyncedAt
            ? `Last pull ${new Date(assetsSyncedAt).toLocaleString()}`
            : 'No asset pull recorded',
        },
        {
          key: 'page',
          label: 'Facebook Page available',
          ok: pagesCount > 0,
          detail: `${pagesCount} page${pagesCount === 1 ? '' : 's'} cached`,
        },
        {
          key: 'pixel',
          label: 'Pixel available',
          ok: pixelsCount > 0,
          detail: `${pixelsCount} pixel${pixelsCount === 1 ? '' : 's'} cached`,
        },
        {
          key: 'offer',
          label: 'Offer details complete',
          ok: !!offer && missingOfferFields.length === 0,
          detail: !offer
            ? 'No offer record'
            : missingOfferFields.length
              ? `Missing: ${missingOfferFields.join(', ')}`
              : `${offer.title || 'Offer'} — complete`,
        },
        {
          key: 'compliance',
          label: 'Compliance approval on file',
          ok: (approvals?.length || 0) > 0,
          detail: approvals?.length
            ? `Recorded ${new Date(approvals[0].created_at).toLocaleDateString()}`
            : 'No recorded approval',
        },
        {
          key: 'lead_routing',
          label: 'Lead form routing synced',
          ok: (leadFormCount || 0) > 0,
          detail: `${leadFormCount || 0} lead form${(leadFormCount || 0) === 1 ? '' : 's'} synced`,
        },
      ];

      const blocking = gates.filter((g) => !g.ok);

      return {
        gates,
        blocking,
        hold: blocking.length > 0,
        adAccountId,
        assetsSyncedAt,
        assetsStale,
        pagesCount,
        pixelsCount,
        pendingApproval: (queueItem as any) || null,
      };
    },
  });
}
