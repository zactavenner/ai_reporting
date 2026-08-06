import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Plus, PlugZap, Film } from "lucide-react";
import {
  useH3Creatives,
  useH3Mutations,
  useH3ProviderConnection,
  useH3Runs,
} from "@/hooks/useH3Runs";
import { H3Dashboard } from "./H3Dashboard";
import { H3CreativeCard } from "./H3CreativeCard";
import { H3CreativeDetail } from "./H3CreativeDetail";

/**
 * Operator-grade H3 creative run manager. Lives inside AI Studio — not a
 * separate app. Scales to many clients: one run per client campaign batch.
 */
export function H3RunManager({ clientId }: { clientId?: string | null }) {
  const { data: runs = [], isLoading: runsLoading } = useH3Runs(clientId ?? undefined);
  const [runId, setRunId] = useState<string>("");
  const activeRunId = runId || runs[0]?.id || "";
  const { data: creatives = [], isLoading } = useH3Creatives(activeRunId || null);
  const [selectedId, setSelectedId] = useState<string>("");
  const { createRun, createCreative } = useH3Mutations(activeRunId || null);
  const { data: conn } = useH3ProviderConnection();
  const [newRunName, setNewRunName] = useState("");
  const [newConcept, setNewConcept] = useState("");

  useEffect(() => { setSelectedId(""); }, [activeRunId]);
  const selected = creatives.find((c) => c.id === selectedId) ?? creatives[0] ?? null;
  const activeRun = runs.find((r) => r.id === activeRunId);

  return (
    <div className="space-y-3">
      {/* Run selector + provider connection */}
      <Card className="p-3 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Film className="h-4 w-4 text-primary shrink-0" />
          <span className="text-sm font-semibold">H3 creative runs</span>
        </div>

        <div className="flex items-center gap-2 ml-auto flex-wrap">
          <Select value={activeRunId} onValueChange={setRunId}>
            <SelectTrigger className="h-8 w-[240px] text-xs">
              <SelectValue placeholder={runsLoading ? "Loading…" : "Select a run"} />
            </SelectTrigger>
            <SelectContent>
              {runs.map((r) => (
                <SelectItem key={r.id} value={r.id} className="text-xs">{r.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Badge
            variant="outline"
            className={`text-[10px] ${conn?.connected
              ? "border-emerald-500/50 text-emerald-700 dark:text-emerald-400"
              : "border-amber-500/50 text-amber-700 dark:text-amber-400"}`}
          >
            <PlugZap className="h-3 w-3 mr-1" />
            {conn?.connected ? "Provider connected" : "Connection required to resume polling"}
          </Badge>
        </div>
      </Card>

      {/* New run */}
      {clientId && (
        <Card className="p-3 flex flex-wrap items-center gap-2">
          <Input
            value={newRunName}
            onChange={(e) => setNewRunName(e.target.value)}
            placeholder="New run name (e.g. Fund III — Q1 concepts)"
            className="h-8 text-xs sm:max-w-xs"
          />
          <Button
            size="sm"
            variant="outline"
            disabled={!newRunName.trim() || createRun.isPending}
            onClick={() => createRun.mutate({ client_id: clientId, name: newRunName.trim() }, { onSuccess: () => setNewRunName("") })}
          >
            {createRun.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Plus className="h-3.5 w-3.5 mr-1" />}
            New run
          </Button>
        </Card>
      )}

      {!activeRunId ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          No H3 runs yet{clientId ? " for this client" : ""}. Create a run to start building creatives.
        </Card>
      ) : (
        <>
          <H3Dashboard creatives={creatives} />

          <div className="grid lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)] gap-3 items-start">
            <div className="space-y-2">
              {isLoading ? (
                <Card className="p-6 grid place-items-center"><Loader2 className="h-4 w-4 animate-spin" /></Card>
              ) : creatives.length === 0 ? (
                <Card className="p-6 text-center text-xs text-muted-foreground">
                  No creatives in this run yet.
                </Card>
              ) : (
                creatives.map((c) => (
                  <H3CreativeCard
                    key={c.id}
                    creative={c}
                    selected={selected?.id === c.id}
                    onSelect={() => setSelectedId(c.id)}
                  />
                ))
              )}

              <Card className="p-2.5 flex gap-2">
                <Input
                  value={newConcept}
                  onChange={(e) => setNewConcept(e.target.value)}
                  placeholder="New concept name"
                  className="h-8 text-xs"
                />
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!newConcept.trim() || createCreative.isPending}
                  onClick={() =>
                    createCreative.mutate(
                      {
                        run_id: activeRunId,
                        client_id: activeRun?.client_id ?? clientId ?? null,
                        concept: newConcept.trim(),
                        campaign_ref: activeRun?.campaign_ref ?? null,
                      },
                      { onSuccess: () => setNewConcept("") },
                    )
                  }
                >
                  <Plus className="h-3.5 w-3.5" />
                </Button>
              </Card>
            </div>

            {selected ? (
              <H3CreativeDetail
                creative={selected}
                runId={activeRunId}
                providerConnected={!!conn?.connected}
                connectionReason={conn?.reason ?? ""}
              />
            ) : (
              <Card className="p-8 text-center text-sm text-muted-foreground">
                Select a creative to review its state, QA and audit trail.
              </Card>
            )}
          </div>
        </>
      )}
    </div>
  );
}