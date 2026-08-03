import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useClients } from "@/hooks/useClients";
import { useTeamMember } from "@/contexts/TeamMemberContext";
import {
  Target, Loader2, Play, Ban, RefreshCw, Brain, Wrench, CheckCircle2,
  AlertTriangle, Gavel, Radio, Clock,
} from "lucide-react";

type Goal = {
  id: string;
  title: string;
  goal: string;
  client_id: string | null;
  status: string;
  iteration: number;
  max_iterations: number;
  counts: Record<string, number> | null;
  report_md: string | null;
  error: string | null;
  started_at: string | null;
  completed_at: string | null;
  last_heartbeat_at: string | null;
  created_at: string;
};

type GoalEvent = {
  id: string;
  goal_id: string;
  kind: string;
  title: string | null;
  content: string | null;
  data: any;
  created_at: string;
};

const STATUS_STYLES: Record<string, string> = {
  queued: "bg-muted text-muted-foreground",
  running: "bg-primary/15 text-primary border-primary/30",
  completed: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30",
  failed: "bg-destructive/15 text-destructive border-destructive/30",
  cancelled: "bg-muted text-muted-foreground",
  paused: "bg-amber-500/15 text-amber-600 border-amber-500/30",
};

const EVENT_META: Record<string, { icon: any; tint: string; label: string }> = {
  status: { icon: Radio, tint: "text-primary", label: "Status" },
  thought: { icon: Brain, tint: "text-foreground", label: "Jarvis" },
  progress: { icon: Clock, tint: "text-muted-foreground", label: "Progress" },
  tool_call: { icon: Wrench, tint: "text-blue-500", label: "Action" },
  tool_result: { icon: CheckCircle2, tint: "text-emerald-600", label: "Result" },
  decision: { icon: Gavel, tint: "text-amber-600", label: "Decision" },
  error: { icon: AlertTriangle, tint: "text-destructive", label: "Error" },
};

