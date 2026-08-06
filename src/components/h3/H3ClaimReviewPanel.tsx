import { AlertTriangle, ShieldAlert, ShieldCheck, Scale } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  AMT_PROPOSED_TERMS,
  H3_ACCREDITED_CALLOUT,
  H3_COUNSEL_NOTICE,
  scanFundClaims,
  hasBlockingClaims,
} from "@/lib/h3Workflow";

/**
 * Always-visible fund claim guardrails. Purely advisory to the operator plus a
 * deterministic blocking scan — never a compliance approval.
 */
export function H3ClaimReviewPanel({ text }: { text: string }) {
  const issues = scanFundClaims(text);
  const blocked = hasBlockingClaims(issues);

  return (
    <div className="rounded-xl border border-border/60 bg-muted/30 p-3 space-y-3">
      <div className="flex items-center gap-2">
        <Scale className="h-4 w-4 text-amber-600" />
        <span className="text-xs font-semibold">Claim review guardrails</span>
        <Badge variant="outline" className="ml-auto text-[10px] border-amber-500/60 text-amber-700 dark:text-amber-400">
          Counsel review required
        </Badge>
      </div>

      <div className="text-[11px] text-muted-foreground space-y-1">
        <p>
          Required market callout when investment terms appear:{" "}
          <span className="font-mono text-foreground">{H3_ACCREDITED_CALLOUT}</span>
        </p>
        <p className="font-medium text-foreground">Proposed terms — counsel-pending only</p>
        <ul className="list-disc pl-4">
          {AMT_PROPOSED_TERMS.map((t) => <li key={t}>{t}</li>)}
        </ul>
        <p>Washington, DC is thesis context only — no market ranking or performance comparison.</p>
        <p className="text-amber-700 dark:text-amber-400">{H3_COUNSEL_NOTICE}</p>
      </div>

      {!text.trim() ? (
        <div className="text-[11px] text-muted-foreground italic">
          No script or copy yet — nothing to scan.
        </div>
      ) : issues.length === 0 ? (
        <div className="flex items-center gap-1.5 text-[11px] text-emerald-700 dark:text-emerald-400">
          <ShieldCheck className="h-3.5 w-3.5" /> No blocked wording detected. Counsel signoff still required.
        </div>
      ) : (
        <ul className="space-y-1">
          {issues.map((i, idx) => (
            <li
              key={idx}
              className={`flex items-start gap-1.5 text-[11px] ${
                i.severity === "blocking" ? "text-destructive" : "text-amber-700 dark:text-amber-400"
              }`}
            >
              {i.severity === "blocking" ? (
                <ShieldAlert className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              ) : (
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              )}
              <span>{i.message}</span>
            </li>
          ))}
        </ul>
      )}

      {blocked && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-2.5 py-2 text-[11px] text-destructive">
          Blocked wording present — onward transition from Claim Review is disabled until copy is corrected.
        </div>
      )}
    </div>
  );
}