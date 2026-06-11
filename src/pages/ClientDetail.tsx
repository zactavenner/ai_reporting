import { useState, useMemo, useEffect } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Settings, DollarSign, Upload, History, Plus, ExternalLink, X, Phone, Video, BarChart3, TrendingUp, Palette, Layers, Cog, Megaphone, FileText, ClipboardList, CheckSquare, MessageSquare, Globe, Building2, Copy } from 'lucide-react';
import { SlackChatTab } from '@/components/slack/SlackChatTab';
import { LeadsDrillDownModal } from '@/components/drilldown/LeadsDrillDownModal';
import { CallsDrillDownModal } from '@/components/drilldown/CallsDrillDownModal';
import { AdSpendDrillDownModal } from '@/components/drilldown/AdSpendDrillDownModal';
import { FundedInvestorsDrillDownModal } from '@/components/drilldown/FundedInvestorsDrillDownModal';
import { toast } from 'sonner';
import { VoiceRecordButton } from '@/components/voice/VoiceRecordButton';
import { ActivityPanel } from '@/components/activity/ActivityPanel';
import { ClientMeetingsSection } from '@/components/meetings/ClientMeetingsSection';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
import { CreativesSection } from '@/components/creative/CreativesSection';
import { ThemeToggle } from '@/components/theme/ThemeToggle';
import { AIAnalysisChat } from '@/components/ai/AIAnalysisChat';
import { CashBagLoader } from '@/components/ui/CashBagLoader';
import { TaskBoardView } from '@/components/tasks/TaskBoardView';
import { DataAuditSection } from '@/components/dashboard/DataAuditSection';

