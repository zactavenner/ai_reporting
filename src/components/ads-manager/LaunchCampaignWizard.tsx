import { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import {
  Loader2, RefreshCw, ChevronLeft, ChevronRight, CheckCircle2, AlertTriangle,
  Target, DollarSign, Users, ShieldCheck, Rocket, Sparkles, FileText, Wand2,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useMetaAccountAssets } from './shared/useMetaAccountAssets';
import { format } from 'date-fns';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  clientId: string;
  clientName: string;
}

/**
 * SOP-driven presets for capital-raising campaigns.
 * Aligns with the agency's standard playbook: Leads objective, LEAD event optimization,
 * US 35-65+, accredited investor language, $50/day floor, paused launch for review.
 */
type PresetKey = 'cold_leads' | 'retargeting' | 'reconnect' | 'webinar' | 'awareness';

const PRESETS: Record<PresetKey, {
  label: string;
  description: string;
  icon: any;
  objective: string;
  optimizationGoal: string;
  customEventType: string;
  bidStrategy: string;
  dailyBudget: number;
  ageMin: number;
  ageMax: number;
  audienceTag: string;
  recommendedRuntime: string;
  notes: string[];
}> = {
  cold_leads: {
    label: 'Cold Lead Generation',
    description: 'Top-of-funnel investor acquisition with the LEAD pixel event.',
    icon: Target,
    objective: 'OUTCOME_LEADS',
    optimizationGoal: 'OFFSITE_CONVERSIONS',
    customEventType: 'LEAD',
    bidStrategy: 'LOWEST_COST_WITHOUT_CAP',
    dailyBudget: 100,
    ageMin: 35,
    ageMax: 65,
    audienceTag: 'Cold-US-35-65',
    recommendedRuntime: '7-14 days minimum to exit learning phase',
    notes: [
      'SOP target CPL: $35-75 for accredited offers.',
      'Run 3+ creatives concurrently to give Meta enough variants.',
      'Pause individual ads only after $300 spend with 0 leads.',
    ],
  },
  retargeting: {
    label: 'Retargeting (Warm)',
    description: 'Re-engage VSL viewers, page visitors, and partial form submits.',
    icon: Users,
    objective: 'OUTCOME_LEADS',
    optimizationGoal: 'OFFSITE_CONVERSIONS',
    customEventType: 'LEAD',
    bidStrategy: 'LOWEST_COST_WITHOUT_CAP',
    dailyBudget: 50,
    ageMin: 35,
    ageMax: 65,
    audienceTag: 'RTG-VSL-30d',
    recommendedRuntime: 'Always-on; refresh creative every 14 days',
    notes: [
      'Use a dedicated retargeting audience (custom audience ID required).',
      'Frequency cap recommended: 3-5/week to avoid fatigue.',
      'Pair with a stronger CTA: book call, download deck, or book webinar seat.',
    ],
  },
  reconnect: {
    label: 'Reconnect (No-Show / Drop-off)',
    description: 'Win back leads who booked then no-showed or stalled mid-funnel.',
    icon: RefreshCw,
    objective: 'OUTCOME_LEADS',
    optimizationGoal: 'OFFSITE_CONVERSIONS',
    customEventType: 'SCHEDULE',
    bidStrategy: 'LOWEST_COST_WITHOUT_CAP',
    dailyBudget: 30,
    ageMin: 35,
    ageMax: 65,
    audienceTag: 'RECONNECT-30d',
    recommendedRuntime: '14 days, then refresh',
    notes: [
      'Upload no-show / un-funded leads as a custom audience first.',
      'Use a soft re-invite hook (case study, market update, founder call).',
    ],
  },
  webinar: {
    label: 'Webinar / Event Registration',
    description: 'Drive RSVPs to a live event or evergreen webinar.',
    icon: Sparkles,
    objective: 'OUTCOME_LEADS',
    optimizationGoal: 'OFFSITE_CONVERSIONS',
    customEventType: 'COMPLETE_REGISTRATION',
    bidStrategy: 'LOWEST_COST_WITHOUT_CAP',
    dailyBudget: 75,
    ageMin: 35,
    ageMax: 65,
    audienceTag: 'Webinar-Cold-US',
    recommendedRuntime: 'Run 5-10 days before event start',
    notes: [
      'Switch ad URL to the registration page; ensure thank-you fires REGISTRATION event.',
      'Spend ~15% of daily budget on retargeting registrants the day before.',
    ],
  },
  awareness: {
    label: 'Brand / Founder Awareness',
    description: 'Build trust with founder content and case studies (top of funnel).',
    icon: Wand2,
    objective: 'OUTCOME_AWARENESS',
    optimizationGoal: 'REACH',
    customEventType: '',
    bidStrategy: 'LOWEST_COST_WITHOUT_CAP',
    dailyBudget: 25,
    ageMin: 35,
    ageMax: 65,
    audienceTag: 'Awareness-US',
    recommendedRuntime: 'Always-on with monthly creative swap',
    notes: [
      'Use storytelling video (founder POV, deal walkthroughs).',
      'Lower-funnel campaigns will retarget viewers automatically.',
    ],
  },
};

