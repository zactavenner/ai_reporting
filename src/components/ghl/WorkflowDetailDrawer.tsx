import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, Copy, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";

type Props = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  clientId: string;
  workflowId: string | null;
  workflowName: string;
  status: string | null;
  version: number | null;
  ghlUpdatedAt: string | null;
};

type Parsed = {
  triggers: Array<{ label: string; type?: string; filters?: unknown }>;
  steps: Array<{ label: string; type?: string; raw: unknown }>;
  variables: Array<{ key: string; value?: unknown }>;
  lastRunAt: string | null;
  lastRunStatus: string | null;
  totalEnrolled: number | null;
};

function pick<T = unknown>(obj: unknown, keys: string[]): T | undefined {
  if (!obj || typeof obj !== "object") return undefined;
  for (const k of keys) {
    const v = (obj as Record<string, unknown>)[k];
    if (v !== undefined && v !== null) return v as T;
  }
  return undefined;
}

function parseWorkflow(json: unknown): Parsed {
  const root = (json && typeof json === "object" ? (json as Record<string, unknown>) : {}) as Record<string, unknown>;
  const wf = (root.workflow ?? root.data ?? root) as Record<string, unknown>;

  const triggersRaw = (pick<unknown[]>(wf, ["triggers", "workflowTriggers"]) ?? []) as unknown[];
  const triggers = triggersRaw.map((t) => {
    const o = (t ?? {}) as Record<string, unknown>;
    return {
      label: String(pick(o, ["name", "type", "eventType", "triggerType"]) ?? "Trigger"),
      type: pick<string>(o, ["type", "eventType", "triggerType"]),
      filters: pick(o, ["filters", "conditions", "data"]),
    };
  });

  const stepsRaw = (pick<unknown[]>(wf, ["steps", "actions", "nodes", "workflowSteps"]) ?? []) as unknown[];
  const steps = stepsRaw.map((s) => {
    const o = (s ?? {}) as Record<string, unknown>;
    return {
      label: String(pick(o, ["name", "type", "actionType", "kind"]) ?? "Step"),
      type: pick<string>(o, ["type", "actionType", "kind"]),
      raw: s,
    };
  });

  const varsRaw = pick(wf, ["customValues", "variables", "params", "data"]);
  let variables: Array<{ key: string; value?: unknown }> = [];
  if (Array.isArray(varsRaw)) {
    variables = varsRaw.map((v) => {
      const o = (v ?? {}) as Record<string, unknown>;
      return { key: String(pick(o, ["key", "name", "fieldKey"]) ?? "—"), value: pick(o, ["value", "defaultValue"]) };
    });
  } else if (varsRaw && typeof varsRaw === "object") {
    variables = Object.entries(varsRaw as Record<string, unknown>).map(([k, v]) => ({ key: k, value: v }));
  }

  return {
    triggers,
    steps,
    variables,
    lastRunAt: (pick<string>(wf, ["lastExecutedAt", "lastRunAt", "lastRun", "updatedAt"]) ?? null) as string | null,
    lastRunStatus: (pick<string>(wf, ["lastRunStatus", "lastExecutionStatus"]) ?? null) as string | null,
    totalEnrolled: (pick<number>(wf, ["totalEnrolled", "enrolledCount", "activeContacts"]) ?? null) as number | null,
  };
}

