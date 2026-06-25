import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ExternalLink, FileSpreadsheet, Loader2, AlertTriangle, RefreshCw, Plus } from 'lucide-react';

const MASTER_TEMPLATE_URL =
  'https://docs.google.com/spreadsheets/d/1tm-qpPRzv38JtIL9-KvZVThqTk4OJcWv3duw8H2KHhY/edit';

// KPI categories the user can map to a specific tab in the client's sheet.
// Keys are stored under client_settings.metrics_sheet_mapping.tabs
const KPI_TABS: { key: string; label: string; hint: string }[] = [
  { key: 'kpi_scorecard', label: 'KPI Scorecard (totals)', hint: 'e.g. SCORECARD-26' },
  { key: 'leads', label: 'Leads', hint: 'e.g. Leads' },
  { key: 'discovery_calls', label: 'Discovery Calls', hint: 'e.g. Discovery Call' },
  { key: 'reconnect_calls', label: 'Reconnect Calls', hint: 'e.g. Reconnect Call' },
  { key: 'commitments', label: 'Commitments', hint: 'e.g. Committed Investors' },
  { key: 'funded_investors', label: 'Funded Investors', hint: 'e.g. Funded Investors' },
  { key: 'ad_spend', label: 'Ad Spend / Daily', hint: 'e.g. Ads or Daily Spend' },
];

// KPI field → sheet column header override.
// Stored under client_settings.metrics_sheet_mapping.columns and passed into
// fetch-sheet-metrics as the `mapping` arg so CPL/leads/calls/funded/ad-perf
// metrics are read from the correct columns even when the client's sheet uses
// non-standard header names.
const KPI_COLUMNS: { key: string; label: string; hint: string }[] = [
  { key: 'date', label: 'Date', hint: 'e.g. Date, Day' },
  { key: 'ad_spend', label: 'Ad Spend', hint: 'e.g. Spend, Amount Spent' },
  { key: 'impressions', label: 'Impressions', hint: 'e.g. Impressions' },
  { key: 'clicks', label: 'Clicks', hint: 'e.g. Link Clicks' },
  { key: 'leads', label: 'Leads', hint: 'e.g. Leads' },
  { key: 'spam_leads', label: 'Spam / Bad Leads', hint: 'e.g. Spam' },
  { key: 'calls', label: 'Calls Booked', hint: 'e.g. Booked Calls' },
  { key: 'showed_calls', label: 'Calls Showed', hint: 'e.g. Showed' },
  { key: 'reconnect_calls', label: 'Reconnect Calls', hint: 'e.g. Reconnects' },
  { key: 'reconnect_showed', label: 'Reconnect Showed', hint: 'e.g. Reconnect Showed' },
  { key: 'commitments', label: 'Commitments (#)', hint: 'e.g. Committed' },
  { key: 'commitment_dollars', label: 'Commitment $', hint: 'e.g. Committed $' },
  { key: 'funded_investors', label: 'Funded Investors (#)', hint: 'e.g. Funded' },
  { key: 'funded_dollars', label: 'Funded $', hint: 'e.g. Capital Raised' },
];

interface Props {
  clientId: string;
  clientName?: string;
}