function ago(iso?: string | null) {
  if (!iso) return "—";
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function useGoals() {
  return useQuery({
    queryKey: ["jarvis_goals"],
    refetchInterval: 8000,
    queryFn: async (): Promise<Goal[]> => {
      const { data, error } = await (supabase as any)
        .from("jarvis_goals")
        .select("id,title,goal,client_id,status,iteration,max_iterations,counts,report_md,error,started_at,completed_at,last_heartbeat_at,created_at")
        .order("created_at", { ascending: false })
        .limit(40);
      if (error) throw error;
      return data || [];
    },
  });
}

function useGoalEvents(goalId: string | null) {
  return useQuery({
    queryKey: ["jarvis_goal_events", goalId],
    enabled: !!goalId,
    refetchInterval: 6000,
    queryFn: async (): Promise<GoalEvent[]> => {
      const { data, error } = await (supabase as any)
        .from("jarvis_goal_events")
        .select("id,goal_id,kind,title,content,data,created_at")
        .eq("goal_id", goalId)
        .order("created_at", { ascending: false })
        .limit(300);
      if (error) throw error;
      return data || [];
    },
  });
}

export function JarvisMissionsPanel() {
  const qc = useQueryClient();
  const { currentMember } = useTeamMember();
  const { data: clients = [] } = useClients();
  const { data: goals = [], isLoading } = useGoals();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [goalText, setGoalText] = useState("");
  const [clientId, setClientId] = useState<string>("none");
  const [maxIter, setMaxIter] = useState("200");

  const active = useMemo(() => goals.find((g) => g.id === activeId) || goals[0] || null, [goals, activeId]);
  const { data: events = [] } = useGoalEvents(active?.id ?? null);

  // Realtime feed — the mission keeps running on the backend either way.
  useEffect(() => {
    const ch = supabase
      .channel("jarvis-missions")
      .on("postgres_changes", { event: "*", schema: "public", table: "jarvis_goal_events" }, () => {
        qc.invalidateQueries({ queryKey: ["jarvis_goal_events"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "jarvis_goals" }, () => {
        qc.invalidateQueries({ queryKey: ["jarvis_goals"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc]);

  const launch = useMutation({
    mutationFn: async () => {
      const goal = goalText.trim();
      if (!goal) throw new Error("Describe the goal first");
      const { data, error } = await supabase.functions.invoke("jarvis-goal-worker", {
        body: {
          action: "create",
          goal,
          title: goal.split("\n")[0].slice(0, 120),
          client_id: clientId === "none" ? null : clientId,
          created_by: currentMember?.id || null,
          max_iterations: Number(maxIter) || 200,
        },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      return data as any;
    },
    onSuccess: (d: any) => {
      setGoalText("");
      setActiveId(d?.goal_id || null);
      qc.invalidateQueries({ queryKey: ["jarvis_goals"] });
      toast.success("Mission launched — Jarvis works this in the background until it's done.");
    },
    onError: (e: any) => toast.error(e?.message || "Failed to launch mission"),
  });

  const control = useMutation({
    mutationFn: async ({ action, goal_id }: { action: "cancel" | "resume"; goal_id: string }) => {
      const { error } = await supabase.functions.invoke("jarvis-goal-worker", { body: { action, goal_id } });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["jarvis_goals"] }),
    onError: (e: any) => toast.error(e?.message || "Action failed"),
  });

  const clientName = (id: string | null) => clients.find((c) => c.id === id)?.name || null;

  return (
    <Card className="p-4 sm:p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Target className="h-4 w-4 text-primary" />
          <div>
            <h3 className="text-sm font-semibold leading-none">Jarvis Missions</h3>
            <p className="text-[11px] text-muted-foreground mt-1">
              Give a goal — Jarvis runs it on the backend with the video, copy and Jeremy AI agents until it's finished. Closing this page doesn't stop it.
            </p>
          </div>
        </div>
        <Badge variant="outline" className="text-[10px]">
          {goals.filter((g) => g.status === "running" || g.status === "queued").length} active
        </Badge>
      </div>

      {/* Launcher */}
      <div className="rounded-lg border bg-muted/30 p-3 space-y-2.5">
        <Textarea
          value={goalText}
          onChange={(e) => setGoalText(e.target.value)}
          rows={3}
          placeholder="e.g. Review every creative for Capital Creative, get Jeremy's verdict on the top 5, then generate two 15s vertical videos from the best performers and report back."
          className="text-sm resize-none bg-background"
        />
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1 min-w-[180px] flex-1">
            <Label className="text-[10px] text-muted-foreground">Client scope</Label>
            <Select value={clientId} onValueChange={setClientId}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Agency-wide</SelectItem>
                {clients.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1 w-[110px]">
            <Label className="text-[10px] text-muted-foreground">Max steps</Label>
            <Input value={maxIter} onChange={(e) => setMaxIter(e.target.value.replace(/\D/g, ""))} className="h-8 text-xs" />
          </div>
          <Button size="sm" className="h-8" onClick={() => launch.mutate()} disabled={launch.isPending || !goalText.trim()}>
            {launch.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Play className="h-3.5 w-3.5 mr-1.5" />}
            Launch mission
          </Button>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-[280px_1fr]">
        {/* Mission list */}
        <div className="space-y-2">
          <ScrollArea className="h-[220px] lg:h-[460px] pr-2">
            <div className="space-y-2">
              {isLoading && <p className="text-xs text-muted-foreground px-1">Loading…</p>}
              {!isLoading && !goals.length && (
                <p className="text-xs text-muted-foreground px-1">No missions yet. Launch one above.</p>
              )}
              {goals.map((g) => (
                <button
                  key={g.id}
                  onClick={() => setActiveId(g.id)}
                  className={cn(
                    "w-full text-left rounded-lg border p-2.5 transition-colors",
                    active?.id === g.id ? "border-primary bg-primary/5" : "hover:bg-muted/50",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <Badge variant="outline" className={cn("text-[9px] capitalize", STATUS_STYLES[g.status])}>
                      {g.status === "running" && <Loader2 className="h-2.5 w-2.5 mr-1 animate-spin" />}
                      {g.status}
                    </Badge>
                    <span className="text-[9px] text-muted-foreground">{ago(g.created_at)}</span>
                  </div>
                  <p className="text-xs font-medium mt-1.5 line-clamp-2">{g.title}</p>
                  <p className="text-[10px] text-muted-foreground mt-1">
                    {clientName(g.client_id) || "Agency-wide"} · step {g.iteration}/{g.max_iterations}
                  </p>
                </button>
              ))}
            </div>
          </ScrollArea>
        </div>

        {/* Live feed */}
        <div className="rounded-lg border overflow-hidden">
          {!active ? (
            <div className="h-[300px] grid place-items-center text-xs text-muted-foreground">Select a mission to watch the feed.</div>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/30 px-3 py-2">
                <div className="min-w-0">
                  <p className="text-xs font-semibold truncate">{active.title}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {clientName(active.client_id) || "Agency-wide"} · heartbeat {ago(active.last_heartbeat_at)} · {active.counts?.tool_calls || 0} actions
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  {(active.status === "running" || active.status === "queued") && (
                    <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => control.mutate({ action: "cancel", goal_id: active.id })}>
                      <Ban className="h-3 w-3 mr-1" />Stop
                    </Button>
                  )}
                  {["failed", "cancelled", "paused"].includes(active.status) && (
                    <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => control.mutate({ action: "resume", goal_id: active.id })}>
                      <RefreshCw className="h-3 w-3 mr-1" />Resume
                    </Button>
                  )}
                </div>
              </div>

              {active.report_md && (
                <div className="border-b bg-emerald-500/5 px-3 py-2.5">
                  <p className="text-[10px] font-semibold text-emerald-600 mb-1">FINAL REPORT</p>
                  <pre className="text-[11px] whitespace-pre-wrap font-sans leading-relaxed">{active.report_md}</pre>
                  {!!active.counts && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {Object.entries(active.counts).map(([k, v]) => (
                        <Badge key={k} variant="secondary" className="text-[9px]">{k.replace(/_/g, " ")}: {String(v)}</Badge>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {active.error && (
                <div className="border-b bg-destructive/5 px-3 py-2 text-[11px] text-destructive">{active.error}</div>
              )}

              <ScrollArea className="h-[300px] lg:h-[380px]">
                <div className="divide-y">
                  {!events.length && <p className="text-xs text-muted-foreground p-3">Waiting for Jarvis…</p>}
                  {events.map((e) => {
                    const meta = EVENT_META[e.kind] || EVENT_META.progress;
                    const Icon = meta.icon;
                    return (
                      <div key={e.id} className="flex gap-2.5 px-3 py-2">
                        <Icon className={cn("h-3.5 w-3.5 mt-0.5 shrink-0", meta.tint)} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] font-medium">{e.title || meta.label}</span>
                            <span className="text-[9px] text-muted-foreground">{ago(e.created_at)}</span>
                            {e.data?.error && <Badge variant="outline" className="text-[8px] text-destructive border-destructive/30">error</Badge>}
                          </div>
                          {e.content && (
                            <pre className="text-[10.5px] text-muted-foreground whitespace-pre-wrap font-sans mt-0.5 line-clamp-6 break-words">
                              {e.content}
                            </pre>
                          )}
                          {e.kind === "decision" && e.data?.jeremy_verdict && (
                            <p className="text-[10px] mt-1 text-amber-600">Jeremy: {e.data.jeremy_verdict}</p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </ScrollArea>
            </>
          )}
        </div>
      </div>
    </Card>
  );
}