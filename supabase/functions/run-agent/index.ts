import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const AI_GATEWAY_URL = 'https://openrouter.ai/api/v1/chat/completions';

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { agent_id, client_id: overrideClientId } = await req.json();
    if (!agent_id) {
      return new Response(JSON.stringify({ error: 'agent_id required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const LOVABLE_API_KEY = Deno.env.get('OPENROUTER_API_KEY');
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: 'OPENROUTER_API_KEY not configured' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
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

    // Wave B #6 — Pre-run budget check (month-to-date)
    if (agent.budget_usd_monthly != null && Number(agent.budget_usd_monthly) > 0) {
      try {
        const { data: mtd } = await cloudDb.rpc('agent_cost_mtd', { p_agent_id: agent_id });
        const spent = Number(mtd) || 0;
        if (spent >= Number(agent.budget_usd_monthly)) {
          return new Response(JSON.stringify({
            status: 'budget_exceeded',
            agent_id,
            spent_mtd_usd: spent,
            budget_usd_monthly: Number(agent.budget_usd_monthly),
          }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
      } catch (e) {
        console.warn('budget check failed (non-fatal)', e);
      }
    }

    // Wave B #5 — Shadow mode: log only, skip every side-effect / write-back.
    const shadowMode = !!agent.shadow_mode;

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

        // ── TASKS connector: gather task data ──
        if (connectors.includes('tasks')) {
          try {
            const { data: activeTasks } = await prodDb
              .from('tasks')
              .select('id, title, status, stage, priority, due_date, assigned_to, created_at, completed_at, parent_task_id')
              .eq('client_id', client.id)
              .in('status', ['pending', 'in_progress'])
              .order('created_at', { ascending: false })
              .limit(100);

            // Fetch assignees with member names for multi-owner detection
            const taskIds = (activeTasks || []).map((t: any) => t.id);
            let assigneesMap: Record<string, { member_id: string; name: string }[]> = {};
            if (taskIds.length > 0) {
              const { data: assignees } = await prodDb
                .from('task_assignees')
                .select('task_id, member_id, member:agency_members(id, name, email)')
                .in('task_id', taskIds.slice(0, 100));
              for (const a of (assignees || [])) {
                const tid = a.task_id;
                if (!assigneesMap[tid]) assigneesMap[tid] = [];
                assigneesMap[tid].push({
                  member_id: a.member_id,
                  name: (a as any).member?.name || a.member_id,
                });
              }
            }

            // Enrich tasks with assignee details
            const enrichedTasks = (activeTasks || []).map((t: any) => ({
              ...t,
              assignees: assigneesMap[t.id] || [],
              assignee_count: (assigneesMap[t.id] || []).length,
            }));

            // Identify unassigned tasks (no assigned_to AND no assignees)
            const unassignedTasks = enrichedTasks.filter(
              (t: any) => !t.assigned_to && t.assignee_count === 0
            );

            // Identify multi-owner tasks
            const multiOwnerTasks = enrichedTasks.filter(
              (t: any) => t.assignee_count > 1
            );

            const { data: recentCompleted } = await prodDb
              .from('tasks')
              .select('id, title, status, stage, priority, due_date, completed_at')
              .eq('client_id', client.id)
              .eq('status', 'completed')
              .gte('completed_at', weekAgoStr)
              .order('completed_at', { ascending: false })
              .limit(50);

            const { data: overdueTasks } = await prodDb
              .from('tasks')
              .select('id, title, priority, due_date, assigned_to, stage')
              .eq('client_id', client.id)
              .in('status', ['pending', 'in_progress'])
              .lt('due_date', todayStr)
              .order('due_date', { ascending: true });

            // Enrich overdue tasks with assignee names
            const overdueIds = (overdueTasks || []).map((t: any) => t.id);
            let overdueAssigneesMap: Record<string, { name: string }[]> = {};
            if (overdueIds.length > 0) {
              const { data: oAssignees } = await prodDb
                .from('task_assignees')
                .select('task_id, member:agency_members(name)')
                .in('task_id', overdueIds);
              for (const a of (oAssignees || [])) {
                if (!overdueAssigneesMap[a.task_id]) overdueAssigneesMap[a.task_id] = [];
                overdueAssigneesMap[a.task_id].push({ name: (a as any).member?.name || 'Unknown' });
              }
            }
            const enrichedOverdue = (overdueTasks || []).map((t: any) => ({
              ...t,
              assignees: overdueAssigneesMap[t.id] || [],
            }));

            const { data: dueTodayTasks } = await prodDb
              .from('tasks')
              .select('id, title, priority, due_date, assigned_to, stage')
              .eq('client_id', client.id)
              .in('status', ['pending', 'in_progress'])
              .eq('due_date', todayStr);

            const { data: recentHistory } = await prodDb
              .from('task_history')
              .select('id, task_id, action, old_value, new_value, changed_by, created_at')
              .in('task_id', taskIds.slice(0, 50))
              .gte('created_at', weekAgoStr)
              .order('created_at', { ascending: false })
              .limit(100);

            const stageBreakdown: Record<string, number> = {};
            enrichedTasks.forEach((t: any) => { stageBreakdown[t.stage || 'unknown'] = (stageBreakdown[t.stage || 'unknown'] || 0) + 1; });

            // Fetch client team assignments for auto-assign context
            const { data: clientAssignment } = await prodDb
              .from('client_assignments')
              .select('account_manager, media_buyer')
              .eq('client_id', client.id)
              .maybeSingle();

            // Fetch all agency members for ID lookup
            const { data: allMembers } = await prodDb
              .from('agency_members')
              .select('id, name, email, role');

            dataContext.tasks = {
              active_count: enrichedTasks.length,
              completed_this_week: recentCompleted?.length || 0,
              overdue_count: enrichedOverdue.length,
              due_today_count: dueTodayTasks?.length || 0,
              unassigned_count: unassignedTasks.length,
              multi_owner_count: multiOwnerTasks.length,
              stage_breakdown: stageBreakdown,
              unassigned_tasks: unassignedTasks.slice(0, 15).map((t: any) => ({ id: t.id, title: t.title, stage: t.stage, priority: t.priority, due_date: t.due_date })),
              multi_owner_tasks: multiOwnerTasks.slice(0, 15).map((t: any) => ({ id: t.id, title: t.title, assignees: t.assignees, stage: t.stage })),
              overdue_tasks: enrichedOverdue.slice(0, 15),
              due_today_tasks: dueTodayTasks || [],
              recent_completions: (recentCompleted || []).slice(0, 10),
              recent_history: (recentHistory || []).slice(0, 20),
              team_assignments: clientAssignment || { note: 'No team assignments found' },
              agency_members: (allMembers || []).map((m: any) => ({ id: m.id, name: m.name })),
              priority_breakdown: {
                high: enrichedTasks.filter((t: any) => t.priority === 'high').length,
                medium: enrichedTasks.filter((t: any) => t.priority === 'medium').length,
                low: enrichedTasks.filter((t: any) => t.priority === 'low').length,
              },
            };
          } catch (e) {
            dataContext.tasks = { error: 'Failed to fetch task data' };
          }
        }
        if (connectors.includes('meta_ads') && (client.meta_system_user_token || client.meta_access_token) && client.meta_ad_account_id) {
          try {
            // System User token preferred (no expiry); falls back to long-lived per-client token.
            const metaToken = client.meta_system_user_token || client.meta_access_token;
            const metaUrl = `https://graph.facebook.com/v21.0/act_${client.meta_ad_account_id}/insights?fields=spend,impressions,clicks,ctr,cpc,cpm,actions&time_range={"since":"${yesterdayStr}","until":"${yesterdayStr}"}&access_token=${metaToken}`;
            const { metaFetch } = await import('../_shared/meta.ts');
            const metaRes = await metaFetch(metaUrl);
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

        // ── Google Sheets QA connector — runs sheet audit and injects findings ──
        if (connectors.includes('google_sheets') && client.kpi_google_sheet_url) {
          try {
            const auditRes = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/agent-sheet-audit`, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
                'apikey': Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ client_id: client.id, scope: 'client' }),
            });
            const auditJson = await auditRes.json();
            dataContext.sheet_audit = {
              quality_score: auditJson.quality_score,
              spam_count: auditJson.spam_count,
              quality_issue_count: auditJson.quality_issue_count,
              accuracy: auditJson.accuracy,
              summary: auditJson.summary,
              top_spam: (auditJson.findings?.spamFlags || []).slice(0, 10),
              top_quality: (auditJson.findings?.qualityIssues || []).slice(0, 10),
            };
          } catch (e) {
            dataContext.sheet_audit = { error: 'Sheet audit failed' };
          }
        }

        // Build prompt with variable interpolation
        let prompt = agent.prompt_template;
        prompt = prompt.replace(/\{\{client_name\}\}/g, client.name);
        prompt = prompt.replace(/\{\{date\}\}/g, todayStr);
        prompt = prompt.replace(/\{\{yesterday\}\}/g, yesterdayStr);
        prompt = prompt.replace(/\{\{data\}\}/g, JSON.stringify(dataContext, null, 2));

        // Inject per-client agent memory profile (client_agent_profiles.profile_md)
        let memoryBlock = '';
        try {
          const { data: prof } = await cloudDb
            .from('client_agent_profiles')
            .select('profile_md, brand_kit, notes')
            .eq('client_id', client.id)
            .maybeSingle();
          if (prof?.profile_md) memoryBlock += `\n\n# Client Memory\n${prof.profile_md}`;
          if (prof?.brand_kit && Object.keys(prof.brand_kit || {}).length) {
            memoryBlock += `\n\n# Brand Kit\n\`\`\`json\n${JSON.stringify(prof.brand_kit, null, 2)}\n\`\`\``;
          }
          if (prof?.notes) memoryBlock += `\n\n# Notes\n${prof.notes}`;
        } catch (_e) { /* memory is optional */ }

        const inputSummary = `Client: ${client.name}. Connectors: ${connectors.join(', ')}. Data: ${Object.keys(dataContext).join(', ')}`;

        // Call AI via Lovable AI Gateway
        const aiBody: any = {
          model: agent.model || "nvidia/nemotron-3-ultra-550b-a55b:free",
          messages: [
            { role: 'system', content: `You are an AI agent executing a scheduled task for a capital raising agency. Analyze the provided data thoroughly and respond ONLY with valid JSON (no markdown fences). Be specific with numbers and actionable with recommendations.${memoryBlock}` },
            { role: 'user', content: prompt },
          ],
          temperature: Number(agent.temperature) || 0.3,
        };
        aiBody.max_tokens = Number(agent.max_tokens) || 4096;

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
          if (parsed.corrections && Object.keys(parsed.corrections).length > 0 && connectors.includes('database') && !shadowMode) {
            await prodDb
              .from('daily_metrics')
              .upsert({
                client_id: client.id,
                date: yesterdayStr,
                ...parsed.corrections,
                updated_at: new Date().toISOString(),
              }, { onConflict: 'client_id,date' });
            actionsTaken.push({ type: 'daily_metrics_update', corrections: parsed.corrections });
          } else if (parsed.corrections && Object.keys(parsed.corrections).length > 0 && shadowMode) {
            actionsTaken.push({ type: 'shadow.daily_metrics_update', corrections: parsed.corrections });
          }

          // Handle escalations
          if (parsed.escalations?.length) {
            for (const esc of parsed.escalations) {
              if (!esc.title || !esc.description) continue;
              if (shadowMode) {
                actionsTaken.push({ type: 'shadow.escalation', severity: esc.severity, title: esc.title });
                continue;
              }
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

          // ── Task comment write-back ──
          if (parsed.task_comments?.length && connectors.includes('tasks')) {
            for (const tc of parsed.task_comments) {
              if (!tc.task_id || !tc.comment) continue;
              if (shadowMode) {
                actionsTaken.push({ type: 'shadow.task_comment', task_id: tc.task_id });
                continue;
              }
              try {
                await prodDb.from('task_comments').insert({
                  task_id: tc.task_id,
                  author_name: `🤖 ${agent.name}`,
                  content: tc.comment,
                  comment_type: 'text',
                });
                // Log in task history
                await prodDb.from('task_history').insert({
                  task_id: tc.task_id,
                  action: 'comment_added',
                  new_value: tc.comment,
                  changed_by: `Agent: ${agent.name}`,
                });
                actionsTaken.push({ type: 'task_comment', task_id: tc.task_id });
              } catch (e) {
                console.error(`Failed to add comment to task ${tc.task_id}:`, e);
              }
            }
          }

          // ── Auto-assign write-back ──
          if (parsed.auto_assigned?.length && connectors.includes('tasks')) {
            for (const assignment of parsed.auto_assigned) {
              if (!assignment.task_id || !assignment.member_id) continue;
              if (shadowMode) {
                actionsTaken.push({ type: 'shadow.auto_assign', task_id: assignment.task_id, member: assignment.assigned_to });
                continue;
              }
              try {
                // Check if already assigned to prevent duplicates
                const { data: existing } = await prodDb
                  .from('task_assignees')
                  .select('id')
                  .eq('task_id', assignment.task_id)
                  .eq('member_id', assignment.member_id)
                  .maybeSingle();
                if (!existing) {
                  await prodDb.from('task_assignees').insert({
                    task_id: assignment.task_id,
                    member_id: assignment.member_id,
                  });
                  await prodDb.from('task_history').insert({
                    task_id: assignment.task_id,
                    action: 'assignee_added',
                    new_value: assignment.assigned_to || assignment.member_id,
                    changed_by: `Agent: ${agent.name}`,
                  });
                  actionsTaken.push({ type: 'auto_assign', task_id: assignment.task_id, member: assignment.assigned_to });
                }
              } catch (e) {
                console.error(`Failed to auto-assign task ${assignment.task_id}:`, e);
              }
            }
          }

          if (parsed.slack_message && connectors.includes('slack')) {
            if (shadowMode) {
              actionsTaken.push({ type: 'shadow.slack_channel_message' });
            } else {
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
          }

          // ── WhatsApp dispatch (notify_channels includes 'whatsapp') ──
          const notifyChannels: string[] = (agent as any).notify_channels || ['slack'];
          if (notifyChannels.includes('whatsapp') && !shadowMode) {
            try {
              const waMsg = parsed.whatsapp_message || parsed.slack_message || parsed.summary || aiOutput.slice(0, 500);
              const agentRecipients: string[] = (agent as any).whatsapp_recipients || [];
              const clientRecipients: string[] = (client as any).whatsapp_notify_numbers || [];
              const { data: ag } = await cloudDb.from('agency_settings').select('whatsapp_default_recipients').limit(1).maybeSingle();
              const defaultRecipients: string[] = (ag as any)?.whatsapp_default_recipients || [];
              const recipients = Array.from(new Set([...agentRecipients, ...clientRecipients, ...defaultRecipients].filter(Boolean)));
              if (recipients.length && waMsg) {
                await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/send-whatsapp-report`, {
                  method: 'POST',
                  headers: {
                    'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
                    'apikey': Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({ to: recipients, message: `🤖 ${agent.name} — ${client.name}\n\n${waMsg}` }),
                });
                actionsTaken.push({ type: 'whatsapp_message', recipients: recipients.length });
              }
            } catch (e) {
              console.error('WhatsApp dispatch failed', e);
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
        const PRICING: Record<string, { in: number; out: number }> = {
          "nvidia/nemotron-3-ultra-550b-a55b:free": { in: 0.000075, out: 0.0003 },
          'google/gemini-2.5-pro':   { in: 0.00125, out: 0.005 },
          "nvidia/nemotron-3-ultra-550b-a55b:free": { in: 0.000075, out: 0.0003 },
          'openai/gpt-5':            { in: 0.005, out: 0.015 },
          'openai/gpt-5-mini':       { in: 0.00025, out: 0.002 },
        };
        const pricing = PRICING[agent.model] || PRICING["nvidia/nemotron-3-ultra-550b-a55b:free"];
        const costUsd = +((((usage.prompt_tokens || 0) / 1000) * pricing.in) + (((usage.completion_tokens || 0) / 1000) * pricing.out)).toFixed(6);

        await cloudDb.from('agent_runs').update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          input_summary: inputSummary,
          output_summary: aiOutput.slice(0, 4000),
          actions_taken: actionsTaken,
          tokens_used: tokensUsed,
          input_tokens: usage.prompt_tokens || 0,
          output_tokens: usage.completion_tokens || 0,
          cost_usd: costUsd,
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
