import { useState, useMemo, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAgencyMembers } from '@/hooks/useTasks';
import { useDateFilter } from '@/contexts/DateFilterContext';
import { differenceInDays, subDays, format } from 'date-fns';
import { Client, useUpdateClient } from '@/hooks/useClients';
import { useClientAssignments, useUpdateClientAssignment } from '@/hooks/useClientAssignments';
import { AggregatedMetrics } from '@/hooks/useMetrics';
import { KPIThresholds, ClientSettings, useUpdateClientSettings } from '@/hooks/useClientSettings';
import { getEffectiveMonthlyTarget } from '@/hooks/useClientSettings';
import { calculateClientRevenue } from '@/hooks/useClientMRR';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Settings, ExternalLink, Copy, Trash2, GripVertical, BarChart3, ArrowUp, ArrowDown, ArrowUpDown, AlertCircle, CheckCircle, Clock, XCircle, AlertTriangle, Pencil, RefreshCw, Sparkles, BarChart, FileSpreadsheet, FileText, Palette, Layers, Activity as ActivityIcon } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { SortConfig } from './SortableTableHeader';
import { formatDistanceToNow } from 'date-fns';
import { ClientApiStatus } from '@/hooks/useApiConnectionTest';
import { ApiConnectionStatus } from '@/components/settings/ApiConnectionStatus';
import { SyncHistoryModal } from '@/components/dashboard/SyncHistoryModal';

interface DraggableClientTableProps {
  clients: Client[];
  metrics: Record<string, AggregatedMetrics>;
  thresholds: Record<string, KPIThresholds>;
  fullSettings?: Record<string, ClientSettings>;
  onOpenSettings: (client: Client) => void;
  onOpenSheetSettings?: (client: Client) => void;
  onDeleteClient?: (client: Client) => void;
  onReorder?: (orderedClientIds: string[]) => void;
  isAdmin?: boolean;
  apiTestResults?: ClientApiStatus;
}

// Helper function to get CRM sync status from client data
function getClientSyncStatus(client: Client): {
  status: 'healthy' | 'stale' | 'error' | 'not_configured';
  lastSyncAt: string | null;
  error: string | null;
  source: 'ghl' | 'hubspot' | 'none';
} {
  const hasGhlCredentials = !!(client.ghl_api_key && client.ghl_location_id);
  const hasHubspotCredentials = !!(client.hubspot_portal_id && client.hubspot_access_token);

  // Derive status purely from timestamps — never trust stale ghl_sync_status column
  const computeStatus = (lastSync: string | null): 'healthy' | 'stale' | 'error' | 'not_configured' => {
    if (!lastSync) return 'error';
    const hoursSince = (Date.now() - new Date(lastSync).getTime()) / (1000 * 60 * 60);
    if (hoursSince <= 24) return 'healthy';
    if (hoursSince <= 72) return 'stale';
    return 'error';
  };

  if (hasHubspotCredentials) {
    return {
      status: computeStatus(client.last_hubspot_sync_at),
      lastSyncAt: client.last_hubspot_sync_at,
      error: client.hubspot_sync_error,
      source: 'hubspot',
    };
  }

  if (hasGhlCredentials) {
    return {
      status: computeStatus(client.last_ghl_sync_at),
      lastSyncAt: client.last_ghl_sync_at,
      error: client.ghl_sync_error,
      source: 'ghl',
    };
  }

  return { status: 'not_configured', lastSyncAt: null, error: null, source: 'none' };
}

// Get Meta sync status from client settings
function getMetaSyncStatus(settings: ClientSettings | undefined, client: Client): {
  status: 'healthy' | 'stale' | 'not_synced';
  lastSyncAt: string | null;
} {
  const hasMetaAccount = !!client.meta_ad_account_id;
  if (!hasMetaAccount) return { status: 'not_synced', lastSyncAt: null };

  const lastSync = (settings as any)?.meta_ads_last_sync || null;
  if (!lastSync) return { status: 'not_synced', lastSyncAt: null };

  const hoursSince = (Date.now() - new Date(lastSync).getTime()) / (1000 * 60 * 60);
  if (hoursSince <= 24) return { status: 'healthy', lastSyncAt: lastSync };
  return { status: 'stale', lastSyncAt: lastSync };
}

// Compute bottleneck from conversion rates
function computeBottleneck(
  leadToBooked: number,
  bookedToShowed: number,
  showedToFunded: number,
): { label: string; value: number } | null {
  const stages = [
    { label: 'L→B', value: leadToBooked },
    { label: 'B→S', value: bookedToShowed },
    { label: 'S→F', value: showedToFunded },
  ].filter(s => s.value >= 0 && isFinite(s.value));

  if (stages.length === 0) return null;
  return stages.reduce((min, s) => (s.value < min.value ? s : min), stages[0]);
}

function getSyncBorderStyle(status: 'healthy' | 'stale' | 'error' | 'not_configured'): string {
  switch (status) {
    default:
      return '';
  }
}

// Row tint when integration is missing — faded red so it's actionable at a glance
function getMissingIntegrationRowStyle(client: Client): string {
  return '';
}

