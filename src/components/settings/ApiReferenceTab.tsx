import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Copy, Check, ChevronDown, ChevronRight, Eye, EyeOff } from 'lucide-react';
import { toast } from 'sonner';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useAgencySettings } from '@/hooks/useAgencySettings';

const API_ENDPOINT = 'https://jgwwmtuvjlmzapwqiabu.supabase.co/functions/v1/external-data-api';
const HERMES_ENDPOINT = 'https://jgwwmtuvjlmzapwqiabu.functions.supabase.co/hermes-orchestrator';
const PASSWORD = 'HPA1234$';

interface ApiCall {
  title: string;
  description: string;
  body: Record<string, unknown>;
  endpoint?: string;
  headers?: Record<string, string>;
}

interface ApiSection {
  title: string;
  badge?: string;
  badgeVariant?: 'default' | 'secondary' | 'destructive' | 'outline';
  calls: ApiCall[];
}

const API_SECTIONS: ApiSection[] = [
  {
    title: '🔍 Discovery',
    calls: [
      {
        title: 'List All Tables & Actions',
        description: 'Returns all allowed tables, buckets, relations, and composite action schemas.',
        body: { password: PASSWORD, action: 'list_tables' },
      },
    ],
  },
  {
    title: '📋 Read Data (SELECT)',
    calls: [
      {
        title: 'Select All Clients',
        description: 'Fetch all clients with basic info.',
        body: { password: PASSWORD, action: 'select', table: 'clients', limit: 100 },
      },
      {
        title: 'Select Leads (Filtered)',
        description: 'Fetch leads for a specific client with date filter.',
        body: {
          password: PASSWORD, action: 'select', table: 'leads',
          filters: { client_id: '<CLIENT_UUID>', created_at: { op: 'gte', value: '2026-01-01' } },
          order_by: 'created_at', order_dir: 'desc', limit: 50,
        },
      },
      {
        title: 'Select Calls with Filters',
        description: 'Fetch calls that showed, ordered by date.',
        body: {
          password: PASSWORD, action: 'select', table: 'calls',
          filters: { client_id: '<CLIENT_UUID>', showed: true },
          order_by: 'booked_at', order_dir: 'desc', limit: 50,
        },
      },
      {
        title: 'Select Funded Investors',
        description: 'Get funded investors for a client.',
        body: {
          password: PASSWORD, action: 'select', table: 'funded_investors',
          filters: { client_id: '<CLIENT_UUID>' },
          order_by: 'funded_at', order_dir: 'desc',
        },
      },
      {
        title: 'Select Daily Metrics',
        description: 'Get daily performance metrics for a client.',
        body: {
          password: PASSWORD, action: 'select', table: 'daily_metrics',
          filters: { client_id: '<CLIENT_UUID>', date: { op: 'gte', value: '2026-01-01' } },
          order_by: 'date', order_dir: 'desc',
        },
      },
      {
        title: 'Select Agency Members',
        description: 'List all team members with their pod info.',
        body: {
          password: PASSWORD, action: 'select', table: 'agency_members',
          include: ['pod'],
        },
      },
      {
        title: 'Count Records',
        description: 'Count leads for a specific client.',
        body: {
          password: PASSWORD, action: 'count', table: 'leads',
          filters: { client_id: '<CLIENT_UUID>' },
        },
      },
    ],
  },
  {
    title: '✅ Tasks (Full CRUD)',
    badge: 'Composite',
    calls: [
      {
        title: 'Create Task (with Assignees, Subtasks, Comments)',
        description: 'One-call task creation with full metadata.',
        body: {
          password: PASSWORD, action: 'create_task',
          task: {
            title: 'Launch Campaign',
            description: 'Full launch preparation',
            client_id: '<CLIENT_UUID>',
            priority: 'high',
            stage: 'backlog',
            status: 'todo',
            due_date: '2026-03-01',
            recurrence_type: 'weekly',
            recurrence_interval: 1,
            created_by: 'api',
          },
          assignees: [
            { member_id: '<MEMBER_UUID>' },
            { pod_id: '<POD_UUID>' },
          ],
          subtasks: [
            { title: 'Design assets', priority: 'medium', due_date: '2026-02-25' },
            { title: 'Write copy' },
          ],
          comments: [
            { author_name: 'PM', content: 'Kick-off notes', comment_type: 'text' },
          ],
        },
      },
      {
        title: 'Select Tasks (with Relations)',
        description: 'Get tasks with subtasks, assignees, comments, files, history.',
        body: {
          password: PASSWORD, action: 'select', table: 'tasks',
          filters: { status: 'todo' },
          include: ['assignees', 'subtasks', 'comments', 'files', 'history', 'notifications'],
          order_by: 'created_at', order_dir: 'desc', limit: 50,
        },
      },
      {
        title: 'Update Task',
        description: 'Update status, priority, or any field.',
        body: {
          password: PASSWORD, action: 'update', table: 'tasks',
          match: { id: '<TASK_UUID>' },
          data: { status: 'done', completed_at: '2026-02-20T00:00:00Z' },
        },
      },
      {
        title: 'Delete Task',
        description: 'Delete a task by ID.',
        body: {
          password: PASSWORD, action: 'delete', table: 'tasks',
          match: { id: '<TASK_UUID>' },
        },
      },
      {
        title: 'Add Comment to Task',
        description: 'Insert a comment on an existing task.',
        body: {
          password: PASSWORD, action: 'insert', table: 'task_comments',
          data: { task_id: '<TASK_UUID>', author_name: 'API', content: 'Status update', comment_type: 'text' },
        },
      },
      {
        title: 'Add Assignee to Task',
        description: 'Assign a member or pod to a task.',
        body: {
          password: PASSWORD, action: 'insert', table: 'task_assignees',
          data: { task_id: '<TASK_UUID>', member_id: '<MEMBER_UUID>' },
        },
      },
    ],
  },
  {
    title: '📊 Meta Ads',
    badge: 'Composite',
    calls: [
      {
        title: 'Get Ads Overview (Campaigns → Ad Sets → Ads)',
        description: 'Full Meta ads hierarchy with aggregated spend & attribution metrics.',
        body: {
          password: PASSWORD, action: 'get_ads_overview',
          client_id: '<CLIENT_UUID>',
          status: 'ACTIVE',
          date_start: '2026-01-01',
          date_end: '2026-02-20',
        },
      },
      {
        title: 'Select Campaigns',
        description: 'List campaigns with nested ad sets.',
        body: {
          password: PASSWORD, action: 'select', table: 'meta_campaigns',
          filters: { client_id: '<CLIENT_UUID>' },
          include: ['ad_sets', 'client'],
          order_by: 'spend', order_dir: 'desc',
        },
      },
      {
        title: 'Select Ad Sets',
        description: 'List ad sets with nested ads.',
        body: {
          password: PASSWORD, action: 'select', table: 'meta_ad_sets',
          filters: { client_id: '<CLIENT_UUID>' },
          include: ['ads', 'campaign'],
        },
      },
      {
        title: 'Select Individual Ads',
        description: 'List ads with ad set and client info.',
        body: {
          password: PASSWORD, action: 'select', table: 'meta_ads',
          filters: { client_id: '<CLIENT_UUID>' },
          include: ['ad_set', 'client'],
        },
      },
    ],
  },
  {
    title: '✏️ Write Data',
    calls: [
      {
        title: 'Insert Record',
        description: 'Insert a lead into the database.',
        body: {
          password: PASSWORD, action: 'insert', table: 'leads',
          data: { client_id: '<CLIENT_UUID>', name: 'John Doe', email: 'john@example.com', source: 'facebook' },
        },
      },
      {
        title: 'Upsert Record',
        description: 'Insert or update daily metrics (matched by unique constraints).',
        body: {
          password: PASSWORD, action: 'upsert', table: 'daily_metrics',
          data: { client_id: '<CLIENT_UUID>', date: '2026-02-20', leads: 5, ad_spend: 250 },
        },
      },
      {
        title: 'Update Record',
        description: 'Update a specific record by match criteria.',
        body: {
          password: PASSWORD, action: 'update', table: 'clients',
          match: { id: '<CLIENT_UUID>' },
          data: { status: 'active', description: 'Updated via API' },
        },
      },
      {
        title: 'Delete Record',
        description: 'Delete a specific record.',
        body: {
          password: PASSWORD, action: 'delete', table: 'leads',
          match: { id: '<LEAD_UUID>' },
        },
      },
    ],
  },
  {
    title: '🗂️ Pipelines & Opportunities',
    calls: [
      {
        title: 'Select Pipelines with Stages',
        description: 'Get client pipelines with stage info.',
        body: {
          password: PASSWORD, action: 'select', table: 'client_pipelines',
          filters: { client_id: '<CLIENT_UUID>' },
          include: ['stages'],
        },
      },
      {
        title: 'Select Opportunities with Stage',
        description: 'Get pipeline opportunities.',
        body: {
          password: PASSWORD, action: 'select', table: 'pipeline_opportunities',
          include: ['stage'],
          order_by: 'updated_at', order_dir: 'desc',
        },
      },
    ],
  },
  {
    title: '🎨 Creatives',
    calls: [
      {
        title: 'Select Creatives',
        description: 'Get creatives with client info.',
        body: {
          password: PASSWORD, action: 'select', table: 'creatives',
          filters: { client_id: '<CLIENT_UUID>' },
          include: ['client'],
          order_by: 'created_at', order_dir: 'desc',
        },
      },
    ],
  },
  {
    title: '📁 Storage',
    calls: [
      {
        title: 'List Files in Bucket',
        description: 'List files in a storage bucket (creatives, task-files, gpt-files, live-ads).',
        body: {
          password: PASSWORD, action: 'list_storage',
          bucket: 'creatives', file_path: '', limit: 100,
        },
      },
      {
        title: 'Get File URL',
        description: 'Get the public URL for a file.',
        body: {
          password: PASSWORD, action: 'get_file_url',
          bucket: 'task-files', file_path: 'path/to/file.pdf',
        },
      },
      {
        title: 'Upload File (Base64)',
        description: 'Upload a file using base64 encoded data.',
        body: {
          password: PASSWORD, action: 'upload_file_base64',
          bucket: 'creatives', file_path: 'client/image.png',
          data: '<BASE64_STRING>', content_type: 'image/png',
        },
      },
      {
        title: 'Delete File',
        description: 'Delete a file from storage.',
        body: {
          password: PASSWORD, action: 'delete_file',
          bucket: 'creatives', file_path: 'client/old-image.png',
        },
      },
    ],
  },
  {
    title: '👥 Team & Pods',
    calls: [
      {
        title: 'Select Agency Members',
        description: 'Get team members with pod assignments.',
        body: {
          password: PASSWORD, action: 'select', table: 'agency_members',
          include: ['pod'],
        },
      },
      {
        title: 'Select Pods',
        description: 'List all agency pods.',
        body: { password: PASSWORD, action: 'select', table: 'agency_pods' },
      },
      {
        title: 'Select Meetings',
        description: 'Get agency meetings.',
        body: {
          password: PASSWORD, action: 'select', table: 'agency_meetings',
          order_by: 'meeting_date', order_dir: 'desc', limit: 20,
        },
      },
    ],
  },
];

