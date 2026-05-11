import { useState, useMemo, useEffect } from 'react';

import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useClientByToken } from '@/hooks/useClients';
import { TeamMemberProvider } from '@/contexts/TeamMemberContext';
import { DateFilterProvider, useDateFilter } from '@/contexts/DateFilterContext';
import { useDailyMetrics, useFundedInvestors } from '@/hooks/useMetrics';
import { useSourceAggregatedMetrics } from '@/hooks/useSourceMetrics';
import { useLeads, useCalls } from '@/hooks/useLeadsAndCalls';
import { useCustomTabs } from '@/hooks/useCustomTabs';
import { useFunnelSteps } from '@/hooks/useFunnelSteps';
import { useTasks } from '@/hooks/useTasks';
import { useVoiceNotes } from '@/hooks/useVoiceNotes';
import { useMeetings } from '@/hooks/useMeetings';
import { useCreatives } from '@/hooks/useCreatives';
import { useClientSettings } from '@/hooks/useClientSettings';
import { useSheetMetrics } from '@/hooks/useSheetMetrics';
import { useMetricsSourcePreference } from '@/hooks/useMetricsSourcePreference';
import { MetricsSourceToggle } from '@/components/dashboard/MetricsSourceToggle';
import { KPIGrid } from '@/components/dashboard/KPIGrid';
import { DateRangeFilter } from '@/components/dashboard/DateRangeFilter';
import { MetricChartsGrid } from '@/components/dashboard/MetricChartsGrid';
import { PeriodicStatsTable } from '@/components/dashboard/PeriodicStatsTable';
import { InlineRecordsView } from '@/components/dashboard/InlineRecordsView';
import { CreativeApproval } from '@/components/creative/CreativeApproval';
import { AIAnalysisChat } from '@/components/ai/AIAnalysisChat';
import { TaskBoardView } from '@/components/tasks/TaskBoardView';
import { AttributionDashboard } from '@/components/dashboard/AttributionDashboard';
import { ActivityPanel } from '@/components/activity/ActivityPanel';
import { PublicLinkPasswordGate } from '@/components/auth/PublicLinkPasswordGate';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import { SectionErrorBoundary } from '@/components/ui/SectionErrorBoundary';
import { Button } from '@/components/ui/button';
import { useQueryClient } from '@tanstack/react-query';
import { CashBagLoader } from '@/components/ui/CashBagLoader';
import { ExternalLink, ClipboardList, Smartphone, Layers, AlertCircle, Palette, Upload, FileText } from 'lucide-react';
import { ClientUploadPortal } from '@/components/uploads/ClientUploadPortal';
import { FunnelPreviewTab } from '@/components/funnel/FunnelPreviewTab';
import { VoiceRecordButton } from '@/components/voice/VoiceRecordButton';
import { PipelineTab } from '@/components/pipeline/PipelineTab';
import { useClientPipelines } from '@/hooks/usePipelines';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { LeadsDrillDownModal } from '@/components/drilldown/LeadsDrillDownModal';
import { CallsDrillDownModal } from '@/components/drilldown/CallsDrillDownModal';
import { AdSpendDrillDownModal } from '@/components/drilldown/AdSpendDrillDownModal';
import { FundedInvestorsDrillDownModal } from '@/components/drilldown/FundedInvestorsDrillDownModal';

