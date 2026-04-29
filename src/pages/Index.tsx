import { useState, useMemo, useEffect, useCallback, lazy, Suspense } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { SidebarProvider } from '@/components/ui/sidebar';
import { AppSidebar } from '@/components/layout/AppSidebar';
import { AppHeader } from '@/components/layout/AppHeader';
import { DateRangeFilter } from '@/components/dashboard/DateRangeFilter';
import { DataAccuracyAuditPanel } from '@/components/dashboard/DataAccuracyAuditPanel';
import { KPIGrid } from '@/components/dashboard/KPIGrid';
import { DraggableClientTable } from '@/components/dashboard/DraggableClientTable';
import { AgencyStatsBar } from '@/components/dashboard/AgencyStatsBar';
import { AgencySyncStatusPanel } from '@/components/dashboard/AgencySyncStatusPanel';
import { ClientSettingsModal } from '@/components/settings/ClientSettingsModal';
import { AgencySettingsModal } from '@/components/settings/AgencySettingsModal';
import { AddClientModal } from '@/components/settings/AddClientModal';
import { DeleteClientDialog } from '@/components/settings/DeleteClientDialog';
import { AgencyAIChat } from '@/components/ai/AgencyAIChat';
import { AIHubTab } from '@/components/ai/AIHubTab';
import { TaskBoardView } from '@/components/tasks/TaskBoardView';
import { TaskDetailPanel } from '@/components/tasks/TaskDetailPanel';
import { MetricsCustomizeModal } from '@/components/dashboard/MetricsCustomizeModal';
import { LeadsDrillDownModal } from '@/components/drilldown/LeadsDrillDownModal';
import { CallsDrillDownModal } from '@/components/drilldown/CallsDrillDownModal';
import { FundedInvestorsDrillDownModal } from '@/components/drilldown/FundedInvestorsDrillDownModal';
import { AdSpendDrillDownModal } from '@/components/drilldown/AdSpendDrillDownModal';
import { MeetingsTab } from '@/components/meetings/MeetingsTab';

import { PendingTasksReview } from '@/components/meetings/PendingTasksReview';
import { SectionErrorBoundary } from '@/components/ui/SectionErrorBoundary';
import { FunnelPreviewTab } from '@/components/funnel/FunnelPreviewTab';
import { AgencyBillingTab } from '@/components/billing/AgencyBillingTab';
import { DealPipelineBoard } from '@/components/deals/DealPipelineBoard';
import { DataHealthCard } from '@/components/dashboard/DataHealthCard';
import { AgencyIntegrationsTab } from '@/components/settings/AgencyIntegrationsTab';
import { IntegrationStatusCards } from '@/components/dashboard/IntegrationStatusCards';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sliders, CheckCircle, RefreshCw, Wifi, Smartphone } from 'lucide-react';
import { MasterMetaTokenCard } from '@/components/dashboard/MasterMetaTokenCard';
import { OutreachTab } from '@/components/outreach/OutreachTab';
import { OnboardingTab } from '@/components/dashboard/OnboardingTab';
import { useClients, Client } from '@/hooks/useClients';
import { useAllDailyMetrics, useFundedInvestors, AggregatedMetrics } from '@/hooks/useMetrics';
import { aggregateFromSourceData, SourceAggregatedMetrics } from '@/hooks/useSourceMetrics';
import { useClientSourceMetrics, buildClientMetricsFromRPC } from '@/hooks/useClientSourceMetrics';
import { useAllClientSettings, useAllClientFullSettings } from '@/hooks/useAllClientSettings';
import { useAllClientMRR } from '@/hooks/useClientMRR';
import { useMeetings, usePendingMeetingTasks, useSyncMeetings } from '@/hooks/useMeetings';
import { useApiConnectionTest } from '@/hooks/useApiConnectionTest';
import { useAllCreatives } from '@/hooks/useAllCreatives';
import { useDateFilter } from '@/contexts/DateFilterContext';
import { useSourceFilteredMetrics } from '@/hooks/useSourceFilteredMetrics';
import { useLeads, useCalls } from '@/hooks/useLeadsAndCalls';
import { exportToCSV } from '@/lib/exportUtils';
import { useQueryClient } from '@tanstack/react-query';
import { useUpdateClientOrder } from '@/hooks/useClientOrder';
import { useTeamMember } from '@/contexts/TeamMemberContext';
import { Task } from '@/hooks/useTasks';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

