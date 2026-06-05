import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertTriangle, Sparkles, TrendingUp, Users, DollarSign, Activity, Search, PlayCircle } from "lucide-react";
import { LineChart, Line, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid, BarChart, Bar } from "recharts";
import { toast } from "sonner";

function formatMoney(n: number | null | undefined, compact = false): string {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  const num = Number(n);
  if (compact) {
    if (num >= 1_000_000_000) return `$${(num / 1_000_000_000).toFixed(1)}B`;
    if (num >= 1_000_000) return `$${(num / 1_000_000).toFixed(1)}M`;
    if (num >= 1_000) return `$${(num / 1_000).toFixed(1)}K`;
  }
  return `$${num.toLocaleString()}`;
}

function KpiCard({ label, value, icon: Icon, accent, hero }: { label: string; value: string; icon: any; accent?: string; hero?: boolean }) {
  return (
    <Card className={`p-4 ${hero ? "bg-gradient-to-br from-primary/15 to-primary/5 border-primary/40" : "bg-card/60"}`}>
      <div className="flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-wide">
        <Icon className="h-3.5 w-3.5" /> {label}
      </div>
      <div className={`mt-2 font-bold ${hero ? "text-3xl text-primary" : "text-2xl"} ${accent || ""}`}>{value}</div>
    </Card>
  );
}

function useAgencyKpis() {
  return useQuery({
    queryKey: ["enrichment", "agency-kpis"],
    queryFn: async () => {
      const { data, error } = await supabase.from("v_agency_enrichment_kpis").select("*").maybeSingle();
      if (error) throw error;
      return data;
    },
    refetchInterval: 30_000,
  });
}

function useCoverage() {
  return useQuery({
    queryKey: ["enrichment", "coverage"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_client_enrichment_coverage")
        .select("*")
        .order("coverage_pct", { ascending: false });
      if (error) throw error;
      return data || [];
    },
    refetchInterval: 30_000,
  });
}

function useAlerts() {
  return useQuery({
    queryKey: ["enrichment", "alerts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("enrichment_alerts")
        .select("*, clients(name)")
        .is("resolved_at", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
    refetchInterval: 60_000,
  });
}

function useDailyEnrichmentSeries() {
  return useQuery({
    queryKey: ["enrichment", "daily-series"],
    queryFn: async () => {
      const since = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
      const { data, error } = await supabase
        .from("enrichment_run_log")
        .select("run_date, succeeded, failed")
        .gte("run_date", since);
      if (error) throw error;
      const byDay = new Map<string, { date: string; succeeded: number; failed: number }>();
      for (const r of data || []) {
        const d = (r as any).run_date;
        const e = byDay.get(d) || { date: d, succeeded: 0, failed: 0 };
        e.succeeded += (r as any).succeeded || 0;
        e.failed += (r as any).failed || 0;
        byDay.set(d, e);
      }
      return Array.from(byDay.values()).sort((a, b) => a.date.localeCompare(b.date));
    },
    refetchInterval: 60_000,
  });
}

function ExecutiveDashboard() {
  const { data: kpis } = useAgencyKpis();
  const { data: series } = useDailyEnrichmentSeries();

  const lastSync = kpis?.last_sync_at ? new Date(kpis.last_sync_at) : null;
  const lastSyncLabel = lastSync
    ? `${Math.max(0, Math.round((Date.now() - lastSync.getTime()) / 3600_000 * 10) / 10)}h ago`
    : "—";

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard hero label="Coverage" value={`${kpis?.coverage_pct ?? 0}%`} icon={TrendingUp} />
        <KpiCard label="Total Clients" value={String(kpis?.total_clients ?? 0)} icon={Users} />
        <KpiCard label="Total Contacts" value={Number(kpis?.total_contacts ?? 0).toLocaleString()} icon={Users} />
        <KpiCard label="Total Enriched" value={Number(kpis?.total_enriched ?? 0).toLocaleString()} icon={Sparkles} />
        <KpiCard label="Accredited Found" value={Number(kpis?.accredited_found ?? 0).toLocaleString()} icon={Sparkles} />
        <KpiCard label="Millionaire Leads" value={Number(kpis?.millionaires_found ?? 0).toLocaleString()} icon={DollarSign} />
        <KpiCard label="Last 24h" value={Number(kpis?.daily_enrichments ?? 0).toLocaleString()} icon={Activity} />
        <KpiCard label="Last Sync" value={lastSyncLabel} icon={Activity} />
      </div>

      <Card className="p-4 bg-card/60">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold">Enrichment Activity — Last 30 Days</h3>
          <span className="text-xs text-muted-foreground">Succeeded vs Failed</span>
        </div>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={series || []}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={11} />
              <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} />
              <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }} />
              <Bar dataKey="succeeded" stackId="a" fill="hsl(var(--primary))" />
              <Bar dataKey="failed" stackId="a" fill="hsl(var(--destructive))" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card className="p-4 bg-card/60">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="font-semibold">Agency Revenue Impact</h3>
            <p className="text-xs text-muted-foreground">Estimated value created from high-net-worth identified leads</p>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KpiCard label="Enriched Contacts" value={Number(kpis?.total_enriched ?? 0).toLocaleString()} icon={Sparkles} />
          <KpiCard label="Likely Accredited" value={Number(kpis?.accredited_found ?? 0).toLocaleString()} icon={Sparkles} />
          <KpiCard label="$1M+ Net Worth" value={Number(kpis?.millionaires_found ?? 0).toLocaleString()} icon={DollarSign} />
          <KpiCard label="Estimated Prospect Value" value={formatMoney(kpis?.estimated_prospect_value, true)} icon={DollarSign} accent="text-primary" />
        </div>
      </Card>
    </div>
  );
}

