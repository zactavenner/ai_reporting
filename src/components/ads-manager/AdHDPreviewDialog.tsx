import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ExternalLink, Download } from 'lucide-react';

interface Ad {
  id: string;
  name: string;
  headline?: string | null;
  body?: string | null;
  link_url?: string | null;
  call_to_action_type?: string | null;
  preview_url?: string | null;
  thumbnail_url?: string | null;
  image_url?: string | null;
  full_image_url?: string | null;
  video_thumbnail_url?: string | null;
  video_source_url?: string | null;
  media_type?: string | null;
  spend?: number;
  impressions?: number;
  clicks?: number;
  ctr?: number;
  cpc?: number;
  attributed_leads?: number;
  meta_reported_leads?: number;
  meta_reported_conversions?: number;
  meta_reported_conversion_value?: number;
  attributed_calls?: number;
  cost_per_call?: number;
  attributed_showed?: number;
  attributed_funded?: number;
  cost_per_funded?: number;
  attributed_funded_dollars?: number;
  cost_per_lead?: number;
}

interface Props {
  ad: Ad | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

const fmt$ = (v: number | null | undefined) => !v ? '$0' : `$${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtN = (v: number | null | undefined) => !v ? '0' : Number(v).toLocaleString();

export function AdHDPreviewDialog({ ad, open, onOpenChange }: Props) {
  if (!ad) return null;

  const isVideo = ad.media_type === 'video' || !!ad.video_source_url;
  const heroImage = ad.full_image_url || ad.image_url || ad.video_thumbnail_url || ad.thumbnail_url;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[92vh] overflow-y-auto p-0">
        <DialogHeader className="px-6 pt-6">
          <DialogTitle className="truncate pr-8">{ad.name}</DialogTitle>
        </DialogHeader>
        <div className="grid md:grid-cols-2 gap-0">
          <div className="bg-black flex items-center justify-center p-2 md:sticky md:top-0 md:max-h-[88vh] overflow-hidden">
            {isVideo && ad.video_source_url ? (
              <video
                src={ad.video_source_url}
                poster={ad.video_thumbnail_url || ad.thumbnail_url || undefined}
                controls
                autoPlay
                className="max-h-[80vh] max-w-full"
              />
            ) : heroImage ? (
              <img src={heroImage} alt={ad.name} className="max-h-[80vh] max-w-full object-contain" />
            ) : (
              <div className="text-muted-foreground text-sm">No preview available</div>
            )}
          </div>

          <div className="px-6 pb-6 pt-2 space-y-4">
            <div className="flex items-center gap-2 flex-wrap">
              {ad.preview_url && (
                <a href={ad.preview_url} target="_blank" rel="noopener noreferrer">
                  <Button size="sm" variant="outline" className="gap-1">
                    <ExternalLink className="h-3 w-3" />Meta preview
                  </Button>
                </a>
              )}
              {(ad.video_source_url || ad.full_image_url) && (
                <a href={ad.video_source_url || ad.full_image_url || ''} download target="_blank" rel="noopener noreferrer">
                  <Button size="sm" variant="outline" className="gap-1">
                    <Download className="h-3 w-3" />Download HD
                  </Button>
                </a>
              )}
            </div>

            <div className="space-y-2">
              <h4 className="text-xs font-semibold uppercase text-muted-foreground tracking-wide">Copy</h4>
              {ad.headline && <p className="text-sm font-semibold">{ad.headline}</p>}
              {ad.body && <p className="text-sm whitespace-pre-wrap text-foreground/85">{ad.body}</p>}
              {ad.link_url && <p className="text-xs text-muted-foreground truncate">→ {ad.link_url}</p>}
              {ad.call_to_action_type && (
                <Badge variant="secondary" className="text-[10px]">{ad.call_to_action_type.replace(/_/g, ' ')}</Badge>
              )}
            </div>

            <div className="space-y-2">
              <h4 className="text-xs font-semibold uppercase text-muted-foreground tracking-wide">Performance</h4>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <Stat label="Spend" value={fmt$(ad.spend)} />
                <Stat label="Impressions" value={fmtN(ad.impressions)} />
                <Stat label="Clicks" value={fmtN(ad.clicks)} />
                <Stat label="CTR" value={ad.ctr ? `${Number(ad.ctr).toFixed(2)}%` : '0%'} />
                <Stat label="CPC" value={fmt$(ad.cpc)} />
              </div>
            </div>

            <div className="space-y-2">
              <h4 className="text-xs font-semibold uppercase text-muted-foreground tracking-wide">Conversions</h4>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <Stat label="Meta-reported leads" value={fmtN(ad.meta_reported_leads)} highlight />
                <Stat label="CRM attributed leads" value={fmtN(ad.attributed_leads)} highlight />
                <Stat label="Cost / Lead (Meta)" value={(() => {
                   const leads = Number(ad.meta_reported_leads || 0);
                   const spend = Number(ad.spend || 0);
                   const cpl = leads > 0 ? spend / leads : 0;
                   return cpl > 0 ? fmt$(cpl) : '—';
                 })()} highlight />
                <Stat label="Cost / Lead (CRM)" value={(() => {
                   const leads = Number(ad.attributed_leads || 0);
                   const spend = Number(ad.spend || 0);
                   const cpl = leads > 0 ? spend / leads : 0;
                   return cpl > 0 ? fmt$(cpl) : '—';
                 })()} />
                <Stat label="Calls booked" value={fmtN(ad.attributed_calls)} />
                <Stat label="Cost / Call" value={(() => {
                  const calls = Number(ad.attributed_calls || 0);
                  const spend = Number(ad.spend || 0);
                  const cpc = ad.cost_per_call && Number(ad.cost_per_call) > 0 ? Number(ad.cost_per_call) : (calls > 0 ? spend / calls : 0);
                  return cpc > 0 ? fmt$(cpc) : '—';
                })()} />
                <Stat label="Calls showed" value={fmtN(ad.attributed_showed)} />
                <Stat label="Funded investors" value={fmtN(ad.attributed_funded)} highlight />
                <Stat label="Cost / Funded" value={(() => {
                  const funded = Number(ad.attributed_funded || 0);
                  const spend = Number(ad.spend || 0);
                  const cpf = ad.cost_per_funded && Number(ad.cost_per_funded) > 0 ? Number(ad.cost_per_funded) : (funded > 0 ? spend / funded : 0);
                  return cpf > 0 ? fmt$(cpf) : '—';
                })()} highlight />
                <Stat label="Funded $" value={fmt$(ad.attributed_funded_dollars)} />
                <Stat label="Meta conversions" value={fmtN(ad.meta_reported_conversions)} />
                <Stat label="Meta value" value={fmt$(ad.meta_reported_conversion_value)} />
              </div>
              <p className="text-[10px] text-muted-foreground italic">
                Full funnel: Meta pixel data vs your CRM-attributed leads, calls, and funded investors.
              </p>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`rounded-md border border-border/50 px-2 py-1.5 ${highlight ? 'bg-primary/5' : 'bg-muted/30'}`}>
      <div className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</div>
      <div className="text-sm font-semibold tabular-nums">{value}</div>
    </div>
  );
}
