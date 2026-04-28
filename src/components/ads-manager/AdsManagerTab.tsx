import { useState, useMemo, useEffect, useRef } from 'react';
import { RefreshCw, Loader2, BarChart3, Play, Image as ImageIcon, Calendar, AlertTriangle, Trophy, Wand2, Download, Film } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SortableTableHeader, SortConfig } from '@/components/dashboard/SortableTableHeader';
import { useMetaCampaigns, useMetaAdSets, useMetaAds, useSyncMetaAds } from '@/hooks/useMetaAds';
import { useFetchAdMediaHD } from '@/hooks/useAdMediaHD';
import { useRunAttribution } from '@/hooks/useRunAttribution';
import { GenerateBriefButton } from '@/components/briefs/GenerateBriefButton';
import { useClientSettings } from '@/hooks/useClientSettings';
import { useCreateTask } from '@/hooks/useTasks';
import { useDateFilter } from '@/contexts/DateFilterContext';
import { formatDistanceToNow, addBusinessDays } from 'date-fns';
import { toast } from 'sonner';
import { InsightsPanel } from './shared/InsightsPanel';

interface AdsManagerTabProps {
  clientId: string;
  clientName?: string;
}

function StatusDot({ status }: { status: string | null }) {
  const s = (status || '').toUpperCase();
  const color = s === 'ACTIVE' ? 'bg-green-500' : s === 'PAUSED' ? 'bg-yellow-500' : 'bg-muted-foreground/40';
  return <span className={`inline-block w-2.5 h-2.5 rounded-full ${color}`} />;
}

function fmt$(val: number | null) {
  if (!val) return '$0';
  return `$${Number(val).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function fmtN(val: number | bigint | null) {
  if (!val) return '0';
  return Number(val).toLocaleString();
}
function fmtPct(val: number | null) {
  if (!val) return '0%';
  return `${Number(val).toFixed(2)}%`;
}

function isWinningAd(ad: any): boolean {
  const spend = Number(ad.spend) || 0;
  const fundedDollars = Number(ad.attributed_funded_dollars) || 0;
  const ctr = Number(ad.ctr) || 0;
  const roas = spend > 0 ? fundedDollars / spend : 0;
  return roas > 3 || (spend > 1000 && ctr > 1);
}

function calcROAS(ad: any): number {
  const spend = Number(ad.spend) || 0;
  const fundedDollars = Number(ad.attributed_funded_dollars) || 0;
  return spend > 0 ? fundedDollars / spend : 0;
}

function buildVariationBrief(ad: any): string {
  const spend = fmt$(ad.spend);
  const ctr = fmtPct(ad.ctr);
  const cpl = fmt$(ad.cost_per_lead);
  const cpa = fmt$(ad.cost_per_funded);
  const winning = isWinningAd(ad) ? ' (🏆 Winning Ad)' : '';
  return `Create variations of ad '${ad.name}'${winning}\n\nTest different headlines, hooks, and CTAs based on this creative's performance:\n• Spend: ${spend}\n• CTR: ${ctr}\n• CPL: ${cpl}\n• CPA: ${cpa}\n\nSuggested variations:\n1. New headline hook\n2. Different CTA angle\n3. Alternative opening copy`;
}

function sortData<T>(data: T[], sort: SortConfig): T[] {
  if (!sort.direction) return data;
  return [...data].sort((a: any, b: any) => {
    const aVal = a[sort.column] ?? 0;
    const bVal = b[sort.column] ?? 0;
    if (typeof aVal === 'string') return sort.direction === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
    return sort.direction === 'asc' ? Number(aVal) - Number(bVal) : Number(bVal) - Number(aVal);
  });
}

function useSort(defaultCol = 'spend') {
  const [sortConfig, setSortConfig] = useState<SortConfig>({ column: defaultCol, direction: 'desc' });
  const onSort = (column: string) => {
    setSortConfig(prev => ({
      column,
      direction: prev.column === column ? (prev.direction === 'desc' ? 'asc' : prev.direction === 'asc' ? null : 'desc') : 'desc',
    }));
  };
  return { sortConfig, onSort };
}

