import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Rocket, Loader2, CheckCircle2, AlertTriangle, RefreshCw, Trophy } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { dashboardAuthHeaders } from '@/lib/dashboardAuthHeaders';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { toast } from 'sonner';

const CTAS = ['LEARN_MORE', 'SIGN_UP', 'APPLY_NOW', 'GET_QUOTE', 'SUBSCRIBE', 'CONTACT_US', 'DOWNLOAD', 'GET_OFFER'];
const CATEGORIES = ['NONE', 'FINANCIAL_PRODUCTS_SERVICES', 'HOUSING', 'EMPLOYMENT', 'CREDIT', 'ISSUES_ELECTIONS_POLITICS'];
const COUNTRY_PRESETS = [
  { label: 'United States', value: 'US' },
  { label: 'US + Canada', value: 'US,CA' },
  { label: 'United Kingdom', value: 'GB' },
  { label: 'Australia', value: 'AU' },
];

const STAGES = ['campaign', 'adset', 'media', 'creative', 'ad', 'done'];

type Draft = {
  name: string;
  objective: 'leads' | 'traffic';
  daily_budget_dollars: number;
  cta: string;
  destination_url: string;
  primary_text: string;
  headline: string;
  description: string;
  page_id: string;
  pixel_id: string;
  countries: string;
  age_min: number;
  age_max: number;
  special_ad_category: string;
  creative_id: string;
};

const EMPTY: Draft = {
  name: '',
  objective: 'leads',
  daily_budget_dollars: 50,
  cta: 'LEARN_MORE',
  destination_url: '',
  primary_text: '',
  headline: '',
  description: '',
  page_id: '',
  pixel_id: '',
  countries: 'US',
  age_min: 30,
  age_max: 65,
  special_ad_category: 'FINANCIAL_PRODUCTS_SERVICES',
  creative_id: '',
};

