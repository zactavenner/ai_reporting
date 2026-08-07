import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Cable, Plus, Play, Trash2, Loader2, CheckCircle2, AlertCircle, Clock, X,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import {
  useAgentConnectors, useSaveAgentConnector, useDeleteAgentConnector, useTestAgentConnector,
  CONNECTOR_KINDS, CONNECTOR_TARGET_SUGGESTIONS,
  type AgentConnector, type AgentConnectorKind, type ConnectorTestResult,
} from "@/hooks/useAgentConnectors";

const REFRESH_PRESETS = [
  { value: 15, label: "Every 15 min" },
  { value: 60, label: "Hourly" },
  { value: 360, label: "Every 6 hours" },
  { value: 1440, label: "Daily" },
];

function StatusPill({ c }: { c: AgentConnector }) {
  if (!c.last_status) {
    return <Badge variant="outline" className="text-[10px]"><Clock className="h-3 w-3 mr-1" /> never tested</Badge>;
  }
  return c.last_status === "ok" ? (
    <Badge variant="outline" className="text-[10px] bg-emerald-500/10 text-emerald-600 border-emerald-500/20">
      <CheckCircle2 className="h-3 w-3 mr-1" /> active · {c.last_row_count ?? 0} rows
    </Badge>
  ) : (
    <Badge variant="outline" className="text-[10px] bg-red-500/10 text-red-600 border-red-500/20">
      <AlertCircle className="h-3 w-3 mr-1" /> error
    </Badge>
  );
}

