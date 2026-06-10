import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Bot, MessageSquare, Image as ImageIcon, FileText, DollarSign, Network, Activity } from "lucide-react";
import type { Client } from "@/hooks/useClients";
import { useAgents } from "@/hooks/useAgents";
import { formatDistanceToNow } from "date-fns";

interface Props { clients: Client[]; }

// Rough cost estimate per token for mixed gemini/gpt usage
const COST_PER_1K_TOKENS = 0.002;

export function AgentsOverview({ clients }: Props) {
  const { data: agents = [] } = useAgents();

  const { data: hermesTasks = [] } = useQuery({
    queryKey: ["agents-overview", "hermes_tasks"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("hermes_tasks" as any)
        .select("id, client_id, task_type, status, instructions, agent_id, created_at, completed_at, result_assets")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const { data: clientAgents = [] } = useQuery({
    queryKey: ["agents-overview", "client_agents"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("client_agents" as any)
        .select("id, client_id, name, handle, agent_type, enabled");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const { data: assetsCounts } = useQuery({
    queryKey: ["agents-overview", "client_assets_counts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("client_assets" as any)
        .select("asset_type")
        .limit(5000);
      if (error) throw error;
      const rows = (data ?? []) as unknown as { asset_type: string }[];
      let creative = 0;
      let text = 0;
      for (const r of rows) {
        const t = (r.asset_type || "").toLowerCase();
        if (t.includes("video") || t.includes("image") || t.includes("creative") || t.includes("static")) creative++;
        else text++;
      }
      return { creative, text, total: rows.length };
    },
  });

  const { data: runsAgg } = useQuery({
    queryKey: ["agents-overview", "runs_agg"],
    queryFn: async () => {
      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const { data, error } = await supabase
        .from("agent_runs")
        .select("tokens_used, cost_usd, status, started_at")
        .gte("started_at", since)
        .limit(5000);
      if (error) throw error;
      const rows = data ?? [];
      const tokens = rows.reduce((s, r) => s + (r.tokens_used || 0), 0);
      const cost = rows.reduce((s, r) => s + Number(r.cost_usd || 0), 0);
      return { tokens, cost, runs: rows.length };
    },
  });

  const clientMap = new Map(clients.map((c) => [c.id, c]));
  const totalCost = (runsAgg?.cost ?? 0) + ((runsAgg?.tokens ?? 0) / 1000) * 0 + 0;
  const estCost = (runsAgg?.cost ?? 0) || ((runsAgg?.tokens ?? 0) / 1000) * COST_PER_1K_TOKENS;

  // Group client agents by client for org chart
  const byClient = new Map<string, any[]>();
  for (const a of clientAgents) {
    const arr = byClient.get(a.client_id) || [];
    arr.push(a);
    byClient.set(a.client_id, arr);
  }

  return (
    <div className="space-y-6">
      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Kpi icon={MessageSquare} label="Hermes ↔ Agent messages" value={hermesTasks.length} hint="last 50" />
        <Kpi icon={ImageIcon} label="Creative output" value={assetsCounts?.creative ?? 0} hint="videos + images" />
        <Kpi icon={FileText} label="Text output" value={assetsCounts?.text ?? 0} hint="copy + scripts" />
        <Kpi icon={DollarSign} label="Estimated cost (30d)" value={`$${estCost.toFixed(2)}`} hint={`${(runsAgg?.tokens ?? 0).toLocaleString()} tokens`} />
        <Kpi icon={Activity} label="Active agents" value={agents.filter((a) => a.enabled).length + clientAgents.filter((a) => a.enabled).length} hint={`${agents.length + clientAgents.length} total`} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Hermes feed */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <MessageSquare className="h-4 w-4" /> Hermes ↔ Agents activity
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 max-h-[480px] overflow-y-auto">
            {hermesTasks.length === 0 && (
              <p className="text-sm text-muted-foreground">No Hermes activity yet. Connect Hermes in Agency Settings → Hermes.</p>
            )}
            {hermesTasks.map((t) => {
              const client = clientMap.get(t.client_id);
              return (
                <div key={t.id} className="flex items-start gap-3 p-2 rounded-lg border bg-card/40">
                  <div className="h-8 w-8 rounded-md bg-primary/10 grid place-items-center shrink-0">
                    <Bot className="h-4 w-4 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 text-xs">
                      <span className="font-medium truncate">{client?.name ?? "Unknown client"}</span>
                      <Badge variant="outline" className="text-[10px]">{t.task_type}</Badge>
                      <Badge variant={t.status === "completed" ? "default" : t.status === "failed" ? "destructive" : "secondary"} className="text-[10px]">
                        {t.status}
                      </Badge>
                      <span className="text-muted-foreground ml-auto whitespace-nowrap">
                        {t.created_at ? formatDistanceToNow(new Date(t.created_at), { addSuffix: true }) : ""}
                      </span>
                    </div>
                    <p className="text-sm mt-1 line-clamp-2">{t.instructions || "(no instructions)"}</p>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>

        {/* Org chart */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Network className="h-4 w-4" /> Agents & teams org chart
            </CardTitle>
          </CardHeader>
          <CardContent className="max-h-[480px] overflow-y-auto">
            <div className="flex flex-col items-center gap-4">
              <div className="px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-semibold shadow">
                🤖 Hermes (Master Orchestrator)
              </div>
              <div className="w-px h-4 bg-border" />
              <div className="flex flex-wrap gap-2 justify-center">
                {agents.map((a) => (
                  <div key={a.id} className="px-3 py-1.5 rounded-lg border bg-muted/50 text-xs flex items-center gap-1.5">
                    <span>{a.icon || "⚙️"}</span>
                    <span className="font-medium">{a.name}</span>
                    {a.enabled ? <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> : <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40" />}
                  </div>
                ))}
                {agents.length === 0 && <p className="text-xs text-muted-foreground">No agency agents yet.</p>}
              </div>

              <div className="w-full mt-4 space-y-3">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Per-client agents</p>
                {clients
                  .filter((c) => byClient.has(c.id))
                  .map((c) => {
                    const list = byClient.get(c.id) || [];
                    return (
                      <div key={c.id} className="rounded-lg border p-2">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-medium">{c.name}</span>
                          <span className="text-[10px] text-muted-foreground">{list.length} agents</span>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {list.map((a) => (
                            <Badge key={a.id} variant="outline" className="text-[10px]">
                              @{a.handle} · {a.agent_type}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                {byClient.size === 0 && (
                  <p className="text-xs text-muted-foreground">No client-scoped agents yet. Add them inside each client's AI Studio → Agents tab.</p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
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
        {hint && <div className="text-[10px] text-muted-foreground">{hint}</div>}
      </CardContent>
    </Card>
  );
}