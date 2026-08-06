import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Clock, FileVideo, Scale, AlertOctagon } from "lucide-react";
import type { H3Creative } from "@/hooks/useH3Runs";
import { H3_STATE_LABELS, isProviderOwned } from "@/lib/h3Workflow";

function stateTone(s: H3Creative["workflow_state"]) {
  if (s === "meta_ready") return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/40";
  if (s === "approved") return "bg-primary/15 text-primary border-primary/40";
  if (s === "draft") return "bg-muted text-muted-foreground border-border";
  if (s === "claim_review") return "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/40";
  return "bg-sky-500/15 text-sky-700 dark:text-sky-400 border-sky-500/40";
}

export function H3CreativeCard({
  creative,
  selected,
  onSelect,
}: {
  creative: H3Creative;
  selected?: boolean;
  onSelect: () => void;
}) {
  const providerPending = creative.provider_status === "pending" && !creative.provider_error;
  const systemFailure = !!creative.provider_error;
  const hasAsset = !!creative.final_asset_url || !!creative.source_asset_url;

  return (
    <Card
      onClick={onSelect}
      className={`p-3 cursor-pointer transition hover:border-primary/50 ${selected ? "border-primary ring-1 ring-primary/30" : ""}`}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold truncate">{creative.concept}</div>
          <div className="text-[10px] text-muted-foreground truncate">{creative.provider}</div>
        </div>
        <Badge variant="outline" className={`text-[10px] shrink-0 ${stateTone(creative.workflow_state)}`}>
          {H3_STATE_LABELS[creative.workflow_state]}
        </Badge>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground">
        <span>Job: <span className="font-mono text-foreground">{creative.external_job_id ?? "—"}</span></span>
        <span>{creative.aspect_ratio} · {creative.duration_seconds}s</span>
        <span>Source {creative.source_resolution}</span>
        <span>Master {creative.final_resolution}</span>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {systemFailure ? (
          <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border border-destructive/40 bg-destructive/10 text-destructive">
            <AlertOctagon className="h-3 w-3" /> system failure — provider error recorded
          </span>
        ) : providerPending ? (
          <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-400">
            <Clock className="h-3 w-3" /> pending provider output
          </span>
        ) : (
          <span className="text-[10px] px-2 py-0.5 rounded-full border border-border/60 bg-muted/40">
            provider: {creative.provider_status}
          </span>
        )}

        {!hasAsset && (
          <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border border-border/60 bg-muted/30 text-muted-foreground">
            <FileVideo className="h-3 w-3" /> no video asset yet
          </span>
        )}

        {creative.counsel_review_required && (
          <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400">
            <Scale className="h-3 w-3" /> counsel review required
          </span>
        )}

        {isProviderOwned(creative.workflow_state) && (
          <span className="text-[10px] text-muted-foreground">status only — no re-generation</span>
        )}
      </div>
    </Card>
  );
}