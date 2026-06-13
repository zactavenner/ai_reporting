import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function todayPST(): string {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' });
  return fmt.format(new Date()); // YYYY-MM-DD
}

function yesterdayPST(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' });
  return fmt.format(d);
}

function parseSheetUrl(url?: string | null): { sheet_id: string; gid?: string } | null {
  if (!url) return null;
  const m = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (!m) return null;
  const g = url.match(/[#?&]gid=(\d+)/);
  return { sheet_id: m[1], gid: g?.[1] };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const LOVABLE_API_KEY = Deno.env.get('OPENROUTER_API_KEY')!;
    const SLACK_BOT_TOKEN = Deno.env.get('SLACK_BOT_TOKEN');

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
    const today = todayPST();
    const yest = yesterdayPST();

    // 1. Tasks due today (all clients)
    const { data: tasks = [] } = await supabase
      .from('tasks')
      .select('id,title,client_id,assigned_to,status,due_date,priority')
      .gte('due_date', `${today}T00:00:00`)
      .lt('due_date', `${today}T23:59:59`)
      .neq('status', 'done')
      .order('priority', { ascending: false });

    // 2. Clients + KPI sheet URLs
    const { data: clients = [] } = await supabase
      .from('clients')
      .select('id,name,status')
      .in('status', ['active', 'onboarding', 'paused']);

    const { data: settingsRows = [] } = await supabase
      .from('client_settings')
      .select('client_id,kpi_google_sheet_url');

    const sheetMap = new Map<string, string | null>();
    (settingsRows || []).forEach((r: any) => sheetMap.set(r.client_id, r.kpi_google_sheet_url));

    // 3. For each client w/ sheet → fetch yesterday's stats. Without sheet → alert.
    const sheetAlerts: any[] = [];
    const clientStats: any[] = [];

    await Promise.all((clients || []).map(async (c: any) => {
      const url = sheetMap.get(c.id);
      const parsed = parseSheetUrl(url);
      if (!parsed) {
        sheetAlerts.push({ client_id: c.id, client_name: c.name, reason: 'No KPI Google Sheet configured' });
        return;
      }
      try {
        const r = await fetch(`${SUPABASE_URL}/functions/v1/fetch-sheet-metrics`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', apikey: SERVICE_KEY },
          body: JSON.stringify({ sheet_id: parsed.sheet_id, gid: parsed.gid, start_date: yest, end_date: yest }),
        });
        if (!r.ok) {
          sheetAlerts.push({ client_id: c.id, client_name: c.name, reason: `Sheet fetch failed (${r.status})` });
          return;
        }
        const j = await r.json();
        clientStats.push({ client_id: c.id, client_name: c.name, date: yest, aggregated: j?.aggregated || null });
      } catch (err) {
        sheetAlerts.push({ client_id: c.id, client_name: c.name, reason: (err as Error).message });
      }
    }));

    // 4. AI summary via Lovable Gateway
    const systemPrompt = `You are an executive operations analyst for a paid-ads & investor-funnel agency.
Produce a crisp daily morning brief in markdown. Compliance: never use "guaranteed"; refer to investment outcomes as "targeted"/historical.
Sections:
## Top priorities today
(2-4 bullets — most important tasks/risks across the portfolio)
## Tasks due today
(grouped by client, include title + priority)
## Yesterday's performance — by client
(spend, leads, calls, funded if available; flag anomalies)
## Alerts
(missing sheets, broken sheets, suspicious drops)
Keep it tight, scannable, and specific with numbers.`;

    const userPayload = { date: today, prior_date: yest, tasks_due_today: tasks, client_stats: clientStats, sheet_alerts: sheetAlerts };

    let aiSummary = '';
    try {
      const aiRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: "openrouter/owl-alpha",
        models: ["openrouter/owl-alpha", "google/gemini-2.0-flash-001", "openai/gpt-4o-mini"],
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: JSON.stringify(userPayload) },
          ],
          temperature: 0.3,
        }),
      });
      if (aiRes.ok) {
        const aiJson = await aiRes.json();
        aiSummary = aiJson?.choices?.[0]?.message?.content || '';
      } else {
        aiSummary = `(AI summary unavailable: ${aiRes.status})`;
      }
    } catch (err) {
      aiSummary = `(AI summary error: ${(err as Error).message})`;
    }

    // 5. Upsert into daily_ai_summaries
    const { error: upErr } = await supabase
      .from('daily_ai_summaries')
      .upsert({
        summary_date: today,
        tasks_due_today: tasks,
        sheet_alerts: sheetAlerts,
        client_stats: clientStats,
        ai_summary: aiSummary,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'summary_date' });
    if (upErr) console.error('upsert error', upErr);

    // 6. Best-effort Slack delivery
    let deliveredSlack = false;
    if (SLACK_BOT_TOKEN) {
      try {
        const { data: agency } = await supabase.from('agency_settings').select('slack_daily_channel_id').limit(1).maybeSingle();
        const channel = (agency as any)?.slack_daily_channel_id;
        if (channel) {
          const slackRes = await fetch('https://slack.com/api/chat.postMessage', {
            method: 'POST',
            headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ channel, text: `*Daily Brief — ${today}*\n\n${aiSummary.slice(0, 3500)}` }),
          });
          const slackJson = await slackRes.json();
          deliveredSlack = !!slackJson?.ok;
        }
      } catch (err) {
        console.error('slack delivery error', err);
      }
    }
    if (deliveredSlack) {
      await supabase.from('daily_ai_summaries').update({ delivered_slack: true }).eq('summary_date', today);
    }

    return new Response(JSON.stringify({
      success: true,
      date: today,
      tasks_count: tasks.length,
      clients_with_stats: clientStats.length,
      alerts: sheetAlerts.length,
      delivered_slack: deliveredSlack,
      summary: aiSummary,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('daily-ai-summary error:', msg);
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});