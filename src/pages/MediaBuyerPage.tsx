import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Loader2, TrendingUp, RefreshCw } from "lucide-react";
import { useClients } from "@/hooks/useClients";
import ReactMarkdown from "react-markdown";
import { formatDistanceToNow } from "date-fns";

type RunType = "account_audit" | "daily_review" | "weekly_review" | "creative_intel" | "fatigue_scan" | "pixel_audit" | "launch_plan";

const RUN_TYPES: Array<{ key: RunType; label: string; blurb: string }> = [
  { key: "fatigue_scan", label: "Fatigue Scan", blurb: "Portfolio: flag creative fatigue" },
  { key: "daily_review", label: "Daily Review", blurb: "Per-client performance review" },
  { key: "weekly_review", label: "Weekly Review", blurb: "Structural rollup + launches" },
  { key: "creative_intel", label: "Creative Intel", blurb: "Cross-client winning patterns" },
  { key: "account_audit", label: "Account Audit", blurb: "Full account audit" },
  { key: "pixel_audit", label: "Pixel Audit", blurb: "Tracking verification" },
  { key: "launch_plan", label: "Launch Plan", blurb: "Concrete launch proposals" },
];

const CLASSIFICATIONS: Array<{ key: string; label: string; tone: string }> = [
  { key: "scale", label: "SCALE", tone: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/40" },
  { key: "keep", label: "KEEP", tone: "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/40" },
  { key: "watch", label: "WATCH", tone: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/40" },
  { key: "iterate", label: "ITERATE", tone: "bg-purple-500/15 text-purple-700 dark:text-purple-400 border-purple-500/40" },
  { key: "pause", label: "PAUSE", tone: "bg-rose-500/15 text-rose-700 dark:text-rose-400 border-rose-500/40" },
  { key: "insufficient_data", label: "INSUFFICIENT DATA", tone: "bg-muted text-muted-foreground border-border" },
];

type RunRow = {
  id: string; created_at: string; client_id: string | null; run_type: RunType;
  status: "running" | "complete" | "failed"; findings_md: string | null;
  structured_findings: Record<string, unknown> | null; proposals_created: number; cost_usd: number | null;
  error_message: string | null;
};

type ClsRow = {
  id: string; run_id: string; client_id: string | null; meta_ad_id: string;
  classification: string; reasoning: string | null; metrics_snapshot: Record<string, number> | null;
};

type IntelRow = {
  id: string; scope: "client" | "portfolio"; client_id: string | null; pattern_type: string;
  pattern_description: string; evidence: Record<string, unknown>; recommendation: string; confidence: number | null; created_at: string;
};

export default function MediaBuyerPage() {
  const { data: clients = [] } = useClients();
  const [clientId, setClientId] = useState<string>("portfolio");
  const [runningType, setRunningType] = useState<RunType | null>(null);
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [classifications, setClassifications] = useState<ClsRow[]>([]);
  const [intel, setIntel] = useState<IntelRow[]>([]);
  const [ads, setAds] = useState<Record<string, { name: string; thumbnail_url: string | null; client_id: string; client_name?: string }>>({});
  const [loading, setLoading] = useState(false);

  const clientOptions = useMemo(() => [{ id: "portfolio", name: "Portfolio (all active clients)" }, ...clients.map((c) => ({ id: c.id, name: c.name }))], [clients]);
  const clientNameById = useMemo(() => new Map(clients.map((c) => [c.id, c.name])), [clients]);
  const filterClient = clientId === "portfolio" ? null : clientId;

  async function loadAll() {
    setLoading(true);
    try {
      const runsQ = supabase.from("media_buyer_runs").select("*").order("created_at", { ascending: false }).limit(30);
      const { data: runsData } = filterClient ? await runsQ.eq("client_id", filterClient) : await runsQ;
      setRuns((runsData ?? []) as RunRow[]);

      const clsQ = supabase.from("ad_classifications").select("*").order("created_at", { ascending: false }).limit(400);
      const { data: clsData } = filterClient ? await clsQ.eq("client_id", filterClient) : await clsQ;
      const cls = (clsData ?? []) as ClsRow[];
      // Only latest run per (client scope)
      const latestRunId = cls[0]?.run_id ?? null;
      const latestCls = latestRunId ? cls.filter((c) => c.run_id === latestRunId) : cls;
      setClassifications(latestCls);

      const intelQ = supabase.from("creative_intel_findings").select("*").order("created_at", { ascending: false }).limit(60);
      const { data: intelData } = filterClient ? await intelQ.eq("client_id", filterClient) : await intelQ;
      setIntel((intelData ?? []) as IntelRow[]);

      const ids = [...new Set(latestCls.map((c) => c.meta_ad_id))];
      if (ids.length) {
        const { data: adsData } = await supabase.from("meta_ads").select("meta_ad_id, name, thumbnail_url, client_id").in("meta_ad_id", ids);
        const map: typeof ads = {};
        (adsData ?? []).forEach((a: any) => { map[a.meta_ad_id] = { name: a.name, thumbnail_url: a.thumbnail_url, client_id: a.client_id, client_name: clientNameById.get(a.client_id) }; });
        setAds(map);
      } else setAds({});
    } finally { setLoading(false); }
  }

  useEffect(() => { loadAll(); /* eslint-disable-next-line */ }, [clientId]);

  async function trigger(runType: RunType) {
    setRunningType(runType);
    toast.loading(`Running ${runType}…`, { id: `run-${runType}` });
    try {
      const body: Record<string, unknown> = { run_type: runType };
      if (filterClient) body.client_id = filterClient;
      const { data, error } = await supabase.functions.invoke("media-buyer-agent", { body });
      if (error) throw new Error(error.message);
      toast.success(`${runType}: ${data?.classifications ?? 0} classifications · ${data?.proposals_queued ?? 0} proposals queued`, { id: `run-${runType}` });
      await loadAll();
    } catch (e) {
      toast.error(`${runType} failed: ${(e as Error).message}`, { id: `run-${runType}` });
    } finally { setRunningType(null); }
  }

  return (
    <div className="container mx-auto p-4 md:p-6 space-y-6 max-w-7xl">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold font-display flex items-center gap-2">
            <TrendingUp className="h-6 w-6 text-emerald-600" /> Media Buyer
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Autonomous audit, fatigue monitoring, creative intelligence. All proposals route to /approvals.</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={clientId} onValueChange={setClientId}>
            <SelectTrigger className="w-[280px]"><SelectValue /></SelectTrigger>
            <SelectContent>{clientOptions.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
          </Select>
          <Button size="icon" variant="outline" onClick={loadAll} disabled={loading} aria-label="Refresh">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Run controls</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2">
            {RUN_TYPES.map((r) => (
              <Button key={r.key} variant="outline" size="sm" className="h-auto py-2 px-2 flex-col items-start text-left"
                onClick={() => trigger(r.key)} disabled={runningType !== null}>
                <div className="flex items-center gap-1.5 text-xs font-semibold w-full">
                  {runningType === r.key ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                  <span>{r.label}</span>
                </div>
                <span className="text-[10px] text-muted-foreground font-normal mt-0.5 leading-tight">{r.blurb}</span>
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="board" className="space-y-4">
        <TabsList>
          <TabsTrigger value="board">Classifications</TabsTrigger>
          <TabsTrigger value="intel">Creative Intel</TabsTrigger>
          <TabsTrigger value="history">Run History</TabsTrigger>
        </TabsList>

        <TabsContent value="board" className="space-y-3">
          {classifications.length === 0 ? (
            <Card><CardContent className="p-6 text-sm text-muted-foreground text-center">No classifications yet. Trigger a run above.</CardContent></Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
              {CLASSIFICATIONS.map((col) => {
                const items = classifications.filter((c) => c.classification === col.key);
                return (
                  <div key={col.key} className="space-y-2">
                    <div className={`px-2 py-1 text-[10px] font-bold rounded border ${col.tone} text-center tracking-wider`}>{col.label} · {items.length}</div>
                    <div className="space-y-2">
                      {items.map((c) => {
                        const ad = ads[c.meta_ad_id];
                        const m = c.metrics_snapshot ?? {};
                        return (
                          <div key={c.id} className="border rounded-lg p-2.5 bg-card space-y-1.5">
                            {ad?.thumbnail_url ? <img src={ad.thumbnail_url} alt="" className="w-full aspect-square object-cover rounded" loading="lazy" /> : null}
                            <div className="text-xs font-medium truncate">{ad?.name ?? c.meta_ad_id}</div>
                            {ad?.client_name ? <div className="text-[10px] text-muted-foreground truncate">{ad.client_name}</div> : null}
                            <div className="text-[10px] text-muted-foreground grid grid-cols-3 gap-1 pt-1 border-t">
                              <span>CPL {fmt(m.cpl)}</span><span>CPS {fmt(m.cps)}</span><span>CPBC {fmt(m.cpbc)}</span>
                              <span>Freq {fmt(m.frequency, 1)}</span><span>CTR {fmt(m.ctr, 2)}%</span><span>${fmt(m.spend, 0)}</span>
                            </div>
                            {c.reasoning ? <div className="text-[10px] text-foreground/80 line-clamp-3 pt-1 border-t">{c.reasoning}</div> : null}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="intel" className="space-y-3">
          {intel.length === 0 ? (
            <Card><CardContent className="p-6 text-sm text-muted-foreground text-center">No creative intel findings yet.</CardContent></Card>
          ) : intel.map((f) => (
            <Card key={f.id}>
              <CardContent className="p-4 space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="outline" className="uppercase text-[10px]">{f.pattern_type}</Badge>
                  <Badge variant="secondary" className="text-[10px]">{f.scope}</Badge>
                  {f.confidence != null && <Badge variant="outline" className="text-[10px]">conf {(f.confidence * 100).toFixed(0)}%</Badge>}
                  <span className="text-[10px] text-muted-foreground ml-auto">{formatDistanceToNow(new Date(f.created_at), { addSuffix: true })}</span>
                </div>
                <div className="font-medium text-sm">{f.pattern_description}</div>
                <div className="text-xs text-muted-foreground"><span className="font-semibold">Recommendation:</span> {f.recommendation}</div>
                {f.evidence && Object.keys(f.evidence).length > 0 && (
                  <details className="text-xs"><summary className="cursor-pointer text-muted-foreground">Evidence</summary>
                    <pre className="mt-1 bg-muted/50 rounded p-2 overflow-x-auto text-[10px]">{JSON.stringify(f.evidence, null, 2)}</pre>
                  </details>
                )}
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="history" className="space-y-2">
          {runs.length === 0 ? (
            <Card><CardContent className="p-6 text-sm text-muted-foreground text-center">No runs yet.</CardContent></Card>
          ) : runs.map((r) => (
            <details key={r.id} className="border rounded-lg bg-card">
              <summary className="cursor-pointer p-3 flex items-center gap-2 flex-wrap">
                <Badge variant={r.status === "complete" ? "default" : r.status === "failed" ? "destructive" : "outline"} className="text-[10px]">{r.status}</Badge>
                <span className="font-medium text-sm">{r.run_type}</span>
                <span className="text-xs text-muted-foreground">{r.client_id ? clientNameById.get(r.client_id) ?? "" : "portfolio"}</span>
                <span className="text-xs text-muted-foreground ml-auto">{formatDistanceToNow(new Date(r.created_at), { addSuffix: true })}</span>
                {r.proposals_created > 0 && <Badge variant="secondary" className="text-[10px]">{r.proposals_created} queued</Badge>}
                {r.cost_usd != null && <span className="text-[10px] text-muted-foreground">${r.cost_usd.toFixed(3)}</span>}
              </summary>
              <div className="px-4 pb-4 space-y-2">
                {r.error_message ? <div className="text-xs text-destructive bg-destructive/5 rounded p-2">{r.error_message}</div> : null}
                {r.findings_md ? (
                  <div className="prose prose-sm dark:prose-invert max-w-none prose-headings:font-display prose-p:text-sm">
                    <ReactMarkdown>{r.findings_md}</ReactMarkdown>
                  </div>
                ) : (<div className="text-xs text-muted-foreground">No markdown findings.</div>)}
                {r.structured_findings ? (
                  <details className="text-xs"><summary className="cursor-pointer text-muted-foreground">Structured metadata</summary>
                    <pre className="mt-1 bg-muted/50 rounded p-2 overflow-x-auto text-[10px]">{JSON.stringify(r.structured_findings, null, 2)}</pre>
                  </details>
                ) : null}
              </div>
            </details>
          ))}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function fmt(v: number | undefined | null, digits = 2) {
  if (v == null || Number.isNaN(v)) return "—";
  const n = Number(v);
  if (n >= 1000) return n.toFixed(0);
  return n.toFixed(digits);
}