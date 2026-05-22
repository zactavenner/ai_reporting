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
import { Sparkles, RefreshCw, CheckCircle2, AlertCircle, Database as DbIcon, Settings2 } from 'lucide-react';
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
        body: { client_id: clientId, limit: 50, offset: 0 },
      });
      if (error) throw error;
      toast.success(`${name}: enriched ${data?.succeeded ?? 0}, failed ${data?.failed ?? 0}`);
      refetch();
    } catch (e: any) {
      toast.error(`Bulk enrich failed: ${e.message}`);
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

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Sparkles className="h-6 w-6 text-primary" /> Lead Enrichment (RetargetIQ)
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Every new lead is automatically enriched with financial data and a clean summary note is pushed to the GHL contact.
            A background sweep runs every 15 minutes for every client with Auto-Enrich ON.
          </p>
        </div>
        <Button onClick={runAutoEnrichAll} disabled={runAllLoading}>
          {runAllLoading ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
          Run Auto-Enrich Now
        </Button>
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
          <p>3. Every new GHL lead is auto-enriched in the background and a financial summary note is posted back to the GHL contact.</p>
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
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!fullOk || bulkRunning === r.id}
                        onClick={() => runBulkEnrich(r.id, r.name)}
                      >
                        {bulkRunning === r.id ? <RefreshCw className="h-3 w-3 mr-1 animate-spin" /> : <DbIcon className="h-3 w-3 mr-1" />}
                        Bulk Enrich 50
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}