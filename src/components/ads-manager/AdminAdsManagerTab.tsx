import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useClients } from '@/hooks/useClients';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import {
  RefreshCw, Search, Image as ImageIcon, Video, Play,
  TrendingUp, MousePointerClick, Eye, DollarSign, Target, ExternalLink,
  Layers, Megaphone, FileImage, ChevronRight, Calendar as CalIcon, Plus, Upload, Download, Rocket
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { format, subDays, startOfMonth, endOfMonth, subMonths, formatDistanceToNow } from 'date-fns';
import { CreateAdDialog } from './CreateAdDialog';
import { CreateCampaignDialog } from './CreateCampaignDialog';
import { LaunchCampaignWizard } from './LaunchCampaignWizard';
import { AdHDPreviewDialog } from './AdHDPreviewDialog';
import { Switch } from '@/components/ui/switch';
import { HealthChip } from './shared/HealthChip';
import { HealthFilterBar, type HealthFilter } from './shared/HealthFilterBar';
import { EditableBudgetCell } from './shared/EditableBudgetCell';
import { RowActionsMenu } from './shared/RowActionsMenu';
import { getAdHealth } from './shared/healthSignals';
import { InsightsPanel } from './shared/InsightsPanel';
import { AdsConnectionHealthPanel } from './shared/AdsConnectionHealthPanel';

const fmt$ = (v: number | null | undefined) =>
  !v ? '$0' : `$${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtN = (v: number | null | undefined) =>
  !v ? '0' : Number(v).toLocaleString();
const fmtPct = (v: number | null | undefined) =>
  !v ? '0%' : `${Number(v).toFixed(2)}%`;

interface Props { platform?: 'meta' | 'google' | 'all'; }

export function AdminAdsManagerTab({ platform = 'all' }: Props) {
  const qc = useQueryClient();
  const { data: clients = [] } = useClients();
  const [clientFilter, setClientFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [adAccountFilter, setAdAccountFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState('campaigns');
  const [syncing, setSyncing] = useState<Record<string, boolean>>({});
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);
  const [selectedAdSetId, setSelectedAdSetId] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState<{ from: Date; to: Date }>({ from: subDays(new Date(), 30), to: new Date() });
  const [datePreset, setDatePreset] = useState<string>('30d');
  const [createCampaignOpen, setCreateCampaignOpen] = useState(false);
  const [launchWizardOpen, setLaunchWizardOpen] = useState(false);
  const [createAdContext, setCreateAdContext] = useState<{ adSetId: string; name: string } | null>(null);
  const [previewAd, setPreviewAd] = useState<any | null>(null);
  const [healthFilter, setHealthFilter] = useState<HealthFilter>('all');

  const applyPreset = (preset: string) => {
    setDatePreset(preset);
    const today = new Date();
    if (preset === '7d') setDateRange({ from: subDays(today, 7), to: today });
    else if (preset === '14d') setDateRange({ from: subDays(today, 14), to: today });
    else if (preset === '30d') setDateRange({ from: subDays(today, 30), to: today });
    else if (preset === '90d') setDateRange({ from: subDays(today, 90), to: today });
    else if (preset === 'mtd') setDateRange({ from: startOfMonth(today), to: today });
    else if (preset === 'last-month') {
      const lm = subMonths(today, 1);
      setDateRange({ from: startOfMonth(lm), to: endOfMonth(lm) });
    }
  };

  // Cached campaigns
  const { data: campaigns = [], isLoading: cLoading } = useQuery({
    queryKey: ['admin-meta-campaigns', clientFilter, statusFilter],
    queryFn: async () => {
      let q = (supabase as any).from('meta_campaigns').select('*').order('spend', { ascending: false }).limit(2000);
      if (clientFilter !== 'all') q = q.eq('client_id', clientFilter);
      if (statusFilter !== 'all') q = q.eq('status', statusFilter);
      const { data, error } = await q;
      if (error) { console.error(error); return []; }
      return data || [];
    },
  });

  // Cached ad sets
  const { data: adSets = [] } = useQuery({
    queryKey: ['admin-meta-adsets', clientFilter, selectedCampaignId],
    queryFn: async () => {
      let q = (supabase as any).from('meta_ad_sets').select('*').order('spend', { ascending: false }).limit(2000);
      if (clientFilter !== 'all') q = q.eq('client_id', clientFilter);
      if (selectedCampaignId) q = q.eq('campaign_id', selectedCampaignId);
      const { data, error } = await q;
      if (error) { console.error(error); return []; }
      return data || [];
    },
  });

  // Cached ads
  const { data: ads = [] } = useQuery({
    queryKey: ['admin-meta-ads', clientFilter, selectedAdSetId],
    queryFn: async () => {
      let q = (supabase as any).from('meta_ads').select('*').order('spend', { ascending: false }).limit(2000);
      if (clientFilter !== 'all') q = q.eq('client_id', clientFilter);
      if (selectedAdSetId) q = q.eq('ad_set_id', selectedAdSetId);
      const { data, error } = await q;
      if (error) { console.error(error); return []; }
      return data || [];
    },
  });

  const clientMap = useMemo(() => {
    const m: Record<string, { name: string; meta_ad_account_id: string | null }> = {};
    clients.forEach(c => { m[c.id] = { name: c.name, meta_ad_account_id: (c as any).meta_ad_account_id || null }; });
    return m;
  }, [clients]);

  // Per-client list of ad accounts (primary + extras stored in meta_ad_account_ids[])
  const accountsByClient = useMemo(() => {
    const m: Record<string, string[]> = {};
    clients.forEach((c: any) => {
      const set = new Set<string>();
      if (c.meta_ad_account_id) set.add(String(c.meta_ad_account_id).replace(/^act_/, ''));
      const extras: string[] = Array.isArray(c.meta_ad_account_ids) ? c.meta_ad_account_ids : [];
      extras.forEach(a => a && set.add(String(a).replace(/^act_/, '')));
      m[c.id] = Array.from(set);
    });
    return m;
  }, [clients]);

  // Pull human-readable Meta ad-account names (populated by sync-meta-ads)
  const { data: adAccountRows = [] } = useQuery({
    queryKey: ['admin-meta-ad-account-names'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('meta_ad_accounts')
        .select('ad_account_id, account_name');
      if (error) { console.error(error); return []; }
      return data || [];
    },
    staleTime: 5 * 60_000,
  });
  const accountNameMap = useMemo(() => {
    const m: Record<string, string> = {};
    adAccountRows.forEach((r: any) => {
      const id = String(r.ad_account_id || '').replace(/^act_/, '');
      if (id && r.account_name) m[id] = r.account_name;
    });
    return m;
  }, [adAccountRows]);

  // Flat list of all ad accounts across clients for the Ad Account filter
  const allAdAccounts = useMemo(() => {
    const out: { accountId: string; clientId: string; clientName: string; accountName: string | null }[] = [];
    clients.forEach((c: any) => {
      (accountsByClient[c.id] || []).forEach(acc => {
        out.push({ accountId: acc, clientId: c.id, clientName: c.name, accountName: accountNameMap[acc] || null });
      });
    });
    return out.sort((a, b) => a.clientName.localeCompare(b.clientName));
  }, [clients, accountsByClient, accountNameMap]);

  // Last-sync timestamps per client, pulled from client_settings
  const { data: syncRows = [] } = useQuery({
    queryKey: ['admin-client-meta-sync'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('client_settings')
        .select('client_id, meta_ads_last_sync, meta_ads_sync_enabled');
      if (error) { console.error(error); return []; }
      return data || [];
    },
    staleTime: 60_000,
  });
  const syncByClient = useMemo(() => {
    const m: Record<string, { lastSync: string | null; enabled: boolean }> = {};
    syncRows.forEach((r: any) => {
      m[r.client_id] = { lastSync: r.meta_ads_last_sync || null, enabled: !!r.meta_ads_sync_enabled };
    });
    return m;
  }, [syncRows]);

  // Manual sync per client
  const handleSync = async (clientId: string, clientName: string) => {
    if (syncing[clientId]) return;
    setSyncing(s => ({ ...s, [clientId]: true }));
    toast.loading(`Syncing Meta Ads for ${clientName}…`, { id: `sync-${clientId}` });
    try {
      const { data, error } = await supabase.functions.invoke('sync-meta-ads', {
        body: {
          clientId,
          startDate: format(dateRange.from, 'yyyy-MM-dd'),
          endDate: format(dateRange.to, 'yyyy-MM-dd'),
        },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Sync failed');
      toast.success(`${clientName}: ${data.campaigns || 0} campaigns, ${data.ads || 0} ads synced`, { id: `sync-${clientId}` });
      qc.invalidateQueries({ queryKey: ['admin-meta-campaigns'] });
      qc.invalidateQueries({ queryKey: ['admin-meta-adsets'] });
      qc.invalidateQueries({ queryKey: ['admin-meta-ads'] });
    } catch (err: any) {
      toast.error(`${clientName}: ${err.message}`, { id: `sync-${clientId}` });
    } finally {
      setSyncing(s => ({ ...s, [clientId]: false }));
    }
  };

  const handleSyncAll = async () => {
    const eligible = clients.filter(c => (c as any).meta_ad_account_id);
    toast.info(`Dispatching sync for ${eligible.length} clients…`);
    for (const c of eligible) {
      handleSync(c.id, c.name);
      await new Promise(r => setTimeout(r, 800)); // stagger
    }
  };

  // Filter & search
  const filteredCampaigns = useMemo(() => {
    const term = search.toLowerCase();
    const acctClient = adAccountFilter !== 'all'
      ? allAdAccounts.find(a => a.accountId === adAccountFilter)?.clientId
      : null;
    return campaigns.filter((c: any) => {
      if (acctClient && c.client_id !== acctClient) return false;
      return !term || c.name?.toLowerCase().includes(term) || clientMap[c.client_id]?.name.toLowerCase().includes(term);
    });
  }, [campaigns, search, clientMap, adAccountFilter, allAdAccounts]);

  const filteredAdSets = useMemo(() => {
    const term = search.toLowerCase();
    const acctClient = adAccountFilter !== 'all'
      ? allAdAccounts.find(a => a.accountId === adAccountFilter)?.clientId
      : null;
    return adSets.filter((a: any) => {
      if (acctClient && a.client_id !== acctClient) return false;
      return !term || a.name?.toLowerCase().includes(term);
    });
  }, [adSets, search, adAccountFilter, allAdAccounts]);

  const filteredAds = useMemo(() => {
    const term = search.toLowerCase();
    const acctClient = adAccountFilter !== 'all'
      ? allAdAccounts.find(a => a.accountId === adAccountFilter)?.clientId
      : null;
    return ads.filter((a: any) => {
      if (acctClient && a.client_id !== acctClient) return false;
      if (healthFilter !== 'all' && getAdHealth(a) !== healthFilter) return false;
      return !term || a.name?.toLowerCase().includes(term) || a.headline?.toLowerCase().includes(term);
    });
  }, [ads, search, adAccountFilter, allAdAccounts, healthFilter]);

  const healthCounts = useMemo(() => {
    const term = search.toLowerCase();
    const acctClient = adAccountFilter !== 'all'
      ? allAdAccounts.find(a => a.accountId === adAccountFilter)?.clientId
      : null;
    const base = ads.filter((a: any) => {
      if (acctClient && a.client_id !== acctClient) return false;
      return !term || a.name?.toLowerCase().includes(term) || a.headline?.toLowerCase().includes(term);
    });
    const c: Record<HealthFilter, number> = { all: base.length, winner: 0, underperforming: 0, learning: 0, neutral: 0 } as any;
    base.forEach((a: any) => { c[getAdHealth(a)] = (c[getAdHealth(a)] || 0) + 1; });
    return c;
  }, [ads, search, adAccountFilter, allAdAccounts]);

  // KPIs
  const kpis = useMemo(() => {
    const totalSpend = filteredCampaigns.reduce((s: number, c: any) => s + Number(c.spend || 0), 0);
    const totalImpr = filteredCampaigns.reduce((s: number, c: any) => s + Number(c.impressions || 0), 0);
    const totalClicks = filteredCampaigns.reduce((s: number, c: any) => s + Number(c.clicks || 0), 0);
    const totalCrmLeads = filteredCampaigns.reduce((s: number, c: any) => s + Number(c.attributed_leads || 0), 0);
    const totalMetaLeads = filteredCampaigns.reduce((s: number, c: any) => s + Number(c.meta_reported_leads || 0), 0);
    const totalCalls = filteredCampaigns.reduce((s: number, c: any) => s + Number(c.attributed_calls || 0), 0);
    const totalFunded = filteredCampaigns.reduce((s: number, c: any) => s + Number(c.attributed_funded || 0), 0);
    const ctr = totalImpr > 0 ? (totalClicks / totalImpr) * 100 : 0;
    const cpc = totalClicks > 0 ? totalSpend / totalClicks : 0;
    const crmCpl = totalCrmLeads > 0 ? totalSpend / totalCrmLeads : 0;
    const metaCpl = totalMetaLeads > 0 ? totalSpend / totalMetaLeads : 0;
    const costPerCall = totalCalls > 0 ? totalSpend / totalCalls : 0;
    const costPerFunded = totalFunded > 0 ? totalSpend / totalFunded : 0;
    return {
      totalSpend, totalImpr, totalClicks,
      totalMetaLeads, totalCrmLeads, totalCalls, totalFunded,
      ctr, cpc, metaCpl, crmCpl, costPerCall, costPerFunded,
      count: filteredCampaigns.length,
    };
  }, [filteredCampaigns]);

  return (
    <TooltipProvider>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">Ads Manager</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              Meta campaigns across all clients · cached data · manual sync only
            </p>
          </div>
          <div className="flex items-center gap-2">
            {/* Date range picker */}
            <Select value={datePreset} onValueChange={applyPreset}>
              <SelectTrigger className="w-[140px] h-8 text-xs">
                <CalIcon className="h-3 w-3 mr-1" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7d">Last 7 days</SelectItem>
                <SelectItem value="14d">Last 14 days</SelectItem>
                <SelectItem value="30d">Last 30 days</SelectItem>
                <SelectItem value="90d">Last 90 days</SelectItem>
                <SelectItem value="mtd">Month to date</SelectItem>
                <SelectItem value="last-month">Last month</SelectItem>
                <SelectItem value="custom">Custom…</SelectItem>
              </SelectContent>
            </Select>
            {datePreset === 'custom' && (
              <Popover>
                <PopoverTrigger asChild>
                  <Button size="sm" variant="outline" className="h-8 text-xs">
                    {format(dateRange.from, 'MMM d')} – {format(dateRange.to, 'MMM d')}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="end">
                  <Calendar
                    mode="range"
                    selected={{ from: dateRange.from, to: dateRange.to }}
                    onSelect={(r: any) => r?.from && r?.to && setDateRange({ from: r.from, to: r.to })}
                    numberOfMonths={2}
                    className="p-3 pointer-events-auto"
                  />
                </PopoverContent>
              </Popover>
            )}
            <Button
              size="sm"
              variant="default"
              onClick={() => setLaunchWizardOpen(true)}
              disabled={clientFilter === 'all'}
              title={clientFilter === 'all' ? 'Select a client first' : 'Guided campaign launch (SOP)'}
            >
              <Rocket className="h-3.5 w-3.5 mr-1.5" />
              Launch Campaign
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setCreateCampaignOpen(true)}
              disabled={clientFilter === 'all'}
              title={clientFilter === 'all' ? 'Select a client first' : 'Advanced create (manual fields)'}
            >
              <Plus className="h-3.5 w-3.5 mr-1.5" />
              Advanced
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={handleSyncAll}
              disabled={Object.values(syncing).some(Boolean)}
            >
              <RefreshCw className={cn("h-3.5 w-3.5 mr-1.5", Object.values(syncing).some(Boolean) && "animate-spin")} />
              Sync All Clients
            </Button>
          </div>
        </div>

        {/* KPI bar */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-10 gap-2">
          <KpiCell icon={DollarSign} label="Spend" value={fmt$(kpis.totalSpend)} />
          <KpiCell icon={Eye} label="Impressions" value={fmtN(kpis.totalImpr)} />
          <KpiCell icon={MousePointerClick} label="Clicks" value={fmtN(kpis.totalClicks)} />
          <KpiCell icon={TrendingUp} label="CTR" value={fmtPct(kpis.ctr)} />
          <KpiCell icon={DollarSign} label="CPC" value={fmt$(kpis.cpc)} />
          <KpiCell icon={Target} label="Meta Leads" value={fmtN(kpis.totalMetaLeads)} accent="primary" />
          <KpiCell icon={DollarSign} label="Meta CPL" value={fmt$(kpis.metaCpl)} accent="primary" />
          <KpiCell icon={Target} label="CRM Leads" value={fmtN(kpis.totalCrmLeads)} accent="chart-2" />
          <KpiCell icon={DollarSign} label="Cost / Call" value={fmt$(kpis.costPerCall)} />
          <KpiCell icon={DollarSign} label="Cost / Funded" value={fmt$(kpis.costPerFunded)} />
        </div>

        {/* Filters */}
        <Card className="p-3 flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[240px]">
            <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search campaigns, ad sets, ads…"
              className="pl-8 h-9"
            />
          </div>
          <Select value={clientFilter} onValueChange={setClientFilter}>
            <SelectTrigger className="w-[280px] h-9"><SelectValue placeholder="All Clients" /></SelectTrigger>
            <SelectContent className="max-h-[420px]">
              <SelectItem value="all">All Clients ({clients.length})</SelectItem>
              {[...clients]
                .sort((a: any, b: any) => {
                  // Connected (has account) first, then alpha
                  const aHas = (accountsByClient[a.id] || []).length > 0 ? 0 : 1;
                  const bHas = (accountsByClient[b.id] || []).length > 0 ? 0 : 1;
                  if (aHas !== bHas) return aHas - bHas;
                  return a.name.localeCompare(b.name);
                })
                .map(c => {
                  const accts = accountsByClient[c.id] || [];
                  const sync = syncByClient[c.id];
                  const enabled = sync?.enabled ?? false;
                  const lastSync = sync?.lastSync
                    ? formatDistanceToNow(new Date(sync.lastSync), { addSuffix: true })
                    : null;
                  // Pick the first known account name for an at-a-glance label
                  const firstNamed = accts
                    .map(a => accountNameMap[a])
                    .filter(Boolean)[0] as string | undefined;
                  return (
                    <SelectItem key={c.id} value={c.id} className="py-2">
                      <div className="flex flex-col gap-0.5 w-full">
                        <div className="flex items-center gap-2 w-full">
                          <span
                            className={cn(
                              'h-1.5 w-1.5 rounded-full shrink-0',
                              enabled ? 'bg-chart-2' : 'bg-muted-foreground/40'
                            )}
                            title={enabled ? 'Sync on' : 'Sync off'}
                          />
                          <span className="font-medium truncate">{c.name}</span>
                          <span className="ml-auto flex items-center gap-1.5 text-[10px] text-muted-foreground shrink-0">
                            {accts.length > 0 ? (
                              <Badge variant="outline" className="h-4 px-1 text-[10px] font-normal">
                                {accts.length} acct{accts.length === 1 ? '' : 's'}
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="h-4 px-1 text-[10px] font-normal text-muted-foreground/60">
                                no Meta
                              </Badge>
                            )}
                            {lastSync && <span>· synced {lastSync}</span>}
                          </span>
                        </div>
                        {firstNamed && (
                          <span className="text-[10px] text-muted-foreground/80 truncate pl-3.5">
                            {firstNamed}{accts.length > 1 ? ` +${accts.length - 1} more` : ''}
                          </span>
                        )}
                      </div>
                    </SelectItem>
                  );
                })}
            </SelectContent>
          </Select>
          <Select value={adAccountFilter} onValueChange={setAdAccountFilter}>
            <SelectTrigger className="w-[220px] h-9"><SelectValue placeholder="All Ad Accounts" /></SelectTrigger>
            <SelectContent className="max-h-[420px]">
              <SelectItem value="all">All Ad Accounts ({allAdAccounts.length})</SelectItem>
              {allAdAccounts.map(a => (
                <SelectItem key={a.accountId} value={a.accountId}>
                  <div className="flex flex-col">
                    <span className="truncate text-xs font-medium">
                      {a.accountName || a.clientName}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      {a.accountName ? `${a.clientName} · ` : ''}act_{a.accountId}
                    </span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[160px] h-9"><SelectValue placeholder="All Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="ACTIVE">On (Active)</SelectItem>
              <SelectItem value="PAUSED">Off (Paused)</SelectItem>
              <SelectItem value="ARCHIVED">Archived</SelectItem>
              <SelectItem value="DELETED">Deleted</SelectItem>
            </SelectContent>
          </Select>
          {clientFilter !== 'all' && clientMap[clientFilter]?.meta_ad_account_id && (
            <Button
              size="sm"
              onClick={() => handleSync(clientFilter, clientMap[clientFilter].name)}
              disabled={syncing[clientFilter]}
            >
              <RefreshCw className={cn("h-3.5 w-3.5 mr-1.5", syncing[clientFilter] && "animate-spin")} />
              Sync from Meta
            </Button>
          )}
        </Card>

        {/* Drilldown breadcrumbs */}
        {(selectedCampaignId || selectedAdSetId) && (
          <div className="flex items-center gap-1.5 text-sm">
            <button onClick={() => { setSelectedCampaignId(null); setSelectedAdSetId(null); setActiveTab('campaigns'); }} className="text-muted-foreground hover:text-foreground">All Campaigns</button>
            {selectedCampaignId && <>
              <ChevronRight className="h-3 w-3 text-muted-foreground" />
              <button onClick={() => { setSelectedAdSetId(null); setActiveTab('adsets'); }} className="text-muted-foreground hover:text-foreground">
                {campaigns.find((c: any) => c.id === selectedCampaignId)?.name || 'Campaign'}
              </button>
            </>}
            {selectedAdSetId && <>
              <ChevronRight className="h-3 w-3 text-muted-foreground" />
              <span className="font-medium">{adSets.find((a: any) => a.id === selectedAdSetId)?.name || 'Ad Set'}</span>
            </>}
          </div>
        )}

        {/* Tabs */}
        <AdsConnectionHealthPanel clientId={clientFilter !== 'all' ? clientFilter : undefined} />
        <InsightsPanel
          ads={filteredAds}
          campaigns={filteredCampaigns}
          dateRange={dateRange}
          onJumpTo={({ type, id }) => {
            if (type === 'campaign') { setActiveTab('campaigns'); setSelectedCampaignId(id); }
            else if (type === 'ad') { setActiveTab('ads'); }
          }}
        />
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="campaigns" className="gap-1.5">
              <Megaphone className="h-3.5 w-3.5" />Campaigns ({filteredCampaigns.length})
            </TabsTrigger>
            <TabsTrigger value="adsets" className="gap-1.5">
              <Layers className="h-3.5 w-3.5" />Ad Sets ({filteredAdSets.length})
            </TabsTrigger>
            <TabsTrigger value="ads" className="gap-1.5">
              <FileImage className="h-3.5 w-3.5" />Ads ({filteredAds.length})
            </TabsTrigger>
          </TabsList>

          {/* CAMPAIGNS */}
          <TabsContent value="campaigns" className="space-y-3">
            {cLoading ? (
              <div className="text-center py-12 text-muted-foreground text-sm">Loading campaigns…</div>
            ) : filteredCampaigns.length === 0 ? (
              <EmptyState message="No campaigns in cache. Click 'Sync from Meta' on a client to pull campaigns." />
            ) : (
              <Card className="overflow-hidden">
                <div className="overflow-auto max-h-[600px]">
                  <Table>
                    <TableHeader className="sticky top-0 bg-card z-10">
                      <TableRow>
                        <TableHead className="w-8"></TableHead>
                        <TableHead className="w-[90px]">On/Off</TableHead>
                        <TableHead>Campaign</TableHead>
                        <TableHead>Client</TableHead>
                        <TableHead>Objective</TableHead>
                        <TableHead className="text-right">Spend</TableHead>
                        <TableHead className="text-right">Impressions</TableHead>
                        <TableHead className="text-right">Clicks</TableHead>
                        <TableHead className="text-right">CTR</TableHead>
                        <TableHead className="text-right">CPC</TableHead>
                        <TableHead className="text-right">
                          <Tooltip>
                            <TooltipTrigger>Meta Leads</TooltipTrigger>
                            <TooltipContent className="text-xs max-w-[220px]">As reported by Meta (pixel + on-platform lead forms, 7d-click/1d-view)</TooltipContent>
                          </Tooltip>
                        </TableHead>
                        <TableHead className="text-right">
                          <Tooltip>
                            <TooltipTrigger>CRM Leads</TooltipTrigger>
                            <TooltipContent className="text-xs max-w-[220px]">Leads in your CRM attributed to this campaign via name/UTM matching</TooltipContent>
                          </Tooltip>
                        </TableHead>
                        <TableHead className="text-right">
                          <Tooltip>
                            <TooltipTrigger>CPL</TooltipTrigger>
                            <TooltipContent className="text-xs max-w-[220px]">Spend ÷ CRM leads. Discrepancy with Meta Leads usually means UTM/attribution is missing.</TooltipContent>
                          </Tooltip>
                        </TableHead>
                        <TableHead className="text-right">Calls</TableHead>
                        <TableHead className="text-right">Cost / Call</TableHead>
                        <TableHead className="text-right">Funded</TableHead>
                        <TableHead className="text-right">Cost / Funded</TableHead>
                        <TableHead className="w-12"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredCampaigns.slice(0, 200).map((c: any) => (
                        <TableRow
                          key={c.id}
                          className="cursor-pointer hover:bg-muted/40"
                          onClick={() => { setSelectedCampaignId(c.id); setSelectedAdSetId(null); setActiveTab('adsets'); }}
                        >
                          <TableCell><StatusDot status={c.status} /></TableCell>
                          <TableCell onClick={(e) => e.stopPropagation()}>
                            <MetaStatusToggle
                              clientId={c.client_id}
                              level="campaign"
                              rowId={c.id}
                              status={c.status}
                            />
                          </TableCell>
                          <TableCell className="font-medium text-sm max-w-[280px] truncate">{c.name}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{clientMap[c.client_id]?.name || '—'}</TableCell>
                          <TableCell><Badge variant="outline" className="text-[10px]">{c.objective || '—'}</Badge></TableCell>
                          <TableCell className="text-right font-medium text-sm">{fmt$(c.spend)}</TableCell>
                          <TableCell className="text-right text-xs">{fmtN(c.impressions)}</TableCell>
                          <TableCell className="text-right text-xs">{fmtN(c.clicks)}</TableCell>
                          <TableCell className="text-right text-xs">{fmtPct(c.ctr)}</TableCell>
                          <TableCell className="text-right text-xs">{fmt$(c.cpc)}</TableCell>
                          <TableCell className="text-right text-xs font-medium text-primary">{fmtN(c.meta_reported_leads)}</TableCell>
                          <TableCell className="text-right text-xs font-medium text-chart-2">{fmtN(c.attributed_leads)}</TableCell>
                          <TableCell className="text-right text-xs">{fmt$(c.cost_per_lead)}</TableCell>
                          <TableCell className="text-right text-xs">{fmtN(c.attributed_calls)}</TableCell>
                          <TableCell className="text-right text-xs">{fmt$(c.cost_per_call)}</TableCell>
                          <TableCell className="text-right text-xs">{fmtN(c.attributed_funded)}</TableCell>
                          <TableCell className="text-right text-xs">{fmt$(c.cost_per_funded)}</TableCell>
                          <TableCell><ChevronRight className="h-3.5 w-3.5 text-muted-foreground" /></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                {filteredCampaigns.length > 200 && (
                  <div className="p-2 text-center text-xs text-muted-foreground border-t">
                    Showing first 200 of {filteredCampaigns.length} — narrow filters to see more
                  </div>
                )}
              </Card>
            )}
          </TabsContent>

          {/* AD SETS */}
          <TabsContent value="adsets" className="space-y-3">
            {filteredAdSets.length === 0 ? (
              <EmptyState message={selectedCampaignId ? "No ad sets for this campaign in cache." : "No ad sets in cache. Sync a client first."} />
            ) : (
              <Card className="overflow-hidden">
                <div className="overflow-auto max-h-[600px]">
                  <Table>
                    <TableHeader className="sticky top-0 bg-card z-10">
                      <TableRow>
                        <TableHead className="w-8"></TableHead>
                        <TableHead className="w-[90px]">On/Off</TableHead>
                        <TableHead>Ad Set</TableHead>
                        <TableHead>Optimization</TableHead>
                        <TableHead className="text-right">Daily Budget</TableHead>
                        <TableHead className="text-right">Spend</TableHead>
                        <TableHead className="text-right">Impressions</TableHead>
                        <TableHead className="text-right">Clicks</TableHead>
                        <TableHead className="text-right">CTR</TableHead>
                        <TableHead className="text-right">Reach</TableHead>
                        <TableHead className="text-right text-primary">Meta</TableHead>
                        <TableHead className="text-right text-chart-2">CRM</TableHead>
                        <TableHead className="w-20"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredAdSets.slice(0, 200).map((a: any) => (
                        <TableRow
                          key={a.id}
                          className="cursor-pointer hover:bg-muted/40"
                          onClick={() => { setSelectedAdSetId(a.id); setActiveTab('ads'); }}
                        >
                          <TableCell><StatusDot status={a.status} /></TableCell>
                          <TableCell onClick={(e) => e.stopPropagation()}>
                            <MetaStatusToggle
                              clientId={a.client_id}
                              level="adset"
                              rowId={a.id}
                              status={a.status}
                            />
                          </TableCell>
                          <TableCell className="font-medium text-sm max-w-[260px] truncate">{a.name}</TableCell>
                          <TableCell><Badge variant="outline" className="text-[10px]">{a.optimization_goal || '—'}</Badge></TableCell>
                          <TableCell className="text-right text-xs">{a.daily_budget ? fmt$(Number(a.daily_budget) / 100) : '—'}</TableCell>
                          <TableCell className="text-right font-medium text-sm">{fmt$(a.spend)}</TableCell>
                          <TableCell className="text-right text-xs">{fmtN(a.impressions)}</TableCell>
                          <TableCell className="text-right text-xs">{fmtN(a.clicks)}</TableCell>
                          <TableCell className="text-right text-xs">{fmtPct(a.ctr)}</TableCell>
                          <TableCell className="text-right text-xs">{fmtN(a.reach)}</TableCell>
                          <TableCell className="text-right text-xs font-medium text-primary">{fmtN(a.meta_reported_leads)}</TableCell>
                          <TableCell className="text-right text-xs font-medium text-chart-2">{fmtN(a.attributed_leads)}</TableCell>
                          <TableCell onClick={(e) => e.stopPropagation()}>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-[10px]"
                              onClick={() => setCreateAdContext({ adSetId: a.id, name: a.name })}
                            >
                              <Upload className="h-3 w-3 mr-1" />
                              Ad
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </Card>
            )}
          </TabsContent>

          {/* ADS */}
          <TabsContent value="ads" className="space-y-3">
            <HealthFilterBar value={healthFilter} onChange={setHealthFilter} counts={healthCounts} />
            {filteredAds.length === 0 ? (
              <EmptyState message={selectedAdSetId ? "No ads for this ad set in cache." : "No ads in cache. Sync a client first."} />
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                {filteredAds.slice(0, 60).map((ad: any) => (
                  <AdCard
                    key={ad.id}
                    ad={ad}
                    clientName={clientMap[ad.client_id]?.name}
                    onClick={() => setPreviewAd(ad)}
                  />
                ))}
              </div>
            )}
            {filteredAds.length > 60 && (
              <div className="text-center text-xs text-muted-foreground">
                Showing first 60 of {filteredAds.length} — narrow filters to see more
              </div>
            )}
          </TabsContent>
        </Tabs>

        {/* Dialogs */}
        {clientFilter !== 'all' && (
          <CreateCampaignDialog
            open={createCampaignOpen}
            onOpenChange={setCreateCampaignOpen}
            clientId={clientFilter}
            clientName={clientMap[clientFilter]?.name || ''}
          />
        )}
        {clientFilter !== 'all' && (
          <LaunchCampaignWizard
            open={launchWizardOpen}
            onOpenChange={setLaunchWizardOpen}
            clientId={clientFilter}
            clientName={clientMap[clientFilter]?.name || ''}
          />
        )}
        {createAdContext && clientFilter !== 'all' && (
          <CreateAdDialog
            open={!!createAdContext}
            onOpenChange={(v) => !v && setCreateAdContext(null)}
            clientId={clientFilter}
            adSetId={createAdContext.adSetId}
            adSetName={createAdContext.name}
          />
        )}
        {previewAd && (
          <AdHDPreviewDialog
            open={!!previewAd}
            onOpenChange={(v) => !v && setPreviewAd(null)}
            ad={previewAd}
          />
        )}
      </div>
    </TooltipProvider>
  );
}

function KpiCell({ icon: Icon, label, value, accent }: { icon: any; label: string; value: string; accent?: 'primary' | 'chart-2' }) {
  const accentClass =
    accent === 'primary' ? 'text-primary' :
    accent === 'chart-2' ? 'text-chart-2' :
    '';
  return (
    <Card className="p-3">
      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground uppercase tracking-wide">
        <Icon className="h-3 w-3" />{label}
      </div>
      <p className={cn("text-base font-bold mt-1 tabular-nums", accentClass)}>{value}</p>
    </Card>
  );
}

function StatusDot({ status }: { status: string | null }) {
  const s = (status || '').toUpperCase();
  const color =
    s === 'ACTIVE' ? 'bg-chart-2' :
    s === 'PAUSED' ? 'bg-yellow-500' :
    s === 'ARCHIVED' || s === 'DELETED' ? 'bg-muted-foreground' :
    'bg-muted';
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className={cn("h-2 w-2 rounded-full", color)} />
      </TooltipTrigger>
      <TooltipContent side="right" className="text-xs">{status || 'Unknown'}</TooltipContent>
    </Tooltip>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="border-2 border-dashed border-border rounded-lg p-12 text-center">
      <ImageIcon className="h-10 w-10 mx-auto text-muted-foreground/40 mb-3" />
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}

function MetaStatusToggle({
  clientId,
  level,
  rowId,
  status,
  size = 'sm',
}: {
  clientId: string;
  level: 'campaign' | 'adset' | 'ad';
  rowId: string;
  status: string | null;
  size?: 'sm' | 'md';
}) {
  const qc = useQueryClient();
  const [pending, setPending] = useState(false);
  const [localOn, setLocalOn] = useState((status || '').toUpperCase() === 'ACTIVE');

  const handleToggle = async (next: boolean) => {
    if (pending) return;
    setPending(true);
    const prev = localOn;
    setLocalOn(next);
    const toastId = `toggle-${level}-${rowId}`;
    toast.loading(`${next ? 'Activating' : 'Pausing'} on Meta…`, { id: toastId });
    try {
      const { data, error } = await supabase.functions.invoke('toggle-meta-status', {
        body: {
          clientId,
          level,
          rowId,
          status: next ? 'ACTIVE' : 'PAUSED',
        },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Meta toggle failed');
      toast.success(`${next ? 'Active' : 'Paused'} on Meta`, { id: toastId });
      qc.invalidateQueries({ queryKey: ['admin-meta-campaigns'] });
      qc.invalidateQueries({ queryKey: ['admin-meta-adsets'] });
      qc.invalidateQueries({ queryKey: ['admin-meta-ads'] });
    } catch (err: any) {
      setLocalOn(prev);
      toast.error(err?.message || 'Failed to update Meta status', { id: toastId });
    } finally {
      setPending(false);
    }
  };

  return (
    <div
      className="inline-flex items-center gap-1.5"
      onClick={(e) => e.stopPropagation()}
    >
      <Switch
        checked={localOn}
        disabled={pending}
        onCheckedChange={handleToggle}
        aria-label={localOn ? 'Pause on Meta' : 'Activate on Meta'}
      />
      <span className={cn(
        "text-[10px] font-medium uppercase tracking-wide",
        localOn ? "text-chart-2" : "text-muted-foreground"
      )}>
        {pending ? '…' : localOn ? 'On' : 'Off'}
      </span>
    </div>
  );
}

function AdCard({ ad, clientName, onClick }: { ad: any; clientName?: string; onClick?: () => void }) {
  const thumb = ad.full_image_url || ad.image_url || ad.video_thumbnail_url || ad.thumbnail_url;
  const isVideo = ad.media_type === 'video' || !!ad.video_source_url;
  const downloadUrl = ad.video_source_url || ad.full_image_url || ad.image_url || null;
  return (
    <Card className="overflow-hidden hover:shadow-md transition-shadow cursor-pointer" onClick={onClick}>
      <div className="aspect-square bg-muted relative overflow-hidden">
        {isVideo && ad.video_source_url ? (
          <video
            src={ad.video_source_url}
            poster={thumb || undefined}
            muted
            loop
            playsInline
            preload="metadata"
            className="w-full h-full object-cover"
            onMouseEnter={(e) => { (e.currentTarget as HTMLVideoElement).play().catch(() => {}); }}
            onMouseLeave={(e) => { const v = e.currentTarget as HTMLVideoElement; v.pause(); v.currentTime = 0; }}
          />
        ) : thumb ? (
          <img src={thumb} alt={ad.name} className="w-full h-full object-cover" loading="lazy" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <ImageIcon className="h-10 w-10 text-muted-foreground/30" />
          </div>
        )}
        <div className="absolute top-2 left-2 flex items-center gap-1">
          <StatusDot status={ad.status} />
        </div>
        <div className="absolute top-2 right-2 flex items-center gap-1">
          <div className="bg-background/90 backdrop-blur rounded-md px-1.5 py-1">
            <MetaStatusToggle
              clientId={ad.client_id}
              level="ad"
              rowId={ad.id}
              status={ad.status}
            />
          </div>
          {downloadUrl && (
            <a
              href={downloadUrl}
              download
              target="_blank"
              rel="noopener noreferrer"
              title="Download HD"
              className="bg-background/90 backdrop-blur rounded-md p-1.5 hover:bg-background"
              onClick={e => e.stopPropagation()}
            >
              <Download className="h-3 w-3" />
            </a>
          )}
          {ad.preview_url && (
            <a
              href={ad.preview_url}
              target="_blank"
              rel="noopener noreferrer"
              title="Open in Meta"
              className="bg-background/90 backdrop-blur rounded-md p-1.5 hover:bg-background"
              onClick={e => e.stopPropagation()}
            >
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      </div>
      <div className="p-2.5 space-y-1.5">
        <p className="text-xs font-medium truncate" title={ad.name}>{ad.name}</p>
        {clientName && <p className="text-[10px] text-muted-foreground truncate">{clientName}</p>}
        {ad.headline && <p className="text-[11px] line-clamp-1 text-foreground/80">{ad.headline}</p>}
        <div className="flex items-center justify-between text-[10px] pt-1 border-t border-border/50">
          <span className="text-muted-foreground">Spend</span>
          <span className="font-semibold tabular-nums">{fmt$(ad.spend)}</span>
        </div>
        <div className="flex items-center justify-between text-[10px]">
          <span className="text-muted-foreground">CTR · CPC</span>
          <span className="font-semibold tabular-nums">{fmtPct(ad.ctr)} · {fmt$(ad.cpc)}</span>
        </div>
        <div className="flex items-center justify-between text-[10px]">
          <span className="text-muted-foreground">Leads · CPL</span>
          {(() => {
            const leads = Number(ad.attributed_leads || 0) || Number(ad.meta_reported_leads || 0);
            const spend = Number(ad.spend || 0);
            const cpl = ad.cost_per_lead && Number(ad.cost_per_lead) > 0
              ? Number(ad.cost_per_lead)
              : (leads > 0 ? spend / leads : 0);
            return (
              <span className="font-semibold tabular-nums text-chart-2">
                {fmtN(leads)} · {cpl > 0 ? fmt$(cpl) : '—'}
              </span>
            );
          })()}
        </div>
        <div className="flex items-center justify-between text-[10px]">
          <span className="text-muted-foreground">Calls · CPC</span>
          {(() => {
            const calls = Number(ad.attributed_calls || 0);
            const spend = Number(ad.spend || 0);
            const cpCall = ad.cost_per_call && Number(ad.cost_per_call) > 0
              ? Number(ad.cost_per_call)
              : (calls > 0 ? spend / calls : 0);
            return (
              <span className="font-semibold tabular-nums text-chart-3">
                {fmtN(calls)} · {cpCall > 0 ? fmt$(cpCall) : '—'}
              </span>
            );
          })()}
        </div>
        <div className="flex items-center justify-between text-[10px]">
          <span className="text-muted-foreground">Funded · CPF</span>
          {(() => {
            const funded = Number(ad.attributed_funded || 0);
            const spend = Number(ad.spend || 0);
            const cpf = ad.cost_per_funded && Number(ad.cost_per_funded) > 0
              ? Number(ad.cost_per_funded)
              : (funded > 0 ? spend / funded : 0);
            return (
              <span className="font-semibold tabular-nums text-chart-4">
                {fmtN(funded)} · {cpf > 0 ? fmt$(cpf) : '—'}
              </span>
            );
          })()}
        </div>
      </div>
    </Card>
  );
}
