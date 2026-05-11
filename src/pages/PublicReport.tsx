import { useState, useEffect } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useClientByToken } from '@/hooks/useClients';
import { TeamMemberProvider } from '@/contexts/TeamMemberContext';
import { DateFilterProvider } from '@/contexts/DateFilterContext';
import { useClientSettings } from '@/hooks/useClientSettings';
import { useCustomTabs } from '@/hooks/useCustomTabs';
import { useAllTasks } from '@/hooks/useTasks';
import { useVoiceNotes } from '@/hooks/useVoiceNotes';
import { useMeetings } from '@/hooks/useMeetings';
import { useCreatives } from '@/hooks/useCreatives';
import { CreativesSection } from '@/components/creative/CreativesSection';
import { TaskBoardView } from '@/components/tasks/TaskBoardView';
import { ActivityTabView } from '@/components/activity/ActivityTabView';
import { OnboardingChecklist } from '@/components/onboarding/OnboardingChecklist';
import { FunnelPreviewTab } from '@/components/funnel/FunnelPreviewTab';
import { PublicLinkPasswordGate } from '@/components/auth/PublicLinkPasswordGate';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import { SectionErrorBoundary } from '@/components/ui/SectionErrorBoundary';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CashBagLoader } from '@/components/ui/CashBagLoader';
import {
  ExternalLink,
  ClipboardList,
  Layers,
  AlertCircle,
  Palette,
  FileText,
  CheckSquare,
  Activity as ActivityIcon,
} from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

