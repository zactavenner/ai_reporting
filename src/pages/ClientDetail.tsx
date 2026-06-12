import { useState, useMemo, useEffect, lazy, Suspense, useCallback } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Settings, DollarSign, Upload, History, Plus, ExternalLink, X, Phone, Video, BarChart3, Palette, Layers, Cog, FileText, ClipboardList, CheckSquare, Building2, Copy, Sparkles, FolderOpen, Plug, Pencil, Users } from 'lucide-react';
import { LeadsDrillDownModal } from '@/components/drilldown/LeadsDrillDownModal';
import { CallsDrillDownModal } from '@/components/drilldown/CallsDrillDownModal';
import { AdSpendDrillDownModal } from '@/components/drilldown/AdSpendDrillDownModal';
import { FundedInvestorsDrillDownModal } from '@/components/drilldown/FundedInvestorsDrillDownModal';
import { toast } from 'sonner';
import { VoiceRecordButton } from '@/components/voice/VoiceRecordButton';
import { ClientPendingTasksButton } from '@/components/meetings/ClientPendingTasksButton';
import { ActivityPanel } from '@/components/activity/ActivityPanel';
import { ActivityTabView } from '@/components/activity/ActivityTabView';
import { Activity as ActivityIcon } from 'lucide-react';
import { ClientMeetingsSection } from '@/components/meetings/ClientMeetingsSection';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AISheetSummaryButton } from '@/components/ai/AISheetSummaryButton';
import { DateRangeFilter } from '@/components/dashboard/DateRangeFilter';
import { KPIGrid } from '@/components/dashboard/KPIGrid';
import { SectionErrorBoundary } from '@/components/ui/SectionErrorBoundary';
import { MetricChartsGrid } from '@/components/dashboard/MetricChartsGrid';
import { PeriodicStatsTable } from '@/components/dashboard/PeriodicStatsTable';
import { InlineRecordsView } from '@/components/dashboard/InlineRecordsView';
import { ClientSettingsModal } from '@/components/settings/ClientSettingsModal';
import { ShareableLinkButton } from '@/components/dashboard/ShareableLinkButton';
import { CSVImportModal, ImportType } from '@/components/import/CSVImportModal';
import { ImportHistoryModal } from '@/components/import/ImportHistoryModal';
import { AddCustomTabModal } from '@/components/import/AddCustomTabModal';
import { AgencySettingsModal } from '@/components/settings/AgencySettingsModal';
import { useAgencySettings } from '@/hooks/useAgencySettings';
import { useUpdateAgencySettings } from '@/hooks/useAgencySettings';
import { ThemeToggle } from '@/components/theme/ThemeToggle';
import { AIAnalysisChat } from '@/components/ai/AIAnalysisChat';
import { CashBagLoader } from '@/components/ui/CashBagLoader';
import { DataAuditSection } from '@/components/dashboard/DataAuditSection';
import { ClientQuickLinksBar } from '@/components/client/ClientQuickLinksBar';

import { Input } from '@/components/ui/input';
import { InlineUrlEmbed } from '@/components/settings/InlineUrlEmbed';
import { SlackChannelMappingSection } from '@/components/settings/SlackChannelMappingSection';
import { KPISettingsSection } from '@/components/settings/KPISettingsSection';
import { ClientBillingTab } from '@/components/billing/ClientBillingTab';
import { OnboardingChecklist } from '@/components/onboarding/OnboardingChecklist';
import { OnboardingIntake } from '@/components/onboarding/OnboardingIntake';

