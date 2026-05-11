import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { useAgencySettings, useUpdateAgencySettings } from '@/hooks/useAgencySettings';
import { useSyncMeetings } from '@/hooks/useMeetings';
import { TeamManagementTab } from './TeamManagementTab';
import { SyncQueueStatus } from './SyncQueueStatus';
import { Brain, Settings2, Key, DollarSign, Eye, EyeOff, Video, Copy, RefreshCw, Users, Database, Cpu, Code2, FileText, Sheet } from 'lucide-react';
import { ApiReferenceTab } from './ApiReferenceTab';

const OPENAI_MODELS = [
  { value: 'gpt-5', label: 'GPT-5' },
  { value: 'gpt-5-mini', label: 'GPT-5 Mini' },
  { value: 'gpt-5-nano', label: 'GPT-5 Nano' },
  { value: 'gpt-5.2', label: 'GPT-5.2' },
];

const GEMINI_MODELS = [
  { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
  { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
  { value: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite' },
  { value: 'gemini-3-pro', label: 'Gemini 3 Pro' },
  { value: 'gemini-3-flash', label: 'Gemini 3 Flash' },
];

const GROK_MODELS = [
  { value: 'grok-4-fast-reasoning', label: 'Grok 4 Fast Reasoning' },
  { value: 'grok-3', label: 'Grok 3' },
  { value: 'grok-3-mini', label: 'Grok 3 Mini' },
  { value: 'grok-2', label: 'Grok 2' },
];

interface AgencySettingsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AgencySettingsModal({ open, onOpenChange }: AgencySettingsModalProps) {
  const { data: settings } = useAgencySettings();
  const updateSettings = useUpdateAgencySettings();
  
  const [saving, setSaving] = useState(false);
  const [agencyPrompt, setAgencyPrompt] = useState('');
  const [clientPrompt, setClientPrompt] = useState('');
  
  // API Keys
  const [openaiKey, setOpenaiKey] = useState('');
  const [geminiKey, setGeminiKey] = useState('');
  const [xaiKey, setXaiKey] = useState('');
  const [apiUsageLimit, setApiUsageLimit] = useState('100');
  const [showOpenaiKey, setShowOpenaiKey] = useState(false);
  const [showGeminiKey, setShowGeminiKey] = useState(false);
  const [showXaiKey, setShowXaiKey] = useState(false);

  // Model selections
  const [selectedOpenaiModel, setSelectedOpenaiModel] = useState('gpt-5');
  const [selectedGeminiModel, setSelectedGeminiModel] = useState('gemini-2.5-pro');
  const [selectedGrokModel, setSelectedGrokModel] = useState('grok-3');
  
  // MeetGeek Integration
  const [meetgeekApiKey, setMeetgeekApiKey] = useState('');
  const [showMeetgeekKey, setShowMeetgeekKey] = useState(false);
  const [kpiDocUrl, setKpiDocUrl] = useState('');
  const [kpiSheetUrl, setKpiSheetUrl] = useState('');
  const [masterSheetUrl, setMasterSheetUrl] = useState('');
  const [masterDefaultGid, setMasterDefaultGid] = useState('');
  const [masterPinnedRaw, setMasterPinnedRaw] = useState('');
  const [discoveringTabs, setDiscoveringTabs] = useState(false);
  const syncMeetings = useSyncMeetings();
  
  const webhookUrl = `https://jgwwmtuvjlmzapwqiabu.supabase.co/functions/v1/meetgeek-webhook`;

  useEffect(() => {
    if (settings) {
      setAgencyPrompt(settings.ai_prompt_agency || '');
      setClientPrompt(settings.ai_prompt_client || '');
      setOpenaiKey(settings.openai_api_key || '');
      setGeminiKey(settings.gemini_api_key || '');
      setXaiKey((settings as any).xai_api_key || '');
      setApiUsageLimit(String(settings.api_usage_limit || 100));
      setMeetgeekApiKey((settings as any).meetgeek_api_key || '');
      setKpiDocUrl((settings as any).kpi_google_doc_url || '');
      setKpiSheetUrl((settings as any).kpi_google_sheet_url || '');
      setMasterSheetUrl((settings as any).master_google_sheet_url || '');
      setMasterDefaultGid((settings as any).master_default_gid || '');
      const pinned = (settings as any).master_pinned_gids;
      setMasterPinnedRaw(
        Array.isArray(pinned)
          ? pinned.map((p: any) => `${p?.gid ?? ''}|${p?.title ?? ''}`).join('\n')
          : ''
      );
      setSelectedOpenaiModel((settings as any).selected_openai_model || 'gpt-5');
      setSelectedGeminiModel((settings as any).selected_gemini_model || 'gemini-2.5-pro');
      setSelectedGrokModel((settings as any).selected_grok_model || 'grok-3');
    }
  }, [settings]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const pinnedTabs = masterPinnedRaw
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean)
        .map(line => {
          const [gid, ...rest] = line.split('|');
          return { gid: gid.trim(), title: rest.join('|').trim() || gid.trim() };
        })
        .filter(t => t.gid);
      await updateSettings.mutateAsync({
        ai_prompt_agency: agencyPrompt,
        ai_prompt_client: clientPrompt,
        openai_api_key: openaiKey || null,
        gemini_api_key: geminiKey || null,
        xai_api_key: xaiKey || null,
        api_usage_limit: parseFloat(apiUsageLimit) || 100,
        meetgeek_api_key: meetgeekApiKey || null,
        kpi_google_doc_url: kpiDocUrl.trim() || null,
        kpi_google_sheet_url: kpiSheetUrl.trim() || null,
        master_google_sheet_url: masterSheetUrl.trim() || null,
        master_default_gid: masterDefaultGid.trim() || null,
        master_pinned_gids: pinnedTabs,
        selected_openai_model: selectedOpenaiModel,
        selected_gemini_model: selectedGeminiModel,
        selected_grok_model: selectedGrokModel,
      } as any);
      toast.success('Agency settings saved');
      onOpenChange(false);
    } catch (error) {
      console.error('Error saving settings:', error);
      toast.error('Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const estimateMonthlyUsage = () => {
    const limit = parseFloat(apiUsageLimit) || 100;
    const estimatedRequests = Math.floor(limit / 0.06);
    return estimatedRequests;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl border-2 border-border max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold flex items-center gap-2">
            <Settings2 className="h-5 w-5" />
            Agency Settings
          </DialogTitle>
          <DialogDescription>
            Configure agency-wide settings including AI prompts and API keys
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="team" className="mt-4">
          <TabsList className="grid w-full grid-cols-6">
            <TabsTrigger value="team" className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              Team
            </TabsTrigger>
            <TabsTrigger value="sync-queue" className="flex items-center gap-2">
              <Database className="h-4 w-4" />
              Sync Queue
            </TabsTrigger>
            <TabsTrigger value="ai-prompts" className="flex items-center gap-2">
              <Brain className="h-4 w-4" />
              AI Prompts
            </TabsTrigger>
            <TabsTrigger value="api-keys" className="flex items-center gap-2">
              <Key className="h-4 w-4" />
              API Keys
            </TabsTrigger>
            <TabsTrigger value="integrations" className="flex items-center gap-2">
              <Video className="h-4 w-4" />
              Integrations
            </TabsTrigger>
            <TabsTrigger value="api-reference" className="flex items-center gap-2">
              <Code2 className="h-4 w-4" />
              API
            </TabsTrigger>
          </TabsList>
          
          <TabsContent value="team" className="mt-4">
            <TeamManagementTab />
          </TabsContent>

          <TabsContent value="sync-queue" className="mt-4">
            <SyncQueueStatus />
          </TabsContent>
          
          <TabsContent value="ai-prompts" className="space-y-6 mt-4">
            <div className="border-2 border-border p-4 space-y-4">
              <div>
                <h4 className="font-medium mb-1 flex items-center gap-2">
                  <Brain className="h-4 w-4" />
                  Agency-Level AI Prompt
                </h4>
                <p className="text-sm text-muted-foreground mb-3">
                  This prompt is used when analyzing data at the agency dashboard level.
                  The AI will read uploaded files and use this context.
                </p>
                <Label htmlFor="agencyPrompt">System Prompt</Label>
                <Textarea
                  id="agencyPrompt"
                  value={agencyPrompt}
                  onChange={(e) => setAgencyPrompt(e.target.value)}
                  rows={6}
                  placeholder="Enter the system prompt for agency-level AI analysis..."
                  className="mt-2 font-mono text-sm"
                />
              </div>
            </div>

            <div className="border-2 border-border p-4 space-y-4">
              <div>
                <h4 className="font-medium mb-1 flex items-center gap-2">
                  <Brain className="h-4 w-4" />
                  Client-Level AI Prompt
                </h4>
                <p className="text-sm text-muted-foreground mb-3">
                  This prompt is used when analyzing data for individual clients.
                  The AI will read uploaded files and use this context.
                </p>
                <Label htmlFor="clientPrompt">System Prompt</Label>
                <Textarea
                  id="clientPrompt"
                  value={clientPrompt}
                  onChange={(e) => setClientPrompt(e.target.value)}
                  rows={6}
                  placeholder="Enter the system prompt for client-level AI analysis..."
                  className="mt-2 font-mono text-sm"
                />
              </div>
            </div>

            <p className="text-xs text-muted-foreground">
              Tip: Include instructions about what data sources to consider, how to format responses, 
              and any specific metrics or KPIs to focus on.
            </p>
          </TabsContent>

          <TabsContent value="api-keys" className="space-y-6 mt-4">
            {/* Model Selection */}
            <div className="border-2 border-border p-4 space-y-4">
              <h4 className="font-medium flex items-center gap-2">
                <Cpu className="h-4 w-4" />
                Model Selection
              </h4>
              <p className="text-sm text-muted-foreground">
                Choose which model to use from each AI platform
              </p>
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label className="text-xs">OpenAI</Label>
                  <Select value={selectedOpenaiModel} onValueChange={setSelectedOpenaiModel}>
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {OPENAI_MODELS.map(m => (
                        <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">Google Gemini</Label>
                  <Select value={selectedGeminiModel} onValueChange={setSelectedGeminiModel}>
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {GEMINI_MODELS.map(m => (
                        <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">xAI (Grok)</Label>
                  <Select value={selectedGrokModel} onValueChange={setSelectedGrokModel}>
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {GROK_MODELS.map(m => (
                        <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            {/* OpenAI API Key */}
            <div className="border-2 border-border p-4 space-y-4">
              <div>
                <h4 className="font-medium mb-1 flex items-center gap-2">
                  <Key className="h-4 w-4" />
                  OpenAI API Key
                </h4>
                <p className="text-sm text-muted-foreground mb-3">
                  Your OpenAI API key for GPT-4 and other models. Get one at{' '}
                  <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer" className="text-primary underline">
                    platform.openai.com
                  </a>
                </p>
                <div className="relative">
                  <Input
                    id="openaiKey"
                    type={showOpenaiKey ? 'text' : 'password'}
                    value={openaiKey}
                    onChange={(e) => setOpenaiKey(e.target.value)}
                    placeholder="sk-..."
                    className="font-mono pr-10"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-0 top-0 h-full"
                    onClick={() => setShowOpenaiKey(!showOpenaiKey)}
                  >
                    {showOpenaiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
            </div>

            {/* Gemini API Key */}
            <div className="border-2 border-border p-4 space-y-4">
              <div>
                <h4 className="font-medium mb-1 flex items-center gap-2">
                  <Key className="h-4 w-4" />
                  Google Gemini API Key
                </h4>
                <p className="text-sm text-muted-foreground mb-3">
                  Your Google Gemini API key for Gemini Pro models. Get one at{' '}
                  <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" className="text-primary underline">
                    aistudio.google.com
                  </a>
                </p>
                <div className="relative">
                  <Input
                    id="geminiKey"
                    type={showGeminiKey ? 'text' : 'password'}
                    value={geminiKey}
                    onChange={(e) => setGeminiKey(e.target.value)}
                    placeholder="AIza..."
                    className="font-mono pr-10"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-0 top-0 h-full"
                    onClick={() => setShowGeminiKey(!showGeminiKey)}
                  >
                    {showGeminiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
            </div>

            {/* xAI API Key */}
            <div className="border-2 border-border p-4 space-y-4">
              <div>
                <h4 className="font-medium mb-1 flex items-center gap-2">
                  <Key className="h-4 w-4" />
                  xAI (Grok) API Key
                </h4>
                <p className="text-sm text-muted-foreground mb-3">
                  Your xAI API key for Grok models. Get one at{' '}
                  <a href="https://console.x.ai" target="_blank" rel="noreferrer" className="text-primary underline">
                    console.x.ai
                  </a>
                </p>
                <div className="relative">
                  <Input
                    id="xaiKey"
                    type={showXaiKey ? 'text' : 'password'}
                    value={xaiKey}
                    onChange={(e) => setXaiKey(e.target.value)}
                    placeholder="xai-..."
                    className="font-mono pr-10"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-0 top-0 h-full"
                    onClick={() => setShowXaiKey(!showXaiKey)}
                  >
                    {showXaiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
            </div>

            {/* Monthly Usage Limit */}
            <div className="border-2 border-border p-4 space-y-4">
              <div>
                <h4 className="font-medium mb-1 flex items-center gap-2">
                  <DollarSign className="h-4 w-4" />
                  Monthly Usage Limit
                </h4>
                <p className="text-sm text-muted-foreground mb-3">
                  Set a monthly spending limit for API usage (in USD)
                </p>
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">$</span>
                    <Input
                      id="usageLimit"
                      type="number"
                      value={apiUsageLimit}
                      onChange={(e) => setApiUsageLimit(e.target.value)}
                      className="w-24"
                      min="0"
                    />
                  </div>
                  <div className="text-sm text-muted-foreground">
                    ≈ {estimateMonthlyUsage().toLocaleString()} requests/month
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-muted/50 border border-border p-3 text-sm">
              <p className="font-medium mb-1">Usage Estimate</p>
              <p className="text-muted-foreground">
                Based on ${apiUsageLimit}/month limit and average token usage:
              </p>
              <ul className="list-disc list-inside text-muted-foreground mt-1 space-y-1">
                <li>OpenAI GPT-4: ~${(parseFloat(apiUsageLimit) * 0.7).toFixed(0)} allocated</li>
                <li>Gemini Pro: ~${(parseFloat(apiUsageLimit) * 0.3).toFixed(0)} allocated</li>
              </ul>
            </div>
          </TabsContent>

          <TabsContent value="integrations" className="space-y-6 mt-4">
            <div className="border-2 border-border p-4 space-y-4">
              <div>
                <h4 className="font-medium mb-1 flex items-center gap-2">
                  <Sheet className="h-4 w-4" />
                  Master Spreadsheet (Agency-wide)
                </h4>
                <p className="text-sm text-muted-foreground mb-3">
                  This sheet is embedded on the main dashboard for all admins. Edits made there save directly in Google Sheets.
                </p>
                <div className="space-y-3">
                  <div>
                    <Label htmlFor="masterSheetUrl">Master Sheet URL</Label>
                    <Input
                      id="masterSheetUrl"
                      type="url"
                      value={masterSheetUrl}
                      onChange={(e) => setMasterSheetUrl(e.target.value)}
                      placeholder="https://docs.google.com/spreadsheets/d/..."
                      className="font-mono text-xs mt-1"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label htmlFor="masterDefaultGid">Default tab gid</Label>
                      <Input
                        id="masterDefaultGid"
                        value={masterDefaultGid}
                        onChange={(e) => setMasterDefaultGid(e.target.value)}
                        placeholder="e.g. 943777908"
                        className="font-mono text-xs mt-1"
                      />
                    </div>
                    <div className="flex items-end">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={!masterSheetUrl.trim() || discoveringTabs}
                        onClick={async () => {
                          const m = masterSheetUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
                          if (!m) { toast.error('Invalid sheet URL'); return; }
                          setDiscoveringTabs(true);
                          try {
                            const { data, error } = await (await import('@/integrations/supabase/client')).supabase.functions.invoke('fetch-sheet-metrics', {
                              body: { sheet_id: m[1], action: 'list_tabs' },
                            });
                            if (error) throw error;
                            const tabs = (data as any)?.tabs || [];
                            setMasterPinnedRaw(tabs.map((t: any) => `${t.gid}|${t.title}`).join('\n'));
                            toast.success(`Found ${tabs.length} tabs`);
                          } catch (err: any) {
                            toast.error(`Failed: ${err.message || 'unknown'}`);
                          } finally {
                            setDiscoveringTabs(false);
                          }
                        }}
                      >
                        {discoveringTabs ? 'Loading…' : 'Discover tabs'}
                      </Button>
                    </div>
                  </div>
                  <div>
                    <Label htmlFor="masterPinned">Pinned tabs (one per line: <code>gid|Label</code>)</Label>
                    <Textarea
                      id="masterPinned"
                      value={masterPinnedRaw}
                      onChange={(e) => setMasterPinnedRaw(e.target.value)}
                      rows={6}
                      placeholder={'943777908|Master Dashboard\n0|Current Clients'}
                      className="font-mono text-xs mt-1"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      These show as quick buttons above the embedded sheet on the dashboard.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div className="border-2 border-border p-4 space-y-4">
              <div>
                <h4 className="font-medium mb-1 flex items-center gap-2">
                  <FileText className="h-4 w-4" />
                  KPI Tracker Links
                </h4>
                <p className="text-sm text-muted-foreground mb-3">
                  Paste the URLs to your master KPI Google Doc and Google Sheet.
                  These links appear as buttons on every task for quick access.
                </p>
                <div className="space-y-3">
                  <div>
                    <Label htmlFor="kpiDocUrl" className="flex items-center gap-2">
                      <FileText className="h-3.5 w-3.5" /> Google Doc URL
                    </Label>
                    <Input
                      id="kpiDocUrl"
                      type="url"
                      value={kpiDocUrl}
                      onChange={(e) => setKpiDocUrl(e.target.value)}
                      placeholder="https://docs.google.com/document/d/..."
                      className="font-mono text-xs mt-1"
                    />
                  </div>
                  <div>
                    <Label htmlFor="kpiSheetUrl" className="flex items-center gap-2">
                      <Sheet className="h-3.5 w-3.5" /> Google Sheet URL
                    </Label>
                    <Input
                      id="kpiSheetUrl"
                      type="url"
                      value={kpiSheetUrl}
                      onChange={(e) => setKpiSheetUrl(e.target.value)}
                      placeholder="https://docs.google.com/spreadsheets/d/..."
                      className="font-mono text-xs mt-1"
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="border-2 border-border p-4 space-y-4">
              <div>
                <h4 className="font-medium mb-1 flex items-center gap-2">
                  <Video className="h-4 w-4" />
                  MeetGeek.ai Integration
                </h4>
                <p className="text-sm text-muted-foreground mb-3">
                  Sync meeting recordings, transcripts, and action items automatically.
                  Get your API key from{' '}
                  <a 
                    href="https://meetgeek.ai/settings/integrations" 
                    target="_blank" 
                    rel="noreferrer" 
                    className="text-primary underline"
                  >
                    MeetGeek Settings → Integrations → Public API
                  </a>
                </p>
                
                <Label htmlFor="meetgeekKey">API Key</Label>
                <div className="relative mt-1">
                  <Input
                    id="meetgeekKey"
                    type={showMeetgeekKey ? 'text' : 'password'}
                    value={meetgeekApiKey}
                    onChange={(e) => setMeetgeekApiKey(e.target.value)}
                    placeholder="Your MeetGeek API key..."
                    className="font-mono pr-10"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-0 top-0 h-full"
                    onClick={() => setShowMeetgeekKey(!showMeetgeekKey)}
                  >
                    {showMeetgeekKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
              
              <div className="pt-2">
                <Label>Webhook URL</Label>
                <p className="text-xs text-muted-foreground mb-2">
                  Copy this URL to MeetGeek under Settings → Integrations → Webhooks
                </p>
                <div className="flex gap-2">
                  <Input
                    value={webhookUrl}
                    readOnly
                    className="font-mono text-xs"
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => {
                      navigator.clipboard.writeText(webhookUrl);
                      toast.success('Webhook URL copied');
                    }}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              
              <div className="pt-2">
                <Button
                  variant="outline"
                  onClick={() => syncMeetings.mutate()}
                  disabled={syncMeetings.isPending || !meetgeekApiKey}
                >
                  <RefreshCw className={`h-4 w-4 mr-2 ${syncMeetings.isPending ? 'animate-spin' : ''}`} />
                  {syncMeetings.isPending ? 'Syncing...' : 'Sync Recent Meetings'}
                </Button>
                {!meetgeekApiKey && (
                  <p className="text-xs text-muted-foreground mt-2">
                    Enter your API key and save settings first
                  </p>
                )}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="api-reference" className="mt-4">
            <ApiReferenceTab />
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