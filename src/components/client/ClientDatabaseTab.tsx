import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, Download, RefreshCw, Sparkles, ChevronDown, ChevronUp } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { fetchAllRows } from '@/lib/fetchAllRows';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface DBLead {
  id: string;
  external_id: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  source: string | null;
  status: string | null;
  is_spam: boolean | null;
  created_at: string;
  custom_fields: Record<string, unknown> | null;
  ghl_notes: unknown;
  campaign_name: string | null;
  opportunity_stage: string | null;
  opportunity_value: number | null;
}

type DBEnrichment = Record<string, any> & {
  lead_id: string | null;
  external_id: string | null;
  enriched_at: string | null;
  source: string | null;
  net_worth: number | null;
};

interface DBCall {
  id: string;
  lead_id: string | null;
  external_id: string;
  booked_at: string | null;
  showed: boolean | null;
  showed_at: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  created_at: string;
}

interface DBFunded {
  id: string;
  lead_id: string | null;
  external_id: string;
  name: string | null;
  funded_amount: number;
  commitment_amount: number | null;
  funded_at: string;
  source: string | null;
}

type TabKey = 'leads' | 'booked' | 'showed' | 'committed' | 'funded';

const ENRICH_META_FIELDS = new Set([
  'id', 'client_id', 'lead_id', 'external_id', 'created_at', 'updated_at',
  'enriched_at', 'source', 'raw_response', 'raw_payload', 'raw_data',
]);

function hasEnrichmentMatch(e: DBEnrichment | null): boolean {
  if (!e) return false;
  for (const [k, v] of Object.entries(e)) {
    if (ENRICH_META_FIELDS.has(k)) continue;
    if (v === null || v === undefined || v === '') continue;
    if (Array.isArray(v) && v.length === 0) continue;
    if (typeof v === 'object' && !Array.isArray(v) && Object.keys(v as object).length === 0) continue;
    return true;
  }
  return false;
}
type DatePreset = 'yesterday' | 'today' | 'last7' | 'last30' | 'mtd' | 'all' | 'custom';

