import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Play, TrendingUp } from 'lucide-react';

interface Props {
  clientId: string;
  from: string; // yyyy-MM-dd
  to: string;   // yyyy-MM-dd
}

interface TopAd {
  id: string;
  name: string | null;
  headline: string | null;
  body: string | null;
  media_type: string | null;
  thumbnail_url: string | null;
  image_url: string | null;
  full_image_url: string | null;
  video_thumbnail_url: string | null;
  video_source_url: string | null;
  preview_url: string | null;
  spend: number | null;
  impressions: number | null;
  clicks: number | null;
  ctr: number | null;
  attributed_leads: number | null;
  meta_reported_leads: number | null;
  cost_per_lead: number | null;
}

const fmtMoney = (n: number | null | undefined) =>
  n == null ? '—' : Number(n).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const fmtInt = (n: number | null | undefined) =>
  n == null ? '—' : Math.round(Number(n)).toLocaleString('en-US');
const fmtPct = (n: number | null | undefined) =>
  n == null ? '—' : `${Number(n).toFixed(2)}%`;

export function TopCreativeCard({ clientId, from, to }: Props) {
  const { data: adsData, isLoading } = useQuery({
    queryKey: ['top-creative', clientId, from, to],
    queryFn: async () => {
      // 1. Aggregate per-day Meta insights for the selected range so the
      //    "top creatives" reflect actual performance in that window, not the
      //    lifetime snapshot on meta_ads.
      const { data: daily, error: dailyErr } = await supabase
        .from('meta_ad_daily_insights')
        .select('meta_ad_id,spend,impressions,clicks,leads')
        .eq('client_id', clientId)
        .gte('date', from)
        .lte('date', to);
      if (dailyErr) throw dailyErr;

      const agg = new Map<string, { spend: number; impressions: number; clicks: number; leads: number }>();
      for (const r of daily || []) {
        const key = (r as any).meta_ad_id as string;
        if (!key) continue;
        const g = agg.get(key) || { spend: 0, impressions: 0, clicks: 0, leads: 0 };
        g.spend += Number((r as any).spend) || 0;
        g.impressions += Number((r as any).impressions) || 0;
        g.clicks += Number((r as any).clicks) || 0;
        g.leads += Number((r as any).leads) || 0;
        agg.set(key, g);
      }
      const topIds = Array.from(agg.entries())
        .filter(([, g]) => g.spend > 0)
        .sort(([, a], [, b]) => (b.leads - a.leads) || (b.spend - a.spend))
        .slice(0, 3)
        .map(([id]) => id);
      if (topIds.length === 0) {
        const { data: fallback, error: fallbackErr } = await supabase
          .from('meta_ads')
          .select('id,meta_ad_id,name,headline,body,media_type,thumbnail_url,image_url,full_image_url,video_thumbnail_url,video_source_url,preview_url,spend,impressions,clicks,ctr,meta_reported_leads')
          .eq('client_id', clientId)
          .gt('spend', 0)
          .order('meta_reported_leads', { ascending: false })
          .order('spend', { ascending: false })
          .limit(3);
        if (fallbackErr) throw fallbackErr;
        return (fallback || []).map((ad: any) => ({
          ...ad,
          attributed_leads: null,
          cost_per_lead: (Number(ad.meta_reported_leads) || 0) > 0
            ? (Number(ad.spend) || 0) / (Number(ad.meta_reported_leads) || 0)
            : 0,
        })) as TopAd[];
      }

      // 2. Load creative metadata for those ads.
      const { data: meta, error: metaErr } = await supabase
        .from('meta_ads')
        .select('id,meta_ad_id,name,headline,body,media_type,thumbnail_url,image_url,full_image_url,video_thumbnail_url,video_source_url,preview_url')
        .eq('client_id', clientId)
        .in('meta_ad_id', topIds);
      if (metaErr) throw metaErr;

      // 3. Merge — metrics come from the aggregated daily insights.
      const merged: TopAd[] = topIds
        .map((mid) => {
          const base = (meta || []).find((m: any) => m.meta_ad_id === mid);
          if (!base) return null;
          const g = agg.get(mid)!;
          const ctr = g.impressions > 0 ? (g.clicks / g.impressions) * 100 : 0;
          const cpl = g.leads > 0 ? g.spend / g.leads : 0;
          return {
            ...(base as any),
            spend: g.spend,
            impressions: g.impressions,
            clicks: g.clicks,
            ctr,
            meta_reported_leads: g.leads,
            attributed_leads: null,
            cost_per_lead: cpl,
          } as TopAd;
        })
        .filter(Boolean) as TopAd[];
      return merged;
    },
    enabled: !!clientId,
    staleTime: 5 * 60 * 1000,
  });

  const ads = Array.isArray(adsData) ? adsData : [];

  if (isLoading || ads.length === 0) return null;

  const visible = ads.filter((a) => {
    const isVideo = a.media_type === 'video' && !!a.video_source_url;
    const posterImg = a.video_thumbnail_url || a.full_image_url || a.image_url || a.thumbnail_url || null;
    return isVideo || posterImg;
  });
  if (visible.length === 0) return null;

  return (
    <Card className="p-5 rounded-2xl border-border/60 bg-card/60 backdrop-blur">
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground font-semibold">Top Performing Creatives</p>
          <h3 className="text-base font-semibold mt-0.5" style={{ fontFamily: 'Playfair Display, Georgia, serif' }}>
            Ranked by Meta lead-form submissions
          </h3>
        </div>
        <Badge variant="secondary" className="gap-1">
          <TrendingUp className="h-3 w-3" />
          Top {visible.length}
        </Badge>
      </div>

      <div className="space-y-4">
        {visible.map((ad, idx) => (
          <CreativeRow key={ad.id} ad={ad} rank={idx + 1} />
        ))}
      </div>
      <p className="text-[10px] text-muted-foreground italic mt-4">
        Leads &amp; CPL reflect Meta lead-form submissions (true source-of-truth from Facebook).
      </p>
    </Card>
  );
}

