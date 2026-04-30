import { useState, useMemo, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAgencyMembers } from '@/hooks/useTasks';
import { useDateFilter } from '@/contexts/DateFilterContext';
import { differenceInDays, subDays, format } from 'date-fns';
import { Client, useUpdateClient } from '@/hooks/useClients';
import { useClientAssignments, useUpdateClientAssignment } from '@/hooks/useClientAssignments';
import { AggregatedMetrics } from '@/hooks/useMetrics';
import { KPIThresholds, ClientSettings } from '@/hooks/useClientSettings';
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
import { Settings, ExternalLink, Copy, Trash2, GripVertical, BarChart3, ArrowUp, ArrowDown, ArrowUpDown, AlertCircle, CheckCircle, Clock, XCircle, AlertTriangle, Pencil, Calendar } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { SortConfig } from './SortableTableHeader';
import { formatDistanceToNow } from 'date-fns';
import { ClientApiStatus } from '@/hooks/useApiConnectionTest';
import { ApiConnectionStatus } from '@/components/settings/ApiConnectionStatus';

interface DraggableClientTableProps {
  clients: Client[];
  metrics: Record<string, AggregatedMetrics>;
  thresholds: Record<string, KPIThresholds>;
  fullSettings?: Record<string, ClientSettings>;
  onOpenSettings: (client: Client) => void;
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

  if (hasHubspotCredentials) {
    const hubspotSyncStatus = client.hubspot_sync_status;
    const lastHubspotSyncAt = client.last_hubspot_sync_at;
    const hubspotSyncError = client.hubspot_sync_error;
    if (hubspotSyncStatus) {
      // Override "healthy" to "stale" if last sync was >24 hours ago
      let effectiveStatus = hubspotSyncStatus as 'healthy' | 'stale' | 'error' | 'not_configured';
      if (effectiveStatus === 'healthy' && lastHubspotSyncAt) {
        const hoursSince = (Date.now() - new Date(lastHubspotSyncAt).getTime()) / (1000 * 60 * 60);
        if (hoursSince > 24) effectiveStatus = 'stale';
      }
      return {
        status: effectiveStatus,
        lastSyncAt: lastHubspotSyncAt,
        error: hubspotSyncError,
        source: 'hubspot',
      };
    }
    return { status: 'stale', lastSyncAt: null, error: null, source: 'hubspot' };
  }