function ymd(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function presetRange(p: DatePreset): { start: string; end: string } | null {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const y = new Date(today); y.setDate(y.getDate() - 1);
  if (p === 'all') return null;
  if (p === 'today') return { start: ymd(today), end: ymd(today) };
  if (p === 'yesterday') return { start: ymd(y), end: ymd(y) };
  if (p === 'last7') { const s = new Date(today); s.setDate(s.getDate() - 6); return { start: ymd(s), end: ymd(today) }; }
  if (p === 'last30') { const s = new Date(today); s.setDate(s.getDate() - 29); return { start: ymd(s), end: ymd(today) }; }
  if (p === 'mtd') { const s = new Date(now.getFullYear(), now.getMonth(), 1); return { start: ymd(s), end: ymd(today) }; }
  return null;
}

interface UnifiedRow {
  key: string;
  leadId: string | null;
  externalId: string | null;
  name: string;
  email: string;
  phone: string;
  source: string;
  createdAt: string;
  deploymentAmount: number;
  lead: DBLead | null;
  enrichment: DBEnrichment | null;
}

function extractTags(cf: Record<string, unknown> | null): string[] {
  if (!cf) return [];
  const t = (cf as any).tags ?? (cf as any).Tags;
  if (Array.isArray(t)) return t.map(String);
  if (typeof t === 'string') return t.split(',').map(s => s.trim()).filter(Boolean);
  return [];
}

function extractNotes(notes: unknown): string {
  if (!notes) return '';
  if (Array.isArray(notes)) {
    return notes.map((n: any) => (typeof n === 'string' ? n : (n?.body || n?.note || ''))).filter(Boolean).join(' • ');
  }
  if (typeof notes === 'string') return notes;
  if (typeof notes === 'object') return (notes as any).body || JSON.stringify(notes).slice(0, 200);
  return '';
}

export function ClientDatabaseTab({ clientId, clientName }: { clientId: string; clientName: string }) {
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [enrichedOnly, setEnrichedOnly] = useState(false);
  const [tab, setTab] = useState<TabKey>('leads');
  const [datePreset, setDatePreset] = useState<DatePreset>('yesterday');
  const [customStart, setCustomStart] = useState<string>('');
  const [customEnd, setCustomEnd] = useState<string>('');

  const dateRange = useMemo(() => {
    if (datePreset === 'custom') {
      if (!customStart && !customEnd) return null;
      return { start: customStart || '0000-01-01', end: customEnd || '9999-12-31' };
    }
    return presetRange(datePreset);
  }, [datePreset, customStart, customEnd]);

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['client-database', clientId],
    queryFn: async () => {
      const [leads, enrichments, calls, funded] = await Promise.all([
        fetchAllRows<DBLead>((sb) =>
          sb.from('leads').select('id,external_id,name,email,phone,source,status,is_spam,created_at,custom_fields,ghl_notes,campaign_name,opportunity_stage,opportunity_value').eq('client_id', clientId).order('created_at', { ascending: false })
        ),
        fetchAllRows<DBEnrichment>((sb) =>
          sb.from('lead_enrichment').select('*').eq('client_id', clientId)
        ),
        fetchAllRows<DBCall>((sb) =>
          sb.from('calls').select('id,lead_id,external_id,booked_at,showed,showed_at,contact_name,contact_email,contact_phone,created_at').eq('client_id', clientId).order('created_at', { ascending: false })
        ),
        fetchAllRows<DBFunded>((sb) =>
          sb.from('funded_investors').select('id,lead_id,external_id,name,funded_amount,commitment_amount,funded_at,source').eq('client_id', clientId).order('funded_at', { ascending: false })
        ),
      ]);
      const byLeadId = new Map<string, DBEnrichment>();
      const byExtId = new Map<string, DBEnrichment>();
      for (const e of enrichments) {
        if (e.lead_id) byLeadId.set(e.lead_id, e);
        if (e.external_id) byExtId.set(e.external_id, e);
      }
      const leadsById = new Map(leads.map(l => [l.id, l]));
      const findEnrich = (leadId: string | null, extId: string | null) =>
        (leadId && byLeadId.get(leadId)) || (extId && byExtId.get(extId)) || null;
      const findLead = (leadId: string | null, extId: string | null) =>
        (leadId && leadsById.get(leadId)) || leads.find(l => extId && l.external_id === extId) || null;
      return { leads, enrichments, calls, funded, findEnrich, findLead };
    },
  });

  const allRows: UnifiedRow[] = useMemo(() => {
    if (!data) return [];
    const { leads, calls, funded, findEnrich, findLead } = data;
    if (tab === 'leads') {
      return leads.map(l => ({
        key: 'l-' + l.id,
        leadId: l.id,
        externalId: l.external_id,
        name: l.name || 'Unknown',
        email: l.email || '',
        phone: l.phone || '',
        source: l.source || '',
        createdAt: l.created_at,
        deploymentAmount: Number(l.opportunity_value || 0),
        lead: l,
        enrichment: findEnrich(l.id, l.external_id),
      }));
    }
    if (tab === 'booked' || tab === 'showed') {
      const list = calls.filter(c => tab === 'booked' ? !!c.booked_at : !!c.showed);
      return list.map(c => {
        const lead = findLead(c.lead_id, c.external_id);
        return {
          key: 'c-' + c.id,
          leadId: c.lead_id,
          externalId: c.external_id,
          name: c.contact_name || lead?.name || 'Unknown',
          email: c.contact_email || lead?.email || '',
          phone: c.contact_phone || lead?.phone || '',
          source: lead?.source || '',
          createdAt: (tab === 'showed' ? c.showed_at : c.booked_at) || c.created_at,
          deploymentAmount: Number(lead?.opportunity_value || 0),
          lead,
          enrichment: findEnrich(c.lead_id, c.external_id),
        };
      });
    }
    // committed / funded
    const list = funded.filter(f => tab === 'funded'
      ? Number(f.funded_amount) > 0
      : Number(f.commitment_amount || 0) > 0);
    return list.map(f => {
      const lead = findLead(f.lead_id, f.external_id);
      return {
        key: 'f-' + f.id,
        leadId: f.lead_id,
        externalId: f.external_id,
        name: f.name || lead?.name || 'Unknown',
        email: lead?.email || '',
        phone: lead?.phone || '',
        source: lead?.source || f.source || '',
        createdAt: f.funded_at,
        deploymentAmount: tab === 'funded' ? Number(f.funded_amount) : Number(f.commitment_amount || 0),
        lead,
        enrichment: findEnrich(f.lead_id, f.external_id),
      };
    });
  }, [data, tab]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allRows.filter(r => {
      if (enrichedOnly && !hasEnrichmentMatch(r.enrichment)) return false;
      if (dateRange) {
        const d = (r.createdAt || '').slice(0, 10);
        if (!d) return false;
        if (d < dateRange.start || d > dateRange.end) return false;
      }
      if (!q) return true;
      const hay = [r.name, r.email, r.phone, r.source, r.enrichment?.company_name, r.enrichment?.city, r.enrichment?.state]
        .filter(Boolean).join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [allRows, search, enrichedOnly, dateRange]);

  const enrichedCount = filtered.filter(r => hasEnrichmentMatch(r.enrichment)).length;

  const counts = useMemo(() => {
    if (!data) return { leads: 0, booked: 0, showed: 0, committed: 0, funded: 0 };
    return {
      leads: data.leads.length,
      booked: data.calls.filter(c => !!c.booked_at).length,
      showed: data.calls.filter(c => !!c.showed).length,
      committed: data.funded.filter(f => Number(f.commitment_amount || 0) > 0).length,
      funded: data.funded.filter(f => Number(f.funded_amount) > 0).length,
    };
  }, [data]);

  const exportCsv = () => {
    const headers = ['Created', 'Name', 'Email', 'Phone', 'Source', 'Deployment Amount', 'Net Worth', 'Enriched', 'Enriched At', 'City', 'State', 'Company', 'Title', 'LinkedIn', 'Household Income'];
    const lines = [headers.join(',')];
    for (const r of filtered) {
      const enrichment = r.enrichment;
      const row = [
        r.createdAt, r.name, r.email, r.phone, r.source,
        r.deploymentAmount || '',
        enrichment?.net_worth ?? '',
        enrichment ? 'yes' : 'no',
        enrichment?.enriched_at ?? '',
        enrichment?.city ?? '', enrichment?.state ?? '',
        enrichment?.company_name ?? '', enrichment?.company_title ?? '',
        enrichment?.linkedin_url ?? '', enrichment?.household_income ?? '',
      ];
      lines.push(row.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','));
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${clientName.replace(/\s+/g, '-').toLowerCase()}-${tab}-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const money = (n: number | null | undefined) =>
    n && Number(n) > 0 ? `$${Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '—';

  return (
    <div className="space-y-4">
      <Tabs value={tab} onValueChange={(v) => { setTab(v as TabKey); setExpanded(null); }}>
        <TabsList className="grid grid-cols-5 w-full max-w-2xl">
          <TabsTrigger value="leads">Leads <span className="ml-1.5 text-[10px] opacity-60">{counts.leads.toLocaleString()}</span></TabsTrigger>
          <TabsTrigger value="booked">Booked <span className="ml-1.5 text-[10px] opacity-60">{counts.booked.toLocaleString()}</span></TabsTrigger>
          <TabsTrigger value="showed">Showed <span className="ml-1.5 text-[10px] opacity-60">{counts.showed.toLocaleString()}</span></TabsTrigger>
          <TabsTrigger value="committed">Committed <span className="ml-1.5 text-[10px] opacity-60">{counts.committed.toLocaleString()}</span></TabsTrigger>
          <TabsTrigger value="funded">Funded <span className="ml-1.5 text-[10px] opacity-60">{counts.funded.toLocaleString()}</span></TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card><CardContent className="p-4">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{tab === 'leads' ? 'Total Contacts' : `Total ${tab.charAt(0).toUpperCase() + tab.slice(1)}`}</p>
          <p className="text-2xl font-bold">{filtered.length.toLocaleString()}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Enriched</p>
          <p className="text-2xl font-bold">{enrichedCount.toLocaleString()}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Enrichment %</p>
          <p className="text-2xl font-bold">{filtered.length ? ((enrichedCount / filtered.length) * 100).toFixed(1) : '0'}%</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Total Deployed</p>
          <p className="text-2xl font-bold">{money(filtered.reduce((s, r) => s + (r.deploymentAmount || 0), 0))}</p>
        </CardContent></Card>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Search name, email, phone, company…" value={search} onChange={e => setSearch(e.target.value)} className="pl-9 h-9" />
        </div>
        <Select value={datePreset} onValueChange={(v) => setDatePreset(v as DatePreset)}>
          <SelectTrigger className="h-9 w-[150px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="yesterday">Yesterday</SelectItem>
            <SelectItem value="today">Today</SelectItem>
            <SelectItem value="last7">Last 7 days</SelectItem>
            <SelectItem value="last30">Last 30 days</SelectItem>
            <SelectItem value="mtd">Month to date</SelectItem>
            <SelectItem value="all">All time</SelectItem>
            <SelectItem value="custom">Custom…</SelectItem>
          </SelectContent>
        </Select>
        {datePreset === 'custom' && (
          <>
            <Input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)} className="h-9 w-[150px]" />
            <Input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)} className="h-9 w-[150px]" />
          </>
        )}
        <Button variant={enrichedOnly ? 'default' : 'outline'} size="sm" onClick={() => setEnrichedOnly(v => !v)}>
          <Sparkles className="w-3.5 h-3.5 mr-1.5" /> Enriched only
        </Button>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${isFetching ? 'animate-spin' : ''}`} /> Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={!filtered.length}>
            <Download className="w-3.5 h-3.5 mr-1.5" /> Export CSV ({filtered.length})
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground text-sm">
          <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2" /> Loading contact database…
        </div>
      ) : (
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead>Created</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Source</TableHead>
                <TableHead className="text-right">Deployment</TableHead>
                <TableHead className="text-right">Net Worth</TableHead>
                <TableHead className="text-center">Enrichment</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow><TableCell colSpan={9} className="text-center py-8 text-sm text-muted-foreground">No {tab} found</TableCell></TableRow>
              ) : filtered.slice(0, 500).map((r) => {
                const { lead, enrichment } = r;
                const tags = extractTags(lead?.custom_fields ?? null);
                const notes = extractNotes(lead?.ghl_notes);
                const isOpen = expanded === r.key;
                return (
                  <React.Fragment key={r.key}>
                    <TableRow className="cursor-pointer hover:bg-muted/40" onClick={() => setExpanded(isOpen ? null : r.key)}>
                      <TableCell>{isOpen ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}</TableCell>
                      <TableCell className="text-[10px] text-muted-foreground whitespace-nowrap">{r.createdAt?.split('T')[0]}</TableCell>
                      <TableCell className="font-medium text-sm">{r.name || '—'}</TableCell>
                      <TableCell className="text-xs">{r.email || '—'}</TableCell>
                      <TableCell className="text-xs">{r.phone || '—'}</TableCell>
                      <TableCell className="text-xs">{r.source || '—'}</TableCell>
                      <TableCell className="text-xs text-right tabular-nums">{money(r.deploymentAmount)}</TableCell>
                      <TableCell className="text-xs text-right tabular-nums">{money(enrichment?.net_worth)}</TableCell>
                      <TableCell className="text-center">
                        {(() => {
                          const matched = hasEnrichmentMatch(enrichment);
                          return (
                            <span
                              title={matched ? `Enriched · ${enrichment?.source || ''}` : 'No enrichment match'}
                              className={`inline-block h-2.5 w-2.5 rounded-full ${matched ? 'bg-emerald-500' : 'bg-red-500'}`}
                            />
                          );
                        })()}
                      </TableCell>
                    </TableRow>
                    {isOpen && (
                      <TableRow>
                        <TableCell colSpan={9} className="bg-muted/20 p-0">
                          <ExpandedEnrichment lead={lead} tags={tags} notes={notes} enrichment={enrichment} />
                        </TableCell>
                      </TableRow>
                    )}
                  </React.Fragment>
                );
              })}
            </TableBody>
          </Table>
          {filtered.length > 500 && (
            <div className="p-3 text-center text-[11px] text-muted-foreground border-t">Showing first 500 of {filtered.length.toLocaleString()} — export CSV for the full list.</div>
          )}
        </Card>
      )}
    </div>
  );
}