// Hermes Orchestrator — separate endpoint, Bearer-token auth
const HERMES_HEADERS = {
  'Authorization': 'Bearer <HERMES_API_KEY>',
  'Content-Type': 'application/json',
};

const HERMES_SECTION: ApiSection = {
  title: '🪽 Hermes Orchestrator',
  badge: 'External AI Bridge',
  badgeVariant: 'secondary',
  calls: [
    {
      title: 'Ping (health check)',
      description: 'Verify the orchestrator is reachable and the API key is valid.',
      endpoint: HERMES_ENDPOINT,
      headers: HERMES_HEADERS,
      body: { action: 'ping' },
    },
    {
      title: 'List Clients',
      description: 'Returns active / onboarding / paused clients with id, name, slug.',
      endpoint: HERMES_ENDPOINT,
      headers: HERMES_HEADERS,
      body: { action: 'list_clients' },
    },
    {
      title: 'Create Task (auto-route)',
      description: 'Creates a Hermes task and auto-routes to the matching agent (video / static_ad / copy / research). Opens the "🤖 Hermes Orchestrator" channel in AI Studio.',
      endpoint: HERMES_ENDPOINT,
      headers: HERMES_HEADERS,
      body: {
        action: 'create_task',
        client_id: '<CLIENT_UUID>',
        task_type: 'video',
        hermes_external_id: '<HERMES_TASK_ID>',
        title: 'New VSL for fund X',
        brief: 'Hook on inflation, 45s, vertical, narrator avatar.',
        callback_url: 'https://hermes.example.com/webhooks/lovable',
      },
    },
    {
      title: 'Complete Task',
      description: 'Manually mark a task complete and deliver assets to the Hermes channel. Idempotent — repeat calls return { ok:true, already_delivered:true }.',
      endpoint: HERMES_ENDPOINT,
      headers: HERMES_HEADERS,
      body: {
        action: 'complete_task',
        task_id: '<TASK_UUID>',
        status: 'completed',
        assets: [{ type: 'video', url: 'https://...', poster_url: 'https://...', duration: 45 }],
      },
    },
    {
      title: 'Post Message',
      description: 'Free-form message into the client\'s Hermes channel in AI Studio.',
      endpoint: HERMES_ENDPOINT,
      headers: HERMES_HEADERS,
      body: {
        action: 'post_message',
        client_id: '<CLIENT_UUID>',
        message: 'Hermes here — kicking off 3 new creative tests today.',
      },
    },
    {
      title: 'Get Task',
      description: 'Fetch current status + linked assets for a task.',
      endpoint: HERMES_ENDPOINT,
      headers: HERMES_HEADERS,
      body: { action: 'get_task', task_id: '<TASK_UUID>' },
    },
    {
      title: 'List Tasks (per client)',
      description: 'List tasks for a client, optionally filtered by status.',
      endpoint: HERMES_ENDPOINT,
      headers: HERMES_HEADERS,
      body: { action: 'list_tasks', client_id: '<CLIENT_UUID>', status: 'in_progress', limit: 50 },
    },
    {
      title: 'Callback Webhook Payload (FYI)',
      description: 'Shape of the task.completed event the platform POSTs to your callback_url when work finishes.',
      endpoint: '<YOUR_CALLBACK_URL>',
      headers: { 'Content-Type': 'application/json' },
      body: {
        event: 'task.completed',
        task_id: '<TASK_UUID>',
        hermes_external_id: '<HERMES_TASK_ID>',
        client_id: '<CLIENT_UUID>',
        task_type: 'video',
        status: 'completed',
        assets: [{ type: 'video', url: 'https://...', poster_url: 'https://...', duration: 45 }],
        error_message: null,
      },
    },
  ],
};

