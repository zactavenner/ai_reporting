import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { ArrowLeft, CheckCircle2, ExternalLink, Loader2, RefreshCw, XCircle } from 'lucide-react';

type Row = {
  client_id: string;
  name: string;
  status: string;
  sheet_id: string | null;
  sheet_gid: string | null;
  default_source: 'sheet' | 'database' | null;
  test?: { ok: boolean; rows: number; tab?: string; error?: string; ms?: number };
  testing?: boolean;
  draftUrl?: string;
  saving?: boolean;
};

function extractSheetId(url: string): { sheetId: string | null; gid: string | null } {
  const m = url.match(/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  const sheetId = m ? m[1] : null;
  const gidMatch = url.match(/[?#&]gid=(\d+)/);
  return { sheetId, gid: gidMatch ? gidMatch[1] : null };
}

export default function SheetsHealthPage() {
  const { toast } = useToast();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

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
        test: { ok: true, rows: (data as any)?.rowCount ?? 0, tab: (data as any)?.sheetTitle, ms: Date.now() - t0 },
      });
    } catch (e: any) {
      patch(r.client_id, { testing: false, test: { ok: false, rows: 0, error: e?.message ?? 'failed', ms: Date.now() - t0 } });
    }
  }

  async function testAll() {
    const bound = rows.filter((r) => r.sheet_id);
    for (const r of bound) await testRow(r);
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
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`h-3 w-3 mr-1 ${loading ? 'animate-spin' : ''}`} /> Reload
          </Button>
          <Button size="sm" onClick={testAll} disabled={loading}>Test all bound</Button>
        </div>
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
                    <span className="inline-flex items-center gap-1 text-xs text-emerald-700">
                      <CheckCircle2 className="h-3 w-3" /> {r.test.rows} rows · {r.test.tab} · {r.test.ms}ms
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