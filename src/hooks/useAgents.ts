import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface Agent {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  prompt_template: string;
  schedule_cron: string | null;
  schedule_timezone: string | null;
  model: string | null;
  client_id: string | null;
  connectors: any;
  enabled: boolean | null;
  template_key: string | null;
  consecutive_failures: number | null;
  last_run_at: string | null;
  last_run_status: string | null;
  max_tokens: number | null;
  temperature: number | null;
  notify_channels?: string[] | null;
  whatsapp_recipients?: string[] | null;
  created_at: string;
  updated_at: string;
  client?: { id: string; name: string } | null;
}

export interface AgentRun {
  id: string;
  agent_id: string;
  client_id: string | null;
  status: string;
  started_at: string | null;
  completed_at: string | null;
  input_summary: string | null;
  output_summary: string | null;
  actions_taken: any;
  error: string | null;
  tokens_used: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_usd: number | null;
  duration_ms: number | null;
  client?: { id: string; name: string } | null;
}

export interface AgentEscalation {
  id: string;
  agent_name: string;
  severity: string;
  category: string | null;
  title: string;
  description: string;
  context: any;
  resolved_at: string | null;
  resolved_by: string | null;
  resolution_notes: string | null;
  created_at: string;
}

export interface AgentTask {
  id: string;
  created_by_agent: string;
  assigned_to_agent: string;
  priority: string;
  status: string;
  task_type: string;
  payload: any;
  result: any;
  due_at: string | null;
  completed_at: string | null;
  attempts: number;
  created_at: string;
}

async function enrichWithClientNames<T extends { client_id?: string | null }>(records: T[]): Promise<(T & { client?: { id: string; name: string } | null })[]> {
  const clientIds = [...new Set(records.map(r => r.client_id).filter(Boolean))] as string[];
  if (!clientIds.length) return records.map(r => ({ ...r, client: null }));
  const { data: clients } = await supabase.from('clients').select('id, name').in('id', clientIds);
  const clientMap = new Map((clients || []).map(c => [c.id, c]));
  return records.map(r => ({ ...r, client: r.client_id ? clientMap.get(r.client_id) || null : null }));
}

export function useAgents() {
  return useQuery({
    queryKey: ['agents'],
    queryFn: async () => {
      const { data, error } = await supabase.from('agents').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      return enrichWithClientNames(data || []) as Promise<Agent[]>;
    },
  });
}

export function useAgentRuns(agentId: string | null) {
  return useQuery({
    queryKey: ['agent-runs', agentId],
    queryFn: async () => {
      if (!agentId) return [];
      const { data, error } = await supabase.from('agent_runs').select('*').eq('agent_id', agentId).order('started_at', { ascending: false }).limit(50);
      if (error) throw error;
      return enrichWithClientNames(data || []) as Promise<AgentRun[]>;
    },
    enabled: !!agentId,
  });
}

export function useAgentEscalations() {
  return useQuery({
    queryKey: ['agent-escalations'],
    queryFn: async () => {
      const { data, error } = await supabase.from('agent_escalations').select('*').order('created_at', { ascending: false }).limit(50);
      if (error) throw error;
      return (data || []) as AgentEscalation[];
    },
  });
}

export function useAgentTasks() {
  return useQuery({
    queryKey: ['agent-tasks'],
    queryFn: async () => {
      const { data, error } = await supabase.from('agent_tasks').select('*').order('created_at', { ascending: false }).limit(50);
      if (error) throw error;
      return (data || []) as AgentTask[];
    },
  });
}

export function useCreateAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (agent: Partial<Agent>) => {
      const { data, error } = await supabase.from('agents').insert(agent as any).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['agents'] }); toast.success('Agent created'); },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useUpdateAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<Agent> & { id: string }) => {
      const { error } = await supabase.from('agents').update({ ...updates, updated_at: new Date().toISOString() } as any).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['agents'] }); toast.success('Agent updated'); },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useDeleteAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('agents').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['agents'] }); toast.success('Agent deleted'); },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useRunAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ agentId, clientId }: { agentId: string; clientId?: string }) => {
      const { data, error } = await supabase.functions.invoke('run-agent', {
        body: { agent_id: agentId, client_id: clientId },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['agent-runs'] }); toast.success('Agent run started'); },
    onError: (e: Error) => toast.error(`Run failed: ${e.message}`),
  });
}