API_SECTIONS.push(HERMES_SECTION);

function CopyBlock({ json }: { json: Record<string, unknown> }) {
  const [copied, setCopied] = useState(false);
  const text = JSON.stringify(json, null, 2);

  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    toast.success('Copied to clipboard');
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative group">
      <pre className="bg-muted border border-border rounded-md p-3 text-xs font-mono overflow-x-auto max-h-64 overflow-y-auto">
        {text}
      </pre>
      <Button
        variant="outline"
        size="icon"
        className="absolute top-2 right-2 h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
        onClick={handleCopy}
      >
        {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      </Button>
    </div>
  );
}

function ApiCallCard({ call }: { call: ApiCall }) {
  const [open, setOpen] = useState(false);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex items-center gap-2 w-full text-left py-2 px-3 hover:bg-muted/50 rounded-md transition-colors">
        {open ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
        <div className="min-w-0">
          <span className="font-medium text-sm">{call.title}</span>
          <span className="text-xs text-muted-foreground ml-2">{call.description}</span>
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent className="pl-9 pr-3 pb-2 space-y-2">
        {call.endpoint && (
          <div className="text-[11px] font-mono bg-muted/50 border border-border rounded px-2 py-1 break-all">
            POST {call.endpoint}
          </div>
        )}
        {call.headers && (
          <div className="text-[11px] font-mono bg-muted/50 border border-border rounded px-2 py-1 space-y-0.5">
            {Object.entries(call.headers).map(([k, v]) => (
              <div key={k}><span className="text-muted-foreground">{k}:</span> {v}</div>
            ))}
          </div>
        )}
        <CopyBlock json={call.body} />
      </CollapsibleContent>
    </Collapsible>
  );
}