function PublicReportContent() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { startDate, endDate } = useDateFilter();
  const queryClient = useQueryClient();
  
  // Debug logging for public report access
  useEffect(() => {
    console.log('[PublicReport] Mounting with token:', token);
    console.log('[PublicReport] Date range:', { startDate, endDate });
  }, [token, startDate, endDate]);
  
  const { data: client, isLoading, error: clientError } = useClientByToken(token);
  
  // Debug logging for client fetch
  useEffect(() => {
    console.log('[PublicReport] Client data:', { 
      clientId: client?.id, 
      clientName: client?.name,
      isLoading, 
      error: clientError?.message 
    });
  }, [client, isLoading, clientError]);
  
  const { data: clientSettings, error: settingsError } = useClientSettings(client?.id);
  const { data: dailyMetrics = [], isLoading: metricsLoading, error: metricsError } = useDailyMetrics(client?.id, startDate, endDate);
  const { data: fundedInvestors = [], error: fundedError } = useFundedInvestors(client?.id, startDate, endDate);
  const { data: leads = [], isLoading: leadsLoading, error: leadsError } = useLeads(client?.id, startDate, endDate);
  const { data: calls = [], error: callsError } = useCalls(client?.id, false, startDate, endDate);
  const { data: customTabs = [], error: tabsError } = useCustomTabs(client?.id);
  const { data: funnelSteps = [], error: funnelError } = useFunnelSteps(client?.id);
  const { data: clientTasks = [], error: tasksError } = useTasks(client?.id);
  const { data: voiceNotes = [], error: voiceError } = useVoiceNotes(client?.id);
  const { data: meetings = [], error: meetingsError } = useMeetings(client?.id);
  const { data: creatives = [], error: creativesError } = useCreatives(client?.id);
  const { data: pipelines = [], error: pipelinesError } = useClientPipelines(client?.id);
  
  // Collect any errors for debugging
  const dataErrors = [
    settingsError, metricsError, fundedError, leadsError, callsError,
    tabsError, funnelError, tasksError, voiceError, meetingsError, creativesError, pipelinesError
  ].filter(Boolean);
  
  // Log data errors for debugging
  useEffect(() => {
    if (dataErrors.length > 0) {
      console.error('[PublicReport] Data fetching errors:', dataErrors.map(e => (e as Error).message));
    }
  }, [dataErrors.length]);
  
  const [searchParams] = useSearchParams();
  const [activeSection, setActiveSection] = useState<string>(() => {
    return searchParams.get('section') || 'overview';
  });
  const [selectedRecord, setSelectedRecord] = useState<any>(null);
  const [selectedType, setSelectedType] = useState<string>('');
  const [drillDownModal, setDrillDownModal] = useState<string | null>(null);

  const handleActivityClick = (activityId: string, type: string) => {
    if (type.startsWith('task_')) {
      setActiveSection('tasks');
    } else if (type.startsWith('creative_')) {
      setActiveSection('creatives');
    }
  };

  // Calculate KPIs directly from source data (leads, calls, funded_investors)
  const metrics = useSourceAggregatedMetrics(leads, calls, fundedInvestors, dailyMetrics, (clientSettings as any)?.default_lead_pipeline_value || 0);

  // Sheet-backed metrics
  const sheetId = (clientSettings as any)?.metrics_sheet_id as string | undefined;
  const sheetGid = (clientSettings as any)?.metrics_sheet_gid as string | undefined;
  const sheetMapping = (clientSettings as any)?.metrics_sheet_mapping as Record<string, string> | undefined;
  const sheetDefault = ((clientSettings as any)?.metrics_source_default as 'sheet' | 'database') || 'database';
  const hasSheet = !!sheetId;
  const { source: metricsSource, setSource: setMetricsSource } = useMetricsSourcePreference(
    client?.id, sheetDefault, hasSheet
  );
  const sheetQuery = useSheetMetrics(client?.id, sheetId, sheetGid, startDate, endDate, sheetMapping);
  const useSheet = hasSheet && metricsSource === 'sheet';
  const activeMetrics = (useSheet && sheetQuery.data?.aggregated) ? sheetQuery.data.aggregated : metrics;
  const activeDailyMetrics = (useSheet && sheetQuery.data?.daily?.length) ? (sheetQuery.data.daily as any) : dailyMetrics;

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ['daily-metrics'] });
    queryClient.invalidateQueries({ queryKey: ['funded-investors'] });
    queryClient.invalidateQueries({ queryKey: ['leads'] });
    queryClient.invalidateQueries({ queryKey: ['calls'] });
    queryClient.invalidateQueries({ queryKey: ['creatives'] });
  };

  const handleRecordSelect = (record: any, type: string) => {
    setSelectedRecord(record);
    setSelectedType(type);
  };

  // Build context for AI analysis
  const aiContext = {
    clientName: client?.name || '',
    totalAdSpend: metrics.totalAdSpend,
    leads: metrics.totalLeads,
    calls: metrics.totalCalls,
    showedCalls: metrics.showedCalls,
    costPerLead: metrics.costPerLead,
    costPerCall: metrics.costPerCall,
    costPerShow: metrics.costPerShow,
    fundedInvestors: metrics.fundedInvestors,
    fundedDollars: metrics.fundedDollars,
    costPerInvestor: metrics.costPerInvestor,
    costOfCapital: metrics.costOfCapital,
    showedPercent: metrics.showedPercent,
  };

  // Show loading state
  if (isLoading) {
    console.log('[PublicReport] Showing loading state');
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <CashBagLoader message="Loading report..." />
      </div>
    );
  }

  // Handle client fetch error
  if (clientError) {
    console.error('[PublicReport] Client fetch error:', clientError);
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Alert variant="destructive" className="max-w-md">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Error Loading Report</AlertTitle>
          <AlertDescription>
            There was a problem loading this report. Please try refreshing the page.
            <div className="mt-2 text-xs opacity-70">
              Error: {(clientError as Error).message}
            </div>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  // Handle client not found
  if (!client) {
    console.log('[PublicReport] Client not found for token:', token);
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center border-2 border-border bg-card p-8 max-w-md">
          <AlertCircle className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
          <h1 className="text-2xl font-bold mb-2">Report Not Found</h1>
          <p className="text-muted-foreground mb-4">This report link is invalid or has expired.</p>
          <p className="text-xs text-muted-foreground">
            Token: {token || 'none'}
          </p>
        </div>
      </div>
    );
  }

  console.log('[PublicReport] Rendering main content for:', client.name);

  // Check if password protection is enabled
  const publicLinkPassword = clientSettings?.public_link_password;
  
  const reportContent = (
    <div className="min-h-screen bg-background">
      <header className="border-b-2 border-border bg-card px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">{client.name} - Performance Report</h1>
            <p className="text-sm text-muted-foreground">Capital Raising Performance Dashboard</p>
          </div>
          <div className="flex items-center gap-2">
            <MetricsSourceToggle
              source={metricsSource}
              onChange={setMetricsSource}
              hasSheet={hasSheet}
              lastSyncedAt={sheetQuery.data?.fetchedAt}
              rowCount={sheetQuery.data?.rowCount}
              isLoading={sheetQuery.isFetching}
              onRefresh={() => sheetQuery.refetch()}
            />
            <SectionErrorBoundary sectionName="Voice Recording">
              <VoiceRecordButton 
                clientId={client.id}
                clientName={client.name}
                isPublicView={true}
              />
            </SectionErrorBoundary>
            <SectionErrorBoundary sectionName="Activity Panel">
              <ActivityPanel
                tasks={clientTasks}
                voiceNotes={voiceNotes}
                meetings={meetings}
                creatives={creatives}
                isPublicView={true}
                 clientId={client.id}
                 clientName={client.name}
                onActivityClick={handleActivityClick}
              />
            </SectionErrorBoundary>
          </div>
        </div>
      </header>

      <main className="p-6 space-y-6 max-w-7xl mx-auto">
        <SectionErrorBoundary sectionName="Date Filter">
          <DateRangeFilter showAddClient={false} onRefresh={handleRefresh} />
        </SectionErrorBoundary>

        {/* Data Errors Warning */}
        {dataErrors.length > 0 && (
          <Alert variant="default" className="border-destructive/50 bg-destructive/10">
            <AlertCircle className="h-4 w-4 text-destructive" />
            <AlertDescription className="text-sm">
              Some data could not be loaded. The report may be incomplete.
            </AlertDescription>
          </Alert>
        )}

        {/* Section Navigation */}
        <div className="flex gap-2 flex-wrap">
          <Button 
            variant={activeSection === 'overview' ? 'default' : 'outline'} 
            size="sm"
            onClick={() => setActiveSection('overview')}
          >
            Overview
          </Button>
          <Button 
            variant={activeSection === 'attribution' ? 'default' : 'outline'} 
            size="sm"
            onClick={() => setActiveSection('attribution')}
          >
            Attribution
          </Button>
          <Button 
            variant={activeSection === 'records' ? 'default' : 'outline'} 
            size="sm"
            onClick={() => setActiveSection('records')}
          >
            Detailed Records
          </Button>
          <Button 
            variant={activeSection === 'tasks' ? 'default' : 'outline'} 
            size="sm"
            onClick={() => setActiveSection('tasks')}
          >
            <ClipboardList className="h-4 w-4 mr-1" />
            Tasks
          </Button>
          {funnelSteps.length > 0 && (
            <Button 
              variant={activeSection === 'funnel' ? 'default' : 'outline'} 
              size="sm"
              onClick={() => setActiveSection('funnel')}
            >
              <Smartphone className="h-4 w-4 mr-1" />
              Funnel
            </Button>
          )}
          {pipelines.length > 0 && (
            <Button 
              variant={activeSection === 'pipeline' ? 'default' : 'outline'} 
              size="sm"
              onClick={() => setActiveSection('pipeline')}
            >
              <Layers className="h-4 w-4 mr-1" />
              Pipeline
            </Button>
          )}
          <Button 
            variant="outline" 
            size="sm"
            onClick={() => navigate(`/public/${token}/creatives`)}
          >
            <Palette className="h-4 w-4 mr-1" />
            Creatives
          </Button>
          <Button 
            variant={activeSection === 'uploads' ? 'default' : 'outline'} 
            size="sm"
            onClick={() => setActiveSection('uploads')}
          >
            <Upload className="h-4 w-4 mr-1" />
            Upload Files
          </Button>
          {((clientSettings as any)?.kpi_google_doc_url) && (
            <Button
              variant={activeSection === 'master-doc' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setActiveSection('master-doc')}
            >
              <FileText className="h-4 w-4 mr-1" />
              Master Doc
            </Button>
          )}
          {((clientSettings as any)?.kpi_google_sheet_url) && (
            <Button
              variant={activeSection === 'reporting-sheet' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setActiveSection('reporting-sheet')}
            >
              <ClipboardList className="h-4 w-4 mr-1" />
              Reporting Sheet
            </Button>
          )}
          {customTabs.map((tab) => (
            <Button 
              key={tab.id}
              variant={activeSection === `custom-${tab.id}` ? 'default' : 'outline'} 
              size="sm"
              onClick={() => setActiveSection(`custom-${tab.id}`)}
            >
              <ExternalLink className="h-3 w-3 mr-1" />
              {tab.name}
            </Button>
          ))}
        </div>

        {activeSection === 'overview' && (
          <>
            <SectionErrorBoundary sectionName="KPI Grid">
              <section>
                <h2 className="text-lg font-bold mb-2">Key Performance Indicators</h2>
                <KPIGrid 
                  metrics={activeMetrics} 
                  showFundedMetrics 
                  onMetricClick={(metric) => setDrillDownModal(metric)}
                />
              </section>
            </SectionErrorBoundary>

            <SectionErrorBoundary sectionName="Periodic Stats">
              <PeriodicStatsTable dailyMetrics={activeDailyMetrics} />
            </SectionErrorBoundary>

            <SectionErrorBoundary sectionName="Charts">
              <MetricChartsGrid dailyMetrics={activeDailyMetrics} />
            </SectionErrorBoundary>

            <SectionErrorBoundary sectionName="Creative Approval">
              <CreativeApproval 
                clientId={client.id} 
                clientName={client.name} 
                isPublicView={true}
              />
            </SectionErrorBoundary>
          </>
        )}

        {activeSection === 'records' && (
          <SectionErrorBoundary sectionName="Records View">
            <InlineRecordsView
              dailyMetrics={dailyMetrics}
              leads={leads}
              calls={calls}
              fundedInvestors={fundedInvestors}
              isLoading={metricsLoading || leadsLoading}
              onRecordSelect={handleRecordSelect}
              selectedRecord={selectedRecord}
              selectedType={selectedType}
              clientId={client?.id}
              isPublicView={true}
              ghlLocationId={client?.ghl_location_id || undefined}
            />
          </SectionErrorBoundary>
        )}

        {/* Attribution Tab */}
        {activeSection === 'attribution' && (
          <SectionErrorBoundary sectionName="Attribution Dashboard">
            <AttributionDashboard 
              leads={leads} 
              calls={calls} 
              fundedInvestors={fundedInvestors} 
            />
          </SectionErrorBoundary>
        )}

        {/* Tasks Section */}
        {activeSection === 'tasks' && client && (
          <SectionErrorBoundary sectionName="Task Board">
            <TaskBoardView clientId={client.id} isPublicView={true} />
          </SectionErrorBoundary>
        )}

        {/* Funnel Preview Section */}
        {activeSection === 'funnel' && client && (
          <SectionErrorBoundary sectionName="Funnel Preview">
            <FunnelPreviewTab clientId={client.id} isPublicView={true} />
          </SectionErrorBoundary>
        )}

        {/* Pipeline Section */}
        {activeSection === 'pipeline' && client && (
          <SectionErrorBoundary sectionName="Pipeline">
            <PipelineTab clientId={client.id} isPublicView={true} />
          </SectionErrorBoundary>
        )}

        {/* Uploads Section */}
        {activeSection === 'uploads' && client && (
          <SectionErrorBoundary sectionName="File Uploads">
            <ClientUploadPortal 
              clientId={client.id} 
              clientName={client.name} 
              isPublicView={true}
            />
          </SectionErrorBoundary>
        )}

        {/* Custom Embed Tabs */}
        {customTabs.map((tab) => (
          activeSection === `custom-${tab.id}` && (
            <SectionErrorBoundary key={tab.id} sectionName={tab.name}>
              <div className="border-2 border-border bg-card rounded-lg overflow-hidden">
                <div className="p-4 border-b border-border flex items-center justify-between">
                  <h3 className="font-bold">{tab.name}</h3>
                  <a 
                    href={tab.url} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1"
                  >
                    Open in new tab
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
                <iframe
                  src={tab.url}
                  className="w-full h-[600px] border-0"
                  title={tab.name}
                  sandbox="allow-same-origin allow-scripts allow-forms"
                />
              </div>
            </SectionErrorBoundary>
          )
        ))}

        <footer className="text-center text-sm text-muted-foreground py-4">
          <p>Report generated on {new Date().toLocaleDateString()}</p>
        </footer>
      </main>

      <SectionErrorBoundary sectionName="AI Chat">
        <AIAnalysisChat context={aiContext} />
      </SectionErrorBoundary>

      {/* Drill-down modals */}
      <LeadsDrillDownModal
        clientId={client.id}
        open={drillDownModal === 'leads'}
        onOpenChange={(open) => !open && setDrillDownModal(null)}
      />
      <CallsDrillDownModal
        clientId={client.id}
        open={drillDownModal === 'calls'}
        onOpenChange={(open) => !open && setDrillDownModal(null)}
      />
      <CallsDrillDownModal
        clientId={client.id}
        showedOnly
        open={drillDownModal === 'showedCalls'}
        onOpenChange={(open) => !open && setDrillDownModal(null)}
      />
      <AdSpendDrillDownModal
        clientId={client.id}
        open={drillDownModal === 'totalAdSpend'}
        onOpenChange={(open) => !open && setDrillDownModal(null)}
      />
      <FundedInvestorsDrillDownModal
        clientId={client.id}
        open={drillDownModal === 'fundedInvestors'}
        onOpenChange={(open) => !open && setDrillDownModal(null)}
      />
    </div>
  );

  // Wrap in password gate if password is set
  if (publicLinkPassword) {
    return (
      <PublicLinkPasswordGate
        clientId={client.id}
        clientName={client.name}
        requiredPassword={publicLinkPassword}
      >
        {reportContent}
      </PublicLinkPasswordGate>
    );
  }

  return reportContent;
}

// Wrap in all required providers and ErrorBoundary to prevent blank screens
export default function PublicReport() {
  return (
    <TeamMemberProvider>
      <ErrorBoundary>
        <PublicReportContent />
      </ErrorBoundary>
    </TeamMemberProvider>
  );
}
