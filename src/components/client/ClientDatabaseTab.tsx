import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, Download, RefreshCw, Sparkles, ChevronDown, ChevronUp } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { fetchAllRows } from '@/lib/fetchAllRows';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

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

interface DBEnrichment {
  lead_id: string | null;
  external_id: string | null;
  enriched_at: string | null;
  source: string | null;
  first_name: string | null;
  last_name: string | null;
  city: string | null;
  state: string | null;
  household_income: number | null;
  net_worth: number | null;
  company_name: string | null;
  company_title: string | null;
  linkedin_url: string | null;
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

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['client-database', clientId],
    queryFn: async () => {
      const [leads, enrichments] = await Promise.all([
        fetchAllRows<DBLead>((sb) =>
          sb.from('leads').select('id,external_id,name,email,phone,source,status,is_spam,created_at,custom_fields,ghl_notes,campaign_name,opportunity_stage,opportunity_value').eq('client_id', clientId).order('created_at', { ascending: false })
        ),
        fetchAllRows<DBEnrichment>((sb) =>
          sb.from('lead_enrichment').select('lead_id,external_id,enriched_at,source,first_name,last_name,city,state,household_income,net_worth,company_name,company_title,linkedin_url').eq('client_id', clientId)
        ),
      ]);
      const byLeadId = new Map<string, DBEnrichment>();
      const byExtId = new Map<string, DBEnrichment>();
      for (const e of enrichments) {
        if (e.lead_id) byLeadId.set(e.lead_id, e);
        if (e.external_id) byExtId.set(e.external_id, e);
      }
      return leads.map(l => ({
        lead: l,
        enrichment: byLeadId.get(l.id) || (l.external_id ? byExtId.get(l.external_id) : undefined) || null,
      }));
    },
  });

  const rows = data || [];

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(({ lead, enrichment }) => {
      if (enrichedOnly && !enrichment) return false;
      if (!q) return true;
      const hay = [lead.name, lead.email, lead.phone, lead.source, lead.campaign_name, enrichment?.company_name, enrichment?.city, enrichment?.state]
        .filter(Boolean).join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [rows, search, enrichedOnly]);

  const enrichedCount = rows.filter(r => r.enrichment).length;

  const exportCsv = () => {
    const headers = ['Name', 'Email', 'Phone', 'Source', 'Campaign', 'Status', 'Tags', 'Notes', 'Created', 'Enriched', 'Enriched At', 'First Name', 'Last Name', 'City', 'State', 'Company', 'Title', 'LinkedIn', 'Household Income', 'Net Worth'];
    const lines = [headers.join(',')];
    for (const { lead, enrichment } of filtered) {
      const row = [
        lead.name, lead.email, lead.phone, lead.source, lead.campaign_name, lead.status,
        extractTags(lead.custom_fields).join('; '),
        extractNotes(lead.ghl_notes),
        lead.created_at,
        enrichment ? 'yes' : 'no',
        enrichment?.enriched_at, enrichment?.first_name, enrichment?.last_name,
        enrichment?.city, enrichment?.state, enrichment?.company_name, enrichment?.company_title,
        enrichment?.linkedin_url, enrichment?.household_income, enrichment?.net_worth,
      ];
      lines.push(row.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','));
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${clientName.replace(/\s+/g, '-').toLowerCase()}-contacts-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card><CardContent className="p-4">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Total Contacts</p>
          <p className="text-2xl font-bold">{rows.length.toLocaleString()}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Enriched</p>
          <p className="text-2xl font-bold">{enrichedCount.toLocaleString()}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Enrichment %</p>
          <p className="text-2xl font-bold">{rows.length ? ((enrichedCount / rows.length) * 100).toFixed(1) : '0'}%</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">With Email + Phone</p>
          <p className="text-2xl font-bold">{rows.filter(r => r.lead.email && r.lead.phone).length.toLocaleString()}</p>
        </CardContent></Card>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Search name, email, phone, company…" value={search} onChange={e => setSearch(e.target.value)} className="pl-9 h-9" />
        </div>
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
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Tags</TableHead>
                <TableHead>Enrichment</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow><TableCell colSpan={8} className="text-center py-8 text-sm text-muted-foreground">No contacts found</TableCell></TableRow>
              ) : filtered.slice(0, 500).map(({ lead, enrichment }) => {
                const tags = extractTags(lead.custom_fields);
                const notes = extractNotes(lead.ghl_notes);
                const isOpen = expanded === lead.id;
                return (
                  <>
                    <TableRow key={lead.id} className="cursor-pointer hover:bg-muted/40" onClick={() => setExpanded(isOpen ? null : lead.id)}>
                      <TableCell>{isOpen ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}</TableCell>
                      <TableCell className="font-medium text-sm">{lead.name || '—'}</TableCell>
                      <TableCell className="text-xs">{lead.email || '—'}</TableCell>
                      <TableCell className="text-xs">{lead.phone || '—'}</TableCell>
                      <TableCell className="text-xs">{lead.source || '—'}</TableCell>
                      <TableCell>
                        <div className="flex gap-1 flex-wrap max-w-[220px]">
                          {tags.slice(0, 3).map(t => <Badge key={t} variant="outline" className="text-[9px]">{t}</Badge>)}
                          {tags.length > 3 && <span className="text-[10px] text-muted-foreground">+{tags.length - 3}</span>}
                        </div>
                      </TableCell>
                      <TableCell>
                        {enrichment ? (
                          <Badge className="bg-emerald-500/10 text-emerald-600 text-[10px]">✓ {enrichment.source || 'Enriched'}</Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px] text-muted-foreground">—</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-[10px] text-muted-foreground">{lead.created_at?.split('T')[0]}</TableCell>
                    </TableRow>
                    {isOpen && (
                      <TableRow key={lead.id + '-x'}>
                        <TableCell colSpan={8} className="bg-muted/20">
                          <div className="grid md:grid-cols-2 gap-4 p-3 text-xs">
                            <div>
                              <p className="font-semibold mb-2 text-sm">Contact</p>
                              <div className="space-y-1">
                                <div><span className="text-muted-foreground">Campaign:</span> {lead.campaign_name || '—'}</div>
                                <div><span className="text-muted-foreground">Status:</span> {lead.status || '—'}</div>
                                <div><span className="text-muted-foreground">Stage:</span> {lead.opportunity_stage || '—'}</div>
                                <div><span className="text-muted-foreground">Value:</span> {lead.opportunity_value ? `$${lead.opportunity_value.toLocaleString()}` : '—'}</div>
                                <div><span className="text-muted-foreground">Tags:</span> {tags.join(', ') || '—'}</div>
                                <div className="pt-2"><span className="text-muted-foreground">Notes:</span> <span className="whitespace-pre-wrap">{notes || '—'}</span></div>
                              </div>
                            </div>
                            <div>
                              <p className="font-semibold mb-2 text-sm">Enrichment</p>
                              {enrichment ? (
                                <div className="space-y-1">
                                  <div><span className="text-muted-foreground">Name:</span> {[enrichment.first_name, enrichment.last_name].filter(Boolean).join(' ') || '—'}</div>
                                  <div><span className="text-muted-foreground">Location:</span> {[enrichment.city, enrichment.state].filter(Boolean).join(', ') || '—'}</div>
                                  <div><span className="text-muted-foreground">Company:</span> {enrichment.company_name || '—'}</div>
                                  <div><span className="text-muted-foreground">Title:</span> {enrichment.company_title || '—'}</div>
                                  <div><span className="text-muted-foreground">Household income:</span> {enrichment.household_income ? `$${Number(enrichment.household_income).toLocaleString()}` : '—'}</div>
                                  <div><span className="text-muted-foreground">Net worth:</span> {enrichment.net_worth ? `$${Number(enrichment.net_worth).toLocaleString()}` : '—'}</div>
                                  {enrichment.linkedin_url && <div><a href={enrichment.linkedin_url} target="_blank" rel="noreferrer" className="text-primary underline">LinkedIn</a></div>}
                                  <div className="pt-1 text-[10px] text-muted-foreground">Source: {enrichment.source || '—'} · {enrichment.enriched_at?.split('T')[0]}</div>
                                </div>
                              ) : (
                                <div className="text-muted-foreground">No enrichment yet.</div>
                              )}
                            </div>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </>
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
