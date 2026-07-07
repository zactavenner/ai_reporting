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
  cost_per_lead: number | null;
}

const fmtMoney = (n: number | null | undefined) =>
  n == null ? '—' : Number(n).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const fmtInt = (n: number | null | undefined) =>
  n == null ? '—' : Math.round(Number(n)).toLocaleString('en-US');
const fmtPct = (n: number | null | undefined) =>
  n == null ? '—' : `${Number(n).toFixed(2)}%`;

export function TopCreativeCard({ clientId, from, to }: Props) {
  const { data: ad, isLoading } = useQuery({
    queryKey: ['top-creative', clientId, from, to],
    queryFn: async () => {
      // Pull ads active in the range with recorded spend, rank by leads then spend.
      const { data, error } = await supabase
        .from('meta_ads')
        .select('id,name,headline,body,media_type,thumbnail_url,image_url,full_image_url,video_thumbnail_url,video_source_url,preview_url,spend,impressions,clicks,ctr,attributed_leads,cost_per_lead,synced_at')
        .eq('client_id', clientId)
        .gt('spend', 0)
        .order('attributed_leads', { ascending: false, nullsFirst: false })
        .order('spend', { ascending: false })
        .limit(1);
      if (error) throw error;
      return (data?.[0] || null) as TopAd | null;
    },
    enabled: !!clientId,
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading || !ad) return null;

  const isVideo = ad.media_type === 'video' && !!ad.video_source_url;
  const posterImg =
    ad.video_thumbnail_url ||
    ad.full_image_url ||
    ad.image_url ||
    ad.thumbnail_url ||
    null;

  if (!posterImg && !isVideo) return null;

  return (
    <Card className="p-5 rounded-2xl border-border/60 bg-card/60 backdrop-blur">
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground font-semibold">Top Performing Creative</p>
          <h3 className="text-base font-semibold mt-0.5" style={{ fontFamily: 'Playfair Display, Georgia, serif' }}>
            {ad.name || 'Best Performing Ad'}
          </h3>
        </div>
        <Badge variant="secondary" className="gap-1">
          <TrendingUp className="h-3 w-3" />
          Best in range
        </Badge>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[minmax(0,240px)_1fr] gap-5 items-start">
        {/* Media — video plays on screen; poster image is captured for the PDF snapshot. */}
        <div className="relative rounded-xl overflow-hidden bg-muted aspect-square w-full max-w-[240px]">
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
              // Hidden from html2canvas — the poster <img> beneath is captured for the PDF.
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
          {(ad.headline || ad.body) && (
            <div className="space-y-1">
              {ad.headline && <p className="text-sm font-semibold leading-snug">{ad.headline}</p>}
              {ad.body && (
                <p className="text-xs text-muted-foreground leading-relaxed line-clamp-4 whitespace-pre-wrap">
                  {ad.body}
                </p>
              )}
            </div>
          )}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            <Stat label="Spend" value={fmtMoney(ad.spend)} />
            <Stat label="Leads" value={fmtInt(ad.attributed_leads)} />
            <Stat label="CPL" value={fmtMoney(ad.cost_per_lead)} highlight />
            <Stat label="Impressions" value={fmtInt(ad.impressions)} />
            <Stat label="Clicks" value={fmtInt(ad.clicks)} />
            <Stat label="CTR" value={fmtPct(ad.ctr)} />
          </div>
        </div>
      </div>
    </Card>
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