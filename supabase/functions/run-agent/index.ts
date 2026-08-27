import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getSoulSystemPrompt } from '../_shared/souls/index.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const AI_GATEWAY_URL = 'https://ai.gateway.lovable.dev/v1/chat/completions';

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { agent_id, client_id: overrideClientId } = await req.json();
    if (!agent_id) {
      return new Response(JSON.stringify({ error: 'agent_id required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: 'LOVABLE_API_KEY not configured' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const cloudUrl = Deno.env.get('SUPABASE_URL')!;
    const cloudKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const cloudDb = createClient(cloudUrl, cloudKey);

    const prodUrl = Deno.env.get('ORIGINAL_SUPABASE_URL') || cloudUrl;
    const prodKey = Deno.env.get('ORIGINAL_SUPABASE_SERVICE_ROLE_KEY') || cloudKey;
    const prodDb = createClient(prodUrl, prodKey);

    // Load agent config
    const { data: agent, error: agentErr } = await cloudDb
      .from('agents').select('*').eq('id', agent_id).single();

    if (agentErr || !agent) {
      return new Response(JSON.stringify({ error: 'Agent not found' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Auto-disable after 3 consecutive failures
    if ((agent.consecutive_failures || 0) >= 3) {
      await cloudDb.from('agents').update({ enabled: false, updated_at: new Date().toISOString() }).eq('id', agent_id);
      return new Response(JSON.stringify({ status: 'disabled', reason: 'Auto-disabled after 3 consecutive failures' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Determine clients to process
    const targetClientId = overrideClientId || agent.client_id;
    let clientsToProcess: any[] = [];

    if (targetClientId) {
      const { data: c } = await prodDb.from('clients').select('id, name, ghl_api_key, ghl_location_id, meta_ad_account_id, meta_access_token').eq('id', targetClientId).single();
      if (c) clientsToProcess = [c];
    } else {
      const { data: cs } = await prodDb.from('clients').select('id, name, ghl_api_key, ghl_location_id, meta_ad_account_id, meta_access_token').in('status', ['active', 'onboarding']);
      clientsToProcess = cs || [];
    }

    if (clientsToProcess.length === 0) {
      return new Response(JSON.stringify({ success: true, results: [], note: 'No clients to process' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const results: any[] = [];

    for (const client of clientsToProcess) {
      const runStart = Date.now();

      // Create run record
      const { data: run } = await cloudDb.from('agent_runs').insert({
        agent_id,
        client_id: client.id,
        status: 'running',
        started_at: new Date().toISOString(),
      }).select().single();

      const runId = run?.id;

      try {
        const connectors = agent.connectors || ['database'];
        const dataContext: Record<string, any> = {};
        const today = new Date();
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = yesterday.toISOString().split('T')[0];
        const todayStr = today.toISOString().split('T')[0];
        const weekAgoStr = new Date(today.getTime() - 7 * 86400000).toISOString().split('T')[0];

        // ── DATABASE connector: gather comprehensive data ──
        if (connectors.includes('database')) {
          // Core metrics
          const { count: leadsCount } = await prodDb
            .from('leads')
            .select('*', { count: 'exact', head: true })
            .eq('client_id', client.id)
            .gte('created_at', yesterdayStr)
            .lt('created_at', todayStr);

          const { count: spamCount } = await prodDb
            .from('leads')
            .select('*', { count: 'exact', head: true })
            .eq('client_id', client.id)
            .eq('is_spam', true)
            .gte('created_at', yesterdayStr)
            .lt('created_at', todayStr);

          const { data: calls } = await prodDb
            .from('calls')
            .select('id, showed, is_reconnect, booked_at, scheduled_at, outcome, quality_score, appointment_status')
            .eq('client_id', client.id)
            .gte('booked_at', yesterdayStr)
            .lt('booked_at', todayStr);

          const { data: metrics } = await prodDb
            .from('daily_metrics')
            .select('*')
            .eq('client_id', client.id)
            .eq('date', yesterdayStr)
            .maybeSingle();

          // 7-day metrics trend
          const { data: weekMetrics } = await prodDb
            .from('daily_metrics')
            .select('date, leads, calls, showed_calls, funded, ad_spend')
            .eq('client_id', client.id)
            .gte('date', weekAgoStr)
            .lte('date', yesterdayStr)
            .order('date', { ascending: true });

          const { data: funded } = await prodDb
            .from('funded_investors')
            .select('id, funded_amount, commitment_amount, funded_at, time_to_fund_days, calls_to_fund')
            .eq('client_id', client.id)
            .gte('funded_at', yesterdayStr)
            .lt('funded_at', todayStr);

          // Ad spend reports
          const { data: adSpend } = await prodDb
            .from('ad_spend_reports')
            .select('spend, impressions, clicks, campaign_name')
            .eq('client_id', client.id)
            .eq('reported_at', yesterdayStr);

          // Call analysis scores
          const { data: callAnalysis } = await prodDb
            .from('call_analysis')
            .select('score_rapport, score_qualification, score_objection_handling, sentiment, compliance_flags, summary')
            .eq('client_id', client.id)
            .gte('call_date', yesterdayStr)
            .lt('call_date', todayStr);

          // Pipeline data
          const { data: pipelines } = await prodDb
            .from('client_pipelines')
            .select('id, name, ghl_pipeline_id')
            .eq('client_id', client.id);

          // Client settings & offers
          const { data: settings } = await prodDb
            .from('client_settings')
            .select('*')
            .eq('client_id', client.id)
            .maybeSingle();

          const { data: offers } = await prodDb
            .from('client_offers')
            .select('id, title, offer_type, fund_type, raise_amount, min_investment')
            .eq('client_id', client.id);

          // Alert configs
          const { data: alerts } = await prodDb
            .from('alert_configs')
            .select('metric, operator, threshold, enabled')
            .eq('client_id', client.id);

          const callStats = calls || [];
          const newCalls = callStats.filter((c: any) => !c.is_reconnect);
          const reconnects = callStats.filter((c: any) => c.is_reconnect);

          dataContext.database = {
            leads_count: leadsCount || 0,
            spam_count: spamCount || 0,
            spam_rate_pct: leadsCount ? Math.round(((spamCount || 0) / leadsCount) * 100) : 0,
            calls_count: newCalls.length,
            showed_count: newCalls.filter((c: any) => c.showed).length,
            show_rate_pct: newCalls.length ? Math.round((newCalls.filter((c: any) => c.showed).length / newCalls.length) * 100) : 0,
            reconnect_count: reconnects.length,
            reconnect_showed: reconnects.filter((c: any) => c.showed).length,
            daily_metrics: metrics,
            weekly_trend: weekMetrics || [],
            funded_investors: funded || [],
            funded_count: funded?.length || 0,
            funded_total: funded?.reduce((s: number, f: any) => s + (f.funded_amount || f.commitment_amount || 0), 0) || 0,
            ad_spend_reports: adSpend || [],
            total_ad_spend: adSpend?.reduce((s: number, a: any) => s + (a.spend || 0), 0) || 0,
            call_analysis: callAnalysis || [],
            avg_call_scores: callAnalysis?.length ? {
              rapport: Math.round((callAnalysis.reduce((s: number, c: any) => s + (c.score_rapport || 0), 0) / callAnalysis.length) * 10) / 10,
              qualification: Math.round((callAnalysis.reduce((s: number, c: any) => s + (c.score_qualification || 0), 0) / callAnalysis.length) * 10) / 10,
              objection_handling: Math.round((callAnalysis.reduce((s: number, c: any) => s + (c.score_objection_handling || 0), 0) / callAnalysis.length) * 10) / 10,
            } : null,
            pipelines: pipelines || [],
            settings,
            offers: offers || [],
            alert_configs: alerts || [],
          };
        }

        // ── META ADS connector ──
        if (connectors.includes('meta_ads') && client.meta_access_token && client.meta_ad_account_id) {
          try {
            const metaUrl = `https://graph.facebook.com/v19.0/act_${client.meta_ad_account_id}/insights?fields=spend,impressions,clicks,ctr,cpc,cpm,actions&time_range={"since":"${yesterdayStr}","until":"${yesterdayStr}"}&access_token=${client.meta_access_token}`;
            const metaRes = await fetch(metaUrl);
            const metaData = await metaRes.json();
            dataContext.meta_ads = metaData.data?.[0] || { note: 'No Meta data for this date' };
          } catch (e) {
            dataContext.meta_ads = { error: 'Failed to fetch Meta data' };
          }
        }

        // ── GHL CRM connector ──
        if (connectors.includes('ghl_crm') && client.ghl_api_key && client.ghl_location_id) {
          try {
            const ghlHeaders = {
              'Authorization': `Bearer ${client.ghl_api_key}`,
              'Version': '2021-07-28',
            };
            const contactsRes = await fetch(
              `https://services.leadconnectorhq.com/contacts/?locationId=${client.ghl_location_id}&startAfter=${yesterdayStr}&limit=100`,
              { headers: ghlHeaders }
            );
            const contactsData = await contactsRes.json();
            dataContext.ghl_crm = {
              contacts_count: contactsData.contacts?.length || 0,
              contacts_sample: (contactsData.contacts || []).slice(0, 5),
            };
          } catch (e) {
            dataContext.ghl_crm = { error: 'Failed to fetch GHL data' };
          }
        }

        // Build prompt with variable interpolation
        let prompt = agent.prompt_template;
        prompt = prompt.replace(/\{\{client_name\}\}/g, client.name);
        prompt = prompt.replace(/\{\{date\}\}/g, todayStr);
        prompt = prompt.replace(/\{\{yesterday\}\}/g, yesterdayStr);
        prompt = prompt.replace(/\{\{data\}\}/g, JSON.stringify(dataContext, null, 2));

        const inputSummary = `Client: ${client.name}. Connectors: ${connectors.join(', ')}. Data: ${Object.keys(dataContext).join(', ')}`;

        // Agents with a registered soul get their persona layer ahead of the
        // task instructions; the JSON contract stays last so it always wins.
        const soulPrompt = getSoulSystemPrompt(agent.template_key);
        const baseSystemPrompt = 'You are an AI agent executing a scheduled task for a capital raising agency. Analyze the provided data thoroughly and respond ONLY with valid JSON (no markdown fences). Be specific with numbers and actionable with recommendations.';
        const systemPrompt = soulPrompt ? `${soulPrompt}\n\n${baseSystemPrompt}` : baseSystemPrompt;

        // Call AI via Lovable AI Gateway
        const aiBody: any = {
          model: agent.model || 'google/gemini-2.5-flash',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: prompt },
          ],
          temperature: Number(agent.temperature) || 0.3,
        };
        if (agent.max_tokens) aiBody.max_tokens = agent.max_tokens;

        const aiRes = await fetch(AI_GATEWAY_URL, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${LOVABLE_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(aiBody),
        });

        if (!aiRes.ok) {
          const errText = await aiRes.text();
          if (aiRes.status === 429) throw new Error('Rate limited — please try again later');
          if (aiRes.status === 402) throw new Error('AI credits exhausted');
          throw new Error(`AI Gateway error ${aiRes.status}: ${errText}`);
        }

        const aiData = await aiRes.json();
        const aiOutput = aiData.choices?.[0]?.message?.content || 'No response from AI';
        const usage = aiData.usage || {};
        const tokensUsed = (usage.prompt_tokens || 0) + (usage.completion_tokens || 0);
        const durationMs = Date.now() - runStart;

        // Parse AI output for automated actions
        let actionsTaken: any[] = [];
        try {
          const cleaned = aiOutput.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
          const parsed = JSON.parse(cleaned);

          // Apply corrections to daily_metrics
          if (parsed.corrections && Object.keys(parsed.corrections).length > 0 && connectors.includes('database')) {
            await prodDb
              .from('daily_metrics')
              .upsert({
                client_id: client.id,
                date: yesterdayStr,
                ...parsed.corrections,
                updated_at: new Date().toISOString(),
              }, { onConflict: 'client_id,date' });
            actionsTaken.push({ type: 'daily_metrics_update', corrections: parsed.corrections });
          }

          // Handle escalations
          if (parsed.escalations?.length) {
            for (const esc of parsed.escalations) {
              if (!esc.title || !esc.description) continue;
              await cloudDb.from('agent_escalations').insert({
                agent_name: agent.name,
                severity: esc.severity || 'medium',
                category: esc.category || null,
                title: esc.title,
                description: esc.description,
                context: { client_id: client.id, client_name: client.name, ...(esc.context || {}) },
              });
              actionsTaken.push({ type: 'escalation', severity: esc.severity, title: esc.title });
            }
          }

          // Post Slack message to client channel
          if (parsed.slack_message && connectors.includes('slack')) {
            const slackApiKey = Deno.env.get('SLACK_API_KEY');
            if (slackApiKey && LOVABLE_API_KEY) {
              const { data: cs } = await prodDb.from('client_settings').select('slack_channel_id').eq('client_id', client.id).maybeSingle();
              const channelId = cs?.slack_channel_id;
              if (channelId) {
                await fetch('https://connector-gateway.lovable.dev/slack/api/chat.postMessage', {
                  method: 'POST',
                  headers: {
                    'Authorization': `Bearer ${LOVABLE_API_KEY}`,
                    'X-Connection-Api-Key': slackApiKey,
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({ channel: channelId, text: parsed.slack_message }),
                });
                actionsTaken.push({ type: 'slack_channel_message', channel: channelId });
              }
            }
          }

          // DM notification to agency owner
          const slackApiKey = Deno.env.get('SLACK_API_KEY');
          if (slackApiKey && LOVABLE_API_KEY) {
            const { data: agencySettings } = await cloudDb
              .from('agency_settings')
              .select('slack_dm_user_id, agent_notification_slack_dm')
              .limit(1)
              .maybeSingle();

            const dmUserId = agencySettings?.slack_dm_user_id;
            const dmEnabled = agencySettings?.agent_notification_slack_dm !== false;

            if (dmUserId && dmEnabled) {
              const dmOpenRes = await fetch('https://connector-gateway.lovable.dev/slack/api/conversations.open', {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${LOVABLE_API_KEY}`,
                  'X-Connection-Api-Key': slackApiKey,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({ users: dmUserId }),
              });
              const dmOpenData = await dmOpenRes.json();
              const dmChannelId = dmOpenData?.channel?.id;

              if (dmChannelId) {
                const healthScore = parsed.health_score || parsed.data_quality_score || parsed.pipeline_health || parsed.qa_score || '—';
                const dmMessage = `✅ *${agent.name}* — ${client.name}\n📊 Score: ${healthScore} | 🔧 Actions: ${actionsTaken.length} | 🪙 Tokens: ${tokensUsed}\n\n${parsed.slack_message || parsed.summary || aiOutput.slice(0, 400)}`;
                await fetch('https://connector-gateway.lovable.dev/slack/api/chat.postMessage', {
                  method: 'POST',
                  headers: {
                    'Authorization': `Bearer ${LOVABLE_API_KEY}`,
                    'X-Connection-Api-Key': slackApiKey,
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({ channel: dmChannelId, text: dmMessage }),
                });
                actionsTaken.push({ type: 'slack_dm', user: dmUserId });
              }
            }
          }
        } catch {
          // AI didn't return valid JSON — still record output
        }

        // Update run as completed
        await cloudDb.from('agent_runs').update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          input_summary: inputSummary,
          output_summary: aiOutput.slice(0, 4000),
          actions_taken: actionsTaken,
          tokens_used: tokensUsed,
          input_tokens: usage.prompt_tokens || 0,
          output_tokens: usage.completion_tokens || 0,
          cost_usd: 0,
          duration_ms: durationMs,
        }).eq('id', runId);

        // Update agent last run info & reset failures
        await cloudDb.from('agents').update({
          last_run_at: new Date().toISOString(),
          last_run_status: 'completed',
          consecutive_failures: 0,
          updated_at: new Date().toISOString(),
        }).eq('id', agent_id);

        results.push({ client: client.name, status: 'completed', actions: actionsTaken.length, tokens: tokensUsed });

      } catch (runError: any) {
        const durationMs = Date.now() - runStart;
        await cloudDb.from('agent_runs').update({
          status: 'failed',
          completed_at: new Date().toISOString(),
          error: runError.message,
          duration_ms: durationMs,
        }).eq('id', runId);

        await cloudDb.from('agents').update({
          last_run_at: new Date().toISOString(),
          last_run_status: 'failed',
          consecutive_failures: (agent.consecutive_failures || 0) + 1,
          updated_at: new Date().toISOString(),
        }).eq('id', agent_id);

        results.push({ client: client.name, status: 'failed', error: runError.message });
      }
    }

    return new Response(JSON.stringify({ success: true, results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err: any) {
    console.error('run-agent error:', err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
