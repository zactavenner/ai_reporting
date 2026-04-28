import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { useMetaAccountAssets } from './shared/useMetaAccountAssets';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  clientId: string;
  clientName: string;
}

const OBJECTIVES = [
  { value: 'OUTCOME_LEADS', label: 'Leads' },
  { value: 'OUTCOME_SALES', label: 'Sales / Conversions' },
  { value: 'OUTCOME_TRAFFIC', label: 'Traffic' },
  { value: 'OUTCOME_AWARENESS', label: 'Awareness' },
  { value: 'OUTCOME_ENGAGEMENT', label: 'Engagement' },
  { value: 'OUTCOME_APP_PROMOTION', label: 'App promotion' },
];

const OPTIMIZATION_GOALS = [
  'LEAD_GENERATION', 'OFFSITE_CONVERSIONS', 'LINK_CLICKS', 'LANDING_PAGE_VIEWS',
  'IMPRESSIONS', 'REACH', 'POST_ENGAGEMENT', 'VIDEO_VIEWS', 'THRUPLAY',
];

const BID_STRATEGIES = [
  { value: 'LOWEST_COST_WITHOUT_CAP', label: 'Highest volume (no cap)' },
  { value: 'LOWEST_COST_WITH_BID_CAP', label: 'Bid cap' },
  { value: 'COST_CAP', label: 'Cost cap' },
];

const CUSTOM_EVENTS = [
  '', 'LEAD', 'PURCHASE', 'COMPLETE_REGISTRATION', 'INITIATE_CHECKOUT',
  'ADD_TO_CART', 'CONTENT_VIEW', 'SUBMIT_APPLICATION', 'SCHEDULE',
];

