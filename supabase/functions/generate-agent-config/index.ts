import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const AI_GATEWAY_URL = 'https://openrouter.ai/api/v1/chat/completions';

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { description } = await req.json();
    if (!description) {
      return new Response(JSON.stringify({ error: 'description required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get('OPENROUTER_API_KEY');
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: 'OPENROUTER_API_KEY not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const systemPrompt = `You are an AI agent configuration generator for a capital raising agency platform. Given a user's description of what they want an agent to do, generate a complete agent configuration.

Available connectors (pick only relevant ones):
- "database" — Access leads, calls, daily_metrics, funded_investors, ad_spend_reports, call_analysis, client_settings, client_offers, alert_configs
- "tasks" — Access project tasks with full assignee details (unassigned_tasks, multi_owner_tasks, overdue_tasks with assignee names). Can WRITE BACK comments to tasks via "task_comments" output field.
- "meta_ads" — Pull live ad spend and campaign data from Meta Ads API
- "meta_ads" — Pull live ad spend and campaign data from Meta Ads API
- "ghl_crm" — Access GoHighLevel contacts, pipelines, calendars
- "slack" — Send messages and reports to Slack channels
- "claude_code" — Connect to Claude Code Desktop for automations via MCP

Available models:
- "nvidia/nemotron-3-ultra:free" — Best for complex reasoning, analysis, multi-step tasks
- "nvidia/nemotron-3-ultra:free" — Good balance of speed and quality
- "nvidia/nemotron-3-ultra:free" — Fast, cheap, for simple checks
- "nvidia/nemotron-3-ultra:free" — Latest balanced model
- "nvidia/nemotron-3-ultra:free" — Latest premium model
- "openai/gpt-5" — Strong reasoning, expensive
- "openai/gpt-5-mini" — Good mid-tier

Common schedule presets (use cron format):
- Every 15 min: "*/15 * * * *"
- Every 30 min: "*/30 * * * *"
- Hourly: "0 * * * *"
- Every 2 hours: "0 */2 * * *"
- Daily 6 AM: "0 6 * * *"
- Daily 9 AM: "0 9 * * *"
- Weekdays 9 AM: "0 9 * * 1-5"
- Weekly Monday 9 AM: "0 9 * * 1"

The prompt_template should use these variables:
- {{client_name}} — replaced with actual client name
- {{date}} — today's date
- {{yesterday}} — yesterday's date
- {{data}} — JSON data from connectors

RESPOND ONLY WITH VALID JSON matching this exact schema:
{
  "name": "string (short, memorable name)",
  "icon": "string (single emoji)",
  "description": "string (1-2 sentence description)",
  "model": "string (model ID from list above)",
  "schedule_cron": "string (cron expression)",
  "connectors": ["string array of connector keys"],
  "prompt_template": "string (detailed prompt with {{variables}})"
}

When the "tasks" connector is selected, ALWAYS include a "task_comments" field in the output schema:
- "task_comments": array of { "task_id": "string", "comment": "string" }
- Use this to write automated comments on tasks (e.g., asking owners for updates on overdue tasks, requesting owner designation on multi-owner tasks)

Make the prompt_template detailed and specific. Include:
1. A role definition
2. What data to analyze
3. What to output (always JSON with specific fields)
4. Include "escalations", "slack_message", and "task_comments" (when tasks connector is used) fields in the output schema`;

    const aiRes = await fetch(AI_GATEWAY_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: "nvidia/nemotron-3-ultra:free",
        models: ["nvidia/nemotron-3-ultra:free", "google/gemini-2.0-flash-001", "openai/gpt-4o-mini"],
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: description },
        ],
        temperature: 0.4,
      }),
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text();
      if (aiRes.status === 429) {
        return new Response(JSON.stringify({ error: 'Rate limited — please try again later' }), {
          status: 429,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      if (aiRes.status === 402) {
        return new Response(JSON.stringify({ error: 'AI credits exhausted — please add funds' }), {
          status: 402,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      throw new Error(`AI Gateway error ${aiRes.status}: ${errText}`);
    }

    const aiData = await aiRes.json();
    const content = aiData.choices?.[0]?.message?.content || '';
    
    // Parse JSON from AI response
    const cleaned = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const config = JSON.parse(cleaned);

    // Validate required fields
    if (!config.name || !config.prompt_template) {
      throw new Error('AI generated incomplete config');
    }

    return new Response(JSON.stringify({ success: true, config }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err: any) {
    console.error('generate-agent-config error:', err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
