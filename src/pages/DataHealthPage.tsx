import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Loader2, RefreshCw, AlertCircle, CheckCircle2, PlayCircle, Save } from 'lucide-react';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';

const sb = supabase as any;

interface HealthRow {
  client_id: string;
  client_name: string;
  ad_account_id: string;
  last_status: string | null;
  error_message: string | null;
  rows_written: number | null;
  sheet_status: string | null;
  sheet_error: string | null;
  last_run_at: string | null;
  last_success_at: string | null;
  last_date: string | null;
  last_synced_at: string | null;
  is_stale: boolean;
}

interface RunRow {
  id: string;
  status: string;
  rows_written: number | null;
  started_at: string;
  finished_at: string | null;
  triggered_by: string;
  sheet_status: string | null;
}

function StatusBadge({ status }: { status: string | null }) {
  if (!status) return <Badge variant="outline">never</Badge>;
  const map: Record<string, string> = {
    success: 'bg-emerald-500/15 text-emerald-600 border-emerald-500/20',
    partial: 'bg-amber-500/15 text-amber-600 border-amber-500/20',
    error: 'bg-red-500/15 text-red-600 border-red-500/20',
    running: 'bg-blue-500/15 text-blue-600 border-blue-500/20',
  };
  return <Badge className={map[status] ?? ''} variant="outline">{status}</Badge>;
}