export function CreateCampaignDialog({ open, onOpenChange, clientId, clientName }: Props) {
  const qc = useQueryClient();
  const { allPages, allPixels, refresh, assets } = useMetaAccountAssets(clientId);
  // Campaign fields
  const [campaignName, setCampaignName] = useState('');
  const [objective, setObjective] = useState('OUTCOME_LEADS');
  const [specialCategory, setSpecialCategory] = useState<string>('NONE');
  // Ad set fields
  const [adSetName, setAdSetName] = useState('');
  const [budgetType, setBudgetType] = useState<'daily' | 'lifetime'>('daily');
  const [budgetDollars, setBudgetDollars] = useState('50');
  const [endTime, setEndTime] = useState('');
  const [bidStrategy, setBidStrategy] = useState('LOWEST_COST_WITHOUT_CAP');
  const [optimizationGoal, setOptimizationGoal] = useState('LEAD_GENERATION');
  const [pageId, setPageId] = useState('');
  const [pixelId, setPixelId] = useState('');
  const [customEventType, setCustomEventType] = useState('LEAD');

  // Auto-pick first available when assets load
  if (!pageId && allPages.length === 1) setTimeout(() => setPageId(allPages[0].id), 0);
  if (!pixelId && allPixels.length === 1) setTimeout(() => setPixelId(allPixels[0].id), 0);

  const hasNoAssets = assets.length > 0 && allPages.length === 0 && allPixels.length === 0;
  // Targeting
  const [countries, setCountries] = useState('US');
  const [ageMin, setAgeMin] = useState('25');
  const [ageMax, setAgeMax] = useState('65');
  const [genders, setGenders] = useState<'all' | 'male' | 'female'>('all');

  const submit = useMutation({
    mutationFn: async () => {
      const targeting: any = {
        geo_locations: { countries: countries.split(',').map(c => c.trim().toUpperCase()).filter(Boolean) },
        age_min: Number(ageMin),
        age_max: Number(ageMax),
      };
      if (genders === 'male') targeting.genders = [1];
      if (genders === 'female') targeting.genders = [2];

      const dollars = Math.round(Number(budgetDollars) * 100);

      const body: any = {
        clientId,
        campaignName,
        objective,
        specialAdCategories: specialCategory === 'NONE' ? [] : [specialCategory],
        adSetName,
        bidStrategy,
        optimizationGoal,
        billingEvent: 'IMPRESSIONS',
        targeting,
      };
      if (budgetType === 'daily') body.dailyBudgetCents = dollars;
      else { body.lifetimeBudgetCents = dollars; body.endTime = new Date(endTime).toISOString(); }
      if (pageId) body.pageId = pageId;
      if (pixelId) body.pixelId = pixelId;
      if (customEventType) body.customEventType = customEventType;

      const { data, error } = await supabase.functions.invoke('create-meta-campaign', { body });
      if (error || !data?.success) throw new Error(data?.error || error?.message || 'Campaign creation failed');
      return data;
    },
    onSuccess: (data) => {
      toast.success(data.message);
      qc.invalidateQueries({ queryKey: ['admin-meta-campaigns'] });
      qc.invalidateQueries({ queryKey: ['admin-meta-adsets'] });
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New Campaign · {clientName}</DialogTitle>
          <DialogDescription>Creates campaign + ad set in PAUSED state. Add ads via the ad set view.</DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="campaign">
          <TabsList className="grid grid-cols-3">
            <TabsTrigger value="campaign">1. Campaign</TabsTrigger>
            <TabsTrigger value="adset">2. Ad Set</TabsTrigger>
            <TabsTrigger value="targeting">3. Targeting</TabsTrigger>
          </TabsList>

          <TabsContent value="campaign" className="space-y-3">
            <div>
              <Label>Campaign Name *</Label>
              <Input value={campaignName} onChange={e => setCampaignName(e.target.value)} placeholder="2026 Q1 - Lead Gen" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Objective</Label>
                <Select value={objective} onValueChange={setObjective}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{OBJECTIVES.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>Special Ad Category</Label>
                <Select value={specialCategory} onValueChange={setSpecialCategory}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NONE">None</SelectItem>
                    <SelectItem value="HOUSING">Housing</SelectItem>
                    <SelectItem value="EMPLOYMENT">Employment</SelectItem>
                    <SelectItem value="CREDIT">Credit / Financial</SelectItem>
                    <SelectItem value="ISSUES_ELECTIONS_POLITICS">Politics</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="adset" className="space-y-3">
            <div>
              <Label>Ad Set Name *</Label>
              <Input value={adSetName} onChange={e => setAdSetName(e.target.value)} placeholder="US - 25-65 - Lookalike 1%" />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label>Budget Type</Label>
                <Select value={budgetType} onValueChange={(v: any) => setBudgetType(v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="daily">Daily</SelectItem>
                    <SelectItem value="lifetime">Lifetime</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Budget ($)</Label>
                <Input type="number" min="1" value={budgetDollars} onChange={e => setBudgetDollars(e.target.value)} />
              </div>
              {budgetType === 'lifetime' && (
                <div>
                  <Label>End Date *</Label>
                  <Input type="datetime-local" value={endTime} onChange={e => setEndTime(e.target.value)} />
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Bid Strategy</Label>
                <Select value={bidStrategy} onValueChange={setBidStrategy}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{BID_STRATEGIES.map(b => <SelectItem key={b.value} value={b.value}>{b.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>Optimization Goal</Label>
                <Select value={optimizationGoal} onValueChange={setOptimizationGoal}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{OPTIMIZATION_GOALS.map(g => <SelectItem key={g} value={g}>{g.replace(/_/g, ' ')}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label>FB Page ID</Label>
                {allPages.length > 0 ? (
                  <Select value={pageId} onValueChange={setPageId}>
                    <SelectTrigger><SelectValue placeholder="Select page" /></SelectTrigger>
                    <SelectContent>
                      {allPages.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input value={pageId} onChange={e => setPageId(e.target.value)} placeholder="paste ID or refresh →" />
                )}
              </div>
              <div>
                <Label>Pixel ID</Label>
                {allPixels.length > 0 ? (
                  <Select value={pixelId} onValueChange={setPixelId}>
                    <SelectTrigger><SelectValue placeholder="Select pixel" /></SelectTrigger>
                    <SelectContent>
                      {allPixels.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input value={pixelId} onChange={e => setPixelId(e.target.value)} placeholder="for conversions" />
                )}
              </div>
              <div>
                <Label>Custom Event</Label>
                <Select value={customEventType} onValueChange={setCustomEventType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{CUSTOM_EVENTS.map(c => <SelectItem key={c || 'none'} value={c}>{c || 'None'}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
              <span>
                {assets.length === 0
                  ? 'No cached pages/pixels — click refresh to fetch from Meta'
                  : `${allPages.length} page(s), ${allPixels.length} pixel(s) cached`}
                {hasNoAssets && ' · account has no eligible assets'}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() => refresh.mutate()}
                disabled={refresh.isPending}
              >
                {refresh.isPending ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <RefreshCw className="h-3 w-3 mr-1" />}
                Refresh from Meta
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="targeting" className="space-y-3">
            <div>
              <Label>Countries (comma-separated ISO codes)</Label>
              <Input value={countries} onChange={e => setCountries(e.target.value)} placeholder="US, CA, GB" />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label>Age Min</Label>
                <Input type="number" min="13" max="65" value={ageMin} onChange={e => setAgeMin(e.target.value)} />
              </div>
              <div>
                <Label>Age Max</Label>
                <Input type="number" min="13" max="65" value={ageMax} onChange={e => setAgeMax(e.target.value)} />
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
            <p className="text-xs text-muted-foreground">
              Advanced targeting (interests, custom audiences, lookalikes) coming soon. Set up in Meta Ads Manager directly for now.
            </p>
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submit.isPending}>Cancel</Button>
          <Button
            onClick={() => submit.mutate()}
            disabled={submit.isPending || !campaignName || !adSetName || !budgetDollars || (budgetType === 'lifetime' && !endTime)}
          >
            {submit.isPending && <Loader2 className="h-3 w-3 mr-2 animate-spin" />}
            Create Campaign (Paused)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
