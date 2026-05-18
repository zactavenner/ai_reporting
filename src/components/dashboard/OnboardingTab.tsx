import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useClients } from '@/hooks/useClients';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AssetInlineChat } from '@/components/onboarding/AssetInlineChat';
import { OnboardingAutomationPanel } from '@/components/onboarding/OnboardingAutomationPanel';
import {
  CheckCircle2, Clock, XCircle, Loader2, ChevronDown, ChevronRight,
  Eye, Play, Pause, FileText, Image, Video, MessageSquare, Mail,
  Bot, RefreshCw, Rocket, BarChart3, Target, Megaphone, Globe,
  Sparkles, AlertCircle, Upload, Trash2, Download, ClipboardList,
  Building2, DollarSign, Users, Phone, Calendar, Link, Shield,
  FileDown, Zap,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import ReactMarkdown from 'react-markdown';

// ─── Types ───

interface FulfillmentRun {
  id: string;
  client_id: string;
  offer_id: string | null;
  status: string;
  current_phase: string | null;
  total_steps: number;
  completed_steps: number;
  failed_steps: number;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

interface FulfillmentStep {
  id: string;
  run_id: string;
  phase: string;
  step_name: string;
  step_type: string;
  status: string;
  output_data: any;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  sort_order: number;
}

interface ClientAsset {
  id: string;
  client_id: string;
  offer_id: string | null;
  asset_type: string;
  title: string;
  content: any;
  status: string;
  created_at: string;
  updated_at: string;
}

interface ClientOffer {
  id: string;
  client_id: string;
  title: string;
  description: string | null;
  offer_type: string;
  status: string | null;
  fund_name: string | null;
  fund_type: string | null;
  raise_amount: string | null;
  min_investment: string | null;
  timeline: string | null;
  target_investor: string | null;
  targeted_returns: string | null;
  hold_period: string | null;
  distribution_schedule: string | null;
  investment_range: string | null;
  tax_advantages: string | null;
  credibility: string | null;
  fund_history: string | null;
  website_url: string | null;
  speaker_name: string | null;
  industry_focus: string | null;
  brand_notes: string | null;
  additional_notes: string | null;
  brand_colors: any;
  brand_fonts: any;
  logo_url: string | null;
  pitch_deck_url: string | null;
  budget_amount: number | null;
  budget_mode: string | null;
  accredited_only: boolean | null;
  reg_d_type: string | null;
  ghl_location_id: string | null;
  meta_ad_account_id: string | null;
  meta_page_id: string | null;
  meta_pixel_id: string | null;
  raw_form_data: any;
}

interface OfferFile {
  id: string;
  offer_id: string;
  client_id: string;
  file_name: string;
  file_url: string;
  file_type: string | null;
  file_size_bytes: number | null;
  created_at: string;
}

interface ClientOnboardingData {
  clientId: string;
  clientName: string;
  clientStatus: string;
  clientDescription: string | null;
  clientOfferDescription: string | null;
  clientWebsite: string | null;
  offers: ClientOffer[];
  runs: FulfillmentRun[];
  steps: FulfillmentStep[];
  assets: ClientAsset[];
  offerFiles: OfferFile[];
}

// ─── Constants ───

const PHASE_ORDER = ['intake', 'research', 'content', 'static_ads', 'avatar', 'video', 'browser_tasks', 'review'];
const PHASE_LABELS: Record<string, string> = {
  intake: '📥 Brand Intake',
  research: '📊 Research & Angles',
  content: '✍️ Copy & Scripts',
  static_ads: '🎨 Static Ad Creatives',
  avatar: '🧑 AI Avatar',
  video: '🎬 Video Scripts & Generation',
  browser_tasks: '🌐 Platform Setup',
  review: '✅ Final Review',
  visuals_queued: '⏳ Visuals Queued',
};

const ASSET_TYPE_CONFIG: Record<string, { label: string; icon: any; phase: string }> = {
  research: { label: 'Deep Research', icon: BarChart3, phase: 'research' },
  angles: { label: 'Marketing Angles', icon: Target, phase: 'research' },
  emails: { label: 'Email Sequences', icon: Mail, phase: 'content' },
  sms: { label: 'SMS Sequences', icon: MessageSquare, phase: 'content' },
  adcopy: { label: 'Ad Copy', icon: Megaphone, phase: 'content' },
  scripts: { label: 'Video Scripts', icon: Video, phase: 'content' },
  creatives: { label: 'Creative Concepts', icon: Image, phase: 'content' },
  report: { label: 'Special Report', icon: FileText, phase: 'content' },
  funnel: { label: 'Funnel Copy', icon: Globe, phase: 'content' },
  vsl: { label: 'VSL Script', icon: Video, phase: 'content' },
  caller: { label: 'AI Caller Script', icon: Bot, phase: 'content' },
  setter: { label: 'AI Setter Script', icon: Bot, phase: 'content' },
};

const STATUS_CONFIG: Record<string, { color: string; icon: any }> = {
  completed: { color: 'text-green-500', icon: CheckCircle2 },
  running: { color: 'text-blue-500', icon: Loader2 },
  pending: { color: 'text-muted-foreground', icon: Clock },
  failed: { color: 'text-destructive', icon: XCircle },
  queued: { color: 'text-yellow-500', icon: Clock },
};

// ─── Google Doc Export ───

function exportToGoogleDoc(client: ClientOnboardingData, offer: ClientOffer | undefined) {
  const lines: string[] = [];

  lines.push(`${client.clientName} — Onboarding Package`);
  lines.push('='.repeat(50));
  lines.push('');

  // Offer details
  if (offer) {
    lines.push('OFFER DETAILS');
    lines.push('-'.repeat(30));
    const fields: [string, string | null | undefined][] = [
      ['Title', offer.title],
      ['Offer Type', offer.offer_type],
      ['Fund Name', offer.fund_name],
      ['Fund Type', offer.fund_type],
      ['Raise Amount', offer.raise_amount],
      ['Min Investment', offer.min_investment],
      ['Target Investor', offer.target_investor],
      ['Targeted Returns', offer.targeted_returns],
      ['Hold Period', offer.hold_period],
      ['Distribution Schedule', offer.distribution_schedule],
      ['Investment Range', offer.investment_range],
      ['Tax Advantages', offer.tax_advantages],
      ['Timeline', offer.timeline],
      ['Reg D Type', offer.reg_d_type],
      ['Industry Focus', offer.industry_focus],
      ['Speaker Name', offer.speaker_name],
      ['Website', offer.website_url],
      ['Credibility', offer.credibility],
      ['Fund History', offer.fund_history],
      ['Brand Notes', offer.brand_notes],
      ['Additional Notes', offer.additional_notes],
    ];
    fields.forEach(([label, val]) => {
      if (val) lines.push(`${label}: ${val}`);
    });
    if (offer.budget_amount) lines.push(`Budget: $${offer.budget_amount.toLocaleString()} (${offer.budget_mode || 'N/A'})`);
    lines.push('');
  }

  // Assets
  if (client.assets.length > 0) {
    lines.push('GENERATED ASSETS');
    lines.push('='.repeat(50));
    lines.push('');

    const assetsByType: Record<string, ClientAsset[]> = {};
    client.assets.forEach(a => {
      if (!assetsByType[a.asset_type]) assetsByType[a.asset_type] = [];
      assetsByType[a.asset_type].push(a);
    });

    Object.entries(assetsByType).forEach(([type, assets]) => {
      const label = ASSET_TYPE_CONFIG[type]?.label || type;
      const latestAsset = assets[0];
      lines.push(`── ${label.toUpperCase()} ──`);
      lines.push(`Status: ${latestAsset.status}`);
      lines.push('');

      const content = latestAsset.content;
      if (typeof content === 'string') {
        lines.push(content);
      } else if (content) {
        lines.push(JSON.stringify(content, null, 2));
      }
      lines.push('');
      lines.push('');
    });
  } else {
    lines.push('No assets generated yet.');
  }

  const fullText = lines.join('\n');
  const title = `${client.clientName} - Onboarding Package`;

  navigator.clipboard.writeText(fullText).then(() => {
    const url = `https://docs.google.com/document/create?title=${encodeURIComponent(title)}`;
    window.open(url, '_blank');
    toast.success('Content copied to clipboard! Paste it into the new Google Doc (Ctrl+V / Cmd+V)');
  }).catch(() => {
    toast.error('Failed to copy to clipboard');
  });
}

// ─── Component ───

export function OnboardingTab() {
  const navigate = useNavigate();
  const { data: allClients = [] } = useClients();
  const [clientData, setClientData] = useState<ClientOnboardingData[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedClient, setExpandedClient] = useState<string | null>(null);
  const [expandedAsset, setExpandedAsset] = useState<string | null>(null);
  const [launchingPipeline, setLaunchingPipeline] = useState<string | null>(null);

  // Show clients with status 'onboarding' OR recently created active clients that have offers
  const onboardingClients = useMemo(() =>
    allClients.filter(c => c.status === 'onboarding'),
    [allClients]
  );

  useEffect(() => {
    fetchAllData();
  }, [onboardingClients.length]);

  useEffect(() => {
    if (onboardingClients.length === 0) return;
    const channel = supabase
      .channel('onboarding-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'fulfillment_runs' }, () => fetchAllData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'fulfillment_steps' }, () => fetchAllData())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [onboardingClients.length]);

  async function fetchAllData() {
    if (onboardingClients.length === 0) {
      setClientData([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const clientIds = onboardingClients.map(c => c.id);

      const [runsRes, offersRes, assetsRes, filesRes] = await Promise.all([
        supabase.from('fulfillment_runs').select('*').in('client_id', clientIds).order('created_at', { ascending: false }),
        supabase.from('client_offers').select('*').in('client_id', clientIds).order('created_at', { ascending: false }),
        supabase.from('client_assets' as any).select('*').in('client_id', clientIds).order('created_at', { ascending: false }),
        supabase.from('client_offer_files').select('*').in('client_id', clientIds).order('created_at', { ascending: false }),
      ]);

      const runs = (runsRes.data || []) as FulfillmentRun[];
      const offers = (offersRes.data || []) as unknown as ClientOffer[];
      const assets = ((assetsRes.data || []) as unknown) as ClientAsset[];
      const offerFiles = (filesRes.data || []) as unknown as OfferFile[];

      const runIds = runs.map(r => r.id);
      let steps: FulfillmentStep[] = [];
      if (runIds.length > 0) {
        const { data } = await supabase.from('fulfillment_steps').select('*').in('run_id', runIds).order('sort_order', { ascending: true });
        steps = (data || []) as FulfillmentStep[];
      }

      const grouped = onboardingClients.map(client => ({
        clientId: client.id,
        clientName: client.name,
        clientStatus: client.status,
        clientDescription: client.description,
        clientOfferDescription: client.offer_description,
        clientWebsite: client.website_url,
        offers: offers.filter(o => o.client_id === client.id),
        runs: runs.filter(r => r.client_id === client.id),
        steps: steps.filter(s => runs.some(r => r.id === s.run_id && r.client_id === client.id)),
        assets: assets.filter(a => a.client_id === client.id),
        offerFiles: offerFiles.filter(f => f.client_id === client.id),
      }));

      setClientData(grouped);
    } catch (err) {
      console.error('Fetch error:', err);
    } finally {
      setLoading(false);
    }
  }

  const launchPipeline = async (clientId: string, offerId?: string) => {
    setLaunchingPipeline(clientId);
    try {
      const { data, error } = await supabase.functions.invoke('fulfill-client', {
        body: { password: 'HPA1234$', client_id: clientId, offer_id: offerId || null },
      });
      if (error) throw error;
      toast.success(`Pipeline launched! Run ID: ${data?.run_id?.slice(0, 8)}`);
      await fetchAllData();
    } catch (err: any) {
      toast.error(err?.message || 'Failed to launch pipeline');
    } finally {
      setLaunchingPipeline(null);
    }
  };

  const markActive = async (clientId: string) => {
    try {
      const { error } = await supabase.from('clients').update({ status: 'active' } as any).eq('id', clientId);
      if (error) throw error;
      toast.success('Client marked as active');
      await fetchAllData();
    } catch (err: any) {
      toast.error(err?.message || 'Failed to update status');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (onboardingClients.length === 0) {
    return (
      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-bold">Client Onboarding Pipeline</h2>
          <p className="text-sm text-muted-foreground">End-to-end onboarding: Research → Copy → Statics → Avatar → Video</p>
        </div>
        <Card>
          <CardContent className="py-12 text-center">
            <CheckCircle2 className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground font-medium">No clients currently onboarding</p>
            <p className="text-sm text-muted-foreground mt-1">Set a client's status to "onboarding" to see them here</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold">Client Onboarding Pipeline</h2>
          <p className="text-sm text-muted-foreground">
            {onboardingClients.length} client{onboardingClients.length !== 1 ? 's' : ''} — Research → Copy → 5 Static Ads → AI Avatar → Video Scripts (pause for review)
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchAllData}>
          <RefreshCw className="h-4 w-4 mr-2" /> Refresh
        </Button>
      </div>

      <div className="space-y-4">
        {clientData.map(client => (
          <ClientOnboardingCard
            key={client.clientId}
            client={client}
            isExpanded={expandedClient === client.clientId}
            onToggle={() => setExpandedClient(expandedClient === client.clientId ? null : client.clientId)}
            expandedAsset={expandedAsset}
            onToggleAsset={(id) => setExpandedAsset(expandedAsset === id ? null : id)}
            onLaunchPipeline={launchPipeline}
            isLaunching={launchingPipeline === client.clientId}
            onRefresh={fetchAllData}
            onMarkActive={markActive}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Client Card ───

interface ClientCardProps {
  client: ClientOnboardingData;
  isExpanded: boolean;
  onToggle: () => void;
  expandedAsset: string | null;
  onToggleAsset: (id: string) => void;
  onLaunchPipeline: (clientId: string, offerId?: string) => void;
  isLaunching: boolean;
  onRefresh: () => void;
  onMarkActive: (clientId: string) => void;
}

function ClientOnboardingCard({
  client, isExpanded, onToggle, expandedAsset, onToggleAsset,
  onLaunchPipeline, isLaunching, onRefresh, onMarkActive,
}: ClientCardProps) {
  const navigate = useNavigate();
  const latestRun = client.runs[0];
  const progress = latestRun?.total_steps > 0
    ? Math.round((latestRun.completed_steps / latestRun.total_steps) * 100) : 0;
  const primaryOffer = client.offers[0];
  const isPipelineRunning = latestRun?.status === 'running';

  const runSteps = client.steps.filter(s => s.run_id === latestRun?.id);
  const phases: Record<string, FulfillmentStep[]> = {};
  runSteps.forEach(s => {
    if (!phases[s.phase]) phases[s.phase] = [];
    phases[s.phase].push(s);
  });

  const assetsByType: Record<string, ClientAsset[]> = {};
  client.assets.forEach(a => {
    if (!assetsByType[a.asset_type]) assetsByType[a.asset_type] = [];
    assetsByType[a.asset_type].push(a);
  });

  // Build quick-glance intake fields from offer + client data
  const intakeFields = buildIntakeFields(primaryOffer, client);

  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={onToggle} className="hover:bg-muted rounded p-1 transition-colors">
              {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </button>
            <div>
              <CardTitle className="text-base">{client.clientName}</CardTitle>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                {primaryOffer && (
                  <Badge variant="outline" className="text-xs">{primaryOffer.title}</Badge>
                )}
                <Badge variant={
                  latestRun?.status === 'completed' ? 'default' :
                  isPipelineRunning ? 'secondary' : 'outline'
                }>
                  {isPipelineRunning ? '🔄 Running' : latestRun?.status || 'Not started'}
                </Badge>
                {latestRun && (
                  <span className="text-xs text-muted-foreground">
                    {latestRun.completed_steps}/{latestRun.total_steps} steps
                    {latestRun.failed_steps > 0 && (
                      <span className="text-destructive ml-1">({latestRun.failed_steps} failed)</span>
                    )}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {!latestRun && primaryOffer && (
              <Button size="sm" onClick={() => onLaunchPipeline(client.clientId, primaryOffer?.id)} disabled={isLaunching}>
                {isLaunching ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Starting…</> : <><Rocket className="h-4 w-4 mr-1" /> Launch Pipeline</>}
              </Button>
            )}
            {!latestRun && !primaryOffer && (
              <Badge variant="outline" className="text-xs">Awaiting offer data</Badge>
            )}
            {latestRun?.status === 'completed' && (
              <Button size="sm" variant="default" onClick={() => onMarkActive(client.clientId)}>
                <CheckCircle2 className="h-4 w-4 mr-1" /> Mark Active
              </Button>
            )}
            {latestRun && (
              <Button variant="outline" size="sm" onClick={() => navigate(`/fulfillment-review/${client.clientId}`)}>
                <Eye className="h-4 w-4 mr-1" /> Full Review
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => exportToGoogleDoc(client, primaryOffer)}>
              <FileDown className="h-4 w-4 mr-1" /> Export to Google Doc
            </Button>
          </div>
        </div>
        {latestRun && (
          <div className="mt-3 space-y-1">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{PHASE_LABELS[latestRun.current_phase || ''] || latestRun.current_phase}</span>
              <span>{progress}%</span>
            </div>
            <Progress value={progress} className="h-2" />
          </div>
        )}

        {/* Always-visible intake summary */}
        <QuickIntakeSummary fields={intakeFields} />
      </CardHeader>

      {isExpanded && (
        <CardContent className="pt-0 border-t">
          <Tabs defaultValue="intake" className="mt-3">
            <TabsList className="bg-muted/50 h-8">
              <TabsTrigger value="intake" className="text-xs h-7 gap-1">
                <ClipboardList className="h-3 w-3" /> Intake
              </TabsTrigger>
              <TabsTrigger value="assets" className="text-xs h-7 gap-1">
                <FileText className="h-3 w-3" /> Assets ({client.assets.length})
              </TabsTrigger>
              <TabsTrigger value="pipeline" className="text-xs h-7 gap-1">
                <Sparkles className="h-3 w-3" /> Pipeline
              </TabsTrigger>
              <TabsTrigger value="files" className="text-xs h-7 gap-1">
                <Upload className="h-3 w-3" /> Files ({client.offerFiles.length})
              </TabsTrigger>
              <TabsTrigger value="automation" className="text-xs h-7 gap-1">
                <Zap className="h-3 w-3" /> Automation
              </TabsTrigger>
            </TabsList>

            {/* Intake Tab - Full onboarding data from aicapitalraising.com */}
            <TabsContent value="intake" className="mt-3">
              <IntakeDataView offer={primaryOffer} clientName={client.clientName} />
            </TabsContent>

            {/* Assets Tab */}
            <TabsContent value="assets" className="mt-3 space-y-3">
              {client.assets.length === 0 ? (
                <div className="text-center py-6 text-muted-foreground">
                  <FileText className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">No assets generated yet</p>
                  <p className="text-xs mt-1">Launch the pipeline to generate research, copy, ads, and more</p>
                </div>
              ) : (
                Object.entries(assetsByType).map(([type, assets]) => {
                  const config = ASSET_TYPE_CONFIG[type];
                  const Icon = config?.icon || FileText;
                  const label = config?.label || type;
                  const latestAsset = assets[0];
                  const isAssetExpanded = expandedAsset === latestAsset.id;

                  return (
                    <Collapsible key={type} open={isAssetExpanded} onOpenChange={() => onToggleAsset(latestAsset.id)}>
                      <div className="border rounded-lg overflow-hidden">
                        <CollapsibleTrigger asChild>
                          <button className="w-full flex items-center justify-between p-3 hover:bg-muted/50 transition-colors text-left">
                            <div className="flex items-center gap-2.5">
                              <Icon className="h-4 w-4 text-muted-foreground" />
                              <span className="text-sm font-medium">{label}</span>
                              <Badge variant="outline" className="text-[10px]">{latestAsset.status}</Badge>
                            </div>
                            <div className="flex items-center gap-2">
                              {assets.length > 1 && <span className="text-[10px] text-muted-foreground">{assets.length} versions</span>}
                              {isAssetExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                            </div>
                          </button>
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <div className="border-t p-3 space-y-3">
                            <div className="bg-muted/30 rounded-lg p-3 max-h-64 overflow-y-auto">
                              <AssetPreview content={latestAsset.content} assetType={type} />
                            </div>
                            <AssetInlineChat
                              assetId={latestAsset.id}
                              assetType={label}
                              onContentUpdated={() => onRefresh()}
                            />
                          </div>
                        </CollapsibleContent>
                      </div>
                    </Collapsible>
                  );
                })
              )}
            </TabsContent>

            {/* Pipeline Tab */}
            <TabsContent value="pipeline" className="mt-3 space-y-2">
              {!latestRun ? (
                <div className="text-center py-6 text-muted-foreground">
                  <Rocket className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">Pipeline not started</p>
                  <Button size="sm" className="mt-3" onClick={() => onLaunchPipeline(client.clientId, primaryOffer?.id)} disabled={isLaunching}>
                    <Rocket className="h-4 w-4 mr-1" /> Launch Pipeline
                  </Button>
                </div>
              ) : (
                PHASE_ORDER.map(phase => {
                  const phaseSteps = phases[phase] || [];
                  if (phaseSteps.length === 0) return null;
                  const completed = phaseSteps.filter(s => s.status === 'completed').length;
                  const failed = phaseSteps.filter(s => s.status === 'failed').length;
                  const isVideoPhase = phase === 'video';
                  const isCurrentPhase = latestRun.current_phase === phase;

                  return (
                    <div key={phase} className={cn(
                      'rounded-lg border p-3 space-y-2',
                      isCurrentPhase && 'border-primary/50 bg-primary/5'
                    )}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">{PHASE_LABELS[phase]}</span>
                          {isCurrentPhase && isPipelineRunning && <Loader2 className="h-3 w-3 animate-spin text-primary" />}
                        </div>
                        <div className="flex items-center gap-1.5 text-xs">
                          {completed > 0 && <Badge variant="outline" className="text-green-600 text-[10px]">{completed}✓</Badge>}
                          {failed > 0 && <Badge variant="destructive" className="text-[10px]">{failed}✗</Badge>}
                          <span className="text-muted-foreground">{phaseSteps.length}</span>
                        </div>
                      </div>
                      {isVideoPhase && !isPipelineRunning && phaseSteps.length > 0 && (
                        <div className="flex items-center gap-2 p-2 rounded bg-yellow-500/10 border border-yellow-500/20">
                          <Pause className="h-3.5 w-3.5 text-yellow-600" />
                          <span className="text-xs text-yellow-700 dark:text-yellow-400 font-medium">
                            Video phase — review scripts before generating
                          </span>
                        </div>
                      )}
                      <div className="space-y-1">
                        {phaseSteps.map(step => {
                          const config = STATUS_CONFIG[step.status] || STATUS_CONFIG.pending;
                          const Icon = config.icon;
                          return (
                            <div key={step.id} className="flex items-center gap-2 py-1 px-2 text-sm rounded hover:bg-muted/30">
                              <Icon className={cn('h-3.5 w-3.5 shrink-0', config.color, step.status === 'running' && 'animate-spin')} />
                              <span className={cn(step.status === 'completed' && 'text-muted-foreground')}>{step.step_name}</span>
                              {step.error_message && (
                                <span className="text-[10px] text-destructive ml-auto truncate max-w-[150px]" title={step.error_message}>
                                  {step.error_message}
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })
              )}
            </TabsContent>

            {/* Files Tab - Upload & manage context files */}
            <TabsContent value="files" className="mt-3">
              <FilesManager
                clientId={client.clientId}
                offerId={primaryOffer?.id}
                files={client.offerFiles}
                onRefresh={onRefresh}
              />
            </TabsContent>

            {/* Automation Tab — 5-phase end-to-end onboarding tracker */}
            <TabsContent value="automation" className="mt-3">
              <OnboardingAutomationPanel
                clientId={client.clientId}
                clientName={client.clientName}
                onMarkActive={onMarkActive}
              />
            </TabsContent>
          </Tabs>
        </CardContent>
      )}
    </Card>
  );
}

// ─── Intake Quick-Glance (always visible on card) ───

interface IntakeField {
  label: string;
  value: string;
  filled: boolean;
}

const INTAKE_QUESTIONS = [
  { key: 'fund_type', label: 'Fund Type' },
  { key: 'raise_amount', label: 'Raise Amount' },
  { key: 'min_investment', label: 'Min Investment' },
  { key: 'timeline', label: 'Timeline' },
  { key: 'target_investor', label: 'Target Investor' },
  { key: 'targeted_returns', label: 'Targeted Returns' },
  { key: 'hold_period', label: 'Hold Period' },
  { key: 'distribution_schedule', label: 'Distribution' },
  { key: 'investment_range', label: 'Investment Range' },
  { key: 'tax_advantages', label: 'Tax Advantages' },
  { key: 'speaker_name', label: 'Speaker' },
  { key: 'industry_focus', label: 'Industry' },
  { key: 'credibility', label: 'Credibility' },
  { key: 'fund_history', label: 'Fund History' },
  { key: 'website_url', label: 'Website' },
  { key: 'brand_notes', label: 'Brand Notes' },
  { key: 'additional_notes', label: 'Additional Notes' },
  { key: 'budget_amount', label: 'Budget' },
  { key: 'budget_mode', label: 'Budget Mode' },
  { key: 'meta_ad_account_id', label: 'Meta Ad Account' },
  { key: 'ghl_location_id', label: 'GHL Location' },
  { key: 'pitch_deck_url', label: 'Pitch Deck' },
] as const;

function buildIntakeFields(offer: ClientOffer | undefined, client: ClientOnboardingData): IntakeField[] {
  const fields: IntakeField[] = [];

  // Pull from offer first, fallback to client-level description fields
  for (const q of INTAKE_QUESTIONS) {
    let val: string | null = null;

    if (offer) {
      const offerVal = (offer as any)[q.key];
      if (offerVal != null && offerVal !== '' && offerVal !== false) {
        val = String(offerVal);
      }
    }

    // Fallback: check client description/offer_description for key info
    if (!val && q.key === 'website_url') val = client.clientWebsite || null;

    fields.push({
      label: q.label,
      value: val || '—',
      filled: !!val,
    });
  }

  // Add client-level description if present
  if (client.clientDescription) {
    fields.unshift({ label: 'Description', value: client.clientDescription, filled: true });
  }
  if (client.clientOfferDescription && client.clientOfferDescription !== client.clientDescription) {
    fields.splice(1, 0, { label: 'Offer Details', value: client.clientOfferDescription, filled: true });
  }

  return fields;
}

function QuickIntakeSummary({ fields }: { fields: IntakeField[] }) {
  const filled = fields.filter(f => f.filled);
  const missing = fields.filter(f => !f.filled);

  if (filled.length === 0) {
    return (
      <div className="mt-3 p-3 rounded-lg bg-muted/30 border border-dashed">
        <p className="text-xs text-muted-foreground text-center">No intake data — expand to add details or upload files for AI context</p>
      </div>
    );
  }

  return (
    <div className="mt-3 space-y-2">
      {/* Answered questions grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-1.5 p-3 rounded-lg bg-muted/30">
        {filled.map(f => (
          <div key={f.label} className="min-w-0">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{f.label}</p>
            <p className="text-xs font-medium truncate" title={f.value}>{f.value}</p>
          </div>
        ))}
      </div>

      {/* Missing fields indicator */}
      {missing.length > 0 && (
        <div className="flex items-center gap-1.5 px-1">
          <AlertCircle className="h-3 w-3 text-muted-foreground shrink-0" />
          <p className="text-[10px] text-muted-foreground">
            Missing: {missing.map(m => m.label).join(', ')}
          </p>
        </div>
      )}
    </div>
  );
}



function IntakeDataView({ offer, clientName }: { offer?: ClientOffer; clientName: string }) {
  if (!offer) {
    return (
      <div className="text-center py-6 text-muted-foreground">
        <AlertCircle className="h-8 w-8 mx-auto mb-2 opacity-50" />
        <p className="text-sm">No offer/intake data found</p>
        <p className="text-xs mt-1">This client hasn't completed the onboarding form yet</p>
      </div>
    );
  }

  const sections = [
    {
      title: 'Company & Contact',
      icon: Building2,
      fields: [
        { label: 'Fund Name', value: offer.fund_name },
        { label: 'Fund Type', value: offer.fund_type },
        { label: 'Industry Focus', value: offer.industry_focus },
        { label: 'Speaker / Key Person', value: offer.speaker_name },
        { label: 'Website', value: offer.website_url, isLink: true },
        { label: 'Logo', value: offer.logo_url, isLink: true },
      ],
    },
    {
      title: 'Raise & Investment Details',
      icon: DollarSign,
      fields: [
        { label: 'Raise Amount', value: offer.raise_amount },
        { label: 'Min Investment', value: offer.min_investment },
        { label: 'Investment Range', value: offer.investment_range },
        { label: 'Timeline', value: offer.timeline },
        { label: 'Target Investor', value: offer.target_investor },
        { label: 'Targeted Returns', value: offer.targeted_returns },
        { label: 'Hold Period', value: offer.hold_period },
        { label: 'Distribution Schedule', value: offer.distribution_schedule },
        { label: 'Tax Advantages', value: offer.tax_advantages },
        { label: 'Accredited Only', value: offer.accredited_only ? 'Yes' : offer.accredited_only === false ? 'No' : null },
        { label: 'Reg D Type', value: offer.reg_d_type },
      ],
    },
    {
      title: 'Credibility & History',
      icon: Shield,
      fields: [
        { label: 'Credibility', value: offer.credibility },
        { label: 'Fund History', value: offer.fund_history },
      ],
    },
    {
      title: 'Budget & Advertising',
      icon: Target,
      fields: [
        { label: 'Budget Mode', value: offer.budget_mode },
        { label: 'Budget Amount', value: offer.budget_amount ? `$${offer.budget_amount.toLocaleString()}` : null },
        { label: 'Meta Ad Account', value: offer.meta_ad_account_id },
        { label: 'Meta Page ID', value: offer.meta_page_id },
        { label: 'Meta Pixel ID', value: offer.meta_pixel_id },
        { label: 'GHL Location', value: offer.ghl_location_id },
      ],
    },
    {
      title: 'Brand & Notes',
      icon: Megaphone,
      fields: [
        { label: 'Brand Colors', value: offer.brand_colors ? JSON.stringify(offer.brand_colors) : null },
        { label: 'Brand Fonts', value: offer.brand_fonts ? JSON.stringify(offer.brand_fonts) : null },
        { label: 'Brand Notes', value: offer.brand_notes },
        { label: 'Additional Notes', value: offer.additional_notes },
        { label: 'Pitch Deck', value: offer.pitch_deck_url, isLink: true },
      ],
    },
  ];

  // Check for raw form data from GHL webhook
  const hasRawData = offer.raw_form_data && Object.keys(offer.raw_form_data).length > 0;

  return (
    <div className="space-y-4">
      {/* Offer description summary */}
      {offer.description && (
        <div className="bg-muted/30 rounded-lg p-3">
          <p className="text-xs font-medium text-muted-foreground mb-1">Offer Description</p>
          <p className="text-sm whitespace-pre-wrap">{offer.description}</p>
        </div>
      )}

      {/* Structured sections */}
      {sections.map(section => {
        const filledFields = section.fields.filter(f => f.value);
        if (filledFields.length === 0) return null;
        const Icon = section.icon;

        return (
          <div key={section.title} className="border rounded-lg p-3">
            <div className="flex items-center gap-2 mb-2">
              <Icon className="h-4 w-4 text-muted-foreground" />
              <h4 className="text-sm font-semibold">{section.title}</h4>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
              {filledFields.map(field => (
                <div key={field.label}>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{field.label}</p>
                  {field.isLink ? (
                    <a href={String(field.value)} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline truncate block">
                      {String(field.value).replace(/^https?:\/\//, '').slice(0, 40)}
                    </a>
                  ) : (
                    <p className="text-xs font-medium">{String(field.value)}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      })}

      {/* Raw form data fallback */}
      {hasRawData && (
        <Collapsible>
          <CollapsibleTrigger asChild>
            <button className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors w-full">
              <ChevronRight className="h-3 w-3" />
              <span>Raw form data ({Object.keys(offer.raw_form_data).length} fields)</span>
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="mt-2 bg-muted/30 rounded-lg p-3 max-h-48 overflow-y-auto">
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                {Object.entries(offer.raw_form_data).map(([key, val]) => (
                  <div key={key}>
                    <p className="text-[10px] text-muted-foreground">{key.replace(/_/g, ' ')}</p>
                    <p className="text-xs font-medium truncate">{String(val)}</p>
                  </div>
                ))}
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}

// ─── Files Manager (Upload + List) ───

function FilesManager({ clientId, offerId, files, onRefresh }: {
  clientId: string;
  offerId?: string;
  files: OfferFile[];
  onRefresh: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = e.target.files;
    if (!selectedFiles || selectedFiles.length === 0) return;
    if (!offerId) {
      toast.error('No offer linked — create an offer first');
      return;
    }

    setUploading(true);
    try {
      for (const file of Array.from(selectedFiles)) {
        const path = `${clientId}/${Date.now()}-${file.name}`;
        const { error: uploadError } = await supabase.storage
          .from('client-offers')
          .upload(path, file, { upsert: true });
        if (uploadError) throw uploadError;

        const { data: urlData } = supabase.storage.from('client-offers').getPublicUrl(path);

        await supabase.from('client_offer_files').insert({
          client_id: clientId,
          offer_id: offerId,
          file_name: file.name,
          file_url: urlData.publicUrl,
          file_type: file.type || null,
          file_size_bytes: file.size,
        } as any);
      }
      toast.success(`${selectedFiles.length} file(s) uploaded`);
      onRefresh();
    } catch (err: any) {
      toast.error(`Upload failed: ${err.message}`);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDelete = async (fileId: string) => {
    setDeleting(fileId);
    try {
      await supabase.from('client_offer_files').delete().eq('id', fileId);
      toast.success('File removed');
      onRefresh();
    } catch (err: any) {
      toast.error(`Delete failed: ${err.message}`);
    } finally {
      setDeleting(null);
    }
  };

  const formatSize = (bytes: number | null) => {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="space-y-3">
      {/* Upload area */}
      <div
        className="border-2 border-dashed rounded-lg p-4 text-center cursor-pointer hover:border-primary/50 hover:bg-muted/30 transition-colors"
        onClick={() => fileInputRef.current?.click()}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.csv,.txt,.png,.jpg,.jpeg,.gif,.webp,.mp4,.mov"
          className="hidden"
          onChange={handleUpload}
        />
        {uploading ? (
          <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
        ) : (
          <>
            <Upload className="h-6 w-6 mx-auto text-muted-foreground mb-1" />
            <p className="text-sm text-muted-foreground">
              Click to upload pitch decks, investor lists, brand assets, or any context files
            </p>
            <p className="text-[10px] text-muted-foreground mt-1">
              PDF, DOCX, PPTX, images, videos — files are used as AI context for asset generation
            </p>
          </>
        )}
      </div>

      {/* Files list */}
      {files.length === 0 ? (
        <p className="text-xs text-muted-foreground text-center py-2">No files uploaded yet</p>
      ) : (
        <div className="space-y-1.5">
          {files.map(file => (
            <div key={file.id} className="flex items-center gap-3 p-2 rounded-lg border hover:bg-muted/30 group">
              <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{file.file_name}</p>
                <p className="text-[10px] text-muted-foreground">
                  {file.file_type || 'unknown'} · {formatSize(file.file_size_bytes)} · {new Date(file.created_at).toLocaleDateString()}
                </p>
              </div>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <a href={file.file_url} target="_blank" rel="noopener noreferrer">
                  <Button variant="ghost" size="icon" className="h-7 w-7">
                    <Download className="h-3.5 w-3.5" />
                  </Button>
                </a>
                <Button
                  variant="ghost" size="icon" className="h-7 w-7 text-destructive"
                  onClick={() => handleDelete(file.id)}
                  disabled={deleting === file.id}
                >
                  {deleting === file.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Asset Preview ───

function AssetPreview({ content, assetType }: { content: any; assetType: string }) {
  if (!content) return <p className="text-xs text-muted-foreground">No content</p>;

  if (Array.isArray(content)) {
    return (
      <div className="space-y-2">
        {content.slice(0, 5).map((item: any, i: number) => (
          <div key={i} className="border-b border-border/50 pb-2 last:border-0">
            {item.subject && <p className="text-xs font-semibold">{item.subject}</p>}
            {item.title && <p className="text-xs font-semibold">{item.title}</p>}
            {item.hook && <p className="text-xs text-muted-foreground italic">"{item.hook}"</p>}
            {item.message && <p className="text-xs">{item.message}</p>}
            {item.primary_text && <p className="text-xs">{item.primary_text}</p>}
            {item.headline && <p className="text-[10px] text-muted-foreground">{item.headline}</p>}
          </div>
        ))}
        {content.length > 5 && <p className="text-[10px] text-muted-foreground">+{content.length - 5} more items</p>}
      </div>
    );
  }

  if (typeof content === 'object') {
    const entries = Object.entries(content).slice(0, 6);
    return (
      <div className="space-y-2">
        {entries.map(([key, val]) => (
          <div key={key}>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-0.5">
              {key.replace(/_/g, ' ')}
            </p>
            <p className="text-xs line-clamp-3">
              {typeof val === 'string' ? val : Array.isArray(val) ? `${val.length} items` : JSON.stringify(val).slice(0, 200)}
            </p>
          </div>
        ))}
        {Object.keys(content).length > 6 && (
          <p className="text-[10px] text-muted-foreground">+{Object.keys(content).length - 6} more sections</p>
        )}
      </div>
    );
  }

  return <p className="text-xs">{String(content).slice(0, 500)}</p>;
}
