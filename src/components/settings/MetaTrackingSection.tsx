import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, Target, Eye, EyeOff, CheckCircle2, AlertCircle, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { useQuery, useQueryClient } from '@tanstack/react-query';

interface Props { clientId: string }

export function MetaTrackingSection({ clientId }: Props) {
  const qc = useQueryClient();
  const [pixel, setPixel] = useState('');
  const [token, setToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deriving, setDeriving] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['meta-tracking', clientId],
    queryFn: async () => {
      const [{ data: client }, { count, error: capiErr }, { data: last }] = await Promise.all([
        supabase.from('clients').select('meta_pixel_id, meta_capi_access_token').eq('id', clientId).maybeSingle(),
        supabase.from('capi_events_sent').select('*', { count: 'exact', head: true })
          .eq('client_id', clientId)
          .gte('sent_at', new Date(Date.now() - 7 * 86400_000).toISOString()),
        supabase.from('capi_events_sent').select('sent_at, event_name, success')
          .eq('client_id', clientId).order('sent_at', { ascending: false }).limit(1),
      ]);
      if (capiErr) console.warn('capi count', capiErr);
      return {
        pixel_id: client?.meta_pixel_id ?? '',
        capi_token: client?.meta_capi_access_token ?? '',
        events_7d: count ?? 0,
        last_event: last?.[0] ?? null,
      };
    },
  });

  useEffect(() => {
    if (data) { setPixel(data.pixel_id); setToken(data.capi_token); }
  }, [data?.pixel_id, data?.capi_token]);

  const pixelValid = !pixel || /^\d{15,16}$/.test(pixel.trim());
  const dirty = pixel !== (data?.pixel_id ?? '') || token !== (data?.capi_token ?? '');

  const save = async () => {
    if (!pixelValid) { toast.error('Pixel ID must be 15-16 digits'); return; }
    setSaving(true);
    const { error } = await supabase.from('clients').update({
      meta_pixel_id: pixel.trim() || null,
      meta_capi_access_token: token.trim() || null,
    }).eq('id', clientId);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success('Meta tracking saved');
    qc.invalidateQueries({ queryKey: ['meta-tracking', clientId] });
    qc.invalidateQueries({ queryKey: ['clients'] });
  };

  const autoDerive = async () => {
    setDeriving(true);
    try {
      const { data: res, error } = await supabase.functions.invoke('derive-client-pixels', { body: { client_id: clientId } });
      if (error) throw error;
      const detail = res?.details?.[0];
      if (detail?.action === 'populated') {
        toast.success(`Pixel ${detail.pixel_id} auto-populated from ${detail.source}`);
      } else if (detail?.action === 'ambiguous_queued') {
        toast.info(`Multiple pixels found — queued for approval in /approvals`);
      } else if (detail?.action === 'already_set') {
        toast.info('Pixel is already set');
      } else {
        toast.warning(`No pixel derived: ${detail?.action ?? 'unknown'}`);
      }
      refetch();
    } catch (e: any) {
      toast.error('Auto-derive failed: ' + (e?.message || 'unknown'));
    } finally {
      setDeriving(false);
    }
  };

  const lastToken = data?.capi_token ? `••••${data.capi_token.slice(-4)}` : '';

  return (
    <div className="border-2 border-border p-4 space-y-4">
      <div>
        <h4 className="font-medium mb-1 flex items-center gap-2">
          <Target className="h-4 w-4" />
          Meta Tracking (Pixel & Conversions API)
        </h4>
        <p className="text-sm text-muted-foreground mb-3">
          Used to send lead-quality events (QualifiedLead, BookedCall, ShowedCall, Funded) back to Meta so its algorithm optimizes for real outcomes, not just leads.
        </p>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="meta-pixel">Meta Pixel ID</Label>
          <Button size="sm" variant="outline" onClick={autoDerive} disabled={deriving}>
            {deriving ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Sparkles className="h-3 w-3 mr-1" />}
            Auto-derive from ad account
          </Button>
        </div>
        <Input
          id="meta-pixel"
          value={pixel}
          onChange={(e) => setPixel(e.target.value.replace(/[^\d]/g, ''))}
          placeholder="15-16 digit pixel ID"
          className={!pixelValid ? 'border-destructive' : ''}
        />
        {!pixelValid && <p className="text-xs text-destructive">Must be 15-16 digits</p>}
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {isLoading ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : data?.events_7d ? (
            <>
              <CheckCircle2 className="h-3 w-3 text-emerald-500" />
              <span>{data.events_7d} CAPI event{data.events_7d === 1 ? '' : 's'} sent in last 7d</span>
              {data.last_event && <span>· last: {new Date(data.last_event.sent_at).toLocaleString()} ({data.last_event.event_name})</span>}
            </>
          ) : (
            <>
              <AlertCircle className="h-3 w-3 text-amber-500" />
              <span>No CAPI events sent yet</span>
            </>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="meta-capi-token">CAPI Access Token (optional)</Label>
        <div className="flex gap-2">
          <Input
            id="meta-capi-token"
            type={showToken ? 'text' : 'password'}
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={data?.capi_token ? lastToken : 'Uses shared agency token if empty'}
          />
          <Button size="icon" variant="ghost" type="button" onClick={() => setShowToken((s) => !s)}>
            {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Leave blank to use the shared agency CAPI token. Provide a client-specific token if the pixel lives in a Business Manager the shared token can't access.
        </p>
      </div>

      <div className="flex items-center justify-between pt-2">
        <div className="flex items-center gap-2">
          {pixel ? (
            <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 className="h-3 w-3 mr-1" /> Pixel configured
            </Badge>
          ) : (
            <Badge variant="secondary">Not configured</Badge>
          )}
        </div>
        <Button size="sm" disabled={!dirty || saving || !pixelValid} onClick={save}>
          {saving && <Loader2 className="h-3 w-3 animate-spin mr-1" />} Save
        </Button>
      </div>
    </div>
  );
}