function extractSheetId(url: string): { sheetId: string | null; gid: string | null } {
  const m = url.match(/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  const sheetId = m ? m[1] : null;
  const gidMatch = url.match(/[?#&]gid=(\d+)/);
  return { sheetId, gid: gidMatch ? gidMatch[1] : null };
}

export function ClientSheetBindingCard({ clientId, clientName }: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [url, setUrl] = useState('');
  const [defaultSource, setDefaultSource] = useState<'sheet' | 'database'>('sheet');
  const [tabs, setTabs] = useState<string[] | null>(null);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [bound, setBound] = useState<{ id: string | null; gid: string | null }>({ id: null, gid: null });
  const [error, setError] = useState<string | null>(null);
  const [allTabs, setAllTabs] = useState<{ gid: string; title: string }[]>([]);
  const [loadingTabs, setLoadingTabs] = useState(false);
  const [tabMap, setTabMap] = useState<Record<string, string>>({});
  const [colMap, setColMap] = useState<Record<string, string>>({});
  const [colSampleGid, setColSampleGid] = useState<string | undefined>(undefined);
  const [headerOptions, setHeaderOptions] = useState<string[]>([]);
  const [loadingHeaders, setLoadingHeaders] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('client_settings')
        .select('metrics_sheet_id, metrics_sheet_gid, metrics_source_default, metrics_sheet_mapping')
        .eq('client_id', clientId)
        .maybeSingle();
      if (data?.metrics_sheet_id) {
        const built = `https://docs.google.com/spreadsheets/d/${data.metrics_sheet_id}/edit${data.metrics_sheet_gid ? `#gid=${data.metrics_sheet_gid}` : ''}`;
        setUrl(built);
        setBound({ id: data.metrics_sheet_id, gid: data.metrics_sheet_gid ?? null });
        setColSampleGid(data.metrics_sheet_gid ?? undefined);
      }
      if (data?.metrics_source_default === 'database' || data?.metrics_source_default === 'sheet') {
        setDefaultSource(data.metrics_source_default);
      }
      const mapping: any = (data as any)?.metrics_sheet_mapping || {};
      if (mapping?.tabs && typeof mapping.tabs === 'object') {
        setTabMap(mapping.tabs as Record<string, string>);
      }
      if (mapping?.columns && typeof mapping.columns === 'object') {
        setColMap(mapping.columns as Record<string, string>);
      }
    })();
  }, [clientId]);

  async function loadTabs(sheetIdArg?: string) {
    const id = sheetIdArg || bound.id || extractSheetId(url).sheetId;
    if (!id) return;
    setLoadingTabs(true);
    try {
      const { data, error } = await supabase.functions.invoke('fetch-sheet-metrics', {
        body: { sheet_id: id, action: 'list_tabs' },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      setAllTabs(((data as any)?.tabs || []) as { gid: string; title: string }[]);
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Could not load tabs', description: e?.message ?? 'Unknown error' });
    } finally {
      setLoadingTabs(false);
    }
  }

  // Auto-load tabs once a sheet is bound
  useEffect(() => {
    if (bound.id && allTabs.length === 0) loadTabs(bound.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bound.id]);

  async function loadHeaders(gidArg?: string) {
    if (!bound.id) return;
    setLoadingHeaders(true);
    try {
      const { data, error } = await supabase.functions.invoke('fetch-sheet-metrics', {
        body: { sheet_id: bound.id, gid: gidArg || colSampleGid || bound.gid || undefined, action: 'raw_grid' },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      const hdrs: string[] = (((data as any)?.headers || []) as any[])
        .map((h) => String(h ?? '').trim())
        .filter((h) => h.length > 0);
      setHeaderOptions(hdrs);
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Could not load column headers', description: e?.message ?? 'Unknown error' });
    } finally {
      setLoadingHeaders(false);
    }
  }

  // Auto-load headers when a sample tab is chosen / sheet is bound
  useEffect(() => {
    if (bound.id && headerOptions.length === 0) loadHeaders(colSampleGid || bound.gid || undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bound.id, colSampleGid]);

  async function handleTest() {
    setError(null);
    setTabs(null);
    const { sheetId, gid } = extractSheetId(url);
    if (!sheetId) {
      setError('Could not detect a Google Sheet ID in that URL.');
      return;
    }
    setTesting(true);
    try {
      const { data, error } = await supabase.functions.invoke('fetch-sheet-metrics', {
        body: { sheet_id: sheetId, gid: gid || undefined },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      setTabs([(data as any)?.sheetTitle].filter(Boolean));
      toast({ title: 'Connected', description: `Sheet "${(data as any)?.sheetTitle ?? 'unknown'}" reachable.` });
      loadTabs(sheetId);
    } catch (e: any) {
      setError(e?.message || 'Failed to read sheet');
    } finally {
      setTesting(false);
    }
  }

  async function handleSave() {
    const { sheetId, gid } = extractSheetId(url);
    if (!sheetId) {
      toast({ variant: 'destructive', title: 'Invalid URL', description: 'Paste a Google Sheets link first.' });
      return;
    }
    setSaving(true);
    try {
      const { data: existing } = await supabase
        .from('client_settings').select('id, metrics_sheet_mapping').eq('client_id', clientId).maybeSingle();
      const prevMapping: any = (existing as any)?.metrics_sheet_mapping || {};
      const nextMapping = { ...prevMapping, tabs: tabMap, columns: colMap };
      const payload: any = {
        client_id: clientId,
        metrics_sheet_id: sheetId,
        metrics_sheet_gid: gid,
        metrics_source_default: defaultSource,
        metrics_sheet_mapping: nextMapping,
      };
      const { error } = existing
        ? await supabase.from('client_settings').update(payload).eq('client_id', clientId)
        : await supabase.from('client_settings').insert(payload);
      if (error) throw error;
      setBound({ id: sheetId, gid });
      qc.invalidateQueries({ queryKey: ['client-settings', clientId] });
      qc.invalidateQueries({ queryKey: ['sheet-metrics'] });
      toast({ title: 'Saved', description: 'Sheet bound to this client.' });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Save failed', description: e?.message ?? 'Unknown error' });
    } finally {
      setSaving(false);
    }
  }

  async function handleClear() {
    setSaving(true);
    try {
      const { error } = await supabase
        .from('client_settings')
        .update({ metrics_sheet_id: null, metrics_sheet_gid: null, metrics_source_default: 'database' } as any)
        .eq('client_id', clientId);
      if (error) throw error;
      setUrl('');
      setBound({ id: null, gid: null });
      setTabs(null);
      qc.invalidateQueries({ queryKey: ['client-settings', clientId] });
      toast({ title: 'Cleared', description: 'Sheet unbound from this client.' });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Failed', description: e?.message ?? 'Unknown error' });
    } finally {
      setSaving(false);
    }
  }

  async function handleCreate() {
    setCreating(true);
    setError(null);
    try {
      const { data, error } = await supabase.functions.invoke('create-client-sheet', {
        body: { client_name: clientName || 'Client' },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      const newUrl = (data as any)?.url as string;
      const newId = (data as any)?.sheet_id as string;
      if (!newUrl || !newId) throw new Error('No sheet returned');
      setUrl(newUrl);
      toast({
        title: 'Sheet created',
        description: 'A copy of the master template was created. Click Save to bind it to this client.',
      });
      // Pre-fill bound state in UI; Save will persist it.
      window.open(newUrl, '_blank', 'noopener,noreferrer');
    } catch (e: any) {
      const msg = e?.message ?? 'Could not create sheet';
      setError(msg);
      toast({ variant: 'destructive', title: 'Create failed', description: msg });
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="border-2 border-border p-4 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h4 className="font-medium mb-1 flex items-center gap-2">
            <FileSpreadsheet className="h-4 w-4 text-emerald-600" />
            Data Source — Google Sheet
          </h4>
          <p className="text-sm text-muted-foreground">
            Bind this client to their copy of the master KPI sheet. The dashboard will read live from the sheet
            instead of the database.
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline" size="sm">
            <a href={MASTER_TEMPLATE_URL} target="_blank" rel="noreferrer">
              <ExternalLink className="h-3 w-3 mr-1" /> Master template
            </a>
          </Button>
          {!bound.id && (
            <Button variant="default" size="sm" onClick={handleCreate} disabled={creating}>
              {creating ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Plus className="h-3 w-3 mr-1" />}
              Create new sheet
            </Button>
          )}
        </div>
      </div>

      {!bound.id && (
        <div className="rounded-md bg-muted/40 border border-border p-3 text-xs text-muted-foreground">
          No sheet yet? Click <span className="font-medium">Create new sheet</span> — we'll copy the master KPI
          template into Google Drive, name it for this client, and open it in a new tab. Then click
          <span className="font-medium"> Save</span> below to bind it.
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="sheet-url">Client sheet URL</Label>
        <div className="flex gap-2">
          <Input
            id="sheet-url"
            placeholder="https://docs.google.com/spreadsheets/d/..."
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <Button variant="outline" onClick={handleTest} disabled={!url || testing}>
            {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Test'}
          </Button>
        </div>
        {bound.id && (
          <div className="flex items-center gap-2 text-xs text-emerald-700">
            <CheckCircle2 className="h-3 w-3" />
            Bound — sheet ID <code className="text-[10px]">{bound.id.slice(0, 12)}…</code>
          </div>
        )}
        {tabs && tabs.length > 0 && (
          <div className="text-xs text-muted-foreground">
            Detected tab: <span className="font-medium">{tabs[0]}</span>
          </div>
        )}
        {error && (
          <div className="flex items-center gap-2 text-xs text-destructive">
            <AlertTriangle className="h-3 w-3" /> {error}
          </div>
        )}
      </div>

      <div className="space-y-2">
        <Label>Default source for this client</Label>
        <RadioGroup value={defaultSource} onValueChange={(v) => setDefaultSource(v as any)} className="flex gap-6">
          <div className="flex items-center gap-2">
            <RadioGroupItem value="sheet" id="src-sheet" />
            <Label htmlFor="src-sheet" className="font-normal">Sheet (recommended)</Label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem value="database" id="src-db" />
            <Label htmlFor="src-db" className="font-normal">Database</Label>
          </div>
        </RadioGroup>
      </div>

      {bound.id && (
        <div className="space-y-3 pt-3 border-t border-border">
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm">Tab mapping</Label>
              <p className="text-xs text-muted-foreground">
                Choose which tab in this client's sheet feeds each KPI. Leave blank to use defaults.
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => loadTabs()} disabled={loadingTabs}>
              {loadingTabs ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
              <span className="ml-1">Reload tabs</span>
            </Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {KPI_TABS.map((kpi) => (
              <div key={kpi.key} className="space-y-1">
                <Label htmlFor={`tab-${kpi.key}`} className="text-xs font-medium">{kpi.label}</Label>
                <Select
                  value={tabMap[kpi.key] ?? '__none__'}
                  onValueChange={(v) =>
                    setTabMap((prev) => {
                      const next = { ...prev };
                      if (v === '__none__') delete next[kpi.key];
                      else next[kpi.key] = v;
                      return next;
                    })
                  }
                >
                  <SelectTrigger id={`tab-${kpi.key}`} className="h-8 text-xs">
                    <SelectValue placeholder={kpi.hint} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— Auto / default —</SelectItem>
                    {allTabs.map((t) => (
                      <SelectItem key={t.gid} value={t.title}>{t.title}</SelectItem>
                    ))}
                    {/* Allow keeping a previously-saved value even if the tab is missing */}
                    {tabMap[kpi.key] && !allTabs.some((t) => t.title === tabMap[kpi.key]) && (
                      <SelectItem value={tabMap[kpi.key]}>
                        {tabMap[kpi.key]} (not found)
                      </SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>
          {allTabs.length === 0 && !loadingTabs && (
            <p className="text-xs text-muted-foreground">
              No tabs loaded yet. Click "Reload tabs" to fetch this sheet's tab list.
            </p>
          )}
        </div>
      )}

      <div className="flex justify-between items-center pt-2 border-t border-border">
        <p className="text-xs text-muted-foreground">
          Share each sheet with the connector account so it has read access.
        </p>
        <div className="flex gap-2">
          {bound.id && (
            <Button variant="ghost" size="sm" onClick={handleClear} disabled={saving}>
              Unbind
            </Button>
          )}
          <Button size="sm" onClick={handleSave} disabled={saving || !url}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
          </Button>
        </div>
      </div>
    </div>
  );
}