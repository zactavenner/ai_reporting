import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, accept, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

// Simple JSON-RPC MCP server implementation
// Compatible with Claude Code Desktop via Streamable HTTP transport

function getCloudDb() {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
}

function getProdDb() {
  const prodUrl = Deno.env.get('ORIGINAL_SUPABASE_URL') || Deno.env.get('SUPABASE_URL')!;
  const prodKey = Deno.env.get('ORIGINAL_SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  return createClient(prodUrl, prodKey);
}

const META_TOOL_PREFIX = 'meta_';

// ─────────────────────────────────────────────────────────────────────────────
// API / Hermes parity instructions — served in the MCP `initialize` response so
// every new MCP client (Claude Desktop, Cursor, ChatGPT, Codex, custom agents)
// receives the full external-data-api usage guide on first connect.
// Keep in sync with supabase/functions/external-data-api/index.ts.
// ─────────────────────────────────────────────────────────────────────────────
const API_INSTRUCTIONS = `HPA MCP server — full parity with the internal external-data-api ("Hermes API").

You can:
1. Manage AI agents (list_agents, get_agent, create_agent, update_agent, run_agent, get_agent_runs).
2. Read & write Meta Ads (meta_list_campaigns / _adsets / _ads / _get_ad_performance, and WRITE tools meta_toggle_status, meta_update_budget, meta_duplicate, meta_create_campaign, meta_create_ad, meta_sync_account).
3. Generic table CRUD via db_* tools — same allow-list, filters, relations, and composites as external-data-api.
4. Storage ops via storage_* tools on the same allowed buckets.
5. Composite operations: create_task_composite (task + assignees + subtasks + comments in one call), get_ads_overview (full Meta hierarchy + totals for a client).

ALLOWED TABLES (db_* tools):
clients, leads, calls, funded_investors, daily_metrics, agency_members, agency_pods,
agency_settings, agency_meetings, tasks, task_comments, task_files, task_history,
task_assignees, task_notifications, creatives, client_settings, client_pipelines,
client_custom_tabs, client_funnel_steps, client_live_ads, client_pod_assignments,
client_voice_notes, client_offers, pipeline_stages, pipeline_opportunities,
funnel_campaigns, funnel_step_variants, ad_spend_reports, alert_configs,
chat_conversations, chat_messages, ai_hub_conversations, ai_hub_messages,
custom_gpts, gpt_files, gpt_knowledge_base, knowledge_base_documents,
csv_import_logs, contact_timeline_events, data_discrepancies, sync_logs,
sync_queue, sync_outbound_events, pixel_verifications, pixel_expected_events,
email_parsed_investors, pending_meeting_tasks, member_activity_log,
dashboard_preferences, spam_blacklist, webhook_logs,
meta_campaigns, meta_ad_sets, meta_ads.

ALLOWED STORAGE BUCKETS (storage_* tools):
creatives, task-files, gpt-files, live-ads, client-offers.

FILTERS (db_select): pass a JSON object mapped column -> value. Supported forms:
  { col: "value" }                              → equality
  { col: null }                                 → IS NULL
  { col: ["a","b"] }                            → IN (...)
  { col: { op: "gt|gte|lt|lte|neq|like|ilike|in|is", value: X } }
  { col: { "$gte": "2025-01-01" } }             → Mongo-style shorthand

RELATIONS (db_select include): pass an array of relation keys per table, e.g.
  { table: "tasks", include: ["subtasks","assignees","comments","files","history","notifications"] }
  { table: "meta_campaigns", include: ["ad_sets","client"] }
  { table: "meta_ad_sets", include: ["ads","campaign","client"] }
  { table: "meta_ads", include: ["ad_set","client"] }
  { table: "pipeline_opportunities", include: ["stage"] }
  { table: "client_pipelines", include: ["stages"] }
  { table: "agency_members", include: ["pod"] }
  { table: "task_assignees", include: ["member","pod"] }
  { table: "client_offers", include: ["client"] }

COMPOSITE ACTIONS:
  create_task_composite — { task:{title,description?,client_id?,priority?,stage?,status?,due_date?,recurrence_type?,recurrence_interval?,created_by?},
                            assignees?:[{member_id?,pod_id?}], subtasks?:[{title,...}], comments?:[{author_name,content,comment_type?}] }
  get_ads_overview — { client_id, status?, date_start?, date_end? } returns campaigns→ad_sets→ads with computed totals.

WRITES require user confirmation. Always dry-run reads first, then propose the exact write payload before invoking meta_* WRITE tools, db_insert/db_update/db_upsert/db_delete, storage_delete, or storage_upload_base64.

Client scoping: always pass client_id when a tool accepts it. When a user references a client by name, resolve via list_clients or db_select on the clients table before acting.
`;

async function logMetaToolCall(entry: {
  tool_name: string;
  args: Record<string, any>;
  response: any;
  success: boolean;
  error?: string | null;
  duration_ms: number;
  source?: string;
}) {
  if (!entry.tool_name?.startsWith(META_TOOL_PREFIX)) return;
  try {
    const db = getCloudDb();
    const clientId =
      typeof entry.args?.client_id === 'string' && entry.args.client_id.length === 36
        ? entry.args.client_id
        : null;
    // Truncate response payload to keep row size sane
    let responseJson: any = entry.response;
    try {
      const str = JSON.stringify(responseJson);
      if (str && str.length > 200_000) {
        responseJson = { truncated: true, preview: str.slice(0, 200_000) };
      }
    } catch {
      responseJson = { unserializable: true };
    }
    await db.from('meta_mcp_tool_calls').insert({
      client_id: clientId,
      tool_name: entry.tool_name,
      arguments: entry.args ?? {},
      response: entry.success ? responseJson : null,
      success: entry.success,
      error: entry.error ?? null,
      duration_ms: Math.round(entry.duration_ms),
      source: entry.source ?? 'mcp-agent-server',
    });
  } catch (e) {
    console.error('[meta-mcp-log] failed to write log row', e);
  }
}

const TOOLS = [
  {
    name: 'list_agents',
    description: 'List all configured AI agents with their status, schedule, and connectors',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_agent',
    description: 'Get detailed configuration for a specific agent by ID',
    inputSchema: {
      type: 'object',
      properties: { agent_id: { type: 'string', description: 'The agent UUID' } },
      required: ['agent_id'],
    },
  },
  {
    name: 'run_agent',
    description: 'Trigger an agent to run immediately. Optionally specify a client_id to scope to one client.',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string', description: 'The agent UUID to run' },
        client_id: { type: 'string', description: 'Optional: specific client UUID to run for' },
      },
      required: ['agent_id'],
    },
  },
  {
    name: 'get_agent_runs',
    description: 'Get recent run history for an agent, including status, output, and actions taken',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string', description: 'The agent UUID' },
        limit: { type: 'number', description: 'Number of runs to return (default 10)' },
      },
      required: ['agent_id'],
    },
  },
  {
    name: 'list_clients',
    description: 'List all active clients in the system',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_client_metrics',
    description: 'Get recent daily metrics for a specific client',
    inputSchema: {
      type: 'object',
      properties: {
        client_id: { type: 'string', description: 'Client UUID' },
        days: { type: 'number', description: 'Number of days to look back (default 7)' },
      },
      required: ['client_id'],
    },
  },
  {
    name: 'create_agent',
    description: 'Create a new AI agent with a name, prompt template, schedule, model, and connectors',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Agent name' },
        description: { type: 'string', description: 'What this agent does' },
        icon: { type: 'string', description: 'Emoji icon for the agent' },
        prompt_template: { type: 'string', description: 'System prompt with {{client_name}}, {{date}}, {{yesterday}}, {{data}} variables' },
        schedule_cron: { type: 'string', description: 'Cron schedule e.g. "0 6 * * *"' },
        model: { type: 'string', description: 'AI model e.g. "nvidia/nemotron-3-ultra-550b-a55b:free"' },
        client_id: { type: 'string', description: 'Optional client UUID to scope to' },
        connectors: { type: 'array', items: { type: 'string' }, description: 'Data connectors: database, meta_ads, ghl_crm, slack' },
        enabled: { type: 'boolean', description: 'Whether the agent is enabled' },
      },
      required: ['name', 'prompt_template'],
    },
  },
  {
    name: 'update_agent',
    description: 'Update an existing agent configuration',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string', description: 'Agent UUID to update' },
        name: { type: 'string' },
        description: { type: 'string' },
        prompt_template: { type: 'string' },
        schedule_cron: { type: 'string' },
        model: { type: 'string' },
        client_id: { type: 'string' },
        connectors: { type: 'array', items: { type: 'string' } },
        enabled: { type: 'boolean' },
      },
      required: ['agent_id'],
    },
  },
  {
    name: 'get_tasks',
    description: 'Get tasks for a specific client',
    inputSchema: {
      type: 'object',
      properties: {
        client_id: { type: 'string', description: 'Client UUID' },
        status: { type: 'string', description: 'Filter by status (e.g. "todo", "in_progress", "done")' },
      },
      required: ['client_id'],
    },
  },
  {
    name: 'create_task',
    description: 'Create a new task for a client',
    inputSchema: {
      type: 'object',
      properties: {
        client_id: { type: 'string', description: 'Client UUID' },
        title: { type: 'string', description: 'Task title' },
        description: { type: 'string', description: 'Task description' },
        priority: { type: 'string', description: 'Priority: low, medium, high, urgent' },
        assigned_to: { type: 'string', description: 'Member name to assign to' },
        due_date: { type: 'string', description: 'Due date ISO string' },
      },
      required: ['client_id', 'title'],
    },
  },
  // ============ Meta Ads Tools ============
  {
    name: 'meta_list_campaigns',
    description: 'List Meta ad campaigns for a client. Read-only.',
    inputSchema: {
      type: 'object',
      properties: {
        client_id: { type: 'string' },
        status: { type: 'string', description: 'Optional ACTIVE|PAUSED|ARCHIVED filter' },
        limit: { type: 'number', description: 'Default 50' },
      },
      required: ['client_id'],
    },
  },
  {
    name: 'meta_list_adsets',
    description: 'List Meta ad sets, optionally scoped to a campaign. Read-only.',
    inputSchema: {
      type: 'object',
      properties: {
        client_id: { type: 'string' },
        campaign_id: { type: 'string', description: 'Optional meta_campaign_id or internal id' },
        status: { type: 'string' },
        limit: { type: 'number' },
      },
      required: ['client_id'],
    },
  },
  {
    name: 'meta_list_ads',
    description: 'List Meta ads, optionally scoped to an ad set or campaign. Read-only.',
    inputSchema: {
      type: 'object',
      properties: {
        client_id: { type: 'string' },
        adset_id: { type: 'string' },
        campaign_id: { type: 'string' },
        status: { type: 'string' },
        limit: { type: 'number' },
      },
      required: ['client_id'],
    },
  },
  {
    name: 'meta_get_ad_performance',
    description: 'Get aggregate performance (spend, impressions, clicks, CTR, CPC, conversions) for an ad/adset/campaign. Read-only.',
    inputSchema: {
      type: 'object',
      properties: {
        client_id: { type: 'string' },
        ad_id: { type: 'string', description: 'Internal meta_ads.id' },
        campaign_id: { type: 'string', description: 'Internal meta_campaigns.id' },
      },
      required: ['client_id'],
    },
  },
  {
    name: 'meta_toggle_status',
    description: 'WRITE: Pause or activate a campaign, ad set, or ad. Requires user confirmation before calling.',
    inputSchema: {
      type: 'object',
      properties: {
        client_id: { type: 'string' },
        level: { type: 'string', enum: ['campaign', 'adset', 'ad'] },
        row_id: { type: 'string', description: 'Internal UUID of the object' },
        status: { type: 'string', enum: ['ACTIVE', 'PAUSED'] },
      },
      required: ['client_id', 'level', 'row_id', 'status'],
    },
  },
  {
    name: 'meta_update_budget',
    description: 'WRITE: Update daily or lifetime budget on a campaign or ad set. Requires user confirmation.',
    inputSchema: {
      type: 'object',
      properties: {
        client_id: { type: 'string' },
        level: { type: 'string', enum: ['campaign', 'adset'] },
        row_id: { type: 'string' },
        daily_budget: { type: 'number', description: 'Daily budget in dollars' },
        lifetime_budget: { type: 'number', description: 'Lifetime budget in dollars' },
      },
      required: ['client_id', 'level', 'row_id'],
    },
  },
  {
    name: 'meta_duplicate',
    description: 'WRITE: Duplicate a campaign, ad set, or ad. Requires user confirmation.',
    inputSchema: {
      type: 'object',
      properties: {
        client_id: { type: 'string' },
        level: { type: 'string', enum: ['campaign', 'adset', 'ad'] },
        row_id: { type: 'string' },
      },
      required: ['client_id', 'level', 'row_id'],
    },
  },
  {
    name: 'meta_create_campaign',
    description: 'WRITE: Create a new Meta campaign. Requires user confirmation.',
    inputSchema: {
      type: 'object',
      properties: {
        client_id: { type: 'string' },
        name: { type: 'string' },
        objective: { type: 'string', description: 'e.g. OUTCOME_LEADS, OUTCOME_TRAFFIC' },
        status: { type: 'string', enum: ['ACTIVE', 'PAUSED'], description: 'Default PAUSED' },
        daily_budget: { type: 'number' },
      },
      required: ['client_id', 'name', 'objective'],
    },
  },
  {
    name: 'meta_create_ad',
    description: 'WRITE: Create a new ad inside an ad set with a creative. Requires user confirmation.',
    inputSchema: {
      type: 'object',
      properties: {
        client_id: { type: 'string' },
        adset_id: { type: 'string' },
        name: { type: 'string' },
        creative_id: { type: 'string' },
        status: { type: 'string', enum: ['ACTIVE', 'PAUSED'] },
      },
      required: ['client_id', 'adset_id', 'name', 'creative_id'],
    },
  },
  {
    name: 'meta_sync_account',
    description: 'Trigger a Meta Ads sync for a client (campaigns + insights). Heavy operation.',
    inputSchema: {
      type: 'object',
      properties: {
        client_id: { type: 'string' },
        days: { type: 'number', description: 'Lookback window, default 7' },
      },
      required: ['client_id'],
    },
  },
  // ============ Generic API / Hermes parity (proxies external-data-api) ============
  {
    name: 'db_list_tables',
    description: 'List all tables, storage buckets, relation maps, and composite actions available through the external-data-api / MCP.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'db_select',
    description: 'Read rows from an allowed table. Supports filters (eq/gt/gte/lt/lte/neq/like/ilike/in/is, $-prefixed shorthand, arrays for IN, null for IS NULL), relations via include, select_columns, order_by, order_dir, limit, offset.',
    inputSchema: {
      type: 'object',
      properties: {
        table: { type: 'string' },
        filters: { type: 'object', description: 'Column -> value or { op, value } / { $op: value }' },
        include: { type: 'array', items: { type: 'string' }, description: 'Relation keys, see instructions' },
        select_columns: { type: 'string', description: 'PostgREST select string, default "*"' },
        order_by: { type: 'string' },
        order_dir: { type: 'string', enum: ['asc', 'desc'] },
        limit: { type: 'number' },
        offset: { type: 'number' },
      },
      required: ['table'],
    },
  },
  {
    name: 'db_count',
    description: 'Count rows in an allowed table with optional equality filters.',
    inputSchema: {
      type: 'object',
      properties: { table: { type: 'string' }, filters: { type: 'object' } },
      required: ['table'],
    },
  },
  {
    name: 'db_insert',
    description: 'WRITE: Insert one or many rows into an allowed table. Requires user confirmation.',
    inputSchema: {
      type: 'object',
      properties: { table: { type: 'string' }, data: { description: 'Row object or array of row objects' } },
      required: ['table', 'data'],
    },
  },
  {
    name: 'db_upsert',
    description: 'WRITE: Upsert one or many rows into an allowed table. Requires user confirmation.',
    inputSchema: {
      type: 'object',
      properties: { table: { type: 'string' }, data: {} },
      required: ['table', 'data'],
    },
  },
  {
    name: 'db_update',
    description: 'WRITE: Update rows in an allowed table matching the `match` filters. Requires user confirmation.',
    inputSchema: {
      type: 'object',
      properties: { table: { type: 'string' }, data: { type: 'object' }, match: { type: 'object' } },
      required: ['table', 'data', 'match'],
    },
  },
  {
    name: 'db_delete',
    description: 'WRITE: Delete rows in an allowed table matching the `match` filters. Requires user confirmation.',
    inputSchema: {
      type: 'object',
      properties: { table: { type: 'string' }, match: { type: 'object' } },
      required: ['table', 'match'],
    },
  },
  {
    name: 'storage_list',
    description: 'List files in an allowed storage bucket (creatives, task-files, gpt-files, live-ads, client-offers).',
    inputSchema: {
      type: 'object',
      properties: {
        bucket: { type: 'string' },
        file_path: { type: 'string', description: 'Folder path (optional, default root)' },
        limit: { type: 'number' },
        offset: { type: 'number' },
        order_by: { type: 'string' },
        order_dir: { type: 'string', enum: ['asc', 'desc'] },
      },
      required: ['bucket'],
    },
  },
  {
    name: 'storage_get_url',
    description: 'Get the public URL for a file in an allowed bucket.',
    inputSchema: {
      type: 'object',
      properties: { bucket: { type: 'string' }, file_path: { type: 'string' } },
      required: ['bucket', 'file_path'],
    },
  },
  {
    name: 'storage_delete',
    description: 'WRITE: Delete a file from an allowed bucket. Requires user confirmation.',
    inputSchema: {
      type: 'object',
      properties: { bucket: { type: 'string' }, file_path: { type: 'string' } },
      required: ['bucket', 'file_path'],
    },
  },
  {
    name: 'storage_upload_base64',
    description: 'WRITE: Upload a base64-encoded file to an allowed bucket (upsert). Requires user confirmation.',
    inputSchema: {
      type: 'object',
      properties: {
        bucket: { type: 'string' },
        file_path: { type: 'string' },
        data: { type: 'string', description: 'base64-encoded bytes' },
        content_type: { type: 'string' },
      },
      required: ['bucket', 'file_path', 'data'],
    },
  },
  {
    name: 'create_task_composite',
    description: 'WRITE: Create a task with optional assignees, subtasks, and comments in one call (mirrors external-data-api create_task). Requires user confirmation.',
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'object', description: '{title (required), description?, client_id?, priority?, stage?, status?, due_date?, recurrence_type?, recurrence_interval?, created_by?}' },
        assignees: { type: 'array', items: { type: 'object' } },
        subtasks: { type: 'array', items: { type: 'object' } },
        comments: { type: 'array', items: { type: 'object' } },
      },
      required: ['task'],
    },
  },
  {
    name: 'get_ads_overview',
    description: 'Get full Meta ads hierarchy (campaigns → ad sets → ads) for a client with spend & attribution totals.',
    inputSchema: {
      type: 'object',
      properties: {
        client_id: { type: 'string' },
        status: { type: 'string' },
        date_start: { type: 'string', description: 'synced_at >= (ISO)' },
        date_end: { type: 'string', description: 'synced_at <= (ISO)' },
      },
      required: ['client_id'],
    },
  },
];

