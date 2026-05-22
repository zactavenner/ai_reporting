import { useState, useEffect } from 'react';
import { Client } from '@/hooks/useClients';
import { useClientSettings, useUpdateClientSettings, ClientSettings } from '@/hooks/useClientSettings';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useQueryClient } from '@tanstack/react-query';
import { WebhookSettingsTab } from './WebhookSettingsTab';
import { EmailParsingTab } from './EmailParsingTab';
import { PodAssignmentSection } from './PodAssignmentSection';
import { CalendarTrackingSection } from './CalendarTrackingSection';
import { PipelineMappingSection } from './PipelineMappingSection';
import { HubSpotIntegrationSection } from './HubSpotIntegrationSection';
import { MeetGeekIntegrationSection } from './MeetGeekIntegrationSection';
import { FathomIntegrationSection } from './FathomIntegrationSection';
import { SyncHealthIndicator, getSyncStatus } from './SyncHealthIndicator';
import { useSyncQueue } from '@/hooks/useSyncQueue';
import { DollarSign, Target, Plug, Loader2, RefreshCw, CheckCircle, XCircle, Users, Lock, Eye, EyeOff, AlertTriangle, ListOrdered, MessageSquare as MessageSquareIcon } from 'lucide-react';
import { ClientSheetBindingCard } from './ClientSheetBindingCard';

function ClientUrlField({
  clientId,
  label,
  fieldKey,
}: {
  clientId: string;
  label: string;
  fieldKey: 'kpi_google_doc_url' | 'kpi_google_sheet_url';
}) {
  const { data: cs } = useClientSettings(clientId);
  const update = useUpdateClientSettings();
  const initial = ((cs as any)?.[fieldKey] as string | null | undefined) || '';
  const [val, setVal] = useState(initial);
  useEffect(() => { setVal(initial); }, [initial]);
  const dirty = val.trim() !== initial.trim();
  return (
    <div className="space-y-1">
      <Label className="text-sm">{label}</Label>
      <div className="flex gap-2">
        <Input
          placeholder="https://docs.google.com/..."
          value={val}
          onChange={(e) => setVal(e.target.value)}
        />
        <Button
          size="sm"
          disabled={!dirty || update.isPending}
          onClick={async () => {
            try {
              await update.mutateAsync({ client_id: clientId, [fieldKey]: val.trim() || null } as any);
              toast.success(`${label} saved`);
            } catch (e: any) {
              toast.error('Failed to save: ' + (e?.message || 'Unknown error'));
            }
          }}
        >
          Save
        </Button>
      </div>
    </div>
  );
}
interface ClientSettingsModalProps {
  client: Client | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialTab?: string;
}