export function DraggableClientTable({
  clients,
  metrics,
  thresholds,
  fullSettings = {},
  onOpenSettings,
  onOpenSheetSettings,
  onDeleteClient,
  onReorder,
  isAdmin = false,
  apiTestResults = {},
}: DraggableClientTableProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { dateRange } = useDateFilter();
  const numberOfDays = useMemo(() => differenceInDays(dateRange.to, dateRange.from) + 1, [dateRange]);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [sortConfig, setSortConfig] = useState<SortConfig>({ column: '', direction: null });
  const [syncHistoryClient, setSyncHistoryClient] = useState<{ id: string; name: string } | null>(null);
  const [syncingGhl, setSyncingGhl] = useState<Record<string, boolean>>({});
  const [syncingMeta, setSyncingMeta] = useState<Record<string, boolean>>({});
  const [enriching, setEnriching] = useState<Record<string, boolean>>({});
  const updateClient = useUpdateClient();
  const { data: assignments = {} } = useClientAssignments();
  const updateAssignment = useUpdateClientAssignment();
  const { data: agencyMembers = [] } = useAgencyMembers();

  // Quick-links presence counts (creatives + funnel campaigns) per client
  const { data: creativeCounts = {} } = useQuery({
    queryKey: ['quicklinks-creative-counts'],
    queryFn: async () => {
      const { data, error } = await supabase.from('creatives').select('client_id');
      if (error) throw error;
      const map: Record<string, number> = {};
      (data || []).forEach((r: any) => { if (r.client_id) map[r.client_id] = (map[r.client_id] || 0) + 1; });
      return map;
    },
    staleTime: 60_000,
  });
  const { data: funnelCounts = {} } = useQuery({
    queryKey: ['quicklinks-funnel-counts'],
    queryFn: async () => {
      const { data, error } = await supabase.from('funnel_campaigns').select('client_id');
      if (error) throw error;
      const map: Record<string, number> = {};
      (data || []).forEach((r: any) => { if (r.client_id) map[r.client_id] = (map[r.client_id] || 0) + 1; });
      return map;
    },
    staleTime: 60_000,
  });

  const handleSyncGhlClient = async (e: React.MouseEvent, clientId: string, clientName: string) => {
    e.stopPropagation();
    setSyncingGhl(prev => ({ ...prev, [clientId]: true }));
    try {
      const sinceDateDays = Math.max(1, Math.ceil((Date.now() - dateRange.from.getTime()) / (1000 * 60 * 60 * 24)));
      const { data, error } = await supabase.functions.invoke('sync-ghl-contacts', {
        body: { client_id: clientId, sinceDateDays },
      });
      if (error) throw error;
      const created = data?.created ?? 0;
      const updated = data?.updated ?? 0;
      toast.success(`${clientName}: synced ${created} new, ${updated} updated contacts`);
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      queryClient.invalidateQueries({ queryKey: ['calls'] });
    } catch (err: any) {
      toast.error(`GHL sync failed for ${clientName}: ${err.message || 'Unknown error'}`);
    } finally {
      setSyncingGhl(prev => ({ ...prev, [clientId]: false }));
    }
  };

  const handleSyncMetaClient = async (e: React.MouseEvent, clientId: string, clientName: string) => {
    e.stopPropagation();
    setSyncingMeta(prev => ({ ...prev, [clientId]: true }));
    try {
      const { error } = await supabase.functions.invoke('sync-meta-ads', {
        body: { client_id: clientId },
      });
      if (error) throw error;
      toast.success(`${clientName}: Meta ads synced`);
      queryClient.invalidateQueries({ queryKey: ['daily-metrics'] });
      queryClient.invalidateQueries({ queryKey: ['meta_ads'] });
    } catch (err: any) {
      toast.error(`Meta sync failed for ${clientName}: ${err.message || 'Unknown error'}`);
    } finally {
      setSyncingMeta(prev => ({ ...prev, [clientId]: false }));
    }
  };

  const handleEnrichClient = async (e: React.MouseEvent, clientId: string, clientName: string) => {
    e.stopPropagation();
    setEnriching(prev => ({ ...prev, [clientId]: true }));
    try {
      const { error } = await supabase.functions.invoke('enrich-leads', {
        body: { client_id: clientId },
      });
      if (error) throw error;
      toast.success(`${clientName}: enrichment started`);
      queryClient.invalidateQueries({ queryKey: ['leads'] });
    } catch (err: any) {
      toast.error(`Enrich failed for ${clientName}: ${err.message || 'Unknown error'}`);
    } finally {
      setEnriching(prev => ({ ...prev, [clientId]: false }));
    }
  };

  // Fetch yesterday's metrics to flag inactive clients
  const yesterday = useMemo(() => format(subDays(new Date(), 1), 'yyyy-MM-dd'), []);
  const { data: yesterdayMetrics = [] } = useQuery({
    queryKey: ['yesterday-metrics', yesterday],
    queryFn: async () => {
      const { data } = await supabase
        .from('daily_metrics')
        .select('client_id, ad_spend, leads')
        .eq('date', yesterday);
      return data || [];
    },
    staleTime: 1000 * 60 * 10,
  });

  const inactiveClientIds = useMemo(() => {
    const set = new Set<string>();
    const clientIdsInTable = new Set(clients.map(c => c.id));
    const clientsWithData = new Set(yesterdayMetrics.map((m: any) => m.client_id));
    clientIdsInTable.forEach(id => {
      if (!clientsWithData.has(id)) set.add(id);
    });
    yesterdayMetrics.forEach((m: any) => {
      if ((m.ad_spend ?? 0) === 0 && (m.leads ?? 0) === 0) {
        set.add(m.client_id);
      }
    });
    return set;
  }, [yesterdayMetrics, clients]);
  const duplicateMetaAccounts = useMemo(() => {
    const counts: Record<string, number> = {};
    clients.forEach(c => {
      if (c.meta_ad_account_id) {
        counts[c.meta_ad_account_id] = (counts[c.meta_ad_account_id] || 0) + 1;
      }
    });
    return new Set(Object.keys(counts).filter(k => counts[k] > 1));
  }, [clients]);

  const clientsWithComputedValues = useMemo(() => {
    return clients.map(client => {
      const m = metrics[client.id] || {} as AggregatedMetrics;
      const s = fullSettings[client.id];

      const leadToBooked = (m.totalLeads || 0) > 0 ? ((m.totalCalls || 0) / (m.totalLeads || 1)) * 100 : 0;
      const bookedToShowed = (m.totalCalls || 0) > 0 ? ((m.showedCalls || 0) / (m.totalCalls || 1)) * 100 : 0;
      const showedToFunded = (m.showedCalls || 0) > 0 ? ((m.fundedInvestors || 0) / (m.showedCalls || 1)) * 100 : 0;
      const bottleneck = computeBottleneck(leadToBooked, bookedToShowed, showedToFunded);
      const metaSync = getMetaSyncStatus(s, client);
      // Total projected MRR = base MRR + projected ad spend fees on monthly target
      const baseMrr = (s as any)?.mrr || 0;
      const monthlyTarget = s ? getEffectiveMonthlyTarget(s) : 0;
      const mrr = s
        ? calculateClientRevenue(
            baseMrr,
            monthlyTarget,
            s.ad_spend_fee_threshold || 30000,
            s.ad_spend_fee_percent || 10
          )
        : baseMrr;
      // Calculate effective daily ad spend target
      const dailyTarget = (() => {
        if (!s) return 0;
        if (s.daily_ad_spend_target && s.daily_ad_spend_target > 0) return s.daily_ad_spend_target;
        const now = new Date();
        const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
        return (s.monthly_ad_spend_target || 0) / daysInMonth;
      })();

      return {
        client,
        metrics: m,
        computed: {
          leadToBooked,
          bookedToShowed,
          showedToFunded,
          bottleneck,
          metaSync,
          mrr,
          dailyTarget,
        },
      };
    });
  }, [clients, metrics, fullSettings]);

  const sortedClients = useMemo(() => {
    if (!sortConfig.column || !sortConfig.direction) {
      return clientsWithComputedValues;
    }

    return [...clientsWithComputedValues].sort((a, b) => {
      let aVal: number = 0;
      let bVal: number = 0;

      // String-based sorts (Status, MB, AM)
      const strSort = (av: string, bv: string) =>
        sortConfig.direction === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      if (sortConfig.column === 'status') {
        return strSort(a.client.status || '', b.client.status || '');
      }
      if (sortConfig.column === 'mediaBuyer') {
        return strSort(assignments[a.client.id]?.media_buyer || '', assignments[b.client.id]?.media_buyer || '');
      }
      if (sortConfig.column === 'accountManager') {
        return strSort(assignments[a.client.id]?.account_manager || '', assignments[b.client.id]?.account_manager || '');
      }

      switch (sortConfig.column) {
        case 'adSpend': aVal = a.computed.monthlyTarget || 0; bVal = b.computed.monthlyTarget || 0; break;
        case 'metaLeads': aVal = a.metrics.totalLeads || 0; bVal = b.metrics.totalLeads || 0; break;
        case 'cpl': aVal = a.metrics.costPerLead || 0; bVal = b.metrics.costPerLead || 0; break;
        case 'costPerCall': aVal = a.metrics.costPerCall || 0; bVal = b.metrics.costPerCall || 0; break;
        case 'costOfCapital': aVal = a.metrics.costOfCapital || 0; bVal = b.metrics.costOfCapital || 0; break;
        case 'mrr': aVal = a.computed.mrr; bVal = b.computed.mrr; break;
        case 'dailyTarget': aVal = a.computed.dailyTarget; bVal = b.computed.dailyTarget; break;
        case 'crmLeads': aVal = (a.metrics.totalLeads || 0) + (a.metrics.spamLeads || 0); bVal = (b.metrics.totalLeads || 0) + (b.metrics.spamLeads || 0); break;
        case 'calls': aVal = a.metrics.totalCalls || 0; bVal = b.metrics.totalCalls || 0; break;
        case 'showed': aVal = a.metrics.showedCalls || 0; bVal = b.metrics.showedCalls || 0; break;
        case 'showRate': aVal = a.metrics.showedPercent || 0; bVal = b.metrics.showedPercent || 0; break;
        case 'funded': aVal = a.metrics.fundedInvestors || 0; bVal = b.metrics.fundedInvestors || 0; break;
        case 'fundedDollars': aVal = a.metrics.fundedDollars || 0; bVal = b.metrics.fundedDollars || 0; break;
        case 'ltb': aVal = a.computed.leadToBooked; bVal = b.computed.leadToBooked; break;
        case 'bts': aVal = a.computed.bookedToShowed; bVal = b.computed.bookedToShowed; break;
        case 'stf': aVal = a.computed.showedToFunded; bVal = b.computed.showedToFunded; break;
        default: return 0;
      }

      return sortConfig.direction === 'asc' ? aVal - bVal : bVal - aVal;
    });
  }, [clientsWithComputedValues, sortConfig, assignments]);

  const handleSort = (column: string) => {
    setSortConfig(prev => {
      if (prev.column === column) {
        if (prev.direction === 'asc') return { column, direction: 'desc' };
        if (prev.direction === 'desc') return { column: '', direction: null };
        return { column, direction: 'desc' };
      }
      return { column, direction: 'desc' };
    });
  };

  const handleSaveOrderAfterSort = () => {
    if (sortConfig.column && sortConfig.direction && onReorder) {
      onReorder(sortedClients.map(c => c.client.id));
    }
  };

  const formatCurrency = (val: number) =>
    `$${val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const formatCurrencyShort = (val: number) =>
    val >= 1000 ? `$${(val / 1000).toFixed(1)}k` : `$${val.toFixed(0)}`;

  const formatPercent = (val: number) => `${val.toFixed(1)}%`;

  const copyPublicLink = (token: string) => {
    const url = `${window.location.origin}/public/${token}`;
    navigator.clipboard.writeText(url);
    toast.success('Public link copied to clipboard');
  };

  const getThresholdColor = (value: number, threshold?: { yellow: number; red: number }): string => {
    if (!threshold) return '';
    if (value >= threshold.red) return 'text-destructive font-semibold';
    if (value >= threshold.yellow) return 'text-yellow-600 dark:text-yellow-500 font-semibold';
    return 'text-chart-2';
  };

  const getConversionColor = (value: number): string => {
    if (value >= 50) return 'text-chart-2 font-semibold';
    if (value >= 20) return 'text-yellow-600 dark:text-yellow-500';
    if (value > 0) return 'text-destructive';
    return 'text-muted-foreground';
  };

  const handleDragStart = (e: React.DragEvent, clientId: string) => {
    setDraggedId(clientId);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    if (!draggedId || draggedId === targetId) return;
    const draggedIndex = sortedClients.findIndex(c => c.client.id === draggedId);
    const targetIndex = sortedClients.findIndex(c => c.client.id === targetId);
    const newOrder = [...sortedClients];
    const [removed] = newOrder.splice(draggedIndex, 1);
    newOrder.splice(targetIndex, 0, removed);
    setSortConfig({ column: '', direction: null });
    onReorder?.(newOrder.map(c => c.client.id));
    setDraggedId(null);
  };

  const handleDragEnd = () => {
    setDraggedId(null);
  };

  const openAdsManager = (e: React.MouseEvent, url: string | null) => {
    e.stopPropagation();
    if (url) {
      window.open(url, '_blank');
    } else {
      toast.error('No Ads Manager URL configured for this client');
    }
  };

  const handleStatusChange = async (clientId: string, newStatus: string) => {
    try {
      await updateClient.mutateAsync({ id: clientId, status: newStatus as any });
      toast.success('Status updated');
    } catch (error) {
      toast.error('Failed to update status');
    }
  };

  return (
    <div className="space-y-2">
      {sortConfig.column && sortConfig.direction && (
        <div className="flex items-center justify-between px-2 py-1 bg-muted/50 rounded border border-border">
          <span className="text-xs text-muted-foreground">
            Sorted by <strong>{sortConfig.column}</strong> ({sortConfig.direction === 'asc' ? 'Low → High' : 'High → Low'})
          </span>
          <Button variant="outline" size="sm" className="h-5 text-[10px]" onClick={handleSaveOrderAfterSort}>
            Save Order
          </Button>
        </div>
      )}
      <div className="border border-border bg-card overflow-x-auto scrollbar-thin">
        <Table className="min-w-[1100px]">
          <TableHeader>
            <TableRow className="border-b h-7">
              <TableHead className="w-7 sticky left-0 bg-card z-10 py-0 px-1"></TableHead>
              <TableHead className="font-bold text-[11px] sticky left-7 bg-card z-10 min-w-[100px] py-0 px-1">Client</TableHead>
              <SortableHeader column="status" label="Status" sortConfig={sortConfig} onSort={handleSort} align="center" />
              <SortableHeader column="mediaBuyer" label="MB" sortConfig={sortConfig} onSort={handleSort} align="center" />
              <SortableHeader column="accountManager" label="AM" sortConfig={sortConfig} onSort={handleSort} align="center" />
              <SortableHeader column="adSpend" label="Monthly $" sortConfig={sortConfig} onSort={handleSort} />
              <SortableHeader column="dailyTarget" label="$/Day" sortConfig={sortConfig} onSort={handleSort} />
              <TableHead className="font-bold text-[11px] text-center py-0 px-1 min-w-[280px]">Quick Links</TableHead>
              {isAdmin && <SortableHeader column="mrr" label="MRR" sortConfig={sortConfig} onSort={handleSort} />}
              <TableHead className="font-bold text-[11px] py-0 px-1 min-w-[130px]">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedClients.map(({ client, metrics: m, computed }) => {
              const t = thresholds[client.id] || {};
              const syncInfo = getClientSyncStatus(client);
              const syncBorderStyle = getSyncBorderStyle(syncInfo.status);
              const isInactive = inactiveClientIds.has(client.id);
              const missingIntegrationStyle = getMissingIntegrationRowStyle(client);

              return (
                <TooltipProvider key={client.id}>
                  <TableRow
                    className={cn(
                      "cursor-pointer hover:bg-muted/50 border-b h-7 relative",
                      draggedId === client.id && "opacity-50",
                      syncBorderStyle,
                      missingIntegrationStyle,
                      isInactive && "opacity-70"
                    )}
                    draggable
                    onDragStart={(e) => handleDragStart(e, client.id)}
                    onDragOver={handleDragOver}
                    onDrop={(e) => handleDrop(e, client.id)}
                    onDragEnd={handleDragEnd}
                    onClick={() => navigate(`/client/${client.id}`)}
                  >
                    {/* Drag handle + sync dot */}
                    <TableCell className="cursor-grab sticky left-0 bg-card z-10 py-0 px-1" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-0.5">
                        <GripVertical className="h-3 w-3 text-muted-foreground" />
                      </div>
                    </TableCell>

                    {/* Client name */}
                    <TableCell className="font-medium text-[11px] sticky left-7 bg-card z-10 py-0 px-1 truncate max-w-[120px]">
                      <span className="truncate">{client.name}</span>
                    </TableCell>

                    {/* Status */}
                    <TableCell className="text-center py-0 px-1" onClick={(e) => e.stopPropagation()}>
                      <Select value={client.status} onValueChange={(val) => handleStatusChange(client.id, val)}>
                        <SelectTrigger className="h-6 w-[100px] text-[9px] border-0 bg-transparent p-0 justify-center [&>svg]:hidden">
                          <Badge
                            variant={
                              client.status === 'active' ? 'default' :
                              client.status === 'onboarding' ? 'secondary' :
                              client.status === 'paused' || client.status === 'on_hold' ? 'outline' :
                              'destructive'
                            }
                            className={cn(
                              "text-[9px] px-1.5 py-0 cursor-pointer",
                              client.status === 'active' && 'bg-chart-2/15 text-chart-2 border-chart-2/30',
                              client.status === 'onboarding' && 'bg-primary/15 text-primary border-primary/30',
                              (client.status === 'paused' || client.status === 'on_hold') && 'bg-muted text-muted-foreground',
                              client.status === 'inactive' && 'bg-destructive/15 text-destructive'
                            )}
                          >
                            {client.status === 'on_hold' ? 'On Hold' : client.status?.charAt(0).toUpperCase() + client.status?.slice(1)}
                          </Badge>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="active">
                            <Badge className="bg-chart-2/15 text-chart-2 border-chart-2/30 text-[9px]">Active</Badge>
                          </SelectItem>
                          <SelectItem value="onboarding">
                            <Badge className="bg-primary/15 text-primary border-primary/30 text-[9px]">Onboarding</Badge>
                          </SelectItem>
                          <SelectItem value="paused">
                            <Badge className="bg-muted text-muted-foreground text-[9px]">Paused</Badge>
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>

                    {/* Media Buyer */}
                    <TableCell className="text-center py-0 px-0.5" onClick={(e) => e.stopPropagation()}>
                      <Select
                        value={assignments[client.id]?.media_buyer || '_none'}
                        onValueChange={(val) => updateAssignment.mutateAsync({ id: client.id, media_buyer: val === '_none' ? null : val })}
                      >
                        <SelectTrigger className="h-5 w-[75px] text-[9px] border-0 bg-transparent p-0 justify-center [&>svg]:h-2.5 [&>svg]:w-2.5">
                          <span className="truncate">{assignments[client.id]?.media_buyer ? agencyMembers.find((m: any) => m.name === assignments[client.id]?.media_buyer)?.name?.split(' ')[0] || assignments[client.id]?.media_buyer?.split(' ')[0] || '—' : '—'}</span>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="_none"><span className="text-muted-foreground">None</span></SelectItem>
                          {agencyMembers.filter((m: any) => m.pod?.name === 'Media Buying').map((m: any) => (
                            <SelectItem key={m.id} value={m.name}>{m.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>

                    {/* Account Manager */}
                    <TableCell className="text-center py-0 px-0.5" onClick={(e) => e.stopPropagation()}>
                      <Select
                        value={assignments[client.id]?.account_manager || '_none'}
                        onValueChange={(val) => updateAssignment.mutateAsync({ id: client.id, account_manager: val === '_none' ? null : val })}
                      >
                        <SelectTrigger className="h-5 w-[75px] text-[9px] border-0 bg-transparent p-0 justify-center [&>svg]:h-2.5 [&>svg]:w-2.5">
                          <span className="truncate">{assignments[client.id]?.account_manager ? agencyMembers.find((m: any) => m.name === assignments[client.id]?.account_manager)?.name?.split(' ')[0] || assignments[client.id]?.account_manager?.split(' ')[0] || '—' : '—'}</span>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="_none"><span className="text-muted-foreground">None</span></SelectItem>
                          {agencyMembers.filter((m: any) => m.pod?.name === 'Account Management').map((m: any) => (
                            <SelectItem key={m.id} value={m.name}>{m.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>

                    {/* Monthly $ — monthly ad spend KPI target */}
                    <TableCell className="text-right font-mono tabular-nums text-[11px] py-0 px-1 font-semibold">
                      {computed.monthlyTarget > 0 ? formatCurrency(computed.monthlyTarget) : <span className="text-muted-foreground">-</span>}
                    </TableCell>

                    {/* $/Day — true per-day target (daily override or monthly/daysInMonth) */}
                    <TableCell className="text-right font-mono tabular-nums text-[11px] py-0 px-1 text-muted-foreground/80">
                      {computed.dailyTarget > 0 ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span>{formatCurrency(computed.dailyTarget)}</span>
                          </TooltipTrigger>
                          <TooltipContent side="top" className="text-[10px]">
                            {(fullSettings[client.id] as any)?.daily_ad_spend_target > 0
                              ? 'Source: daily target override'
                              : `Source: monthly target ÷ ${new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate()} days`}
                            <div className="text-muted-foreground">Expected over range: {formatCurrency(computed.dailyTarget * numberOfDays)}</div>
                          </TooltipContent>
                        </Tooltip>
                      ) : <span className="text-muted-foreground">-</span>}
                    </TableCell>

                    {/* Quick Links — Sheet, Doc, Creatives, Funnel, Activity, BM, Meta, CRM */}
                    <TableCell className="py-0 px-1" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-center gap-1.5">
                        <QuickLinksCell
                          client={client}
                          settings={fullSettings[client.id]}
                          onConfigureSheet={() =>
                            onOpenSheetSettings ? onOpenSheetSettings(client) : onOpenSettings(client)
                          }
                          onNavigate={(tab) => navigate(`/client/${client.id}?tab=${tab}`)}
                          hasCreatives={(creativeCounts[client.id] || 0) > 0}
                          hasFunnel={(funnelCounts[client.id] || 0) > 0}
                        />
                        <div className="h-5 w-px bg-border" />
                        {/* BM — big bright red pulse when missing */}
                        {client.business_manager_url ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-5 w-5" onClick={(e) => openAdsManager(e, client.business_manager_url)}>
                                <BarChart3 className="h-3 w-3 text-green-600" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="text-[10px]">Open Business Manager</TooltipContent>
                          </Tooltip>
                        ) : (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Badge
                                variant="destructive"
                                className="text-[10px] font-bold px-1.5 py-0 h-5 inline-flex items-center bg-red-600 text-white border-red-700 shadow-[0_0_8px_rgba(239,68,68,0.7)] animate-pulse gap-0.5"
                              >
                                <AlertTriangle className="h-3 w-3" />
                                BM
                              </Badge>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="text-[10px]">No Business Manager URL — configure Meta</TooltipContent>
                          </Tooltip>
                        )}
                        <MetaStatusCell
                          client={client}
                          isDuplicate={!!client.meta_ad_account_id && duplicateMetaAccounts.has(client.meta_ad_account_id)}
                          clients={clients}
                        />
                        <CrmStatusCell client={client} syncInfo={syncInfo} />
                      </div>
                    </TableCell>

                    {/* MRR - admin only */}
                    {isAdmin && (
                      <TableCell className="text-right font-mono tabular-nums text-[11px] py-0 px-1">
                        {computed.mrr > 0 ? formatCurrencyShort(computed.mrr) : <span className="text-muted-foreground">-</span>}
                      </TableCell>
                    )}

                    {/* Actions */}
                    <TableCell className="py-0 px-1" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-0">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-5 w-5"
                              disabled={syncingGhl[client.id] || !client.ghl_api_key}
                              onClick={(e) => handleSyncGhlClient(e, client.id, client.name)}
                              title="Sync GHL"
                            >
                              <RefreshCw className={cn("h-2.5 w-2.5", syncingGhl[client.id] && "animate-spin")} />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent side="top" className="text-[10px]">Sync GHL Leads</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-5 w-5"
                              disabled={enriching[client.id]}
                              onClick={(e) => handleEnrichClient(e, client.id, client.name)}
                              title="Enrich"
                            >
                              <Sparkles className={cn("h-2.5 w-2.5", enriching[client.id] && "animate-pulse")} />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent side="top" className="text-[10px]">Enrich Contacts</TooltipContent>
                        </Tooltip>
                        <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => onOpenSettings(client)}>
                          <Settings className="h-2.5 w-2.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => client.public_token && copyPublicLink(client.public_token)}>
                          <Copy className="h-2.5 w-2.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => navigate(`/client/${client.id}`)}>
                          <ExternalLink className="h-2.5 w-2.5" />
                        </Button>
                        {onDeleteClient && (
                          <Button variant="ghost" size="icon" className="h-5 w-5 text-destructive hover:text-destructive" onClick={() => onDeleteClient(client)}>
                            <Trash2 className="h-2.5 w-2.5" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                </TooltipProvider>
              );
            })}
          </TableBody>
        </Table>
      </div>
      {syncHistoryClient && (
        <SyncHistoryModal
          open={!!syncHistoryClient}
          onOpenChange={(open) => { if (!open) setSyncHistoryClient(null); }}
          clientId={syncHistoryClient.id}
          clientName={syncHistoryClient.name}
        />
      )}
    </div>
  );
}

// Inline sortable header component
function SortableHeader({
  column,
  label,
  sortConfig,
  onSort,
  align = 'right',
}: {
  column: string;
  label: string;
  sortConfig: SortConfig;
  onSort: (column: string) => void;
  align?: 'right' | 'center' | 'left';
}) {
  const isActive = sortConfig.column === column;
  const direction = isActive ? sortConfig.direction : null;

  return (
    <TableHead
      className={cn(
        "font-bold text-[11px] cursor-pointer select-none hover:bg-muted/50 transition-colors py-0 px-1",
        align === 'right' && 'text-right',
        align === 'center' && 'text-center',
        align === 'left' && 'text-left',
      )}
      onClick={() => onSort(column)}
    >
      <div className={cn(
        "flex items-center gap-0.5",
        align === 'right' && 'justify-end',
        align === 'center' && 'justify-center',
        align === 'left' && 'justify-start',
      )}>
        <span>{label}</span>
        {direction === 'asc' ? (
          <ArrowUp className="h-2.5 w-2.5" />
        ) : direction === 'desc' ? (
          <ArrowDown className="h-2.5 w-2.5" />
        ) : (
          <ArrowUpDown className="h-2.5 w-2.5 opacity-30" />
        )}
      </div>
    </TableHead>
  );
}

// Inline Meta status cell with duplicate detection and quick-edit popover
function MetaStatusCell({
  client,
  isDuplicate,
  clients,
}: {
  client: Client;
  isDuplicate: boolean;
  clients: Client[];
}) {
  const [adAccountId, setAdAccountId] = useState(client.meta_ad_account_id || '');
  const [bmUrl, setBmUrl] = useState(client.business_manager_url || '');
  const [open, setOpen] = useState(false);
  const updateClient = useUpdateClient();

  const duplicateWith = isDuplicate
    ? clients.filter(c => c.id !== client.id && c.meta_ad_account_id === client.meta_ad_account_id).map(c => c.name)
    : [];

  const handleSave = async () => {
    try {
      await updateClient.mutateAsync({
        id: client.id,
        meta_ad_account_id: adAccountId || null,
        business_manager_url: bmUrl || null,
      } as any);
      toast.success('Meta settings updated');
      setOpen(false);
    } catch {
      toast.error('Failed to update Meta settings');
    }
  };

  const hasAccount = !!adAccountId;
  const cleanPrimaryId = adAccountId.replace(/^act_/, '').trim();
  const primaryAdsUrl = cleanPrimaryId ? `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${cleanPrimaryId}` : null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <div className="inline-flex items-center gap-0.5 cursor-pointer">
          {isDuplicate ? (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge variant="destructive" className="text-[10px] px-1.5 py-0 h-5 inline-flex items-center gap-0.5">
                    <AlertTriangle className="h-2.5 w-2.5" />
                    DUP
                  </Badge>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-xs">
                  <div className="text-xs">
                    <strong>Duplicate Ad Account!</strong>
                    <div className="text-muted-foreground mt-0.5">
                      {client.meta_ad_account_id} is also used by: {duplicateWith.join(', ')}
                    </div>
                  </div>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : hasAccount ? (
            <Badge variant="success" className="text-[10px] px-1.5 py-0 h-5 inline-flex items-center">META</Badge>
          ) : (
            <Badge className="text-[10px] font-bold px-1.5 py-0 h-5 bg-red-600 text-white border-red-700 shadow-[0_0_8px_rgba(239,68,68,0.7)] animate-pulse gap-0.5">
              <AlertTriangle className="h-3 w-3" />META
            </Badge>
          )}
          <Pencil className="h-2 w-2 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
        </div>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-3" side="left" align="start" onClick={(e) => e.stopPropagation()}>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="font-medium text-xs">Meta Integration — {client.name}</h4>
            {bmUrl && (
              <Button variant="ghost" size="icon" className="h-5 w-5" onClick={(e) => { e.stopPropagation(); window.open(bmUrl, '_blank'); }} title="Open Business Manager">
                <ExternalLink className="h-3 w-3" />
              </Button>
            )}
          </div>
          <div className="space-y-1.5">
            <label className="text-[11px] text-muted-foreground font-medium">Business Manager URL</label>
            <Input
              value={bmUrl}
              onChange={(e) => {
                const url = e.target.value;
                setBmUrl(url);
                const m = url.match(/(?:act[=\/]|act_|account_id=)(\d+)/);
                if (m && m[1] && !adAccountId) setAdAccountId(m[1]);
              }}
              placeholder="https://business.facebook.com/..."
              className="h-7 text-xs"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-[11px] text-muted-foreground font-medium">Ad Account ID</label>
            <div className="flex items-center gap-1">
              <Input
                value={adAccountId}
                onChange={(e) => setAdAccountId(e.target.value)}
                placeholder="act_123456789"
                className="h-7 text-xs flex-1"
              />
              {primaryAdsUrl && (
                <Button variant="outline" size="icon" className="h-7 w-7 shrink-0" onClick={(e) => { e.stopPropagation(); window.open(primaryAdsUrl, '_blank'); }} title="Open in Ads Manager">
                  <ExternalLink className="h-3 w-3" />
                </Button>
              )}
            </div>
          </div>
          {isDuplicate && (
            <div className="text-[10px] text-destructive bg-destructive/10 rounded p-1.5">
              ⚠️ This ad account is shared with: {duplicateWith.join(', ')}
            </div>
          )}
          <div className="flex justify-end gap-1.5">
            <Button variant="outline" size="sm" className="h-6 text-[10px]" onClick={() => setOpen(false)}>Cancel</Button>
            <Button size="sm" className="h-6 text-[10px]" onClick={handleSave} disabled={updateClient.isPending}>
              {updateClient.isPending ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// Quick Links cell: Google Sheet, Google Doc, Creatives, Funnel, Activity
function QuickLinksCell({
  client,
  settings,
  onConfigureSheet,
  onNavigate,
  hasCreatives,
  hasFunnel,
}: {
  client: Client;
  settings: ClientSettings | undefined;
  onConfigureSheet: () => void;
  onNavigate: (tab: string) => void;
  hasCreatives: boolean;
  hasFunnel: boolean;
}) {
  const s: any = settings;
  const sheetId = s?.metrics_sheet_id || null;
  const sheetGid = s?.metrics_sheet_gid || null;
  const sheetUrl: string | null =
    s?.kpi_google_sheet_url ||
    (sheetId
      ? `https://docs.google.com/spreadsheets/d/${sheetId}/edit${sheetGid ? `?gid=${sheetGid}` : ''}`
      : null);
  const docUrl: string | null = (client as any).google_doc_url || s?.kpi_google_doc_url || null;

  const updateClient = useUpdateClient();
  const updateSettings = useUpdateClientSettings();
  const [docOpen, setDocOpen] = useState(false);
  const [docInput, setDocInput] = useState(docUrl || '');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetUrlInput, setSheetUrlInput] = useState(s?.kpi_google_sheet_url || sheetUrl || '');
  const [sheetIdInput, setSheetIdInput] = useState(sheetId || '');
  const [sheetGidInput, setSheetGidInput] = useState(sheetGid || '');

  const parseSheetFromUrl = (url: string) => {
    const idMatch = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    const gidMatch = url.match(/[#?&]gid=(\d+)/);
    return { id: idMatch?.[1] || '', gid: gidMatch?.[1] || '' };
  };

  const saveSheet = async () => {
    try {
      let finalId = sheetIdInput.trim();
      let finalGid = sheetGidInput.trim();
      if (sheetUrlInput && (!finalId || !finalGid)) {
        const parsed = parseSheetFromUrl(sheetUrlInput);
        if (!finalId) finalId = parsed.id;
        if (!finalGid) finalGid = parsed.gid;
      }
      await updateSettings.mutateAsync({
        client_id: client.id,
        kpi_google_sheet_url: sheetUrlInput.trim() || null,
        metrics_sheet_id: finalId || null,
        metrics_sheet_gid: finalGid || null,
      } as any);
      toast.success('Google Sheet settings saved');
      setSheetOpen(false);
    } catch {
      toast.error('Failed to save sheet settings');
    }
  };

  const saveDoc = async () => {
    try {
      await updateClient.mutateAsync({ id: client.id, google_doc_url: docInput || null } as any);
      toast.success('Google Doc URL saved');
      setDocOpen(false);
    } catch {
      toast.error('Failed to save Google Doc URL');
    }
  };

  const openExternal = (e: React.MouseEvent, url: string | null) => {
    e.stopPropagation();
    if (url) window.open(url, '_blank');
  };

  return (
    <TooltipProvider>
      <div className="flex items-center justify-center gap-0.5">
        {/* Google Sheet — click icon opens sheet; pencil opens inline editor popover */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5"
              onClick={(e) => (sheetUrl ? openExternal(e, sheetUrl) : (e.stopPropagation(), setSheetOpen(true)))}
            >
              <FileSpreadsheet
                className={cn('h-3 w-3', sheetUrl ? 'text-green-600' : 'text-red-500 animate-pulse')}
              />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-[10px]">
            {sheetUrl ? 'Open Google Sheet' : 'Configure Google Sheet'}
          </TooltipContent>
        </Tooltip>
        <Popover
          open={sheetOpen}
          onOpenChange={(o) => {
            setSheetOpen(o);
            if (o) {
              setSheetUrlInput(s?.kpi_google_sheet_url || sheetUrl || '');
              setSheetIdInput(sheetId || '');
              setSheetGidInput(sheetGid || '');
            }
          }}
        >
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-4 w-4 -ml-1"
              onClick={(e) => e.stopPropagation()}
              title="Edit Sheet settings"
            >
              <Pencil className="h-2.5 w-2.5 text-muted-foreground" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-80 p-3" side="bottom" align="start" onClick={(e) => e.stopPropagation()}>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="font-medium text-xs">Google Sheet — {client.name}</h4>
                {sheetUrl && (
                  <Button variant="ghost" size="icon" className="h-5 w-5" onClick={(e) => openExternal(e, sheetUrl)} title="Open Sheet">
                    <ExternalLink className="h-3 w-3" />
                  </Button>
                )}
              </div>
              <div className="space-y-1">
                <label className="text-[11px] text-muted-foreground font-medium">Full Sheet URL</label>
                <Input
                  value={sheetUrlInput}
                  onChange={(e) => {
                    const v = e.target.value;
                    setSheetUrlInput(v);
                    const parsed = parseSheetFromUrl(v);
                    if (parsed.id) setSheetIdInput(parsed.id);
                    if (parsed.gid) setSheetGidInput(parsed.gid);
                  }}
                  placeholder="https://docs.google.com/spreadsheets/d/..."
                  className="h-7 text-xs"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="text-[11px] text-muted-foreground font-medium">Sheet ID</label>
                  <Input
                    value={sheetIdInput}
                    onChange={(e) => setSheetIdInput(e.target.value)}
                    placeholder="Auto-filled from URL"
                    className="h-7 text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] text-muted-foreground font-medium">Tab GID</label>
                  <Input
                    value={sheetGidInput}
                    onChange={(e) => setSheetGidInput(e.target.value)}
                    placeholder="0"
                    className="h-7 text-xs"
                  />
                </div>
              </div>
              <p className="text-[10px] text-muted-foreground">Pasting the full URL auto-extracts the ID & tab GID.</p>
              <div className="flex items-center gap-1 justify-end pt-1">
                <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setSheetOpen(false)}>Cancel</Button>
                <Button size="sm" className="h-7 text-xs" onClick={saveSheet} disabled={updateSettings.isPending}>
                  {updateSettings.isPending ? 'Saving…' : 'Save'}
                </Button>
              </div>
            </div>
          </PopoverContent>
        </Popover>

        {/* Google Doc — popover to view/edit */}
        <Popover open={docOpen} onOpenChange={(o) => { setDocOpen(o); if (o) setDocInput(docUrl || ''); }}>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5"
              onClick={(e) => e.stopPropagation()}
              title="Google Doc"
            >
              <FileText
                className={cn('h-3 w-3', docUrl ? 'text-green-600' : 'text-red-500 animate-pulse')}
              />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-72 p-3" side="bottom" align="start" onClick={(e) => e.stopPropagation()}>
            <div className="space-y-2">
              <h4 className="font-medium text-xs">Google Doc — {client.name}</h4>
              <Input
                value={docInput}
                onChange={(e) => setDocInput(e.target.value)}
                placeholder="https://docs.google.com/document/d/..."
                className="h-7 text-xs"
              />
              <div className="flex items-center gap-1 justify-end">
                {docUrl && (
                  <Button variant="outline" size="sm" className="h-7 text-xs" onClick={(e) => openExternal(e, docUrl)}>
                    <ExternalLink className="h-3 w-3 mr-1" /> Open
                  </Button>
                )}
                <Button size="sm" className="h-7 text-xs" onClick={saveDoc}>Save</Button>
              </div>
            </div>
          </PopoverContent>
        </Popover>

        {/* Creatives */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5"
              onClick={(e) => { e.stopPropagation(); onNavigate('creatives'); }}
            >
              <Palette className={cn('h-3 w-3', hasCreatives ? 'text-green-600' : 'text-red-500 animate-pulse')} />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-[10px]">{hasCreatives ? 'Creatives' : 'No creatives — add some'}</TooltipContent>
        </Tooltip>

        {/* Funnel */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5"
              onClick={(e) => { e.stopPropagation(); onNavigate('pipeline'); }}
            >
              <Layers className={cn('h-3 w-3', hasFunnel ? 'text-green-600' : 'text-red-500 animate-pulse')} />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-[10px]">{hasFunnel ? 'Funnel' : 'No funnel/pipeline configured'}</TooltipContent>
        </Tooltip>

        {/* Activity */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5"
              onClick={(e) => { e.stopPropagation(); onNavigate('activity'); }}
            >
              <ActivityIcon className="h-3 w-3 text-green-600" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-[10px]">Activity</TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
}

// CRM (GHL/HubSpot) status cell with quick-edit popover — mirrors MetaStatusCell
function CrmStatusCell({
  client,
  syncInfo,
}: {
  client: Client;
  syncInfo: { status: 'healthy' | 'stale' | 'error' | 'not_configured'; lastSyncAt: string | null; error: string | null; source: 'ghl' | 'hubspot' | 'none' };
}) {
  const [locationId, setLocationId] = useState(client.ghl_location_id || '');
  const [apiKey, setApiKey] = useState(client.ghl_api_key || '');
  const [open, setOpen] = useState(false);
  const updateClient = useUpdateClient();

  const handleSave = async () => {
    try {
      await updateClient.mutateAsync({
        id: client.id,
        ghl_location_id: locationId || null,
        ghl_api_key: apiKey || null,
      } as any);
      toast.success('GHL settings updated');
      setOpen(false);
    } catch {
      toast.error('Failed to update GHL settings');
    }
  };

  const openGhl = (e: React.MouseEvent) => {
    e.stopPropagation();
    const url = locationId ? `https://app.gohighlevel.com/v2/location/${locationId}` : null;
    if (url) window.open(url, '_blank');
    else toast.error('No Location ID set');
  };

  const hasCreds = !!(locationId && apiKey) || !!(client.hubspot_portal_id && client.hubspot_access_token);
  const sourceLabel = (client.hubspot_portal_id && client.hubspot_access_token) ? 'HS' : 'GHL';

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <div className="inline-flex items-center gap-0.5 cursor-pointer">
          {hasCreds ? (
            <Badge variant="success" className="text-[10px] px-1.5 py-0 h-5 inline-flex items-center">{sourceLabel}</Badge>
          ) : (
            <Badge className="text-[10px] font-bold px-1.5 py-0 h-5 bg-red-600 text-white border-red-700 shadow-[0_0_8px_rgba(239,68,68,0.7)] animate-pulse gap-0.5">
              <AlertTriangle className="h-3 w-3" />CRM
            </Badge>
          )}
          <Pencil className="h-2 w-2 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
        </div>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-3" side="left" align="start" onClick={(e) => e.stopPropagation()}>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="font-medium text-xs">GHL Integration — {client.name}</h4>
            {locationId && (
              <Button variant="ghost" size="icon" className="h-5 w-5" onClick={openGhl} title="Open GHL account">
                <ExternalLink className="h-3 w-3" />
              </Button>
            )}
          </div>
          <div className="space-y-1.5">
            <label className="text-[11px] text-muted-foreground font-medium">Location ID</label>
            <Input
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
              placeholder="e.g. abc123XYZ"
              className="h-7 text-xs"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-[11px] text-muted-foreground font-medium">Private API Key</label>
            <Input
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="pit-xxxxxxxxxxxx"
              className="h-7 text-xs"
              type="password"
            />
          </div>
          <div className="flex justify-end gap-1.5">
            <Button variant="outline" size="sm" className="h-6 text-[10px]" onClick={() => setOpen(false)}>Cancel</Button>
            <Button size="sm" className="h-6 text-[10px]" onClick={handleSave} disabled={updateClient.isPending}>
              {updateClient.isPending ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