function money(v: number | null | undefined) {
  return `$${Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

/** Proven winners: >= $250 spend and >= 3x funded ROAS. */
function useProvenWinners(clientId: string) {
  return useQuery({
    queryKey: ['proven-winners', clientId],
    enabled: !!clientId,
    queryFn: async () => {
      const { data } = await supabase
        .from('meta_ads')
        .select('id, name, spend, attributed_funded, attributed_funded_dollars, thumbnail_url, full_image_url, image_url, media_type, video_source_url, headline, body, link_url, call_to_action_type')
        .eq('client_id', clientId)
        .gte('spend', 250)
        .order('attributed_funded_dollars', { ascending: false })
        .limit(24);
      return (data || []).filter((a) => Number(a.spend) > 0 && Number(a.attributed_funded_dollars) / Number(a.spend) >= 3);
    },
  });
}

export function LaunchCenterTab({ clientId, clientName }: { clientId: string; clientName?: string }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const { data: creatives } = useQuery({
    queryKey: ['launch-approved-creatives', clientId],
    enabled: !!clientId,
    queryFn: async () => {
      const { data } = await supabase
        .from('creatives')
        .select('id, title, type, file_url, headline, body_copy, cta_text, status')
        .eq('client_id', clientId)
        .in('status', ['approved', 'launched'])
        .order('created_at', { ascending: false })
        .limit(60);
      return data || [];
    },
  });

  const { data: clientDefaults } = useQuery({
    queryKey: ['launch-client-defaults', clientId],
    enabled: !!clientId,
    queryFn: async () => {
      const { data } = await supabase
        .from('clients')
        .select('meta_ad_account_id, meta_pixel_id, meta_page_id')
        .eq('id', clientId)
        .maybeSingle();
      return data as { meta_ad_account_id?: string; meta_pixel_id?: string; meta_page_id?: string } | null;
    },
  });

  const { data: launches, isLoading: launchesLoading } = useQuery({
    queryKey: ['meta-campaign-launches', clientId],
    enabled: !!clientId,
    refetchInterval: 15_000,
    queryFn: async () => {
      const { data } = await supabase
        .from('meta_campaign_launches')
        .select('*')
        .eq('client_id', clientId)
        .order('created_at', { ascending: false })
        .limit(25);
      return data || [];
    },
  });

  const winners = useProvenWinners(clientId);

  const selectedCreative = useMemo(
    () => (creatives || []).find((c) => c.id === draft.creative_id),
    [creatives, draft.creative_id],
  );

  const pageId = draft.page_id || clientDefaults?.meta_page_id || '';
  const pixelId = draft.pixel_id || clientDefaults?.meta_pixel_id || '';

  const problems = useMemo(() => {
    const p: string[] = [];
    if (draft.name.trim().length < 3) p.push('Campaign name');
    if (!selectedCreative?.file_url) p.push('Approved creative');
    if (!/^https?:\/\//.test(draft.destination_url)) p.push('Destination URL');
    if (draft.primary_text.trim().length < 5) p.push('Primary text');
    if (draft.headline.trim().length < 3) p.push('Headline');
    if (!/^\d{5,}$/.test(pageId)) p.push('Meta Page ID');
    if (draft.objective === 'leads' && !/^\d{5,}$/.test(pixelId)) p.push('Pixel ID');
    if (!clientDefaults?.meta_ad_account_id) p.push('Client Meta ad account');
    return p;
  }, [draft, selectedCreative, pageId, pixelId, clientDefaults]);

  const publish = useMutation({
    mutationFn: async () => {
      const creativeType = (selectedCreative?.type || '').toLowerCase().includes('video') ? 'video' : 'image';
      const { data: inserted, error: insertErr } = await supabase
        .from('meta_campaign_launches')
        .insert({
          client_id: clientId,
          name: draft.name.trim(),
          objective: draft.objective,
          daily_budget_cents: Math.round(draft.daily_budget_dollars * 100),
          cta: draft.cta,
          destination_url: draft.destination_url.trim(),
          primary_text: draft.primary_text.trim(),
          headline: draft.headline.trim(),
          description: draft.description.trim() || null,
          page_id: pageId,
          pixel_id: pixelId || null,
          countries: draft.countries.split(',').map((c) => c.trim().toUpperCase()).filter(Boolean),
          age_min: draft.age_min,
          age_max: draft.age_max,
          special_ad_category: draft.special_ad_category,
          creative_id: selectedCreative?.id || null,
          creative_url: selectedCreative?.file_url || null,
          creative_type: creativeType,
        })
        .select('id')
        .single();
      if (insertErr) throw insertErr;

      const { data, error } = await supabase.functions.invoke('meta-launch-center', {
        body: { launch_id: inserted.id },
        headers: dashboardAuthHeaders(),
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.errors?.join(', ') || data?.error || 'Publish failed');
      return data;
    },
    onSuccess: () => {
      toast.success('Campaign published to Meta — everything is PAUSED for your review');
      setDraft(EMPTY);
      qc.invalidateQueries({ queryKey: ['meta-campaign-launches', clientId] });
    },
    onError: (e: Error) => toast.error(e.message),
    onSettled: () => qc.invalidateQueries({ queryKey: ['meta-campaign-launches', clientId] }),
  });

  const retry = useMutation({
    mutationFn: async (launchId: string) => {
      const { data, error } = await supabase.functions.invoke('meta-launch-center', {
        body: { launch_id: launchId },
        headers: dashboardAuthHeaders(),
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Retry failed');
      return data;
    },
    onSuccess: () => {
      toast.success('Publish resumed from the last completed step');
      qc.invalidateQueries({ queryKey: ['meta-campaign-launches', clientId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const prefillFromWinner = (ad: Record<string, any>) => {
    setDraft((d) => ({
      ...d,
      name: `${clientName || 'Campaign'} — scale of ${String(ad.name || '').slice(0, 40)}`,
      headline: ad.headline || d.headline,
      primary_text: ad.body || d.primary_text,
      destination_url: ad.link_url || d.destination_url,
      cta: CTAS.includes(String(ad.call_to_action_type)) ? String(ad.call_to_action_type) : d.cta,
    }));
    toast.success('Copy and destination pulled from the proven winner');
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Rocket className="h-4 w-4" /> Campaign Launch Center
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Publishes a complete Meta campaign → ad set → creative → ad. Everything is created PAUSED so nothing spends before you approve it.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Campaign name</Label>
              <Input value={draft.name} onChange={(e) => set('name', e.target.value)} placeholder="Q3 Accredited Investor — Video" />
            </div>
            <div className="space-y-1.5">
              <Label>Approved creative</Label>
              <Select value={draft.creative_id} onValueChange={(v) => {
                set('creative_id', v);
                const c = (creatives || []).find((x) => x.id === v);
                if (c) {
                  setDraft((d) => ({
                    ...d,
                    creative_id: v,
                    headline: d.headline || c.headline || '',
                    primary_text: d.primary_text || c.body_copy || '',
                  }));
                }
              }}>
                <SelectTrigger><SelectValue placeholder={creatives?.length ? 'Select an approved asset' : 'No approved creatives yet'} /></SelectTrigger>
                <SelectContent>
                  {(creatives || []).map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.title || 'Untitled'} · {c.type || 'asset'}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Objective</Label>
              <Select value={draft.objective} onValueChange={(v) => set('objective', v as Draft['objective'])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="leads">Leads (conversions)</SelectItem>
                  <SelectItem value="traffic">Traffic (link clicks)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Daily budget — {money(draft.daily_budget_dollars)}</Label>
              <Slider
                min={5}
                max={2000}
                step={5}
                value={[draft.daily_budget_dollars]}
                onValueChange={([v]) => set('daily_budget_dollars', v)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Call to action</Label>
              <Select value={draft.cta} onValueChange={(v) => set('cta', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CTAS.map((c) => <SelectItem key={c} value={c}>{c.replace(/_/g, ' ')}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Destination URL</Label>
              <Input value={draft.destination_url} onChange={(e) => set('destination_url', e.target.value)} placeholder="https://..." />
            </div>
            <div className="space-y-1.5 md:col-span-2">
              <Label>Primary text</Label>
              <Textarea rows={3} value={draft.primary_text} onChange={(e) => set('primary_text', e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Headline</Label>
              <Input value={draft.headline} onChange={(e) => set('headline', e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Description (optional)</Label>
              <Input value={draft.description} onChange={(e) => set('description', e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Meta Page ID</Label>
              <Input value={pageId} onChange={(e) => set('page_id', e.target.value)} placeholder="Numeric page id" />
            </div>
            <div className="space-y-1.5">
              <Label>Pixel ID {draft.objective === 'leads' ? '(required)' : '(optional)'}</Label>
              <Input value={pixelId} onChange={(e) => set('pixel_id', e.target.value)} placeholder="Numeric pixel id" />
            </div>
            <div className="space-y-1.5">
              <Label>Countries</Label>
              <Select value={draft.countries} onValueChange={(v) => set('countries', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {COUNTRY_PRESETS.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Special ad category</Label>
              <Select value={draft.special_ad_category} onValueChange={(v) => set('special_ad_category', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c.replace(/_/g, ' ')}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 md:col-span-2">
              <Label>Age range — {draft.age_min} to {draft.age_max}</Label>
              <div className="flex items-center gap-3">
                <Slider className="flex-1" min={18} max={65} step={1} value={[draft.age_min]} onValueChange={([v]) => set('age_min', Math.min(v, draft.age_max))} />
                <Slider className="flex-1" min={18} max={65} step={1} value={[draft.age_max]} onValueChange={([v]) => set('age_max', Math.max(v, draft.age_min))} />
              </div>
            </div>
          </div>

          {problems.length > 0 && (
            <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs">
              <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
              <span>Still needed before publishing: {problems.join(', ')}</span>
            </div>
          )}

          <Button onClick={() => publish.mutate()} disabled={problems.length > 0 || publish.isPending} className="w-full md:w-auto">
            {publish.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Rocket className="h-4 w-4 mr-2" />}
            Publish paused campaign to Meta
          </Button>
        </CardContent>
      </Card>

      {!!winners.data?.length && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Trophy className="h-4 w-4 text-amber-500" /> Proven winners
              <Badge variant="secondary" className="text-[10px]">$250+ spend · 3x+ funded ROAS</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 md:grid-cols-2">
            {winners.data.map((ad: Record<string, any>) => (
              <div key={ad.id} className="flex items-center justify-between gap-3 rounded-md border p-2.5 text-xs">
                <div className="min-w-0">
                  <p className="truncate font-medium">{ad.name}</p>
                  <p className="text-muted-foreground">
                    {money(ad.spend)} spend · {ad.attributed_funded || 0} funded · {money(ad.attributed_funded_dollars)} raised
                  </p>
                </div>
                <Button size="sm" variant="outline" onClick={() => prefillFromWinner(ad)}>Use copy</Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Publish history</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {launchesLoading ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…</div>
          ) : !launches?.length ? (
            <p className="text-xs text-muted-foreground">No campaigns published from Reporting 5.0 yet.</p>
          ) : (
            launches.map((l: Record<string, any>) => {
              const stepIndex = STAGES.indexOf(l.stage);
              return (
                <div key={l.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2.5 text-xs">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{l.name}</p>
                    <p className="text-muted-foreground">
                      {money(l.daily_budget_cents / 100)}/day · {l.objective} · {new Date(l.created_at).toLocaleString()}
                    </p>
                    {l.error_detail?.message && <p className="mt-1 text-destructive">{l.error_detail.message}</p>}
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={l.status === 'published' ? 'default' : l.status === 'failed' ? 'destructive' : 'secondary'} className="capitalize">
                      {l.status === 'published' && <CheckCircle2 className="h-3 w-3 mr-1" />}
                      {l.status}
                    </Badge>
                    <span className="text-muted-foreground">
                      step {Math.max(0, stepIndex + 1)}/{STAGES.length}: {l.stage}
                    </span>
                    {(l.status === 'failed' || l.status === 'publishing') && (
                      <Button size="sm" variant="outline" disabled={retry.isPending} onClick={() => retry.mutate(l.id)}>
                        {retry.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <><RefreshCw className="h-3.5 w-3.5 mr-1" /> Retry</>}
                      </Button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>
    </div>
  );
}