function CreativeRow({ ad, rank }: { ad: TopAd; rank: number }) {
  const isVideo = ad.media_type === 'video' && !!ad.video_source_url;
  const posterImg =
    ad.video_thumbnail_url ||
    ad.full_image_url ||
    ad.image_url ||
    ad.thumbnail_url ||
    null;
  const spend = Number(ad.spend || 0);
  const trueLeads = Number(ad.meta_reported_leads || 0) || Number(ad.attributed_leads || 0);
  const trueCpl = trueLeads > 0 ? spend / trueLeads : 0;

  return (
    <div className="grid grid-cols-1 md:grid-cols-[minmax(0,200px)_1fr] gap-4 items-start pb-4 border-b border-border/40 last:border-b-0 last:pb-0">
      <div className="relative rounded-xl overflow-hidden bg-muted aspect-square w-full max-w-[200px]">
        <div className="absolute top-2 left-2 z-10 bg-primary text-primary-foreground text-[10px] font-bold rounded-full h-6 w-6 flex items-center justify-center shadow">
          #{rank}
        </div>
        {posterImg && (
          <img
            src={posterImg}
            alt={ad.name || 'Top creative'}
            crossOrigin="anonymous"
            className="absolute inset-0 w-full h-full object-cover"
          />
        )}
        {isVideo && (
          <video
            data-html2canvas-ignore="true"
            src={ad.video_source_url!}
            poster={posterImg || undefined}
            controls
            playsInline
            preload="metadata"
            className="absolute inset-0 w-full h-full object-cover bg-black"
          />
        )}
        {isVideo && !posterImg && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="bg-white/90 rounded-full p-3">
              <Play className="h-5 w-5 text-black fill-black" />
            </div>
          </div>
        )}
      </div>

      <div className="space-y-3 min-w-0">
        <div className="space-y-1">
          <p className="text-sm font-semibold leading-snug truncate">{ad.name || 'Untitled Ad'}</p>
          {ad.headline && <p className="text-xs text-foreground/80 leading-snug">{ad.headline}</p>}
          {ad.body && (
            <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2 whitespace-pre-wrap">
              {ad.body}
            </p>
          )}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          <Stat label="Spend" value={fmtMoney(spend)} />
          <Stat label="Leads (Meta)" value={fmtInt(trueLeads)} highlight />
          <Stat label="True CPL" value={trueLeads > 0 ? fmtMoney(trueCpl) : '—'} highlight />
          <Stat label="Impressions" value={fmtInt(ad.impressions)} />
          <Stat label="Clicks" value={fmtInt(ad.clicks)} />
          <Stat label="CTR" value={fmtPct(ad.ctr)} />
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="rounded-xl bg-muted/40 border border-border/50 px-3 py-2">
      <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground font-semibold">{label}</p>
      <p className={`text-sm tabular-nums mt-0.5 ${highlight ? 'font-semibold text-primary' : 'font-medium'}`}>{value}</p>
    </div>
  );
}