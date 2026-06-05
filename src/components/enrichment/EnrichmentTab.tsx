import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Sparkles, RefreshCw, CheckCircle2, AlertCircle, Database as DbIcon, Settings2, FlaskConical } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';
import { SheetEnricher } from './SheetEnricher';

interface ClientEnrichmentRow {
  id: string;
  name: string;
  ghl_api_key: string | null;
  ghl_location_id: string | null;
  retargetiq_website_slug: string | null;
  retargetiq_auto_enrich: boolean;
  total_leads: number;
  enriched_leads: number;
  last_enriched_at: string | null;
}

export function EnrichmentTab() {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [slugDraft, setSlugDraft] = useState('');
  const [bulkRunning, setBulkRunning] = useState<string | null>(null);
  const [runAllLoading, setRunAllLoading] = useState(false);
  const [sheetWritebackLoading, setSheetWritebackLoading] = useState(false);
  const [testRunning, setTestRunning] = useState<string | null>(null);
  const [testAudit, setTestAudit] = useState<any | null>(null);
  const [testLimit, setTestLimit] = useState<number>(10);
  const [testDryRun, setTestDryRun] = useState<boolean>(true);

  const { data: rows, isLoading, refetch } = useQuery({
    queryKey: ['enrichment-overview'],
    queryFn: async () => {
      const { data: clients, error: cErr } = await supabase
        .from('clients')
        .select('id, name, ghl_api_key, ghl_location_id, status')
        .in('status', ['active', 'onboarding', 'paused'])
        .order('name');
      if (cErr) throw cErr;

      const ids = (clients || []).map(c => c.id);
      if (ids.length === 0) return [] as ClientEnrichmentRow[];

      const { data: settings } = await supabase
        .from('client_settings')
        .select('client_id, retargetiq_website_slug, retargetiq_auto_enrich')
        .in('client_id', ids);
      const settingsMap = new Map((settings || []).map(s => [s.client_id, s]));

      // Accurate per-client counts (avoids Supabase 1000-row default cap)
      const leadCount = new Map<string, number>();
      const enrichCount = new Map<string, number>();
      const lastEnrich = new Map<string, string>();
      await Promise.all(ids.map(async (cid) => {
        const [{ count: lc }, { count: ec }, { data: last }] = await Promise.all([
          supabase.from('leads').select('*', { count: 'exact', head: true }).eq('client_id', cid),
          supabase.from('lead_enrichment').select('*', { count: 'exact', head: true }).eq('client_id', cid),
          supabase.from('lead_enrichment').select('enriched_at').eq('client_id', cid).order('enriched_at', { ascending: false }).limit(1),
        ]);
        leadCount.set(cid, lc || 0);
        enrichCount.set(cid, ec || 0);
        if (last && last[0]?.enriched_at) lastEnrich.set(cid, last[0].enriched_at);
      }));

      return (clients || []).map<ClientEnrichmentRow>(c => {
        const s = settingsMap.get(c.id) as any;
        return {
          id: c.id,
          name: c.name,
          ghl_api_key: c.ghl_api_key,
          ghl_location_id: c.ghl_location_id,
          retargetiq_website_slug: s?.retargetiq_website_slug ?? null,
          retargetiq_auto_enrich: s?.retargetiq_auto_enrich ?? false,
          total_leads: leadCount.get(c.id) || 0,
          enriched_leads: enrichCount.get(c.id) || 0,
          last_enriched_at: lastEnrich.get(c.id) ?? null,
        };
      });
    },
    refetchInterval: 30_000,
  });

  const totals = useMemo(() => {
    const t = { clients: 0, configured: 0, totalLeads: 0, enriched: 0 };
    (rows || []).forEach(r => {
      t.clients++;
      if (r.ghl_api_key && r.ghl_location_id && r.retargetiq_website_slug) t.configured++;
      t.totalLeads += r.total_leads;
      t.enriched += r.enriched_leads;
    });
    return t;
  }, [rows]);

  async function saveSettings(clientId: string, patch: { retargetiq_website_slug?: string | null; retargetiq_auto_enrich?: boolean }) {
    const { error } = await supabase
      .from('client_settings')
      .upsert({ client_id: clientId, ...patch }, { onConflict: 'client_id' });
    if (error) {
      toast.error(`Save failed: ${error.message}`);
      return false;
    }
    toast.success('Settings saved');
    refetch();
    return true;
  }

  async function runBulkEnrich(clientId: string, name: string) {
    setBulkRunning(clientId);
    try {
      const { data, error } = await supabase.functions.invoke('bulk-enrich', {
        body: { client_id: clientId, limit: 200, offset: 0, since_hours: 24 },
      });
      if (error) throw error;
      toast.success(`${name}: synced last 24h — enriched ${data?.succeeded ?? 0}, failed ${data?.failed ?? 0}`);
      refetch();
    } catch (e: any) {
      toast.error(`Sync last 24h failed: ${e.message}`);
    } finally {
      setBulkRunning(null);
    }
  }

  async function runAutoEnrichAll() {
    setRunAllLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('auto-enrich-all', {
        body: { per_client: 50 },
      });
      if (error) throw error;
      const t = data?.totals || { succeeded: 0, failed: 0, processed: 0 };
      toast.success(`Auto-enrich sweep: ${t.succeeded} enriched / ${t.failed} failed across ${data?.clients ?? 0} clients`);
      refetch();
    } catch (e: any) {
      toast.error(`Auto-enrich all failed: ${e.message}`);
    } finally {
      setRunAllLoading(false);
    }
  }

  async function runSheetWritebackAll() {
    setSheetWritebackLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('enrich-sheet-writeback', { body: {} });
      if (error) throw error;
      const total = (data?.results || []).reduce((s: number, r: any) => s + (r.matched || 0), 0);
      toast.success(`Sheet writeback: ${total} rows enriched across ${data?.processed ?? 0} clients`);
    } catch (e: any) {
      toast.error(`Sheet writeback failed: ${e.message}`);
    } finally {
      setSheetWritebackLoading(false);
    }
  }

  async function runTest(clientId: string, name: string) {
    setTestRunning(clientId);
    try {
      const { data, error } = await supabase.functions.invoke('enrichment-test-run', {
        body: { client_id: clientId, limit: testLimit, dry_run: testDryRun },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Test run failed');
      setTestAudit({ name, ...data.audit });
      toast.success(`${name}: test run complete`);
      refetch();
    } catch (e: any) {
      toast.error(`Test run failed: ${e.message}`);
    } finally {
      setTestRunning(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Sparkles className="h-6 w-6 text-primary" /> Lead Enrichment (RetargetIQ)
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Enrichment is configured <b>per client</b> here. When Auto-Enrich is ON, new contacts sync hourly, a
            financial summary note is posted to the GHL contact, and — if a Google Sheet is connected — enrichment
            columns are appended to the matching row in every tab.
          </p>
        </div>
        <div className="flex gap-2">
          <div className="flex items-center gap-2 px-2 border rounded-md bg-muted/30">
            <FlaskConical className="h-3.5 w-3.5 text-muted-foreground" />
            <Label className="text-xs text-muted-foreground">Test:</Label>
            <Input type="number" min={1} max={50} value={testLimit}
              onChange={(e) => setTestLimit(Math.max(1, Math.min(50, Number(e.target.value) || 10)))}
              className="h-7 w-16 text-xs" />
            <Label className="text-xs flex items-center gap-1">
              <Switch checked={testDryRun} onCheckedChange={setTestDryRun} /> Dry-run
            </Label>
          </div>
          <Button variant="outline" onClick={runSheetWritebackAll} disabled={sheetWritebackLoading}>
            {sheetWritebackLoading ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> : <DbIcon className="h-4 w-4 mr-2" />}
            Sync to Sheets
          </Button>
          <Button onClick={runAutoEnrichAll} disabled={runAllLoading}>
            {runAllLoading ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
            Run Auto-Enrich Now
          </Button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground">Active Clients</div>
          <div className="text-2xl font-bold">{totals.clients}</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground">Fully Configured</div>
          <div className="text-2xl font-bold text-emerald-600">{totals.configured}</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground">Total Leads</div>
          <div className="text-2xl font-bold">{totals.totalLeads.toLocaleString()}</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground">Enriched Leads</div>
          <div className="text-2xl font-bold">
            {totals.enriched.toLocaleString()}
            <span className="text-sm font-normal text-muted-foreground ml-2">
              {totals.totalLeads ? `${Math.round((totals.enriched / totals.totalLeads) * 100)}%` : '—'}
            </span>
          </div>
        </CardContent></Card>
      </div>

      {/* How it works */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><Settings2 className="h-4 w-4" /> How it works</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>1. Add a client's <b>GHL Private Integration token</b> + <b>Location ID</b> in their settings.</p>
          <p>2. Set the client's <b>RetargetIQ website slug</b> below.</p>
          <p>3. Toggle <b>Auto-Enrich</b> ON. Every hour, new GHL contacts are auto-enriched in the background and a financial summary note is posted back to the GHL contact.</p>
          <p>4. If the client has a <b>Google Sheet connected</b>, enrichment columns (Net Worth, HH Income, Home Value, etc.) are appended to the matching contact row in every tab.</p>
          <p>Use <b>Bulk Enrich</b> to backfill existing un-enriched leads (50 at a time).</p>
        </CardContent>
      </Card>

      {/* Sheet enrichment */}
      <SheetEnricher clients={(rows || []).map(r => ({ id: r.id, name: r.name }))} />

      {/* Per-client table */}
      <Card>
        <CardHeader className="flex-row justify-between items-center">
          <div>
            <CardTitle className="text-base">Per-client status</CardTitle>
            <CardDescription>Live setup, coverage and last enrichment timestamps</CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-2" /> Refresh
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Client</TableHead>
                <TableHead>GHL</TableHead>
                <TableHead>RetargetIQ Slug</TableHead>
                <TableHead>Auto-Enrich</TableHead>
                <TableHead className="text-right">Coverage</TableHead>
                <TableHead>Last Enriched</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
              )}
              {!isLoading && (rows || []).map(r => {
                const ghlOk = !!(r.ghl_api_key && r.ghl_location_id);
                const slugOk = !!r.retargetiq_website_slug;
                const fullOk = ghlOk && slugOk;
                const pct = r.total_leads ? Math.round((r.enriched_leads / r.total_leads) * 100) : 0;
                return (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        {fullOk ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <AlertCircle className="h-4 w-4 text-amber-500" />}
                        {r.name}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={ghlOk ? 'default' : 'secondary'}>{ghlOk ? 'Connected' : 'Missing'}</Badge>
                    </TableCell>
                    <TableCell>
                      {editingId === r.id ? (
                        <div className="flex gap-1">
                          <Input value={slugDraft} onChange={e => setSlugDraft(e.target.value)} placeholder="website-slug" className="h-8 w-40" />
                          <Button size="sm" onClick={async () => {
                            const ok = await saveSettings(r.id, { retargetiq_website_slug: slugDraft.trim() || null });
                            if (ok) setEditingId(null);
                          }}>Save</Button>
                          <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>X</Button>
                        </div>
                      ) : (
                        <button
                          className="text-sm hover:underline text-left"
                          onClick={() => { setEditingId(r.id); setSlugDraft(r.retargetiq_website_slug || ''); }}
                        >
                          {r.retargetiq_website_slug || <span className="text-muted-foreground italic">click to set</span>}
                        </button>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={r.retargetiq_auto_enrich}
                          onCheckedChange={(v) => saveSettings(r.id, { retargetiq_auto_enrich: v })}
                        />
                        <Label className="text-xs text-muted-foreground">{r.retargetiq_auto_enrich ? 'On' : 'Off'}</Label>
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      <div className="text-sm">{r.enriched_leads.toLocaleString()} / {r.total_leads.toLocaleString()}</div>
                      <div className="text-xs text-muted-foreground">{pct}%</div>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {r.last_enriched_at ? formatDistanceToNow(new Date(r.last_enriched_at), { addSuffix: true }) : '—'}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex gap-1 justify-end">
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={!fullOk || testRunning === r.id}
                          onClick={() => runTest(r.id, r.name)}
                          title={`Run on ${testLimit} most recent leads${testDryRun ? ' (dry-run — no writes)' : ''}`}
                        >
                          {testRunning === r.id ? <RefreshCw className="h-3 w-3 mr-1 animate-spin" /> : <FlaskConical className="h-3 w-3 mr-1" />}
                          Test {testLimit}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!fullOk || bulkRunning === r.id}
                          onClick={() => runBulkEnrich(r.id, r.name)}
                          title="Enrich leads created in the last 24 hours"
                        >
                          {bulkRunning === r.id ? <RefreshCw className="h-3 w-3 mr-1 animate-spin" /> : <DbIcon className="h-3 w-3 mr-1" />}
                          Sync 24h
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={!!testAudit} onOpenChange={(o) => !o && setTestAudit(null)}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Test Run Audit — {testAudit?.name}</DialogTitle>
            <DialogDescription>
              {testAudit?.dry_run ? 'Dry-run (no writes performed)' : 'Live run — writes performed'} · limit {testAudit?.limit}
            </DialogDescription>
          </DialogHeader>
          {testAudit && (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="p-3 rounded-md border bg-muted/30">
                  <div className="text-xs text-muted-foreground">Leads considered</div>
                  <div className="text-xl font-bold">{testAudit.leads_considered}</div>
                </div>
                <div className="p-3 rounded-md border bg-muted/30">
                  <div className="text-xs text-muted-foreground">Already enriched</div>
                  <div className="text-xl font-bold">{testAudit.enrichment?.already_enriched ?? 0}</div>
                </div>
                <div className="p-3 rounded-md border bg-muted/30">
                  <div className="text-xs text-muted-foreground">Newly enriched</div>
                  <div className="text-xl font-bold text-emerald-600">{testAudit.enrichment?.newly_enriched ?? 0}</div>
                </div>
                <div className="p-3 rounded-md border bg-muted/30">
                  <div className="text-xs text-muted-foreground">Enrichment failed</div>
                  <div className="text-xl font-bold text-destructive">{testAudit.enrichment?.failed ?? 0}</div>
                </div>
              </div>

              {testAudit.sheet?.skipped && (
                <div className="p-3 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30">
                  Sheet writeback skipped: <b>{testAudit.sheet.skipped}</b>
                </div>
              )}

              {testAudit.sheet?.totals && (
                <div>
                  <div className="font-semibold mb-2">Sheet writeback ({testAudit.sheet.tabs.length} tabs)</div>
                  <div className="grid grid-cols-3 gap-2 mb-3">
                    <div className="p-2 rounded border text-center"><div className="text-xs text-muted-foreground">Matched</div><div className="font-bold">{testAudit.sheet.totals.matched}</div></div>
                    <div className="p-2 rounded border text-center"><div className="text-xs text-muted-foreground">Written</div><div className="font-bold text-emerald-600">{testAudit.sheet.totals.written}</div></div>
                    <div className="p-2 rounded border text-center"><div className="text-xs text-muted-foreground">Skipped</div><div className="font-bold text-muted-foreground">{testAudit.sheet.totals.skipped}</div></div>
                  </div>
                  <div className="border rounded-md overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Tab</TableHead>
                          <TableHead className="text-right">Rows</TableHead>
                          <TableHead className="text-right">Matched</TableHead>
                          <TableHead className="text-right">Written</TableHead>
                          <TableHead className="text-right">Skipped</TableHead>
                          <TableHead>Note</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {testAudit.sheet.tabs.map((t: any) => (
                          <TableRow key={t.tab}>
                            <TableCell className="font-medium">{t.tab}</TableCell>
                            <TableCell className="text-right tabular-nums">{t.scanned_rows ?? 0}</TableCell>
                            <TableCell className="text-right tabular-nums">{t.matched ?? 0}</TableCell>
                            <TableCell className="text-right tabular-nums text-emerald-600">{t.written ?? 0}</TableCell>
                            <TableCell className="text-right tabular-nums text-muted-foreground">{t.skipped?.length ?? 0}</TableCell>
                            <TableCell className="text-xs text-muted-foreground">{t.error || t.note || ''}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}

              {testAudit.enrichment?.failures?.length > 0 && (
                <div>
                  <div className="font-semibold mb-2 text-destructive">Enrichment failures</div>
                  <ul className="text-xs space-y-1">
                    {testAudit.enrichment.failures.map((f: any, i: number) => (
                      <li key={i}>· <b>{f.lead}</b> — {f.reason}</li>
                    ))}
                  </ul>
                </div>
              )}

              <details className="text-xs">
                <summary className="cursor-pointer text-muted-foreground">Raw JSON</summary>
                <pre className="mt-2 p-2 rounded bg-muted overflow-x-auto">{JSON.stringify(testAudit, null, 2)}</pre>
              </details>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setTestAudit(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}