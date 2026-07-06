import { useMemo, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useGhlClientWorkflows, type WorkflowRow } from "@/hooks/useGhlClientWorkflows";
import { useRefreshGhlWorkflows } from "@/hooks/useGhlWorkflowAudit";
import { Loader2, RefreshCw, ArrowUpRight } from "lucide-react";

type Filter = "all" | "published" | "draft" | "stale" | "duplicates" | "changed";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  clientId: string | null;
  clientName: string;
  lastSyncAt: string | null;
  lastSyncStatus: "success" | "error" | "never";
  lastSyncError: string | null;
  hasCredentials: boolean;
}

function issueRank(w: WorkflowRow): number {
  if (w.isDraft) return 1;
  if (w.isStale) return 2;
  if (w.isDuplicate) return 3;
  return 4;
}

export function ClientWorkflowsDrawer(props: Props) {
  const { open, onOpenChange, clientId, clientName, lastSyncAt, lastSyncStatus, lastSyncError, hasCredentials } = props;
  const { data: workflows = [], isLoading } = useGhlClientWorkflows(clientId);
  const refresh = useRefreshGhlWorkflows();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const filtered = useMemo(() => {
    let list = workflows.filter((w) => !q || w.name.toLowerCase().includes(q.toLowerCase()));
    if (filter === "published") list = list.filter((w) => !w.isDraft);
    if (filter === "draft") list = list.filter((w) => w.isDraft);
    if (filter === "stale") list = list.filter((w) => w.isStale);
    if (filter === "duplicates") list = list.filter((w) => w.isDuplicate);
    if (filter === "changed") list = list.filter((w) => w.hasChanges);
    return [...list].sort((a, b) => issueRank(a) - issueRank(b));
  }, [workflows, q, filter]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader className="space-y-1">
          <SheetTitle className="text-xl font-display">{clientName} — Workflows</SheetTitle>
          <p className="text-xs text-muted-foreground">
            {lastSyncAt ? `Last synced ${formatDistanceToNow(new Date(lastSyncAt), { addSuffix: true })}` : "Never synced"}
            {lastSyncStatus === "error" && lastSyncError ? ` · ${lastSyncError}` : ""}
          </p>
        </SheetHeader>

        {!hasCredentials ? (
          <EmptyState title="GHL Not Connected" body="Connect this client's GoHighLevel account to begin auditing workflows." cta="Go to Client Settings" href="/clients" />
        ) : lastSyncStatus === "error" ? (
          <>
            <EmptyState title="GHL Connection Error" body={lastSyncError ?? "The stored access token is invalid or expired."} cta="Refresh sync" onClick={() => clientId && refresh.mutate(clientId)} loading={refresh.isPending} />
            <WorkflowList workflows={filtered} q={q} setQ={setQ} filter={filter} setFilter={setFilter} onRefresh={() => clientId && refresh.mutate(clientId)} refreshing={refresh.isPending} isLoading={isLoading} />
          </>
        ) : (
          <WorkflowList workflows={filtered} q={q} setQ={setQ} filter={filter} setFilter={setFilter} onRefresh={() => clientId && refresh.mutate(clientId)} refreshing={refresh.isPending} isLoading={isLoading} />
        )}
      </SheetContent>
    </Sheet>
  );
}

function WorkflowList({ workflows, q, setQ, filter, setFilter, onRefresh, refreshing, isLoading }: {
  workflows: WorkflowRow[]; q: string; setQ: (s: string) => void;
  filter: Filter; setFilter: (f: Filter) => void;
  onRefresh: () => void; refreshing: boolean; isLoading: boolean;
}) {
  const filters: Array<{ key: Filter; label: string }> = [
    { key: "all", label: "All" }, { key: "published", label: "Published" }, { key: "draft", label: "Draft" },
    { key: "stale", label: "Stale" }, { key: "duplicates", label: "Duplicates" }, { key: "changed", label: "Changed" },
  ];
  return (
    <div className="mt-4 space-y-3">
      <div className="flex gap-2">
        <Input placeholder="Search workflows…" value={q} onChange={(e) => setQ(e.target.value)} />
        <Button variant="outline" size="icon" onClick={onRefresh} disabled={refreshing} aria-label="Refresh">
          {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        </Button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {filters.map((f) => (
          <button key={f.key} onClick={() => setFilter(f.key)}
            className={`px-2.5 py-1 text-xs rounded-full border transition ${filter === f.key ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border hover:bg-muted"}`}>
            {f.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-10 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : workflows.length === 0 ? (
        <div className="text-center py-10 text-sm text-muted-foreground">No workflows found</div>
      ) : (
        <div className="space-y-2">
          {workflows.map((w) => <WorkflowCard key={w.workflow_id} w={w} />)}
        </div>
      )}
    </div>
  );
}

function WorkflowCard({ w }: { w: WorkflowRow }) {
  return (
    <div className="border rounded-lg p-3 space-y-1.5 bg-card">
      <div className="flex items-start justify-between gap-2">
        <div className="font-medium text-sm truncate">{w.name}</div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <Badge variant={w.isDraft ? "outline" : "default"} className="text-[10px] h-5">
            {w.status ?? "unknown"}
          </Badge>
        </div>
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

function EmptyState({ title, body, cta, href, onClick, loading }: {
  title: string; body: string; cta: string; href?: string; onClick?: () => void; loading?: boolean;
}) {
  return (
    <div className="mt-6 border rounded-lg p-6 text-center bg-muted/30">
      <div className="font-display font-semibold mb-1">{title}</div>
      <p className="text-sm text-muted-foreground mb-4">{body}</p>
      {href ? (
        <Button asChild size="sm"><a href={href}>{cta}</a></Button>
      ) : (
        <Button size="sm" onClick={onClick} disabled={loading}>
          {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {cta}
        </Button>
      )}
    </div>
  );
}