export function ClientSettingsModal({ client, open, onOpenChange, initialTab }: ClientSettingsModalProps) {
  const queryClient = useQueryClient();
  const { data: settings } = useClientSettings(client?.id);
  const updateSettings = useUpdateClientSettings();
  const { queueClientSync } = useSyncQueue();
  
  const [saving, setSaving] = useState(false);

  const [activeTab, setActiveTab] = useState<string>(initialTab || 'kpis');
  useEffect(() => {
    if (open && initialTab) setActiveTab(initialTab);
  }, [open, initialTab]);

  // General client fields (name, slug)
  const [clientName, setClientName] = useState('');
  const [clientSlug, setClientSlug] = useState('');
  useEffect(() => {
    if (client) {
      setClientName(client.name || '');
      setClientSlug((client as any).slug || '');
    }
  }, [client]);
  
  // Alert settings
  const [cplAlert, setCplAlert] = useState(false);
  const [cplThreshold, setCplThreshold] = useState('150');
  const [costPerCallAlert, setCostPerCallAlert] = useState(false);
  const [costPerCallThreshold, setCostPerCallThreshold] = useState('400');
  const [slackWebhook, setSlackWebhook] = useState('');

  // KPI Thresholds
  const [cplYellow, setCplYellow] = useState('50');
  const [cplRed, setCplRed] = useState('100');
  const [costPerCallYellow, setCostPerCallYellow] = useState('100');
  const [costPerCallRed, setCostPerCallRed] = useState('200');
  const [costPerShowYellow, setCostPerShowYellow] = useState('150');
  const [costPerShowRed, setCostPerShowRed] = useState('300');
  const [costPerInvestorYellow, setCostPerInvestorYellow] = useState('500');
  const [costPerInvestorRed, setCostPerInvestorRed] = useState('1000');
  const [costOfCapitalYellow, setCostOfCapitalYellow] = useState('5');
  const [costOfCapitalRed, setCostOfCapitalRed] = useState('10');
  const [fundedInvestorLabel, setFundedInvestorLabel] = useState('Funded Investors');
  const [businessManagerUrl, setBusinessManagerUrl] = useState('');
  
  // Custom metric labels
  const [metricLabels, setMetricLabels] = useState<Record<string, string>>({});

  // New KPI fields
  const [mrr, setMrr] = useState('0');
  const [adSpendFeeThreshold, setAdSpendFeeThreshold] = useState('30000');
  const [adSpendFeePercent, setAdSpendFeePercent] = useState('10');
  const [monthlyAdSpendTarget, setMonthlyAdSpendTarget] = useState('');
  const [dailyAdSpendTarget, setDailyAdSpendTarget] = useState('');
  const [totalRaiseAmount, setTotalRaiseAmount] = useState('0');
  const [defaultLeadPipelineValue, setDefaultLeadPipelineValue] = useState('0');
  const [adSpendInputMode, setAdSpendInputMode] = useState<'monthly' | 'daily'>('monthly');

  // GHL Integration state
  const [ghlLocationId, setGhlLocationId] = useState('');
  const [ghlApiKey, setGhlApiKey] = useState('');
  const [testingConnection, setTestingConnection] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [fullSyncing, setFullSyncing] = useState(false);
  const [metaAdAccountId, setMetaAdAccountId] = useState('');
  const [syncingMeta, setSyncingMeta] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'unknown' | 'connected' | 'error'>('unknown');
  const [historicalSyncRange, setHistoricalSyncRange] = useState<'7' | '30' | '90' | '365'>('7');

  // Calendar and pipeline tracking state
  const [trackedCalendarIds, setTrackedCalendarIds] = useState<string[]>([]);
  const [reconnectCalendarIds, setReconnectCalendarIds] = useState<string[]>([]);
  const [fundedPipelineId, setFundedPipelineId] = useState<string | null>(null);
  const [fundedStageIds, setFundedStageIds] = useState<string[]>([]);
  const [committedStageIds, setCommittedStageIds] = useState<string[]>([]);

  // Public link password state
  const [publicLinkPassword, setPublicLinkPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [slackReviewChannelId, setSlackReviewChannelId] = useState('');
  const [slackChannelId, setSlackChannelId] = useState('');

  // Load settings when available
  useEffect(() => {
    if (settings) {
      setCplYellow(String(settings.cpl_threshold_yellow));
      setCplRed(String(settings.cpl_threshold_red));
      setCostPerCallYellow(String(settings.cost_per_call_threshold_yellow));
      setCostPerCallRed(String(settings.cost_per_call_threshold_red));
      setCostPerShowYellow(String(settings.cost_per_show_threshold_yellow));
      setCostPerShowRed(String(settings.cost_per_show_threshold_red));
      setCostPerInvestorYellow(String(settings.cost_per_investor_threshold_yellow));
      setCostPerInvestorRed(String(settings.cost_per_investor_threshold_red));
      setCostOfCapitalYellow(String(settings.cost_of_capital_threshold_yellow));
      setCostOfCapitalRed(String(settings.cost_of_capital_threshold_red));
      setFundedInvestorLabel(settings.funded_investor_label);
      setMetricLabels((settings as any).metric_labels || {});
      setMrr(String(settings.mrr || 0));
      setAdSpendFeeThreshold(String(settings.ad_spend_fee_threshold || 30000));
      setAdSpendFeePercent(String(settings.ad_spend_fee_percent || 10));
      setTotalRaiseAmount(String(settings.total_raise_amount || 0));
      setDefaultLeadPipelineValue(String((settings as any).default_lead_pipeline_value || 0));
      
      // Determine which mode was used based on which value is set
      if (settings.daily_ad_spend_target && settings.daily_ad_spend_target > 0) {
        setAdSpendInputMode('daily');
        setDailyAdSpendTarget(String(settings.daily_ad_spend_target));
        setMonthlyAdSpendTarget('');
      } else {
        setAdSpendInputMode('monthly');
        setMonthlyAdSpendTarget(String(settings.monthly_ad_spend_target || 0));
        setDailyAdSpendTarget('');
      }
    }
    if (settings?.public_link_password !== undefined) {
      setPublicLinkPassword(settings.public_link_password || '');
    }
    if ((settings as any)?.slack_review_channel_id !== undefined) {
      setSlackReviewChannelId((settings as any).slack_review_channel_id || '');
    }
    if ((settings as any)?.slack_channel_id !== undefined) {
      setSlackChannelId((settings as any).slack_channel_id || '');
    }
    // Load calendar and pipeline settings
    const settingsAny = settings as any;
    if (settingsAny?.tracked_calendar_ids) {
      setTrackedCalendarIds(settingsAny.tracked_calendar_ids || []);
    }
    if (settingsAny?.reconnect_calendar_ids) {
      setReconnectCalendarIds(settingsAny.reconnect_calendar_ids || []);
    }
    if (settingsAny?.funded_pipeline_id) {
      setFundedPipelineId(settingsAny.funded_pipeline_id);
    }
    if (settingsAny?.funded_stage_ids) {
      setFundedStageIds(settingsAny.funded_stage_ids || []);
    }
    if (settingsAny?.committed_stage_ids) {
      setCommittedStageIds(settingsAny.committed_stage_ids || []);
    }
  }, [settings]);

  // Load client business manager URL, GHL credentials, and Meta Ad Account
  useEffect(() => {
    if (client?.business_manager_url) {
      setBusinessManagerUrl(client.business_manager_url);
    }
    if (client?.ghl_location_id) {
      setGhlLocationId(client.ghl_location_id);
    }
    if (client?.ghl_api_key) {
      setGhlApiKey(client.ghl_api_key);
    }
    // Load Meta Ad Account ID - auto-extract from business_manager_url if not set
    const existingAccountId = (client as any)?.meta_ad_account_id || '';
    if (!existingAccountId && client?.business_manager_url) {
      const actMatch = client.business_manager_url.match(/act[=\/](\d+)/);
      if (actMatch && actMatch[1]) {
        setMetaAdAccountId(actMatch[1]);
      } else {
        setMetaAdAccountId('');
      }
    } else {
      setMetaAdAccountId(existingAccountId);
    }
    // Determine connection status based on saved credentials
    if (client?.ghl_location_id && client?.ghl_api_key) {
      setConnectionStatus('connected');
    } else {
      setConnectionStatus('unknown');
    }
  }, [client]);

  // Calculate projected annual revenue
  const projectedAnnual = parseFloat(mrr) * 12;
  
  // Calculate the auto-filled value based on input mode
  const now = new Date();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  
  const calculatedMonthly = adSpendInputMode === 'daily' && dailyAdSpendTarget 
    ? parseFloat(dailyAdSpendTarget) * daysInMonth 
    : 0;
  const calculatedDaily = adSpendInputMode === 'monthly' && monthlyAdSpendTarget 
    ? parseFloat(monthlyAdSpendTarget) / daysInMonth 
    : 0;
  
  // Get effective monthly target for revenue estimate
  const effectiveMonthlyTarget = adSpendInputMode === 'daily' 
    ? calculatedMonthly 
    : parseFloat(monthlyAdSpendTarget) || 0;
  
  // Calculate estimated revenue for the month
  const estimatedMonthlyRevenue = (() => {
    let total = parseFloat(mrr) || 0;
    const threshold = parseFloat(adSpendFeeThreshold) || 30000;
    const percent = parseFloat(adSpendFeePercent) || 10;
    if (effectiveMonthlyTarget > threshold) {
      total += (effectiveMonthlyTarget - threshold) * (percent / 100);
    }
    return total;
  })();

  const handleSave = async () => {
    if (!client) return;
    
    setSaving(true);
    try {
      // Save KPI thresholds
      await updateSettings.mutateAsync({
        client_id: client.id,
        cpl_threshold_yellow: parseFloat(cplYellow),
        cpl_threshold_red: parseFloat(cplRed),
        cost_per_call_threshold_yellow: parseFloat(costPerCallYellow),
        cost_per_call_threshold_red: parseFloat(costPerCallRed),
        cost_per_show_threshold_yellow: parseFloat(costPerShowYellow),
        cost_per_show_threshold_red: parseFloat(costPerShowRed),
        cost_per_investor_threshold_yellow: parseFloat(costPerInvestorYellow),
        cost_per_investor_threshold_red: parseFloat(costPerInvestorRed),
        cost_of_capital_threshold_yellow: parseFloat(costOfCapitalYellow),
        cost_of_capital_threshold_red: parseFloat(costOfCapitalRed),
        funded_investor_label: fundedInvestorLabel,
        metric_labels: metricLabels,
        mrr: parseFloat(mrr) || 0,
        ad_spend_fee_threshold: parseFloat(adSpendFeeThreshold) || 30000,
        ad_spend_fee_percent: parseFloat(adSpendFeePercent) || 10,
        // Store whichever mode the user selected
        monthly_ad_spend_target: adSpendInputMode === 'monthly' ? (parseFloat(monthlyAdSpendTarget) || 0) : 0,
        daily_ad_spend_target: adSpendInputMode === 'daily' ? (parseFloat(dailyAdSpendTarget) || null) : null,
        total_raise_amount: parseFloat(totalRaiseAmount) || 0,
        default_lead_pipeline_value: parseFloat(defaultLeadPipelineValue) || 0,
        public_link_password: publicLinkPassword.trim() || null,
        slack_review_channel_id: slackReviewChannelId.trim() || null,
        slack_channel_id: slackChannelId.trim() || null,
        // Calendar and pipeline settings
        tracked_calendar_ids: trackedCalendarIds,
        reconnect_calendar_ids: reconnectCalendarIds,
        funded_pipeline_id: fundedPipelineId,
        funded_stage_ids: fundedStageIds,
        committed_stage_ids: committedStageIds,
      } as any);

      // Save alert configs if slack webhook provided
      if (slackWebhook) {
        if (cplAlert) {
          await supabase.from('alert_configs').upsert({
            client_id: client.id,
            metric: 'cost_per_lead',
            threshold: parseFloat(cplThreshold),
            operator: 'above',
            slack_webhook_url: slackWebhook,
            enabled: true,
          }, { onConflict: 'client_id,metric' });
        }
        if (costPerCallAlert) {
          await supabase.from('alert_configs').upsert({
            client_id: client.id,
            metric: 'cost_per_call',
            threshold: parseFloat(costPerCallThreshold),
            operator: 'above',
            slack_webhook_url: slackWebhook,
            enabled: true,
          }, { onConflict: 'client_id,metric' });
        }
      }

      // Save business manager URL, GHL credentials, and Meta Ad Account to client
      const clientUpdates: Record<string, string | null> = {};
      
      if (businessManagerUrl !== (client.business_manager_url || '')) {
        clientUpdates.business_manager_url = businessManagerUrl || null;
      }
      if (ghlLocationId !== (client.ghl_location_id || '')) {
        clientUpdates.ghl_location_id = ghlLocationId || null;
      }
      if (ghlApiKey !== (client.ghl_api_key || '')) {
        clientUpdates.ghl_api_key = ghlApiKey || null;
      }
      if (metaAdAccountId !== ((client as any).meta_ad_account_id || '')) {
        clientUpdates.meta_ad_account_id = metaAdAccountId || null;
      }

      if (Object.keys(clientUpdates).length > 0) {
        await supabase
          .from('clients')
          .update(clientUpdates)
          .eq('id', client.id);
      }

      queryClient.invalidateQueries({ queryKey: ['clients'] });
      queryClient.invalidateQueries({ queryKey: ['client', client.id] });
      queryClient.invalidateQueries({ queryKey: ['all-client-mrr'] });
      queryClient.invalidateQueries({ queryKey: ['all-client-settings'] });
      toast.success('Settings saved successfully');
      onOpenChange(false);
    } catch (error) {
      console.error('Error saving settings:', error);
      toast.error('Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const handleTestConnection = async () => {
    if (!ghlLocationId || !ghlApiKey) {
      toast.error('Please enter both Location ID and Private Integration Key');
      return;
    }
    setTestingConnection(true);
    try {
      const { data, error } = await supabase.functions.invoke('sync-ghl-contacts', {
        body: { 
          client_id: client?.id,
          testOnly: true,
          apiKey: ghlApiKey,
          locationId: ghlLocationId 
        }
      });
      if (error) throw error;
      setConnectionStatus('connected');
      toast.success('Connection successful! GHL credentials are valid.');
    } catch (error) {
      console.error('GHL connection test failed:', error);
      setConnectionStatus('error');
      toast.error('Connection failed - please check your credentials');
    } finally {
      setTestingConnection(false);
    }
  };

  const handleSyncContacts = async (isHistorical: boolean = false) => {
    if (!client?.ghl_location_id || !client?.ghl_api_key) {
      toast.error('Please save GHL credentials first');
      return;
    }
    setSyncing(true);
    try {
      const body: any = { client_id: client.id };
      if (isHistorical) {
        body.sinceDateDays = parseInt(historicalSyncRange);
      }
      const { data, error } = await supabase.functions.invoke('sync-ghl-contacts', { body });
      if (error) throw error;
      const created = data?.results?.[0]?.contacts?.created || 0;
      const updated = data?.results?.[0]?.contacts?.updated || 0;
      const fundedFromTags = data?.results?.[0]?.contacts?.fundedFromTags || 0;
      toast.success(`Synced ${created + updated} contacts (${created} new, ${updated} updated${fundedFromTags > 0 ? `, ${fundedFromTags} funded from tags` : ''})`);
      queryClient.invalidateQueries({ queryKey: ['leads', client.id] });
      queryClient.invalidateQueries({ queryKey: ['funded-investors', client.id] });
    } catch (error) {
      console.error('GHL sync failed:', error);
      toast.error('Sync failed - please try again');
    } finally {
      setSyncing(false);
    }
  };

  const handleFullSync = async () => {
    if (!client?.ghl_location_id || !client?.ghl_api_key) {
      toast.error('Please save GHL credentials first');
      return;
    }
    setFullSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke('sync-ghl-contacts', {
        body: { 
          client_id: client.id,
          mode: 'full_sync'
        }
      });
      if (error) throw error;
      
      const summary = data?.summary;
      const created = summary?.total_contacts_created || 0;
      const updated = summary?.total_contacts_updated || 0;
      const timelineSynced = summary?.total_timelines_synced || 0;
      const fundedFromTags = summary?.total_funded_from_tags || 0;
      
      toast.success(
        `Full sync complete: ${created} new, ${updated} updated, ${timelineSynced} timelines synced${fundedFromTags > 0 ? `, ${fundedFromTags} funded` : ''}`
      );
      
      queryClient.invalidateQueries({ queryKey: ['leads', client.id] });
      queryClient.invalidateQueries({ queryKey: ['calls', client.id] });
      queryClient.invalidateQueries({ queryKey: ['funded-investors', client.id] });
      queryClient.invalidateQueries({ queryKey: ['contact-timeline'] });
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      queryClient.invalidateQueries({ queryKey: ['sync-health', client.id] });
    } catch (error) {
      console.error('Full sync failed:', error);
      toast.error('Full sync failed - please try again');
    } finally {
      setFullSyncing(false);
    }
  };

  // Early return if no client to prevent null access
  if (!client) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl border-2 border-border max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold">Client Settings - {client.name}</DialogTitle>
          <DialogDescription>
            Configure webhooks, KPI targets, and thresholds for this client
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="mt-4">
          <TabsList className="grid w-full grid-cols-9">
            <TabsTrigger value="data">Sheet</TabsTrigger>
            <TabsTrigger value="kpis">KPIs</TabsTrigger>
            <TabsTrigger value="teams">Teams</TabsTrigger>
            <TabsTrigger value="security">Security</TabsTrigger>
            <TabsTrigger value="integrations">Integrations</TabsTrigger>
            <TabsTrigger value="webhooks">Webhooks</TabsTrigger>
            <TabsTrigger value="email-parsing">Email</TabsTrigger>
            <TabsTrigger value="thresholds">Thresholds</TabsTrigger>
            <TabsTrigger value="alerts">Alerts</TabsTrigger>
          </TabsList>

          <TabsContent value="data" className="space-y-4 mt-4">
            {client && <ClientSheetBindingCard clientId={client.id} clientName={client.name} />}
            {client && (
              <div className="border-2 border-border p-4 space-y-4">
                <div>
                  <h4 className="font-medium mb-1">Reporting Sheet & Master Doc URLs</h4>
                  <p className="text-sm text-muted-foreground">
                    Set this client's Google Sheet (Reporting Sheet) and Google Doc (Master Doc) URLs.
                    These power the embedded Reporting Sheet and Master Doc tabs on the client page.
                  </p>
                </div>
                <ClientUrlField
                  clientId={client.id}
                  label="Reporting Sheet URL"
                  fieldKey="kpi_google_sheet_url"
                />
                <ClientUrlField
                  clientId={client.id}
                  label="Master Doc URL"
                  fieldKey="kpi_google_doc_url"
                />
              </div>
            )}
          </TabsContent>

          <TabsContent value="teams" className="space-y-4 mt-4">
            <div className="border-2 border-border p-4 space-y-4">
              <div>
                <h4 className="font-medium mb-1 flex items-center gap-2">
                  <Users className="h-4 w-4" />
                  Assigned Pods
                </h4>
                <p className="text-sm text-muted-foreground mb-3">
                  Select which team pods work on this client
                </p>
              </div>
              <PodAssignmentSection clientId={client.id} />
            </div>
          </TabsContent>

          <TabsContent value="security" className="space-y-4 mt-4">
            <div className="border-2 border-border p-4 space-y-4">
              <div>
                <h4 className="font-medium mb-1 flex items-center gap-2">
                  <Lock className="h-4 w-4" />
                  Public Link Password
                </h4>
                <p className="text-sm text-muted-foreground mb-3">
                  Protect the public shareable link with a password. Leave empty for no password protection.
                </p>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="publicLinkPassword">Password</Label>
                <div className="relative">
                  <Input
                    id="publicLinkPassword"
                    type={showPassword ? 'text' : 'password'}
                    value={publicLinkPassword}
                    onChange={(e) => setPublicLinkPassword(e.target.value)}
                    placeholder="Enter password for public link..."
                    className="pr-10"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 p-0"
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  {publicLinkPassword ? 'Password protection is enabled' : 'No password protection - link is publicly accessible'}
                </p>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="kpis" className="space-y-4 mt-4">
            <div className="border-2 border-border p-4 space-y-4">
              <div>
                <h4 className="font-medium mb-1 flex items-center gap-2">
                  <DollarSign className="h-4 w-4" />
                  Revenue Settings
                </h4>
                <p className="text-sm text-muted-foreground mb-3">
                  Monthly retainer and ad spend fee configuration
                </p>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="mrr">Monthly MRR ($)</Label>
                  <Input
                    id="mrr"
                    type="number"
                    value={mrr}
                    onChange={(e) => setMrr(e.target.value)}
                    placeholder="0"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Projected Annual</Label>
                  <div className="h-10 flex items-center px-3 border-2 border-border bg-muted/50 text-lg font-semibold text-chart-2">
                    ${projectedAnnual.toLocaleString()}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="adSpendFeeThreshold">Ad Spend Fee Threshold ($)</Label>
                  <Input
                    id="adSpendFeeThreshold"
                    type="number"
                    value={adSpendFeeThreshold}
                    onChange={(e) => setAdSpendFeeThreshold(e.target.value)}
                    placeholder="30000"
                  />
                  <p className="text-xs text-muted-foreground">Fee applies above this amount</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="adSpendFeePercent">Ad Spend Fee (%)</Label>
                  <Input
                    id="adSpendFeePercent"
                    type="number"
                    value={adSpendFeePercent}
                    onChange={(e) => setAdSpendFeePercent(e.target.value)}
                    placeholder="10"
                  />
                  <p className="text-xs text-muted-foreground">Percentage charged on excess</p>
                </div>
              </div>
            </div>

            <div className="border-2 border-border p-4 space-y-4">
              <div>
                <h4 className="font-medium mb-1 flex items-center gap-2">
                  <Target className="h-4 w-4" />
                  Ad Spend Targets
                </h4>
                <p className="text-sm text-muted-foreground mb-3">
                  Enter either daily or monthly target - the other will auto-calculate
                </p>
              </div>
              
              <div className="flex gap-2 mb-4">
                <Button
                  type="button"
                  variant={adSpendInputMode === 'monthly' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => {
                    setAdSpendInputMode('monthly');
                    setDailyAdSpendTarget('');
                  }}
                >
                  Monthly Target
                </Button>
                <Button
                  type="button"
                  variant={adSpendInputMode === 'daily' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => {
                    setAdSpendInputMode('daily');
                    setMonthlyAdSpendTarget('');
                  }}
                >
                  Daily Target
                </Button>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                {adSpendInputMode === 'monthly' ? (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="monthlyAdSpendTarget">Monthly Ad Spend Target ($)</Label>
                      <Input
                        id="monthlyAdSpendTarget"
                        type="number"
                        value={monthlyAdSpendTarget}
                        onChange={(e) => setMonthlyAdSpendTarget(e.target.value)}
                        placeholder="0"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Daily Target (auto-calculated)</Label>
                      <div className="h-10 flex items-center px-3 border-2 border-border bg-muted/50 font-mono">
                        ${calculatedDaily.toFixed(2)}/day
                      </div>
                      <p className="text-xs text-muted-foreground">{daysInMonth} days this month</p>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="dailyAdSpendTarget">Daily Ad Spend Target ($)</Label>
                      <Input
                        id="dailyAdSpendTarget"
                        type="number"
                        value={dailyAdSpendTarget}
                        onChange={(e) => setDailyAdSpendTarget(e.target.value)}
                        placeholder="0"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Monthly Target (auto-calculated)</Label>
                      <div className="h-10 flex items-center px-3 border-2 border-border bg-muted/50 font-mono">
                        ${calculatedMonthly.toLocaleString()}/month
                      </div>
                      <p className="text-xs text-muted-foreground">{daysInMonth} days this month</p>
                    </div>
                  </>
                )}
              </div>
              
              <div className="mt-4 p-3 border-2 border-border bg-muted/30">
                <div className="flex justify-between items-center">
                  <span className="text-sm font-medium">Est. Monthly Revenue</span>
                  <span className="text-lg font-bold text-chart-2">
                    ${estimatedMonthlyRevenue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  MRR + ad spend fee (if above ${parseFloat(adSpendFeeThreshold).toLocaleString()} threshold)
                </p>
              </div>
            </div>

            <div className="border-2 border-border p-4 space-y-4">
              <div>
                <h4 className="font-medium mb-1 flex items-center gap-2">
                  <Target className="h-4 w-4" />
                  Fundraising Goal (All-Time)
                </h4>
                <p className="text-sm text-muted-foreground mb-3">
                  Total capital raise target - not affected by date range
                </p>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="totalRaiseAmount">Total Raise Amount ($)</Label>
                <Input
                  id="totalRaiseAmount"
                  type="number"
                  value={totalRaiseAmount}
                  onChange={(e) => setTotalRaiseAmount(e.target.value)}
                  placeholder="0"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="defaultLeadPipelineValue">Default Pipeline Value Per Lead ($)</Label>
                <Input
                  id="defaultLeadPipelineValue"
                  type="number"
                  value={defaultLeadPipelineValue}
                  onChange={(e) => setDefaultLeadPipelineValue(e.target.value)}
                  placeholder="0"
                />
                <p className="text-xs text-muted-foreground">
                  When set above 0, every lead will be valued at this amount for pipeline calculations (e.g. $100,000 per lead)
                </p>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="integrations" className="space-y-4 mt-4">
            <div className="border-2 border-border p-4 space-y-4">
              <div>
                <h4 className="font-medium mb-1 flex items-center gap-2">
                  <Plug className="h-4 w-4" />
                  GoHighLevel Integration
                </h4>
                <p className="text-sm text-muted-foreground mb-3">
                  Connect your GHL account to sync contacts and calls automatically
                </p>
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="ghlLocationId">Location ID</Label>
                  <Input
                    id="ghlLocationId"
                    value={ghlLocationId}
                    onChange={(e) => setGhlLocationId(e.target.value)}
                    placeholder="ve9EPM428h8vShlRW1KT"
                  />
                  <p className="text-xs text-muted-foreground">
                    Found in GHL → Settings → Business Profile
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="ghlApiKey">Private Integration Key</Label>
                  <Input
                    id="ghlApiKey"
                    type="password"
                    value={ghlApiKey}
                    onChange={(e) => setGhlApiKey(e.target.value)}
                    placeholder="••••••••••••••••••••••••"
                  />
                  <p className="text-xs text-muted-foreground">
                    Generate from GHL → Settings → Integrations → Private Integrations
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 pt-2">
                <span className="text-sm font-medium">Status:</span>
                {connectionStatus === 'connected' && (
                  <span className="flex items-center gap-1 text-sm text-chart-2">
                    <CheckCircle className="h-4 w-4" />
                    Connected
                  </span>
                )}
                {connectionStatus === 'error' && (
                  <span className="flex items-center gap-1 text-sm text-destructive">
                    <XCircle className="h-4 w-4" />
                    Connection Failed
                  </span>
                )}
                {connectionStatus === 'unknown' && (
                  <span className="text-sm text-muted-foreground">Not Configured</span>
                )}
              </div>

              {/* Last Sync Status */}
              {settings?.ghl_last_contacts_sync && (
                <div className="p-3 border-2 border-border bg-muted/30 space-y-1">
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-muted-foreground">Last Contacts Sync:</span>
                    <span className="font-medium">
                      {new Date(settings.ghl_last_contacts_sync).toLocaleString()}
                    </span>
                  </div>
                  {settings?.ghl_last_calls_sync && (
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-muted-foreground">Last Calls Sync:</span>
                      <span className="font-medium">
                        {new Date(settings.ghl_last_calls_sync).toLocaleString()}
                      </span>
                    </div>
                  )}
                </div>
              )}

              <div className="flex gap-2 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleTestConnection}
                  disabled={testingConnection || !ghlLocationId || !ghlApiKey}
                >
                  {testingConnection ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Testing...
                    </>
                  ) : (
                    'Test Connection'
                  )}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => handleSyncContacts(false)}
                  disabled={syncing || !client?.ghl_location_id || !client?.ghl_api_key}
                >
                  {syncing ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Syncing...
                    </>
                  ) : (
                    <>
                      <RefreshCw className="h-4 w-4 mr-2" />
                      Sync Now
                    </>
                  )}
                </Button>
              </div>

              {/* Historical Sync Section */}
              <div className="border-t border-border pt-4 mt-4">
                <h5 className="font-medium text-sm mb-2">Historical Data Sync</h5>
                <p className="text-xs text-muted-foreground mb-3">
                  Pull historical contacts and detect funded investors from tags
                </p>
                <div className="flex gap-2 items-center mb-4">
                  <select
                    value={historicalSyncRange}
                    onChange={(e) => setHistoricalSyncRange(e.target.value as any)}
                    className="h-9 px-3 border-2 border-border bg-background text-sm rounded-md"
                  >
                    <option value="7">Last 7 days</option>
                    <option value="30">Last 30 days</option>
                    <option value="90">Last 90 days</option>
                    <option value="365">All time (365 days)</option>
                  </select>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => handleSyncContacts(true)}
                    disabled={syncing || !client?.ghl_location_id || !client?.ghl_api_key}
                  >
                    {syncing ? 'Syncing...' : 'Sync Historical'}
                  </Button>
                </div>
                
                {/* Full Sync with Timeline */}
                <div className="p-3 border-2 border-dashed border-primary/30 bg-primary/5 rounded">
                  <h6 className="font-medium text-sm mb-1 flex items-center gap-2">
                    <RefreshCw className="h-4 w-4" />
                    Full Sync (Contacts + Timeline)
                  </h6>
                  <p className="text-xs text-muted-foreground mb-3">
                    Sync all contacts from the past year AND their full conversation/activity history. 
                    This provides complete visibility into each contact's journey. May take several minutes.
                  </p>
                  <Button
                    type="button"
                    variant="default"
                    onClick={() => handleFullSync()}
                    disabled={fullSyncing || !client?.ghl_location_id || !client?.ghl_api_key}
                    className="w-full"
                  >
                    {fullSyncing ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Running Full Sync...
                      </>
                    ) : (
                      <>
                        <RefreshCw className="h-4 w-4 mr-2" />
                        Run Full Sync (365 days + Timeline)
                      </>
                    )}
                  </Button>
                  
                  {/* Queue Sync Button */}
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => queueClientSync.mutate({ clientId: client.id, daysBack: 365 })}
                    disabled={queueClientSync.isPending || !client?.ghl_location_id || !client?.ghl_api_key}
                    className="w-full mt-2"
                  >
                    {queueClientSync.isPending ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Queuing...
                      </>
                    ) : (
                      <>
                        <ListOrdered className="h-4 w-4 mr-2" />
                        Queue Background Sync (365 days)
                      </>
                    )}
                  </Button>
                  <p className="text-xs text-muted-foreground mt-1">
                    Adds sync jobs to background queue for processing every 5 minutes
                  </p>
                </div>
              </div>
            </div>

            {/* Sync Health Indicator */}
            {(() => {
              const hasHubspot = !!(client?.hubspot_portal_id && client?.hubspot_access_token);
              const hasGhl = !!(client?.ghl_api_key && client?.ghl_location_id);
              const source = hasHubspot ? 'hubspot' : hasGhl ? 'ghl' : 'none';
              const lastSync = hasHubspot 
                ? (client as any).last_hubspot_sync_at 
                : (client as any).last_ghl_sync_at;
              const syncError = hasHubspot 
                ? (client as any).hubspot_sync_error 
                : (client as any).ghl_sync_error;
              
              return (
                <SyncHealthIndicator
                  status={getSyncStatus(lastSync, hasHubspot || hasGhl)}
                  lastSyncAt={lastSync}
                  syncError={syncError}
                  source={source as 'ghl' | 'hubspot' | 'none'}
                />
              );
            })()}

            {/* Calendar Tracking Section */}
            <CalendarTrackingSection
              clientId={client.id}
              ghlApiKey={client?.ghl_api_key || undefined}
              ghlLocationId={client?.ghl_location_id || undefined}
              trackedCalendarIds={trackedCalendarIds}
              reconnectCalendarIds={reconnectCalendarIds}
              onTrackedChange={setTrackedCalendarIds}
              onReconnectChange={setReconnectCalendarIds}
            />

            {/* Pipeline Mapping Section */}
            <PipelineMappingSection
              clientId={client.id}
              ghlApiKey={client?.ghl_api_key || undefined}
              ghlLocationId={client?.ghl_location_id || undefined}
              fundedPipelineId={fundedPipelineId}
              fundedStageIds={fundedStageIds}
              committedStageIds={committedStageIds}
              onPipelineChange={setFundedPipelineId}
              onFundedStagesChange={setFundedStageIds}
              onCommittedStagesChange={setCommittedStageIds}
            />

            {/* Webhook Freeze Notice */}
            <div className="border-2 border-yellow-500/50 bg-yellow-500/10 p-4 space-y-2">
              <div className="flex items-center gap-2 text-yellow-600 dark:text-yellow-500">
                <AlertTriangle className="h-4 w-4" />
                <h4 className="font-medium">Webhooks Currently Frozen</h4>
              </div>
              <p className="text-sm text-muted-foreground">
                All data sync is now handled via hourly API sync. Webhooks are acknowledged but not processed to prevent duplicates and ensure data accuracy.
              </p>
            </div>

            <div className="border-2 border-border p-4 space-y-3">
              <h4 className="font-medium">Required GHL Scopes</h4>
              <p className="text-sm text-muted-foreground">
                When creating your Private Integration, enable these permissions:
              </p>
              <ul className="text-sm space-y-1 list-disc list-inside text-muted-foreground">
                <li>Contacts (read/write) - Required for syncing leads</li>
                <li>Calendars (read) - For appointment data</li>
                <li>Opportunities (read) - For pipeline tracking</li>
                <li>Conversations (read) - For call validation</li>
              </ul>
            </div>

            {/* Meta Ads Integration Section */}
            <div className="border-t-2 border-border pt-6 mt-6">
              <div className="mb-3 p-3 rounded-md border border-primary/40 bg-primary/5 text-sm flex items-start gap-2">
                <Plug className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                <div>
                  <p className="font-medium">Meta Ads is now managed in the <span className="text-primary">Connections</span> tab.</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Open this client and switch to the <strong>Connections</strong> tab for the simplified, single-source-of-truth view. The fields below still work but are duplicates.
                  </p>
                </div>
              </div>
              <div className="border-2 border-border p-4 space-y-4">
                <div>
                  <h4 className="font-medium mb-1 flex items-center gap-2">
                    <Plug className="h-4 w-4" />
                    Meta Ads Integration
                  </h4>
                  <p className="text-sm text-muted-foreground mb-3">
                    Connect your Meta Ad Account to sync campaigns, ad sets, ads, and daily performance metrics
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="businessManagerUrl">Meta Business / Ads Manager URL</Label>
                  <Input
                    id="businessManagerUrl"
                    value={businessManagerUrl}
                    onChange={(e) => {
                      const url = e.target.value;
                      setBusinessManagerUrl(url);
                      // Auto-extract ad account ID from URL patterns:
                      // act=123456789, act/123456789, act_123456789, account_id=123456789
                      const actMatch = url.match(/(?:act[=\/]|act_|account_id=)(\d+)/);
                      if (actMatch && actMatch[1]) {
                        setMetaAdAccountId(actMatch[1]);
                      }
                    }}
                    placeholder="https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=123456789"
                  />
                  <p className="text-xs text-muted-foreground">
                    Paste your Ads Manager or Business Manager URL — the Ad Account ID will be extracted automatically
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="metaAdAccountId">Ad Account ID</Label>
                  <Input
                    id="metaAdAccountId"
                    value={metaAdAccountId}
                    onChange={(e) => setMetaAdAccountId(e.target.value)}
                    placeholder="478773718246380"
                  />
                  <p className="text-xs text-muted-foreground">
                    Auto-filled from URL above, or enter manually (numeric ID, without "act_" prefix)
                  </p>
                </div>

                {/* Meta Ads Last Sync */}
                {(settings as any)?.meta_ads_last_sync && (
                  <div className="p-3 border-2 border-border bg-muted/30 space-y-1">
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-muted-foreground">Last Meta Ads Sync:</span>
                      <span className="font-medium">
                        {new Date((settings as any).meta_ads_last_sync).toLocaleString()}
                      </span>
                    </div>
                  </div>
                )}

                {metaAdAccountId && (
                  <div className="flex gap-2 pt-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={async () => {
                        if (!metaAdAccountId) {
                          toast.error('Please enter an Ad Account ID first');
                          return;
                        }
                        // Save the ad account ID first
                        await supabase.from('clients').update({ meta_ad_account_id: metaAdAccountId }).eq('id', client.id);
                        setSyncingMeta(true);
                        try {
                          const { data, error } = await supabase.functions.invoke('sync-meta-ads', {
                            body: { clientId: client.id },
                          });
                          if (error) throw error;
                          if (!data?.success) throw new Error(data?.error || 'Sync failed');
                          toast.success(`Synced ${data.campaigns} campaigns, ${data.adSets} ad sets, ${data.ads} ads, ${data.dailyMetrics || 0} daily metrics`);
                          queryClient.invalidateQueries({ queryKey: ['meta-campaigns', client.id] });
                          queryClient.invalidateQueries({ queryKey: ['meta-ad-sets', client.id] });
                          queryClient.invalidateQueries({ queryKey: ['meta-ads', client.id] });
                          queryClient.invalidateQueries({ queryKey: ['metrics', client.id] });
                        } catch (error) {
                          console.error('Meta Ads sync failed:', error);
                          toast.error(error instanceof Error ? error.message : 'Failed to sync Meta Ads');
                        } finally {
                          setSyncingMeta(false);
                        }
                      }}
                      disabled={syncingMeta}
                    >
                      {syncingMeta ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Syncing Meta Ads...
                        </>
                      ) : (
                        <>
                          <RefreshCw className="h-4 w-4 mr-2" />
                          Sync Meta Ads Now
                        </>
                      )}
                    </Button>
                  </div>
                )}

                <p className="text-xs text-muted-foreground">
                  Auto-syncs every 2 hours. Pulls all data from Jan 1, 2026 to today.
                </p>
              </div>
            </div>

            {/* HubSpot Integration Section */}
            <div className="border-t-2 border-border pt-6 mt-6">
              <HubSpotIntegrationSection client={client} settings={settings} />
            </div>

            {/* MeetGeek Integration Section */}
            <div className="border-t-2 border-border pt-6 mt-6">
              <MeetGeekIntegrationSection clientId={client.id} settings={settings} />
            </div>

            {/* Fathom.ai Integration Section */}
            <div className="border-t-2 border-border pt-6 mt-6">
              <FathomIntegrationSection clientId={client.id} settings={settings} />
            </div>

            {/* RetargetIQ Enrichment Section */}
            <div className="border-t-2 border-border pt-6 mt-6">
              <div>
                <h4 className="font-medium mb-1 flex items-center gap-2">
                  <Target className="h-4 w-4" />
                  RetargetIQ Lead Enrichment
                </h4>
                <p className="text-sm text-muted-foreground mb-3">
                  Enrich leads with identity, financial, and company data via RetargetIQ
                </p>
              </div>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Website Slug</Label>
                  <Input
                    value={(settings as any)?.retargetiq_website_slug || ''}
                    onChange={async (e) => {
                      await updateSettings.mutateAsync({
                        client_id: client.id,
                        retargetiq_website_slug: e.target.value || null,
                      } as any);
                    }}
                    placeholder="your-website-slug"
                  />
                  <p className="text-xs text-muted-foreground">
                    Find this in your RetargetIQ dashboard under website settings
                  </p>
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <Label>Auto-Enrich New Leads</Label>
                    <p className="text-xs text-muted-foreground">Automatically enrich leads when they sync from GHL</p>
                  </div>
                  <Switch
                    checked={(settings as any)?.retargetiq_auto_enrich || false}
                    onCheckedChange={async (checked) => {
                      await updateSettings.mutateAsync({
                        client_id: client.id,
                        retargetiq_auto_enrich: checked,
                      } as any);
                    }}
                  />
                </div>
              </div>
            </div>

            {/* Stripe Billing Section */}
            <div className="border-t-2 border-border pt-6 mt-6">
              <div>
                <h4 className="font-medium mb-1 flex items-center gap-2">
                  <DollarSign className="h-4 w-4" />
                  Stripe Billing
                </h4>
                <p className="text-sm text-muted-foreground mb-3">
                  Link this client to their Stripe customer for subscription tracking and invoicing
                </p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Stripe Billing Email</Label>
                  <Input
                    value={(settings as any)?.stripe_email || ''}
                    onChange={async (e) => {
                      await updateSettings.mutateAsync({
                        client_id: client.id,
                        stripe_email: e.target.value || null,
                      } as any);
                    }}
                    placeholder="billing@client.com"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Stripe Customer ID</Label>
                  <Input
                    value={(settings as any)?.stripe_customer_id || ''}
                    onChange={async (e) => {
                      await updateSettings.mutateAsync({
                        client_id: client.id,
                        stripe_customer_id: e.target.value || null,
                      } as any);
                    }}
                    placeholder="cus_xxxxxxxxxxxxx"
                  />
                  <p className="text-xs text-muted-foreground">Takes priority over email if set</p>
                </div>
              </div>
            </div>

            {/* Slack Channel Mapping */}
            <div className="border-2 border-border p-4 space-y-4">
              <div>
                <h4 className="font-medium mb-1 flex items-center gap-2">
                  <MessageSquareIcon className="h-4 w-4" />
                  Slack Bot Channel (for @HPA commands)
                </h4>
                <p className="text-sm text-muted-foreground mb-3">
                  The Slack channel where clients can @mention the HPA bot to create tasks, ask about data, and manage their account. This channel is tied specifically to this client.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="slackChannelId">Slack Channel ID</Label>
                <Input
                  id="slackChannelId"
                  value={slackChannelId}
                  onChange={(e) => setSlackChannelId(e.target.value)}
                  placeholder="C0123456789"
                />
                <p className="text-xs text-muted-foreground">
                  Right-click the channel in Slack → View channel details → copy the Channel ID at the bottom
                </p>
              </div>
            </div>

            {/* Slack Review Notifications */}
            <div className="border-2 border-border p-4 space-y-4">
              <div>
                <h4 className="font-medium mb-1 flex items-center gap-2">
                  <MessageSquareIcon className="h-4 w-4" />
                  Slack Review Notifications
                </h4>
                <p className="text-sm text-muted-foreground mb-3">
                  When a task moves to "Review", a notification is sent to this Slack channel with the task title, description, and comments.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="slackReviewChannelId">Slack Review Channel ID</Label>
                <Input
                  id="slackReviewChannelId"
                  value={slackReviewChannelId}
                  onChange={(e) => setSlackReviewChannelId(e.target.value)}
                  placeholder="C0123456789"
                />
                <p className="text-xs text-muted-foreground">
                  Right-click the channel in Slack → View channel details → copy the Channel ID at the bottom
                </p>
              </div>
            </div>
          </TabsContent>
          
          <TabsContent value="webhooks" className="mt-4">
            <WebhookSettingsTab clientId={client.id} />
          </TabsContent>

          <TabsContent value="email-parsing" className="mt-4">
            <EmailParsingTab clientId={client.id} />
          </TabsContent>

          <TabsContent value="thresholds" className="space-y-4 mt-4">
            <div className="border-2 border-border p-4 space-y-4">
              <div>
                <h4 className="font-medium mb-1">Business Manager</h4>
                <p className="text-sm text-muted-foreground mb-3">Quick access link to the client's ad account</p>
                <div className="space-y-2">
                  <Label htmlFor="businessManagerUrl">Business Manager URL</Label>
                  <Input
                    id="businessManagerUrl"
                    value={businessManagerUrl}
                    onChange={(e) => {
                      const url = e.target.value;
                      setBusinessManagerUrl(url);
                      // Auto-extract ad account ID from URL (act= parameter)
                      const actMatch = url.match(/act[=\/](\d+)/);
                      if (actMatch && actMatch[1] && !metaAdAccountId) {
                        setMetaAdAccountId(actMatch[1]);
                        toast.success(`Auto-detected Ad Account ID: ${actMatch[1]}`);
                      }
                    }}
                    placeholder="https://business.facebook.com/..."
                  />
                  {businessManagerUrl && (() => {
                    const match = businessManagerUrl.match(/act[=\/](\d+)/);
                    return match ? (
                      <p className="text-xs text-green-600 dark:text-green-400">
                        ✓ Detected Ad Account ID: {match[1]}
                      </p>
                    ) : null;
                  })()}
                </div>
              </div>
            </div>

            <div className="border-2 border-border p-4 space-y-4">
              <div>
                <h4 className="font-medium mb-1">Custom Terminology</h4>
                <p className="text-sm text-muted-foreground mb-3">Rename metrics to match your business terms</p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="fundedLabel">Funded Investors Label</Label>
                    <Input
                      id="fundedLabel"
                      value={fundedInvestorLabel}
                      onChange={(e) => setFundedInvestorLabel(e.target.value)}
                      placeholder="Funded Investors"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="commitmentsLabel">Commitments Label</Label>
                    <Input
                      id="commitmentsLabel"
                      value={metricLabels.commitments || ''}
                      onChange={(e) => setMetricLabels({ ...metricLabels, commitments: e.target.value })}
                      placeholder="Commitments"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="commitDollarsLabel">Commit $ Label</Label>
                    <Input
                      id="commitDollarsLabel"
                      value={metricLabels.commitmentDollars || ''}
                      onChange={(e) => setMetricLabels({ ...metricLabels, commitmentDollars: e.target.value })}
                      placeholder="Commit $"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="fundedHashLabel">Funded # Label</Label>
                    <Input
                      id="fundedHashLabel"
                      value={metricLabels.fundedInvestors || ''}
                      onChange={(e) => setMetricLabels({ ...metricLabels, fundedInvestors: e.target.value })}
                      placeholder="Funded #"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="fundedDollarsLabel">Funded $ Label</Label>
                    <Input
                      id="fundedDollarsLabel"
                      value={metricLabels.fundedDollars || ''}
                      onChange={(e) => setMetricLabels({ ...metricLabels, fundedDollars: e.target.value })}
                      placeholder="Funded $"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="cpaLabel">CPA Label</Label>
                    <Input
                      id="cpaLabel"
                      value={metricLabels.costPerInvestor || ''}
                      onChange={(e) => setMetricLabels({ ...metricLabels, costPerInvestor: e.target.value })}
                      placeholder="CPA"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="costOfCapitalLabel">Cost of Capital % Label</Label>
                    <Input
                      id="costOfCapitalLabel"
                      value={metricLabels.costOfCapital || ''}
                      onChange={(e) => setMetricLabels({ ...metricLabels, costOfCapital: e.target.value })}
                      placeholder="Cost of Capital %"
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="border-2 border-border p-4 space-y-4">
              <div>
                <h4 className="font-medium mb-1">Color Thresholds</h4>
                <p className="text-sm text-muted-foreground mb-3">Set yellow (warning) and red (critical) thresholds for each metric</p>
              </div>
              
              <div className="grid grid-cols-3 gap-3 items-center">
                <Label className="text-sm font-medium">Cost Per Lead</Label>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-yellow-600">Yellow $</span>
                  <Input
                    className="w-20"
                    value={cplYellow}
                    onChange={(e) => setCplYellow(e.target.value)}
                    type="number"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-destructive">Red $</span>
                  <Input
                    className="w-20"
                    value={cplRed}
                    onChange={(e) => setCplRed(e.target.value)}
                    type="number"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3 items-center">
                <Label className="text-sm font-medium">Cost Per Call</Label>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-yellow-600">Yellow $</span>
                  <Input
                    className="w-20"
                    value={costPerCallYellow}
                    onChange={(e) => setCostPerCallYellow(e.target.value)}
                    type="number"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-destructive">Red $</span>
                  <Input
                    className="w-20"
                    value={costPerCallRed}
                    onChange={(e) => setCostPerCallRed(e.target.value)}
                    type="number"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3 items-center">
                <Label className="text-sm font-medium">Cost Per Show</Label>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-yellow-600">Yellow $</span>
                  <Input
                    className="w-20"
                    value={costPerShowYellow}
                    onChange={(e) => setCostPerShowYellow(e.target.value)}
                    type="number"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-destructive">Red $</span>
                  <Input
                    className="w-20"
                    value={costPerShowRed}
                    onChange={(e) => setCostPerShowRed(e.target.value)}
                    type="number"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3 items-center">
                <Label className="text-sm font-medium">Cost Per Investor</Label>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-yellow-600">Yellow $</span>
                  <Input
                    className="w-20"
                    value={costPerInvestorYellow}
                    onChange={(e) => setCostPerInvestorYellow(e.target.value)}
                    type="number"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-destructive">Red $</span>
                  <Input
                    className="w-20"
                    value={costPerInvestorRed}
                    onChange={(e) => setCostPerInvestorRed(e.target.value)}
                    type="number"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3 items-center">
                <Label className="text-sm font-medium">Cost of Capital %</Label>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-yellow-600">Yellow %</span>
                  <Input
                    className="w-20"
                    value={costOfCapitalYellow}
                    onChange={(e) => setCostOfCapitalYellow(e.target.value)}
                    type="number"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-destructive">Red %</span>
                  <Input
                    className="w-20"
                    value={costOfCapitalRed}
                    onChange={(e) => setCostOfCapitalRed(e.target.value)}
                    type="number"
                  />
                </div>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="alerts" className="space-y-4 mt-4">
            <div className="space-y-2">
              <Label htmlFor="slackWebhook">Slack Webhook URL</Label>
              <Input
                id="slackWebhook"
                value={slackWebhook}
                onChange={(e) => setSlackWebhook(e.target.value)}
                placeholder="https://hooks.slack.com/services/..."
              />
              <p className="text-xs text-muted-foreground">Create an incoming webhook in your Slack workspace</p>
            </div>

            <div className="space-y-3 mt-4">
              <h4 className="font-medium">Alert Rules</h4>
              
              <div className="flex items-center justify-between border-2 border-border p-3">
                <div className="flex items-center gap-4">
                  <Switch checked={cplAlert} onCheckedChange={setCplAlert} />
                  <div>
                    <p className="font-medium">Cost Per Lead Alert</p>
                    <p className="text-sm text-muted-foreground">Alert when CPL exceeds threshold</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm">$</span>
                  <Input
                    className="w-20"
                    value={cplThreshold}
                    onChange={(e) => setCplThreshold(e.target.value)}
                    disabled={!cplAlert}
                  />
                </div>
              </div>

              <div className="flex items-center justify-between border-2 border-border p-3">
                <div className="flex items-center gap-4">
                  <Switch checked={costPerCallAlert} onCheckedChange={setCostPerCallAlert} />
                  <div>
                    <p className="font-medium">Cost Per Call Alert</p>
                    <p className="text-sm text-muted-foreground">Alert when Cost/Call exceeds threshold</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm">$</span>
                  <Input
                    className="w-20"
                    value={costPerCallThreshold}
                    onChange={(e) => setCostPerCallThreshold(e.target.value)}
                    disabled={!costPerCallAlert}
                  />
                </div>
              </div>
            </div>

            <Button variant="outline" className="mt-4">Test Slack Connection</Button>
          </TabsContent>
        </Tabs>

        <div className="flex justify-end gap-2 mt-6">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save Settings'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}