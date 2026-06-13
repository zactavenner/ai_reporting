import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';

const LOVABLE_API_KEY = Deno.env.get('OPENROUTER_API_KEY')!;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const GATEWAY_URL = 'https://openrouter.ai/api/v1/chat/completions';

const sb = createClient(SUPABASE_URL, SERVICE_ROLE);

// Safe read-only tables the assistant can query
const ALLOWED_TABLES = new Set([
  'clients', 'leads', 'calls', 'funded_investors', 'tasks', 'task_assignees',
  'agency_members', 'meta_campaigns', 'meta_ad_sets', 'meta_ads',
  'fundad_creatives', 'fundad_batches', 'creatives', 'projects', 'client_assets',
  'deals', 'meetings', 'daily_metrics', 'v_client_performance_daily',
  'v_client_performance_weekly', 'v_client_performance_monthly',
  'client_offers', 'ai_agents',
]);

const tools = [
  {
    type: 'function',
    function: {
      name: 'query_table',
      description: 'Read rows from an approved table. Use filters to narrow scope. To count rows, pass select="id" with a large limit and read the returned "count". Do NOT use SQL aggregates like COUNT() — they are not supported.',
      parameters: {
        type: 'object',
        properties: {
          table: { type: 'string', description: 'Table or view name' },
          select: { type: 'string', description: 'Comma-separated columns or "*"', default: '*' },
          filters: {
            type: 'array',
            description: 'List of {column, op, value}. op = eq|neq|gt|gte|lt|lte|ilike|in',
            items: {
              type: 'object',
              properties: {
                column: { type: 'string' },
                op: { type: 'string' },
                value: {},
              },
              required: ['column', 'op', 'value'],
            },
          },
          order_by: { type: 'string', description: 'column name' },
          ascending: { type: 'boolean', default: false },
          limit: { type: 'number', default: 25 },
        },
        required: ['table'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'send_sms',
      description: 'Send SMS or WhatsApp via the High Performance Ads GHL account. Provide either member_ids (from agency_members table) or raw phone numbers. Optional media_url attaches an image/video as MMS.',
      parameters: {
        type: 'object',
        properties: {
          member_ids: { type: 'array', items: { type: 'string' } },
          phones: { type: 'array', items: { type: 'string' } },
          channel: { type: 'string', enum: ['SMS', 'WhatsApp'], default: 'SMS' },
          message: { type: 'string' },
          media_url: { type: 'string', description: 'Optional public URL of an image or video to attach' },
        },
        required: ['message'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'generate_image',
      description: 'Generate an image with AI from a text prompt. Returns a public URL that can be used as media_url in send_sms.',
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string' },
        },
        required: ['prompt'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_open_tasks',
      description: 'List open tasks (status todo/in_progress) with their current assignees, due date, comments count, and priority. Use this to triage or answer "what is on my plate" questions.',
      parameters: {
        type: 'object',
        properties: {
          client_id: { type: 'string', description: 'Optional. Filter to one client.' },
          assignee_member_id: { type: 'string', description: 'Optional. Tasks assigned to this agency_member.' },
          overdue_only: { type: 'boolean', default: false },
          limit: { type: 'number', default: 50 },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_task',
      description: 'Update a task. Provide task_id and any of: status (todo|in_progress|done), priority (low|medium|high), due_date (YYYY-MM-DD), title, description.',
      parameters: {
        type: 'object',
        properties: {
          task_id: { type: 'string' },
          status: { type: 'string', enum: ['todo','in_progress','done'] },
          priority: { type: 'string', enum: ['low','medium','high'] },
          due_date: { type: 'string' },
          title: { type: 'string' },
          description: { type: 'string' },
        },
        required: ['task_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_task_comment',
      description: 'Add a comment to a task.',
      parameters: {
        type: 'object',
        properties: {
          task_id: { type: 'string' },
          content: { type: 'string' },
          author_name: { type: 'string', default: 'AI Assistant' },
        },
        required: ['task_id', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_task_assignees',
      description: 'Replace the assignees on a task with the given members and/or pods. Empty arrays clear assignees.',
      parameters: {
        type: 'object',
        properties: {
          task_id: { type: 'string' },
          member_ids: { type: 'array', items: { type: 'string' }, default: [] },
          pod_ids: { type: 'array', items: { type: 'string' }, default: [] },
        },
        required: ['task_id'],
      },
    },
  },
];

const GHL_BASE = 'https://services.leadconnectorhq.com';

// Wrapper tools that proxy to other AI edge functions
const POWER_TOOLS = [
  { name: 'predictive_alerts', desc: 'Forecast next 7 days of CPL, lead volume, show rate per client. Returns risks.', params: { client_id: { type: 'string' } } },
  { name: 'spin_winners', desc: 'Generate N compliant variations (hook/headline/body/CTA swaps) of a winning ad. Saves drafts.', params: { ad_id: { type: 'string' }, count: { type: 'number', default: 5 }, client_id: { type: 'string' } }, required: ['ad_id'] },
  { name: 'score_creative', desc: 'Score a creative 0-100 on hook, clarity, CTA, compliance. Pass ad_id OR creative_id OR raw {hook,headline,primary_text,cta,image_url}.', params: { ad_id: { type: 'string' }, creative_id: { type: 'string' }, hook: { type: 'string' }, headline: { type: 'string' }, primary_text: { type: 'string' }, cta: { type: 'string' }, image_url: { type: 'string' } } },
  { name: 'smart_search', desc: 'Semantic search across calls (transcripts), tasks, deals, client_assets. Returns AI-synthesized answer + cited rows.', params: { query: { type: 'string' }, client_id: { type: 'string' } }, required: ['query'] },
  { name: 'budget_optimizer', desc: 'Analyze 14d CoC per campaign and propose daily budget reallocation for a client.', params: { client_id: { type: 'string' } }, required: ['client_id'] },
  { name: 'auto_crm_sync', desc: 'Summarize recent call transcripts into CRM notes and push to GHL. Optional client_id and days window.', params: { client_id: { type: 'string' }, days: { type: 'number', default: 1 } } },
  { name: 'competitive_intel', desc: 'Scrape a competitor landing page or ad URL and return SWOT + counter-angles.', params: { url: { type: 'string' }, client_id: { type: 'string' } }, required: ['url'] },
  { name: 'meeting_prep', desc: 'Generate a meeting prep brief for an upcoming meeting (talking points, context, action items).', params: { meeting_id: { type: 'string' } }, required: ['meeting_id'] },
];

for (const t of POWER_TOOLS) {
  const required = (t as any).required || [];
  tools.push({
    type: 'function',
    function: {
      name: t.name,
      description: t.desc,
      parameters: { type: 'object', properties: t.params as any, required },
    },
  } as any);
}

const POWER_TOOL_FN: Record<string, string> = {
  predictive_alerts: 'predictive-alerts',
  spin_winners: 'creative-spin-winners',
  score_creative: 'score-creative',
  smart_search: 'smart-search',
  budget_optimizer: 'budget-optimizer',
  auto_crm_sync: 'auto-crm-sync',
  competitive_intel: 'competitive-intel',
  meeting_prep: 'meeting-prep',
};

async function runPowerTool(name: string, args: any) {
  const fn = POWER_TOOL_FN[name];
  if (!fn) return { error: `unknown power tool ${name}` };
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${fn}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_ROLE}` },
    body: JSON.stringify(args || {}),
  });
  const txt = await res.text();
  if (!res.ok) return { error: `${fn} ${res.status}: ${txt.slice(0, 500)}` };
  try { return JSON.parse(txt); } catch { return { raw: txt }; }
}

const HPA_CLIENT_ID = '18acd701-92ff-4bbc-86aa-1f7cd9a9c973';

function normalizePhone(p: string): string {
  const d = p.replace(/[^\d+]/g, '');
  if (d.startsWith('+')) return d;
  if (d.length === 10) return '+1' + d;
  if (d.length === 11 && d.startsWith('1')) return '+' + d;
  return '+' + d;
}

async function runQueryTable(args: any) {
  const table = String(args.table || '');
  if (!ALLOWED_TABLES.has(table)) {
    return { error: `Table "${table}" not allowed. Allowed: ${[...ALLOWED_TABLES].join(', ')}` };
  }
  let q: any = sb.from(table).select(args.select || '*');
  for (const f of args.filters || []) {
    const op = String(f.op).toLowerCase();
    if (op === 'in' && Array.isArray(f.value)) q = q.in(f.column, f.value);
    else if (['eq','neq','gt','gte','lt','lte','ilike'].includes(op)) q = q[op](f.column, f.value);
  }
  if (args.order_by) q = q.order(args.order_by, { ascending: !!args.ascending });
  q = q.limit(Math.min(args.limit ?? 25, 100));
  const { data, error } = await q;
  if (error) return { error: error.message };
  return { rows: data, count: data?.length || 0 };
}

async function runGenerateImage(args: any) {
  const prompt = String(args.prompt || '').trim();
  if (!prompt) return { error: 'prompt required' };
  const res = await fetch(GATEWAY_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${LOVABLE_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'google/gemini-2.5-flash-image-preview',
        models: ['google/gemini-2.5-flash-image-preview', "google/gemini-2.0-flash-001", "openai/gpt-4o-mini"],
      messages: [{ role: 'user', content: prompt }],
      modalities: ['image', 'text'],
    }),
  });
  if (!res.ok) return { error: `image gen failed: ${res.status} ${await res.text()}` };
  const data = await res.json();
  const b64 = data.choices?.[0]?.message?.images?.[0]?.image_url?.url
    || data.choices?.[0]?.message?.images?.[0]?.url;
  if (!b64) return { error: 'no image returned' };
  // upload base64 → assets bucket
  const m = b64.match(/^data:(.+?);base64,(.+)$/);
  const mime = m ? m[1] : 'image/png';
  const raw = m ? m[2] : b64;
  const bytes = Uint8Array.from(atob(raw), c => c.charCodeAt(0));
  const path = `studio-assistant/${Date.now()}.${mime.split('/')[1] || 'png'}`;
  const up = await sb.storage.from('assets').upload(path, bytes, { contentType: mime, upsert: false });
  if (up.error) return { error: up.error.message };
  const { data: pub } = sb.storage.from('assets').getPublicUrl(path);
  return { url: pub.publicUrl };
}

async function runSendSms(args: any) {
  const message = String(args.message || '').trim();
  if (!message) return { error: 'message required' };
  const channel = args.channel === 'WhatsApp' ? 'WhatsApp' : 'SMS';

  const { data: client } = await sb
    .from('clients')
    .select('ghl_api_key, ghl_location_id')
    .eq('id', HPA_CLIENT_ID)
    .maybeSingle();
  if (!client?.ghl_api_key || !client?.ghl_location_id) {
    return { error: 'HPA GHL credentials not configured' };
  }

  const recipients: { name: string; phone: string }[] = [];
  if (args.member_ids?.length) {
    const { data: members } = await sb
      .from('agency_members').select('id,name,phone').in('id', args.member_ids);
    for (const m of members || []) {
      if (m.phone) recipients.push({ name: m.name, phone: normalizePhone(m.phone) });
    }
  }
  for (const p of args.phones || []) recipients.push({ name: 'Recipient', phone: normalizePhone(p) });
  if (!recipients.length) return { error: 'no valid recipients' };

  const ghlHeaders = {
    Authorization: `Bearer ${client.ghl_api_key}`,
    'Content-Type': 'application/json',
    Version: '2021-04-15',
  };

  const results: any[] = [];
  for (const r of recipients) {
    // find/create contact
    let contactId: string | null = null;
    try {
      const sres = await fetch(
        `${GHL_BASE}/contacts/?locationId=${client.ghl_location_id}&query=${encodeURIComponent(r.phone)}&limit=1`,
        { headers: { ...ghlHeaders, Version: '2021-07-28' } }
      );
      if (sres.ok) {
        const sd = await sres.json();
        contactId = sd.contacts?.[0]?.id || null;
      }
    } catch {}
    if (!contactId) {
      const cres = await fetch(`${GHL_BASE}/contacts/`, {
        method: 'POST',
        headers: { ...ghlHeaders, Version: '2021-07-28' },
        body: JSON.stringify({ locationId: client.ghl_location_id, phone: r.phone, name: r.name, source: 'Studio Assistant' }),
      });
      if (cres.ok) contactId = (await cres.json()).contact?.id || null;
    }
    if (!contactId) { results.push({ phone: r.phone, success: false, error: 'contact failed' }); continue; }

    const payload: any = { type: channel, contactId, message };
    if (args.media_url) payload.attachments = [args.media_url];

    const sendRes = await fetch(`${GHL_BASE}/conversations/messages`, {
      method: 'POST', headers: ghlHeaders, body: JSON.stringify(payload),
    });
    if (!sendRes.ok) results.push({ phone: r.phone, success: false, error: `${sendRes.status} ${await sendRes.text()}` });
    else results.push({ phone: r.phone, success: true });
  }
  return { sent: results.filter(r => r.success).length, total: recipients.length, results };
}

async function execTool(name: string, args: any) {
  try {
    if (name === 'query_table') return await runQueryTable(args);
    if (name === 'send_sms') return await runSendSms(args);
    if (name === 'generate_image') return await runGenerateImage(args);
    if (name === 'list_open_tasks') return await runListOpenTasks(args);
    if (name === 'update_task') return await runUpdateTask(args);
    if (name === 'add_task_comment') return await runAddTaskComment(args);
    if (name === 'set_task_assignees') return await runSetTaskAssignees(args);
    if (POWER_TOOL_FN[name]) return await runPowerTool(name, args);
    return { error: `unknown tool ${name}` };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

// =================== Task management tools ===================
async function runListOpenTasks(args: any) {
  let q = sb
    .from('tasks')
    .select('id, client_id, title, description, status, priority, stage, due_date, assigned_to, created_at, clients(name), task_assignees(member_id, pod_id, member:agency_members(id,name), pod:agency_pods(id,name))')
    .in('status', ['todo', 'in_progress'])
    .order('due_date', { ascending: true, nullsFirst: false })
    .limit(Math.min(args.limit ?? 50, 200));
  if (args.client_id) q = q.eq('client_id', args.client_id);
  if (args.overdue_only) q = q.lt('due_date', new Date().toISOString().slice(0, 10));
  const { data, error } = await q;
  if (error) return { error: error.message };
  let rows = data || [];
  if (args.assignee_member_id) {
    rows = rows.filter((t: any) =>
      (t.task_assignees || []).some((a: any) => a.member_id === args.assignee_member_id) ||
      t.assigned_to === args.assignee_member_id,
    );
  }
  return { count: rows.length, tasks: rows };
}

async function runUpdateTask(args: any) {
  if (!args.task_id) return { error: 'task_id required' };
  const patch: Record<string, any> = {};
  for (const k of ['status', 'priority', 'due_date', 'title', 'description']) {
    if (args[k] !== undefined) patch[k] = args[k];
  }
  if (Object.keys(patch).length === 0) return { error: 'no fields to update' };
  if (patch.status === 'done') patch.completed_at = new Date().toISOString();
  const { data, error } = await sb.from('tasks').update(patch).eq('id', args.task_id).select('id, title, status, priority, due_date').single();
  if (error) return { error: error.message };
  await sb.from('task_history').insert({
    task_id: args.task_id,
    action: 'ai_updated',
    new_value: JSON.stringify(patch),
    changed_by: 'AI Assistant',
  }).then(() => {}, () => {});
  return { updated: data };
}

async function runAddTaskComment(args: any) {
  if (!args.task_id || !args.content) return { error: 'task_id and content required' };
  const { data, error } = await sb.from('task_comments').insert({
    task_id: args.task_id,
    author_name: args.author_name || 'AI Assistant',
    content: args.content,
  }).select('id, created_at').single();
  if (error) return { error: error.message };
  return { comment_id: data.id, created_at: data.created_at };
}

async function runSetTaskAssignees(args: any) {
  if (!args.task_id) return { error: 'task_id required' };
  await sb.from('task_assignees').delete().eq('task_id', args.task_id);
  const rows = [
    ...((args.member_ids || []) as string[]).map((id) => ({ task_id: args.task_id, member_id: id, pod_id: null })),
    ...((args.pod_ids || []) as string[]).map((id) => ({ task_id: args.task_id, member_id: null, pod_id: id })),
  ];
  if (rows.length) {
    const { error } = await sb.from('task_assignees').insert(rows);
    if (error) return { error: error.message };
    // Mirror first member into legacy assigned_to column
    const firstMember = (args.member_ids || [])[0];
    if (firstMember) {
      await sb.from('tasks').update({ assigned_to: firstMember }).eq('id', args.task_id);
    }
  } else {
    await sb.from('tasks').update({ assigned_to: null }).eq('id', args.task_id);
  }
  return { ok: true, assignees: rows.length };
}

const SYSTEM_PROMPT = `You are the AI Studio Assistant inside the High Performance Ads internal dashboard. You help Zac and the team by:
- Answering questions about clients, leads, calls, funded investors, tasks, ad performance, and creatives by querying the database with the query_table tool.
- Sending SMS or WhatsApp messages on demand via the send_sms tool (uses the HPA GHL account). You can attach generated images/videos using media_url for MMS.
- Generating images on demand with generate_image (returns a public URL you can include in messages).

Rules:
- Be concise. Use markdown. Show numbers with proper units (currency, %, etc.).
- For investment marketing copy, never use "guaranteed"; use "targeted returns" and include risk disclaimers.
- Before sending any SMS/WhatsApp, briefly confirm the recipient and message in your reply, then call the tool. If the user has already said "send it", just send.
- When asked for performance, prefer the v_client_performance_* views.
- Lead counts require non-empty email AND phone.
- Cite which table you pulled data from in a small footnote.
- You can manage tasks: use list_open_tasks to find tasks, update_task to change status/due/priority/title, add_task_comment to leave notes, set_task_assignees to re-route to agency members or pods. When the user asks "reassign", "change due date", "mark done", "comment on", etc., act directly using these tools (after one short confirmation if destructive).
- Power AI tools available: predictive_alerts (forecast risks), spin_winners (variations of a winning ad), score_creative (0-100 quality score), smart_search (semantic search across calls/tasks/deals/assets), budget_optimizer (CoC-based reallocation), auto_crm_sync (push call summaries to GHL), competitive_intel (SWOT on a URL), meeting_prep (brief for a meeting_id). Use them proactively when the user asks "is X at risk", "spin this ad", "search for", "rebalance budget", "summarize call", "compare to competitor", "prep me for meeting".`;

// Power tools available (call by name):
// predictive_alerts, spin_winners, score_creative, smart_search,
// budget_optimizer, auto_crm_sync, competitive_intel, meeting_prep.

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const { messages = [], attachments = [] } = await req.json();
    // Accept attachments on the last user message (image_url[] or pdf data URLs)
    const convo: any[] = [{ role: 'system', content: SYSTEM_PROMPT }, ...messages];
    if (Array.isArray(attachments) && attachments.length && convo.length > 1) {
      const last = convo[convo.length - 1];
      if (last.role === 'user') {
        const parts: any[] = [{ type: 'text', text: typeof last.content === 'string' ? last.content : '' }];
        for (const a of attachments) {
          if (a.kind === 'image' && a.url) parts.push({ type: 'image_url', image_url: { url: a.url } });
          else if (a.kind === 'pdf' && a.data) parts.push({ type: 'file', file: { filename: a.name || 'file.pdf', file_data: a.data } });
        }
        last.content = parts;
      }
    }
    const toolEvents: any[] = [];

    for (let step = 0; step < 8; step++) {
      const res = await fetch(GATEWAY_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        },
        body: JSON.stringify({
          model: "openrouter/owl-alpha",
        models: ["openrouter/owl-alpha", "google/gemini-2.0-flash-001", "openai/gpt-4o-mini"],
          messages: convo,
          tools,
          tool_choice: 'auto',
        }),
      });
      if (res.status === 429) {
        return new Response(JSON.stringify({ error: 'Rate limited. Try again shortly.' }), {
          status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      if (res.status === 402) {
        return new Response(JSON.stringify({ error: 'AI credits exhausted. Add credits in workspace settings.' }), {
          status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      if (!res.ok) {
        const txt = await res.text();
        return new Response(JSON.stringify({ error: `Gateway error: ${res.status} ${txt}` }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const data = await res.json();
      const msg = data.choices?.[0]?.message;
      if (!msg) break;

      const toolCalls = msg.tool_calls || [];
      if (!toolCalls.length) {
        return new Response(JSON.stringify({
          content: msg.content || '',
          tool_events: toolEvents,
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      convo.push({ role: 'assistant', content: msg.content || '', tool_calls: toolCalls });
      for (const tc of toolCalls) {
        let args: any = {};
        try { args = JSON.parse(tc.function.arguments || '{}'); } catch {}
        const result = await execTool(tc.function.name, args);
        toolEvents.push({ name: tc.function.name, args, result });
        convo.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: JSON.stringify(result).slice(0, 8000),
        });
      }
    }

    return new Response(JSON.stringify({
      content: 'Reached max tool iterations.',
      tool_events: toolEvents,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});