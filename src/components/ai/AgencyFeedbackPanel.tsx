import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Check, X, Clock, Loader2, MessageSquare } from "lucide-react";
import { toast } from "sonner";

type Status = "pending" | "approved" | "rejected" | "revise";

interface CanvasItem {
  id: string;
  conversation_id: string;
  kind: string;
  payload: any;
  created_at: string;
  feedback_status: Status;
  feedback_notes: string | null;
  reviewed_at: string | null;
}

/**
 * Per-client review panel for agent outputs (canvas items produced by
 * AI Studio runs). Lets the agency triage each artifact with status +
 * notes so reviewers can resolve agent output without re-running the
 * generation.
 */
export function AgencyFeedbackPanel({ clientId }: { clientId: string }) {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<"all" | Status>("pending");
  const [draftNotes, setDraftNotes] = useState<Record<string, string>>({});

  const { data: items = [], isLoading } = useQuery({
    queryKey: ["agency-feedback-canvas", clientId],
    enabled: !!clientId,
    queryFn: async () => {
      // Pull conversations for this client, then their canvas items.
      const { data: convos } = await supabase
        .from("ai_studio_conversations")
        .select("id")
        .eq("client_id", clientId);
      const ids = (convos || []).map((c: any) => c.id);
      if (!ids.length) return [] as CanvasItem[];
      const { data, error } = await supabase
        .from("ai_studio_canvas_items")
        .select("id, conversation_id, kind, payload, created_at, feedback_status, feedback_notes, reviewed_at")
        .in("conversation_id", ids)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data || []) as unknown as CanvasItem[];
    },
  });

  const visible = useMemo(
    () => (statusFilter === "all" ? items : items.filter((i) => i.feedback_status === statusFilter)),
    [items, statusFilter]
  );

  const counts = useMemo(() => {
    const c = { pending: 0, approved: 0, rejected: 0, revise: 0 } as Record<Status, number>;
    items.forEach((i) => { c[i.feedback_status] = (c[i.feedback_status] || 0) + 1; });
    return c;
  }, [items]);

  const update = useMutation({
    mutationFn: async ({ id, status, notes }: { id: string; status: Status; notes?: string | null }) => {
      const { data: sess } = await supabase.auth.getUser();
      const { error } = await supabase
        .from("ai_studio_canvas_items")
        .update({
          feedback_status: status,
          feedback_notes: notes ?? null,
          reviewed_at: new Date().toISOString(),
          reviewed_by: sess.user?.id || null,
        } as any)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Feedback saved");
      qc.invalidateQueries({ queryKey: ["agency-feedback-canvas", clientId] });
    },
    onError: (e: any) => toast.error(e?.message || "Failed to save"),
  });

  const previewUrl = (p: any) =>
    p?.image_url || p?.url || p?.payload?.image_url || p?.thumbnail || null;

  const headline = (it: CanvasItem) =>
    it.payload?.title || it.payload?.headline || it.payload?.prompt || it.kind;

  return (
    <div className="flex flex-col gap-3 h-full">
      <Card className="p-3 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium">Agent Output Review</span>
        </div>
        <div className="flex items-center gap-1.5 text-xs">
          <Badge variant="secondary" className="gap-1"><Clock className="h-3 w-3" /> {counts.pending} pending</Badge>
          <Badge className="gap-1 bg-emerald-600/15 text-emerald-700 dark:text-emerald-300 border border-emerald-600/20"><Check className="h-3 w-3" /> {counts.approved} approved</Badge>
          <Badge variant="destructive" className="gap-1"><X className="h-3 w-3" /> {counts.rejected} rejected</Badge>
          {counts.revise > 0 && <Badge variant="outline">{counts.revise} revise</Badge>}
        </div>
        <div className="ml-auto">
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as any)}>
            <SelectTrigger className="h-8 w-[160px] rounded-lg text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="approved">Approved</SelectItem>
              <SelectItem value="rejected">Rejected</SelectItem>
              <SelectItem value="revise">Needs revision</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </Card>

      <div className="flex-1 min-h-0 overflow-auto pr-1">
        {isLoading ? (
          <div className="text-sm text-muted-foreground flex items-center gap-2 p-6">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading agent outputs…
          </div>
        ) : visible.length === 0 ? (
          <Card className="p-8 text-center text-sm text-muted-foreground">
            Nothing to review. Run the AI Studio for this client and outputs will land here.
          </Card>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {visible.map((it) => {
              const img = previewUrl(it.payload);
              const notes = draftNotes[it.id] ?? it.feedback_notes ?? "";
              return (
                <Card key={it.id} className="p-3 flex flex-col gap-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-xs uppercase tracking-wide text-muted-foreground">{it.kind}</div>
                      <div className="text-sm font-medium truncate">{headline(it)}</div>
                      <div className="text-[10px] text-muted-foreground">{new Date(it.created_at).toLocaleString()}</div>
                    </div>
                    <Badge
                      variant="outline"
                      className={
                        it.feedback_status === "approved" ? "border-emerald-500 text-emerald-600" :
                        it.feedback_status === "rejected" ? "border-destructive text-destructive" :
                        it.feedback_status === "revise" ? "border-amber-500 text-amber-600" :
                        "border-border"
                      }
                    >
                      {it.feedback_status}
                    </Badge>
                  </div>
                  {img && (
                    <div className="rounded-lg overflow-hidden border bg-muted/30">
                      <img src={img} alt={headline(it)} className="w-full max-h-56 object-contain" loading="lazy" />
                    </div>
                  )}
                  <Textarea
                    value={notes}
                    onChange={(e) => setDraftNotes((d) => ({ ...d, [it.id]: e.target.value }))}
                    placeholder="Reviewer notes (what worked / what to change)…"
                    className="text-xs min-h-[60px]"
                  />
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <Button size="sm" variant="default" className="h-7 text-xs gap-1"
                      onClick={() => update.mutate({ id: it.id, status: "approved", notes })}>
                      <Check className="h-3 w-3" /> Approve
                    </Button>
                    <Button size="sm" variant="outline" className="h-7 text-xs gap-1 border-amber-500 text-amber-600"
                      onClick={() => update.mutate({ id: it.id, status: "revise", notes })}>
                      Revise
                    </Button>
                    <Button size="sm" variant="destructive" className="h-7 text-xs gap-1"
                      onClick={() => update.mutate({ id: it.id, status: "rejected", notes })}>
                      <X className="h-3 w-3" /> Reject
                    </Button>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}