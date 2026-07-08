import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SyncOverviewTab } from '@/components/sync-health/SyncOverviewTab';
import { WebhookFeedTab } from '@/components/sync-health/WebhookFeedTab';
import { SyncLogsTab } from '@/components/sync-health/SyncLogsTab';
import { QueueHealthTab } from '@/components/sync-health/QueueHealthTab';
import { SyncBackfillCard } from '@/components/client/SyncBackfillCard';
import { AuditReportsTab } from '@/components/admin/AuditReportsTab';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Activity, Radio, ScrollText, HeartPulse, Layers, RefreshCw, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

export default function SyncHealthPage() {
  const [activeTab, setActiveTab] = useState('overview');
  const [selectedClient, setSelectedClient] = useState<string | undefined>();

  const { data: clients } = useQuery({
    queryKey: ['sync-health-clients'],
    queryFn: async () => {
      const { data } = await supabase.from('clients').select('id,name').eq('status', 'active').order('name');
      return data || [];
    },
  });
  const activeClient = clients?.find((c) => c.id === selectedClient);

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-[1600px] mx-auto p-4 md:p-6 space-y-6">
        {/* Hero Header */}
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-primary/10 via-primary/5 to-transparent border border-border p-6 md:p-8">
          <div className="relative z-10">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 rounded-xl bg-primary/10">
                <HeartPulse className="h-6 w-6 text-primary" />
              </div>
              <Badge variant="secondary" className="text-xs">Live Monitoring</Badge>
            </div>
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Sync Health Dashboard</h1>
            <p className="text-muted-foreground text-sm mt-1 max-w-lg">
              Monitor GHL webhooks, sync status, and data pipeline health across all client integrations.
            </p>
          </div>
          <div className="absolute top-0 right-0 w-64 h-64 bg-primary/5 rounded-full -translate-y-1/2 translate-x-1/3 blur-3xl" />
          <div className="absolute bottom-0 left-1/2 w-48 h-48 bg-primary/5 rounded-full translate-y-1/2 blur-2xl" />
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="bg-muted/50 p-1 flex-wrap h-auto">
            <TabsTrigger value="overview" className="gap-1.5 data-[state=active]:bg-card data-[state=active]:shadow-sm">
              <Activity className="h-4 w-4" /> Overview
            </TabsTrigger>
            <TabsTrigger value="webhooks" className="gap-1.5 data-[state=active]:bg-card data-[state=active]:shadow-sm">
              <Radio className="h-4 w-4" /> Webhooks
            </TabsTrigger>
            <TabsTrigger value="sync-logs" className="gap-1.5 data-[state=active]:bg-card data-[state=active]:shadow-sm">
              <ScrollText className="h-4 w-4" /> Sync Logs
            </TabsTrigger>
            <TabsTrigger value="queue" className="gap-1.5 data-[state=active]:bg-card data-[state=active]:shadow-sm">
              <Layers className="h-4 w-4" /> Queue
            </TabsTrigger>
            <TabsTrigger value="backfill" className="gap-1.5 data-[state=active]:bg-card data-[state=active]:shadow-sm">
              <RefreshCw className="h-4 w-4" /> Sync &amp; Backfill
            </TabsTrigger>
            <TabsTrigger value="audit" className="gap-1.5 data-[state=active]:bg-card data-[state=active]:shadow-sm">
              <ShieldCheck className="h-4 w-4" /> Audit
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="mt-4 animate-fade-in">
            <SyncOverviewTab />
          </TabsContent>
          <TabsContent value="webhooks" className="mt-4 animate-fade-in">
            <WebhookFeedTab />
          </TabsContent>
          <TabsContent value="sync-logs" className="mt-4 animate-fade-in">
            <SyncLogsTab />
          </TabsContent>
          <TabsContent value="queue" className="mt-4 animate-fade-in">
            <QueueHealthTab />
          </TabsContent>
          <TabsContent value="backfill" className="mt-4 animate-fade-in space-y-4">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Client:</span>
              <Select value={selectedClient} onValueChange={setSelectedClient}>
                <SelectTrigger className="w-72"><SelectValue placeholder="Select a client" /></SelectTrigger>
                <SelectContent>
                  {clients?.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {selectedClient ? (
              <SyncBackfillCard clientId={selectedClient} clientName={activeClient?.name} />
            ) : (
              <div className="p-8 text-center text-sm text-muted-foreground border border-dashed border-border rounded-lg">
                Select a client above to run manual syncs or backfill missed data.
              </div>
            )}
          </TabsContent>
          <TabsContent value="audit" className="mt-4 animate-fade-in">
            <AuditReportsTab />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
