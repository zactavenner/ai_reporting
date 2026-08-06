import { Card } from "@/components/ui/card";
import type { H3Creative } from "@/hooks/useH3Runs";
import { H3_REJECTION_CATEGORIES, stateIndex } from "@/lib/h3Workflow";

function fmtHours(ms: number | null) {
  if (ms === null) return "—";
  const h = ms / 3_600_000;
  return h < 1 ? `${Math.max(1, Math.round(ms / 60_000))}m` : `${h.toFixed(1)}h`;
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-border/60 bg-card p-3">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold tabular-nums leading-tight mt-0.5">{value}</div>
      {hint && <div className="text-[10px] text-muted-foreground mt-0.5">{hint}</div>}
    </div>
  );
}

/** Operator metrics. Every figure is derived from persisted rows — never estimated. */
export function H3Dashboard({ creatives }: { creatives: H3Creative[] }) {
  const n = creatives.length;
  const downloadedPlus = creatives.filter((c) => stateIndex(c.workflow_state) >= stateIndex("downloaded"));

  const submittedToDownloaded = downloadedPlus
    .map((c) => {
      const ev = c.submitted_at ? new Date(c.submitted_at).getTime() : null;
      return ev ? new Date(c.updated_at).getTime() - ev : null;
    })
    .filter((v): v is number => v !== null);
  const avgSubToDl = submittedToDownloaded.length
    ? submittedToDownloaded.reduce((a, b) => a + b, 0) / submittedToDownloaded.length
    : null;

  const costed = creatives.filter((c) => typeof c.cost_amount === "number");
  const totalCost = costed.reduce((a, c) => a + (c.cost_amount ?? 0), 0);
  const costPerRender = costed.length ? totalCost / costed.length : null;

  const errored = creatives.filter((c) => !!c.provider_error).length;
  const approved = creatives.filter((c) => stateIndex(c.workflow_state) >= stateIndex("approved"));
  const costPerApproved = approved.length && totalCost > 0 ? totalCost / approved.length : null;

  const qaReached = creatives.filter((c) => stateIndex(c.workflow_state) >= stateIndex("qa"));
  const rejected = creatives.filter((c) => !!c.rejection_category);
  const firstPassQa = qaReached.length
    ? ((qaReached.length - rejected.length) / qaReached.length) * 100
    : null;

  const dlToApproved = approved
    .map((c) => (c.approved_at && c.submitted_at ? new Date(c.approved_at).getTime() - new Date(c.submitted_at).getTime() : null))
    .filter((v): v is number => v !== null);
  const avgDlToApproved = dlToApproved.length ? dlToApproved.reduce((a, b) => a + b, 0) / dlToApproved.length : null;

  const metaReady = creatives.filter((c) => c.workflow_state === "meta_ready").length;
  const conversion = n ? (metaReady / n) * 100 : 0;

  const rejectionCounts = H3_REJECTION_CATEGORIES.map((cat) => ({
    label: cat.label,
    count: creatives.filter((c) => c.rejection_category === cat.value).length,
  })).filter((r) => r.count > 0);

  return (
    <Card className="p-3 space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-2">
        <Stat label="Creatives" value={String(n)} hint={`${metaReady} Meta Ready`} />
        <Stat label="Submitted → Downloaded" value={fmtHours(avgSubToDl)} hint={avgSubToDl === null ? "no completions yet" : "average"} />
        <Stat label="Cost / render" value={costPerRender === null ? "—" : `$${costPerRender.toFixed(2)}`} hint={costed.length ? `${costed.length} costed` : "reported at completion only"} />
        <Stat label="Provider error rate" value={n ? `${((errored / n) * 100).toFixed(0)}%` : "—"} hint={`${errored} with raw error`} />
        <Stat label="First-pass QA" value={firstPassQa === null ? "—" : `${firstPassQa.toFixed(0)}%`} hint={qaReached.length ? `${qaReached.length} reached QA` : "none in QA yet"} />
        <Stat label="Cost / approved creative" value={costPerApproved === null ? "—" : `$${costPerApproved.toFixed(2)}`} hint={approved.length ? `${approved.length} approved` : "none approved"} />
        <Stat label="Downloaded → Approved" value={fmtHours(avgDlToApproved)} hint="average" />
        <Stat label="Draft → Meta Ready" value={`${conversion.toFixed(0)}%`} hint="conversion" />
      </div>

      <div>
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">QA rejection categories</div>
        {rejectionCounts.length === 0 ? (
          <div className="text-[11px] text-muted-foreground italic">No rejections recorded.</div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {rejectionCounts.map((r) => (
              <span key={r.label} className="text-[10px] px-2 py-0.5 rounded-full border border-border/60 bg-muted/40">
                {r.label} · {r.count}
              </span>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}