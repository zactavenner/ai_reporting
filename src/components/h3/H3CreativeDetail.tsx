import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowRight, Ban, History, Loader2, RefreshCw, ShieldAlert } from "lucide-react";
import type { H3Creative } from "@/hooks/useH3Runs";
import { useH3Events, useH3Mutations, useH3Poll, useH3ScriptRevisions } from "@/hooks/useH3Runs";
import {
  H3_QA_CHECKS,
  H3_REJECTION_CATEGORIES,
  H3_STATE_HINTS,
  H3_STATE_LABELS,
  hasBlockingClaims,
  isProviderOwned,
  nextState,
  qaComplete,
  scanFundClaims,
  type H3QaKey,
  type H3RejectionCategory,
} from "@/lib/h3Workflow";
import { H3ClaimReviewPanel } from "./H3ClaimReviewPanel";

export function H3CreativeDetail({
  creative,
  runId,
  providerConnected,
  connectionReason,
}: {
  creative: H3Creative;
  runId: string;
  providerConnected: boolean;
  connectionReason: string;
}) {
  const { patch, advance, reject, saveScriptRevision } = useH3Mutations(runId);
  const poll = useH3Poll(runId);
  const { data: events = [] } = useH3Events(creative.id);
  const { data: revisions = [] } = useH3ScriptRevisions(creative.id);

  const [prompt, setPrompt] = useState(creative.prompt ?? "");
  const [firstFrame, setFirstFrame] = useState(creative.first_frame_asset_url ?? "");
  const [script, setScript] = useState(creative.approved_script ?? "");
  const [counselPending, setCounselPending] = useState(!!creative.counsel_review_required);
  const [rejectCat, setRejectCat] = useState<H3RejectionCategory>("other");
  const [rejectReason, setRejectReason] = useState("");
  const [metaAdId, setMetaAdId] = useState(creative.meta_ad_id ?? "");

  const qa = (creative.automated_qa ?? {}) as Partial<Record<H3QaKey, boolean>>;
  const claimIssues = useMemo(() => scanFundClaims([script, prompt].filter(Boolean).join("\n")), [script, prompt]);
  const claimBlocked = hasBlockingClaims(claimIssues);
  const to = nextState(creative.workflow_state);

  const setQa = (key: H3QaKey, value: boolean) =>
    patch.mutate({ id: creative.id, values: { automated_qa: { ...qa, [key]: value } } as any, event: "qa_check" });

  /** Gate for the single forward step allowed from the current state. */
  const forwardBlock: string | null = (() => {
    if (!to) return "Already at Meta Ready — manual handoff only.";
    if (isProviderOwned(creative.workflow_state)) return "Provider-owned state. Advance happens from provider polling only.";
    if (creative.workflow_state === "draft") {
      if (!script.trim()) return "An approved script is required before Claim Review.";
      if (!firstFrame.trim()) return "A first-frame asset reference is required before Claim Review.";
    }
    if (creative.workflow_state === "claim_review") {
      if (claimBlocked) return "Blocked claim wording must be corrected.";
      if (!counselPending) return "The counsel-pending tag must be set.";
      if (!creative.approved_script) return "Approve a script revision first.";
    }
    if (creative.workflow_state === "downloaded") {
      if (!creative.final_asset_url) return "Final 720×1280 transcode must exist before QA.";
      if (creative.final_resolution !== "720x1280") return "Final resolution must be 720×1280.";
    }
    if (creative.workflow_state === "qa" && !qaComplete(qa)) return "All QA checks must pass.";
    if (creative.workflow_state === "ready_for_review") return null;
    if (creative.workflow_state === "approved") {
      if (!creative.final_asset_url) return "Packaging requires a final master asset.";
      if (!creative.captions_embedded || !creative.disclosures_embedded)
        return "Packaging requires captions and disclosures embedded.";
    }
    return null;
  })();

  return (
    <div className="space-y-3">
      {/* Header */}
      <Card className="p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-0">
            <div className="text-sm font-semibold truncate">{creative.concept}</div>
            <div className="text-[11px] text-muted-foreground">
              {creative.provider} · {creative.model}
            </div>
          </div>
          <Badge variant="outline" className="ml-auto text-[10px]">
            {H3_STATE_LABELS[creative.workflow_state]}
          </Badge>
        </div>
        <p className="text-[11px] text-muted-foreground mt-1.5">{H3_STATE_HINTS[creative.workflow_state]}</p>

        <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          <span>OpenRouter job ID: <span className="font-mono text-foreground">{creative.external_job_id ?? "—"}</span></span>
          <span>Internal generation ID: <span className="font-mono text-foreground">{creative.internal_generation_id.slice(0, 8)}</span></span>
          <span className="break-all">Polling URL: <span className="font-mono text-foreground">{creative.polling_ref ?? "—"}</span></span>
          <span>OpenRouter generation ID: <span className="font-mono text-foreground">{creative.provider_generation_id ?? "—"}</span></span>
          <span>OpenRouter state: <span className="text-foreground">{creative.provider_status}</span></span>
          <span>Cost: <span className="text-foreground">{creative.cost_amount !== null ? `${creative.cost_amount} ${creative.cost_currency ?? ""}` : "not reported yet"}</span></span>
          <span>Meta ad ID: <span className="font-mono text-foreground">{creative.meta_ad_id ?? "null"}</span></span>
        </div>

        {creative.provider_error && (
          <div className="mt-2 rounded-lg border border-destructive/40 bg-destructive/10 px-2.5 py-2 text-[11px] text-destructive font-mono break-all">
            {creative.provider_error}
          </div>
        )}
      </Card>

      {/* Provider-owned controls */}
      {isProviderOwned(creative.workflow_state) && (
        <Card className="p-3 space-y-2">
          <div className="text-xs font-semibold">OpenRouter status</div>
          {!providerConnected ? (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-2 text-[11px] text-amber-700 dark:text-amber-400">
              Connection required to resume polling. {connectionReason}
            </div>
          ) : (
            <p className="text-[11px] text-muted-foreground">
              Read-only GET against the existing OpenRouter job ID. A pending job is never
              re-submitted, and Downloaded is only set once a source asset is verified present.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={!providerConnected || poll.isPending}
              onClick={() => poll.mutate([creative.id])}
            >
              {poll.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 mr-1" />}
              Resume polling
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive"
              onClick={() =>
                patch.mutate({
                  id: creative.id,
                  values: { provider_status: "cancel_requested" },
                  event: "cancel_requested",
                })
              }
            >
              <Ban className="h-3.5 w-3.5 mr-1" /> Cancel request
            </Button>
          </div>
        </Card>
      )}

      {/* Draft build */}
      {creative.workflow_state === "draft" && (
        <Card className="p-3 space-y-2">
          <div className="text-xs font-semibold">Draft spec</div>
          <div className="space-y-1">
            <Label className="text-[11px]">First-frame asset reference (immutable once submitted)</Label>
            <Input value={firstFrame} onChange={(e) => setFirstFrame(e.target.value)} placeholder="https://…" className="h-8 text-xs" />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px]">Prompt</Label>
            <Textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={3} className="text-xs" />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px]">Script</Label>
            <Textarea value={script} onChange={(e) => setScript(e.target.value)} rows={5} className="text-xs" />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() =>
              patch.mutate({ id: creative.id, values: { prompt, first_frame_asset_url: firstFrame || null }, event: "spec_updated" })
            }>Save spec</Button>
            <Button size="sm" variant="outline" disabled={!script.trim()} onClick={() => saveScriptRevision.mutate({ creative, script, approve: false })}>
              Save revision
            </Button>
            <Button size="sm" disabled={!script.trim() || claimBlocked} onClick={() => saveScriptRevision.mutate({ creative, script, approve: true })}>
              Approve script
            </Button>
          </div>
          {revisions.length > 0 && (
            <p className="text-[10px] text-muted-foreground">
              {revisions.length} revision(s) · approved v{creative.approved_script_version ?? "—"}
            </p>
          )}
        </Card>
      )}

      {/* Claim review */}
      {(creative.workflow_state === "draft" || creative.workflow_state === "claim_review") && (
        <Card className="p-3 space-y-2">
          <H3ClaimReviewPanel text={[script, prompt].filter(Boolean).join("\n")} />
          {creative.workflow_state === "claim_review" && (
            <label className="flex items-center gap-2 text-[11px]">
              <Checkbox
                checked={counselPending}
                onCheckedChange={(v) => {
                  const val = !!v;
                  setCounselPending(val);
                  patch.mutate({ id: creative.id, values: { counsel_review_required: val }, event: "counsel_tag" });
                }}
              />
              Counsel-pending tag applied (required before submission)
            </label>
          )}
        </Card>
      )}

      {/* Downloaded → transcode */}
      {creative.workflow_state === "downloaded" && (
        <Card className="p-3 space-y-2">
          <div className="text-xs font-semibold">Final master transcode</div>
          <p className="text-[11px] text-muted-foreground">
            The 720×1280 MP4 master must exist before QA. Record its reference here.
          </p>
          <Input
            defaultValue={creative.final_asset_url ?? ""}
            placeholder="Final 720×1280 MP4 URL"
            className="h-8 text-xs"
            onBlur={(e) =>
              patch.mutate({
                id: creative.id,
                values: { final_asset_url: e.target.value || null, final_resolution: "720x1280" },
                event: "transcode_recorded",
              })
            }
          />
        </Card>
      )}

      {/* QA */}
      {creative.workflow_state === "qa" && (
        <Card className="p-3 space-y-2">
          <div className="text-xs font-semibold">QA checklist</div>
          <div className="grid sm:grid-cols-2 gap-1.5">
            {H3_QA_CHECKS.map((c) => (
              <label key={c.key} className="flex items-center gap-2 text-[11px]">
                <Checkbox checked={qa[c.key] === true} onCheckedChange={(v) => setQa(c.key, !!v)} />
                {c.label}
              </label>
            ))}
          </div>
          <Separator />
          <div className="space-y-1">
            <Label className="text-[11px]">Generated transcript</Label>
            <Textarea
              defaultValue={creative.transcript ?? ""}
              rows={4}
              className="text-xs"
              placeholder="Paste the transcript decoded from the final master"
              onBlur={(e) => patch.mutate({ id: creative.id, values: { transcript: e.target.value || null }, event: "transcript_recorded" })}
            />
          </div>
          <div className="flex flex-wrap gap-3">
            <label className="flex items-center gap-2 text-[11px]">
              <Checkbox
                checked={creative.captions_embedded}
                onCheckedChange={(v) => patch.mutate({ id: creative.id, values: { captions_embedded: !!v }, event: "captions_flag" })}
              />
              Captions embedded
            </label>
            <label className="flex items-center gap-2 text-[11px]">
              <Checkbox
                checked={creative.disclosures_embedded}
                onCheckedChange={(v) => patch.mutate({ id: creative.id, values: { disclosures_embedded: !!v }, event: "disclosures_flag" })}
              />
              Disclosures embedded
            </label>
          </div>
        </Card>
      )}

      {/* Meta Ready packaging */}
      {creative.workflow_state === "meta_ready" && (
        <Card className="p-3 space-y-2">
          <div className="text-xs font-semibold">Manual handoff</div>
          <p className="text-[11px] text-muted-foreground">
            Packaging only. Reporting 5.0 never creates, launches or publishes a Meta ad. Enter an ad ID
            manually if and when one is connected downstream.
          </p>
          <div className="flex gap-2">
            <Input value={metaAdId} onChange={(e) => setMetaAdId(e.target.value)} placeholder="Meta ad ID (optional)" className="h-8 text-xs" />
            <Button size="sm" variant="outline" onClick={() => patch.mutate({ id: creative.id, values: { meta_ad_id: metaAdId || null }, event: "meta_ad_id_linked" })}>
              Save
            </Button>
          </div>
        </Card>
      )}

      {/* Transition controls */}
      <Card className="p-3 space-y-2">
        <div className="text-xs font-semibold">Transition</div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            disabled={!!forwardBlock || advance.isPending}
            onClick={() => advance.mutate({ creative })}
          >
            {advance.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <ArrowRight className="h-3.5 w-3.5 mr-1" />}
            {to ? `Advance to ${H3_STATE_LABELS[to]}` : "No further state"}
          </Button>
          {forwardBlock && (
            <span className="inline-flex items-center gap-1 text-[11px] text-amber-700 dark:text-amber-400">
              <ShieldAlert className="h-3.5 w-3.5" /> {forwardBlock}
            </span>
          )}
        </div>

        {creative.workflow_state !== "draft" && (
          <div className="rounded-xl border border-border/60 p-2.5 space-y-2">
            <div className="text-[11px] font-medium">Reject → Draft (categorized reason required)</div>
            <div className="flex flex-col sm:flex-row gap-2">
              <Select value={rejectCat} onValueChange={(v) => setRejectCat(v as H3RejectionCategory)}>
                <SelectTrigger className="h-8 text-xs sm:w-56"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {H3_REJECTION_CATEGORIES.map((c) => (
                    <SelectItem key={c.value} value={c.value} className="text-xs">{c.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="Reason" className="h-8 text-xs" />
              <Button
                size="sm"
                variant="destructive"
                disabled={!rejectReason.trim() || reject.isPending}
                onClick={() => reject.mutate({ creative, category: rejectCat, reason: rejectReason })}
              >
                Reject
              </Button>
            </div>
          </div>
        )}
      </Card>

      {/* Audit trail */}
      <Card className="p-3">
        <div className="text-xs font-semibold flex items-center gap-1.5 mb-2">
          <History className="h-3.5 w-3.5" /> Audit trail
        </div>
        {events.length === 0 ? (
          <p className="text-[11px] text-muted-foreground italic">No events recorded yet.</p>
        ) : (
          <ul className="space-y-1 max-h-64 overflow-auto">
            {events.map((e) => (
              <li key={e.id} className="text-[11px] flex flex-wrap gap-x-2 border-b border-border/40 pb-1">
                <span className="text-muted-foreground tabular-nums">{new Date(e.created_at).toLocaleString()}</span>
                <span className="font-medium">{e.event_type}</span>
                {e.from_state && e.to_state && (
                  <span className="text-muted-foreground">
                    {H3_STATE_LABELS[e.from_state]} → {H3_STATE_LABELS[e.to_state]}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}