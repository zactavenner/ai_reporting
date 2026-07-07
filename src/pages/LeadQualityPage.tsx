import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, UserCheck, AlertTriangle, CheckCircle2, Activity } from "lucide-react";
import { useClients } from "@/hooks/useClients";
import { formatDistanceToNow } from "date-fns";

const DISPO_TONE: Record<string, string> = {
  qualified: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/40",
  booked: "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/40",
  showed: "bg-indigo-500/15 text-indigo-700 dark:text-indigo-400 border-indigo-500/40",
  funded: "bg-primary/15 text-primary border-primary/40",
  opportunity: "bg-violet-500/15 text-violet-700 dark:text-violet-400 border-violet-500/40",
  contacted: "bg-sky-500/15 text-sky-700 dark:text-sky-400 border-sky-500/40",
  nurture: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/40",
  new: "bg-muted text-muted-foreground border-border",
  unqualified: "bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-500/40",
  not_accredited: "bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-500/40",
  not_interested: "bg-muted text-muted-foreground border-border",
  no_show: "bg-rose-500/15 text-rose-700 dark:text-rose-400 border-rose-500/40",
  bad_lead: "bg-rose-500/15 text-rose-700 dark:text-rose-400 border-rose-500/40",
  bad_contact_info: "bg-rose-500/15 text-rose-700 dark:text-rose-400 border-rose-500/40",
};

const pct = (n: number | null | undefined) => (n == null ? "—" : `${Number(n).toFixed(1)}%`);
const money = (n: number | null | undefined) => (n == null ? "—" : `$${Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 })}`);