// Inline page components for Database, Spam (rendered inside sidebar layout)
import DatabaseView from './DatabaseView';
import SpamBlacklist from './SpamBlacklist';
import { AdminAdsManagerTab } from '@/components/ads-manager/AdminAdsManagerTab';
import { AdminOffersTab } from '@/components/offers/AdminOffersTab';
import { QuizBuilderTab } from '@/components/quiz/QuizBuilderTab';
import { AgentsTab } from '@/components/agents/AgentsTab';
import { AvatarAdProvider } from '@/context/AvatarAdContext';
import { AvatarAdWizard } from '@/components/avatar-ad/AvatarAdWizard';

const StaticCreativesInline = lazy(() => import('@/pages/StaticCreativesPage'));
const AvatarAdGenInline = lazy(() => Promise.resolve({ default: () => <AvatarAdProvider><AvatarAdWizard /></AvatarAdProvider> }));
import { TopPerformersSection } from '@/components/creative/TopPerformersSection';

const Index = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { currentMember, logout } = useTeamMember();
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [agencySettingsOpen, setAgencySettingsOpen] = useState(false);
  const [addClientOpen, setAddClientOpen] = useState(false);
  const [deleteClient, setDeleteClient] = useState<Client | null>(null);
  const [metricsCustomizeOpen, setMetricsCustomizeOpen] = useState(false);
  const [drillDownModal, setDrillDownModal] = useState<string | null>(null);
  const [pendingTasksOpen, setPendingTasksOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [selectedFunnelClientId, setSelectedFunnelClientId] = useState<string | null>(null);
  const [globalTask, setGlobalTask] = useState<Task | null>(null);
  const [globalTaskOpen, setGlobalTaskOpen] = useState(false);
  const queryClient = useQueryClient();

  // Handle notification task click: fetch task by ID and open panel instantly
  const handleNotificationTaskClick = useCallback(async (taskId: string) => {
    try {
      const { data, error } = await supabase
        .from('tasks')
        .select('*')
        .eq('id', taskId)
        .single();
      if (error || !data) {
        toast.error('Task not found');
        return;
      }
      setGlobalTask(data as Task);
      setGlobalTaskOpen(true);
    } catch {
      toast.error('Failed to load task');
    }
  }, []);

  // Deep-link: if ?tab= or ?task= is present, auto-switch
  useEffect(() => {
    const tab = searchParams.get('tab');
    const taskId = searchParams.get('task');
    if (tab) {
      setActiveTab(tab);
    } else if (taskId) {
      setActiveTab('tasks');
    }
  }, [searchParams]);
  const updateClientOrder = useUpdateClientOrder();

  const { startDate, endDate, sourceFilter } = useDateFilter();
  const { data: allClients = [], isLoading: clientsLoading } = useClients();
  const clients = useMemo(() => allClients.filter(c => c.status === 'active' || c.status === 'onboarding' || c.status === 'paused'), [allClients]);
  const { data: dailyMetrics = [], isLoading: metricsLoading } = useAllDailyMetrics(startDate, endDate);
  const { data: fundedInvestors = [] } = useFundedInvestors(undefined, startDate, endDate);
  const { data: allLeads = [] } = useLeads(undefined, startDate, endDate);
  const { data: allCalls = [] } = useCalls(undefined, false, startDate, endDate);
  const { data: rpcMetrics = [] } = useClientSourceMetrics(startDate, endDate);
  
  const clientIds = useMemo(() => clients.map(c => c.id), [clients]);
  const { data: clientThresholds = {} } = useAllClientSettings(clientIds);
  const { data: clientFullSettings = {} } = useAllClientFullSettings(clientIds);
  const { data: clientMRRSettings = {} } = useAllClientMRR(clientIds);
  
  const { data: meetings = [] } = useMeetings();
  const { data: pendingTasks = [] } = usePendingMeetingTasks();
  const syncMeetings = useSyncMeetings();
  const { testResults, isTesting, testAllClients, getClientStatus } = useApiConnectionTest();
  const { data: allCreatives = [] } = useAllCreatives();
  const pendingCreatives = allCreatives.filter(c => c.status === 'pending');

  const { filteredLeads, filteredCalls, filteredFundedInvestors, isFiltered: hasSourceFilter } = useSourceFilteredMetrics(allLeads, allCalls, fundedInvestors, true);

  const clientMetrics = useMemo(() => {
    return buildClientMetricsFromRPC(rpcMetrics, dailyMetrics, clientFullSettings);
  }, [rpcMetrics, dailyMetrics, clientFullSettings]);

  const aggregatedMetrics = useMemo(() => {
    const allClientMetrics = Object.values(clientMetrics);
    if (allClientMetrics.length === 0) {
      return aggregateFromSourceData(allLeads, allCalls, fundedInvestors, dailyMetrics);
    }
    
    const totals = allClientMetrics.reduce(
      (acc, m) => ({
        totalAdSpend: acc.totalAdSpend + m.totalAdSpend,
        totalLeads: acc.totalLeads + m.totalLeads,
        spamLeads: acc.spamLeads + m.spamLeads,
        crmLeads: acc.crmLeads + (m.crmLeads || 0),
        totalCalls: acc.totalCalls + m.totalCalls,
        showedCalls: acc.showedCalls + m.showedCalls,
        reconnectCalls: acc.reconnectCalls + m.reconnectCalls,
        reconnectShowed: acc.reconnectShowed + m.reconnectShowed,
        fundedInvestors: acc.fundedInvestors + m.fundedInvestors,
        fundedDollars: acc.fundedDollars + m.fundedDollars,
        totalCommitments: acc.totalCommitments + m.totalCommitments,
        commitmentDollars: acc.commitmentDollars + m.commitmentDollars,
        pipelineValue: acc.pipelineValue + m.pipelineValue,
      }),
      {
        totalAdSpend: 0, totalLeads: 0, spamLeads: 0, crmLeads: 0, totalCalls: 0,
        showedCalls: 0, reconnectCalls: 0, reconnectShowed: 0,
        fundedInvestors: 0, fundedDollars: 0, totalCommitments: 0,
        commitmentDollars: 0, pipelineValue: 0,
      }
    );

    const dailyTotals = dailyMetrics.reduce(
      (acc, day) => ({
        totalClicks: acc.totalClicks + (day.clicks || 0),
        totalImpressions: acc.totalImpressions + (day.impressions || 0),
      }),
      { totalClicks: 0, totalImpressions: 0 }
    );

    return {
      ...totals,
      ctr: dailyTotals.totalImpressions > 0 ? (dailyTotals.totalClicks / dailyTotals.totalImpressions) * 100 : 0,
      costPerLead: totals.totalLeads > 0 ? totals.totalAdSpend / totals.totalLeads : 0,
      costPerCall: totals.totalCalls > 0 ? totals.totalAdSpend / totals.totalCalls : 0,
      showedPercent: totals.totalCalls > 0 ? (totals.showedCalls / totals.totalCalls) * 100 : 0,
      costPerShow: totals.showedCalls > 0 ? totals.totalAdSpend / totals.showedCalls : 0,
      costPerInvestor: totals.fundedInvestors > 0 ? totals.totalAdSpend / totals.fundedInvestors : 0,
      costOfCapital: totals.fundedDollars > 0 ? (totals.totalAdSpend / totals.fundedDollars) * 100 : 0,
      avgTimeToFund: 0,
      avgCallsToFund: 0,
      leadToBookedPercent: totals.totalLeads > 0 ? (totals.totalCalls / totals.totalLeads) * 100 : 0,
      closeRate: totals.showedCalls > 0 ? (totals.fundedInvestors / totals.showedCalls) * 100 : 0,
      costPerReconnectCall: totals.reconnectCalls > 0 ? totals.totalAdSpend / totals.reconnectCalls : 0,
      costPerReconnectShowed: totals.reconnectShowed > 0 ? totals.totalAdSpend / totals.reconnectShowed : 0,
    } as SourceAggregatedMetrics;
  }, [clientMetrics, dailyMetrics, allLeads, allCalls, fundedInvestors]);

  const clientAdSpends = useMemo(() => {
    const spends: Record<string, number> = {};
    for (const [clientId, m] of Object.entries(clientMetrics)) {
      spends[clientId] = m.totalAdSpend || 0;
    }
    return spends;
  }, [clientMetrics]);

  const handleOpenSettings = (client: Client) => {
    setSelectedClient(client);
    setSettingsOpen(true);
  };

  const handleExportCSV = () => {
    exportToCSV(dailyMetrics, 'all-clients-metrics', {
      startDate: startDate ? String(startDate).split('T')[0] : undefined,
      endDate: endDate ? String(endDate).split('T')[0] : undefined,
    });
  };

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ['all-daily-metrics'] });
    queryClient.invalidateQueries({ queryKey: ['funded-investors'] });
    queryClient.invalidateQueries({ queryKey: ['clients'] });
    queryClient.invalidateQueries({ queryKey: ['all-client-settings'] });
    queryClient.invalidateQueries({ queryKey: ['all-client-full-settings'] });
    queryClient.invalidateQueries({ queryKey: ['all-client-mrr'] });
    queryClient.invalidateQueries({ queryKey: ['leads'] });
    queryClient.invalidateQueries({ queryKey: ['calls'] });
    queryClient.invalidateQueries({ queryKey: ['daily-metrics'] });
    queryClient.invalidateQueries({ queryKey: ['client-source-metrics'] });
    queryClient.invalidateQueries({ queryKey: ['yesterday-metrics'] });
    queryClient.invalidateQueries({ queryKey: ['integration-status'] });
    queryClient.invalidateQueries({ queryKey: ['accuracy-health'] });
    queryClient.invalidateQueries({ queryKey: ['sync-health'] });
    queryClient.invalidateQueries({ queryKey: ['outreach-campaigns'] });
    queryClient.invalidateQueries({ queryKey: ['outreach-messages'] });
    queryClient.invalidateQueries({ queryKey: ['outreach-stats'] });
    toast.success('Refreshed dashboard data');
  };

  const handleReorder = (orderedIds: string[]) => {
    updateClientOrder.mutate(orderedIds);
  };

  // Handle sidebar navigation for utility pages
  const handleTabChange = (tab: string) => {
    setActiveTab(tab);
  };

  const isLoading = clientsLoading || metricsLoading;

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full">
        <AppSidebar
          activeTab={activeTab}
          onTabChange={handleTabChange}
          pendingMeetingCount={pendingTasks.length}
          pendingCreativeCount={pendingCreatives.length}
          isAdmin={currentMember?.role === 'admin'}
        />
        <div className="flex-1 flex flex-col min-w-0">
          <AppHeader
            onSettings={() => setAgencySettingsOpen(true)}
            currentMemberName={currentMember?.name}
            onLogout={currentMember ? logout : undefined}
            onTaskClick={handleNotificationTaskClick}
          />

          <main className="flex-1 p-6 space-y-6 overflow-auto">
            {/* Database utility page */}
            {activeTab === 'database' && <DatabaseView embedded />}

            {/* Spam utility page */}
            {activeTab === 'spam' && <SpamBlacklist embedded />}

            {/* Onboarding */}
            {activeTab === 'onboarding' && <OnboardingTab />}

            {/* Ads Manager */}
            {activeTab === 'ads-manager' && <AdminAdsManagerTab platform="all" />}

            {/* Offers */}
            {activeTab === 'offers' && (
              <SectionErrorBoundary sectionName="Offers">
                <div className="mb-4">
                  <h2 className="text-lg font-bold">Offers</h2>
                  <p className="text-sm text-muted-foreground">Manage offers across all clients — the main feed for building statics & videos</p>
                </div>
                <AdminOffersTab clients={clients} />
              </SectionErrorBoundary>
            )}

            {/* Dashboard */}
            {activeTab === 'dashboard' && (
              <>
                <DateRangeFilter
                  onExportCSV={handleExportCSV}
                  onAddClient={() => setAddClientOpen(true)}
                  onRefresh={handleRefresh}
                />

                <SectionErrorBoundary sectionName="Client Summary">
                  <section>
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <h2 className="text-lg font-bold">Client Summary</h2>
                        <p className="text-sm text-muted-foreground">Aggregated performance metrics by client</p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => testAllClients(clientIds)}
                        disabled={isTesting || clients.length === 0}
                      >
                        <Wifi className={`h-4 w-4 mr-2 ${isTesting ? 'animate-pulse' : ''}`} />
                        {isTesting ? 'Testing...' : 'Test Connections'}
                      </Button>
                    </div>
                    {isLoading ? (
                      <div className="text-center py-8 text-muted-foreground">Loading clients...</div>
                    ) : clients.length === 0 ? (
                      <div className="border-2 border-border bg-card p-8 text-center">
                        <p className="text-muted-foreground mb-2">No clients configured yet</p>
                        <p className="text-sm text-muted-foreground">Add a client to start tracking metrics</p>
                      </div>
                    ) : (
                      <>
                        <AgencyStatsBar
                          clients={clients}
                          clientMRRSettings={clientMRRSettings}
                          clientAdSpends={clientAdSpends}
                          clientFullSettings={clientFullSettings}
                          isAdmin={currentMember?.role === 'admin'}
                        />
                        <DraggableClientTable
                          clients={clients}
                          metrics={clientMetrics}
                          thresholds={clientThresholds}
                          fullSettings={clientFullSettings}
                          onOpenSettings={handleOpenSettings}
                          onDeleteClient={(c) => setDeleteClient(c)}
                          onReorder={handleReorder}
                          isAdmin={currentMember?.role === 'admin'}
                          apiTestResults={testResults}
                        />
                      </>
                    )}
                  </section>
                </SectionErrorBoundary>

                <SectionErrorBoundary sectionName="KPI Grid">
                  <section>
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <h2 className="text-lg font-bold">Key Performance Indicators</h2>
                        <p className="text-sm text-muted-foreground">Agency-wide performance metrics with trend comparison</p>
                      </div>
                      <Button variant="outline" size="sm" onClick={() => setMetricsCustomizeOpen(true)}>
                        <Sliders className="h-4 w-4 mr-2" />
                        Customize
                      </Button>
                    </div>
                    {isLoading ? (
                      <div className="text-center py-8 text-muted-foreground">Loading metrics...</div>
                    ) : (
                      <KPIGrid
                        metrics={aggregatedMetrics}
                        showFundedMetrics
                        onMetricClick={(metric) => setDrillDownModal(metric)}
                        dailySnapshots={dailyMetrics.slice(-7)}
                      />
                    )}
                  </section>
                </SectionErrorBoundary>

                <SectionErrorBoundary sectionName="Integration Health">
                  <section>
                    <h2 className="text-lg font-bold mb-2">Integration Health</h2>
                    <IntegrationStatusCards onNavigateToSettings={() => {}} />
                  </section>
                </SectionErrorBoundary>

                <SectionErrorBoundary sectionName="Sync Status">
                  <AgencySyncStatusPanel
                    clients={clients}
                    clientFullSettings={clientFullSettings}
                    clientMetrics={clientMetrics}
                  />
                </SectionErrorBoundary>

                <SectionErrorBoundary sectionName="Data Health">
                  <DataHealthCard />
                </SectionErrorBoundary>

                {currentMember?.role === 'admin' && (
                  <SectionErrorBoundary sectionName="Master Meta Token">
                    <MasterMetaTokenCard />
                  </SectionErrorBoundary>
                )}
              </>
            )}

            {/* Tasks */}
            {activeTab === 'tasks' && (
              <SectionErrorBoundary sectionName="Task Board">
                <TaskBoardView />
              </SectionErrorBoundary>
            )}

            {/* AI Hub */}
            {activeTab === 'ai' && (
              <SectionErrorBoundary sectionName="AI Hub">
                <AIHubTab
                  clients={clients}
                  clientMetrics={clientMetrics as Record<string, AggregatedMetrics>}
                  agencyMetrics={aggregatedMetrics}
                />
              </SectionErrorBoundary>
            )}

            {/* Meetings */}
            {activeTab === 'meetings' && (
              <SectionErrorBoundary sectionName="Meetings">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h2 className="text-lg font-bold">Meetings & Highlights</h2>
                    <p className="text-sm text-muted-foreground">Synced from MeetGeek with action items and highlights</p>
                  </div>
                  <div className="flex gap-2">
                    {pendingTasks.length > 0 && (
                      <Button variant="outline" size="sm" onClick={() => setPendingTasksOpen(true)}>
                        <CheckCircle className="h-4 w-4 mr-2" />
                        {pendingTasks.length} Pending Tasks
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => syncMeetings.mutate()}
                      disabled={syncMeetings.isPending}
                    >
                      <RefreshCw className={`h-4 w-4 mr-2 ${syncMeetings.isPending ? 'animate-spin' : ''}`} />
                      Sync
                    </Button>
                  </div>
                </div>
                <MeetingsTab meetings={meetings} clients={clients} />
              </SectionErrorBoundary>
            )}

            {/* Static Ads */}
            {activeTab === 'static-ads' && (
              <SectionErrorBoundary sectionName="Static Ads">
                <Suspense fallback={<div className="animate-pulse h-64 bg-muted/30 rounded-lg" />}>
                  <StaticCreativesInline />
                </Suspense>
              </SectionErrorBoundary>
            )}

            {/* Video Ads (Avatar Ad Gen) */}
            {activeTab === 'avatar-ad-gen' && (
              <SectionErrorBoundary sectionName="Video Ads">
                <div className="mb-4">
                  <h2 className="text-lg font-bold">Video Ads</h2>
                  <p className="text-sm text-muted-foreground">Generate AI-powered video ads with avatars</p>
                </div>
                <Suspense fallback={<div className="animate-pulse h-64 bg-muted/30 rounded-lg" />}>
                  <AvatarAdGenInline />
                </Suspense>
              </SectionErrorBoundary>
            )}

            {/* Top Performers */}
            {activeTab === 'top-performers' && (
              <SectionErrorBoundary sectionName="Top Performers">
                <div className="mb-4">
                  <h2 className="text-lg font-bold">Top Performers</h2>
                  <p className="text-sm text-muted-foreground">Best performing creatives across all clients</p>
                </div>
                <TopPerformersSection clients={clients} />
              </SectionErrorBoundary>
            )}

            {/* Funnel */}
            {activeTab === 'funnel-builder' && (
              <SectionErrorBoundary sectionName="Funnel Preview">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-4">
                  <div>
                    <h2 className="text-lg font-bold">Funnel Previews</h2>
                    <p className="text-sm text-muted-foreground">Preview funnel pages across all clients</p>
                  </div>
                  <Select
                    value={selectedFunnelClientId || ''}
                    onValueChange={(v) => setSelectedFunnelClientId(v || null)}
                  >
                    <SelectTrigger className="w-[200px]">
                      <SelectValue placeholder="Select a client" />
                    </SelectTrigger>
                    <SelectContent>
                      {clients.map((client) => (
                        <SelectItem key={client.id} value={client.id}>{client.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {selectedFunnelClientId ? (
                  <FunnelPreviewTab clientId={selectedFunnelClientId} />
                ) : (
                  <div className="border-2 border-dashed border-border rounded-lg p-12 text-center">
                    <Smartphone className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                    <p className="text-muted-foreground">Select a client to view their funnel</p>
                  </div>
                )}
              </SectionErrorBoundary>
            )}

            {/* Quiz Builder */}
            {activeTab === 'funnel-quiz' && (
              <SectionErrorBoundary sectionName="Quiz Builder">
                <QuizBuilderTab />
              </SectionErrorBoundary>
            )}

            {/* Deals */}
            {activeTab === 'deals' && (
              <SectionErrorBoundary sectionName="Deal Pipeline">
                <DealPipelineBoard />
              </SectionErrorBoundary>
            )}

            {/* Outreach */}
            {activeTab === 'outreach' && (
              <SectionErrorBoundary sectionName="AI Outreach">
                <div className="mb-4">
                  <h2 className="text-lg font-bold">AI Outreach</h2>
                  <p className="text-sm text-muted-foreground">Automated text messaging and AI voice calls</p>
                </div>
                <OutreachTab />
              </SectionErrorBoundary>
            )}

            {/* Billing */}
            {activeTab === 'billing' && currentMember?.role === 'admin' && (
              <SectionErrorBoundary sectionName="Billing">
                <AgencyBillingTab clients={clients} />
              </SectionErrorBoundary>
            )}

            {/* Data Accuracy Audit */}
            {activeTab === 'data-audit' && currentMember?.role === 'admin' && (
              <SectionErrorBoundary sectionName="DataAccuracyAudit">
                <DataAccuracyAuditPanel />
              </SectionErrorBoundary>
            )}

            {/* Agents */}
            {activeTab === 'agents' && (
              <SectionErrorBoundary sectionName="Agents">
                <AgentsTab clients={clients} />
              </SectionErrorBoundary>
            )}

            {/* Integrations */}
            {activeTab === 'integrations' && (
              <SectionErrorBoundary sectionName="Integrations">
                <AgencyIntegrationsTab />
              </SectionErrorBoundary>
            )}

            {/* Avatar Ad Generator */}
            {activeTab === 'avatar-ad-gen' && (
              <SectionErrorBoundary sectionName="Avatar Ad Generator">
                <div className="mb-4">
                  <h2 className="text-lg font-bold">AI Avatar Ad Generator</h2>
                  <p className="text-sm text-muted-foreground">Create hyper-realistic AI avatar video ads for investment offers</p>
                </div>
                <AvatarAdProvider>
                  <AvatarAdWizard />
                </AvatarAdProvider>
              </SectionErrorBoundary>
            )}
          </main>
        </div>
      </div>

      {/* Modals */}
      <ClientSettingsModal client={selectedClient} open={settingsOpen} onOpenChange={setSettingsOpen} />
      <AgencySettingsModal open={agencySettingsOpen} onOpenChange={setAgencySettingsOpen} />
      <AddClientModal open={addClientOpen} onOpenChange={setAddClientOpen} />
      <DeleteClientDialog client={deleteClient} open={!!deleteClient} onOpenChange={(open) => !open && setDeleteClient(null)} />
      <AgencyAIChat clients={clients} clientMetrics={clientMetrics as Record<string, AggregatedMetrics>} agencyMetrics={aggregatedMetrics} />
      <MetricsCustomizeModal open={metricsCustomizeOpen} onOpenChange={setMetricsCustomizeOpen} />
      <LeadsDrillDownModal open={drillDownModal === 'leads' || drillDownModal === 'crmLeads'} onOpenChange={(open) => !open && setDrillDownModal(null)} />
      <CallsDrillDownModal open={drillDownModal === 'calls'} onOpenChange={(open) => !open && setDrillDownModal(null)} />
      <CallsDrillDownModal showedOnly open={drillDownModal === 'showedCalls'} onOpenChange={(open) => !open && setDrillDownModal(null)} />
      <FundedInvestorsDrillDownModal open={drillDownModal === 'fundedInvestors'} onOpenChange={(open) => !open && setDrillDownModal(null)} />
      <AdSpendDrillDownModal open={drillDownModal === 'totalAdSpend'} onOpenChange={(open) => !open && setDrillDownModal(null)} />
      <PendingTasksReview tasks={pendingTasks} clients={clients} open={pendingTasksOpen} onOpenChange={setPendingTasksOpen} />
      
      {/* Global task detail panel for notification clicks */}
      <TaskDetailPanel
        task={globalTask}
        open={globalTaskOpen}
        onOpenChange={(open) => {
          setGlobalTaskOpen(open);
          if (!open) setGlobalTask(null);
        }}
        clientName={clients.find(c => c.id === globalTask?.client_id)?.name}
        clientId={globalTask?.client_id}
      />
    </SidebarProvider>
  );
};

export default Index;
