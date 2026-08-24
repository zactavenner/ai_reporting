import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { runJeremyReview, listRecommendations, prepareCampaignDraft } from '../_shared/jeremyReview.ts';
import { kpiContract } from '../_shared/jeremyKpiContract.ts';
import { loadPolicy } from '../_shared/jeremyPolicy.ts';
import {
  analyzeAccount,
  buildCoverage,
  createLaunchBatch,
  discoverWinners,
  executeApprovedAction,
  getCycle,
  planActions,
  prepareRecreations,
  rankCandidates,
  runCycle,
  dryRunProvider,
  launchReadiness,
} from '../_shared/jeremyAutonomy.ts';
import {
  quoteJob,
  approveJob,
  authorizeJobExecution,
  getJob,
  listJobs,
  costPosture,
} from '../_shared/jeremyExternalJobs.ts';
import {
  generationTarget,
  jobKindFor,
  pickGenerationModel,
  quoteGenerationCostUsd,
  runGenerationJob,
} from '../_shared/jeremyGeneration.ts';
import { publishTarget } from '../_shared/jeremyLaunch.ts';
import { makeGenerationExecutors } from '../_shared/jeremyExecutors.ts';
import {
  normalizeDiscoveryTarget,
  resolveApifySettings,
  costPerResultUsd,
  estimateApifyCostUsd,
  checkApifyMonthlyLimit,
} from '../_shared/jeremyApify.ts';

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
  // ============ Media Buyer (JEREMY) — read / safe-preparation only ============
  // There is deliberately NO tool that applies a recommendation or publishes to
  // Meta. Applying and publishing stay explicit dashboard operator actions.
  {
    name: 'jeremy_review_ads',
    description: 'Run the Media Buyer (JEREMY) funded-outcome review for a client and create reviewable recommendations. Never writes to Meta and never spends.',
    inputSchema: {
      type: 'object',
      properties: { client_id: { type: 'string' } },
      required: ['client_id'],
    },
  },
  {
    name: 'jeremy_list_recommendations',
    description: 'List JEREMY recommendations for a client (optionally filtered by status: pending, applied, acknowledged, rejected, failed).',
    inputSchema: {
      type: 'object',
      properties: {
        client_id: { type: 'string' },
        status: { type: 'string' },
        limit: { type: 'number', default: 25 },
      },
      required: ['client_id'],
    },
  },
  {
    name: 'jeremy_prepare_campaign_draft',
    description: 'Validate campaign inputs and create a DRAFT launch only in meta_campaign_launches. Publishing to Meta remains a dashboard operator action.',
    inputSchema: {
      type: 'object',
      properties: {
        client_id: { type: 'string' },
        inputs: {
          type: 'object',
          description: 'name, objective (leads|traffic), daily_budget_cents, cta, destination_url, primary_text, headline, description, page_id, pixel_id, countries (array or comma list), age_min, age_max, special_ad_category, creative_url, creative_type (image|video)',
        },
      },
      required: ['client_id', 'inputs'],
    },
  },
  // ===== Jeremy Autonomous Creative & Media Buyer (shadow-first) =====
  {
    name: 'jeremy_get_kpi_contract',
    description: 'Return the versioned Jeremy KPI contract: primary business outcomes, media diagnostics, creative diagnostics, reliability gates and the precedence rules.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'jeremy_discover_winners',
    description: 'Discover winning creative across the client Meta account, creative library, scraped ads, live-ad intelligence and viral video sources. Paid Apify discovery is refused unless the account policy enables and caps it.',
    inputSchema: {
      type: 'object',
      properties: { client_id: { type: 'string' }, include_apify: { type: 'boolean', default: false }, apify_expected_cost_usd: { type: 'number' } },
      required: ['client_id'],
    },
  },
  {
    name: 'jeremy_rank_candidates',
    description: 'Rank discovered candidates under the KPI contract. Funded outcomes outrank proxy metrics whenever outcome data is complete; missing data is returned explicitly.',
    inputSchema: { type: 'object', properties: { client_id: { type: 'string' } }, required: ['client_id'] },
  },
  {
    name: 'jeremy_prepare_recreations',
    description: 'Create derivative recreation briefs (mechanism only, never copied branding) and prepare image/video generation jobs. Jobs stay prepared/blocked while paid generation is disabled or uncapped.',
    inputSchema: { type: 'object', properties: { client_id: { type: 'string' }, cycle_id: { type: 'string' }, top: { type: 'number', default: 5 } }, required: ['client_id'] },
  },
  {
    name: 'jeremy_create_launch_batch',
    description: 'Create launch drafts for prepared candidates. Every created object is PAUSED; publishing and activation remain explicit dashboard operator actions.',
    inputSchema: {
      type: 'object',
      properties: { client_id: { type: 'string' }, candidate_ids: { type: 'array', items: { type: 'string' } }, inputs: { type: 'object' }, confirm: { type: 'boolean', description: 'Must be true.' } },
      required: ['client_id', 'candidate_ids', 'confirm'],
    },
  },
  {
    name: 'jeremy_analyze_account',
    description: 'Analyze the client account under the KPI contract, returning per-entity KPIs, decision basis and attribution coverage.',
    inputSchema: { type: 'object', properties: { client_id: { type: 'string' }, window_days: { type: 'number', default: 30 } }, required: ['client_id'] },
  },
  {
    name: 'jeremy_plan_actions',
    description: 'Produce a pause/scale action plan with every deterministic policy gate result (sample floors, cooldown, mode, scale clamp, KPI precedence). Read-only.',
    inputSchema: { type: 'object', properties: { client_id: { type: 'string' }, window_days: { type: 'number', default: 30 } }, required: ['client_id'] },
  },
  {
    name: 'jeremy_execute_approved_action',
    description: 'Replay an already-approved, persisted plan (plan_id) as a DRY RUN. Requires confirm:true; every deterministic gate is revalidated server-side; the MCP surface never mutates Meta — live execution is a dashboard operator action.',
    inputSchema: {
      type: 'object',
      properties: {
        client_id: { type: 'string' },
        plan_id: { type: 'string', description: 'The persisted, approved jeremy_action_plans row to replay.' },
        jeremy_action: { type: 'string', enum: ['pause', 'adjust_budget'] },
        entity_type: { type: 'string', enum: ['campaign', 'adset', 'ad'] },
        meta_entity_id: { type: 'string' },
        proposed_daily_budget: { type: 'number' },
        cycle_id: { type: 'string' },
        recommendation_id: { type: 'string' },
        confirm: { type: 'boolean' },
      },
      required: ['client_id', 'plan_id', 'jeremy_action', 'entity_type', 'meta_entity_id', 'confirm'],
    },
  },
  {
    name: 'jeremy_run_cycle',
    description: 'Run the full durable loop: discovery, selection, recreation, launch preparation, analysis, action planning and verification. Shadow mode records decisions without executing.',
    inputSchema: {
      type: 'object',
      properties: { client_id: { type: 'string' }, window_days: { type: 'number', default: 30 }, top: { type: 'number', default: 5 }, create_launches: { type: 'boolean', default: false }, include_apify: { type: 'boolean', default: false } },
      required: ['client_id'],
    },
  },
  {
    name: 'jeremy_get_cycle',
    description: 'Return a cycle with its stage timestamps, evidence, candidates, external jobs and execution audit trail.',
    inputSchema: { type: 'object', properties: { cycle_id: { type: 'string' } }, required: ['cycle_id'] },
  },
  {
    name: 'jeremy_quote_apify_discovery',
    description: 'Quote a paid Apify Instagram discovery run. Returns an awaiting_approval external job with the exact target count, result limit and MAXIMUM cost. Spends nothing and cannot approve itself.',
    inputSchema: {
      type: 'object',
      properties: {
        client_id: { type: 'string' },
        scrape_type: { type: 'string', enum: ['profile', 'hashtag', 'url'] },
        targets: { type: 'array', items: { type: 'string' } },
        results_limit: { type: 'number', description: 'Results per target (bounded server-side).' },
        cycle_id: { type: 'string' },
      },
      required: ['client_id', 'scrape_type', 'targets', 'results_limit'],
    },
  },
  {
    name: 'jeremy_quote_generation',
    description: 'Quote a paid image or video generation for a persisted candidate. Returns an awaiting_approval external job with the exact model and MAXIMUM cost. Spends nothing.',
    inputSchema: {
      type: 'object',
      properties: {
        client_id: { type: 'string' },
        candidate_id: { type: 'string' },
        kind: { type: 'string', enum: ['static_image', 'video'] },
        model: { type: 'string' },
        aspect_ratio: { type: 'string' },
        duration_seconds: { type: 'number' },
        cycle_id: { type: 'string' },
      },
      required: ['client_id', 'candidate_id'],
    },
  },
  {
    name: 'jeremy_quote_paused_publication',
    description: 'Quote creating PAUSED Meta objects (campaign + ad set + ad) for a complete launch draft. Returns an awaiting_approval external job; nothing is created and nothing is ever activated.',
    inputSchema: {
      type: 'object',
      properties: { client_id: { type: 'string' }, launch_id: { type: 'string' } },
      required: ['client_id', 'launch_id'],
    },
  },
  {
    name: 'jeremy_run_external_job',
    description: 'Run an external job (Apify discovery, generation, or PAUSED publication). Refused unless an authenticated OPERATOR approval record already exists on the job — MCP never self-approves, so an unapproved job returns the exact blocking gate instead of spending.',
    inputSchema: {
      type: 'object',
      properties: { client_id: { type: 'string' }, job_id: { type: 'string' }, confirm: { type: 'boolean' } },
      required: ['client_id', 'job_id', 'confirm'],
    },
  },
  {
    name: 'jeremy_get_external_job',
    description: 'Return one external job: status, exact target/model, quoted maximum cost, actual cost, approval actor/time, provider job id, verification read-back and any error.',
    inputSchema: { type: 'object', properties: { client_id: { type: 'string' }, job_id: { type: 'string' } }, required: ['client_id', 'job_id'] },
  },
  {
    name: 'jeremy_list_external_jobs',
    description: 'List external jobs for a client with cost caps and month-to-date paid usage for discovery and generation.',
    inputSchema: {
      type: 'object',
      properties: { client_id: { type: 'string' }, kind: { type: 'string' }, status: { type: 'string' }, cycle_id: { type: 'string' }, limit: { type: 'number' } },
      required: ['client_id'],
    },
  },
  {
    name: 'jeremy_launch_readiness',
    description: 'Return the exact launch readiness list for candidates: every missing creative URL, page id, pixel, destination, targeting or compliance value. Nothing is defaulted.',
    inputSchema: {
      type: 'object',
      properties: { client_id: { type: 'string' }, candidate_ids: { type: 'array', items: { type: 'string' } }, inputs: { type: 'object' } },
      required: ['client_id', 'candidate_ids'],
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

    // ============ Media Buyer (JEREMY) ============
    case 'jeremy_review_ads': {
      if (!args.client_id) return { error: 'client_id required' };
      return await runJeremyReview(prodDb, args.client_id, 'mcp');
    }
    case 'jeremy_list_recommendations': {
      if (!args.client_id) return { error: 'client_id required' };
      const recommendations = await listRecommendations(prodDb, args.client_id, args.status, args.limit ?? 25);
      return { recommendations, count: recommendations.length };
    }
    case 'jeremy_prepare_campaign_draft': {
      if (!args.client_id) return { error: 'client_id required' };
      return await prepareCampaignDraft(prodDb, args.client_id, args.inputs || {});
    }

    // ===== Jeremy Autonomous loop =====
    case 'jeremy_get_kpi_contract':
      return { contract: kpiContract() };
    case 'jeremy_discover_winners': {
      if (!args.client_id) return { error: 'client_id required' };
      const policy = await loadPolicy(prodDb, args.client_id);
      const result = await discoverWinners(prodDb, args.client_id, policy, {
        includeApify: args.include_apify === true,
        apifyExpectedCostUsd: Number(args.apify_expected_cost_usd),
      });
      return { sources: result.sources, paid_discovery: result.paid_discovery, candidates: result.candidates.slice(0, 25), mode: policy.mode };
    }
    case 'jeremy_rank_candidates': {
      if (!args.client_id) return { error: 'client_id required' };
      const policy = await loadPolicy(prodDb, args.client_id);
      const discovery = await discoverWinners(prodDb, args.client_id, policy, {});
      const { coverage } = await buildCoverage(prodDb, args.client_id, policy);
      return { coverage, candidates: rankCandidates(discovery.candidates, coverage).slice(0, 25) };
    }
    case 'jeremy_prepare_recreations': {
      if (!args.client_id) return { error: 'client_id required' };
      const policy = await loadPolicy(prodDb, args.client_id);
      const discovery = await discoverWinners(prodDb, args.client_id, policy, {});
      const { coverage } = await buildCoverage(prodDb, args.client_id, policy);
      const ranked = rankCandidates(discovery.candidates, coverage);
      return await prepareRecreations(prodDb, args.client_id, args.cycle_id ?? null, policy, ranked, { top: args.top ?? 5 });
    }
    case 'jeremy_create_launch_batch': {
      if (!args.client_id) return { error: 'client_id required' };
      if (args.confirm !== true) return { error: 'confirm:true is required to create launch drafts' };
      const ids = Array.isArray(args.candidate_ids) ? args.candidate_ids.map(String) : [];
      if (!ids.length) return { error: 'candidate_ids required' };
      const batch = await createLaunchBatch(prodDb, args.client_id, ids, args.inputs || {});
      return { ...batch, note: 'All created objects are PAUSED drafts. Publishing stays an operator action.' };
    }
    case 'jeremy_analyze_account': {
      if (!args.client_id) return { error: 'client_id required' };
      const policy = await loadPolicy(prodDb, args.client_id);
      return await analyzeAccount(prodDb, args.client_id, policy, args.window_days ?? 30);
    }
    case 'jeremy_plan_actions': {
      if (!args.client_id) return { error: 'client_id required' };
      const policy = await loadPolicy(prodDb, args.client_id);
      const analysis = await analyzeAccount(prodDb, args.client_id, policy, args.window_days ?? 30);
      const plan = await planActions(prodDb, args.client_id, policy, analysis);
      return { mode: policy.mode, basis: analysis.basis, coverage: analysis.coverage, plan };
    }
    case 'jeremy_execute_approved_action': {
      if (!args.client_id) return { error: 'client_id required' };
      if (args.confirm !== true) return { error: 'confirm:true is required' };
      if (!args.plan_id) return { error: 'plan_id required: only an approved, persisted plan can be executed' };
      const policy = await loadPolicy(prodDb, args.client_id);
      // The MCP surface never mutates the provider directly: it records the
      // decision as a dry run and the operator executes from the dashboard.
      return await executeApprovedAction(prodDb, policy, dryRunProvider, {
        clientId: args.client_id,
        planId: String(args.plan_id),
        cycleId: args.cycle_id ?? null,
        recommendationId: args.recommendation_id ?? null,
        action: args.jeremy_action,
        entityType: args.entity_type ?? 'campaign',
        metaEntityId: String(args.meta_entity_id ?? ''),
        proposedDailyBudget: args.proposed_daily_budget ?? null,
        executedBy: 'mcp',
        dryRun: true,
      });
    }
    case 'jeremy_run_cycle': {
      if (!args.client_id) return { error: 'client_id required' };
      return await runCycle(prodDb, args.client_id, {
        windowDays: args.window_days ?? 30,
        topCandidates: args.top ?? 5,
        createLaunches: args.create_launches === true,
        includeApify: args.include_apify === true,
        apifyExpectedCostUsd: Number(args.apify_expected_cost_usd),
        triggeredBy: 'mcp',
      });
    }
    case 'jeremy_get_cycle': {
      if (!args.cycle_id) return { error: 'cycle_id required' };
      return await getCycle(prodDb, args.cycle_id);
    }

    // ===== Jeremy external jobs: quote / status / approved-only execution =====
    case 'jeremy_quote_apify_discovery': {
      if (!args.client_id) return { error: 'client_id required' };
      const policy = await loadPolicy(prodDb, args.client_id);
      const normalized = normalizeDiscoveryTarget({
        scrapeType: args.scrape_type,
        targets: args.targets,
        resultsLimit: args.results_limit,
      });
      if (!normalized.ok) return { error: normalized.error };
      const settings = await resolveApifySettings(prodDb, args.client_id);
      const unit = costPerResultUsd(settings);
      const estimated = estimateApifyCostUsd(normalized.target, unit);
      const apifyGate = checkApifyMonthlyLimit(settings, estimated);
      const quote = await quoteJob(prodDb, policy, {
        clientId: args.client_id,
        kind: 'apify_discovery',
        provider: 'apify',
        target: { ...normalized.target },
        estimatedCostUsd: estimated,
        cycleId: args.cycle_id ?? null,
        requestedBy: 'mcp',
        quoteDetail: {
          provider: 'apify',
          scrape_type: normalized.target.scrapeType,
          target_count: normalized.target.targets.length,
          targets: normalized.target.targets,
          results_limit_per_target: normalized.target.resultsLimit,
          maximum_results: normalized.target.max_results,
          cost_per_result_usd: unit,
          apify_monthly_limit_gate: apifyGate,
        },
      });
      return { ...quote, apify_gate: apifyGate, note: 'Awaiting operator approval. No Apify credits were spent.' };
    }
    case 'jeremy_quote_generation': {
      if (!args.client_id || !args.candidate_id) return { error: 'client_id and candidate_id required' };
      const policy = await loadPolicy(prodDb, args.client_id);
      const { data: candidate } = await prodDb
        .from('jeremy_creative_candidates')
        .select('id, generation_kind')
        .eq('id', args.candidate_id)
        .eq('client_id', args.client_id)
        .maybeSingle();
      if (!candidate) return { error: 'Candidate not found for this client' };
      const kind = String(args.kind ?? candidate.generation_kind) === 'video' ? 'video' : 'static_image';
      const model = pickGenerationModel(kind as any, args.model);
      const aspectRatio = String(args.aspect_ratio ?? (kind === 'video' ? '9:16' : '1:1'));
      const durationSeconds = Math.max(1, Math.min(30, Number(args.duration_seconds) || 5));
      const cost = quoteGenerationCostUsd(kind as any, model, durationSeconds);
      const quote = await quoteJob(prodDb, policy, {
        clientId: args.client_id,
        kind: jobKindFor(kind as any),
        provider: 'openrouter',
        target: generationTarget({ candidateId: String(args.candidate_id), kind: kind as any, model, aspectRatio, durationSeconds }),
        estimatedCostUsd: cost,
        cycleId: args.cycle_id ?? null,
        candidateId: String(args.candidate_id),
        requestedBy: 'mcp',
        quoteDetail: { model, kind, aspect_ratio: aspectRatio, duration_seconds: kind === 'video' ? durationSeconds : null },
      });
      return { ...quote, note: 'Awaiting operator approval. No model credits were spent.' };
    }
    case 'jeremy_quote_paused_publication': {
      if (!args.client_id || !args.launch_id) return { error: 'client_id and launch_id required' };
      const policy = await loadPolicy(prodDb, args.client_id);
      const { data: launch } = await prodDb
        .from('meta_campaign_launches')
        .select('id, client_id')
        .eq('id', args.launch_id)
        .eq('client_id', args.client_id)
        .maybeSingle();
      if (!launch) return { error: 'Launch draft not found for this client' };
      const quote = await quoteJob(prodDb, policy, {
        clientId: args.client_id,
        kind: 'meta_publish',
        provider: 'meta',
        target: publishTarget(String(args.launch_id)),
        estimatedCostUsd: 0,
        launchId: String(args.launch_id),
        requestedBy: 'mcp',
        quoteDetail: { action: 'create campaign + ad set + ad, all PAUSED' },
      });
      return { ...quote, note: 'Awaiting operator approval. Nothing was created in Meta and nothing is ever activated.' };
    }
    case 'jeremy_run_external_job': {
      if (!args.client_id || !args.job_id) return { error: 'client_id and job_id required' };
      if (args.confirm !== true) return { error: 'confirm:true is required' };
      const policy = await loadPolicy(prodDb, args.client_id);
      const job = await getJob(prodDb, String(args.job_id));
      if (!job) return { error: 'Job not found' };
      if (String(job.client_id) !== String(args.client_id)) return { error: 'Job belongs to a different client' };
      // MCP never self-approves: without an operator approval record this is a
      // dry-run gate report, and the gate refusal is returned verbatim.
      const auth = await authorizeJobExecution(prodDb, policy, String(args.job_id), {
        clientId: args.client_id,
        kind: job.kind,
        target: (job.target ?? {}) as Record<string, unknown>,
        actor: 'mcp',
      });
      if (!auth.allowed) {
        return { success: false, dry_run: true, blocked_reason: auth.reason, gates: auth.gates, job };
      }
      if (job.kind === 'meta_publish') {
        return {
          success: false,
          dry_run: true,
          blocked_reason: 'PAUSED Meta publication is executed from the dashboard by the approving operator, not from MCP.',
          gates: auth.gates,
          job,
        };
      }
      const target = (job.target ?? {}) as Record<string, any>;
      const kind = String(target.kind) === 'video' ? 'video' : 'static_image';
      return await runGenerationJob(prodDb, policy, makeGenerationExecutors(prodDb), {
        clientId: args.client_id,
        jobId: String(args.job_id),
        candidateId: String(target.candidate_id ?? job.candidate_id ?? ''),
        kind: kind as any,
        model: String(target.model ?? ''),
        aspectRatio: String(target.aspect_ratio ?? '1:1'),
        durationSeconds: Number(target.duration_seconds) || 5,
        actor: 'mcp',
      });
    }
    case 'jeremy_get_external_job': {
      if (!args.client_id || !args.job_id) return { error: 'client_id and job_id required' };
      const job = await getJob(prodDb, String(args.job_id));
      if (!job || String(job.client_id) !== String(args.client_id)) return { error: 'Job not found for this client' };
      return { job };
    }
    case 'jeremy_list_external_jobs': {
      if (!args.client_id) return { error: 'client_id required' };
      const policy = await loadPolicy(prodDb, args.client_id);
      return {
        jobs: await listJobs(prodDb, args.client_id, {
          kind: args.kind,
          status: args.status,
          cycleId: args.cycle_id,
          limit: Number(args.limit) || 50,
        }),
        cost_posture: await costPosture(prodDb, policy, args.client_id),
      };
    }
    case 'jeremy_launch_readiness': {
      if (!args.client_id) return { error: 'client_id required' };
      const ids = Array.isArray(args.candidate_ids) ? args.candidate_ids.map(String) : [];
      if (!ids.length) return { error: 'candidate_ids required' };
      return { readiness: await launchReadiness(prodDb, args.client_id, args.client_id ? ids : [], args.inputs || {}) };
    }

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
      tool_count: TOOLS.length,
      instructions: API_INSTRUCTIONS,
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
