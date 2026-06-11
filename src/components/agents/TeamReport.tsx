import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Users,
  Bot,
  CheckCircle,
  Image as ImageIcon,
  Video,
  FileText,
  DollarSign,
  Sparkles,
  TrendingUp,
  Cpu,
} from "lucide-react";

/**
 * Global agency-wide team report.
 * - Humans (agency_members) → tasks completed
 * - AI agents (agents + client_agents) → runs / hermes tasks completed
 * - Creative output (image | video | text) per "doer"
 * - Real OpenRouter $ + estimated cost from agent_runs
 * - Top model by usage
 */
const WINDOW_DAYS = 30;

export function TeamReport() {
  const since = new Date(Date.now() - WINDOW_DAYS * 86400_000).toISOString();

  // Real OpenRouter spend via edge function
  const { data: usage } = useQuery({
    queryKey: ["team-report", "openrouter-usage", WINDOW_DAYS],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("openrouter-usage", {
        body: { days: WINDOW_DAYS },
      });
      if (error) throw error;
      return data as {
        real?: { total_usage?: number; total_credits?: number; error?: string };
        estimated?: { cost_usd: number; tokens: number; runs: number };
      };
    },
    staleTime: 60_000,
  });

  // Humans
  const { data: members = [] } = useQuery({
    queryKey: ["team-report", "members"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("agency_members")
        .select("id, name, role, email");
      if (error) throw error;
      return data ?? [];
    },
  });

  // Human tasks completed in window
  const { data: humanTasks = [] } = useQuery({
    queryKey: ["team-report", "human-tasks", WINDOW_DAYS],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tasks")
        .select("id, assigned_to, created_by, completed_at, status")
        .not("completed_at", "is", null)
        .gte("completed_at", since)
        .limit(5000);
      if (error) throw error;
      return data ?? [];
    },
  });

  // AI agents — agency
  const { data: agents = [] } = useQuery({
    queryKey: ["team-report", "agents"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("agents")
        .select("id, name, icon, enabled, template_key, model");
      if (error) throw error;
      return data ?? [];
    },
  });

  // Agent runs (used for runs/cost/model breakdown)
  const { data: runs = [] } = useQuery({
    queryKey: ["team-report", "agent-runs", WINDOW_DAYS],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("agent_runs")
        .select("id, agent_id, status, started_at, completed_at, tokens_used, cost_usd")
        .gte("started_at", since)
        .limit(20000);
      if (error) throw error;
      return data ?? [];
    },
  });

  // Hermes tasks (per-client AI agent execution)
  const { data: hermes = [] } = useQuery({
    queryKey: ["team-report", "hermes", WINDOW_DAYS],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("hermes_tasks" as any)
        .select("id, agent_id, client_id, status, task_type, completed_at, metadata")
        .gte("created_at", since)
        .limit(5000);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  // Creative output (window)
  const { data: creatives = [] } = useQuery({
    queryKey: ["team-report", "creatives", WINDOW_DAYS],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("creatives")
        .select("id, type, created_at, source, created_by")
        .gte("created_at", since)
        .limit(20000);
      if (error) throw error;
      return data ?? [];
    },
  });

  // Aggregations
  const humansMap = new Map(members.map((m: any) => [m.id, m]));
  const humanByMember: Record<string, number> = {};
  for (const t of humanTasks) {
    const key = t.assigned_to || t.created_by;
    if (!key) continue;
    humanByMember[key] = (humanByMember[key] || 0) + 1;
  }
  const humanRows = Object.entries(humanByMember)
    .map(([id, count]) => {
      const m: any = humansMap.get(id);
      return { id, name: m?.name || "Unknown", role: m?.role || "team", count };
    })
    .sort((a, b) => b.count - a.count);

  const agentMap = new Map(agents.map((a: any) => [a.id, a]));
  const runsByAgent: Record<string, { runs: number; tokens: number; cost: number; model?: string; lastAt?: string }> = {};
  const modelTotals: Record<string, { runs: number; cost: number; tokens: number }> = {};
  for (const r of runs) {
    const ag: any = r.agent_id ? agentMap.get(r.agent_id) : null;
    const key = r.agent_id || "unknown";
    const bucket = (runsByAgent[key] ||= { runs: 0, tokens: 0, cost: 0, model: ag?.model, lastAt: undefined });
    bucket.runs++;
    bucket.tokens += Number(r.tokens_used || 0);
    bucket.cost += Number(r.cost_usd || 0);
    if (!bucket.lastAt || (r.started_at && r.started_at > bucket.lastAt)) bucket.lastAt = r.started_at as any;
    const mk = ag?.model || "unknown";
    const mb = (modelTotals[mk] ||= { runs: 0, cost: 0, tokens: 0 });
    mb.runs++;
    mb.cost += Number(r.cost_usd || 0);
    mb.tokens += Number(r.tokens_used || 0);
  }
  // Hermes tasks → add as "completed AI tasks" per agent
  const hermesByAgent: Record<string, number> = {};
  for (const h of hermes) {
    if (h.status !== "completed" || !h.agent_id) continue;
    hermesByAgent[h.agent_id] = (hermesByAgent[h.agent_id] || 0) + 1;
  }
  const aiRows = agents
    .map((a: any) => {
      const r = runsByAgent[a.id] || { runs: 0, tokens: 0, cost: 0 };
      return {
        id: a.id,
        name: a.name,
        icon: a.icon || "🤖",
        enabled: a.enabled,
        model: a.model,
        runs: r.runs + (hermesByAgent[a.id] || 0),
        tokens: r.tokens,
        cost: r.cost,
        lastAt: r.lastAt,
      };
    })
    .filter((r: any) => r.runs > 0 || r.enabled)
    .sort((a: any, b: any) => b.runs - a.runs);

  // Creative output split
  const creativeStats = creatives.reduce(
    (acc: any, c: any) => {
      const t = (c.type || "").toLowerCase();
      if (t === "video") acc.video++;
      else if (t === "image") acc.image++;
      else acc.text++;
      if (c.source === "ai_batch" || c.source === "ai") acc.ai++;
      else acc.human++;
      return acc;
    },
    { video: 0, image: 0, text: 0, ai: 0, human: 0 },
  );

  // Top model leaderboard
  const topModels = Object.entries(modelTotals)
    .map(([model, v]) => ({ model, ...v }))
    .sort((a, b) => b.runs - a.runs)
    .slice(0, 6);

  const realSpend = usage?.real?.total_usage ?? null;
  const estSpend = usage?.estimated?.cost_usd ?? 0;

  return (
    <Card className="border-primary/20">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Users className="h-4 w-4 text-primary" /> Team Report
          <Badge variant="outline" className="ml-2 text-[10px]">Last {WINDOW_DAYS}d</Badge>
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Humans + AI agents. Tasks completed, creative output, model usage and real OpenRouter cost.
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* KPI strip */}
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
          <Kpi icon={CheckCircle} label="Human tasks done" value={humanTasks.length} />
          <Kpi icon={Bot} label="AI runs done" value={Object.values(runsByAgent).reduce((s, r) => s + r.runs, 0) + Object.values(hermesByAgent).reduce((s, n) => s + n, 0)} />
          <Kpi icon={Video} label="Videos" value={creativeStats.video} />
          <Kpi icon={ImageIcon} label="Images" value={creativeStats.image} />
          <Kpi icon={FileText} label="Text/Copy" value={creativeStats.text} />
          <Kpi
            icon={DollarSign}
            label={realSpend != null ? "OpenRouter spend" : "Estimated cost"}
            value={`$${(realSpend ?? estSpend).toFixed(2)}`}
            hint={
              realSpend != null
                ? `est. ${WINDOW_DAYS}d: $${estSpend.toFixed(2)}`
                : usage?.real?.error || "fallback estimate"
            }
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Humans leaderboard */}
          <div>
            <h4 className="text-xs uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1.5">
              <Users className="h-3.5 w-3.5" /> Humans — tasks completed
            </h4>
            <div className="rounded-lg border divide-y">
              {humanRows.length === 0 && (
                <p className="p-3 text-xs text-muted-foreground">No completed human tasks in window.</p>
              )}
              {humanRows.map((h) => (
                <div key={h.id} className="flex items-center justify-between px-3 py-2 text-sm">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="h-7 w-7 rounded-full bg-primary/10 grid place-items-center text-[11px] font-semibold">
                      {h.name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium truncate">{h.name}</p>
                      <p className="text-[10px] text-muted-foreground capitalize">{h.role}</p>
                    </div>
                  </div>
                  <Badge variant="secondary" className="text-[11px]">{h.count} done</Badge>
                </div>
              ))}
            </div>
          </div>

          {/* AI agents leaderboard */}
          <div>
            <h4 className="text-xs uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1.5">
              <Bot className="h-3.5 w-3.5" /> AI agents — runs / tasks done
            </h4>
            <div className="rounded-lg border divide-y max-h-[420px] overflow-y-auto">
              {aiRows.length === 0 && (
                <p className="p-3 text-xs text-muted-foreground">No AI activity in window.</p>
              )}
              {aiRows.map((a) => (
                <div key={a.id} className="flex items-center justify-between px-3 py-2 text-sm">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-lg">{a.icon}</span>
                    <div className="min-w-0">
                      <p className="font-medium truncate">{a.name}</p>
                      <p className="text-[10px] text-muted-foreground truncate">{a.model || "—"}</p>
                    </div>
                  </div>
                  <div className="flex flex-col items-end">
                    <Badge variant={a.runs > 0 ? "default" : "outline"} className="text-[11px]">
                      {a.runs} runs
                    </Badge>
                    <span className="text-[10px] text-muted-foreground mt-0.5">
                      ${a.cost.toFixed(3)} · {a.tokens.toLocaleString()} tok
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Top models */}
        <div>
          <h4 className="text-xs uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1.5">
            <Cpu className="h-3.5 w-3.5" /> Top models by usage
          </h4>
          {topModels.length === 0 ? (
            <p className="text-xs text-muted-foreground">No model usage recorded yet.</p>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {topModels.map((m) => (
                <div key={m.model} className="rounded-lg border p-2.5">
                  <p className="font-mono text-[11px] truncate">{m.model}</p>
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-xs text-muted-foreground">{m.runs} runs</span>
                    <span className="text-xs font-semibold">${m.cost.toFixed(3)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Output mix */}
        <div className="rounded-lg border p-3 bg-muted/30">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="h-3.5 w-3.5 text-primary" />
            <span className="text-xs font-medium">Creative output split</span>
            <Sparkles className="h-3 w-3 text-muted-foreground ml-auto" />
          </div>
          <div className="flex items-center gap-3 text-xs">
            <span className="flex items-center gap-1"><Video className="h-3 w-3" /> Video <b>{creativeStats.video}</b></span>
            <span className="flex items-center gap-1"><ImageIcon className="h-3 w-3" /> Image <b>{creativeStats.image}</b></span>
            <span className="flex items-center gap-1"><FileText className="h-3 w-3" /> Text <b>{creativeStats.text}</b></span>
            <span className="ml-auto text-muted-foreground">AI {creativeStats.ai} · Human {creativeStats.human}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function Kpi({ icon: Icon, label, value, hint }: { icon: any; label: string; value: number | string; hint?: string }) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Icon className="h-3.5 w-3.5" />
          <span className="truncate">{label}</span>
        </div>
        <div className="text-2xl font-bold mt-1">{value}</div>
        {hint && <div className="text-[10px] text-muted-foreground truncate">{hint}</div>}
      </CardContent>
    </Card>
  );
}