  if (hasGhlCredentials) {
    const ghlSyncStatus = client.ghl_sync_status;
    const lastGhlSyncAt = client.last_ghl_sync_at;
    const ghlSyncError = client.ghl_sync_error;
    if (ghlSyncStatus) {
      // Override "healthy" to "stale" if last sync was >24 hours ago
      let effectiveStatus = ghlSyncStatus as 'healthy' | 'stale' | 'error' | 'not_configured';
      if (effectiveStatus === 'healthy' && lastGhlSyncAt) {
        const hoursSince = (Date.now() - new Date(lastGhlSyncAt).getTime()) / (1000 * 60 * 60);
        if (hoursSince > 24) effectiveStatus = 'stale';
      }
      return {
        status: effectiveStatus,
        lastSyncAt: lastGhlSyncAt,
        error: ghlSyncError,
        source: 'ghl',
      };
    }
    return { status: 'stale', lastSyncAt: null, error: null, source: 'ghl' };
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

export function DraggableClientTable({
  clients,
  metrics,
  thresholds,
  fullSettings = {},
  onOpenSettings,
  onDeleteClient,
  onReorder,
  isAdmin = false,
  apiTestResults = {},
}: DraggableClientTableProps) {
  const navigate = useNavigate();
  const { dateRange } = useDateFilter();
  const numberOfDays = useMemo(() => differenceInDays(dateRange.to, dateRange.from) + 1, [dateRange]);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [sortConfig, setSortConfig] = useState<SortConfig>({ column: '', direction: null });
  const updateClient = useUpdateClient();
  const { data: assignments = {} } = useClientAssignments();
  const updateAssignment = useUpdateClientAssignment();
  const { data: agencyMembers = [] } = useAgencyMembers();

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
    // Un-mark clients as inactive if the RPC-based metrics show they have data
    // (daily_metrics.leads may be stale if recalculate hasn't run yet)
    for (const clientId of set) {
      const m = metrics[clientId];
      if (m && ((m.totalAdSpend || 0) > 0 || (m.crmLeads || 0) > 0 || (m.totalCalls || 0) > 0)) {
        set.delete(clientId);
      }
    }
    return set;
  }, [yesterdayMetrics, clients, metrics]);
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
      const mrr = (s as any)?.mrr || 0;
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
        case 'crmLeads': aVal = a.metrics.crmLeads || 0; bVal = b.metrics.crmLeads || 0; break;
        case 'calls': aVal = a.metrics.totalCalls || 0; bVal = b.metrics.totalCalls || 0; break;
        case 'showed': aVal = a.metrics.showedCalls || 0; bVal = b.metrics.showedCalls || 0; break;
        case 'showRate': aVal = a.metrics.showedPercent || 0; bVal = b.metrics.showedPercent || 0; break;
        case 'costPerShow': aVal = a.metrics.costPerShow || 0; bVal = b.metrics.costPerShow || 0; break;
        case 'funded': aVal = a.metrics.fundedInvestors || 0; bVal = b.metrics.fundedInvestors || 0; break;
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
        <Table className="min-w-[1800px]">
          <TableHeader>
            <TableRow className="border-b h-7">
              <TableHead className="w-7 sticky left-0 bg-card z-10 py-0 px-1"></TableHead>
              <TableHead className="font-bold text-[11px] sticky left-7 bg-card z-10 min-w-[100px] py-0 px-1">Client</TableHead>
              <TableHead className="font-bold text-[11px] py-0 px-1 text-center">Status</TableHead>
              <TableHead className="font-bold text-[11px] py-0 px-1 text-center min-w-[80px]">MB</TableHead>
              <TableHead className="font-bold text-[11px] py-0 px-1 text-center min-w-[80px]">AM</TableHead>
              <SortableHeader column="adSpend" label="Spend" sortConfig={sortConfig} onSort={handleSort} />
              <SortableHeader column="dailyTarget" label="$/Day" sortConfig={sortConfig} onSort={handleSort} />
              <SortableHeader column="metaLeads" label="Meta Leads" sortConfig={sortConfig} onSort={handleSort} />
              <SortableHeader column="crmLeads" label="CRM Leads" sortConfig={sortConfig} onSort={handleSort} />
              <SortableHeader column="cpl" label="CPL" sortConfig={sortConfig} onSort={handleSort} />
              <SortableHeader column="calls" label="Booked" sortConfig={sortConfig} onSort={handleSort} />
              <SortableHeader column="costPerCall" label="$/Call" sortConfig={sortConfig} onSort={handleSort} />
              <SortableHeader column="showed" label="Shows" sortConfig={sortConfig} onSort={handleSort} />
              <SortableHeader column="showRate" label="Show%" sortConfig={sortConfig} onSort={handleSort} />
              <SortableHeader column="costPerShow" label="$/Show" sortConfig={sortConfig} onSort={handleSort} />
              <SortableHeader column="funded" label="Funded" sortConfig={sortConfig} onSort={handleSort} />
              <SortableHeader column="costOfCapital" label="CoC%" sortConfig={sortConfig} onSort={handleSort} />
              <TableHead className="font-bold text-[11px] text-center py-0 px-1">BN</TableHead>
              <TableHead className="font-bold text-[11px] text-center py-0 px-1">Meta</TableHead>
              <TableHead className="font-bold text-[11px] text-center py-0 px-1">CRM</TableHead>
              {isAdmin && <SortableHeader column="mrr" label="MRR" sortConfig={sortConfig} onSort={handleSort} />}
              <TableHead className="font-bold text-[11px] py-0 px-1 min-w-[70px]">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedClients.map(({ client, metrics: m, computed }) => {
              const t = thresholds[client.id] || {};
              const syncInfo = getClientSyncStatus(client);
              const syncBorderStyle = getSyncBorderStyle(syncInfo.status);
              const isInactive = inactiveClientIds.has(client.id);

              return (
                <TooltipProvider key={client.id}>
                  <TableRow
                    className={cn(
                      "cursor-pointer hover:bg-muted/50 border-b h-7 relative",
                      draggedId === client.id && "opacity-50",
                      syncBorderStyle,
                      isInactive && "opacity-60"
                    )}
                    style={isInactive ? {
                      backgroundImage: 'linear-gradient(transparent calc(50% - 0.5px), hsl(var(--destructive) / 0.35) calc(50% - 0.5px), hsl(var(--destructive) / 0.35) calc(50% + 0.5px), transparent calc(50% + 0.5px))',
                    } : undefined}
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
                              <div className={cn(
                                "ml-0.5",
                                syncInfo.status === 'healthy' && 'text-chart-2',
                                syncInfo.status === 'stale' && 'text-yellow-600 dark:text-yellow-500',
                                syncInfo.status === 'error' && 'text-destructive',
                                syncInfo.status === 'not_configured' && 'text-muted-foreground'
                              )}>
                                {syncInfo.status === 'healthy' && <CheckCircle className="h-2.5 w-2.5" />}
                                {syncInfo.status === 'stale' && <Clock className="h-2.5 w-2.5" />}
                                {syncInfo.status === 'error' && <XCircle className="h-2.5 w-2.5" />}
                                {syncInfo.status === 'not_configured' && <AlertCircle className="h-2.5 w-2.5" />}
                              </div>
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
                              </div>
                            </TooltipContent>
                          </Tooltip>
                        )}
                      </div>
                    </TableCell>

                    {/* Client name */}
                    <TableCell className="font-medium text-[11px] sticky left-7 bg-card z-10 py-0 px-1 truncate max-w-[120px]">
                      <span className="flex items-center gap-1">
                        {client.name}
                        {isInactive && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <AlertTriangle className="h-3 w-3 text-destructive shrink-0" />
                            </TooltipTrigger>
                            <TooltipContent side="right" className="text-xs">
                              $0 ad spend &amp; 0 leads yesterday
                            </TooltipContent>
                          </Tooltip>
                        )}
                      </span>
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
                    <TableCell className={cn(
                      "text-right font-mono tabular-nums text-[11px] py-0 px-1",
                      (m.totalAdSpend || 0) === 0 && !!client.meta_ad_account_id && client.status === 'active' && 'text-yellow-600 dark:text-yellow-500'
                    )}>
                      <span className="flex items-center justify-end gap-0.5">
                        {formatCurrency(m.totalAdSpend || 0)}
                        {(m.totalAdSpend || 0) === 0 && client.status === 'active' && !client.meta_ad_account_id && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <AlertTriangle className="h-2.5 w-2.5 text-muted-foreground shrink-0" />
                            </TooltipTrigger>
                            <TooltipContent side="top" className="text-xs max-w-[220px]">
                              No Meta ad account configured — add ad account ID in client settings
                            </TooltipContent>
                          </Tooltip>
                        )}
                        {(m.totalAdSpend || 0) === 0 && client.status === 'active' && !!client.meta_ad_account_id && computed.metaSync.status !== 'healthy' && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Clock className="h-2.5 w-2.5 text-yellow-600 dark:text-yellow-500 shrink-0" />
                            </TooltipTrigger>
                            <TooltipContent side="top" className="text-xs max-w-[250px]">
                              Meta account configured but $0 spend — Meta sync may not have run yet{computed.metaSync.lastSyncAt ? ` (last sync: ${formatDistanceToNow(new Date(computed.metaSync.lastSyncAt), { addSuffix: true })})` : ''}, or no ads running in this date range
                            </TooltipContent>
                          </Tooltip>
                        )}
                      </span>
                    </TableCell>

                    {/* Expected Spend ($/Day × days in range) */}
                    <TableCell className="text-right font-mono tabular-nums text-[11px] py-0 px-1">
                      {computed.dailyTarget > 0 ? formatCurrency(computed.dailyTarget * numberOfDays) : <span className="text-muted-foreground">-</span>}
                    </TableCell>

                    {/* Meta Leads (valid non-spam with email+phone) */}
                    <TableCell className="text-right font-mono tabular-nums text-[11px] py-0 px-1">
                      {m.totalLeads || 0}
                    </TableCell>

                    {/* CRM Leads (all leads from GHL/CRM — should be ≥ Meta Leads) */}
                    <TableCell className={cn(
                      "text-right font-mono tabular-nums text-[11px] py-0 px-1",
                      (() => {
                        const crmTotal = m.crmLeads || 0;
                        const metaLeads = m.totalLeads || 0;
                        const hasAdSpend = (m.totalAdSpend || 0) > 0;
                        // Flag: client has ad spend but 0 CRM leads = GHL integration issue
                        if (hasAdSpend && crmTotal === 0) return 'text-destructive font-semibold';
                        if (crmTotal === 0 && metaLeads === 0) return 'text-muted-foreground';
                        if (crmTotal >= metaLeads) return 'text-chart-2';
                        return 'text-destructive font-semibold';
                      })()
                    )}>
                      <span className="flex items-center justify-end gap-0.5">
                        {m.crmLeads || 0}
                        {(m.totalAdSpend || 0) > 0 && (m.crmLeads || 0) === 0 && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <AlertTriangle className="h-2.5 w-2.5 text-destructive shrink-0" />
                            </TooltipTrigger>
                            <TooltipContent side="top" className="text-xs max-w-[280px]">
                              {!client.ghl_api_key || !client.ghl_location_id
                                ? `${formatCurrency(m.totalAdSpend)} ad spend but no GHL credentials configured — add GHL API key & location ID in settings`
                                : syncInfo.status === 'error'
                                ? `${formatCurrency(m.totalAdSpend)} ad spend but GHL sync error — ${syncInfo.error || 'check API key and location ID'}`
                                : syncInfo.status === 'stale'
                                ? `${formatCurrency(m.totalAdSpend)} ad spend but GHL sync is stale (last sync: ${syncInfo.lastSyncAt ? formatDistanceToNow(new Date(syncInfo.lastSyncAt), { addSuffix: true }) : 'never'}) — run master sync`
                                : `${formatCurrency(m.totalAdSpend)} ad spend but 0 CRM leads — GHL integration problem, run master sync or check API key`
                              }
                            </TooltipContent>
                          </Tooltip>
                        )}
                      </span>
                    </TableCell>

                    {/* CPL */}
                    <TableCell className={cn(
                      "text-right font-mono tabular-nums text-[11px] py-0 px-1",
                      getThresholdColor(m.costPerLead || 0, t.costPerLead)
                    )}>
                      {formatCurrency(m.costPerLead || 0)}
                    </TableCell>

                    {/* Booked Calls */}
                    <TableCell className={cn(
                      "text-right font-mono tabular-nums text-[11px] py-0 px-1",
                      (() => {
                        const hasAdSpend = (m.totalAdSpend || 0) > 0;
                        const hasCalls = (m.totalCalls || 0) > 0;
                        const hasGHL = !!(client.ghl_api_key && client.ghl_location_id);
                        const hasCalendars = (fullSettings[client.id]?.tracked_calendar_ids || []).length > 0;
                        if (!hasCalls && hasAdSpend && hasGHL && !hasCalendars) return 'text-destructive font-semibold';
                        if (!hasCalls && hasAdSpend && hasGHL && hasCalendars) return 'text-yellow-600 dark:text-yellow-500';
                        if (!hasCalls && hasAdSpend && !hasGHL) return 'text-destructive font-semibold';
                        if (!hasCalls && hasAdSpend && syncInfo.status !== 'healthy') return 'text-yellow-600 dark:text-yellow-500';
                        if (!hasCalls && (m.crmLeads || 0) > 0) return 'text-yellow-600 dark:text-yellow-500';
                        return '';
                      })()
                    )}>
                      <span className="flex items-center justify-end gap-0.5">
                        {m.totalCalls || 0}
                        {(() => {
                          const hasAdSpend = (m.totalAdSpend || 0) > 0;
                          const hasCalls = (m.totalCalls || 0) > 0;
                          const hasGHL = !!(client.ghl_api_key && client.ghl_location_id);
                          const hasCalendars = (fullSettings[client.id]?.tracked_calendar_ids || []).length > 0;
                          if (hasCalls || !hasAdSpend) return null;
                          if (!hasGHL) return (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <AlertTriangle className="h-2.5 w-2.5 text-destructive shrink-0" />
                              </TooltipTrigger>
                              <TooltipContent side="top" className="text-xs max-w-[220px]">
                                No GHL credentials configured — add GHL API key &amp; location ID to sync calendar appointments
                              </TooltipContent>
                            </Tooltip>
                          );
                          if (!hasCalendars) return (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Calendar className="h-2.5 w-2.5 text-destructive shrink-0" />
                              </TooltipTrigger>
                              <TooltipContent side="top" className="text-xs max-w-[220px]">
                                No tracked calendars configured — add calendar IDs in client settings to sync booked/show calls
                              </TooltipContent>
                            </Tooltip>
                          );
                          return (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Clock className="h-2.5 w-2.5 text-yellow-600 dark:text-yellow-500 shrink-0" />
                              </TooltipTrigger>
                              <TooltipContent side="top" className="text-xs max-w-[250px]">
                                Calendars configured but 0 booked calls — calendar sync may not have run yet, or no appointments in this date range
                              </TooltipContent>
                            </Tooltip>
                          );
                        })()}
                      </span>
                    </TableCell>

                    {/* Cost per Call */}
                    <TableCell className={cn(
                      "text-right font-mono tabular-nums text-[11px] py-0 px-1",
                      getThresholdColor(m.costPerCall || 0, t.costPerCall)
                    )}>
                      {(m.costPerCall || 0) > 0 ? formatCurrency(m.costPerCall) : <span className="text-muted-foreground">-</span>}
                    </TableCell>

                    {/* Shows */}
                    <TableCell className={cn(
                      "text-right font-mono tabular-nums text-[11px] py-0 px-1",
                      (m.totalCalls || 0) > 0 && (m.showedCalls || 0) === 0 && 'text-yellow-600 dark:text-yellow-500'
                    )}>
                      <span className="flex items-center justify-end gap-0.5">
                        {m.showedCalls || 0}
                        {(m.totalCalls || 0) > 0 && (m.showedCalls || 0) === 0 && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Clock className="h-2.5 w-2.5 text-yellow-600 dark:text-yellow-500 shrink-0" />
                            </TooltipTrigger>
                            <TooltipContent side="top" className="text-xs max-w-[220px]">
                              {m.totalCalls} booked calls but 0 showed — appointment statuses may not have updated yet, or all were no-shows
                            </TooltipContent>
                          </Tooltip>
                        )}
                      </span>
                    </TableCell>

                    {/* Show Rate */}
                    <TableCell className={cn(
                      "text-right font-mono tabular-nums text-[11px] py-0 px-1",
                      (m.showedPercent || 0) >= 50 ? 'text-chart-2' :
                      (m.showedPercent || 0) >= 25 ? '' :
                      (m.totalCalls || 0) > 0 ? 'text-destructive' : 'text-muted-foreground'
                    )}>
                      {(m.totalCalls || 0) > 0 ? formatPercent(m.showedPercent || 0) : <span className="text-muted-foreground">-</span>}
                    </TableCell>

                    {/* Cost Per Show */}
                    <TableCell className={cn(
                      "text-right font-mono tabular-nums text-[11px] py-0 px-1",
                      getThresholdColor(m.costPerShow || 0, t.costPerShow)
                    )}>
                      {(m.costPerShow || 0) > 0 ? formatCurrency(m.costPerShow) : <span className="text-muted-foreground">-</span>}
                    </TableCell>

                    {/* Funded */}
                    <TableCell className={cn(
                      "text-right font-mono tabular-nums text-[11px] py-0 px-1",
                      (m.fundedInvestors || 0) > 0 && 'text-chart-2 font-semibold'
                    )}>
                      {m.fundedInvestors || 0}
                    </TableCell>

                    {/* Cost of Capital % */}
                    <TableCell className={cn(
                      "text-right font-mono tabular-nums text-[11px] py-0 px-1",
                      getThresholdColor(m.costOfCapital || 0, t.costOfCapital)
                    )}>
                      {(m.costOfCapital || 0) > 0 ? `${m.costOfCapital.toFixed(1)}%` : <span className="text-muted-foreground">-</span>}
                    </TableCell>


                    {/* Bottleneck */}
                    <TableCell className="text-center text-[11px] py-0 px-1">
                      {computed.bottleneck ? (
                        <span className="text-destructive line-through font-medium">
                          {computed.bottleneck.label}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">-</span>
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
                    <TableCell className="text-center py-0 px-1">
                      {syncInfo.status === 'healthy' && (
                        <Badge variant="success" className="text-[9px] px-1 py-0 h-4">
                          {syncInfo.source === 'hubspot' ? 'HS' : 'GHL'}
                        </Badge>
                      )}
                      {syncInfo.status === 'stale' && (
                        <Badge variant="secondary" className="text-[9px] px-1 py-0 h-4 border-yellow-500/50 text-yellow-600 dark:text-yellow-400">
                          {syncInfo.source === 'hubspot' ? 'HS' : 'GHL'}
                        </Badge>
                      )}
                      {syncInfo.status === 'error' && (
                        <Badge variant="destructive" className="text-[9px] px-1 py-0 h-4">Err</Badge>
                      )}
                      {syncInfo.status === 'not_configured' && (
                        <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 text-muted-foreground">—</Badge>
                      )}
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
                        <Button variant="ghost" size="icon" className="h-5 w-5" onClick={(e) => openAdsManager(e, client.business_manager_url)} title="Ads Manager">
                          <BarChart3 className="h-2.5 w-2.5" />
                        </Button>
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
        meta_access_token: accessToken || null,
      });
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
          <h4 className="font-medium text-xs">Meta Integration — {client.name}</h4>
          <div className="space-y-1.5">
            <label className="text-[11px] text-muted-foreground font-medium">Ad Account ID</label>
            <Input
              value={adAccountId}
              onChange={(e) => setAdAccountId(e.target.value)}
              placeholder="act_123456789"
              className="h-7 text-xs"
            />
          </div>
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