// Heavy per-tab views are lazy-loaded so they don't block the initial client page render.
const CreativesSection = lazy(() => import('@/components/creative/CreativesSection').then(m => ({ default: m.CreativesSection })));
const TaskBoardView = lazy(() => import('@/components/tasks/TaskBoardView').then(m => ({ default: m.TaskBoardView })));
const FunnelPreviewTab = lazy(() => import('@/components/funnel/FunnelPreviewTab').then(m => ({ default: m.FunnelPreviewTab })));
const SheetStatsTab = lazy(() => import('@/components/sheet-stats/SheetStatsTab').then(m => ({ default: m.SheetStatsTab })));
const PropertyManagerTab = lazy(() => import('@/components/properties/PropertyManagerTab').then(m => ({ default: m.PropertyManagerTab })));
const AIStudioTab = lazy(() => import('@/components/ai/AIStudioTab').then(m => ({ default: m.AIStudioTab })));
const ClientFolderTab = lazy(() => import('@/components/folder/ClientFolderTab').then(m => ({ default: m.ClientFolderTab })));
const ConnectionsTab = lazy(() => import('@/components/client/ConnectionsTab'));
import { BrandGuideSection } from '@/components/clients/BrandGuideSection';
import { ClientTeamSection } from '@/components/clients/ClientTeamSection';
import { useClient } from '@/hooks/useClients';
import { useDailyMetrics, useFundedInvestors } from '@/hooks/useMetrics';
import { useSourceAggregatedMetrics } from '@/hooks/useSourceMetrics';
import { usePriorPeriodMetrics } from '@/hooks/usePriorMetrics';
import { useLeads, useCalls } from '@/hooks/useLeadsAndCalls';
import { useClientSettings, getThresholdsFromSettings } from '@/hooks/useClientSettings';
import { useSheetMetrics } from '@/hooks/useSheetMetrics';
import { useMetricsSourcePreference } from '@/hooks/useMetricsSourcePreference';
import { MetricsSourceToggle } from '@/components/dashboard/MetricsSourceToggle';
import { useCustomTabs, useDeleteCustomTab, type CustomTab } from '@/hooks/useCustomTabs';
import { useAllTasks } from '@/hooks/useTasks';
import { useVoiceNotes } from '@/hooks/useVoiceNotes';
import { useMeetings } from '@/hooks/useMeetings';
import { useCreatives } from '@/hooks/useCreatives';
import { useDateFilter } from '@/contexts/DateFilterContext';
import { useTeamMember } from '@/contexts/TeamMemberContext';
import { useSourceFilteredMetrics } from '@/hooks/useSourceFilteredMetrics';
import { exportToCSV } from '@/lib/exportUtils';
import { useQueryClient } from '@tanstack/react-query';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