async function handleToolCall(name: string, args: Record<string, any>): Promise<any> {
  const cloudDb = getCloudDb();
  const prodDb = getProdDb();

  switch (name) {
    case 'list_agents': {
      const { data } = await cloudDb.from('agents').select('*').order('created_at', { ascending: false });
      return { agents: data || [] };
    }

    case 'get_agent': {
      const { data } = await cloudDb.from('agents').select('*').eq('id', args.agent_id).single();
      return data || { error: 'Agent not found' };
    }

    case 'run_agent': {
      // Call the run-agent edge function
      const url = `${Deno.env.get('SUPABASE_URL')}/functions/v1/run-agent`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${Deno.env.get('SUPABASE_ANON_KEY')}`,
        },
        body: JSON.stringify({
          agent_id: args.agent_id,
          client_id: args.client_id,
          password: 'HPA1234$',
        }),
      });
      return await res.json();
    }

    case 'get_agent_runs': {
      const limit = args.limit || 10;
      const { data } = await cloudDb
        .from('agent_runs')
        .select('*')
        .eq('agent_id', args.agent_id)
        .order('started_at', { ascending: false })
        .limit(limit);
      return { runs: data || [] };
    }

    case 'list_clients': {
      const { data } = await prodDb
        .from('clients')
        .select('id, name, status, industry, client_type')
        .in('status', ['active', 'onboarding'])
        .order('name');
      return { clients: data || [] };
    }

    case 'get_client_metrics': {
      const days = args.days || 7;
      const since = new Date();
      since.setDate(since.getDate() - days);
      const { data } = await prodDb
        .from('daily_metrics')
        .select('*')
        .eq('client_id', args.client_id)
        .gte('date', since.toISOString().split('T')[0])
        .order('date', { ascending: false });
      return { metrics: data || [] };
    }

    case 'create_agent': {
      const { data, error } = await cloudDb.from('agents').insert({
        name: args.name,
        description: args.description || '',
        icon: args.icon || '🤖',
        prompt_template: args.prompt_template,
        schedule_cron: args.schedule_cron || '0 6 * * *',
        model: args.model || 'google/gemini-2.5-pro',
        client_id: args.client_id || null,
        connectors: args.connectors || ['database'],
        enabled: args.enabled ?? false,
      }).select().single();
      if (error) return { error: error.message };
      return data;
    }

    case 'update_agent': {
      const { agent_id, ...updates } = args;
      const { error } = await cloudDb
        .from('agents')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('id', agent_id);
      if (error) return { error: error.message };
      return { success: true };
    }

    case 'get_tasks': {
      let query = prodDb.from('tasks').select('*').eq('client_id', args.client_id);
      if (args.status) query = query.eq('status', args.status);
      const { data } = await query.order('created_at', { ascending: false }).limit(50);
      return { tasks: data || [] };
    }

    case 'create_task': {
      const { data, error } = await prodDb.from('tasks').insert({
        client_id: args.client_id,
        title: args.title,
        description: args.description || null,
        priority: args.priority || 'medium',
        assigned_to: args.assigned_to || null,
        due_date: args.due_date || null,
        status: 'todo',
        stage: 'backlog',
      }).select().single();
      if (error) return { error: error.message };
      // Auto-assign if no explicit assignee
      if (!args.assigned_to && data?.id) {
        try {
          fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/ai-auto-assign-task`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
              apikey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '',
            },
            body: JSON.stringify({ taskId: data.id }),
          }).catch((e) => console.warn('mcp auto-assign failed', e));
        } catch (e) { console.warn('mcp auto-assign threw', e); }
      }
      return data;
    }

    // ============ Meta Ads handlers ============
    case 'meta_list_campaigns': {
      let q = prodDb.from('meta_campaigns').select('id, meta_campaign_id, name, status, effective_status, objective, daily_budget, lifetime_budget, spend, impressions, clicks, ctr, cpc, synced_at').eq('client_id', args.client_id);
      if (args.status) q = q.eq('effective_status', String(args.status).toUpperCase());
      const { data, error } = await q.order('spend', { ascending: false }).limit(args.limit || 50);
      if (error) return { error: error.message };
      return { campaigns: data || [] };
    }
    case 'meta_list_adsets': {
      let q = prodDb.from('meta_ad_sets').select('id, meta_adset_id, meta_campaign_id, name, status, effective_status, daily_budget, spend, impressions, clicks, ctr, synced_at').eq('client_id', args.client_id);
      if (args.campaign_id) q = q.or(`meta_campaign_id.eq.${args.campaign_id},id.eq.${args.campaign_id}`);
      if (args.status) q = q.eq('effective_status', String(args.status).toUpperCase());
      const { data, error } = await q.order('spend', { ascending: false }).limit(args.limit || 100);
      if (error) return { error: error.message };
      return { adsets: data || [] };
    }
    case 'meta_list_ads': {
      let q = prodDb.from('meta_ads').select('id, meta_ad_id, meta_adset_id, meta_campaign_id, name, status, effective_status, headline, body, link_url, thumbnail_url, spend, impressions, clicks, ctr, cpc, conversions, cost_per_conversion, synced_at').eq('client_id', args.client_id);
      if (args.adset_id) q = q.or(`meta_adset_id.eq.${args.adset_id},ad_set_id.eq.${args.adset_id}`);
      if (args.campaign_id) q = q.eq('meta_campaign_id', args.campaign_id);
      if (args.status) q = q.eq('effective_status', String(args.status).toUpperCase());
      const { data, error } = await q.order('spend', { ascending: false }).limit(args.limit || 100);
      if (error) return { error: error.message };
      return { ads: data || [] };
    }
    case 'meta_get_ad_performance': {
      if (args.ad_id) {
        const { data, error } = await prodDb.from('meta_ads').select('name, spend, impressions, clicks, ctr, cpc, cpm, reach, conversions, cost_per_conversion').eq('id', args.ad_id).maybeSingle();
        if (error) return { error: error.message };
        return data || { error: 'Ad not found' };
      }
      if (args.campaign_id) {
        const { data, error } = await prodDb.from('meta_campaigns').select('name, spend, impressions, clicks, ctr, cpc').eq('id', args.campaign_id).maybeSingle();
        if (error) return { error: error.message };
        return data || { error: 'Campaign not found' };
      }
      return { error: 'Provide ad_id or campaign_id' };
    }
    case 'meta_toggle_status': {
      return await invokeEdge('toggle-meta-status', {
        clientId: args.client_id,
        level: args.level,
        rowId: args.row_id,
        status: args.status,
      });
    }
    case 'meta_update_budget': {
      return await invokeEdge('update-meta-budget', {
        clientId: args.client_id,
        level: args.level,
        rowId: args.row_id,
        daily_budget: args.daily_budget,
        lifetime_budget: args.lifetime_budget,
      });
    }
    case 'meta_duplicate': {
      return await invokeEdge('duplicate-meta-object', {
        clientId: args.client_id,
        level: args.level,
        rowId: args.row_id,
      });
    }
    case 'meta_create_campaign': {
      return await invokeEdge('create-meta-campaign', {
        clientId: args.client_id,
        name: args.name,
        objective: args.objective,
        status: args.status || 'PAUSED',
        daily_budget: args.daily_budget,
      });
    }
    case 'meta_create_ad': {
      return await invokeEdge('create-meta-ad', {
        clientId: args.client_id,
        adsetId: args.adset_id,
        name: args.name,
        creativeId: args.creative_id,
        status: args.status || 'PAUSED',
      });
    }
    case 'meta_sync_account': {
      return await invokeEdge('sync-meta-ads', {
        clientId: args.client_id,
        days: args.days || 7,
      });
    }

    // ============ Generic API / Hermes parity (proxy to external-data-api) ============
    case 'db_list_tables':
      return await callDataApi({ action: 'list_tables' });
    case 'db_select':
      return await callDataApi({ action: 'select', ...args });
    case 'db_count':
      return await callDataApi({ action: 'count', ...args });
    case 'db_insert':
      return await callDataApi({ action: 'insert', ...args });
    case 'db_upsert':
      return await callDataApi({ action: 'upsert', ...args });
    case 'db_update':
      return await callDataApi({ action: 'update', ...args });
    case 'db_delete':
      return await callDataApi({ action: 'delete', ...args });
    case 'storage_list':
      return await callDataApi({ action: 'list_storage', ...args });
    case 'storage_get_url':
      return await callDataApi({ action: 'get_file_url', ...args });
    case 'storage_delete':
      return await callDataApi({ action: 'delete_file', ...args });
    case 'storage_upload_base64':
      return await callDataApi({ action: 'upload_file_base64', ...args });
    case 'create_task_composite':
      return await callDataApi({ action: 'create_task', ...args });
    case 'get_ads_overview':
      return await callDataApi({ action: 'get_ads_overview', ...args });

    default:
      return { error: `Unknown tool: ${name}` };
  }
}