const METRIC_HEADERS = [
  { column: 'spend', label: 'Spend' },
  { column: 'impressions', label: 'Impr' },
  { column: 'cpm', label: 'CPM' },
  { column: 'clicks', label: 'Clicks' },
  { column: 'ctr', label: 'CTR' },
  { column: 'cpc', label: 'CPC' },
  { column: 'attributed_leads', label: 'Leads' },
  { column: 'attributed_spam_leads', label: 'Bad' },
  { column: 'cost_per_lead', label: 'CPL' },
  { column: 'attributed_calls', label: 'Calls' },
  { column: 'attributed_showed', label: 'Showed' },
  { column: 'attributed_funded', label: 'Funded' },
  { column: 'attributed_funded_dollars', label: 'Funded $' },
  { column: 'cost_per_funded', label: 'CPA' },
];

function MetricCells({ row }: { row: any }) {
  const spamCount = Number(row.attributed_spam_leads) || 0;
  return (
    <>
      <TableCell className="text-center tabular-nums font-medium">{fmt$(row.spend)}</TableCell>
      <TableCell className="text-center tabular-nums">{fmtN(row.impressions)}</TableCell>
      <TableCell className="text-center tabular-nums">{fmt$(row.cpm)}</TableCell>
      <TableCell className="text-center tabular-nums">{fmtN(row.clicks)}</TableCell>
      <TableCell className="text-center tabular-nums">{fmtPct(row.ctr)}</TableCell>
      <TableCell className="text-center tabular-nums">{fmt$(row.cpc)}</TableCell>
      <TableCell className="text-center tabular-nums">{fmtN(row.attributed_leads)}</TableCell>
      <TableCell className={`text-center tabular-nums ${spamCount > 0 ? 'text-destructive font-semibold' : ''}`}>
        {spamCount > 0 ? spamCount : '—'}
      </TableCell>
      <TableCell className="text-center tabular-nums">{fmt$(row.cost_per_lead)}</TableCell>
      <TableCell className="text-center tabular-nums">{fmtN(row.attributed_calls)}</TableCell>
      <TableCell className="text-center tabular-nums">{fmtN(row.attributed_showed)}</TableCell>
      <TableCell className="text-center tabular-nums">{fmtN(row.attributed_funded)}</TableCell>
      <TableCell className="text-center tabular-nums">{fmt$(row.attributed_funded_dollars)}</TableCell>
      <TableCell className="text-center tabular-nums">{fmt$(row.cost_per_funded)}</TableCell>
    </>
  );
}