export function AgentConnectorsPanel({
  agentId,
  clientId = null,
  clientName,
}: {
  agentId: string;
  clientId?: string | null;
  clientName?: string;
}) {
  const { data: connectors = [], isLoading } = useAgentConnectors(agentId, clientId);
  const save = useSaveAgentConnector();
  const del = useDeleteAgentConnector();
  const test = useTestAgentConnector();

  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState<AgentConnectorKind>("supabase_table");
  const [label, setLabel] = useState("");
  const [target, setTarget] = useState("");
  const [filtersText, setFiltersText] = useState("{}");
  const [rowLimit, setRowLimit] = useState(50);
  const [refresh, setRefresh] = useState(60);
  const [results, setResults] = useState<Record<string, ConnectorTestResult>>({});

  const suggestions = useMemo(() => CONNECTOR_TARGET_SUGGESTIONS[kind] || [], [kind]);

  const reset = () => {
    setAdding(false); setKind("supabase_table"); setLabel(""); setTarget("");
    setFiltersText("{}"); setRowLimit(50); setRefresh(60);
  };

  const submit = async () => {
    let filters: Record<string, any> = {};
    try { filters = filtersText.trim() ? JSON.parse(filtersText) : {}; }
    catch { return; }
    await save.mutateAsync({
      agent_id: agentId,
      client_id: clientId,
      kind,
      label: label.trim() || target,
      target: target.trim(),
      filters,
      row_limit: rowLimit,
      refresh_interval_minutes: refresh,
      is_active: true,
    });
    reset();
  };

  const runTest = async (c: AgentConnector) => {
    const res = await test.mutateAsync({ connector_id: c.id, client_id: clientId });
    if (res[0]) setResults((prev) => ({ ...prev, [c.id]: res[0] }));
  };

  const runAll = async () => {
    const res = await test.mutateAsync({ agent_id: agentId, client_id: clientId });
    setResults(Object.fromEntries(res.map((r) => [r.connector_id, r])));
  };

  let filtersInvalid = false;
  try { JSON.parse(filtersText || "{}"); } catch { filtersInvalid = true; }

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Cable className="h-4 w-4 text-primary" />
          <p className="text-sm font-semibold">Connectors</p>
          <Badge variant="secondary" className="text-[10px]">
            {clientId ? `${clientName || "Client"} scope` : "Master scope"}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          {connectors.length > 0 && (
            <Button size="sm" variant="outline" onClick={runAll} disabled={test.isPending}>
              {test.isPending ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Play className="h-3 w-3 mr-1" />} Test all
            </Button>
          )}
          <Button size="sm" onClick={() => setAdding((v) => !v)}>
            {adding ? <X className="h-3 w-3 mr-1" /> : <Plus className="h-3 w-3 mr-1" />}
            {adding ? "Cancel" : "Add connector"}
          </Button>
        </div>
      </div>

      {adding && (
        <div className="rounded-lg border bg-muted/30 p-3 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Type</Label>
              <Select value={kind} onValueChange={(v) => { setKind(v as AgentConnectorKind); setTarget(""); }}>
                <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CONNECTOR_KINDS.map((k) => (
                    <SelectItem key={k.value} value={k.value}>
                      <div className="flex flex-col">
                        <span className="text-xs font-medium">{k.label}</span>
                        <span className="text-[10px] text-muted-foreground">{k.hint}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Target</Label>
              <Input
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                placeholder={suggestions[0] || "table or action name"}
                className="h-9 text-xs"
              />
              <div className="flex flex-wrap gap-1 pt-1">
                {suggestions.slice(0, 8).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => { setTarget(s); if (!label) setLabel(s); }}
                    className="text-[10px] px-1.5 py-0.5 rounded border hover:border-primary/50 hover:bg-primary/5"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Label</Label>
              <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Daily metrics" className="h-9 text-xs" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Row limit</Label>
              <Input type="number" min={1} max={500} value={rowLimit} onChange={(e) => setRowLimit(Number(e.target.value) || 50)} className="h-9 text-xs" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Refresh</Label>
              <Select value={String(refresh)} onValueChange={(v) => setRefresh(Number(v))}>
                <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {REFRESH_PRESETS.map((p) => <SelectItem key={p.value} value={String(p.value)}>{p.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Default filters (JSON)</Label>
            <Textarea
              rows={3}
              value={filtersText}
              onChange={(e) => setFiltersText(e.target.value)}
              className="text-xs font-mono"
              placeholder={`{"date": {"op": "gte", "value": "2026-08-01"}, "client_id": "{{client_id}}"}`}
            />
            <p className="text-[10px] text-muted-foreground">
              Operators: eq, gt, gte, lt, lte, neq, like, ilike, in, is. Use <code>{"{{client_id}}"}</code> to inject the running client.
              {filtersInvalid && <span className="text-destructive"> · invalid JSON</span>}
            </p>
          </div>

          <div className="flex justify-end">
            <Button size="sm" onClick={submit} disabled={!target.trim() || filtersInvalid || save.isPending}>
              {save.isPending ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : null} Save connector
            </Button>
          </div>
        </div>
      )}

      {isLoading ? (
        <p className="text-xs text-muted-foreground">Loading connectors…</p>
      ) : connectors.length === 0 ? (
        <div className="border border-dashed rounded-lg p-6 text-center space-y-2">
          <p className="text-xs text-muted-foreground">
            No connectors yet. Wire this agent to the tables and actions it should read before every run.
          </p>
          <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
            <Plus className="h-3 w-3 mr-1" /> Add first connector
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          {connectors.map((c) => {
            const r = results[c.id];
            const isMasterRow = c.client_id === null;
            return (
              <div key={c.id} className="rounded-lg border p-3 bg-card/50 space-y-2">
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-xs font-semibold truncate">{c.label}</p>
                      <Badge variant="outline" className="text-[9px]">{c.kind.replace("supabase_", "")}</Badge>
                      <Badge variant={isMasterRow ? "default" : "secondary"} className="text-[9px]">
                        {isMasterRow ? "master" : "client"}
                      </Badge>
                      <StatusPill c={c} />
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-0.5 font-mono truncate">{c.target}</p>
                    <p className="text-[10px] text-muted-foreground">
                      limit {c.row_limit} · refresh {c.refresh_interval_minutes}m
                      {c.last_tested_at ? ` · tested ${formatDistanceToNow(new Date(c.last_tested_at), { addSuffix: true })}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Switch
                      checked={c.is_active}
                      onCheckedChange={(v) => save.mutate({ id: c.id, agent_id: agentId, client_id: c.client_id, is_active: v })}
                    />
                    <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => runTest(c)} disabled={test.isPending}>
                      {test.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                    </Button>
                    {(clientId ? !isMasterRow : true) && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-destructive"
                        onClick={() => del.mutate({ id: c.id, agent_id: agentId, client_id: c.client_id })}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                </div>

                {(c.last_error || r?.error) && (
                  <p className="text-[10px] text-destructive bg-destructive/5 rounded px-2 py-1">
                    {r?.error || c.last_error}
                  </p>
                )}
                {r?.status === "ok" && (
                  <div className="rounded bg-muted/40 p-2">
                    <p className="text-[10px] text-muted-foreground mb-1">
                      {r.row_count} row{r.row_count === 1 ? "" : "s"} in {r.duration_ms}ms — sample
                    </p>
                    <pre className="text-[10px] font-mono overflow-x-auto max-h-40">
                      {JSON.stringify(r.sample, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
