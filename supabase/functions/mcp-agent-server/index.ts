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
        model: { type: 'string', description: 'AI model e.g. "openrouter/owl-alpha"' },
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

    default:
      return { error: `Unknown tool: ${name}` };
  }
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
      try {
        const result = await handleToolCall(toolName, toolArgs);
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          },
        };
      } catch (err: any) {
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
