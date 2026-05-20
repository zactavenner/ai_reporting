import { useState } from 'react';
import { Bot, Copy, Loader2, Play, ChevronDown, ChevronUp, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface AgentMcpPanelProps {
  clientId: string;
}

type ToolDef = { name: string; description: string; write?: boolean };

const META_TOOLS: ToolDef[] = [
  { name: 'meta_list_campaigns', description: 'List Meta campaigns for this client' },
  { name: 'meta_list_adsets', description: 'List ad sets (optionally for a campaign)' },
  { name: 'meta_list_ads', description: 'List ads (optionally for an ad set / campaign)' },
  { name: 'meta_get_ad_performance', description: 'Spend, CTR, CPC, conversions for an ad or campaign' },
  { name: 'meta_toggle_status', description: 'Pause / activate campaign, adset, or ad', write: true },
  { name: 'meta_update_budget', description: 'Update daily / lifetime budget', write: true },
  { name: 'meta_duplicate', description: 'Duplicate a campaign / adset / ad', write: true },
  { name: 'meta_create_campaign', description: 'Create new campaign', write: true },
  { name: 'meta_create_ad', description: 'Create new ad from a creative', write: true },
  { name: 'meta_sync_account', description: 'Trigger a Meta Ads sync for this client', write: true },
];

const READONLY_TOOLS = META_TOOLS.filter((t) => !t.write).map((t) => t.name);

export function AgentMcpPanel({ clientId }: AgentMcpPanelProps) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [selectedTool, setSelectedTool] = useState<string>('meta_list_campaigns');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<string>('');

  const projectId = (import.meta as any).env?.VITE_SUPABASE_PROJECT_ID || '';
  const mcpUrl = `https://${projectId}.supabase.co/functions/v1/mcp-agent-server`;

  const copyUrl = async () => {
    await navigator.clipboard.writeText(mcpUrl);
    setCopied(true);
    toast.success('MCP endpoint copied');
    setTimeout(() => setCopied(false), 1500);
  };

  const runTool = async () => {
    setRunning(true);
    setResult('');
    try {
      const { data, error } = await supabase.functions.invoke('mcp-agent-server', {
        body: {
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: selectedTool, arguments: { client_id: clientId, limit: 10 } },
        },
      });
      if (error) throw error;
      const text = data?.result?.content?.[0]?.text ?? JSON.stringify(data, null, 2);
      setResult(text);
    } catch (e: any) {
      setResult(`Error: ${e.message || String(e)}`);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="rounded-lg border bg-card">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 text-left"
      >
        <div className="flex items-center gap-2">
          <Bot className="h-4 w-4 text-primary" />
          <span className="font-semibold text-sm">AI Agent · MCP Tools</span>
          <Badge variant="secondary" className="text-[10px]">{META_TOOLS.length} Meta tools</Badge>
        </div>
        {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-4 border-t pt-4">
          {/* Endpoint */}
          <div>
            <div className="text-xs font-medium text-muted-foreground mb-1">MCP Endpoint (Claude Desktop / Cursor)</div>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs bg-muted rounded px-2 py-1.5 truncate">{mcpUrl}</code>
              <Button size="sm" variant="outline" onClick={copyUrl}>
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              </Button>
            </div>
          </div>

          {/* Tool list */}
          <div>
            <div className="text-xs font-medium text-muted-foreground mb-2">Available Meta Ads tools</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
              {META_TOOLS.map((t) => (
                <div key={t.name} className="flex items-start gap-2 text-xs p-2 rounded border bg-background">
                  <Badge variant={t.write ? 'destructive' : 'outline'} className="text-[10px] mt-0.5 shrink-0">
                    {t.write ? 'WRITE' : 'READ'}
                  </Badge>
                  <div className="min-w-0">
                    <div className="font-mono font-medium truncate">{t.name}</div>
                    <div className="text-muted-foreground">{t.description}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Test runner */}
          <div>
            <div className="text-xs font-medium text-muted-foreground mb-2">Test a read-only tool with this client</div>
            <div className="flex items-center gap-2">
              <Select value={selectedTool} onValueChange={setSelectedTool}>
                <SelectTrigger className="h-9 text-xs flex-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {READONLY_TOOLS.map((n) => (
                    <SelectItem key={n} value={n} className="text-xs font-mono">{n}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button size="sm" onClick={runTool} disabled={running}>
                {running ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Play className="h-3.5 w-3.5 mr-1.5" />}
                Run
              </Button>
            </div>
            {result && (
              <pre className="mt-2 text-[11px] bg-muted rounded p-2 max-h-64 overflow-auto">{result}</pre>
            )}
          </div>
        </div>
      )}
    </div>
  );
}