import { FunnelPreviewTab } from '@/components/funnel/FunnelPreviewTab';
import { PipelineTab } from '@/components/pipeline/PipelineTab';
import { AdsManagerTab } from '@/components/ads-manager/AdsManagerTab';
import { ClientOffersSection } from '@/components/offers/ClientOffersSection';
import { ClientFunnelsTab } from '@/components/quiz/ClientFunnelsTab';
import { ClientFulfillmentWorkspace } from '@/components/fulfillment/ClientFulfillmentWorkspace';
import { PropertyManagerTab } from '@/components/properties/PropertyManagerTab';
import { AttributionSettings } from '@/components/ads-manager/AttributionSettings';
import { SlackChannelMappingSection } from '@/components/settings/SlackChannelMappingSection';
import { RevenueAttributionPanel } from '@/components/dashboard/RevenueAttributionPanel';
import CustomerJourneyPanel from '@/components/dashboard/CustomerJourneyPanel';
import { GoalTrackerWidget } from '@/components/dashboard/GoalTrackerWidget';
import { KPISettingsSection } from '@/components/settings/KPISettingsSection';
import { ClientBillingTab } from '@/components/billing/ClientBillingTab';
import { useClient } from '@/hooks/useClients';
import { useDailyMetrics, useFundedInvestors } from '@/hooks/useMetrics';
import { useSourceAggregatedMetrics } from '@/hooks/useSourceMetrics';
import { usePriorPeriodMetrics } from '@/hooks/usePriorMetrics';
import { useLeads, useCalls } from '@/hooks/useLeadsAndCalls';
import { useClientSettings, getThresholdsFromSettings } from '@/hooks/useClientSettings';
import { useCustomTabs, useDeleteCustomTab } from '@/hooks/useCustomTabs';
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
  const { data: fundedInvestors = [] } = useFundedInvestors(clientId, startDate, endDate);
  const { data: priorMetrics } = usePriorPeriodMetrics(clientId, startDate, endDate);
  const { data: leads = [], isLoading: leadsLoading } = useLeads(clientId, startDate, endDate);
  const { data: calls = [] } = useCalls(clientId, false, startDate, endDate);
  const { data: settings } = useClientSettings(clientId);
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

  const handleActivityClick = (activityId: string, type: string) => {
    if (type.startsWith('task_')) {
      setSearchParams({ task: activityId }, { replace: true });
      setActiveTab('tasks');
    } else if (type.startsWith('creative_')) {
      setActiveTab('creatives');
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

  const thresholds = useMemo(() => getThresholdsFromSettings(settings), [settings]);
  const fundedInvestorLabel = settings?.funded_investor_label || 'Funded Investors';
  const isLeasing = (client as any)?.client_type === 'LEASING' || ((client?.name || '').toLowerCase().includes('lscre') && (client?.name || '').toLowerCase().includes('leasing'));
  const defaultTab = isLeasing ? 'properties' : 'performance';
  const resolvedTab = activeTab || defaultTab;
  const isLoading = clientLoading || metricsLoading;

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <CashBagLoader message="Loading client..." />
      </div>
    );
  }

  if (!client) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p>Client not found</p>
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
    totalAdSpend: aggregatedMetrics.totalAdSpend,
    leads: aggregatedMetrics.totalLeads,
    calls: aggregatedMetrics.totalCalls,
    showedCalls: aggregatedMetrics.showedCalls,
    costPerLead: aggregatedMetrics.costPerLead,
    costPerCall: aggregatedMetrics.costPerCall,
    costPerShow: aggregatedMetrics.costPerShow,
    fundedInvestors: aggregatedMetrics.fundedInvestors,
    fundedDollars: aggregatedMetrics.fundedDollars,
    costPerInvestor: aggregatedMetrics.costPerInvestor,
    costOfCapital: aggregatedMetrics.costOfCapital,
    showedPercent: aggregatedMetrics.showedPercent,
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
          <div className="flex items-center gap-1.5">
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
            <VoiceRecordButton clientId={client.id} clientName={client.name} isPublicView={false} />
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-auto">
        <div className="sticky top-0 z-20 bg-background/95 backdrop-blur-sm border-b border-border px-6 py-3">
          <DateRangeFilter showAddClient={false} onExportCSV={handleExportCSV} onRefresh={handleRefresh} />
        </div>
        <div className="p-6 space-y-6">

        {/* Grouped Tabs - matching 6.0 */}
        <Tabs value={resolvedTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="bg-muted/50 flex-wrap">
            {isLeasing ? (
              <TabsTrigger value="properties" className="gap-2">
                <Building2 className="h-4 w-4" />
                Properties
              </TabsTrigger>
            ) : (
              <TabsTrigger value="performance" className="gap-2">
                <TrendingUp className="h-4 w-4" />
                Performance
              </TabsTrigger>
            )}
            <TabsTrigger value="tasks" className="gap-2">
              <CheckSquare className="h-4 w-4" />
              Tasks
            </TabsTrigger>
            <TabsTrigger value="records" className="gap-2">
              <ClipboardList className="h-4 w-4" />
              Attribution & Records
            </TabsTrigger>
            <TabsTrigger value="ads-manager" className="gap-2">
              <Megaphone className="h-4 w-4" />
              Ads Manager
            </TabsTrigger>
            <TabsTrigger value="attribution" className="gap-2">
              <TrendingUp className="h-4 w-4" />
              Attribution
            </TabsTrigger>
            <TabsTrigger value="creatives" className="gap-2">
              <Palette className="h-4 w-4" />
              Creatives
            </TabsTrigger>
            <TabsTrigger value="offers" className="gap-2">
              <FileText className="h-4 w-4" />
              Offers
            </TabsTrigger>
            <TabsTrigger value="pipeline" className="gap-2">
              <Layers className="h-4 w-4" />
              Pipeline
            </TabsTrigger>
            <TabsTrigger value="slack" className="gap-2">
              <MessageSquare className="h-4 w-4" />
              Slack
            </TabsTrigger>
            <TabsTrigger value="funnels" className="gap-2">
              <Globe className="h-4 w-4" />
              Funnels
            </TabsTrigger>
            <TabsTrigger value="client-settings" className="gap-2">
              <Cog className="h-4 w-4" />
              Settings
            </TabsTrigger>
          </TabsList>

          {/* ─── PROPERTIES TAB (LEASING) ─── */}
          {isLeasing && (
            <TabsContent value="properties" className="space-y-6">
              <SectionErrorBoundary sectionName="Properties">
                <PropertyManagerTab clientId={clientId!} clientName={client.name} />
              </SectionErrorBoundary>
            </TabsContent>
          )}

          {/* ─── PERFORMANCE TAB ─── */}
          <TabsContent value="performance" className="space-y-6">
            
            <Collapsible open={kpiOpen} onOpenChange={setKpiOpen}>
              <CollapsibleTrigger className="flex items-center gap-2 w-full text-left">
                <h2 className="text-lg font-bold">Key Performance Indicators</h2>
                <span className="text-xs text-muted-foreground">{kpiOpen ? '▾' : '▸'}</span>
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-3">
                <SectionErrorBoundary sectionName="KPI Grid">
                  <KPIGrid
                    metrics={aggregatedMetrics}
                    priorMetrics={priorMetrics || undefined}
                    showFundedMetrics
                    thresholds={thresholds}
                    fundedInvestorLabel={fundedInvestorLabel}
                    onMetricClick={(metric) => setDrillDownModal(metric)}
                  />
                </SectionErrorBoundary>
              </CollapsibleContent>
            </Collapsible>

            <SectionErrorBoundary sectionName="KPI Goals">
              <GoalTrackerWidget clientId={clientId} />
            </SectionErrorBoundary>

            <SectionErrorBoundary sectionName="Performance Summary">
              <PeriodicStatsTable clientId={clientId} />
            </SectionErrorBoundary>

            <Collapsible open={chartsOpen} onOpenChange={setChartsOpen}>
              <CollapsibleTrigger className="flex items-center gap-2 w-full text-left">
                <h2 className="text-lg font-bold">Metric Charts</h2>
                <span className="text-xs text-muted-foreground">{chartsOpen ? '▾' : '▸'}</span>
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-3">
                <SectionErrorBoundary sectionName="Metric Charts">
                  <MetricChartsGrid dailyMetrics={dailyMetrics} />
                </SectionErrorBoundary>
              </CollapsibleContent>
            </Collapsible>

            {meetings.length > 0 && (
              <Collapsible open={meetingsOpen} onOpenChange={setMeetingsOpen}>
                <CollapsibleTrigger className="flex items-center gap-2 w-full text-left">
                  <Video className="h-5 w-5 text-muted-foreground" />
                  <h2 className="text-lg font-bold">Recent Meetings</h2>
                  <span className="text-xs text-muted-foreground">{meetingsOpen ? '▾' : '▸'}</span>
                </CollapsibleTrigger>
                <CollapsibleContent className="mt-3">
                  <SectionErrorBoundary sectionName="Meetings">
                    <ClientMeetingsSection meetings={meetings} client={client} />
                  </SectionErrorBoundary>
                </CollapsibleContent>
              </Collapsible>
            )}
          </TabsContent>

          {/* ─── TASKS TAB ─── */}
          <TabsContent value="tasks" className="space-y-6">
            <SectionErrorBoundary sectionName="Task Board">
              <h2 className="text-lg font-bold mb-3">Tasks</h2>
              <TaskBoardView clientId={clientId} />
            </SectionErrorBoundary>
          </TabsContent>

          {/* ─── ATTRIBUTION & RECORDS TAB ─── */}
          <TabsContent value="records" className="space-y-6">
            <SectionErrorBoundary sectionName="Records">
              <h2 className="text-lg font-bold mb-3">Detailed Records</h2>
              <InlineRecordsView
                dailyMetrics={dailyMetrics}
                leads={leads}
                calls={calls}
                fundedInvestors={fundedInvestors}
                isLoading={metricsLoading || leadsLoading}
                onRecordSelect={handleRecordSelect}
                selectedRecord={selectedRecord}
                selectedType={selectedType}
                clientId={clientId}
                ghlLocationId={client.ghl_location_id}
              />
            </SectionErrorBoundary>
            {clientId && (
              <SectionErrorBoundary sectionName="Data Audit">
                <DataAuditSection clientId={clientId} />
              </SectionErrorBoundary>
            )}
          </TabsContent>

          {/* ─── ADS MANAGER TAB ─── */}
          <TabsContent value="ads-manager" className="space-y-6">
            <SectionErrorBoundary sectionName="Ads Manager">
              <AdsManagerTab clientId={client.id} clientName={client.name} />
            </SectionErrorBoundary>

            <SectionErrorBoundary sectionName="Attribution Settings">
              <h2 className="text-lg font-bold mb-3">Attribution Settings</h2>
              <AttributionSettings clientId={client.id} />
            </SectionErrorBoundary>
          </TabsContent>

          {/* ─── ATTRIBUTION TAB ─── */}
          <TabsContent value="attribution" className="space-y-6">
            <SectionErrorBoundary sectionName="Revenue Attribution">
              <RevenueAttributionPanel deals={[]} />
            </SectionErrorBoundary>

            <SectionErrorBoundary sectionName="Customer Journey">
              <CustomerJourneyPanel leads={leads} clientId={clientId} />
            </SectionErrorBoundary>

            <SectionErrorBoundary sectionName="KPI Goals">
              <GoalTrackerWidget clientId={clientId} />
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

          {/* ─── OFFERS TAB ─── */}
          <TabsContent value="offers" className="space-y-6">
            <SectionErrorBoundary sectionName="Offers">
              <ClientFulfillmentWorkspace client={client} />
            </SectionErrorBoundary>
          </TabsContent>

          {/* ─── PIPELINE TAB ─── */}
          <TabsContent value="pipeline" className="space-y-6">
            <SectionErrorBoundary sectionName="Pipeline">
              <h2 className="text-lg font-bold mb-3">Sales Pipeline</h2>
              <PipelineTab clientId={client.id} isPublicView={false} />
            </SectionErrorBoundary>

            <SectionErrorBoundary sectionName="Funnel Preview">
              <h2 className="text-lg font-bold mb-3">Funnel Pages</h2>
              <FunnelPreviewTab clientId={client.id} isPublicView={false} />
            </SectionErrorBoundary>
          </TabsContent>

          {/* ─── SLACK TAB ─── */}
          <TabsContent value="slack" className="space-y-6">
            <SectionErrorBoundary sectionName="Slack Chat">
              <h2 className="text-lg font-bold mb-3">Slack Channels</h2>
              <SlackChatTab clientId={client.id} clientName={client.name} />
            </SectionErrorBoundary>
          </TabsContent>

          {/* ─── FUNNELS TAB ─── */}
          <TabsContent value="funnels" className="space-y-6">
            <SectionErrorBoundary sectionName="Funnels">
              <ClientFunnelsTab
                clientId={clientId!}
                clientName={client?.name || ''}
                clientSlug={(client as any)?.slug}
                offerDescription={(client as any)?.offer_description}
                logoUrl={(client as any)?.logo_url}
              />
            </SectionErrorBoundary>
          </TabsContent>

          {/* ─── SETTINGS TAB ─── */}
          <TabsContent value="client-settings" className="space-y-6">
            {/* Quick Actions */}
            <div className="space-y-3">
              <h2 className="text-lg font-bold">Quick Actions</h2>
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
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
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
                ))}
              </div>
            </div>
          </TabsContent>
        </Tabs>
        </div>
      </main>

      {/* Modals */}
      <ClientSettingsModal client={client} open={settingsOpen} onOpenChange={setSettingsOpen} />
      <CSVImportModal clientId={clientId || ''} importType={csvImportType} open={csvImportOpen} onOpenChange={setCsvImportOpen} />
      <ImportHistoryModal clientId={clientId || ''} open={importHistoryOpen} onOpenChange={setImportHistoryOpen} />
      <AddCustomTabModal clientId={clientId || ''} open={addTabOpen} onOpenChange={setAddTabOpen} />
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
