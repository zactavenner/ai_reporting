import { useMemo, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Card, CardContent } from "@/components/ui/card";
import { useGhlClientWorkflows, type WorkflowRow } from "@/hooks/useGhlClientWorkflows";
import { useGhlWorkflowAudit, useRefreshGhlWorkflows } from "@/hooks/useGhlWorkflowAudit";
import { Loader2, RefreshCw, ArrowUpRight, AlertCircle } from "lucide-react";
import { WorkflowDetailDrawer } from "./WorkflowDetailDrawer";

type Filter = "all" | "published" | "draft" | "stale" | "duplicates" | "changed";

function issueRank(w: WorkflowRow): number {
  if (w.isDraft) return 1;
  if (w.isStale) return 2;
  if (w.isDuplicate) return 3;
  return 4;
}

export function ClientWorkflowsTab({ clientId }: { clientId: string }) {
  const { data: workflows = [], isLoading } = useGhlClientWorkflows(clientId);
  const { data: auditRows = [] } = useGhlWorkflowAudit();
  const refresh = useRefreshGhlWorkflows();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("published");
  const [selected, setSelected] = useState<WorkflowRow | null>(null);

  const meta = auditRows.find((r) => r.clientId === clientId);

  const stats = useMemo(() => ({
    total: workflows.length,
    published: workflows.filter((w) => !w.isDraft).length,
    draft: workflows.filter((w) => w.isDraft).length,
    stale: workflows.filter((w) => w.isStale).length,
    duplicates: workflows.filter((w) => w.isDuplicate).length,
  }), [workflows]);

  const filtered = useMemo(() => {
    let list = workflows.filter((w) => !q || w.name.toLowerCase().includes(q.toLowerCase()));
    if (filter === "published") list = list.filter((w) => !w.isDraft);
    if (filter === "draft") list = list.filter((w) => w.isDraft);
    if (filter === "stale") list = list.filter((w) => w.isStale);
    if (filter === "duplicates") list = list.filter((w) => w.isDuplicate);
    if (filter === "changed") list = list.filter((w) => w.hasChanges);
    return [...list].sort((a, b) => issueRank(a) - issueRank(b));
  }, [workflows, q, filter]);

  const filters: Array<{ key: Filter; label: string; count?: number }> = [
    { key: "all", label: "All", count: stats.total },
    { key: "published", label: "Published", count: stats.published },
    { key: "draft", label: "Draft", count: stats.draft },
    { key: "stale", label: "Stale", count: stats.stale },
    { key: "duplicates", label: "Duplicates", count: stats.duplicates },
    { key: "changed", label: "Changed" },
  ];

  const hasCredentials = meta?.hasCredentials ?? true;
  const syncStatus = meta?.lastSyncStatus ?? "never";
  const syncError = meta?.lastSyncError ?? null;
  const syncAt = meta?.lastSyncAt ?? null;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-bold">GHL Workflows</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {syncAt ? `Last synced ${formatDistanceToNow(new Date(syncAt), { addSuffix: true })}` : "Never synced"}
            {syncStatus === "error" && syncError ? ` · ${syncError}` : ""} · read-only
          </p>
        </div>
        <Button size="sm" onClick={() => refresh.mutate(clientId)} disabled={refresh.isPending} className="gap-2">
          {refresh.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Refresh
        </Button>
      </div>

      {!hasCredentials && (
        <Card className="border-dashed"><CardContent className="p-6 text-center text-sm text-muted-foreground">
          <AlertCircle className="h-5 w-5 mx-auto mb-2 text-amber-500" />
          GHL is not connected for this client. Add API credentials in client settings to sync workflows.
        </CardContent></Card>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        <Stat label="Workflows" value={stats.total} />
        <Stat label="Published" value={stats.published} />
        <Stat label="Draft" value={stats.draft} tone="blue" />
        <Stat label="Stale" value={stats.stale} tone="amber" />
        <Stat label="Duplicates" value={stats.duplicates} tone="purple" />
      </div>

      <div className="flex gap-2">
        <Input placeholder="Search workflows…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-sm" />
      </div>
      <div className="flex flex-wrap gap-1.5">
        {filters.map((f) => (
          <button key={f.key} onClick={() => setFilter(f.key)}
            className={`px-2.5 py-1 text-xs rounded-full border transition ${filter === f.key ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border hover:bg-muted"}`}>
            {f.label}{typeof f.count === "number" ? ` (${f.count})` : ""}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-14"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-14 text-sm text-muted-foreground">No workflows found</div>
      ) : (
        <div className="space-y-2">
          {filtered.map((w) => (
            <WorkflowCard key={w.workflow_id} w={w} onClick={() => setSelected(w)} />
          ))}
        </div>
      )}

      <WorkflowDetailDrawer
        open={!!selected}
        onOpenChange={(o) => !o && setSelected(null)}
        clientId={clientId}
        workflowId={selected?.workflow_id ?? null}
        workflowName={selected?.name ?? ""}
        status={selected?.status ?? null}
        version={selected?.version ?? null}
        ghlUpdatedAt={selected?.ghl_updated_at ?? null}
      />
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "amber" | "blue" | "purple" }) {
  const toneClass = tone === "amber" ? "text-amber-600 dark:text-amber-400"
    : tone === "blue" ? "text-blue-600 dark:text-blue-400"
    : tone === "purple" ? "text-purple-600 dark:text-purple-400" : "text-foreground";
  return (
    <Card><CardContent className="p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">{label}</div>
      <div className={`text-xl font-bold ${toneClass} tabular-nums mt-0.5`}>{value}</div>
    </CardContent></Card>
  );
}

function WorkflowCard({ w, onClick }: { w: WorkflowRow; onClick: () => void }) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } }}
      className="border rounded-lg p-3 space-y-1.5 bg-card hover:bg-muted/40 cursor-pointer transition"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="font-medium text-sm truncate">{w.name}</div>
        <Badge variant={w.isDraft ? "outline" : "default"} className="text-[10px] h-5 flex-shrink-0">
          {w.status ?? "unknown"}
        </Badge>
      </div>
      <div className="text-xs text-muted-foreground flex items-center gap-2 flex-wrap">
        {w.version != null && <span>v{w.version}</span>}
        {w.ghl_updated_at && <span>Updated {formatDistanceToNow(new Date(w.ghl_updated_at), { addSuffix: true })}</span>}
      </div>
      <div className="flex flex-wrap gap-1 pt-0.5">
        {w.isStale && <Badge variant="secondary" className="text-[10px] h-5 bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30">Stale</Badge>}
        {w.isDraft && <Badge variant="secondary" className="text-[10px] h-5 bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30">Draft</Badge>}
        {w.isDuplicate && <Badge variant="secondary" className="text-[10px] h-5 bg-purple-500/15 text-purple-700 dark:text-purple-400 border-purple-500/30">Duplicate name</Badge>}
        {w.hasChanges && (
          <Popover>
            <PopoverTrigger asChild>
              <button className="inline-flex items-center gap-1 text-[10px] h-5 px-2 rounded border border-emerald-500/30 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">
                Changed since last sync <ArrowUpRight className="h-3 w-3" />
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-72 text-xs space-y-1.5">
              <div className="font-semibold text-sm mb-1">Recent changes</div>
              {w.recentChanges.map((c, i) => (
                <div key={i} className="border-b border-border/50 pb-1 last:border-0">
                  <div className="text-muted-foreground">{c.field}</div>
                  <div>{c.old_value ?? "—"} → <span className="font-medium">{c.new_value ?? "—"}</span></div>
                  <div className="text-[10px] text-muted-foreground">{formatDistanceToNow(new Date(c.changed_at), { addSuffix: true })}</div>
                </div>
              ))}
            </PopoverContent>
          </Popover>
        )}
      </div>
    </div>
  );
}