export default function DataHealthPage() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<HealthRow[]>([]);
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [runningRow, setRunningRow] = useState<string | null>(null);
  const [date, setDate] = useState<string>(() => {
    const d = new Date(); d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  });
  const [sheetUrl, setSheetUrl] = useState('');
  const [settingsId, setSettingsId] = useState<string | null>(null);
  const [savingSheet, setSavingSheet] = useState(false);

  async function load() {
    setLoading(true);
    const [health, runsRes, settingsRes] = await Promise.all([
      sb.from('v_ad_spend_health').select('*').order('client_name'),
      sb.from('ad_spend_sync_runs').select('id,status,rows_written,started_at,finished_at,triggered_by,sheet_status').order('started_at', { ascending: false }).limit(50),
      sb.from('agency_settings').select('id,meta_spend_sheet_url').limit(1).maybeSingle(),
    ]);
    if (health.data) setRows(health.data as HealthRow[]);
    if (runsRes.data) setRuns(runsRes.data as RunRow[]);
    if (settingsRes.data) {
      setSettingsId(settingsRes.data.id);
      setSheetUrl(settingsRes.data.meta_spend_sheet_url ?? '');
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function saveSheet() {
    if (!settingsId) return;
    setSavingSheet(true);
    const { error } = await sb.from('agency_settings').update({ meta_spend_sheet_url: sheetUrl || null }).eq('id', settingsId);
    setSavingSheet(false);
    if (error) toast.error(error.message); else toast.success('Sheet URL saved');
  }

  async function triggerSync(clientId?: string) {
    if (clientId) setRunningRow(clientId); else setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke('sync-meta-ad-spend', {
        body: { mode: 'manual', date, ...(clientId ? { client_id: clientId } : {}) },
      });
      if (error) throw error;
      const s = (data as any)?.summary;
      toast.success(`Sync done: ${s?.ok ?? 0} ok, ${s?.failed ?? 0} failed, ${s?.total_rows ?? 0} rows`);
      await load();
    } catch (e: any) {
      toast.error(e.message ?? 'Sync failed');
    } finally {
      setRunningRow(null); setSyncing(false);
    }
  }

  const summary = useMemo(() => {
    const stale = rows.filter(r => r.is_stale).length;
    const err = rows.filter(r => r.last_status === 'error').length;
    return { total: rows.length, stale, err };
  }, [rows]);

  const lastRun = runs[0];

  return (
    <div className="container mx-auto p-6 space-y-6 max-w-7xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Data Health</h1>
          <p className="text-sm text-muted-foreground">Meta ad spend pipeline · Supabase + Google Sheets mirror</p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Active ad accounts</div>
          <div className="text-2xl font-semibold mt-1">{summary.total}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Stale (&gt;36h)</div>
          <div className={`text-2xl font-semibold mt-1 ${summary.stale > 0 ? 'text-red-600' : ''}`}>{summary.stale}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Errored last run</div>
          <div className={`text-2xl font-semibold mt-1 ${summary.err > 0 ? 'text-red-600' : ''}`}>{summary.err}</div>
        </Card>
      </div>

      <Card className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div className="font-medium">Manual sync</div>
            <div className="text-xs text-muted-foreground">Runs all active accounts for the selected date. Daily cron runs at 09:00 UTC.</div>
          </div>
          <div className="flex items-center gap-2">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-40" />
            <Button onClick={() => triggerSync()} disabled={syncing}>
              {syncing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <PlayCircle className="h-4 w-4 mr-2" />}
              Sync now
            </Button>
          </div>
        </div>
        {lastRun && (
          <div className="text-xs text-muted-foreground">
            Last run: <StatusBadge status={lastRun.status} /> {formatDistanceToNow(new Date(lastRun.started_at), { addSuffix: true })} · {lastRun.rows_written ?? 0} rows · {lastRun.triggered_by}
          </div>
        )}
      </Card>

      <Card className="p-4 space-y-3">
        <div className="font-medium">Google Sheet mirror</div>
        <div className="text-xs text-muted-foreground">Paste the Sheet URL. Rows will be written to a "Daily Spend" tab (deduped on Date + Campaign).</div>
        <div className="flex gap-2">
          <Input placeholder="https://docs.google.com/spreadsheets/d/…" value={sheetUrl} onChange={(e) => setSheetUrl(e.target.value)} />
          <Button onClick={saveSheet} disabled={savingSheet || !settingsId}>
            {savingSheet ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />} Save
          </Button>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="p-4 border-b">
          <div className="font-medium">Per-account health</div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="text-left p-3">Client</th>
                <th className="text-left p-3">Account</th>
                <th className="text-left p-3">Last success</th>
                <th className="text-left p-3">Status</th>
                <th className="text-left p-3">Rows</th>
                <th className="text-left p-3">Sheet</th>
                <th className="text-left p-3">Error</th>
                <th className="text-right p-3">Action</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={8} className="p-6 text-center text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin inline mr-2" />Loading…</td></tr>
              )}
              {!loading && rows.length === 0 && (
                <tr><td colSpan={8} className="p-6 text-center text-muted-foreground">No active client ad accounts found.</td></tr>
              )}
              {rows.map((r) => (
                <tr key={`${r.client_id}-${r.ad_account_id}`} className={`border-t ${r.is_stale ? 'bg-red-500/5' : ''}`}>
                  <td className="p-3 font-medium flex items-center gap-2">
                    {r.is_stale ? <AlertCircle className="h-4 w-4 text-red-600" /> : <CheckCircle2 className="h-4 w-4 text-emerald-600" />}
                    {r.client_name}
                  </td>
                  <td className="p-3 font-mono text-xs">{r.ad_account_id}</td>
                  <td className="p-3 text-xs">{r.last_success_at ? formatDistanceToNow(new Date(r.last_success_at), { addSuffix: true }) : <span className="text-muted-foreground">never</span>}</td>
                  <td className="p-3"><StatusBadge status={r.last_status} /></td>
                  <td className="p-3 tabular-nums">{r.rows_written ?? 0}</td>
                  <td className="p-3"><StatusBadge status={r.sheet_status} /></td>
                  <td className="p-3 text-xs text-red-600 max-w-[280px] truncate" title={r.error_message ?? r.sheet_error ?? ''}>
                    {r.error_message ?? r.sheet_error ?? ''}
                  </td>
                  <td className="p-3 text-right">
                    <Button size="sm" variant="outline" onClick={() => triggerSync(r.client_id)} disabled={!!runningRow}>
                      {runningRow === r.client_id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Retry'}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}