const EXCLUDE_FIELDS = new Set([
  'id', 'client_id', 'lead_id', 'external_id', 'created_at', 'updated_at',
  'raw_response', 'raw_payload', 'raw_data',
]);

function formatEnrichLabel(k: string) {
  return k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function formatEnrichValue(k: string, v: any): string {
  if (v === null || v === undefined || v === '') return '—';
  if (Array.isArray(v)) return v.length ? v.join(', ') : '—';
  if (typeof v === 'object') { try { return JSON.stringify(v); } catch { return String(v); } }
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'number' && /income|worth|value|salary|price/i.test(k)) {
    return `$${v.toLocaleString()}`;
  }
  return String(v);
}

function ExpandedEnrichment({
  lead, tags, notes, enrichment,
}: {
  lead: DBLead | null;
  tags: string[];
  notes: string;
  enrichment: DBEnrichment | null;
}) {
  const fields = enrichment
    ? Object.entries(enrichment)
        .filter(([k, v]) => !EXCLUDE_FIELDS.has(k) && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0))
    : [];
  return (
    <div className="p-4 space-y-4">
      {lead && (
        <div className="grid md:grid-cols-4 gap-3 text-xs">
          <div><span className="text-muted-foreground">Campaign:</span> {lead.campaign_name || '—'}</div>
          <div><span className="text-muted-foreground">Status:</span> {lead.status || '—'}</div>
          <div><span className="text-muted-foreground">Stage:</span> {lead.opportunity_stage || '—'}</div>
          <div><span className="text-muted-foreground">Value:</span> {lead.opportunity_value ? `$${Number(lead.opportunity_value).toLocaleString()}` : '—'}</div>
          {tags.length > 0 && <div className="md:col-span-4"><span className="text-muted-foreground">Tags:</span> {tags.join(', ')}</div>}
          {notes && <div className="md:col-span-4"><span className="text-muted-foreground">Notes:</span> <span className="whitespace-pre-wrap">{notes}</span></div>}
        </div>
      )}
      <div>
        <p className="font-semibold text-sm mb-2 flex items-center gap-2">
          <Sparkles className="w-3.5 h-3.5 text-emerald-500" /> Full Enrichment
          {enrichment && <Badge variant="outline" className="text-[9px]">{fields.length} fields</Badge>}
        </p>
        {enrichment ? (
          <div className="grid md:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-1.5 text-xs">
            {fields.map(([k, v]) => (
              <div key={k} className="min-w-0">
                <span className="text-muted-foreground">{formatEnrichLabel(k)}:</span>{' '}
                {k === 'linkedin_url' && typeof v === 'string'
                  ? <a href={v} target="_blank" rel="noreferrer" className="text-primary underline break-all">LinkedIn</a>
                  : <span className="break-words">{formatEnrichValue(k, v)}</span>}
              </div>
            ))}
          </div>
        ) : (
          <div className="text-xs text-muted-foreground">No enrichment yet for this contact.</div>
        )}
      </div>
    </div>
  );
}