export function WorkflowDetailDrawer(props: Props) {
  const { open, onOpenChange, clientId, workflowId, workflowName, status, version, ghlUpdatedAt } = props;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [raw, setRaw] = useState<unknown>(null);

  useEffect(() => {
    if (!open || !workflowId) return;
    setLoading(true);
    setError(null);
    setRaw(null);
    supabase.functions
      .invoke("ghl-internal", { body: { clientId, action: "get_workflow", workflowId } })
      .then(({ data, error: err }) => {
        if (err) throw new Error(err.message);
        if (data && (data as { error?: string }).error) throw new Error((data as { error: string }).error);
        setRaw((data as { data?: unknown })?.data ?? data);
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [open, workflowId, clientId]);

  const parsed = useMemo(() => (raw ? parseWorkflow(raw) : null), [raw]);
  const rawJson = useMemo(() => (raw ? JSON.stringify(raw, null, 2) : ""), [raw]);

  const copyJson = () => {
    navigator.clipboard.writeText(rawJson);
    toast.success("Copied JSON");
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader className="space-y-1">
          <SheetTitle className="text-xl font-display truncate">{workflowName}</SheetTitle>
          <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground">
            <Badge variant={status === "published" ? "default" : "outline"} className="text-[10px] h-5">
              {status ?? "unknown"}
            </Badge>
            {version != null && <span>v{version}</span>}
            {ghlUpdatedAt && <span>· Updated {formatDistanceToNow(new Date(ghlUpdatedAt), { addSuffix: true })}</span>}
          </div>
        </SheetHeader>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="mt-6 border rounded-lg p-4 bg-destructive/5 text-sm">
            <div className="flex items-center gap-2 font-medium text-destructive mb-1">
              <AlertCircle className="h-4 w-4" /> Failed to load workflow detail
            </div>
            <div className="text-muted-foreground text-xs">{error}</div>
            <p className="text-xs text-muted-foreground mt-2">
              Full workflow detail requires the GHL Firebase refresh token to be captured for this client (Advanced tab).
            </p>
          </div>
        ) : parsed ? (
          <Tabs defaultValue="overview" className="mt-4">
            <TabsList className="w-full grid grid-cols-5">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="triggers">Triggers ({parsed.triggers.length})</TabsTrigger>
              <TabsTrigger value="steps">Steps ({parsed.steps.length})</TabsTrigger>
              <TabsTrigger value="variables">Variables ({parsed.variables.length})</TabsTrigger>
              <TabsTrigger value="json">JSON</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="space-y-2 mt-4">
              <Row label="Last run" value={parsed.lastRunAt ? formatDistanceToNow(new Date(parsed.lastRunAt), { addSuffix: true }) : "—"} />
              <Row label="Last run status" value={parsed.lastRunStatus ?? "—"} />
              <Row label="Enrolled contacts" value={parsed.totalEnrolled != null ? String(parsed.totalEnrolled) : "—"} />
              <Row label="Triggers" value={String(parsed.triggers.length)} />
              <Row label="Steps" value={String(parsed.steps.length)} />
              <Row label="Variables" value={String(parsed.variables.length)} />
            </TabsContent>

            <TabsContent value="triggers" className="space-y-2 mt-4">
              {parsed.triggers.length === 0 ? <Empty text="No triggers found in payload" /> :
                parsed.triggers.map((t, i) => (
                  <div key={i} className="border rounded-lg p-3 bg-card">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-[10px] h-5">{t.type ?? "trigger"}</Badge>
                      <span className="text-sm font-medium truncate">{t.label}</span>
                    </div>
                    {t.filters ? (
                      <pre className="mt-2 text-[10px] bg-muted/50 rounded p-2 overflow-x-auto max-h-40">
{JSON.stringify(t.filters, null, 2)}
                      </pre>
                    ) : null}
                  </div>
                ))}
            </TabsContent>

            <TabsContent value="steps" className="space-y-2 mt-4">
              {parsed.steps.length === 0 ? <Empty text="No steps found in payload" /> :
                parsed.steps.map((s, i) => (
                  <details key={i} className="border rounded-lg p-3 bg-card">
                    <summary className="cursor-pointer flex items-center gap-2 text-sm">
                      <span className="text-muted-foreground tabular-nums text-xs w-6">{i + 1}.</span>
                      <Badge variant="outline" className="text-[10px] h-5">{s.type ?? "step"}</Badge>
                      <span className="font-medium truncate">{s.label}</span>
                    </summary>
                    <pre className="mt-2 text-[10px] bg-muted/50 rounded p-2 overflow-x-auto max-h-64">
{JSON.stringify(s.raw, null, 2)}
                    </pre>
                  </details>
                ))}
            </TabsContent>

            <TabsContent value="variables" className="space-y-1 mt-4">
              {parsed.variables.length === 0 ? <Empty text="No variables found in payload" /> :
                <div className="border rounded-lg divide-y bg-card">
                  {parsed.variables.map((v, i) => (
                    <div key={i} className="flex items-start justify-between gap-3 px-3 py-2 text-xs">
                      <span className="font-mono text-foreground">{v.key}</span>
                      <span className="font-mono text-muted-foreground text-right truncate max-w-[60%]">
                        {v.value == null ? "—" : typeof v.value === "object" ? JSON.stringify(v.value) : String(v.value)}
                      </span>
                    </div>
                  ))}
                </div>}
            </TabsContent>

            <TabsContent value="json" className="mt-4 space-y-2">
              <div className="flex justify-end">
                <Button size="sm" variant="outline" onClick={copyJson} className="gap-1.5">
                  <Copy className="h-3.5 w-3.5" /> Copy
                </Button>
              </div>
              <pre className="text-[10px] bg-muted/50 rounded p-3 overflow-x-auto max-h-[70vh]">{rawJson}</pre>
            </TabsContent>
          </Tabs>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border rounded-lg px-3 py-2 bg-card text-sm">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="text-center text-xs text-muted-foreground py-8 border rounded-lg bg-muted/20">{text}</div>;
}