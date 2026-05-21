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
import { KPIThresholds, ClientSettings } from '@/hooks/useClientSettings';
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
    case 'error':
      return 'border-l-4 border-l-destructive';
    case 'stale':
      return 'border-l-4 border-l-yellow-500';
    default:
      return '';
  }
}

// Row tint when integration is missing — faded red so it's actionable at a glance
function getMissingIntegrationRowStyle(client: Client): string {
  const hasGhl = !!(client.ghl_api_key && client.ghl_location_id);
  const hasHubspot = !!(client.hubspot_portal_id && client.hubspot_access_token);
  const hasCrm = hasGhl || hasHubspot;
  const hasMeta = !!client.meta_ad_account_id;
  if (!hasCrm || !hasMeta) {
    return 'bg-destructive/5 hover:bg-destructive/10';
  }
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

      switch (sortConfig.column) {
        case 'adSpend': aVal = a.metrics.totalAdSpend || 0; bVal = b.metrics.totalAdSpend || 0; break;
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
  }, [clientsWithComputedValues, sortConfig]);

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
              <TableHead className="font-bold text-[11px] py-0 px-1 text-center">Status</TableHead>
              <TableHead className="font-bold text-[11px] py-0 px-1 text-center min-w-[80px]">MB</TableHead>
              <TableHead className="font-bold text-[11px] py-0 px-1 text-center min-w-[80px]">AM</TableHead>
              <SortableHeader column="adSpend" label="Spend" sortConfig={sortConfig} onSort={handleSort} />
              <SortableHeader column="dailyTarget" label="$/Day" sortConfig={sortConfig} onSort={handleSort} />
              <TableHead className="font-bold text-[11px] text-center py-0 px-1 min-w-[180px]">Quick Links</TableHead>
              <TableHead className="font-bold text-[11px] text-center py-0 px-1">BM</TableHead>
              <TableHead className="font-bold text-[11px] text-center py-0 px-1">Meta</TableHead>
              <TableHead className="font-bold text-[11px] text-center py-0 px-1">CRM</TableHead>
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
                        {apiTestResults[client.id] ? (
                          <ApiConnectionStatus
                            contacts={apiTestResults[client.id].contacts}
                            calendars={apiTestResults[client.id].calendars}
                            opportunities={apiTestResults[client.id].opportunities}
                            errors={apiTestResults[client.id].errors}
                            unified
                          />
                        ) : (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                className={cn(
                                  "ml-0.5 cursor-pointer hover:opacity-70",
                                  syncInfo.status === 'healthy' && 'text-chart-2',
                                  syncInfo.status === 'stale' && 'text-yellow-600 dark:text-yellow-500',
                                  syncInfo.status === 'error' && 'text-destructive',
                                  syncInfo.status === 'not_configured' && 'text-muted-foreground'
                                )}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (syncInfo.status !== 'not_configured') {
                                    setSyncHistoryClient({ id: client.id, name: client.name });
                                  }
                                }}
                              >
                                {syncInfo.status === 'healthy' && <CheckCircle className="h-2.5 w-2.5" />}
                                {syncInfo.status === 'stale' && <Clock className="h-2.5 w-2.5" />}
                                {syncInfo.status === 'error' && <XCircle className="h-2.5 w-2.5" />}
                                {syncInfo.status === 'not_configured' && <AlertCircle className="h-2.5 w-2.5" />}
                              </button>
                            </TooltipTrigger>
                            <TooltipContent side="right" className="max-w-xs">
                              <div className="text-xs">
                                <strong>{syncInfo.source === 'hubspot' ? 'HubSpot' : syncInfo.source === 'ghl' ? 'GHL' : 'CRM'}: </strong>
                                {syncInfo.status === 'healthy' && 'Synced'}
                                {syncInfo.status === 'stale' && 'Stale'}
                                {syncInfo.status === 'error' && 'Error'}
                                {syncInfo.status === 'not_configured' && 'Not Configured'}
                                {syncInfo.lastSyncAt && (
                                  <div className="text-[10px] text-muted-foreground mt-0.5">
                                    {formatDistanceToNow(new Date(syncInfo.lastSyncAt), { addSuffix: true })}
                                  </div>
                                )}
                                {syncInfo.status !== 'not_configured' && (
                                  <div className="text-[10px] text-primary mt-0.5">Click for sync history</div>
                                )}
                              </div>
                            </TooltipContent>
                          </Tooltip>
                        )}
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

                    {/* Meta Spend */}
                    <TableCell className="text-right font-mono tabular-nums text-[11px] py-0 px-1 font-semibold">
                      {formatCurrency(m.totalAdSpend || 0)}
                    </TableCell>

                    {/* Expected Spend ($/Day × days in range) */}
                    <TableCell className="text-right font-mono tabular-nums text-[11px] py-0 px-1 text-muted-foreground/70">
                      {computed.dailyTarget > 0 ? formatCurrency(computed.dailyTarget * numberOfDays) : <span className="text-muted-foreground">-</span>}
                    </TableCell>

                    {/* Quick Links — Sheet, Doc, Creatives, Funnel, Activity */}
                    <TableCell className="py-0 px-1" onClick={(e) => e.stopPropagation()}>
                      <QuickLinksCell
                        client={client}
                        settings={fullSettings[client.id]}
                        onConfigureSheet={() =>
                          onOpenSheetSettings ? onOpenSheetSettings(client) : onOpenSettings(client)
                        }
                        onNavigate={(tab) => navigate(`/client/${client.id}?tab=${tab}`)}
                      />
                    </TableCell>

                    {/* BM URL */}
                    <TableCell className="text-center py-0 px-1" onClick={(e) => e.stopPropagation()}>
                      {client.business_manager_url ? (
                        <Button variant="ghost" size="icon" className="h-5 w-5" onClick={(e) => openAdsManager(e, client.business_manager_url)} title="Business Manager">
                          <BarChart3 className="h-3 w-3 text-chart-2" />
                        </Button>
                      ) : (
                        <span className="text-muted-foreground text-[9px]">—</span>
                      )}
                    </TableCell>

                    {/* Meta Sync Status */}
                    <TableCell className="text-center py-0 px-1" onClick={(e) => e.stopPropagation()}>
                      <MetaStatusCell
                        client={client}
                        metaSync={computed.metaSync}
                        isDuplicate={!!client.meta_ad_account_id && duplicateMetaAccounts.has(client.meta_ad_account_id)}
                        clients={clients}
                      />
                    </TableCell>

                    {/* CRM Status */}
                    <TableCell className="text-center py-0 px-1" onClick={(e) => e.stopPropagation()}>
                      <CrmStatusCell client={client} syncInfo={syncInfo} />
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
                        {(() => {
                          const s: any = fullSettings[client.id];
                          const hasSheet = !!s?.metrics_sheet_id;
                          const isPrimary = hasSheet && s?.metrics_source_default === 'sheet';
                          return (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-5 w-5"
                                  onClick={() =>
                                    onOpenSheetSettings
                                      ? onOpenSheetSettings(client)
                                      : onOpenSettings(client)
                                  }
                                >
                                  <FileSpreadsheet
                                    className={cn(
                                      'h-2.5 w-2.5',
                                      isPrimary
                                        ? 'text-emerald-600'
                                        : hasSheet
                                          ? 'text-amber-600'
                                          : 'text-muted-foreground'
                                    )}
                                  />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent side="top" className="text-[10px]">
                                {isPrimary
                                  ? 'Google Sheet — primary source'
                                  : hasSheet
                                    ? 'Sheet bound — not primary'
                                    : 'Configure Google Sheet'}
                              </TooltipContent>
                            </Tooltip>
                          );
                        })()}
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
}: {
  column: string;
  label: string;
  sortConfig: SortConfig;
  onSort: (column: string) => void;
}) {
  const isActive = sortConfig.column === column;
  const direction = isActive ? sortConfig.direction : null;

  return (
    <TableHead
      className="font-bold text-[11px] text-right cursor-pointer select-none hover:bg-muted/50 transition-colors py-0 px-1"
      onClick={() => onSort(column)}
    >
      <div className="flex items-center gap-0.5 justify-end">
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
  metaSync,
  isDuplicate,
  clients,
}: {
  client: Client;
  metaSync: { status: 'healthy' | 'stale' | 'not_synced'; lastSyncAt: string | null };
  isDuplicate: boolean;
  clients: Client[];
}) {
  const [adAccountId, setAdAccountId] = useState(client.meta_ad_account_id || '');
  const [accessToken, setAccessToken] = useState(client.meta_access_token || '');
  const [bmUrl, setBmUrl] = useState(client.business_manager_url || '');
  const extraInitial = (((client as any).meta_ad_account_ids as string[] | null) || []).filter(
    (a) => a && a !== client.meta_ad_account_id,
  );
  const [extraAccount1, setExtraAccount1] = useState(extraInitial[0] || '');
  const [extraAccount2, setExtraAccount2] = useState(extraInitial[1] || '');
  const [open, setOpen] = useState(false);
  const [syncingAccount, setSyncingAccount] = useState<string | null>(null);
  const [syncDays, setSyncDays] = useState<string>('30');
  const updateClient = useUpdateClient();
  const queryClient = useQueryClient();

  const syncAccount = async (e: React.MouseEvent, accountId: string) => {
    e.stopPropagation();
    const cleanId = accountId.replace(/^act_/, '').trim();
    if (!cleanId) {
      toast.error('Enter an Ad Account ID first');
      return;
    }
    setSyncingAccount(cleanId);
    try {
      const days = parseInt(syncDays, 10) || 30;
      const today = new Date();
      const start = new Date(today.getTime() - days * 24 * 60 * 60 * 1000);
      const startDate = start.toISOString().split('T')[0];
      const endDate = today.toISOString().split('T')[0];
      const { error } = await supabase.functions.invoke('sync-meta-ads', {
        body: { clientId: client.id, adAccountOverride: cleanId, startDate, endDate },
      });
      if (error) throw error;
      toast.success(`Synced act_${cleanId} (last ${days}d)`);
      queryClient.invalidateQueries({ queryKey: ['daily-metrics'] });
      queryClient.invalidateQueries({ queryKey: ['meta_ads'] });
    } catch (err: any) {
      toast.error(`Sync failed: ${err.message || 'Unknown error'}`);
    } finally {
      setSyncingAccount(null);
    }
  };

  const duplicateWith = isDuplicate
    ? clients.filter(c => c.id !== client.id && c.meta_ad_account_id === client.meta_ad_account_id).map(c => c.name)
    : [];

  const handleSave = async () => {
    try {
      const extras = [extraAccount1, extraAccount2]
        .map((a) => a.trim())
        .filter((a) => a && a !== adAccountId);
      await updateClient.mutateAsync({
        id: client.id,
        meta_ad_account_id: adAccountId || null,
        meta_access_token: accessToken || null,
        business_manager_url: bmUrl || null,
        meta_ad_account_ids: extras,
      } as any);
      toast.success('Meta settings updated');
      setOpen(false);
    } catch {
      toast.error('Failed to update Meta settings');
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <div className="inline-flex items-center gap-0.5 cursor-pointer">
          {isDuplicate ? (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge variant="destructive" className="text-[9px] px-1 py-0 h-4 gap-0.5">
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
          ) : metaSync.status === 'healthy' ? (
            <Badge variant="success" className="text-[9px] px-1 py-0 h-4">OK</Badge>
          ) : metaSync.status === 'stale' ? (
            <Badge variant="secondary" className="text-[9px] px-1 py-0 h-4 border-yellow-500/50 text-yellow-600 dark:text-yellow-400">Old</Badge>
          ) : (
            <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 text-muted-foreground">—</Badge>
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
            <label className="text-[11px] text-muted-foreground font-medium">Sync Timeframe</label>
            <Select value={syncDays} onValueChange={setSyncDays}>
              <SelectTrigger className="h-7 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">Last 1 day</SelectItem>
                <SelectItem value="3">Last 3 days</SelectItem>
                <SelectItem value="7">Last 7 days</SelectItem>
                <SelectItem value="14">Last 14 days</SelectItem>
                <SelectItem value="30">Last 30 days</SelectItem>
                <SelectItem value="60">Last 60 days</SelectItem>
                <SelectItem value="90">Last 90 days</SelectItem>
                <SelectItem value="180">Last 180 days</SelectItem>
                <SelectItem value="365">Last 365 days</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[10px] text-muted-foreground">Applies to the per-account sync button below.</p>
          </div>
          {[
            { label: 'Ad Account ID (Primary)', value: adAccountId, set: setAdAccountId, placeholder: 'act_123456789' },
            { label: 'Ad Account ID #2 (optional)', value: extraAccount1, set: setExtraAccount1, placeholder: 'act_...' },
            { label: 'Ad Account ID #3 (optional)', value: extraAccount2, set: setExtraAccount2, placeholder: 'act_...' },
          ].map((f, idx) => {
            const cleanId = f.value.replace(/^act_/, '').trim();
            const adsUrl = cleanId ? `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${cleanId}` : null;
            return (
              <div className="space-y-1.5" key={idx}>
                <label className="text-[11px] text-muted-foreground font-medium">{f.label}</label>
                <div className="flex items-center gap-1">
                  <Input
                    value={f.value}
                    onChange={(e) => f.set(e.target.value)}
                    placeholder={f.placeholder}
                    className="h-7 text-xs flex-1"
                  />
                  {adsUrl && (
                    <>
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-7 w-7 shrink-0"
                        disabled={syncingAccount === cleanId}
                        onClick={(e) => syncAccount(e, f.value)}
                        title={`Sync act_${cleanId}`}
                      >
                        <RefreshCw className={cn("h-3 w-3", syncingAccount === cleanId && "animate-spin")} />
                      </Button>
                      <Button variant="outline" size="icon" className="h-7 w-7 shrink-0" onClick={(e) => { e.stopPropagation(); window.open(adsUrl, '_blank'); }} title="Open in Ads Manager">
                        <ExternalLink className="h-3 w-3" />
                      </Button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
          <div className="space-y-1.5">
            <label className="text-[11px] text-muted-foreground font-medium">Access Token <span className="text-muted-foreground">(optional override)</span></label>
            <Input
              value={accessToken}
              onChange={(e) => setAccessToken(e.target.value)}
              placeholder="Uses master token if empty"
              className="h-7 text-xs"
              type="password"
            />
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
  const [accountUrl, setAccountUrl] = useState((client as any).ghl_account_url || '');
  const [open, setOpen] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const updateClient = useUpdateClient();
  const queryClient = useQueryClient();
  const [syncing, setSyncing] = useState(false);
  const [syncDays, setSyncDays] = useState<string>('7');
  const [syncResult, setSyncResult] = useState<{ ok: boolean; message: string } | null>(null);

  const handleSave = async () => {
    try {
      await updateClient.mutateAsync({
        id: client.id,
        ghl_location_id: locationId || null,
        ghl_api_key: apiKey || null,
        ghl_account_url: accountUrl || null,
      } as any);
      toast.success('GHL settings updated');
      setOpen(false);
    } catch {
      toast.error('Failed to update GHL settings');
    }
  };

  const openGhl = (e: React.MouseEvent) => {
    e.stopPropagation();
    const url = accountUrl || (locationId ? `https://app.gohighlevel.com/v2/location/${locationId}` : null);
    if (url) window.open(url, '_blank');
    else toast.error('No GHL URL or Location ID set');
  };

  const handleTestConnection = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!apiKey || !locationId) {
      setTestResult({ ok: false, message: 'Enter both Location ID and API Key first' });
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const { data, error } = await supabase.functions.invoke('test-ghl-connection', {
        body: { api_key: apiKey, location_id: locationId },
      });
      if (error) throw error;
      if (data?.ok) {
        setTestResult({ ok: true, message: `Connected${data.location_name ? ` — ${data.location_name}` : ''}` });
      } else {
        setTestResult({ ok: false, message: data?.error || 'Connection failed' });
      }
    } catch (err: any) {
      setTestResult({ ok: false, message: err?.message || 'Test failed' });
    } finally {
      setTesting(false);
    }
  };

  const handleManualSync = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!client.ghl_api_key || !client.ghl_location_id) {
      setSyncResult({ ok: false, message: 'Save credentials before syncing' });
      return;
    }
    setSyncing(true);
    setSyncResult(null);
    try {
      const days = parseInt(syncDays, 10) || 7;
      const { data, error } = await supabase.functions.invoke('sync-ghl-contacts', {
        body: { clientId: client.id, sinceDateDays: days, syncTimeline: days >= 30 },
      });
      if (error) throw error;
      const summary = data?.results?.[0];
      const synced = summary?.contacts?.created ?? summary?.contacts?.updated ?? 0;
      setSyncResult({ ok: true, message: `Synced last ${days} day${days === 1 ? '' : 's'}${synced ? ` — ${synced} records` : ''}` });
      queryClient.invalidateQueries({ queryKey: ['daily-metrics'] });
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      queryClient.invalidateQueries({ queryKey: ['calls'] });
      queryClient.invalidateQueries({ queryKey: ['integration-statuses'] });
    } catch (err: any) {
      setSyncResult({ ok: false, message: err?.message || 'Sync failed' });
    } finally {
      setSyncing(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <div className="inline-flex items-center gap-0.5 cursor-pointer">
          {syncInfo.status === 'healthy' && (
            <Badge variant="success" className="text-[9px] px-1 py-0 h-4">
              {syncInfo.source === 'hubspot' ? 'HS' : 'GHL'}
            </Badge>
          )}
          {syncInfo.status === 'stale' && (
            <Badge variant="secondary" className="text-[9px] px-1 py-0 h-4 border-yellow-500/50 text-yellow-600 dark:text-yellow-400">Old</Badge>
          )}
          {syncInfo.status === 'error' && (
            <Badge variant="destructive" className="text-[9px] px-1 py-0 h-4">
              {syncInfo.source === 'hubspot' ? 'HS' : syncInfo.source === 'ghl' ? 'GHL' : 'ERR'}
            </Badge>
          )}
          {syncInfo.status === 'not_configured' && (
            <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 text-muted-foreground">—</Badge>
          )}
          <Pencil className="h-2 w-2 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
        </div>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-3" side="left" align="start" onClick={(e) => e.stopPropagation()}>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="font-medium text-xs">GHL Integration — {client.name}</h4>
            {(accountUrl || locationId) && (
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
          <div className="space-y-1.5">
            <label className="text-[11px] text-muted-foreground font-medium">GHL Account URL <span className="text-muted-foreground">(if custom domain)</span></label>
            <Input
              value={accountUrl}
              onChange={(e) => setAccountUrl(e.target.value)}
              placeholder="https://app.gohighlevel.com/v2/location/..."
              className="h-7 text-xs"
            />
          </div>
          {syncInfo.lastSyncAt && (
            <div className="text-[10px] text-muted-foreground">
              Last sync: {formatDistanceToNow(new Date(syncInfo.lastSyncAt), { addSuffix: true })}
            </div>
          )}
          {syncInfo.error && (
            <div className="text-[10px] text-destructive bg-destructive/10 rounded p-1.5">
              {syncInfo.error}
            </div>
          )}
          {testResult && (
            <div className={cn(
              "text-[10px] rounded p-1.5 flex items-center gap-1",
              testResult.ok
                ? "text-green-700 dark:text-green-400 bg-green-500/10 border border-green-500/30"
                : "text-destructive bg-destructive/10"
            )}>
              {testResult.ok ? <CheckCircle className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
              {testResult.message}
            </div>
          )}
          <div className="space-y-1.5 pt-1 border-t border-border">
            <label className="text-[11px] text-muted-foreground font-medium">Manual Sync</label>
            <div className="flex gap-1.5">
              <Select value={syncDays} onValueChange={setSyncDays}>
                <SelectTrigger className="h-7 text-xs flex-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">Last 1 day</SelectItem>
                  <SelectItem value="3">Last 3 days</SelectItem>
                  <SelectItem value="7">Last 7 days</SelectItem>
                  <SelectItem value="14">Last 14 days</SelectItem>
                  <SelectItem value="30">Last 30 days</SelectItem>
                  <SelectItem value="90">Last 90 days</SelectItem>
                  <SelectItem value="365">Last 365 days</SelectItem>
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-[10px] gap-1"
                onClick={handleManualSync}
                disabled={syncing || !client.ghl_api_key || !client.ghl_location_id}
              >
                <RefreshCw className={cn('h-3 w-3', syncing && 'animate-spin')} />
                {syncing ? 'Syncing…' : 'Sync'}
              </Button>
            </div>
            {syncResult && (
              <div className={cn(
                'text-[10px] rounded p-1.5 flex items-center gap-1',
                syncResult.ok
                  ? 'text-green-700 dark:text-green-400 bg-green-500/10 border border-green-500/30'
                  : 'text-destructive bg-destructive/10'
              )}>
                {syncResult.ok ? <CheckCircle className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                {syncResult.message}
              </div>
            )}
          </div>
          <div className="flex justify-between gap-1.5">
            <Button
              variant="outline"
              size="sm"
              className="h-6 text-[10px]"
              onClick={handleTestConnection}
              disabled={testing || !apiKey || !locationId}
            >
              {testing ? 'Testing…' : 'Test Connection'}
            </Button>
            <div className="flex gap-1.5">
            <Button variant="outline" size="sm" className="h-6 text-[10px]" onClick={() => setOpen(false)}>Cancel</Button>
            <Button size="sm" className="h-6 text-[10px]" onClick={handleSave} disabled={updateClient.isPending}>
              {updateClient.isPending ? 'Saving…' : 'Save'}
            </Button>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