export default function ClientDetail() {
  const { clientId } = useParams<{ clientId: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [csvImportOpen, setCsvImportOpen] = useState(false);
  const [csvImportType, setCsvImportType] = useState<ImportType>('ad_spend');
  const [importHistoryOpen, setImportHistoryOpen] = useState(false);
  const [addTabOpen, setAddTabOpen] = useState(false);
  const [editingTab, setEditingTab] = useState<CustomTab | null>(null);
  const [agencyOpen, setAgencyOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [selectedRecord, setSelectedRecord] = useState<any>(null);
  const [selectedType, setSelectedType] = useState<string>('');
  const [drillDownModal, setDrillDownModal] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const { currentMember } = useTeamMember();
  const isAdmin = currentMember?.role === 'admin';

  // Deep-link: if ?task= is present, auto-switch to tasks tab
  useEffect(() => {
    const taskId = searchParams.get('task');
    const tabParam = searchParams.get('tab');
    if (tabParam) {
      setActiveTab(tabParam);
    }
    if (taskId) {
      setActiveTab('tasks');
    }
  }, [searchParams]);

  // Collapsible section states
  const [kpiOpen, setKpiOpen] = useState(true);
  const [chartsOpen, setChartsOpen] = useState(true);
  const [recordsOpen, setRecordsOpen] = useState(false);
  const [meetingsOpen, setMeetingsOpen] = useState(true);

  const { startDate, endDate } = useDateFilter();
  const { data: client, isLoading: clientLoading } = useClient(clientId);
  const { data: dailyMetrics = [], isLoading: metricsLoading } = useDailyMetrics(clientId, startDate, endDate);

  // Broadcast current client so the floating Agency AI Chat auto-scopes to this client
  useEffect(() => {
    if (!clientId) return;
    window.dispatchEvent(
      new CustomEvent('agency:current-client', { detail: { clientId, clientName: client?.name || '' } })
    );
  }, [clientId, client?.name]);
  const { data: fundedInvestors = [] } = useFundedInvestors(clientId, startDate, endDate);
  const { data: priorMetrics } = usePriorPeriodMetrics(clientId, startDate, endDate);
  const { data: leads = [], isLoading: leadsLoading } = useLeads(clientId, startDate, endDate);
  const { data: calls = [] } = useCalls(clientId, false, startDate, endDate);
  const { data: settings } = useClientSettings(clientId);
  const { data: agencySettings } = useAgencySettings();
  const { data: customTabs = [] } = useCustomTabs(clientId);
  const { data: allTasks = [] } = useAllTasks();
  const { data: voiceNotes = [] } = useVoiceNotes(clientId);
  const { data: meetings = [] } = useMeetings(clientId);
  const { data: creatives = [] } = useCreatives(clientId);
  
  const deleteCustomTab = useDeleteCustomTab();
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  const clientTasks = useMemo(() => {
    return allTasks.filter(t => t.client_id === clientId);
  }, [allTasks, clientId]);

  const handleActivityClick = (activityId: string, type: string, link?: string | null) => {
    if (type.startsWith('task_')) {
      setSearchParams({ task: activityId }, { replace: true });
      setActiveTab('tasks');
    } else if (type.startsWith('creative_')) {
      setSearchParams({ creative: activityId }, { replace: true });
      setActiveTab('creatives');
    } else if (type === 'meeting_synced') {
      if (link) {
        window.open(link, '_blank');
      } else {
        setSearchParams({ meeting: activityId }, { replace: true });
      }
    } else if (type === 'voice_note_recorded') {
      if (link) {
        window.open(link, '_blank');
      } else {
        setSearchParams({ voice: activityId }, { replace: true });
      }
    }
  };

  const { 
    filteredLeads, 
    filteredCalls, 
    filteredFundedInvestors,
    isFiltered: hasSourceFilter 
  } = useSourceFilteredMetrics(leads, calls, fundedInvestors, true);

  const aggregatedMetrics = useSourceAggregatedMetrics(
    hasSourceFilter ? filteredLeads : leads,
    hasSourceFilter ? filteredCalls : calls,
    hasSourceFilter ? filteredFundedInvestors : fundedInvestors,
    dailyMetrics,
    (settings as any)?.default_lead_pipeline_value || 0
  );

  // Sheet-backed metrics (Blue Capital + any client with a configured sheet)
  const sheetId = (settings as any)?.metrics_sheet_id as string | undefined;
  const sheetGid = (settings as any)?.metrics_sheet_gid as string | undefined;
  const sheetMapping = (settings as any)?.metrics_sheet_mapping as Record<string, string> | undefined;
  const sheetDefault = ((settings as any)?.metrics_source_default as 'sheet' | 'database') || 'database';
  const hasSheet = !!sheetId;
  const { source: metricsSource, setSource: setMetricsSource } = useMetricsSourcePreference(
    clientId, sheetDefault, hasSheet
  );
  const sheetQuery = useSheetMetrics(clientId, sheetId, sheetGid, startDate, endDate, sheetMapping);
  const useSheet = hasSheet && metricsSource === 'sheet';
  const activeMetrics = (useSheet && sheetQuery.data?.aggregated)
    ? sheetQuery.data.aggregated
    : aggregatedMetrics;
  const activeDailyMetrics = (useSheet && sheetQuery.data?.daily?.length)
    ? (sheetQuery.data.daily as any)
    : dailyMetrics;

  const thresholds = useMemo(() => getThresholdsFromSettings(settings), [settings]);
  const fundedInvestorLabel = settings?.funded_investor_label || 'Funded Investors';
  const isLeasing = (client as any)?.client_type === 'LEASING' || ((client?.name || '').toLowerCase().includes('lscre') && (client?.name || '').toLowerCase().includes('leasing'));
  const defaultTab = isLeasing ? 'properties' : 'tasks';
  const resolvedTab = activeTab || defaultTab;

  // Sync tab changes to the URL so the page is shareable / refresh-safe
  const handleTabChange = useCallback((tab: string) => {
    setActiveTab(tab);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set('tab', tab);
        return next;
      },
      { replace: true }
    );
  }, [setSearchParams]);

  const isLoading = clientLoading || metricsLoading;

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <div className="border-b border-border bg-card/80 sticky top-0 z-30 px-6 py-3 flex items-center gap-3">
          <div className="h-8 w-8 rounded-lg bg-muted animate-pulse" />
          <div className="h-5 w-40 rounded bg-muted animate-pulse" />
        </div>
        <div className="p-6 space-y-6">
          <div className="h-10 w-64 rounded-lg bg-muted animate-pulse" />
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {[...Array(12)].map((_, i) => (
              <div key={i} className="h-24 rounded-xl bg-muted animate-pulse" style={{ animationDelay: `${i * 40}ms` }} />
            ))}
          </div>
          <div className="h-64 rounded-xl bg-muted animate-pulse" />
        </div>
      </div>
    );
  }

  if (!client) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="rounded-full bg-muted p-5 inline-flex mb-2">
            <Users className="h-10 w-10 text-muted-foreground" />
          </div>
          <h2 className="text-xl font-semibold">Client not found</h2>
          <p className="text-sm text-muted-foreground">This client may have been deleted or the link is invalid.</p>
          <Button onClick={() => navigate("/")}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Clients
          </Button>
        </div>
      </div>
    );
  }

  const handleExportCSV = () => {
    exportToCSV(dailyMetrics, `${client.name}-daily-metrics`);
  };

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ['daily-metrics', clientId] });
    queryClient.invalidateQueries({ queryKey: ['funded-investors', clientId] });
    queryClient.invalidateQueries({ queryKey: ['call-recordings', clientId] });
    queryClient.invalidateQueries({ queryKey: ['leads', clientId] });
    queryClient.invalidateQueries({ queryKey: ['calls', clientId] });
    toast.success('Refreshed client data');
  };

  const openCsvImport = (type: ImportType) => {
    setCsvImportType(type);
    setCsvImportOpen(true);
  };

  const handleRecordSelect = (record: any, type: string) => {
    setSelectedRecord(record);
    setSelectedType(type);
  };

  const aiContext = {
    clientName: client.name,
    totalAdSpend: activeMetrics.totalAdSpend,
    leads: activeMetrics.totalLeads,
    calls: activeMetrics.totalCalls,
    showedCalls: activeMetrics.showedCalls,
    costPerLead: activeMetrics.costPerLead,
    costPerCall: activeMetrics.costPerCall,
    costPerShow: activeMetrics.costPerShow,
    fundedInvestors: activeMetrics.fundedInvestors,
    fundedDollars: activeMetrics.fundedDollars,
    costPerInvestor: activeMetrics.costPerInvestor,
    costOfCapital: activeMetrics.costOfCapital,
    showedPercent: activeMetrics.showedPercent,
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Slim header */}
      <header className="border-b border-border bg-card/80 apple-blur sticky top-0 z-30 px-6 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate('/')}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <h1 className="text-lg font-semibold tracking-tight">{client.name}</h1>
              <p className="text-xs text-muted-foreground hidden sm:block">Client performance & management</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 overflow-x-auto max-w-[60vw] sm:max-w-none pb-0.5">
            <MetricsSourceToggle
              source={metricsSource}
              onChange={setMetricsSource}
              hasSheet={hasSheet}
              lastSyncedAt={sheetQuery.data?.fetchedAt}
              rowCount={sheetQuery.data?.rowCount}
              isLoading={sheetQuery.isFetching}
              onRefresh={() => sheetQuery.refetch()}
            />
            <ClientQuickLinksBar client={client} />
            {(client.slug || client.public_token) && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.open(`${window.location.origin}/public/${client.slug || client.public_token}`, '_blank')}
              >
                <ExternalLink className="h-4 w-4 mr-1.5" />
                View Public Link
              </Button>
            )}
            <AISheetSummaryButton clientId={client.id} clientName={client.name} />
            <VoiceRecordButton clientId={client.id} clientName={client.name} isPublicView={false} />
            <ClientPendingTasksButton clientId={client.id} />
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-auto">
        <div className="p-6 space-y-6">

        {/* Grouped Tabs - matching 6.0 */}
        <Tabs value={resolvedTab} onValueChange={handleTabChange} className="space-y-6">
          <TabsList className="bg-muted/50 overflow-x-auto flex-nowrap w-full justify-start h-auto py-1 px-1">
            {isLeasing && (
              <TabsTrigger value="properties" className="gap-2">
                <Building2 className="h-4 w-4" />
                Properties
              </TabsTrigger>
            )}
            <TabsTrigger value="tasks" className="gap-2">
              <CheckSquare className="h-4 w-4" />
              Tasks
            </TabsTrigger>
            <TabsTrigger value="creatives" className="gap-2">
              <Palette className="h-4 w-4" />
              Creatives
            </TabsTrigger>
            <TabsTrigger value="ai-studio" className="gap-2">
              <Sparkles className="h-4 w-4" />
              AI Studio
            </TabsTrigger>
            <TabsTrigger value="folder" className="gap-2">
              <FolderOpen className="h-4 w-4" />
              Folder
            </TabsTrigger>
            <TabsTrigger value="master-doc" className="gap-2">
              <FileText className="h-4 w-4" />
              Master Doc
            </TabsTrigger>
            <TabsTrigger value="reporting-sheet" className="gap-2">
              <ClipboardList className="h-4 w-4" />
              Reporting Sheet
            </TabsTrigger>
            <TabsTrigger value="sheet-stats" className="gap-2">
              <ClipboardList className="h-4 w-4" />
              Sheet Stats
            </TabsTrigger>
            <TabsTrigger value="company-info" className="gap-2">
              <Building2 className="h-4 w-4" />
              Company Info
            </TabsTrigger>
            <TabsTrigger value="pipeline" className="gap-2">
              <Layers className="h-4 w-4" />
              Funnel
            </TabsTrigger>
            <TabsTrigger value="activity" className="gap-2">
              <ActivityIcon className="h-4 w-4" />
              Activity
            </TabsTrigger>
            <TabsTrigger value="client-settings" className="gap-2">
              <Cog className="h-4 w-4" />
              Settings
            </TabsTrigger>
          </TabsList>

          {/* Lazy-loaded tab contents wrapped in a single Suspense — only one renders at a time */}
          <Suspense fallback={<div className="py-12 flex justify-center"><CashBagLoader message="Loading…" /></div>}>
          {/* ─── PROPERTIES TAB (LEASING) ─── */}
          {isLeasing && (
            <TabsContent value="properties" className="space-y-6">
              <SectionErrorBoundary sectionName="Properties">
                <PropertyManagerTab clientId={clientId!} clientName={client.name} />
              </SectionErrorBoundary>
            </TabsContent>
          )}

          {/* ─── TASKS TAB ─── */}
          <TabsContent value="tasks" className="space-y-6">
            <SectionErrorBoundary sectionName="Task Board">
              <h2 className="text-lg font-bold mb-3">Tasks</h2>
              <TaskBoardView clientId={clientId} />
            </SectionErrorBoundary>
          </TabsContent>

          {/* ─── CREATIVES TAB ─── */}
          <TabsContent value="creatives" className="space-y-6">
            <SectionErrorBoundary sectionName="Creatives">
              <h2 className="text-lg font-bold mb-3">Creative Assets</h2>
              <CreativesSection
                clientId={client.id}
                clientName={client.name}
                isPublicView={false}
              />
            </SectionErrorBoundary>
          </TabsContent>

          {/* ─── AI STUDIO TAB ─── */}
          <TabsContent value="ai-studio" className="m-0">
            <SectionErrorBoundary sectionName="AI Studio">
              {/* Bound height so the chat & canvas panels scroll internally and
                  stay aligned as the conversation grows, instead of letting the
                  page itself scroll and pushing the canvas out of view. */}
              <div className="h-[calc(100vh-220px)] min-h-[600px]">
                <AIStudioTab clientId={client.id} clientName={client.name} />
              </div>
            </SectionErrorBoundary>
          </TabsContent>

          {/* ─── FOLDER TAB ─── */}
          <TabsContent value="folder" className="space-y-4">
            <SectionErrorBoundary sectionName="Folder">
              <ClientFolderTab clientId={client.id} clientName={client.name} />
            </SectionErrorBoundary>
          </TabsContent>

          {/* ─── MASTER DOC TAB ─── */}
          <TabsContent value="master-doc" className="space-y-4">
            <SectionErrorBoundary sectionName="Master Doc">
              <h2 className="text-lg font-bold mb-3">Master Doc</h2>
              <InlineUrlEmbed
                label="Master Doc"
                url=""
                fieldKey="kpi_google_doc_url"
                clientId={clientId}
              />
            </SectionErrorBoundary>
          </TabsContent>

          {/* ─── REPORTING SHEET TAB ─── */}
          <TabsContent value="reporting-sheet" className="space-y-4">
            <SectionErrorBoundary sectionName="Reporting Sheet">
              <h2 className="text-lg font-bold mb-3">Reporting Sheet</h2>
              <InlineUrlEmbed
                label="Reporting Sheet"
                url=""
                fieldKey="kpi_google_sheet_url"
                clientId={clientId}
              />
            </SectionErrorBoundary>
          </TabsContent>

          {/* ─── SHEET STATS TAB ─── */}
          <TabsContent value="sheet-stats" className="space-y-4">
            <SectionErrorBoundary sectionName="Sheet Stats">
              <h2 className="text-lg font-bold mb-3">Sheet Stats</h2>
              <SheetStatsTab clientId={client.id} />
            </SectionErrorBoundary>
          </TabsContent>

          {/* ─── COMPANY INFO TAB ─── */}
          <TabsContent value="company-info" className="space-y-6">
            <SectionErrorBoundary sectionName="Company Info">
              <div className="max-w-3xl">
                <div className="mb-4">
                  <h2 className="text-lg font-bold">Company Info</h2>
                  <p className="text-sm text-muted-foreground">
                    Description, brand colors, fonts and product images used by the AI when generating ads and creatives.
                  </p>
                </div>
                <BrandGuideSection client={client} />
                <ClientTeamSection clientId={clientId} />
                <div className="mt-10 pt-8 border-t border-border">
                  <div className="mb-4">
                    <h2 className="text-lg font-bold flex items-center gap-2">
                      <CheckSquare className="h-4 w-4 text-primary" />
                      Onboarding Info
                    </h2>
                    <p className="text-sm text-muted-foreground">
                      Onboarding checklist and required intake details for this client.
                    </p>
                  </div>
                  <div className="space-y-6">
                    <OnboardingIntake clientId={clientId} />
                    <OnboardingChecklist clientId={clientId} clientType={client?.description} />
                  </div>
                </div>
              </div>
            </SectionErrorBoundary>
          </TabsContent>

          {/* ─── PIPELINE TAB ─── */}
          <TabsContent value="pipeline" className="space-y-6">
            <SectionErrorBoundary sectionName="Funnel">
              <FunnelPreviewTab clientId={client.id} isPublicView={false} />
            </SectionErrorBoundary>
          </TabsContent>

          {/* ─── ACTIVITY TAB ─── */}
          <TabsContent value="activity" className="space-y-6">
            <SectionErrorBoundary sectionName="Activity">
              <h2 className="text-lg font-bold mb-3">Activity</h2>
              <ActivityTabView
                tasks={clientTasks}
                voiceNotes={voiceNotes}
                meetings={meetings}
                creatives={creatives}
                onActivityClick={handleActivityClick}
              />
            </SectionErrorBoundary>
          </TabsContent>

          {/* ─── SETTINGS TAB ─── */}
          <TabsContent value="client-settings" className="space-y-6">
            {/* Connections (moved from separate tab) */}
            <SectionErrorBoundary sectionName="Connections">
              <ConnectionsTab clientId={client.id} />
            </SectionErrorBoundary>

            {/* Quick Actions */}
            <div className="space-y-3">
              <h2 className="text-lg font-bold pt-4 border-t border-border">Quick Actions</h2>
              <div className="flex flex-wrap items-center gap-2">
                <VoiceRecordButton clientId={client.id} clientName={client.name} isPublicView={false} />
                <ActivityPanel
                  tasks={clientTasks}
                  voiceNotes={voiceNotes}
                  meetings={meetings}
                  creatives={creatives}
                  isPublicView={false}
                  clientId={client.id}
                  clientName={client.name}
                  onActivityClick={handleActivityClick}
                />
                <ShareableLinkButton
                  clientId={client.id}
                  clientName={client.name}
                  publicToken={client.public_token}
                  slug={client.slug}
                />
                <Button variant="outline" size="sm" onClick={() => setSettingsOpen(true)}>
                  <Settings className="h-4 w-4 mr-2" />
                  Client Settings
                </Button>
                <Button variant="outline" size="sm" onClick={() => setAgencyOpen(true)}>
                  <Cog className="h-4 w-4 mr-2" />
                  Agency Settings
                </Button>
              </div>
            </div>

            {/* Public Links */}
            <div className="space-y-3">
              <h2 className="text-lg font-bold">Public Links</h2>
              <div className="border border-border rounded-lg p-4 bg-card space-y-3">
                {(client.slug || client.public_token) ? (
                  <>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">Client Dashboard</span>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            const url = `${window.location.origin}/public/${client.slug || client.public_token}`;
                            navigator.clipboard.writeText(url);
                            toast.success('Dashboard link copied!');
                          }}
                        >
                          <Copy className="h-3.5 w-3.5 mr-1.5" />
                          Copy Link
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground font-mono bg-muted px-2 py-1 rounded truncate">
                        {window.location.origin}/public/{client.slug || client.public_token}
                      </p>
                    </div>
                    <div className="border-t border-border pt-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <span className="text-sm font-medium">Upload Portal</span>
                          <p className="text-xs text-muted-foreground">No password required — anyone with this link can upload files</p>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            const url = `${window.location.origin}/upload/${client.slug || client.public_token}`;
                            navigator.clipboard.writeText(url);
                            toast.success('Upload link copied!');
                          }}
                        >
                          <Copy className="h-3.5 w-3.5 mr-1.5" />
                          Copy Link
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground font-mono bg-muted px-2 py-1 rounded truncate mt-2">
                        {window.location.origin}/upload/{client.slug || client.public_token}
                      </p>
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">No public link available. Generate one in Client Settings.</p>
                )}
              </div>
            </div>

            {/* Slack Integration */}
            <SectionErrorBoundary sectionName="Slack Integration">
              <h2 className="text-lg font-bold mb-3">Slack Integration</h2>
              <div className="border-2 border-border p-4">
                <SlackChannelMappingSection clientId={client.id} />
              </div>
            </SectionErrorBoundary>

            {/* KPI & Revenue Settings */}
            <SectionErrorBoundary sectionName="KPI Settings">
              <h2 className="text-lg font-bold mb-3">KPI & Revenue Settings</h2>
              <KPISettingsSection clientId={client.id} standalone />
            </SectionErrorBoundary>

            {/* Billing */}
            {isAdmin && (
              <SectionErrorBoundary sectionName="Billing">
                <h2 className="text-lg font-bold mb-3">Billing</h2>
                <ClientBillingTab clientId={client.id} clientName={client.name} />
              </SectionErrorBoundary>
            )}

            {/* Import tools */}
            <div className="space-y-3">
              <h2 className="text-lg font-bold">Data Import</h2>
              <div className="flex flex-wrap gap-2">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm">
                      <Upload className="h-4 w-4 mr-2" />
                      Import CSV
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <DropdownMenuItem onClick={() => openCsvImport('ad_spend')}>
                      <DollarSign className="h-4 w-4 mr-2" />
                      Ad Spend (Meta Export)
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => openCsvImport('leads')}>Leads</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => openCsvImport('calls')}>Calls</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => openCsvImport('call_summary')}>
                      <Phone className="h-4 w-4 mr-2" />
                      Call Summary
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => openCsvImport('funded_investors')}>Funded Investors</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <Button variant="outline" size="sm" onClick={() => setImportHistoryOpen(true)}>
                  <History className="h-4 w-4 mr-2" />
                  Import History
                </Button>
              </div>
            </div>

            {/* External links / Custom tabs */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold">Connected Accounts & Links</h2>
                <Button variant="ghost" size="sm" onClick={() => setAddTabOpen(true)}>
                  <Plus className="h-4 w-4 mr-1" />
                  Add Link
                </Button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {client.ghl_location_id && (
                  <Button
                    variant="outline"
                    className="justify-start"
                    onClick={() => window.open(`https://app.gohighlevel.com/v2/location/${client.ghl_location_id}/dashboard`, '_blank')}
                  >
                    <ExternalLink className="h-4 w-4 mr-2" />
                    GHL Dashboard
                  </Button>
                )}
                {client.business_manager_url && (
                  <Button
                    variant="outline"
                    className="justify-start"
                    onClick={() => window.open(client.business_manager_url!, '_blank')}
                  >
                    <BarChart3 className="h-4 w-4 mr-2" />
                    Meta Ads Manager
                  </Button>
                )}
                {customTabs.map((tab) => (
                  <div key={tab.id} className="relative group">
                    <Button
                      variant="outline"
                      className="justify-start w-full"
                      onClick={() => window.open(tab.url, '_blank')}
                    >
                      <ExternalLink className="h-4 w-4 mr-2" />
                      {tab.name}
                    </Button>
                    <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingTab(tab);
                          setAddTabOpen(true);
                        }}
                        title="Edit link"
                      >
                        <Pencil className="h-3 w-3" />
                      </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          title="Remove link"
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Remove Link?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This will remove the "{tab.name}" link. This action cannot be undone.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={() => deleteCustomTab.mutate({ id: tab.id, clientId: clientId! })}>
                            Remove
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </TabsContent>
        </Suspense>
        </Tabs>
        </div>
      </main>

      {/* Modals */}
      <ClientSettingsModal client={client} open={settingsOpen} onOpenChange={setSettingsOpen} />
      <CSVImportModal clientId={clientId || ''} importType={csvImportType} open={csvImportOpen} onOpenChange={setCsvImportOpen} />
      <ImportHistoryModal clientId={clientId || ''} open={importHistoryOpen} onOpenChange={setImportHistoryOpen} />
      <AddCustomTabModal
        clientId={clientId || ''}
        open={addTabOpen}
        onOpenChange={(o) => {
          setAddTabOpen(o);
          if (!o) setEditingTab(null);
        }}
        editTab={editingTab}
      />
      <AgencySettingsModal open={agencyOpen} onOpenChange={setAgencyOpen} />
      <AIAnalysisChat context={aiContext} />

      {/* Drill-Down Modals */}
      <LeadsDrillDownModal clientId={clientId} open={drillDownModal === 'leads'} onOpenChange={(open) => !open && setDrillDownModal(null)} />
      <CallsDrillDownModal clientId={clientId} open={drillDownModal === 'calls'} onOpenChange={(open) => !open && setDrillDownModal(null)} />
      <CallsDrillDownModal clientId={clientId} showedOnly open={drillDownModal === 'showedCalls'} onOpenChange={(open) => !open && setDrillDownModal(null)} />
      <AdSpendDrillDownModal clientId={clientId} open={drillDownModal === 'totalAdSpend'} onOpenChange={(open) => !open && setDrillDownModal(null)} />
      <FundedInvestorsDrillDownModal clientId={clientId} open={drillDownModal === 'fundedInvestors'} onOpenChange={(open) => !open && setDrillDownModal(null)} />
    </div>
  );
}