function PublicReportContent() {
  const { token } = useParams<{ token: string }>();
  const { data: client, isLoading, error: clientError } = useClientByToken(token);
  const { data: clientSettings } = useClientSettings(client?.id);
  const { data: customTabs = [] } = useCustomTabs(client?.id);
  const { data: allTasks = [] } = useAllTasks();
  const { data: voiceNotes = [] } = useVoiceNotes(client?.id);
  const { data: meetings = [] } = useMeetings(client?.id);
  const { data: creatives = [] } = useCreatives(client?.id);

  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<string>(searchParams.get('tab') || 'tasks');

  useEffect(() => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('tab', activeTab);
      return next;
    }, { replace: true });
  }, [activeTab, setSearchParams]);

  const clientTasks = (allTasks || []).filter((t: any) => t.client_id === client?.id);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <CashBagLoader message="Loading report..." />
      </div>
    );
  }

  if (clientError || !client) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Alert variant="destructive" className="max-w-md">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Report Not Found</AlertTitle>
          <AlertDescription>
            This report link is invalid or has expired.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const masterDocUrl = (clientSettings as any)?.kpi_google_doc_url as string | undefined;
  const reportingSheetUrl = (clientSettings as any)?.kpi_google_sheet_url as string | undefined;

  const renderEmbed = (label: string, url?: string) => {
    if (!url) {
      return (
        <div className="border-2 border-dashed border-border bg-card rounded-lg p-8 text-center text-sm text-muted-foreground">
          No {label} configured yet.
        </div>
      );
    }
    return (
      <div className="border-2 border-border bg-card rounded-lg overflow-hidden">
        <div className="p-4 border-b border-border flex items-center justify-between">
          <h3 className="font-bold">{label}</h3>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1"
          >
            Open in new tab
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
        <iframe
          src={url.replace('/edit', '/preview')}
          className="w-full h-[80vh] border-0"
          title={label}
        />
      </div>
    );
  };

  const reportContent = (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card/80 apple-blur sticky top-0 z-30 px-6 py-4">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">{client.name}</h1>
          <p className="text-xs text-muted-foreground">Client performance & management</p>
        </div>
      </header>

      <main className="p-6 max-w-7xl mx-auto">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="bg-muted/50 flex-wrap">
            <TabsTrigger value="tasks" className="gap-2">
              <CheckSquare className="h-4 w-4" />
              Tasks
            </TabsTrigger>
            <TabsTrigger value="creatives" className="gap-2">
              <Palette className="h-4 w-4" />
              Creatives
            </TabsTrigger>
            <TabsTrigger value="master-doc" className="gap-2">
              <FileText className="h-4 w-4" />
              Master Doc
            </TabsTrigger>
            <TabsTrigger value="reporting-sheet" className="gap-2">
              <ClipboardList className="h-4 w-4" />
              Reporting Sheet
            </TabsTrigger>
            <TabsTrigger value="onboarding-info" className="gap-2">
              <CheckSquare className="h-4 w-4" />
              Onboarding Info
            </TabsTrigger>
            <TabsTrigger value="funnel" className="gap-2">
              <Layers className="h-4 w-4" />
              Funnel
            </TabsTrigger>
            <TabsTrigger value="activity" className="gap-2">
              <ActivityIcon className="h-4 w-4" />
              Activity
            </TabsTrigger>
            {customTabs.map((tab: any) => (
              <TabsTrigger key={tab.id} value={`custom-${tab.id}`} className="gap-2">
                <ExternalLink className="h-3 w-3" />
                {tab.name}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="tasks" className="space-y-6">
            <SectionErrorBoundary sectionName="Task Board">
              <h2 className="text-lg font-bold mb-3">Tasks</h2>
              <TaskBoardView clientId={client.id} isPublicView={true} />
            </SectionErrorBoundary>
          </TabsContent>

          <TabsContent value="creatives" className="space-y-6">
            <SectionErrorBoundary sectionName="Creatives">
              <h2 className="text-lg font-bold mb-3">Creative Assets</h2>
              <CreativesSection
                clientId={client.id}
                clientName={client.name}
                isPublicView={true}
              />
            </SectionErrorBoundary>
          </TabsContent>

          <TabsContent value="master-doc" className="space-y-4">
            <SectionErrorBoundary sectionName="Master Doc">
              <h2 className="text-lg font-bold mb-3">Master Doc</h2>
              {renderEmbed('Master Doc', masterDocUrl)}
            </SectionErrorBoundary>
          </TabsContent>

          <TabsContent value="reporting-sheet" className="space-y-4">
            <SectionErrorBoundary sectionName="Reporting Sheet">
              <h2 className="text-lg font-bold mb-3">Reporting Sheet</h2>
              {renderEmbed('Reporting Sheet', reportingSheetUrl)}
            </SectionErrorBoundary>
          </TabsContent>

          <TabsContent value="onboarding-info" className="space-y-6">
            <SectionErrorBoundary sectionName="Onboarding Info">
              <OnboardingChecklist clientId={client.id} clientType={(client as any)?.description} />
            </SectionErrorBoundary>
          </TabsContent>

          <TabsContent value="funnel" className="space-y-6">
            <SectionErrorBoundary sectionName="Funnel">
              <FunnelPreviewTab clientId={client.id} isPublicView={true} />
            </SectionErrorBoundary>
          </TabsContent>

          <TabsContent value="activity" className="space-y-6">
            <SectionErrorBoundary sectionName="Activity">
              <h2 className="text-lg font-bold mb-3">Activity</h2>
              <ActivityTabView
                tasks={clientTasks}
                voiceNotes={voiceNotes}
                meetings={meetings}
                creatives={creatives}
              />
            </SectionErrorBoundary>
          </TabsContent>

          {customTabs.map((tab: any) => (
            <TabsContent key={tab.id} value={`custom-${tab.id}`} className="space-y-4">
              <SectionErrorBoundary sectionName={tab.name}>
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
            </TabsContent>
          ))}
        </Tabs>
      </main>
    </div>
  );

  const publicLinkPassword = clientSettings?.public_link_password;
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

export default function PublicReport() {
  return (
    <TeamMemberProvider>
      <DateFilterProvider>
        <ErrorBoundary>
          <PublicReportContent />
        </ErrorBoundary>
      </DateFilterProvider>
    </TeamMemberProvider>
  );
}