export const AVAILABLE_MODELS = [
  { value: 'nvidia/nemotron-3-ultra:free', label: 'Nemotron 3 Ultra (default)' },
  { value: 'openrouter/deepseek/deepseek-v4-flash', label: 'DeepSeek V4 Flash' },
  { value: 'openai/gpt-5', label: 'GPT-5' },
  { value: 'openai/gpt-5-mini', label: 'GPT-5 Mini' },
];

export const AVAILABLE_CONNECTORS = [
  { key: 'database', label: 'Database', description: 'Access leads, calls, metrics, funded investors' },
  { key: 'tasks', label: 'Tasks', description: 'Access project tasks, subtasks, assignments, and history' },
  { key: 'meta_ads', label: 'Meta Ads', description: 'Pull ad spend and campaign data from Meta' },
  { key: 'ghl_crm', label: 'GHL CRM', description: 'Access GoHighLevel contacts, pipelines, calendars' },
  { key: 'slack', label: 'Slack', description: 'Send messages and reports to Slack channels' },
  { key: 'claude_code', label: 'Claude Code', description: 'Connect to Claude Code Desktop for automations via MCP' },
  { key: 'google_sheets', label: 'Google Sheets QA', description: 'Audit client KPI sheet for spam, quality issues, and accuracy vs DB' },
  { key: 'whatsapp', label: 'WhatsApp (Twilio)', description: 'Send agent reports via WhatsApp to configured recipients' },
];

