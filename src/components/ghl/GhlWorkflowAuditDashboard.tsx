import { useMemo, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Loader2, RefreshCw, AlertCircle, CheckCircle2, CircleDashed } from "lucide-react";
import { useGhlWorkflowAudit, useRefreshGhlWorkflows, type ClientAuditRow } from "@/hooks/useGhlWorkflowAudit";
import { ClientWorkflowsDrawer } from "./ClientWorkflowsDrawer";

function rowRank(r: ClientAuditRow): number {
  if (r.lastSyncStatus === "error") return 0;
  if (r.lastSyncStatus === "never" && r.hasCredentials) return 1;
  if (r.staleCount > 0) return 2;
  if (r.draftCount > 0) return 3;
  return 4;
}

export function GhlWorkflowAuditDashboard() {
  const { data: rows = [], isLoading } = useGhlWorkflowAudit();
  const refresh = useRefreshGhlWorkflows();
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<ClientAuditRow | null>(null);

  const filtered = useMemo(() => {
    return [...rows]
      .filter((r) => !q || r.clientName.toLowerCase().includes(q.toLowerCase()))
      .sort((a, b) => rowRank(a) - rowRank(b) || a.clientName.localeCompare(b.clientName));
  }, [rows, q]);

  const totals = useMemo(() => rows.reduce((acc, r) => ({
    workflows: acc.workflows + r.workflowCount,
    published: acc.published + r.publishedCount,
    draft: acc.draft + r.draftCount,
    stale: acc.stale + r.staleCount,
    errors: acc.errors + (r.lastSyncStatus === "error" ? 1 : 0),
  }), { workflows: 0, published: 0, draft: 0, stale: 0, errors: 0 }), [rows]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-display text-2xl font-bold text-foreground">GHL Workflow Audit</h2>
          <p className="text-sm text-muted-foreground mt-1">Cross-client workflow inventory · read-only</p>
        </div>
        <Button onClick={() => refresh.mutate(undefined)} disabled={refresh.isPending} className="gap-2">
          {refresh.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Refresh All
        </Button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <Stat label="Workflows" value={totals.workflows} />
        <Stat label="Published" value={totals.published} />
        <Stat label="Draft" value={totals.draft} tone="blue" />
        <Stat label="Stale" value={totals.stale} tone="amber" />
        <Stat label="Clients" value={rows.length} />
        <Stat label="Sync Errors" value={totals.errors} tone={totals.errors > 0 ? "red" : undefined} />
      </div>

      <div className="flex items-center gap-2">
        <Input placeholder="Search clients…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-14"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : filtered.length === 0 ? (
            <div className="py-14 text-center text-sm text-muted-foreground">No clients found</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Client</TableHead>
                  <TableHead className="text-right">Workflows</TableHead>
                  <TableHead className="text-right">Published</TableHead>
                  <TableHead className="text-right">Draft</TableHead>
                  <TableHead className="text-right">Stale</TableHead>
                  <TableHead>Last Sync</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-10"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((r) => (
                  <TableRow key={r.clientId} className="cursor-pointer" onClick={() => setSelected(r)}>
                    <TableCell className="font-medium">
                      {r.clientName}
                      {r.duplicateCount > 0 && <span className="ml-2 text-[10px] text-purple-600 dark:text-purple-400">· {r.duplicateCount} dup</span>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{r.workflowCount}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.publishedCount}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.draftCount || "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.staleCount || "—"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {r.lastSyncAt ? formatDistanceToNow(new Date(r.lastSyncAt), { addSuffix: true }) : "Never"}
                    </TableCell>
                    <TableCell><StatusPill row={r} /></TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); refresh.mutate(r.clientId); }} disabled={refresh.isPending} aria-label="Refresh client">
                        <RefreshCw className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <ClientWorkflowsDrawer
        open={!!selected}
        onOpenChange={(o) => !o && setSelected(null)}
        clientId={selected?.clientId ?? null}
        clientName={selected?.clientName ?? ""}
        lastSyncAt={selected?.lastSyncAt ?? null}
        lastSyncStatus={selected?.lastSyncStatus ?? "never"}
        lastSyncError={selected?.lastSyncError ?? null}
        hasCredentials={selected?.hasCredentials ?? false}
      />
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "amber" | "blue" | "red" }) {
  const toneClass = tone === "amber" ? "text-amber-600 dark:text-amber-400"
    : tone === "blue" ? "text-blue-600 dark:text-blue-400"
    : tone === "red" ? "text-red-600 dark:text-red-400" : "text-foreground";
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">{label}</div>
        <div className={`text-2xl font-bold ${toneClass} tabular-nums mt-0.5`}>{value}</div>
      </CardContent>
    </Card>
  );
}

function StatusPill({ row }: { row: ClientAuditRow }) {
  if (!row.hasCredentials) {
    return <Badge variant="outline" className="gap-1"><CircleDashed className="h-3 w-3" /> Not connected</Badge>;
  }
  if (row.lastSyncStatus === "error") {
    return <Badge variant="outline" className="gap-1 border-red-500/40 text-red-600 dark:text-red-400"><AlertCircle className="h-3 w-3" /> Error</Badge>;
  }
  if (row.lastSyncStatus === "never") {
    return <Badge variant="outline" className="gap-1"><CircleDashed className="h-3 w-3" /> Never synced</Badge>;
  }
  return <Badge variant="outline" className="gap-1 border-emerald-500/40 text-emerald-700 dark:text-emerald-400"><CheckCircle2 className="h-3 w-3" /> Healthy</Badge>;
}