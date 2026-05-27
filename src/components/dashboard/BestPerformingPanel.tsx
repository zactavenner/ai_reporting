import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Trophy, Target, Image as ImageIcon } from 'lucide-react';

interface TopRow {
  scope: 'campaign' | 'adset' | 'ad';
  entity_id: string;
  meta_id: string;
  name: string;
  client_id: string;
  spend: number;
  leads: number;
  funded: number;
  funded_dollars: number;
  cost_per_lead: number;
  cost_per_funded: number;
  thumbnail_url: string | null;
}

const SCOPE_META: Record<TopRow['scope'], { label: string; icon: typeof Trophy }> = {
  campaign: { label: 'Top Campaign', icon: Trophy },
  adset: { label: 'Top Targeting', icon: Target },
  ad: { label: 'Top Ad', icon: ImageIcon },
};

const fmtUsd = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n || 0);

export function BestPerformingPanel({ clientIds }: { clientIds?: string[] }) {
  const [rows, setRows] = useState<TopRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase.rpc('get_top_performers', {
        p_client_ids: clientIds && clientIds.length ? clientIds : null,
      });
      if (cancelled) return;
      if (error) {
        console.error('get_top_performers error', error);
        setRows([]);
      } else {
        setRows((data || []) as TopRow[]);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [clientIds?.join(',')]);

  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <div>
          <h2 className="text-lg font-bold">Best Performing</h2>
          <p className="text-xs text-muted-foreground">
            Ranked by funded dollars, tiebreak lowest CPL. Lifetime totals across selected clients.
          </p>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {(['campaign', 'adset', 'ad'] as const).map((scope) => {
          const row = rows.find((r) => r.scope === scope);
          const meta = SCOPE_META[scope];
          const Icon = meta.icon;
          return (
            <Card key={scope} className="p-4">
              <div className="flex items-center gap-2 mb-3 text-muted-foreground">
                <Icon className="h-4 w-4" />
                <span className="text-xs uppercase tracking-wide font-medium">{meta.label}</span>
              </div>
              {loading ? (
                <div className="text-sm text-muted-foreground">Loading…</div>
              ) : !row ? (
                <div className="text-sm text-muted-foreground">No data yet</div>
              ) : (
                <>
                  <div className="flex items-start gap-3">
                    {scope === 'ad' && row.thumbnail_url ? (
                      <img
                        src={row.thumbnail_url}
                        alt=""
                        className="w-14 h-14 rounded object-cover flex-shrink-0"
                      />
                    ) : null}
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-sm truncate" title={row.name}>{row.name}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        Spend {fmtUsd(row.spend)} · Leads {row.leads}
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2 mt-3 text-xs">
                    <div>
                      <div className="text-muted-foreground">Funded</div>
                      <div className="font-medium">{fmtUsd(row.funded_dollars)}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">CPL</div>
                      <div className="font-medium">{row.cost_per_lead > 0 ? fmtUsd(row.cost_per_lead) : '—'}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Cost/Funded</div>
                      <div className="font-medium">{row.cost_per_funded > 0 ? fmtUsd(row.cost_per_funded) : '—'}</div>
                    </div>
                  </div>
                </>
              )}
            </Card>
          );
        })}
      </div>
    </section>
  );
}