function ClientLeaderboard({ onBulk }: { onBulk: (clientId: string, name: string) => void }) {
  const { data: rows } = useCoverage();
  const ranked = useMemo(() => (rows || []).filter(r => (r as any).total_contacts > 0), [rows]);
  const top5 = new Set(ranked.slice(0, 5).map(r => (r as any).client_id));
  const bottom5 = new Set(ranked.slice(-5).map(r => (r as any).client_id));

  return (
    <Card className="p-0 bg-card/60 overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Client</TableHead>
            <TableHead className="text-right">Contacts</TableHead>
            <TableHead className="text-right">Enriched</TableHead>
            <TableHead className="w-[220px]">Coverage</TableHead>
            <TableHead className="text-right">Last 7d</TableHead>
            <TableHead className="text-right">Failed</TableHead>
            <TableHead className="text-right">Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {(rows || []).map((r: any) => {
            const isTop = top5.has(r.client_id);
            const isBottom = bottom5.has(r.client_id) && !isTop;
            return (
              <TableRow key={r.client_id} className={isTop ? "bg-emerald-500/5" : isBottom ? "bg-destructive/5" : ""}>
                <TableCell className="font-medium">
                  {r.client_name}
                  {isTop && <Badge variant="outline" className="ml-2 border-emerald-500/40 text-emerald-500">Top</Badge>}
                  {isBottom && <Badge variant="outline" className="ml-2 border-destructive/40 text-destructive">Low</Badge>}
                </TableCell>
                <TableCell className="text-right">{Number(r.total_contacts).toLocaleString()}</TableCell>
                <TableCell className="text-right">{Number(r.enriched_contacts).toLocaleString()}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Progress value={Number(r.coverage_pct)} className="h-2" />
                    <span className="text-xs tabular-nums w-12 text-right">{r.coverage_pct}%</span>
                  </div>
                </TableCell>
                <TableCell className="text-right">{Number(r.last_7d).toLocaleString()}</TableCell>
                <TableCell className="text-right">{Number(r.failed_matches).toLocaleString()}</TableCell>
                <TableCell className="text-right">
                  <Button size="sm" variant="outline" onClick={() => onBulk(r.client_id, r.client_name)}>
                    <PlayCircle className="h-3.5 w-3.5 mr-1" />Bulk
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Card>
  );
}

function BulkJobsPanel() {
  const { data: jobs, refetch } = useQuery({
    queryKey: ["enrichment", "jobs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("enrichment_jobs")
        .select("*, clients(name)")
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data || [];
    },
    refetchInterval: 5_000,
  });

  useEffect(() => {
    const ch = supabase
      .channel("enrichment_jobs_changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "enrichment_jobs" }, () => refetch())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [refetch]);

  if (!jobs || jobs.length === 0) return null;
  return (
    <Card className="p-4 bg-card/60">
      <h3 className="font-semibold mb-3">Active Bulk Backfill Jobs</h3>
      <div className="space-y-3">
        {jobs.map((j: any) => {
          const pct = j.total > 0 ? Math.round((j.processed / j.total) * 100) : 0;
          return (
            <div key={j.id} className="border border-border/40 rounded-lg p-3">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">{j.clients?.name || j.client_id}</span>
                <Badge variant={j.status === "completed" ? "default" : j.status === "failed" ? "destructive" : "secondary"}>
                  {j.status}
                </Badge>
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                {Number(j.processed).toLocaleString()} / {Number(j.total).toLocaleString()} — {pct}% — ✓ {j.succeeded} · ✗ {j.failed}
              </div>
              <Progress value={pct} className="h-2 mt-2" />
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function AlertsPanel() {
  const { data: alerts } = useAlerts();
  if (!alerts || alerts.length === 0) {
    return (
      <Card className="p-6 bg-card/60 text-center text-muted-foreground text-sm">
        ✓ All clear — no active alerts.
      </Card>
    );
  }
  return (
    <div className="space-y-2">
      {alerts.map((a: any) => (
        <Card key={a.id} className={`p-3 border-l-4 ${a.severity === "error" ? "border-l-destructive bg-destructive/5" : "border-l-yellow-500 bg-yellow-500/5"}`}>
          <div className="flex items-center gap-3">
            <AlertTriangle className={`h-4 w-4 ${a.severity === "error" ? "text-destructive" : "text-yellow-500"}`} />
            <div className="flex-1">
              <div className="font-medium text-sm">{a.clients?.name || a.client_id}</div>
              <div className="text-xs text-muted-foreground">{a.type} — {a.message}</div>
            </div>
            <span className="text-xs text-muted-foreground">{new Date(a.created_at).toLocaleString()}</span>
          </div>
        </Card>
      ))}
    </div>
  );
}

function AgencyLeadSearch() {
  const [minNetWorth, setMinNetWorth] = useState<string>("0");
  const [minIncome, setMinIncome] = useState<string>("0");
  const [minScore, setMinScore] = useState<string>("0");
  const [accredited, setAccredited] = useState<string>("any");
  const [businessOwner, setBusinessOwner] = useState<string>("any");
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const runSearch = async () => {
    setLoading(true);
    let q = supabase
      .from("lead_enrichment")
      .select("id, client_id, first_name, last_name, city, state, net_worth_midpoint, household_income_midpoint, home_value, investor_score, accredited_probability, business_owner, clients(name)")
      .limit(200);
    if (Number(minNetWorth) > 0) q = q.gte("net_worth_midpoint", Number(minNetWorth));
    if (Number(minIncome) > 0) q = q.gte("household_income_midpoint", Number(minIncome));
    if (Number(minScore) > 0) q = q.gte("investor_score", Number(minScore));
    if (accredited === "high") q = q.eq("accredited_probability", "high");
    if (businessOwner === "yes") q = q.eq("business_owner", true);
    q = q.order("investor_score", { ascending: false });
    const { data, error } = await q;
    setLoading(false);
    if (error) { toast.error(error.message); return; }
    setResults(data || []);
  };

  return (
    <div className="space-y-4">
      <Card className="p-4 bg-card/60">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <div><label className="text-xs text-muted-foreground">Min Net Worth ($)</label><Input value={minNetWorth} onChange={e => setMinNetWorth(e.target.value)} /></div>
          <div><label className="text-xs text-muted-foreground">Min Income ($)</label><Input value={minIncome} onChange={e => setMinIncome(e.target.value)} /></div>
          <div><label className="text-xs text-muted-foreground">Min Investor Score</label><Input value={minScore} onChange={e => setMinScore(e.target.value)} /></div>
          <div>
            <label className="text-xs text-muted-foreground">Accredited</label>
            <Select value={accredited} onValueChange={setAccredited}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Any</SelectItem>
                <SelectItem value="high">Likely (High)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Business Owner</label>
            <Select value={businessOwner} onValueChange={setBusinessOwner}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Any</SelectItem>
                <SelectItem value="yes">Yes</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <Button className="mt-3" onClick={runSearch} disabled={loading}>
          <Search className="h-4 w-4 mr-2" />{loading ? "Searching..." : "Search Across All Clients"}
        </Button>
      </Card>

      {results.length > 0 && (
        <Card className="p-0 bg-card/60 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Location</TableHead>
                <TableHead className="text-right">Net Worth</TableHead>
                <TableHead className="text-right">Income</TableHead>
                <TableHead className="text-right">Home Value</TableHead>
                <TableHead className="text-right">Score</TableHead>
                <TableHead>Accredited</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {results.map((r: any) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{[r.first_name, r.last_name].filter(Boolean).join(" ") || "—"}</TableCell>
                  <TableCell className="text-muted-foreground text-xs">{r.clients?.name}</TableCell>
                  <TableCell className="text-muted-foreground text-xs">{[r.city, r.state].filter(Boolean).join(", ")}</TableCell>
                  <TableCell className="text-right">{formatMoney(r.net_worth_midpoint, true)}</TableCell>
                  <TableCell className="text-right">{formatMoney(r.household_income_midpoint, true)}</TableCell>
                  <TableCell className="text-right">{formatMoney(r.home_value, true)}</TableCell>
                  <TableCell className="text-right font-bold">{r.investor_score ?? 0}</TableCell>
                  <TableCell>
                    <Badge variant={r.accredited_probability === "high" ? "default" : "outline"}>
                      {r.accredited_probability || "—"}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}

export function LeadsTab() {
  const [tab, setTab] = useState("overview");

  const startBulk = async (clientId: string, name: string) => {
    const { data, error } = await supabase.functions.invoke("bulk-enrich-account", {
      body: { client_id: clientId },
    });
    if (error || !data?.success) {
      toast.error(`Failed to start: ${error?.message || data?.error || "unknown"}`);
      return;
    }
    toast.success(`Bulk backfill ${data?.resumed ? "resumed" : "started"} for ${name}`);
  };

  const runNow = async () => {
    toast.info("Triggering auto-enrich for all clients...");
    const { data, error } = await supabase.functions.invoke("auto-enrich-all", {
      body: { per_client: 50, refresh_days: 30 },
    });
    if (error) toast.error(error.message);
    else toast.success(`Processed ${data?.totals?.processed ?? 0} contacts across ${data?.clients ?? 0} clients`);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">Lead Enrichment</h2>
          <p className="text-xs text-muted-foreground">Coverage % is the primary KPI — Enriched ÷ Total Contacts</p>
        </div>
        <Button onClick={runNow}><Sparkles className="h-4 w-4 mr-2" />Run Auto-Enrich Now</Button>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="leaderboard">Leaderboard</TabsTrigger>
          <TabsTrigger value="search">Agency Search</TabsTrigger>
          <TabsTrigger value="alerts">Alerts</TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="mt-4 space-y-6">
          <ExecutiveDashboard />
          <BulkJobsPanel />
        </TabsContent>
        <TabsContent value="leaderboard" className="mt-4 space-y-4">
          <BulkJobsPanel />
          <ClientLeaderboard onBulk={startBulk} />
        </TabsContent>
        <TabsContent value="search" className="mt-4">
          <AgencyLeadSearch />
        </TabsContent>
        <TabsContent value="alerts" className="mt-4">
          <AlertsPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