export const AGENT_TEMPLATES = [
  {
    key: 'sheet_auditor',
    name: 'Sheet QA Agent (AUDITOR)',
    icon: '📑',
    description: 'Reviews client Google Sheets for spam, quality issues, and accuracy vs database. Sends WhatsApp + Slack report.',
    connectors: ['database', 'google_sheets', 'whatsapp', 'slack'],
    schedule_cron: '0 7 * * *',
    model: 'google/gemini-2.5-flash',
    prompt_template: 'You are AUDITOR for {{client_name}}. The deterministic checks already ran — see sheet_audit in data.\n\n## Data ({{yesterday}})\n{{data}}\n\nReturn JSON: { "quality_score": 1-100, "spam_flags": [], "accuracy_deltas": [], "top_priorities": [], "summary": "...", "slack_message": "...", "whatsapp_message": "under 600 chars, plain text, top 3 issues + score, NO guaranteed language" }',
  },
  {
    key: 'ai_coo',
    name: 'AI COO (JARVIS)',
    icon: '🧠',
    description: 'Oversees all agents, routes work, tracks KPIs, resolves conflicts, and generates unified status reports.',
    connectors: ['database', 'slack'],
    schedule_cron: '5,35 * * * *',
    model: 'google/gemini-2.5-pro',
    prompt_template: 'You are JARVIS, the AI COO for {{client_name}}.\n\n## Data ({{yesterday}})\n{{data}}\n\nAnalyze and return JSON: { "summary", "kpi_snapshot": { leads_today, calls_booked, shows, funded, ad_spend }, "health_score": 1-100, "issues": [{ severity, area, description }], "escalations": [{ severity, title, description, category }], "next_priorities": [], "slack_message" }',
  },
  {
    key: 'operations',
    name: 'Operations Agent (OPS)',
    icon: '⚙️',
    description: 'Data accuracy checks, token health monitoring, sync verification.',
    connectors: ['database', 'meta_ads'],
    schedule_cron: '*/15 * * * *',
    model: 'google/gemini-2.5-flash',
    prompt_template: 'You are OPS for {{client_name}}.\n\n## Data ({{yesterday}})\n{{data}}\n\nAudit data quality. Return JSON: { "data_quality_score": 1-100, "checks": [{ metric, source_value, recorded_value, match, discrepancy_pct }], "meta_token_status", "sync_status", "corrections": {}, "escalations": [], "slack_message" }',
  },
  {
    key: 'sales',
    name: 'Sales Agent (HUNTER)',
    icon: '🎯',
    description: 'Lead scoring, pipeline monitoring, pre-call briefs.',
    connectors: ['database', 'ghl_crm'],
    schedule_cron: '*/30 * * * *',
    model: 'google/gemini-2.5-pro',
    prompt_template: 'You are HUNTER for {{client_name}}.\n\n## Data ({{yesterday}})\n{{data}}\n\nAnalyze pipeline. Return JSON: { "pipeline_health": 1-100, "lead_summary": { new_leads, qualified_leads, spam_rate_pct }, "stuck_opportunities": [], "pre_call_briefs": [], "escalations": [], "slack_message" }',
  },
  {
    key: 'call_analysis',
    name: 'Call Analysis Agent (ANALYST)',
    icon: '📞',
    description: 'Scores calls on rapport, qualification, objection handling.',
    connectors: ['database', 'slack'],
    schedule_cron: '0 5 * * *',
    model: 'google/gemini-2.5-pro',
    prompt_template: 'You are ANALYST for {{client_name}}.\n\n## Data ({{yesterday}})\n{{data}}\n\nAnalyze calls. Return JSON: { "calls_analyzed", "show_rate_pct", "avg_scores": { rapport, qualification, objection_handling }, "compliance_flags": [], "coaching_recommendations": [], "escalations": [], "slack_message" }',
  },
  {
    key: 'client_success',
    name: 'Client Success Agent (KEEPER)',
    icon: '🤝',
    description: 'Client health scoring, churn detection, QBR prep.',
    connectors: ['database', 'slack'],
    schedule_cron: '0 * * * *',
    model: 'google/gemini-2.5-pro',
    prompt_template: 'You are KEEPER for {{client_name}}.\n\n## Data ({{yesterday}})\n{{data}}\n\nEvaluate client health. Return JSON: { "health_score": 1-100, "health_factors": { lead_flow, call_performance, funding_pace, data_freshness }, "churn_risk", "churn_signals": [], "engagement_actions": [], "escalations": [], "slack_message" }',
  },
  {
    key: 'marketing',
    name: 'Marketing Agent (BROOKLYN)',
    icon: '🎬',
    description: 'Ad performance analysis, copy generation, compliance checking.',
    connectors: ['database', 'meta_ads', 'slack'],
    schedule_cron: '10 * * * *',
    model: 'google/gemini-2.5-flash',
    prompt_template: 'You are BROOKLYN for {{client_name}}.\n\n## Data ({{yesterday}})\n{{data}}\n\nAnalyze marketing. Return JSON: { "performance_summary": { ad_spend, cpl, ctr_pct, impressions }, "creative_insights": [], "ad_copy_suggestions": [{ headline, body, cta, angle }], "escalations": [], "slack_message" }',
  },
  {
    key: 'data_qa',
    name: 'Data QA Agent',
    icon: '🔍',
    description: 'Cross-checks source data against daily_metrics for discrepancies.',
    connectors: ['database', 'ghl_crm', 'meta_ads', 'slack'],
    schedule_cron: '0 6 * * *',
    model: 'google/gemini-2.5-pro',
    prompt_template: 'You are the Data QA Agent for {{client_name}}.\n\n## Data ({{yesterday}})\n{{data}}\n\nCross-check all sources. Return JSON: { "qa_score": 1-100, "checks": [{ source_a, source_b, metric, value_a, value_b, match }], "corrections": {}, "missing_data": [], "escalations": [], "slack_message" }',
  },
  {
    key: 'finance',
    name: 'Finance Agent (LEDGER)',
    icon: '💰',
    description: 'P&L tracking, margin alerts, cost optimization.',
    connectors: ['database'],
    schedule_cron: '0 13 * * *',
    model: 'google/gemini-2.5-flash',
    prompt_template: 'You are LEDGER for {{client_name}}.\n\n## Data ({{yesterday}})\n{{data}}\n\nAnalyze finances. Return JSON: { "financial_summary": { ad_spend, revenue_from_funded, cost_per_funded, estimated_roas }, "margin_alerts": [], "cost_optimizations": [], "escalations": [], "slack_message" }',
  },
  {
    key: 'static_ads_generator',
    name: 'Static Ads Generator (CANVAS)',
    icon: '🖼️',
    description: 'Generates static image ads from offers, brand kit, and reference images. Uses its own knowledge base of winning static creatives.',
    connectors: ['database'],
    schedule_cron: '',
    model: 'google/gemini-2.5-pro',
    prompt_template: 'You are CANVAS, the Static Ads Generator for {{client_name}}.\n\nUse the agent reference library (winning static ads, brand guidelines, product shots) tagged for this agent as visual inspiration. Follow the offer brief and brand kit.\n\nReturn JSON: { "concepts": [{ "headline", "subheadline", "cta", "visual_direction", "copy_overlay", "reference_ids": [] }], "compliance_notes": [] }\n\nNever use the word "guaranteed". Use "targeted returns" where applicable. Include required SEC/FINRA risk disclaimers in copy intended for capital-raising clients.',
  },
  {
    key: 'video_ads_generator',
    name: 'Video Ads Generator (REEL)',
    icon: '🎥',
    description: 'Builds video ads from approved scripts using avatar / VSL pipelines. References winning video ads for pacing, hooks, and styling.',
    connectors: ['database'],
    schedule_cron: '',
    model: 'google/gemini-2.5-pro',
    prompt_template: 'You are REEL, the Video Ads Generator for {{client_name}}.\n\nInputs: approved script, brand kit, avatar/voice selection, agent reference library (winning video ads).\n\nReturn JSON: { "scenes": [{ "scene", "voiceover", "visual", "b_roll_prompts": [], "duration_s" }], "avatar_id", "voice_id", "music_direction", "hook_variations": [], "compliance_notes": [] }\n\nNever use "guaranteed". Use "targeted returns". Include risk disclaimers for capital-raising clients.',
  },
  {
    key: 'video_editor',
    name: 'Video Editor (CUTTER)',
    icon: '✂️',
    description: 'Takes final ad videos and edits them with proven templates: captions, b-roll cuts, animated text, hook re-orders, format variants (9:16, 1:1, 16:9).',
    connectors: ['database'],
    schedule_cron: '',
    model: 'google/gemini-2.5-pro',
    prompt_template: 'You are CUTTER, the Video Editor agent for {{client_name}}.\n\nInputs: rendered ad video URL, agent reference library of proven edit templates, brand kit.\n\nReturn JSON: { "edits": [{ "template_id", "label", "operations": [{ "type": "caption|cut|broll|text_overlay|hook_swap|aspect", "params": {} }], "output_aspect": "9:16|1:1|16:9", "duration_s" }], "caption_style", "font_pair", "music_direction" }\n\nReference proven templates from the agent reference library tagged for this agent.',
  },
  {
    key: 'reporting_agent',
    name: 'Reporting Agent (PULSE)',
    icon: '📊',
    description: 'Produces client-facing performance reports and KPI snapshots so clients keep moving through the funnel.',
    connectors: ['database', 'slack'],
    schedule_cron: '0 8 * * *',
    model: 'google/gemini-2.5-pro',
    prompt_template: 'You are PULSE, the Reporting Agent for {{client_name}}.\n\n## Data ({{yesterday}})\n{{data}}\n\nProduce a client-ready report. Return JSON: { "headline", "kpis": { leads, calls_booked, shows, funded, ad_spend, cpl, cost_per_funded, roas }, "vs_prior_period": { leads_delta_pct, cpl_delta_pct, funded_delta_pct }, "wins": [], "blockers": [], "next_steps": [], "client_message": "polished plain-text update under 800 chars", "slack_message" }\n\nNever say "guaranteed". Use "targeted returns" for capital-raising clients. Include risk disclaimer footer when relevant.',
  },
];