export function ApiReferenceTab() {
  const [copiedEndpoint, setCopiedEndpoint] = useState(false);
  const [copiedAll, setCopiedAll] = useState(false);
  const [showHermesKey, setShowHermesKey] = useState(false);
  const [copiedHermesKey, setCopiedHermesKey] = useState(false);
  const [copiedHermesUrl, setCopiedHermesUrl] = useState(false);
  const { data: agencySettings } = useAgencySettings();
  const hermesApiKey = (agencySettings as any)?.hermes_api_key || '';
  const hermesCallbackUrl = (agencySettings as any)?.hermes_callback_url || '';
  const hermesEnabled = Boolean((agencySettings as any)?.hermes_enabled);
  const hermesKeyDisplay = hermesApiKey
    ? (showHermesKey ? hermesApiKey : `${hermesApiKey.slice(0, 10)}${'•'.repeat(Math.max(0, hermesApiKey.length - 14))}${hermesApiKey.slice(-4)}`)
    : '<not configured — generate in Settings → Hermes Integration>';

  const handleCopyEndpoint = () => {
    navigator.clipboard.writeText(API_ENDPOINT);
    setCopiedEndpoint(true);
    toast.success('Endpoint copied');
    setTimeout(() => setCopiedEndpoint(false), 2000);
  };

  const handleCopyAll = async () => {
    // Fetch live client data from the database
    let clientDirectory = '';
    try {
      const { supabase } = await import('@/integrations/supabase/client');
      
      const [clientsRes, settingsRes, funnelsRes] = await Promise.all([
        supabase.from('clients').select('id, name, ghl_api_key, ghl_location_id, ghl_account_url, website_url, business_manager_url, meta_ad_account_id, meta_ad_account_ids, status, slug').order('name'),
        supabase.from('client_settings').select('client_id, funded_pipeline_id, ads_library_url, tracked_calendar_ids, reconnect_calendar_ids'),
        supabase.from('client_funnel_steps').select('client_id, name, url, sort_order').order('client_id').order('sort_order'),
      ]);

      const clients = clientsRes.data || [];
      const settings = settingsRes.data || [];
      const funnels = funnelsRes.data || [];

      const settingsMap = Object.fromEntries(settings.map(s => [s.client_id, s]));
      const funnelMap: Record<string, typeof funnels> = {};
      for (const f of funnels) {
        if (!funnelMap[f.client_id]) funnelMap[f.client_id] = [];
        funnelMap[f.client_id].push(f);
      }

      const dirLines: string[] = [];
      dirLines.push('## Client Directory (Master Admin)');
      dirLines.push('');

      for (const c of clients) {
        const s = settingsMap[c.id];
        dirLines.push(`### ${c.name} [${c.status}]`);
        dirLines.push(`- Client ID: ${c.id}`);
        if (c.slug) dirLines.push(`- Slug: ${c.slug}`);
        if (c.ghl_location_id) dirLines.push(`- GHL Location ID: ${c.ghl_location_id}`);
        if (c.ghl_api_key) dirLines.push(`- GHL Private API Key: ${c.ghl_api_key}`);
        if ((c as any).ghl_account_url) dirLines.push(`- GHL Account URL: ${(c as any).ghl_account_url}`);
        {
          const ids = [c.meta_ad_account_id, ...(((c as any).meta_ad_account_ids as string[] | null) || [])].filter(Boolean);
          if (ids.length) dirLines.push(`- Meta Ad Account IDs: ${ids.join(', ')}`);
        }
        if (c.business_manager_url) dirLines.push(`- Ads Manager: ${c.business_manager_url}`);
        if (c.website_url) dirLines.push(`- Website: ${c.website_url}`);
        if (s?.ads_library_url) dirLines.push(`- Ads Library: ${s.ads_library_url}`);
        if (s?.funded_pipeline_id) dirLines.push(`- Funded Pipeline ID: ${s.funded_pipeline_id}`);
        if (s?.tracked_calendar_ids?.length) dirLines.push(`- Tracked Calendar IDs: ${s.tracked_calendar_ids.join(', ')}`);
        if (s?.reconnect_calendar_ids?.length) dirLines.push(`- Reconnect Calendar IDs: ${s.reconnect_calendar_ids.join(', ')}`);
        
        const clientFunnels = funnelMap[c.id];
        if (clientFunnels?.length) {
          dirLines.push(`- Funnel Pages:`);
          for (const f of clientFunnels) {
            dirLines.push(`  - ${f.name}: ${f.url}`);
          }
        }
        dirLines.push('');
      }
      
      clientDirectory = dirLines.join('\n');
    } catch (err) {
      console.error('Failed to fetch client data for copy:', err);
      clientDirectory = '## Client Directory\n(Failed to load — try again)\n';
    }

    const lines: string[] = [];
    lines.push('# OpenClaw / Jarvis API Reference');
    lines.push('');
    lines.push(`## Endpoint`);
    lines.push(`POST ${API_ENDPOINT}`);
    lines.push('');
    lines.push(`## Authentication`);
    lines.push(`Password: ${PASSWORD}`);
    lines.push('All requests are POST with JSON body. Every request must include the "password" field.');
    lines.push('');
    lines.push('## Filter Operators');
    lines.push('eq (default), gt, gte, lt, lte, neq, like, ilike, in, is');
    lines.push('Usage: {"field": {"op": "gte", "value": "2026-01-01"}}');
    lines.push('');

    // Client directory first so OpenClaw knows all clients
    lines.push(clientDirectory);

    for (const section of API_SECTIONS) {
      lines.push(`## ${section.title}${section.badge ? ` [${section.badge}]` : ''}`);
      lines.push('');
      for (const call of section.calls) {
        lines.push(`### ${call.title}`);
        lines.push(call.description);
        if (call.endpoint) lines.push(`POST ${call.endpoint}`);
        if (call.headers) {
          for (const [k, v] of Object.entries(call.headers)) {
            lines.push(`${k}: ${v}`);
          }
        }
        lines.push('```json');
        lines.push(JSON.stringify(call.body, null, 2));
        lines.push('```');
        lines.push('');
      }
    }

    lines.push('## Hermes Orchestrator Notes');
    lines.push(`Base URL: ${HERMES_ENDPOINT}`);
    lines.push(`Status: ${hermesEnabled ? 'ACTIVE' : 'DISABLED (toggle on in Agency Settings → Hermes Integration)'}`);
    lines.push(`Auth Header: Authorization: Bearer ${hermesApiKey || '<HERMES_API_KEY — generate in Agency Settings → Hermes Integration>'}`);
    lines.push(`Content-Type: application/json`);
    if (hermesCallbackUrl) lines.push(`Default Callback URL: ${hermesCallbackUrl}`);
    lines.push('Endpoints (POST {Base URL}/{action}):');
    lines.push('  • Core: ping, list_clients, post_message');
    lines.push('  • Tasks: create_task, get_task, list_tasks, update_task, cancel_task, assign_task, complete_task');
    lines.push('  • Agents: list_agents, get_agent, create_agent, update_agent, delete_agent, toggle_agent');
    lines.push('  • Generation: generate_copy, generate_video, generate_image, generate_static_ad, generate_brief');
    lines.push('Task types auto-route by agent_type: video → video/creative/content, static_ad → image/creative/static_ad, copy → copy/content/writing, research → research/analyst.');
    lines.push('complete_task is idempotent (delivered_at row-lock). Video tasks auto-complete via the platform.');
    lines.push('Generation actions create a hermes_task, invoke the matching internal pipeline (generate-asset / generate-video-from-image / generate-static-ad / generate-brief), upload assets, and POST a task.completed callback automatically.');
    lines.push('If callback_url is omitted in create_task, the default from Agency Settings is used.');
    lines.push('');

    lines.push('## All Available Tables');
    lines.push([
      'clients', 'leads', 'calls', 'funded_investors', 'daily_metrics',
      'agency_members', 'agency_pods', 'agency_settings', 'agency_meetings',
      'tasks', 'task_comments', 'task_files', 'task_history', 'task_assignees', 'task_notifications',
      'creatives', 'client_settings', 'client_pipelines', 'client_custom_tabs',
      'client_funnel_steps', 'client_live_ads', 'client_pod_assignments', 'client_voice_notes',
      'pipeline_stages', 'pipeline_opportunities', 'funnel_campaigns', 'funnel_step_variants',
      'ad_spend_reports', 'alert_configs', 'chat_conversations', 'chat_messages',
      'ai_hub_conversations', 'ai_hub_messages', 'custom_gpts', 'gpt_files',
      'gpt_knowledge_base', 'knowledge_base_documents', 'csv_import_logs',
      'contact_timeline_events', 'data_discrepancies', 'sync_logs', 'sync_queue',
      'sync_outbound_events', 'pixel_verifications', 'pixel_expected_events',
      'email_parsed_investors', 'pending_meeting_tasks', 'member_activity_log',
      'dashboard_preferences', 'spam_blacklist', 'webhook_logs',
      'meta_campaigns', 'meta_ad_sets', 'meta_ads',
    ].join(', '));
    lines.push('');
    lines.push('## Storage Buckets');
    lines.push('creatives, task-files, gpt-files, live-ads');
    lines.push('');
    lines.push('## Available Actions');
    lines.push('list_tables, select, count, insert, upsert, update, delete, create_task, get_ads_overview, list_storage, get_file_url, delete_file, upload_file_base64');

    navigator.clipboard.writeText(lines.join('\n'));
    setCopiedAll(true);
    toast.success('Full API reference copied to clipboard');
    setTimeout(() => setCopiedAll(false), 3000);
  };

  return (
    <div className="space-y-4">
      {/* Copy All Banner */}
      <div className="flex items-center justify-between border-2 border-primary/30 bg-primary/5 rounded-md p-3">
        <div>
          <h4 className="font-medium text-sm">Full API Documentation</h4>
          <p className="text-xs text-muted-foreground">Copy the entire API reference to paste into OpenClaw</p>
        </div>
        <Button variant="default" size="sm" onClick={handleCopyAll} className="shrink-0">
          {copiedAll ? <Check className="h-4 w-4 mr-1" /> : <Copy className="h-4 w-4 mr-1" />}
          {copiedAll ? 'Copied!' : 'Copy All'}
        </Button>
      </div>

      {/* Endpoint */}
      <div className="border-2 border-border p-4 space-y-2">
        <h4 className="font-medium text-sm">API Endpoint</h4>
        <p className="text-xs text-muted-foreground">All requests are POST with JSON body. Every request must include the password field.</p>
        <div className="flex gap-2 items-center">
          <code className="bg-muted border border-border rounded px-2 py-1 text-xs font-mono flex-1 truncate">
            POST {API_ENDPOINT}
          </code>
          <Button variant="outline" size="icon" className="h-7 w-7 shrink-0" onClick={handleCopyEndpoint}>
            {copiedEndpoint ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          </Button>
        </div>
      </div>

      {/* Filter Operators Reference */}
      <div className="border border-border p-3 rounded-md bg-muted/30">
        <h4 className="font-medium text-xs mb-1">Filter Operators</h4>
        <div className="flex flex-wrap gap-1">
          {['eq (default)', 'gt', 'gte', 'lt', 'lte', 'neq', 'like', 'ilike', 'in', 'is'].map(op => (
            <Badge key={op} variant="outline" className="text-[10px] font-mono">{op}</Badge>
          ))}
        </div>
        <p className="text-[10px] text-muted-foreground mt-1">
          Usage: <code className="bg-muted px-1 rounded">{'{"field": {"op": "gte", "value": "2026-01-01"}}'}</code>
        </p>
      </div>

      {/* Sections */}
      {/* Hermes Connection */}
      <div className="border-2 border-primary/30 bg-primary/5 rounded-md p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="font-medium text-sm flex items-center gap-2">
            🪽 Hermes Orchestrator Connection
            <Badge variant={hermesEnabled ? 'default' : 'secondary'} className="text-[10px]">
              {hermesEnabled ? 'Active' : 'Disabled'}
            </Badge>
          </h4>
        </div>
        <p className="text-xs text-muted-foreground">
          Everything Hermes needs to talk to this platform. Paste these into the Hermes master agent.
        </p>

        <div className="space-y-2">
          <div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Base URL</div>
            <div className="flex gap-2 items-center">
              <code className="bg-muted border border-border rounded px-2 py-1 text-xs font-mono flex-1 truncate">
                {HERMES_ENDPOINT}
              </code>
              <Button variant="outline" size="icon" className="h-7 w-7 shrink-0" onClick={() => {
                navigator.clipboard.writeText(HERMES_ENDPOINT);
                setCopiedHermesUrl(true);
                toast.success('Hermes URL copied');
                setTimeout(() => setCopiedHermesUrl(false), 2000);
              }}>
                {copiedHermesUrl ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">All requests: <code>POST {'{Base URL}'}/{'{action}'}</code></p>
          </div>

          <div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">API Key (Bearer token)</div>
            <div className="flex gap-2 items-center">
              <code className="bg-muted border border-border rounded px-2 py-1 text-xs font-mono flex-1 truncate">
                {hermesKeyDisplay}
              </code>
              {hermesApiKey && (
                <>
                  <Button variant="outline" size="icon" className="h-7 w-7 shrink-0" onClick={() => setShowHermesKey(v => !v)}>
                    {showHermesKey ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                  </Button>
                  <Button variant="outline" size="icon" className="h-7 w-7 shrink-0" onClick={() => {
                    navigator.clipboard.writeText(hermesApiKey);
                    setCopiedHermesKey(true);
                    toast.success('Hermes API key copied');
                    setTimeout(() => setCopiedHermesKey(false), 2000);
                  }}>
                    {copiedHermesKey ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                  </Button>
                </>
              )}
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">
              Send as <code>Authorization: Bearer {hermesApiKey ? '<key above>' : '<HERMES_API_KEY>'}</code>
              {!hermesApiKey && ' — generate one in Settings → Hermes Integration.'}
            </p>
          </div>

          <div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Default Callback URL</div>
            <code className="bg-muted border border-border rounded px-2 py-1 text-xs font-mono block truncate">
              {hermesCallbackUrl || '<not set — Hermes must pass callback_url per task>'}
            </code>
          </div>

          <div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Available Actions</div>
            <div className="flex flex-wrap gap-1">
              {['ping', 'list_clients', 'create_task', 'complete_task', 'post_message', 'get_task', 'list_tasks'].map(a => (
                <Badge key={a} variant="outline" className="text-[10px] font-mono">{a}</Badge>
              ))}
            </div>
          </div>

          <div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Task Type Routing</div>
            <ul className="text-[11px] text-muted-foreground space-y-0.5 font-mono pl-3">
              <li>video → video / creative / content</li>
              <li>static_ad → image / creative / static_ad</li>
              <li>copy → copy / content / writing</li>
              <li>research → research / analyst</li>
            </ul>
          </div>
        </div>
      </div>

      {API_SECTIONS.map((section) => (
        <div key={section.title} className="border-2 border-border rounded-md">
          <div className="px-4 py-2 border-b border-border bg-muted/30 flex items-center gap-2">
            <h4 className="font-medium text-sm">{section.title}</h4>
            {section.badge && <Badge variant="secondary" className="text-[10px]">{section.badge}</Badge>}
          </div>
          <div className="divide-y divide-border/50">
            {section.calls.map((call) => (
              <ApiCallCard key={call.title} call={call} />
            ))}
          </div>
        </div>
      ))}

      {/* Available Tables */}
      <div className="border border-border p-3 rounded-md bg-muted/30">
        <h4 className="font-medium text-xs mb-2">All Available Tables</h4>
        <div className="flex flex-wrap gap-1">
          {[
            'clients', 'leads', 'calls', 'funded_investors', 'daily_metrics',
            'agency_members', 'agency_pods', 'agency_settings', 'agency_meetings',
            'tasks', 'task_comments', 'task_files', 'task_history', 'task_assignees', 'task_notifications',
            'creatives', 'client_settings', 'client_pipelines', 'client_custom_tabs',
            'client_funnel_steps', 'client_live_ads', 'client_pod_assignments', 'client_voice_notes',
            'pipeline_stages', 'pipeline_opportunities', 'funnel_campaigns', 'funnel_step_variants',
            'ad_spend_reports', 'alert_configs', 'chat_conversations', 'chat_messages',
            'ai_hub_conversations', 'ai_hub_messages', 'custom_gpts', 'gpt_files',
            'gpt_knowledge_base', 'knowledge_base_documents', 'csv_import_logs',
            'contact_timeline_events', 'data_discrepancies', 'sync_logs', 'sync_queue',
            'sync_outbound_events', 'pixel_verifications', 'pixel_expected_events',
            'email_parsed_investors', 'pending_meeting_tasks', 'member_activity_log',
            'dashboard_preferences', 'spam_blacklist', 'webhook_logs',
            'meta_campaigns', 'meta_ad_sets', 'meta_ads',
          ].map(t => (
            <Badge key={t} variant="outline" className="text-[10px] font-mono">{t}</Badge>
          ))}
        </div>
      </div>

      {/* Storage Buckets */}
      <div className="border border-border p-3 rounded-md bg-muted/30">
        <h4 className="font-medium text-xs mb-2">Storage Buckets</h4>
        <div className="flex flex-wrap gap-1">
          {['creatives', 'task-files', 'gpt-files', 'live-ads'].map(b => (
            <Badge key={b} variant="secondary" className="text-[10px] font-mono">{b}</Badge>
          ))}
        </div>
      </div>
    </div>
  );
}