type Step = 'offer' | 'preset' | 'budget' | 'targeting' | 'review';
const STEP_ORDER: Step[] = ['offer', 'preset', 'budget', 'targeting', 'review'];
const STEP_META: Record<Step, { title: string; icon: any }> = {
  offer: { title: 'Offer', icon: FileText },
  preset: { title: 'Strategy', icon: Target },
  budget: { title: 'Budget', icon: DollarSign },
  targeting: { title: 'Targeting', icon: Users },
  review: { title: 'Review & Launch', icon: Rocket },
};

function slugifyShort(s: string, max = 24) {
  return (s || '')
    .replace(/[^A-Za-z0-9 ]+/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .split(' ')
    .slice(0, 4)
    .join(' ')
    .slice(0, max);
}

export function LaunchCampaignWizard({ open, onOpenChange, clientId, clientName }: Props) {
  const qc = useQueryClient();
  const { allPages, allPixels, refresh, assets } = useMetaAccountAssets(clientId);

  // Wizard state
  const [step, setStep] = useState<Step>('offer');
  const [offerId, setOfferId] = useState<string>('');
  const [presetKey, setPresetKey] = useState<PresetKey>('cold_leads');
  const [dailyBudget, setDailyBudget] = useState<string>('100');
  const [countries, setCountries] = useState('US');
  const [ageMin, setAgeMin] = useState('35');
  const [ageMax, setAgeMax] = useState('65');
  const [genders, setGenders] = useState<'all' | 'male' | 'female'>('all');
  const [audienceTag, setAudienceTag] = useState('Cold-US-35-65');
  const [pageId, setPageId] = useState('');
  const [pixelId, setPixelId] = useState('');
  const [campaignNameOverride, setCampaignNameOverride] = useState('');
  const [adSetNameOverride, setAdSetNameOverride] = useState('');

  const preset = PRESETS[presetKey];

  // ---- Draft persistence ----
  // Each client gets its own scoped draft so partial wizard state survives
  // accidental dialog close, page reload, or tab switch.
  const DRAFT_KEY = `launch-wizard-draft:${clientId}`;
  const [draftRestored, setDraftRestored] = useState(false);

  // Restore on open
  useEffect(() => {
    if (!open) { setDraftRestored(false); return; }
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const d = JSON.parse(raw);
        setStep(d.step || 'offer');
        if (typeof d.offerId === 'string') setOfferId(d.offerId);
        if (d.presetKey && PRESETS[d.presetKey as PresetKey]) setPresetKey(d.presetKey);
        if (typeof d.dailyBudget === 'string') setDailyBudget(d.dailyBudget);
        if (typeof d.countries === 'string') setCountries(d.countries);
        if (typeof d.ageMin === 'string') setAgeMin(d.ageMin);
        if (typeof d.ageMax === 'string') setAgeMax(d.ageMax);
        if (d.genders === 'all' || d.genders === 'male' || d.genders === 'female') setGenders(d.genders);
        if (typeof d.audienceTag === 'string') setAudienceTag(d.audienceTag);
        if (typeof d.pageId === 'string') setPageId(d.pageId);
        if (typeof d.pixelId === 'string') setPixelId(d.pixelId);
        if (typeof d.campaignNameOverride === 'string') setCampaignNameOverride(d.campaignNameOverride);
        if (typeof d.adSetNameOverride === 'string') setAdSetNameOverride(d.adSetNameOverride);
        setDraftRestored(true);
        toast.info('Draft restored', { description: 'Continuing where you left off.' });
      } else {
        setStep('offer');
        setCampaignNameOverride('');
        setAdSetNameOverride('');
      }
    } catch (e) { console.warn('Draft restore failed', e); }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Persist on change (debounced) while dialog is open
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify({
          step, offerId, presetKey, dailyBudget, countries, ageMin, ageMax,
          genders, audienceTag, pageId, pixelId, campaignNameOverride, adSetNameOverride,
        }));
      } catch {}
    }, 300);
    return () => clearTimeout(t);
  }, [open, step, offerId, presetKey, dailyBudget, countries, ageMin, ageMax,
      genders, audienceTag, pageId, pixelId, campaignNameOverride, adSetNameOverride]); // eslint-disable-line react-hooks/exhaustive-deps

  const clearDraft = () => {
    try { localStorage.removeItem(DRAFT_KEY); } catch {}
    setDraftRestored(false);
    setStep('offer'); setOfferId(''); setPresetKey('cold_leads');
    setDailyBudget('100'); setCountries('US'); setAgeMin('35'); setAgeMax('65');
    setGenders('all'); setAudienceTag('Cold-US-35-65');
    setCampaignNameOverride(''); setAdSetNameOverride('');
    toast.success('Draft cleared');
  };

  // Apply preset defaults whenever preset changes
  useEffect(() => {
    setDailyBudget(String(preset.dailyBudget));
    setAgeMin(String(preset.ageMin));
    setAgeMax(String(preset.ageMax));
    setAudienceTag(preset.audienceTag);
  }, [presetKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-pick first available page/pixel
  useEffect(() => {
    if (!pageId && allPages.length > 0) setPageId(allPages[0].id);
    if (!pixelId && allPixels.length > 0) setPixelId(allPixels[0].id);
  }, [allPages, allPixels]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load offers for this client
  const { data: offers = [], isLoading: offersLoading } = useQuery({
    queryKey: ['client-offers-wizard', clientId],
    enabled: open && !!clientId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('client_offers')
        .select('id, title, fund_name, fund_type, raise_amount, min_investment, target_investor')
        .eq('client_id', clientId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  const selectedOffer = useMemo(
    () => (offers as any[]).find((o) => o.id === offerId) || null,
    [offers, offerId],
  );

  // Auto-generated names per SOP: [Client] - [Offer] - [Audience] - [YYYY-MM]
  const autoCampaignName = useMemo(() => {
    const offerLabel = selectedOffer
      ? slugifyShort(selectedOffer.fund_name || selectedOffer.title)
      : slugifyShort(clientName);
    const date = format(new Date(), 'yyyy-MM');
    return `${slugifyShort(clientName, 18)} - ${offerLabel} - ${preset.label.split(' ')[0]} - ${date}`;
  }, [selectedOffer, clientName, preset]);

  const autoAdSetName = useMemo(() => {
    const ages = `${ageMin}-${ageMax}`;
    return `${audienceTag} - ${countries.split(',')[0]?.trim().toUpperCase() || 'US'} - ${ages}`;
  }, [audienceTag, countries, ageMin, ageMax]);

  const finalCampaignName = campaignNameOverride.trim() || autoCampaignName;
  const finalAdSetName = adSetNameOverride.trim() || autoAdSetName;

  // Pre-flight checklist
  const checks = useMemo(() => {
    const list: { ok: boolean; label: string; hint?: string }[] = [
      { ok: !!pageId, label: 'Facebook Page selected', hint: 'Required to run ads.' },
      { ok: preset.customEventType ? !!pixelId : true, label: 'Pixel attached', hint: 'Required for conversion optimization.' },
      { ok: !!finalCampaignName, label: 'Campaign name set' },
      { ok: Number(dailyBudget) >= 10, label: 'Daily budget ≥ $10', hint: 'Meta minimum for conversion optimization.' },
      { ok: Number(ageMin) >= 18, label: 'Age min ≥ 18 (compliance)' },
      { ok: countries.trim().length > 0, label: 'At least 1 country selected' },
    ];
    return list;
  }, [pageId, pixelId, finalCampaignName, dailyBudget, ageMin, countries, preset]);

  const allChecksPass = checks.every((c) => c.ok);

  const submit = useMutation({
    mutationFn: async () => {
      const targeting: any = {
        geo_locations: { countries: countries.split(',').map((c) => c.trim().toUpperCase()).filter(Boolean) },
        age_min: Number(ageMin),
        age_max: Number(ageMax),
      };
      if (genders === 'male') targeting.genders = [1];
      if (genders === 'female') targeting.genders = [2];

      const body: any = {
        clientId,
        campaignName: finalCampaignName,
        objective: preset.objective,
        specialAdCategories: [],
        adSetName: finalAdSetName,
        bidStrategy: preset.bidStrategy,
        optimizationGoal: preset.optimizationGoal,
        billingEvent: 'IMPRESSIONS',
        targeting,
        dailyBudgetCents: Math.round(Number(dailyBudget) * 100),
      };
      if (pageId) body.pageId = pageId;
      if (pixelId) body.pixelId = pixelId;
      if (preset.customEventType) body.customEventType = preset.customEventType;

      const { data, error } = await supabase.functions.invoke('create-meta-campaign', { body });
      if (error || !data?.success) throw new Error(data?.error || error?.message || 'Campaign creation failed');
      return data;
    },
    onSuccess: (data) => {
      toast.success(`Launched in PAUSED state · ${finalCampaignName}`, {
        description: data?.message || 'Add ads from the ad set view, then unpause when ready.',
      });
      qc.invalidateQueries({ queryKey: ['admin-meta-campaigns'] });
      qc.invalidateQueries({ queryKey: ['admin-meta-adsets'] });
      try { localStorage.removeItem(DRAFT_KEY); } catch {}
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e?.message || 'Failed to launch campaign'),
  });

  const stepIndex = STEP_ORDER.indexOf(step);
  const goNext = () => setStep(STEP_ORDER[Math.min(stepIndex + 1, STEP_ORDER.length - 1)]);
  const goBack = () => setStep(STEP_ORDER[Math.max(stepIndex - 1, 0)]);

  const canAdvance = () => {
    if (step === 'offer') return true; // offer optional
    if (step === 'preset') return !!presetKey;
    if (step === 'budget') return Number(dailyBudget) >= 1;
    if (step === 'targeting') return countries.trim().length > 0 && Number(ageMin) >= 18 && Number(ageMax) >= Number(ageMin);
    return false;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Rocket className="h-4 w-4 text-primary" />
            Launch Campaign — Guided · {clientName}
            {draftRestored && (
              <Badge variant="secondary" className="text-[10px] ml-2">Draft restored</Badge>
            )}
          </DialogTitle>
          <DialogDescription>
            Walks through the agency's capital-raising SOP and launches in PAUSED state for review.
            {draftRestored && (
              <button
                type="button"
                onClick={clearDraft}
                className="ml-2 text-[11px] underline text-muted-foreground hover:text-foreground"
              >
                Start fresh
              </button>
            )}
          </DialogDescription>
        </DialogHeader>

        {/* Stepper */}
        <div className="flex items-center gap-1.5 py-1">
          {STEP_ORDER.map((s, i) => {
            const meta = STEP_META[s];
            const Icon = meta.icon;
            const active = s === step;
            const done = i < stepIndex;
            return (
              <div key={s} className="flex items-center gap-1.5 flex-1 min-w-0">
                <button
                  type="button"
                  onClick={() => i <= stepIndex && setStep(s)}
                  className={cn(
                    'flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-medium transition-colors min-w-0 truncate',
                    active && 'bg-primary text-primary-foreground',
                    !active && done && 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/15',
                    !active && !done && 'text-muted-foreground',
                  )}
                >
                  <Icon className="h-3 w-3 shrink-0" />
                  <span className="truncate">{meta.title}</span>
                </button>
                {i < STEP_ORDER.length - 1 && <div className="h-px flex-1 bg-border" />}
              </div>
            );
          })}
        </div>

        <Separator />

        {/* STEP: OFFER */}
        {step === 'offer' && (
          <div className="space-y-3 pt-1">
            <div>
              <Label className="text-sm">Which offer is this for?</Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Selecting an offer auto-fills naming, audience tags, and ensures compliant copy. Optional.
              </p>
            </div>
            {offersLoading ? (
              <div className="text-xs text-muted-foreground py-4">Loading offers…</div>
            ) : offers.length === 0 ? (
              <Card className="p-3 text-xs text-muted-foreground">
                No offers configured for this client yet. You can still launch — generic naming will be used.
              </Card>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setOfferId('')}
                  className={cn(
                    'text-left rounded-md border p-2.5 transition-colors',
                    !offerId ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/40',
                  )}
                >
                  <div className="text-sm font-medium">No specific offer</div>
                  <div className="text-[11px] text-muted-foreground">Use client name in campaign label.</div>
                </button>
                {(offers as any[]).map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => setOfferId(o.id)}
                    className={cn(
                      'text-left rounded-md border p-2.5 transition-colors',
                      offerId === o.id ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/40',
                    )}
                  >
                    <div className="text-sm font-medium truncate">{o.fund_name || o.title}</div>
                    <div className="text-[11px] text-muted-foreground flex flex-wrap gap-2 mt-0.5">
                      {o.fund_type && <span>{o.fund_type}</span>}
                      {o.min_investment && <span>Min ${Number(o.min_investment).toLocaleString()}</span>}
                      {o.target_investor && <span className="truncate">{o.target_investor}</span>}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* STEP: PRESET */}
        {step === 'preset' && (
          <div className="space-y-3 pt-1">
            <div>
              <Label className="text-sm">Pick a strategy preset (SOP-aligned)</Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Each preset configures objective, optimization event, budget floor, and audience defaults.
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {(Object.keys(PRESETS) as PresetKey[]).map((k) => {
                const p = PRESETS[k];
                const Icon = p.icon;
                const active = k === presetKey;
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setPresetKey(k)}
                    className={cn(
                      'text-left rounded-md border p-3 transition-colors flex gap-2.5',
                      active ? 'border-primary bg-primary/5 ring-1 ring-primary/40' : 'border-border hover:bg-muted/40',
                    )}
                  >
                    <div className={cn(
                      'h-7 w-7 rounded-md grid place-items-center shrink-0',
                      active ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground',
                    )}>
                      <Icon className="h-3.5 w-3.5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold">{p.label}</div>
                      <div className="text-[11px] text-muted-foreground mt-0.5">{p.description}</div>
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        <Badge variant="outline" className="text-[9px] h-4 px-1.5">{p.optimizationGoal.replace(/_/g, ' ')}</Badge>
                        {p.customEventType && <Badge variant="outline" className="text-[9px] h-4 px-1.5">{p.customEventType}</Badge>}
                        <Badge variant="outline" className="text-[9px] h-4 px-1.5">${p.dailyBudget}/day</Badge>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* STEP: BUDGET */}
        {step === 'budget' && (
          <div className="space-y-3 pt-1">
            <Card className="p-3 bg-muted/30 border-dashed">
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Recommended for {preset.label}</div>
              <div className="text-sm font-medium mt-0.5">${preset.dailyBudget}/day · {preset.recommendedRuntime}</div>
            </Card>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Daily budget ($)</Label>
                <Input
                  type="number"
                  min="10"
                  step="5"
                  value={dailyBudget}
                  onChange={(e) => setDailyBudget(e.target.value)}
                />
                <div className="flex gap-1 mt-1.5">
                  {[25, 50, 100, 200].map((v) => (
                    <Button
                      key={v}
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-6 text-[10px] flex-1"
                      onClick={() => setDailyBudget(String(v))}
                    >
                      ${v}
                    </Button>
                  ))}
                </div>
              </div>
              <div className="text-[11px] text-muted-foreground space-y-1 pt-5">
                <div>≈ ${(Number(dailyBudget) * 7).toLocaleString()} / week</div>
                <div>≈ ${(Number(dailyBudget) * 30).toLocaleString()} / month</div>
                {Number(dailyBudget) < 25 && (
                  <div className="text-amber-600 dark:text-amber-400 flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3" />Below SOP floor — exit from learning may be slow.
                  </div>
                )}
              </div>
            </div>
            <Card className="p-3 space-y-1.5 bg-primary/5 border-primary/20">
              <div className="text-xs font-semibold flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5 text-primary" />SOP Notes
              </div>
              {preset.notes.map((n, i) => (
                <div key={i} className="text-[11px] text-muted-foreground flex gap-1.5">
                  <span className="text-primary mt-0.5">•</span>
                  <span>{n}</span>
                </div>
              ))}
            </Card>
          </div>
        )}

        {/* STEP: TARGETING */}
        {step === 'targeting' && (
          <div className="space-y-3 pt-1">
            <div>
              <Label>Audience tag (used in ad set name)</Label>
              <Input value={audienceTag} onChange={(e) => setAudienceTag(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Countries (ISO codes, comma-separated)</Label>
                <Input value={countries} onChange={(e) => setCountries(e.target.value)} placeholder="US, CA, GB" />
              </div>
              <div>
                <Label>Genders</Label>
                <Select value={genders} onValueChange={(v: any) => setGenders(v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="male">Men</SelectItem>
                    <SelectItem value="female">Women</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Age min</Label>
                <Input type="number" min="18" max="65" value={ageMin} onChange={(e) => setAgeMin(e.target.value)} />
              </div>
              <div>
                <Label>Age max</Label>
                <Input type="number" min="18" max="65" value={ageMax} onChange={(e) => setAgeMax(e.target.value)} />
              </div>
            </div>
            <Card className="p-3 bg-muted/30 text-[11px] text-muted-foreground">
              <div className="font-semibold text-foreground mb-1 text-xs">Capital-raising defaults</div>
              US-only, ages 35-65+, all genders. Layer interests, lookalikes, or custom audiences directly in Meta Ads
              Manager once the ad set is created.
            </Card>
          </div>
        )}

        {/* STEP: REVIEW */}
        {step === 'review' && (
          <div className="space-y-3 pt-1">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Campaign name</Label>
                <Input
                  value={campaignNameOverride || autoCampaignName}
                  onChange={(e) => setCampaignNameOverride(e.target.value)}
                />
                <p className="text-[10px] text-muted-foreground mt-0.5">SOP format: Client - Offer - Strategy - YYYY-MM</p>
              </div>
              <div>
                <Label>Ad set name</Label>
                <Input
                  value={adSetNameOverride || autoAdSetName}
                  onChange={(e) => setAdSetNameOverride(e.target.value)}
                />
                <p className="text-[10px] text-muted-foreground mt-0.5">SOP format: Audience - Country - Ages</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="flex items-center justify-between">
                  Facebook Page
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-5 text-[10px] px-1.5"
                    onClick={() => refresh.mutate()}
                    disabled={refresh.isPending}
                  >
                    {refresh.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                  </Button>
                </Label>
                {allPages.length > 0 ? (
                  <Select value={pageId} onValueChange={setPageId}>
                    <SelectTrigger><SelectValue placeholder="Select page" /></SelectTrigger>
                    <SelectContent>
                      {allPages.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input value={pageId} onChange={(e) => setPageId(e.target.value)} placeholder="Page ID — refresh from Meta" />
                )}
              </div>
              <div>
                <Label>Pixel</Label>
                {allPixels.length > 0 ? (
                  <Select value={pixelId} onValueChange={setPixelId}>
                    <SelectTrigger><SelectValue placeholder="Select pixel" /></SelectTrigger>
                    <SelectContent>
                      {allPixels.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input value={pixelId} onChange={(e) => setPixelId(e.target.value)} placeholder="Pixel ID" />
                )}
              </div>
            </div>

            <Card className="p-3 space-y-1.5">
              <div className="text-xs font-semibold flex items-center gap-1.5">
                <ShieldCheck className="h-3.5 w-3.5 text-primary" />Pre-flight checklist
              </div>
              {checks.map((c, i) => (
                <div key={i} className="flex items-start gap-2 text-[11px]">
                  {c.ok
                    ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 mt-0.5 shrink-0" />
                    : <AlertTriangle className="h-3.5 w-3.5 text-amber-500 mt-0.5 shrink-0" />}
                  <div className="min-w-0">
                    <div className={cn('font-medium', c.ok ? 'text-foreground' : 'text-amber-600 dark:text-amber-400')}>{c.label}</div>
                    {c.hint && !c.ok && <div className="text-muted-foreground">{c.hint}</div>}
                  </div>
                </div>
              ))}
            </Card>

            <Card className="p-3 bg-amber-500/5 border-amber-500/30 text-[11px]">
              <div className="font-semibold text-foreground flex items-center gap-1.5 mb-1">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />Compliance reminder
              </div>
              <span className="text-muted-foreground">
                Investment ad copy must avoid the word "guaranteed". Use phrases like "targeted returns" and include a
                risk disclaimer in the creative. Your launch will be paused — review copy before activating.
              </span>
            </Card>

            <Card className="p-3 bg-muted/30 text-[11px] space-y-1">
              <div className="font-semibold text-foreground text-xs mb-1">Summary</div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
                <div className="text-muted-foreground">Strategy</div><div>{preset.label}</div>
                <div className="text-muted-foreground">Objective</div><div>{preset.objective.replace('OUTCOME_', '')}</div>
                <div className="text-muted-foreground">Optimization</div><div>{preset.optimizationGoal.replace(/_/g, ' ')}{preset.customEventType ? ` · ${preset.customEventType}` : ''}</div>
                <div className="text-muted-foreground">Daily budget</div><div>${dailyBudget}</div>
                <div className="text-muted-foreground">Targeting</div><div>{countries.toUpperCase()} · {ageMin}-{ageMax} · {genders}</div>
                {selectedOffer && (<><div className="text-muted-foreground">Offer</div><div>{selectedOffer.fund_name || selectedOffer.title}</div></>)}
              </div>
            </Card>
          </div>
        )}

        <DialogFooter className="flex items-center justify-between sm:justify-between gap-2">
          <Button variant="ghost" onClick={goBack} disabled={stepIndex === 0 || submit.isPending}>
            <ChevronLeft className="h-3.5 w-3.5 mr-1" />Back
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submit.isPending}>Cancel</Button>
            {step !== 'review' ? (
              <Button onClick={goNext} disabled={!canAdvance()}>
                Next<ChevronRight className="h-3.5 w-3.5 ml-1" />
              </Button>
            ) : (
              <Button onClick={() => submit.mutate()} disabled={submit.isPending || !allChecksPass}>
                {submit.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Rocket className="h-3.5 w-3.5 mr-1.5" />}
                Launch (Paused)
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}