// ── Variation Task Modal ──
function VariationTaskModal({
  ad,
  clientId,
  open,
  onClose,
}: {
  ad: any;
  clientId: string;
  open: boolean;
  onClose: () => void;
}) {
  const [brief, setBrief] = useState('');
  const [variationCount, setVariationCount] = useState('3');
  const createTask = useCreateTask();

  useEffect(() => {
    if (ad && open) {
      setBrief(buildVariationBrief(ad));
    }
  }, [ad, open]);

  const handleCreate = async () => {
    if (!brief.trim()) return;
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 1);
    await createTask.mutateAsync({
      title: `Create ${variationCount} variations of '${(ad?.name || 'Ad').substring(0, 60)}'`,
      description: brief,
      client_id: clientId,
      priority: isWinningAd(ad) ? 'high' : 'medium',
      stage: 'todo',
      status: 'todo',
      due_date: dueDate.toISOString().split('T')[0],
    });
    toast.success(`Variation task created (${variationCount} variations)`);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-lg">
        <DialogTitle className="text-sm font-semibold flex items-center gap-2">
          <Wand2 className="h-4 w-4" />
          Create Ad Variations Task
          {ad && isWinningAd(ad) && (
            <Badge variant="default" className="text-[10px] gap-1">
              <Trophy className="h-3 w-3" /> Winning Ad
            </Badge>
          )}
        </DialogTitle>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Variations to create</label>
            <Select value={variationCount} onValueChange={setVariationCount}>
              <SelectTrigger className="h-8 w-24 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="3">3</SelectItem>
                <SelectItem value="5">5</SelectItem>
                <SelectItem value="10">10</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Brief</label>
            <Textarea value={brief} onChange={e => setBrief(e.target.value)} rows={8} className="text-xs" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={handleCreate} disabled={createTask.isPending || !brief.trim()}>
            {createTask.isPending ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Wand2 className="h-3 w-3 mr-1" />}
            Create Task
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AdsManagerTab({ clientId, clientName = 'Client' }: AdsManagerTabProps) {
  const [activeTab, setActiveTab] = useState('campaigns');
  const [filterCampaignId, setFilterCampaignId] = useState<string | null>(null);
  const [filterAdSetId, setFilterAdSetId] = useState<string | null>(null);
  const lastSyncedRange = useRef<string | null>(null);

  const { data: campaigns = [], isLoading: cLoading } = useMetaCampaigns(clientId);
  const { data: allAdSets = [], isLoading: asLoading } = useMetaAdSets(clientId);
  const { data: allAds = [], isLoading: adLoading } = useMetaAds(clientId);
  const { data: settings } = useClientSettings(clientId);
  const { startDate, endDate } = useDateFilter();
  const syncMutation = useSyncMetaAds();
  const attributionMutation = useRunAttribution();

  const currentRangeKey = `${startDate}_${endDate}`;

  useEffect(() => {
    const hasCredentials = (settings as any)?.meta_ads_sync_enabled || 
      ((settings as any) && (settings as any).meta_ads_last_sync);
    
    if (!hasCredentials) return;
    if (syncMutation.isPending) return;
    if (lastSyncedRange.current === currentRangeKey) return;
    
    lastSyncedRange.current = currentRangeKey;
    syncMutation.mutate({ clientId, startDate, endDate });
  }, [currentRangeKey, clientId, settings]);

  const lastSync = (settings as any)?.meta_ads_last_sync
    ? formatDistanceToNow(new Date((settings as any).meta_ads_last_sync), { addSuffix: true })
    : null;

  const activeCampaigns = useMemo(() => campaigns.filter((c: any) => c.spend && Number(c.spend) > 0), [campaigns]);
  const adSets = useMemo(() => {
    const filtered = filterCampaignId ? allAdSets.filter((a: any) => a.campaign_id === filterCampaignId) : allAdSets;
    return filtered.filter((a: any) => a.spend && Number(a.spend) > 0);
  }, [allAdSets, filterCampaignId]);
  const ads = useMemo(() => {
    const filtered = filterAdSetId ? allAds.filter((a: any) => a.ad_set_id === filterAdSetId) : allAds;
    return filtered.filter((a: any) => a.spend && Number(a.spend) > 0);
  }, [allAds, filterAdSetId]);

  const filterCampaignName = filterCampaignId ? campaigns.find((c: any) => c.id === filterCampaignId)?.name : null;
  const filterAdSetName = filterAdSetId ? allAdSets.find((a: any) => a.id === filterAdSetId)?.name : null;

  const handleSync = () => {
    lastSyncedRange.current = currentRangeKey;
    syncMutation.mutate({ clientId, startDate, endDate });
  };

  const handleAttribution = () => {
    attributionMutation.mutate({ clientId, startDate, endDate });
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-bold tracking-tight">Ads Manager</h2>
          <Badge variant="outline" className="text-xs font-medium">{activeCampaigns.length} campaigns</Badge>
          {syncMutation.isPending ? (
            <span className="text-xs text-muted-foreground flex items-center gap-1.5">
              <Loader2 className="h-3 w-3 animate-spin" />
              Syncing for {startDate} → {endDate}...
            </span>
          ) : lastSync ? (
            <span className="text-xs text-muted-foreground">Synced {lastSync}</span>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="text-xs gap-1.5">
            <Calendar className="h-3 w-3" />
            {startDate} → {endDate}
          </Badge>
          <Button size="sm" variant="outline" onClick={handleAttribution} disabled={attributionMutation.isPending}>
            {attributionMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <BarChart3 className="h-4 w-4 mr-2" />}
            Run Attribution
          </Button>
          <Button size="sm" onClick={handleSync} disabled={syncMutation.isPending}>
            {syncMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
            Sync Meta Ads
          </Button>
          <GenerateBriefButton
            clientId={clientId}
            clientName={clientName}
            getTopAds={() => {
              const sorted = [...allAds].sort((a: any, b: any) => {
                const roasA = Number(a.spend) > 0 ? (Number(a.attributed_funded_dollars) || 0) / Number(a.spend) : 0;
                const roasB = Number(b.spend) > 0 ? (Number(b.attributed_funded_dollars) || 0) / Number(b.spend) : 0;
                return roasB - roasA;
              });
              return sorted.slice(0, 5);
            }}
          />
        </div>
      </div>

      {/* Filter badges */}
      {(filterCampaignName || filterAdSetName) && (
        <div className="flex items-center gap-2 flex-wrap">
          {filterCampaignName && (
            <Badge variant="secondary" className="cursor-pointer hover:bg-destructive/10 transition-colors" onClick={() => { setFilterCampaignId(null); setFilterAdSetId(null); setActiveTab('campaigns'); }}>
              Campaign: {filterCampaignName} ✕
            </Badge>
          )}
          {filterAdSetName && (
            <Badge variant="secondary" className="cursor-pointer hover:bg-destructive/10 transition-colors" onClick={() => { setFilterAdSetId(null); setActiveTab('adsets'); }}>
              Ad Set: {filterAdSetName} ✕
            </Badge>
          )}
        </div>
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="campaigns">Campaigns</TabsTrigger>
          <TabsTrigger value="adsets">Ad Sets {filterCampaignName ? `(${adSets.length})` : ''}</TabsTrigger>
          <TabsTrigger value="ads">Ads {filterAdSetName ? `(${ads.length})` : ''}</TabsTrigger>
        </TabsList>

        <div className="mt-3">
          <InsightsPanel ads={ads} campaigns={activeCampaigns} />
        </div>

        <TabsContent value="campaigns">
          <CampaignsTable data={activeCampaigns} isLoading={cLoading} onSelect={(id) => { setFilterCampaignId(id); setFilterAdSetId(null); setActiveTab('adsets'); }} />
        </TabsContent>
        <TabsContent value="adsets">
          <AdSetsTable data={adSets} isLoading={asLoading} onSelect={(id) => { setFilterAdSetId(id); setActiveTab('ads'); }} />
        </TabsContent>
        <TabsContent value="ads">
          <AdsTable data={ads} isLoading={adLoading} clientId={clientId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function CampaignsTable({ data, isLoading, onSelect }: { data: any[]; isLoading: boolean; onSelect: (id: string) => void }) {
  const { sortConfig, onSort } = useSort();
  const sorted = useMemo(() => sortData(data, sortConfig), [data, sortConfig]);

  if (isLoading) return <LoadingState />;
  if (data.length === 0) return <EmptyState />;

  return (
    <div className="rounded-lg border bg-card overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="font-bold text-sm min-w-[320px] sticky left-0 bg-card z-10">Campaign</TableHead>
            <SortableTableHeader column="status" label="Status" sortConfig={sortConfig} onSort={onSort} />
            {METRIC_HEADERS.map(h => (
              <SortableTableHeader key={h.column} column={h.column} label={h.label} sortConfig={sortConfig} onSort={onSort} />
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((c: any) => (
            <TableRow key={c.id} className="cursor-pointer hover:bg-muted/50 transition-colors" onClick={() => onSelect(c.id)}>
              <TableCell className="font-medium sticky left-0 bg-card z-10">
                <span className="whitespace-normal break-words leading-snug">{c.name}</span>
              </TableCell>
              <TableCell className="text-center"><StatusDot status={c.status} /></TableCell>
              <MetricCells row={c} />
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function AdSetsTable({ data, isLoading, onSelect }: { data: any[]; isLoading: boolean; onSelect: (id: string) => void }) {
  const { sortConfig, onSort } = useSort();
  const sorted = useMemo(() => sortData(data, sortConfig), [data, sortConfig]);

  if (isLoading) return <LoadingState />;
  if (data.length === 0) return <EmptyState />;

  return (
    <div className="rounded-lg border bg-card overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="font-bold text-sm min-w-[320px] sticky left-0 bg-card z-10">Ad Set</TableHead>
            <SortableTableHeader column="effective_status" label="Status" sortConfig={sortConfig} onSort={onSort} />
            {METRIC_HEADERS.map(h => (
              <SortableTableHeader key={h.column} column={h.column} label={h.label} sortConfig={sortConfig} onSort={onSort} />
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((a: any) => (
            <TableRow key={a.id} className="cursor-pointer hover:bg-muted/50 transition-colors" onClick={() => onSelect(a.id)}>
              <TableCell className="font-medium sticky left-0 bg-card z-10">
                <span className="whitespace-normal break-words leading-snug">{a.name}</span>
              </TableCell>
              <TableCell className="text-center"><StatusDot status={a.effective_status || a.status} /></TableCell>
              <MetricCells row={a} />
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function AdsTable({ data, isLoading, clientId }: { data: any[]; isLoading: boolean; clientId: string }) {
  const { sortConfig, onSort } = useSort();
  const sorted = useMemo(() => sortData(data, sortConfig), [data, sortConfig]);
  const [previewAd, setPreviewAd] = useState<any | null>(null);
  const [variationAd, setVariationAd] = useState<any | null>(null);
  const createTask = useCreateTask();
  const fetchHD = useFetchAdMediaHD();

  if (isLoading) return <LoadingState />;
  if (data.length === 0) return <EmptyState />;

  const getCreativeUrl = (ad: any) => ad.full_image_url || ad.image_url || ad.thumbnail_url || null;
  const getHDUrl = (ad: any) => ad.video_source_url || ad.full_image_url || null;

  const handleCreateVariationFromPreview = async () => {
    if (!previewAd) return;
    setVariationAd(previewAd);
    setPreviewAd(null);
  };

  return (
    <>
      <div className="rounded-lg border bg-card overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="font-bold text-sm min-w-[380px] sticky left-0 bg-card z-10">Ad Creative</TableHead>
              <SortableTableHeader column="effective_status" label="Status" sortConfig={sortConfig} onSort={onSort} />
              {METRIC_HEADERS.map(h => (
                <SortableTableHeader key={h.column} column={h.column} label={h.label} sortConfig={sortConfig} onSort={onSort} />
              ))}
              <TableHead className="text-center w-[50px]">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((a: any) => {
              const creativeUrl = getCreativeUrl(a);
              const isVideo = a.media_type === 'video';
              const winning = isWinningAd(a);
              return (
                <TableRow key={a.id} className="hover:bg-muted/50 transition-colors">
                  <TableCell className="font-medium sticky left-0 bg-card z-10">
                    <div className="flex items-center gap-3">
                      {/* Thumbnail */}
                      {creativeUrl ? (
                        <div
                          className="relative w-12 h-12 rounded-md overflow-hidden flex-shrink-0 cursor-pointer border border-border hover:opacity-80 transition-opacity"
                          onClick={() => setPreviewAd(a)}
                        >
                          <img src={creativeUrl} alt="" className="w-full h-full object-cover" />
                          {isVideo && (
                            <div className="absolute inset-0 flex items-center justify-center bg-background/40">
                              <Play className="h-4 w-4 text-foreground" fill="currentColor" />
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="w-12 h-12 rounded-md bg-muted flex items-center justify-center flex-shrink-0 cursor-pointer" onClick={() => setPreviewAd(a)}>
                          <ImageIcon className="h-5 w-5 text-muted-foreground" />
                        </div>
                      )}
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="whitespace-normal break-words leading-snug text-sm">{a.name}</span>
                          {winning && <Trophy className="h-3.5 w-3.5 text-yellow-500 flex-shrink-0" />}
                        </div>
                        {(a.headline || a.body) && (
                          <span className="text-[11px] text-muted-foreground line-clamp-1 mt-0.5 block">
                            {a.headline || a.body}
                          </span>
                        )}
                        {isVideo && <span className="text-[10px] text-muted-foreground">Video</span>}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-center"><StatusDot status={a.effective_status || a.status} /></TableCell>
                  <MetricCells row={a} />
                  <TableCell className="text-center">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      title="Create variations task"
                      onClick={(e) => { e.stopPropagation(); setVariationAd(a); }}
                    >
                      <Wand2 className="h-3.5 w-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* Enhanced Creative Preview Modal */}
      <Dialog open={!!previewAd} onOpenChange={() => setPreviewAd(null)}>
        <DialogContent className="max-w-lg">
          <DialogTitle className="text-sm font-semibold flex items-center gap-2">
            {previewAd?.name}
            {previewAd && isWinningAd(previewAd) && (
              <Badge variant="default" className="text-[10px] gap-1">
                <Trophy className="h-3 w-3" /> Winning Ad
              </Badge>
            )}
          </DialogTitle>
          {previewAd && (
            <div className="space-y-3">
              {/* HD Video Player or Full-Res Image */}
              {previewAd.video_source_url ? (
                <div className="rounded-lg overflow-hidden border border-border bg-muted">
                  <video
                    src={previewAd.video_source_url}
                    controls
                    poster={previewAd.full_image_url || previewAd.image_url || previewAd.thumbnail_url}
                    className="w-full max-h-[400px]"
                  />
                </div>
              ) : getCreativeUrl(previewAd) ? (
                <div className="rounded-lg overflow-hidden border border-border bg-muted">
                  <img
                    src={getCreativeUrl(previewAd)}
                    alt={previewAd.name}
                    className="w-full h-auto max-h-[400px] object-contain"
                  />
                </div>
              ) : null}

              {/* Headline */}
              {previewAd.headline && (
                <p className="text-sm font-medium">{previewAd.headline}</p>
              )}
              {previewAd.body && (
                <p className="text-xs text-muted-foreground line-clamp-3">{previewAd.body}</p>
              )}

              {/* Metrics grid */}
              <div className="grid grid-cols-5 gap-2 text-center text-xs">
                <div className="p-2 rounded-md bg-muted">
                  <div className="text-muted-foreground">Spend</div>
                  <div className="font-semibold">{fmt$(previewAd.spend)}</div>
                </div>
                <div className="p-2 rounded-md bg-muted">
                  <div className="text-muted-foreground">ROAS</div>
                  <div className="font-semibold">{calcROAS(previewAd).toFixed(2)}x</div>
                </div>
                <div className="p-2 rounded-md bg-muted">
                  <div className="text-muted-foreground">CTR</div>
                  <div className="font-semibold">{fmtPct(previewAd.ctr)}</div>
                </div>
                <div className="p-2 rounded-md bg-muted">
                  <div className="text-muted-foreground">CPL</div>
                  <div className="font-semibold">{fmt$(previewAd.cost_per_lead)}</div>
                </div>
                <div className="p-2 rounded-md bg-muted">
                  <div className="text-muted-foreground">CPA</div>
                  <div className="font-semibold">{fmt$(previewAd.cost_per_funded)}</div>
                </div>
              </div>

              {/* Action buttons */}
              <div className="flex gap-2">
                {getHDUrl(previewAd) ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1 gap-2"
                    onClick={() => window.open(getHDUrl(previewAd), '_blank')}
                  >
                    <Download className="h-3.5 w-3.5" />
                    Download HD
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1 gap-2"
                    disabled={fetchHD.isPending}
                    onClick={() => fetchHD.mutate({ clientId, adId: previewAd.id })}
                  >
                    {fetchHD.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Film className="h-3.5 w-3.5" />}
                    Fetch HD
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1 gap-2"
                  onClick={handleCreateVariationFromPreview}
                >
                  <Wand2 className="h-3.5 w-3.5" />
                  Create Variations
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Variation Task Modal */}
      <VariationTaskModal
        ad={variationAd}
        clientId={clientId}
        open={!!variationAd}
        onClose={() => setVariationAd(null)}
      />
    </>
  );
}

function LoadingState() {
  return (
    <div className="flex items-center justify-center py-12">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <BarChart3 className="h-12 w-12 text-muted-foreground mb-4 opacity-50" />
      <p className="text-muted-foreground">No data synced yet. Click 'Sync Meta Ads' to pull data.</p>
    </div>
  );
}
