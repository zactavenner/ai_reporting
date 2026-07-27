import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, ExternalLink, RefreshCw, AlertTriangle, CheckCircle2, PauseCircle, Play } from 'lucide-react';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';

type Launch = {
  id: string;
  client_id: string;
  status: 'pending' | 'in_progress' | 'created_paused' | 'active' | 'failed' | 'partial';
  current_step: string | null;
  meta_campaign_id: string | null;
  meta_adset_ids: string[] | null;
  meta_ad_ids: string[] | null;
  meta_lead_form_id: string | null;
  offering_exemption: string | null;
  error_message: string | null;
  created_at: string;
  activated_at: string | null;
  payload: any;
};

const STATUS_STYLE: Record<Launch['status'], { label: string; className: string; icon: any }> = {
  pending:        { label: 'Pending',       className: 'bg-slate-100 text-slate-700', icon: Loader2 },
  in_progress:    { label: 'In progress',   className: 'bg-blue-100 text-blue-700',   icon: Loader2 },
  created_paused: { label: 'Paused',        className: 'bg-amber-100 text-amber-800', icon: PauseCircle },
  active:         { label: 'Active',        className: 'bg-emerald-100 text-emerald-700', icon: CheckCircle2 },
  failed:         { label: 'Failed',        className: 'bg-red-100 text-red-800',     icon: AlertTriangle },
  partial:        { label: 'Partial',       className: 'bg-orange-100 text-orange-800', icon: AlertTriangle },
};

export function LaunchesTab({ clientId }: { clientId: string }) {
  const [rows, setRows] = useState<Launch[]>([]);
  const [loading, setLoading] = useState(true);
  const [activatingId, setActivatingId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('campaign_launches')
      .select('*')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) toast.error(error.message);
    setRows((data ?? []) as Launch[]);
    setLoading(false);
  };

  useEffect(() => { if (clientId) load(); }, [clientId]);

  const activate = async (r: Launch) => {
    if (!r.meta_campaign_id) return;
    setActivatingId(r.id);
    try {
      const nodeIds = [r.meta_campaign_id, ...(r.meta_adset_ids ?? []), ...(r.meta_ad_ids ?? [])];
      const { data, error } = await supabase.functions.invoke('meta-set-status-by-nodes', {
        body: { clientId, nodeIds, status: 'ACTIVE' },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Activation failed');
      await supabase.from('campaign_launches').update({ status: 'active', activated_at: new Date().toISOString() }).eq('id', r.id);
      toast.success('Activated');
      load();
    } catch (e: any) {
      toast.error(e?.message || 'Activation failed');
    } finally {
      setActivatingId(null);
    }
  };

  const retry = async (r: Launch) => {
    if (!r.payload) { toast.error('No payload stored — cannot retry'); return; }
    toast.info('Retrying launch (idempotent)…');
    try {
      const { data, error } = await supabase.functions.invoke('meta-launch-campaign', { body: r.payload });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Retry failed');
      toast.success('Retry complete');
      load();
    } catch (e: any) {
      toast.error(e?.message || 'Retry failed');
    }
  };

  if (loading) return <div className="p-6 text-center text-xs text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin inline mr-2" />Loading launches…</div>;
  if (!rows.length) return <div className="p-6 text-center text-xs text-muted-foreground">No launches yet. Use "New Campaign" to create one.</div>;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-xs text-muted-foreground">{rows.length} launch{rows.length === 1 ? '' : 'es'} on record</div>
        <Button variant="outline" size="sm" onClick={load} className="h-7 text-[11px]">
          <RefreshCw className="h-3 w-3 mr-1" /> Refresh
        </Button>
      </div>
      {rows.map((r) => {
        const s = STATUS_STYLE[r.status] ?? STATUS_STYLE.pending;
        const Icon = s.icon;
        return (
          <div key={r.id} className="rounded-lg border p-3 bg-card space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <div className="font-medium text-sm truncate">{r.payload?.campaignName || '(unnamed)'}</div>
                  <Badge className={`text-[10px] ${s.className}`}>
                    <Icon className={`h-3 w-3 mr-1 ${r.status === 'in_progress' ? 'animate-spin' : ''}`} />
                    {s.label}
                  </Badge>
                  {r.offering_exemption && (
                    <Badge variant="outline" className="text-[10px]">
                      {r.offering_exemption === '506c' ? '506(c)' : r.offering_exemption === '506b' ? '506(b)' : 'Other'}
                    </Badge>
                  )}
                </div>
                <div className="text-[11px] text-muted-foreground mt-0.5">
                  {formatDistanceToNow(new Date(r.created_at), { addSuffix: true })}
                  {r.current_step && ` · step: ${r.current_step}`}
                  {r.meta_ad_ids?.length ? ` · ${r.meta_ad_ids.length} ad${r.meta_ad_ids.length === 1 ? '' : 's'}` : ''}
                </div>
                {r.error_message && (
                  <div className="mt-1.5 flex items-start gap-1.5 text-[11px] text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-950/20 rounded px-2 py-1">
                    <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                    <span className="break-words">{r.error_message}</span>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {r.meta_campaign_id && (
                  <a href={`https://adsmanager.facebook.com/adsmanager/manage/campaigns?selected_campaign_ids=${r.meta_campaign_id}`}
                    target="_blank" rel="noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline">
                    <ExternalLink className="h-3 w-3" /> Meta
                  </a>
                )}
                {(r.status === 'failed' || r.status === 'partial') && (
                  <Button variant="outline" size="sm" className="h-7 text-[11px]" onClick={() => retry(r)}>
                    <RefreshCw className="h-3 w-3 mr-1" /> Retry
                  </Button>
                )}
                {r.status === 'created_paused' && r.meta_campaign_id && (
                  <Button size="sm" className="h-7 text-[11px]" onClick={() => activate(r)} disabled={activatingId === r.id}>
                    {activatingId === r.id ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Play className="h-3 w-3 mr-1" />}
                    Activate
                  </Button>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}