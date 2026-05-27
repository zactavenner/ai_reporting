import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { ArrowLeft, CheckCircle2, ExternalLink, Loader2, RefreshCw, Wand2, XCircle } from 'lucide-react';

type Row = {
  client_id: string;
  name: string;
  status: string;
  sheet_id: string | null;
  sheet_gid: string | null;
  default_source: 'sheet' | 'database' | null;
  test?: {
    ok: boolean;
    rows: number;
    tab?: string;
    error?: string;
    ms?: number;
    tabsUsed?: string[];
    tabsSkipped?: { title: string; reason: string }[];
  };
  testing?: boolean;
  draftUrl?: string;
  saving?: boolean;
  refreshing?: boolean;
  lastRefreshAt?: Date;
};

function extractSheetId(url: string): { sheetId: string | null; gid: string | null } {
  const m = url.match(/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  const sheetId = m ? m[1] : null;
  const gidMatch = url.match(/[?#&]gid=(\d+)/);
  return { sheetId, gid: gidMatch ? gidMatch[1] : null };
}

const SEED_BULK = `LSCRE\t16LG4qTxtyv1Fk2Rco-mjpz5W7z23P01rADQxgBFmcuE
Paradyme\t1Sj12SttVu_to21-VO7aYU72ulThppyvY-InPDqkCKOs
Blue Capital\t10ETeNuyi0dxHjCMyymrros1jDKyH6HKMwP4QVSBpZU0
Healing Reality Trust\t1I_EtRbx4R9vXjMEzNqA3HM8VHFtvJ8hZQSk4HXqedJQ
Quad J Capital\t1pnSkJyJ_9ccx9ZKNrEPgGjYq8Lr-jeIRSbPllP1qjsc
Injury Pro Capital\t1OrwBnPKD2wfUl1_swyqitNzOyhxI3EUJqXpN9mBnNd8
Granite Towers\t1mOOzTcMtCnJWoERSyy84QPIEiH9YV-SYZQ0jpdsvGwU
Blue Metric Group\t10xV7saNrOB-4kFQaM8eLjGnx1Y6epES8u6IK2eDcy38
Nationwide Paving\t1tm-qpPRzv38JtIL9-KvZVThqTk4OJcWv3duw8H2KHhY
Evia Partners\t1hKy_pkcw4horLr8VTzV9siSZXBidcwI_y-7j3C608mk
Texas State Oil\t1bhUZ_9r6c1yjwoEajev9wcjkxxDAZ0xT8cJ1Dzws8i4
Titan\t17AZjJE-b7KPTlZNQH4F_38QTELIuukMaWlH9kjUTwLU
Kroh Exploration\t1Ad3Ehm_vp1nZNecGwMLMqZdGpegUxFdgoul-Y9Lfq-A
Lansing Capital\t1Y_VAK-6FB_dOdIcISiLxwREh5Xfp-pPXUmM5Om8HRN8
Alamo\t1bnT2VM9acak-E3v894MAamQUlH5eEavki4JqpFQf9dU
Freaky Fast Investment\t13y43f0wZxf0Z8QyptDxB5_9_hB_afLzlAzxRaoxdlus
Legacy Capital\t19XfiMod_n-CuxoM0OEgmeddhTJZCkuhdVPWJJm6-1iE
Land Value Alpha\t1RLSkiRh_kphvEZ23uRXQFYsWp5nk_reBhii9rUsBZzM`;

function normalizeName(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function parseBulk(text: string): { name: string; sheetId: string }[] {
  const out: { name: string; sheetId: string }[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const parts = line.split(/\t|,| \| |\s{2,}/).map((p) => p.trim()).filter(Boolean);
    if (parts.length < 2) continue;
    const name = parts[0];
    const tail = parts.slice(1).join(' ');
    const fromUrl = extractSheetId(tail).sheetId;
    const idMatch = tail.match(/[a-zA-Z0-9_-]{30,}/);
    const sheetId = fromUrl || (idMatch ? idMatch[0] : '');
    if (sheetId) out.push({ name, sheetId });
  }
  return out;
}

export default function SheetsHealthPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [bulkText, setBulkText] = useState(SEED_BULK);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefreshAt, setLastRefreshAt] = useState<Date | null>(null);

  async function load() {
    setLoading(true);
    const { data: clients } = await supabase
      .from('clients')
      .select('id, name, status')
      .in('status', ['active', 'onboarding', 'paused'])
      .order('name');
    const ids = (clients ?? []).map((c) => c.id);
    const { data: settings } = await supabase
      .from('client_settings')
      .select('client_id, metrics_sheet_id, metrics_sheet_gid, metrics_source_default')
      .in('client_id', ids);
    const map = new Map((settings ?? []).map((s: any) => [s.client_id, s]));
    setRows(
      (clients ?? []).map((c) => {
        const s = map.get(c.id);
        return {
          client_id: c.id,
          name: c.name,
          status: c.status,
          sheet_id: s?.metrics_sheet_id ?? null,
          sheet_gid: s?.metrics_sheet_gid ?? null,
          default_source: s?.metrics_source_default ?? null,
          draftUrl: s?.metrics_sheet_id
            ? `https://docs.google.com/spreadsheets/d/${s.metrics_sheet_id}/edit${s.metrics_sheet_gid ? `#gid=${s.metrics_sheet_gid}` : ''}`
            : '',
        };
      }),
    );
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  const stats = useMemo(() => {
    const bound = rows.filter((r) => r.sheet_id).length;
    return { total: rows.length, bound, missing: rows.length - bound };
  }, [rows]);

  function patch(id: string, p: Partial<Row>) {
    setRows((rs) => rs.map((r) => (r.client_id === id ? { ...r, ...p } : r)));
  }

  const bulkMatches = useMemo(() => {
    const parsed = parseBulk(bulkText);
    return parsed.map((p) => {
      const target = normalizeName(p.name);
      const exact = rows.find((r) => normalizeName(r.name) === target);
      const partial =
        exact ||
        rows.find((r) => {
          const n = normalizeName(r.name);
          return n.includes(target) || target.includes(n);
        });
      return { ...p, client: partial ?? null };
    });
  }, [bulkText, rows]);

  const matchedCount = bulkMatches.filter((m) => m.client).length;

  async function applyBulk() {
    setBulkBusy(true);
    let saved = 0, failed = 0;
    for (const m of bulkMatches) {
      if (!m.client) continue;
      const { data: existing } = await supabase
        .from('client_settings').select('id').eq('client_id', m.client.client_id).maybeSingle();
      const payload: any = {
        client_id: m.client.client_id,
        metrics_sheet_id: m.sheetId,
        metrics_sheet_gid: null,
        metrics_source_default: 'sheet',
      };
      const { error } = existing
        ? await supabase.from('client_settings').update(payload).eq('client_id', m.client.client_id)
        : await supabase.from('client_settings').insert(payload);
      if (error) failed++;
      else saved++;
    }
    setBulkBusy(false);
    toast({ title: 'Bulk save complete', description: `${saved} saved, ${failed} failed` });
    await load();
  }

  async function testRow(r: Row) {
    if (!r.sheet_id) return;
    patch(r.client_id, { testing: true });
    const t0 = Date.now();
    try {
      const { data, error } = await supabase.functions.invoke('fetch-sheet-metrics', {
        body: { sheet_id: r.sheet_id, gid: r.sheet_gid || undefined },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      patch(r.client_id, {
        testing: false,
        test: {
          ok: true,
          rows: (data as any)?.rowCount ?? 0,
          tab: (data as any)?.sheetTitle,
          ms: Date.now() - t0,
          tabsUsed: (data as any)?.tabsUsed ?? [],
          tabsSkipped: (data as any)?.tabsSkipped ?? [],
        },
      });
    } catch (e: any) {
      patch(r.client_id, { testing: false, test: { ok: false, rows: 0, error: e?.message ?? 'failed', ms: Date.now() - t0 } });
    }
  }

  async function testAll() {
    const bound = rows.filter((r) => r.sheet_id);
    for (const r of bound) await testRow(r);
  }

  /**
   * Force-refresh a single client: invalidate that client's cached
   * sheet-metrics queries so any open dashboard re-pulls from Google Sheets,
   * then re-run the connectivity test so the row reflects fresh counts.
   */
  async function refreshRow(r: Row) {
    if (!r.sheet_id) return;
    patch(r.client_id, { refreshing: true });
    try {
      // Invalidate any cached sheet-metrics query that references this client
      // or this sheet id, regardless of date-range key suffix.
      await queryClient.invalidateQueries({
        predicate: (q) => {
          const k = q.queryKey as unknown[];
          if (!Array.isArray(k) || k[0] !== 'sheet-metrics') return false;
          return k.some((part) => part === r.client_id || part === r.sheet_id);
        },
      });
      await testRow(r);
      patch(r.client_id, { lastRefreshAt: new Date() });
      toast({ title: 'Refreshed', description: `${r.name} re-pulled from Google Sheets.` });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Refresh failed', description: e?.message ?? 'unknown error' });
    } finally {
      patch(r.client_id, { refreshing: false });
    }
  }

  /**
   * Force-refresh: invalidate every cached sheet-metrics query (so any open
   * dashboard re-pulls from Google Sheets on its next render) and re-run
   * connectivity tests on all bound rows so we surface the new row counts here.
   */
  async function refreshAll() {
    setRefreshing(true);
    try {
      await queryClient.invalidateQueries({ queryKey: ['sheet-metrics'] });
      const bound = rows.filter((r) => r.sheet_id);
      let ok = 0, fail = 0;
      for (const r of bound) {
        await testRow(r);
        // testRow updates state; we read it back from the latest snapshot below.
      }
      // Tally from the freshest state after the loop completes.
      setRows((current) => {
        for (const r of current) {
          if (!r.sheet_id) continue;
          if (r.test?.ok) ok++;
          else if (r.test?.ok === false) fail++;
        }
        return current;
      });
      setLastRefreshAt(new Date());
      toast({
        title: 'Sheets refreshed',
        description: `${bound.length} sheet${bound.length === 1 ? '' : 's'} re-pulled. Dashboards will use fresh data.`,
      });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Refresh failed', description: e?.message ?? 'unknown error' });
    } finally {
      setRefreshing(false);
    }
  }

  async function saveRow(r: Row) {
    const { sheetId, gid } = extractSheetId(r.draftUrl ?? '');
    if (!sheetId) {
      toast({ variant: 'destructive', title: 'Invalid URL', description: r.name });
      return;
    }
    patch(r.client_id, { saving: true });
    const { data: existing } = await supabase
      .from('client_settings').select('id').eq('client_id', r.client_id).maybeSingle();
    const payload: any = {
      client_id: r.client_id,
      metrics_sheet_id: sheetId,
      metrics_sheet_gid: gid,
      metrics_source_default: 'sheet',
    };
    const { error } = existing
      ? await supabase.from('client_settings').update(payload).eq('client_id', r.client_id)
      : await supabase.from('client_settings').insert(payload);
    patch(r.client_id, {
      saving: false,
      sheet_id: error ? r.sheet_id : sheetId,
      sheet_gid: error ? r.sheet_gid : gid,
      default_source: error ? r.default_source : 'sheet',
    });
    if (error) toast({ variant: 'destructive', title: 'Save failed', description: error.message });
    else toast({ title: 'Saved', description: r.name });
  }

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="sm">
            <Link to="/"><ArrowLeft className="h-4 w-4 mr-1" /> Dashboard</Link>
          </Button>
          <div>
            <h1 className="text-2xl font-bold">Sheets Health</h1>
            <p className="text-sm text-muted-foreground">
              Bind each client to their KPI sheet and verify connectivity.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant="outline">{stats.bound}/{stats.total} bound</Badge>
          {lastRefreshAt && (
            <span className="text-xs text-muted-foreground">
              Last refresh {lastRefreshAt.toLocaleTimeString()}
            </span>
          )}
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`h-3 w-3 mr-1 ${loading ? 'animate-spin' : ''}`} /> Reload
          </Button>
          <Button variant="outline" size="sm" onClick={testAll} disabled={loading || refreshing}>
            Test all bound
          </Button>
          <Button
            size="sm"
            onClick={refreshAll}
            disabled={loading || refreshing || stats.bound === 0}
            title="Force re-pull all bound sheets and invalidate dashboard caches"
          >
            {refreshing ? (
              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
            ) : (
              <RefreshCw className="h-3 w-3 mr-1" />
            )}
            Refresh now
          </Button>
        </div>
      </div>

      <div className="border rounded-lg p-4 space-y-3 bg-muted/20">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Wand2 className="h-4 w-4" />
            <h2 className="font-semibold">Bulk paste — match clients to sheets</h2>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline">{matchedCount}/{bulkMatches.length} matched</Badge>
            <Button size="sm" onClick={applyBulk} disabled={bulkBusy || matchedCount === 0}>
              {bulkBusy ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
              Save {matchedCount} matched
            </Button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          One client per line. Format: <code>Client Name &lt;TAB or comma&gt; Sheet ID or URL</code>.
          Pre-filled from your master roster.
        </p>
        <Textarea
          value={bulkText}
          onChange={(e) => setBulkText(e.target.value)}
          rows={8}
          className="font-mono text-xs"
        />
        {bulkMatches.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-1 text-xs">
            {bulkMatches.map((m, i) => (
              <div key={i} className="flex items-center justify-between gap-2 px-2 py-1 rounded border bg-background">
                <span className="truncate">{m.name}</span>
                {m.client ? (
                  <span className="inline-flex items-center gap-1 text-emerald-700">
                    <CheckCircle2 className="h-3 w-3" /> {m.client.name}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-destructive">
                    <XCircle className="h-3 w-3" /> no client match
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="px-3 py-2 font-medium">Client</th>
              <th className="px-3 py-2 font-medium w-[40%]">Sheet URL</th>
              <th className="px-3 py-2 font-medium">Default</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.client_id} className="border-t">
                <td className="px-3 py-2">
                  <Link to={`/clients/${r.client_id}`} className="font-medium hover:underline">
                    {r.name}
                  </Link>
                  <div className="text-[10px] uppercase text-muted-foreground">{r.status}</div>
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <Input
                      value={r.draftUrl ?? ''}
                      placeholder="Paste sheet URL…"
                      onChange={(e) => patch(r.client_id, { draftUrl: e.target.value })}
                      className="h-8 text-xs"
                    />
                    {r.sheet_id && (
                      <a
                        href={`https://docs.google.com/spreadsheets/d/${r.sheet_id}/edit`}
                        target="_blank" rel="noreferrer"
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                </td>
                <td className="px-3 py-2">
                  {r.default_source === 'sheet'
                    ? <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300">Sheet</Badge>
                    : r.default_source === 'database'
                      ? <Badge variant="outline">Database</Badge>
                      : <span className="text-xs text-muted-foreground">—</span>}
                </td>
                <td className="px-3 py-2">
                  {r.testing ? (
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                      <Loader2 className="h-3 w-3 animate-spin" /> testing
                    </span>
                  ) : r.test?.ok ? (
                    <span
                      className="inline-flex items-center gap-1 text-xs text-emerald-700"
                      title={[
                        r.test.tabsUsed?.length ? `Used: ${r.test.tabsUsed.join(', ')}` : '',
                        r.test.tabsSkipped?.length ? `Skipped: ${r.test.tabsSkipped.map(t => `${t.title} (${t.reason})`).join(', ')}` : '',
                      ].filter(Boolean).join('\n')}
                    >
                      <CheckCircle2 className="h-3 w-3" /> {r.test.rows} rows ·{' '}
                      {r.test.tabsUsed?.length ? `${r.test.tabsUsed.length} tabs` : r.test.tab} ·{' '}
                      {r.test.ms}ms
                    </span>
                  ) : r.test?.ok === false ? (
                    <span className="inline-flex items-center gap-1 text-xs text-destructive" title={r.test.error}>
                      <XCircle className="h-3 w-3" /> {r.test.error?.slice(0, 60) ?? 'failed'}
                    </span>
                  ) : !r.sheet_id ? (
                    <span className="text-xs text-muted-foreground">not bound</span>
                  ) : (
                    <span className="text-xs text-muted-foreground">unchecked</span>
                  )}
                </td>
                <td className="px-3 py-2 text-right space-x-2">
                  <Button size="sm" variant="ghost" onClick={() => testRow(r)} disabled={!r.sheet_id || r.testing}>
                    Test
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => refreshRow(r)}
                    disabled={!r.sheet_id || r.refreshing || r.testing}
                    title={
                      r.lastRefreshAt
                        ? `Last refreshed ${r.lastRefreshAt.toLocaleTimeString()}`
                        : 'Force re-pull this client from Google Sheets'
                    }
                  >
                    {r.refreshing ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <>
                        <RefreshCw className="h-3 w-3 mr-1" /> Refresh
                      </>
                    )}
                  </Button>
                  <Button size="sm" onClick={() => saveRow(r)} disabled={r.saving || !r.draftUrl}>
                    {r.saving ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Save'}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}