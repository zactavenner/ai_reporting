import { useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Search, RefreshCw, Play, FileText, Download, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { useClients } from '@/hooks/useClients';
import { exportToCSV } from '@/lib/exportUtils';
import {
  CallTranscriptRecord,
  useCallTranscripts,
  useProcessPendingCalls,
} from '@/hooks/useCallTranscripts';
import { CallTranscriptDetail } from './CallTranscriptDetail';
import { CALL_OUTCOMES, CALL_SENTIMENTS, formatDuration, intentLabel, sentimentTone } from './callTranscriptUtils';

const WEBHOOK_URL =
  'https://jgwwmtuvjlmzapwqiabu.supabase.co/functions/v1/call-transcription?password=HPA1234$';

export function CallTranscriptsTab() {
  const { data: clients = [] } = useClients();
  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [clientId, setClientId] = useState('all');
  const [assignedUser, setAssignedUser] = useState('all');
  const [outcome, setOutcome] = useState('all');
  const [sentiment, setSentiment] = useState('all');
  const [intentBand, setIntentBand] = useState('all');
  const [minDuration, setMinDuration] = useState('all');
  const [mediaKind, setMediaKind] = useState('all');
  const [selected, setSelected] = useState<CallTranscriptRecord | null>(null);

  const { data: calls = [], isLoading, refetch, isFetching } = useCallTranscripts({
    startDate: startDate || undefined,
    endDate: endDate || undefined,
    clientId: clientId === 'all' ? undefined : clientId,
    search: appliedSearch || undefined,
    mediaKind: mediaKind === 'all' ? undefined : (mediaKind as 'audio' | 'video'),
  });

  const processPending = useProcessPendingCalls();

  const users = useMemo(
    () => Array.from(new Set(calls.map((c) => c.assigned_user).filter(Boolean))) as string[],
    [calls],
  );

  const clientNames = useMemo(
    () => Object.fromEntries(clients.map((c) => [c.id, c.name])) as Record<string, string>,
    [clients],
  );

  const matching = useMemo(
    () =>
      calls.filter((c) => {
        if (assignedUser !== 'all' && c.assigned_user !== assignedUser) return false;
        if (outcome !== 'all' && c.outcome !== outcome) return false;
        if (sentiment !== 'all' && c.sentiment !== sentiment) return false;
        if (minDuration !== 'all' && (c.duration_seconds || 0) < Number(minDuration)) return false;
        if (intentBand !== 'all') {
          const s = c.intent_score;
          if (s === null) return false;
          if (intentBand === 'high' && s < 80) return false;
          if (intentBand === 'medium' && (s < 50 || s >= 80)) return false;
          if (intentBand === 'low' && s >= 50) return false;
        }
        return true;
      }),
    [calls, assignedUser, outcome, sentiment, intentBand, minDuration],
  );

  /** Show only one row per contact per media type — the most informative, most recent. */
  const filtered = useMemo(() => {
    const score = (c: CallTranscriptRecord) =>
      (c.transcript ? 4 : 0) + (c.summary ? 2 : 0) + (c.outcome ? 1 : 0);
    const best = new Map<string, CallTranscriptRecord>();
    for (const c of matching) {
      const key = `${c.media_kind}:${c.contact_id || c.contact_phone || c.contact_email || c.id}`;

      const prev = best.get(key);
      if (!prev) { best.set(key, c); continue; }
      const cScore = score(c);
      const pScore = score(prev);
      if (
        cScore > pScore ||
        (cScore === pScore &&
          new Date(c.started_at || 0).getTime() > new Date(prev.started_at || 0).getTime())
      ) {
        best.set(key, c);
      }
    }
    return Array.from(best.values()).sort(
      (a, b) => new Date(b.started_at || 0).getTime() - new Date(a.started_at || 0).getTime(),
    );
  }, [matching]);

  const kpis = useMemo(() => {
    const connected = filtered.filter((c) => c.connected || (c.duration_seconds || 0) > 20);
    const talkTime = filtered.reduce((sum, c) => sum + (c.duration_seconds || 0), 0);
    return {
      total: filtered.length,
      connected: connected.length,
      talkTime,
      avgDuration: connected.length ? Math.round(talkTime / connected.length) : 0,
      qualified: filtered.filter((c) => c.outcome === 'Qualified').length,
      highIntent: filtered.filter((c) => (c.intent_score || 0) >= 80).length,
      followUps: filtered.filter((c) => c.outcome === 'Follow-Up Required' || c.outcome === 'Reconnect Required').length,
      commitments: filtered.filter((c) => c.outcome === 'Committed' || c.commitment_level === 'committed').length,
      funded: filtered.filter((c) => c.outcome === 'Funded' || c.commitment_level === 'funded').length,
    };
  }, [filtered]);

  const timeline = useMemo(() => {
    if (!selected) return [];
    const key = selected.contact_id || selected.contact_phone;
    if (!key) return [selected];
    return calls
      .filter((c) => (c.contact_id || c.contact_phone) === key)
      .sort((a, b) => new Date(a.started_at || 0).getTime() - new Date(b.started_at || 0).getTime());
  }, [calls, selected]);

  const handleExport = () => {
    exportToCSV(
      filtered.map((c) => ({
        date: c.started_at,
        client: c.client_id ? clientNames[c.client_id] || '' : '',
        contact: c.contact_name,
        phone: c.contact_phone,
        assigned_user: c.assigned_user,
        duration_seconds: c.duration_seconds,
        outcome: c.outcome,
        intent_score: c.intent_score,
        sentiment: c.sentiment,
        next_step: c.next_step,
        investment_range: c.investment_range,
        objections: (c.objections || []).join('; '),
        summary: c.summary,
      })),
      'call-transcripts',
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">Call Transcripts</h2>
          <p className="text-sm text-muted-foreground">
            Every completed call transcribed, scored and turned into sales intelligence
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              navigator.clipboard.writeText(WEBHOOK_URL);
              toast.success('Webhook URL copied');
            }}
          >
            <Copy className="h-4 w-4 mr-2" /> Webhook URL
          </Button>
          <Button variant="outline" size="sm" onClick={handleExport} disabled={!filtered.length}>
            <Download className="h-4 w-4 mr-2" /> Export
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => processPending.mutate()}
            disabled={processPending.isPending}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${processPending.isPending ? 'animate-spin' : ''}`} />
            Run queue
          </Button>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? 'animate-spin' : ''}`} /> Refresh
          </Button>
        </div>
      </div>

      {/* Overview metrics */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        <Kpi label="Total calls" value={kpis.total} />
        <Kpi label="Connected" value={kpis.connected} />
        <Kpi label="Talk time" value={formatDuration(kpis.talkTime)} />
        <Kpi label="Avg duration" value={formatDuration(kpis.avgDuration)} />
        <Kpi label="Qualified" value={kpis.qualified} />
        <Kpi label="High intent" value={kpis.highIntent} />
        <Kpi label="Follow-ups" value={kpis.followUps} />
        <Kpi label="Commitments" value={kpis.commitments} />
        <Kpi label="Funded" value={kpis.funded} />
      </div>

      {/* Global transcript search */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder='Search transcripts — e.g. "CPA", "$250,000", "liquidity", "accredited investor"'
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && setAppliedSearch(search)}
              />
            </div>
            <Button onClick={() => setAppliedSearch(search)}>Search</Button>
            {appliedSearch && (
              <Button variant="ghost" onClick={() => { setSearch(''); setAppliedSearch(''); }}>Clear</Button>
            )}
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2">
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            <FilterSelect value={clientId} onChange={setClientId} placeholder="Fund / client"
              options={[{ value: 'all', label: 'All clients' }, ...clients.map((c) => ({ value: c.id, label: c.name }))]} />
            <FilterSelect value={assignedUser} onChange={setAssignedUser} placeholder="Assigned user"
              options={[{ value: 'all', label: 'All users' }, ...users.map((u) => ({ value: u, label: u }))]} />
            <FilterSelect value={outcome} onChange={setOutcome} placeholder="Outcome"
              options={[{ value: 'all', label: 'All outcomes' }, ...CALL_OUTCOMES.map((o) => ({ value: o, label: o }))]} />
            <FilterSelect value={sentiment} onChange={setSentiment} placeholder="Sentiment"
              options={[{ value: 'all', label: 'All sentiment' }, ...CALL_SENTIMENTS.map((s) => ({ value: s, label: s }))]} />
            <FilterSelect value={intentBand} onChange={setIntentBand} placeholder="Intent"
              options={[
                { value: 'all', label: 'All intent' },
                { value: 'high', label: 'High (80-100)' },
                { value: 'medium', label: 'Medium (50-79)' },
                { value: 'low', label: 'Low (0-49)' },
              ]} />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:max-w-md gap-2">
            <FilterSelect value={minDuration} onChange={setMinDuration} placeholder="Min duration"
              options={[
                { value: 'all', label: 'Any duration' },
                { value: '60', label: '1+ minutes' },
                { value: '300', label: '5+ minutes' },
                { value: '600', label: '10+ minutes' },
                { value: '1200', label: '20+ minutes' },
              ]} />
            <FilterSelect value={mediaKind} onChange={setMediaKind} placeholder="Source"
              options={[
                { value: 'all', label: 'All sources' },
                { value: 'audio', label: 'Phone calls' },
                { value: 'video', label: 'Video meetings' },
              ]} />
          </div>

        </CardContent>
      </Card>

      {/* Call log */}
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Assigned user</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead>Outcome</TableHead>
                <TableHead>Intent</TableHead>
                <TableHead>Sentiment</TableHead>
                <TableHead>Next step</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={10} className="text-center py-10 text-muted-foreground">Loading calls…</TableCell></TableRow>
              ) : !filtered.length ? (
                <TableRow>
                  <TableCell colSpan={10} className="text-center py-10 text-muted-foreground">
                    No calls yet. Point your call provider webhook at the URL above — completed calls with a
                    recording are transcribed and analyzed automatically.
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((c) => (
                  <TableRow key={c.id} className="cursor-pointer" onClick={() => setSelected(c)}>
                    <TableCell className="whitespace-nowrap">
                      {c.started_at ? new Date(c.started_at).toLocaleString() : '—'}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {c.client_id ? clientNames[c.client_id] || 'Unknown client' : '—'}
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">{c.contact_name || 'Unknown'}</div>
                      <div className="text-xs text-muted-foreground">{c.contact_phone}</div>
                    </TableCell>
                    <TableCell>{c.assigned_user || '—'}</TableCell>
                    <TableCell>{formatDuration(c.duration_seconds)}</TableCell>
                    <TableCell>{c.outcome ? <Badge variant="outline">{c.outcome}</Badge> : '—'}</TableCell>
                    <TableCell>
                      {c.intent_score !== null ? (
                        <Badge variant={c.intent_score >= 80 ? 'default' : c.intent_score >= 50 ? 'secondary' : 'outline'}>
                          {c.intent_score} · {intentLabel(c.intent_score)}
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">{c.transcription_status}</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {c.sentiment ? <Badge variant={sentimentTone(c.sentiment)}>{c.sentiment}</Badge> : '—'}
                    </TableCell>
                    <TableCell className="max-w-[220px] truncate">{c.next_step || '—'}</TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      {c.transcript && (
                        <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); setSelected(c); }}>
                          <FileText className="h-4 w-4" />
                        </Button>
                      )}
                      {c.recording_url && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => { e.stopPropagation(); window.open(c.recording_url!, '_blank'); }}
                        >
                          <Play className="h-4 w-4" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <CallTranscriptDetail
        record={selected}
        timeline={timeline}
        open={!!selected}
        onOpenChange={(open) => !open && setSelected(null)}
      />
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string | number }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="text-2xl font-bold">{value}</p>
      </CardContent>
    </Card>
  );
}

function FilterSelect({
  value, onChange, placeholder, options,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  options: { value: string; label: string }[];
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger><SelectValue placeholder={placeholder} /></SelectTrigger>
      <SelectContent>
        {options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}
