import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';

const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY')!;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const GATEWAY_URL = 'https://ai.gateway.lovable.dev/v1/chat/completions';

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
];

const GHL_BASE = 'https://services.leadconnectorhq.com';
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
      'Lovable-API-Key': LOVABLE_API_KEY,
    },
    body: JSON.stringify({
      model: 'google/gemini-2.5-flash-image-preview',
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
    return { error: `unknown tool ${name}` };
  } catch (e) {
    return { error: (e as Error).message };
  }
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
- Cite which table you pulled data from in a small footnote.`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const { messages = [] } = await req.json();
    const convo: any[] = [{ role: 'system', content: SYSTEM_PROMPT }, ...messages];
    const toolEvents: any[] = [];

    for (let step = 0; step < 8; step++) {
      const res = await fetch(GATEWAY_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Lovable-API-Key': LOVABLE_API_KEY,
        },
        body: JSON.stringify({
          model: 'google/gemini-2.5-flash',
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