import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useTeamMember } from "@/contexts/TeamMemberContext";
import { toast } from "sonner";
import { Loader2, Target } from "lucide-react";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientId: string;
  clientName?: string;
  offerContext?: string;
  onLaunched?: () => void;
};

/**
 * Set a persistent goal from AI Studio. The goal becomes a Jarvis mission that
 * keeps running on the backend (surviving reloads/logout) until the deliverable
 * count is met — e.g. "10 videos, 30s each, 9:16, 2K".
 */
export function StudioGoalDialog({ open, onOpenChange, clientId, clientName, offerContext, onLaunched }: Props) {
  const { currentMember } = useTeamMember();
  const [objective, setObjective] = useState("");
  const [deliverable, setDeliverable] = useState<"video" | "static" | "copy" | "mixed">("video");
  const [count, setCount] = useState("10");
  const [seconds, setSeconds] = useState("30");
  const [aspect, setAspect] = useState<"9:16" | "16:9" | "1:1">("9:16");
  const [quality, setQuality] = useState("Broadcast-quality, native audio, avatar identity consistent across every clip.");
  const [maxSteps, setMaxSteps] = useState("300");
  const [busy, setBusy] = useState(false);

  const buildBrief = () => {
    const n = Math.max(1, Number(count) || 1);
    const secs = Math.max(5, Number(seconds) || 15);
    const clips = Math.ceil(secs / 15);
    const lines: string[] = [];
    lines.push(`GOAL (work until fully complete): ${objective.trim() || `Produce ${n} ${deliverable} deliverables for ${clientName || "this client"}.`}`);
    lines.push("");
    lines.push(`TARGET OUTPUT: ${n} finished ${deliverable === "mixed" ? "deliverables" : deliverable === "video" ? "videos" : deliverable === "static" ? "static ads" : "copy assets"}.`);
    if (deliverable === "video" || deliverable === "mixed") {
      lines.push(`VIDEO SPEC: ${secs}s each at aspect ${aspect}, MiniMax H3 (minimax/hailuo-3) at native 2K. H3 caps at 15s per clip, so each ${secs}s video = ${clips} sequential 15s clip${clips === 1 ? "" : "s"} with identical talent, wardrobe, lighting and pacing. 720p does not exist on H3 — always request resolution "2k".`);
    }
    lines.push(`QUALITY BAR: ${quality.trim() || "Agency-grade, on-brand, compliant."}`);
    lines.push("");
    lines.push("EXECUTION RULES:");
    lines.push("- Delegate: use the client's video specialist for renders, the copywriter for scripts/copy, and consult Jeremy AI before finalising creative decisions.");
    lines.push("- Save every finished deliverable to the client library AND the AI Studio canvas. Nothing counts as delivered until it is saved.");
    lines.push("- Poll async video jobs on later steps; keep going across slices until every deliverable exists.");
    lines.push(`- Report progress as "x of ${n} complete" after each finished deliverable, and finish with a full count + decision log.`);
    lines.push("- Compliance: regulated capital raising. Never say \"guaranteed\"; use \"targeted returns\" and include risk disclaimers on offer-facing copy.");
    if (offerContext) {
      lines.push("");
      lines.push("OFFER CONTEXT:");
      lines.push(offerContext.slice(0, 6000));
    }
    return lines.join("\n");
  };

  const launch = async () => {
    setBusy(true);
    try {
      const goal = buildBrief();
      const { data, error } = await supabase.functions.invoke("jarvis-goal-worker", {
        body: {
          action: "create",
          goal,
          title: (objective.trim() || `${count} ${deliverable} deliverables`).split("\n")[0].slice(0, 120),
          client_id: clientId || null,
          created_by: currentMember?.id || null,
          max_iterations: Number(maxSteps) || 300,
        },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast.success("Goal set — Jarvis works this in the background until it's done.");
      setObjective("");
      onOpenChange(false);
      onLaunched?.();
    } catch (e: any) {
      toast.error(e?.message || "Failed to set goal");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Target className="h-4 w-4 text-primary" /> Set a goal
          </DialogTitle>
          <DialogDescription className="text-xs">
            Jarvis runs this on the backend with the video, copy and Jeremy AI agents until every deliverable exists. Closing this page does not stop it.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground">Objective</Label>
            <Textarea
              rows={3}
              value={objective}
              onChange={(e) => setObjective(e.target.value)}
              placeholder="e.g. Produce 10 vertical video ads for the fund offer — hook-led, avatar on camera, compliant disclaimers."
              className="text-sm resize-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">Deliverable</Label>
              <Select value={deliverable} onValueChange={(v) => setDeliverable(v as any)}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="video">Videos</SelectItem>
                  <SelectItem value="static">Static ads</SelectItem>
                  <SelectItem value="copy">Copy / scripts</SelectItem>
                  <SelectItem value="mixed">Mixed campaign</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">How many</Label>
              <Input value={count} onChange={(e) => setCount(e.target.value.replace(/\D/g, ""))} className="h-8 text-xs" />
            </div>
            {(deliverable === "video" || deliverable === "mixed") && (
              <>
                <div className="space-y-1">
                  <Label className="text-[11px] text-muted-foreground">Seconds each</Label>
                  <Input value={seconds} onChange={(e) => setSeconds(e.target.value.replace(/\D/g, ""))} className="h-8 text-xs" />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px] text-muted-foreground">Aspect</Label>
                  <Select value={aspect} onValueChange={(v) => setAspect(v as any)}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="9:16">9:16 Reel</SelectItem>
                      <SelectItem value="16:9">16:9 Landscape</SelectItem>
                      <SelectItem value="1:1">1:1 Square</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}
          </div>

          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground">Quality bar</Label>
            <Textarea rows={2} value={quality} onChange={(e) => setQuality(e.target.value)} className="text-xs resize-none" />
          </div>

          <div className="space-y-1 w-32">
            <Label className="text-[11px] text-muted-foreground">Max steps</Label>
            <Input value={maxSteps} onChange={(e) => setMaxSteps(e.target.value.replace(/\D/g, ""))} className="h-8 text-xs" />
          </div>

          {(deliverable === "video" || deliverable === "mixed") && (
            <p className="text-[10px] text-muted-foreground">
              MiniMax H3 renders 15s per clip at native 2K, so {Math.max(5, Number(seconds) || 15)}s ={" "}
              {Math.ceil(Math.max(5, Number(seconds) || 15) / 15)} stitched clips per video.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button size="sm" onClick={launch} disabled={busy}>
            {busy ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Target className="h-3.5 w-3.5 mr-1.5" />}
            Set goal & run
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}