export default function LeadQualityPage() {
  const { data: clients = [] } = useClients();
  const [clientId, setClientId] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<{ leads: number; qualified: number; bad: number; booked: number; spend: number; calls: number; showed: number } | null>(null);
  const [ads, setAds] = useState<any[]>([]);
  const [dispoFeed, setDispoFeed] = useState<any[]>([]);
  const [capiStats, setCapiStats] = useState<{ byEvent: Record<string, number>; failures: number } | null>(null);

  useEffect(() => {
    if (!clientId && clients.length) setClientId(clients[0].id);
  }, [clients, clientId]);

  useEffect(() => {
    if (!clientId) return;
    (async () => {
      setLoading(true);
      try {
        const sevenDaysAgo = new Date(Date.now() - 7 * 86400_000).toISOString();
        const sevenDaysAgoDate = sevenDaysAgo.slice(0, 10);
        const dayAgo = new Date(Date.now() - 86400_000).toISOString();

        const [dailyRes, dispoRes, adsRes, feedRes, capiRes] = await Promise.all([
          supabase.from("daily_metrics").select("ad_spend, leads, calls, showed_calls").eq("client_id", clientId).gte("date", sevenDaysAgoDate),
          supabase.from("lead_dispositions").select("disposition").eq("client_id", clientId).gte("disposed_at", sevenDaysAgo),
          supabase.from("ad_lead_quality").select("meta_ad_id, leads, qualified, qualified_rate, bad_rate, booked_rate, funded, date").eq("client_id", clientId).eq("window_size", "7d").order("date", { ascending: false }).limit(200),
          supabase.from("lead_dispositions").select("id, disposition, disposition_reason, disposed_by, disposed_at, lead_id, leads(name)").eq("client_id", clientId).order("disposed_at", { ascending: false }).limit(50),
          supabase.from("capi_events_sent").select("event_name, success").eq("client_id", clientId).gte("sent_at", dayAgo),
        ]);

        const dm = dailyRes.data ?? [];
        const dispos = dispoRes.data ?? [];
        const total = dispos.length;
        const qualifiedSet = new Set(["qualified", "booked", "showed", "opportunity", "funded"]);
        const badSet = new Set(["bad_lead", "bad_contact_info", "unqualified", "not_accredited"]);
        const bookedSet = new Set(["booked", "showed", "opportunity", "funded"]);
        setSummary({
          leads: dm.reduce((s: number, r: any) => s + Number(r.leads ?? 0), 0),
          qualified: dispos.filter((d: any) => qualifiedSet.has(d.disposition)).length,
          bad: dispos.filter((d: any) => badSet.has(d.disposition)).length,
          booked: dispos.filter((d: any) => bookedSet.has(d.disposition)).length,
          spend: dm.reduce((s: number, r: any) => s + Number(r.ad_spend ?? 0), 0),
          calls: dm.reduce((s: number, r: any) => s + Number(r.calls ?? 0), 0),
          showed: dm.reduce((s: number, r: any) => s + Number(r.showed_calls ?? 0), 0),
        });

        // dedupe ads by meta_ad_id keeping latest
        const seen = new Set<string>();
        const dedupAds: any[] = [];
        for (const a of adsRes.data ?? []) {
          if (seen.has(a.meta_ad_id)) continue;
          seen.add(a.meta_ad_id);
          dedupAds.push(a);
        }
        // enrich with spend + name from meta_ad_daily_insights + meta_ads
        if (dedupAds.length) {
          const adIds = dedupAds.map((a) => a.meta_ad_id);
          const [insightsRes, adMetaRes] = await Promise.all([
            supabase.from("meta_ad_daily_insights").select("meta_ad_id, spend, cost_per_lead").in("meta_ad_id", adIds).gte("date", sevenDaysAgoDate),
            supabase.from("meta_ads").select("meta_ad_id, name, thumbnail_url").in("meta_ad_id", adIds),
          ]);
          const spendMap = new Map<string, { spend: number; cpl: number; days: number }>();
          for (const r of insightsRes.data ?? []) {
            const cur = spendMap.get(r.meta_ad_id) ?? { spend: 0, cpl: 0, days: 0 };
            cur.spend += Number(r.spend ?? 0);
            cur.cpl += Number(r.cost_per_lead ?? 0);
            cur.days += 1;
            spendMap.set(r.meta_ad_id, cur);
          }
          const nameMap = new Map((adMetaRes.data ?? []).map((a: any) => [a.meta_ad_id, a]));
          for (const a of dedupAds) {
            const s = spendMap.get(a.meta_ad_id);
            a.spend_7d = s?.spend ?? 0;
            a.cpl_7d = s && s.days ? s.cpl / s.days : 0;
            const m = nameMap.get(a.meta_ad_id);
            a.name = (m as any)?.name ?? a.meta_ad_id;
            a.thumbnail_url = (m as any)?.thumbnail_url ?? null;
          }
          dedupAds.sort((a, b) => Number(b.qualified_rate ?? 0) - Number(a.qualified_rate ?? 0));
        }
        setAds(dedupAds);
        setDispoFeed(feedRes.data ?? []);

        const byEvent: Record<string, number> = {};
        let failures = 0;
        for (const c of capiRes.data ?? []) {
          if (c.success) byEvent[c.event_name] = (byEvent[c.event_name] ?? 0) + 1;
          else failures++;
        }
        setCapiStats({ byEvent, failures });
      } finally {
        setLoading(false);
      }
    })();
  }, [clientId]);

  const cpl = summary && summary.leads > 0 ? summary.spend / summary.leads : 0;
  const cps = summary && summary.showed > 0 ? summary.spend / summary.showed : 0;
  const cpbc = summary && summary.booked > 0 ? summary.spend / summary.booked : 0;
  const qRate = summary && summary.leads > 0 ? (summary.qualified / summary.leads) * 100 : 0;
  const bRate = summary && summary.leads > 0 ? (summary.bad / summary.leads) * 100 : 0;
  const bookRate = summary && summary.leads > 0 ? (summary.booked / summary.leads) * 100 : 0;

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-[1600px] mx-auto">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2"><UserCheck className="w-6 h-6 text-primary" /> Lead Quality</h1>
          <p className="text-sm text-muted-foreground">Ad-level lead disposition intelligence · trailing 7 days</p>
        </div>
        <Select value={clientId} onValueChange={setClientId}>
          <SelectTrigger className="w-full md:w-[280px]"><SelectValue placeholder="Select client" /></SelectTrigger>
          <SelectContent>{clients.map((c: any) => (<SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>))}</SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      ) : (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
            <Card><CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground uppercase tracking-wide">Leads (7d)</CardTitle></CardHeader><CardContent className="pt-0 text-2xl font-semibold">{summary?.leads ?? 0}</CardContent></Card>
            <Card><CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground uppercase tracking-wide">Qualified Rate</CardTitle></CardHeader><CardContent className="pt-0 text-2xl font-semibold text-emerald-600">{pct(qRate)}</CardContent></Card>
            <Card><CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground uppercase tracking-wide">Bad Rate</CardTitle></CardHeader><CardContent className={`pt-0 text-2xl font-semibold ${bRate >= 25 ? "text-rose-600" : ""}`}>{pct(bRate)}</CardContent></Card>
            <Card><CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground uppercase tracking-wide">Booked Rate</CardTitle></CardHeader><CardContent className="pt-0 text-2xl font-semibold">{pct(bookRate)}</CardContent></Card>
            <Card><CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground uppercase tracking-wide">CPL</CardTitle></CardHeader><CardContent className="pt-0 text-2xl font-semibold">{money(cpl)}</CardContent></Card>
            <Card><CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground uppercase tracking-wide">Cost / Show</CardTitle></CardHeader><CardContent className="pt-0 text-2xl font-semibold">{money(cps)}</CardContent></Card>
            <Card><CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground uppercase tracking-wide">Cost / Booked</CardTitle></CardHeader><CardContent className="pt-0 text-2xl font-semibold">{money(cpbc)}</CardContent></Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Ads table */}
            <Card className="lg:col-span-2">
              <CardHeader><CardTitle className="text-base">Ads ranked by qualified rate (7d)</CardTitle></CardHeader>
              <CardContent className="p-0 overflow-x-auto">
                {ads.length === 0 ? (
                  <div className="p-6 text-sm text-muted-foreground">No rollup data yet — run <code className="bg-muted px-1 rounded">lead-quality-rollup</code>.</div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Ad</TableHead>
                        <TableHead className="text-right">Leads</TableHead>
                        <TableHead className="text-right">Qual. Rate</TableHead>
                        <TableHead className="text-right">Bad Rate</TableHead>
                        <TableHead className="text-right">CPL</TableHead>
                        <TableHead className="text-right">Spend</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {ads.slice(0, 30).map((a) => (
                        <TableRow key={a.meta_ad_id}>
                          <TableCell className="max-w-[280px]">
                            <div className="flex items-center gap-2">
                              {a.thumbnail_url ? <img src={a.thumbnail_url} alt="" className="w-10 h-10 rounded object-cover flex-shrink-0" /> : <div className="w-10 h-10 rounded bg-muted flex-shrink-0" />}
                              <div className="truncate text-sm">{a.name}</div>
                            </div>
                          </TableCell>
                          <TableCell className="text-right">{a.leads}</TableCell>
                          <TableCell className="text-right text-emerald-600 font-medium">{pct(a.qualified_rate)}</TableCell>
                          <TableCell className={`text-right font-medium ${Number(a.bad_rate ?? 0) >= 25 ? "text-rose-600" : ""}`}>{pct(a.bad_rate)}</TableCell>
                          <TableCell className="text-right">{money(a.cpl_7d)}</TableCell>
                          <TableCell className="text-right">{money(a.spend_7d)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            {/* Disposition feed */}
            <Card>
              <CardHeader><CardTitle className="text-base">Recent dispositions</CardTitle></CardHeader>
              <CardContent className="space-y-2 max-h-[560px] overflow-y-auto">
                {dispoFeed.length === 0 ? (
                  <div className="text-sm text-muted-foreground">No dispositions yet.</div>
                ) : dispoFeed.map((d: any) => (
                  <div key={d.id} className="flex items-start justify-between gap-2 border-b border-border/50 pb-2 last:border-b-0">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{d.leads?.name ?? "(no name)"}</div>
                      <div className="text-xs text-muted-foreground truncate">{d.disposition_reason ?? "—"}{d.disposed_by ? ` · ${d.disposed_by}` : ""}</div>
                      <div className="text-xs text-muted-foreground">{formatDistanceToNow(new Date(d.disposed_at), { addSuffix: true })}</div>
                    </div>
                    <Badge variant="outline" className={`text-xs ${DISPO_TONE[d.disposition] ?? "bg-muted"}`}>{d.disposition}</Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          {/* CAPI strip */}
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base flex items-center gap-2"><Activity className="w-4 h-4" /> CAPI (24h)</CardTitle></CardHeader>
            <CardContent className="flex flex-wrap gap-4 items-center">
              {capiStats && Object.keys(capiStats.byEvent).length === 0 && capiStats.failures === 0 ? (
                <div className="text-sm text-muted-foreground">No events sent in the last 24h. {""}
                  Configure the client's <code className="bg-muted px-1 rounded">meta_pixel_id</code> to enable pixel conditioning.
                </div>
              ) : (
                <>
                  {Object.entries(capiStats?.byEvent ?? {}).map(([k, v]) => (
                    <div key={k} className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                      <span className="text-sm">{k}: <strong>{v}</strong></span>
                    </div>
                  ))}
                  {(capiStats?.failures ?? 0) > 0 && (
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 text-rose-500" />
                      <span className="text-sm">Failures: <strong>{capiStats?.failures}</strong></span>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}