// Proxy to external-data-api (the "Hermes API"). Uses the same shared password
// contract as the rest of the internal fleet so every MCP tool sees identical
// behavior to a direct API call.
async function callDataApi(payload: Record<string, any>): Promise<any> {
  const url = `${Deno.env.get('SUPABASE_URL')}/functions/v1/external-data-api`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${Deno.env.get('SUPABASE_ANON_KEY')}`,
    },
    body: JSON.stringify({ password: 'HPA1234$', ...payload }),
  });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { status: res.status, body: text }; }
}

async function invokeEdge(fnName: string, payload: Record<string, any>): Promise<any> {
  const url = `${Deno.env.get('SUPABASE_URL')}/functions/v1/${fnName}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${Deno.env.get('SUPABASE_ANON_KEY')}`,
    },
    body: JSON.stringify({ ...payload, password: 'HPA1234$' }),
  });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { status: res.status, body: text }; }
}

// JSON-RPC handler for MCP protocol
async function handleJsonRpc(body: any): Promise<any> {
  const { method, params, id } = body;

  switch (method) {
    case 'initialize':
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'hpa-agent-server', version: '1.0.0' },
          instructions: API_INSTRUCTIONS,
        },
      };

    case 'notifications/initialized':
      return null; // No response needed for notifications

    case 'tools/list':
      return {
        jsonrpc: '2.0',
        id,
        result: { tools: TOOLS },
      };

    case 'tools/call': {
      const toolName = params?.name;
      const toolArgs = params?.arguments || {};
      const startedAt = Date.now();
      try {
        const result = await handleToolCall(toolName, toolArgs);
        await logMetaToolCall({
          tool_name: toolName,
          args: toolArgs,
          response: result,
          success: true,
          duration_ms: Date.now() - startedAt,
        });
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          },
        };
      } catch (err: any) {
        await logMetaToolCall({
          tool_name: toolName,
          args: toolArgs,
          response: null,
          success: false,
          error: err?.message || String(err),
          duration_ms: Date.now() - startedAt,
        });
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: `Error: ${err.message}` }],
            isError: true,
          },
        };
      }
    }

    default:
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `Method not found: ${method}` },
      };
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // Health check
  if (req.method === 'GET') {
    return new Response(JSON.stringify({
      name: 'hpa-agent-server',
      version: '1.0.0',
      description: 'MCP server for HPA AI Agents — connect from Claude Code Desktop',
      tools: TOOLS.map(t => t.name),
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await req.json();

    // Handle batch requests
    if (Array.isArray(body)) {
      const results = [];
      for (const item of body) {
        const result = await handleJsonRpc(item);
        if (result !== null) results.push(result);
      }
      return new Response(JSON.stringify(results), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const result = await handleJsonRpc(body);
    if (result === null) {
      return new Response('', { status: 204, headers: corsHeaders });
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    console.error('MCP server error:', err);
    return new Response(JSON.stringify({
      jsonrpc: '2.0',
      error: { code: -32700, message: 'Parse error' },
      id: null,
    }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
