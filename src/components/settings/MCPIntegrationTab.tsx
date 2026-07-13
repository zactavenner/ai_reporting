import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Copy, Check, ExternalLink, Plug, ShieldCheck, Zap } from 'lucide-react';
import { toast } from 'sonner';

const PROJECT_REF = import.meta.env.VITE_SUPABASE_PROJECT_ID as string | undefined;
const MCP_URL = PROJECT_REF
  ? `https://${PROJECT_REF}.supabase.co/functions/v1/mcp`
  : 'https://<project-ref>.supabase.co/functions/v1/mcp';

const CURRENT_TOOLS = [
  { name: 'list_clients', desc: 'List clients visible to the signed-in user' },
  { name: 'get_client_metrics', desc: 'Aggregated lead/call/funded metrics per client' },
  { name: 'get_top_performers', desc: 'Top Meta campaign / ad set / ad by funded $' },
  { name: 'list_recent_leads', desc: 'Recent leads for a client' },
  { name: 'list_tasks', desc: 'Tasks filtered by client, assignee, or status' },
  { name: 'get_deal_pipeline', desc: 'Deals in the local pipeline for a client' },
  { name: 'list_creative_briefs', desc: 'Creative briefs for a client' },
  { name: 'get_meta_ads_daily_insights', desc: 'Daily Meta spend/impression/lead insights' },
  { name: 'get_lead_enrichment', desc: 'Enrichment data for a specific lead' },
  { name: 'get_weekly_report', desc: 'Latest weekly sync/recap for a client' },
  { name: 'list_meetings', desc: 'Recent agency meetings' },
  { name: 'get_client_settings', desc: 'Client KPI thresholds, targets, integration ids' },
  { name: 'get_sync_health', desc: 'Aggregate sync queue counts' },
  { name: 'list_ai_studio_jobs', desc: 'Recent AI Studio batch jobs and status' },
  { name: 'list_pending_approvals', desc: 'Items in the approval queue' },
];

const PLANNED_TOOLS: string[] = [];

const CLIENTS = [
  { name: 'Claude Desktop', url: 'https://modelcontextprotocol.io/quickstart/user' },
  { name: 'ChatGPT (Custom GPT)', url: 'https://platform.openai.com/docs/guides/tools-remote-mcp' },
  { name: 'Cursor', url: 'https://docs.cursor.com/context/model-context-protocol' },
  { name: 'Codex', url: 'https://developers.openai.com/codex/mcp/' },
];

export function MCPIntegrationTab() {
  const [copied, setCopied] = useState(false);

  const copyUrl = async () => {
    await navigator.clipboard.writeText(MCP_URL);
    setCopied(true);
    toast.success('MCP URL copied');
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold flex items-center gap-2">
          <Plug className="h-5 w-5" />
          MCP Server (Agent Integration)
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          Connect Claude, ChatGPT, Cursor, or any MCP-compatible assistant to your reporting
          workspace. Tools execute as the signed-in user under Row-Level Security.
        </p>
      </div>

      <Card className="p-4 space-y-3 border-2">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Server URL</div>
            <code className="text-sm font-mono break-all">{MCP_URL}</code>
          </div>
          <Button size="sm" variant="outline" onClick={copyUrl}>
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          </Button>
        </div>
        <div className="flex flex-wrap gap-2 pt-2 border-t">
          <Badge variant="secondary" className="gap-1">
            <ShieldCheck className="h-3 w-3" /> OAuth 2.1 (Supabase)
          </Badge>
          <Badge variant="secondary">RLS-scoped per user</Badge>
          <Badge variant="secondary">Streamable HTTP</Badge>
        </div>
      </Card>

      <Card className="p-4 space-y-3">
        <h3 className="font-semibold text-sm flex items-center gap-2">
          <Zap className="h-4 w-4" />
          Available Tools ({CURRENT_TOOLS.length})
        </h3>
        <ul className="space-y-2">
          {CURRENT_TOOLS.map((t) => (
            <li key={t.name} className="flex items-start justify-between gap-3 text-sm">
              <div>
                <code className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">{t.name}</code>
                <p className="text-xs text-muted-foreground mt-0.5">{t.desc}</p>
              </div>
              <Badge variant="outline" className="text-[10px]">read-only</Badge>
            </li>
          ))}
        </ul>
      </Card>

      <Card className="p-4 space-y-3">
        <h3 className="font-semibold text-sm">Connect a client</h3>
        <div className="grid grid-cols-2 gap-2">
          {CLIENTS.map((c) => (
            <a
              key={c.name}
              href={c.url}
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-between gap-2 text-sm p-2 rounded border hover:bg-muted/50 transition-colors"
            >
              <span>{c.name}</span>
              <ExternalLink className="h-3 w-3 text-muted-foreground" />
            </a>
          ))}
        </div>
        <p className="text-xs text-muted-foreground pt-2 border-t">
          Paste the server URL into your client's MCP settings. On first connect you'll be
          redirected here to approve access to your account.
        </p>
      </Card>

      <Card className="p-4 space-y-2 bg-muted/30">
        <h3 className="font-semibold text-sm">Planned tools (roadmap)</h3>
        <p className="text-xs text-muted-foreground">
          Coverage gaps identified in the last audit. These features exist in the app but are not
          yet exposed to MCP clients.
        </p>
        <div className="flex flex-wrap gap-1.5 pt-1">
          {PLANNED_TOOLS.map((t) => (
            <code key={t} className="font-mono text-[11px] bg-background border px-1.5 py-0.5 rounded">
              {t}
            </code>
          ))}
        </div>
      </Card>
    </div>
  );
}