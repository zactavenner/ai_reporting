import { useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Search, RefreshCw, Download, Copy, Play, FileText, PhoneCall, CalendarCheck } from 'lucide-react';
import { toast } from 'sonner';
import { exportToCSV } from '@/lib/exportUtils';
import { AiCallRecord, useAiCallerCalls } from '@/hooks/useAiCallerCalls';
import { AICallerDetail } from './AICallerDetail';
import {
  APPOINTMENT_STATUSES,
  CALL_OUTCOMES,
  CALL_STATUSES,
  appointmentTone,
  computeKpis,
  dateRangeForPreset,
  formatDuration,
  intentLabel,
  intentTone,
  isAnswered,
  isBooked,
  isQualified,
  pct,
  statusLabel,
  statusTone,
} from './aiCallerUtils';

const WEBHOOK_URL =
  'https://jgwwmtuvjlmzapwqiabu.supabase.co/functions/v1/ai-caller-webhook?password=HPA1234$';

const DATE_PRESETS = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: '7d', label: 'Last 7 Days' },
  { value: '30d', label: 'Last 30 Days' },
  { value: 'month', label: 'This Month' },
  { value: 'all', label: 'All Time' },
  { value: 'custom', label: 'Custom Range' },
];

interface Props {
  clientId: string;
  clientName: string;
}

export function AICallerTab({ clientId, clientName }: Props) {
  const [preset, setPreset] = useState('30d');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [callStatus, setCallStatus] = useState('all');
  const [assignedUser, setAssignedUser] = useState('all');
  const [bookedFilter, setBookedFilter] = useState('all');
  const [appointmentStatus, setAppointmentStatus] = useState('all');
  const [outcome, setOutcome] = useState('all');
  const [intentBand, setIntentBand] = useState('all');
  const [minDuration, setMinDuration] = useState('all');
  const [contactQuery, setContactQuery] = useState('');
  const [selected, setSelected] = useState<AiCallRecord | null>(null);

  const range = preset === 'custom'
    ? { start: customStart, end: customEnd }
    : preset === 'all'
      ? null
      : dateRangeForPreset(preset);

  const { data: calls = [], isLoading, refetch, isFetching } = useAiCallerCalls({
    clientId,
    startDate: range?.start || undefined,
    endDate: range?.end || undefined,
    search: appliedSearch || undefined,
  });

  const users = useMemo(
    () => Array.from(new Set(calls.map((c) => c.assigned_user).filter(Boolean))) as string[],
    [calls],
  );

  const filtered = useMemo(
    () =>
      calls.filter((c) => {
        if (callStatus !== 'all' && (c.call_status || '').toLowerCase() !== callStatus) return false;
        if (assignedUser !== 'all' && c.assigned_user !== assignedUser) return false;
        if (bookedFilter === 'booked' && !isBooked(c)) return false;
        if (bookedFilter === 'not_booked' && isBooked(c)) return false;
        if (appointmentStatus !== 'all' && (c.appointment_status || '') !== appointmentStatus) return false;
        if (outcome !== 'all' && c.outcome !== outcome) return false;
        if (minDuration !== 'all' && (c.duration_seconds || 0) < Number(minDuration)) return false;
        if (intentBand !== 'all') {
          const s = c.intent_score;
          if (s === null || s === undefined) return false;
          if (intentBand === 'high' && s < 80) return false;
          if (intentBand === 'medium' && (s < 50 || s >= 80)) return false;
          if (intentBand === 'low' && s >= 50) return false;
        }
        if (contactQuery.trim()) {
          const q = contactQuery.trim().toLowerCase();
          const hay = `${c.contact_name || ''} ${c.contact_phone || ''}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      }),
    [calls, callStatus, assignedUser, bookedFilter, appointmentStatus, outcome, intentBand, minDuration, contactQuery],
  );

  const kpis = useMemo(() => computeKpis(filtered), [filtered]);
  const bookings = useMemo(() => filtered.filter(isBooked), [filtered]);

  const handleExport = () => {
    exportToCSV(
      filtered.map((c) => ({
        date: c.started_at,
        contact: c.contact_name,
        phone: c.contact_phone,
        assigned_user: c.assigned_user,
        call_status: c.call_status,
        duration_seconds: c.duration_seconds,
        answered: isAnswered(c),
        qualified: isQualified(c),
        appointment_booked: isBooked(c),
        appointment_date: c.appointment_date,
        appointment_status: c.appointment_status,
        outcome: c.outcome,
        intent_score: c.intent_score,
        next_step: c.next_step,
        follow_up_required: c.follow_up_required,
        summary: c.summary,
      })),
      `ai-caller-${clientName.toLowerCase().replace(/\s+/g, '-')}`,
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">AI Caller</h2>
          <p className="text-sm text-muted-foreground">
            Outbound AI calling performance, bookings and transcribed conversations
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              navigator.clipboard.writeText(WEBHOOK_URL);
              toast.success('AI Caller webhook URL copied');
            }}
          >
            <Copy className="h-4 w-4 mr-2" /> Webhook URL
          </Button>
          <Button variant="outline" size="sm" onClick={handleExport} disabled={!filtered.length}>
            <Download className="h-4 w-4 mr-2" /> Export
          </Button>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? 'animate-spin' : ''}`} /> Refresh
          </Button>
        </div>
      </div>

      {/* Headline reporting view: calls → pickup → bookings */}
      <Card>
        <CardContent className="p-4 grid gap-4 sm:grid-cols-3">
          <Headline
            icon={<PhoneCall className="h-4 w-4" />}
            label="Outbound Calls"
            value={kpis.total.toLocaleString()}
            sub={`${kpis.answered.toLocaleString()} answered`}
          />
          <Headline
            label="Pickup Rate"
            value={pct(kpis.answered, kpis.total)}
            sub={`${kpis.answered.toLocaleString()} of ${kpis.total.toLocaleString()} calls`}
          />
          <Headline
            icon={<CalendarCheck className="h-4 w-4" />}
            label="Appointments Booked"
            value={kpis.booked.toLocaleString()}
            sub={`${pct(kpis.booked, kpis.answered)} of answered · ${pct(kpis.booked, kpis.total)} of total`}
          />
        </CardContent>
      </Card>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <Kpi label="Total outbound calls" value={kpis.total.toLocaleString()} />
        <Kpi label="Calls answered" value={kpis.answered.toLocaleString()} />
        <Kpi label="Call pickup rate" value={pct(kpis.answered, kpis.total)} />
        <Kpi label="Successful bookings" value={kpis.booked.toLocaleString()} />
        <Kpi label="Booking rate (answered)" value={pct(kpis.booked, kpis.answered)} />
        <Kpi label="Booking rate (total)" value={pct(kpis.booked, kpis.total)} />
        <Kpi label="No answer" value={kpis.noAnswer.toLocaleString()} />
        <Kpi label="Busy" value={kpis.busy.toLocaleString()} />
        <Kpi label="Failed calls" value={kpis.failed.toLocaleString()} />
        <Kpi label="Avg call duration" value={formatDuration(kpis.avgDuration)} />
        <Kpi label="Total talk time" value={formatDuration(kpis.talkTime)} />
        <Kpi label="Booked → showed" value={`${kpis.showed} / ${kpis.booked}`} />
      </div>

      {/* Funnel */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <h3 className="text-sm font-bold">Call Funnel</h3>
          <FunnelRow label="Outbound Calls" value={kpis.total} base={kpis.total} showPct={false} />
          <FunnelRow label="Picked Up" value={kpis.answered} base={kpis.total} />
          <FunnelRow label="Qualified Conversations" value={kpis.qualified} base={kpis.answered} />
          <FunnelRow label="Appointments Booked" value={kpis.booked} base={kpis.qualified || kpis.answered} />
        </CardContent>
      </Card>

      {/* Global transcript search + filters */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && setAppliedSearch(search)}
                placeholder='Search all transcripts — e.g. "$250,000", accredited, liquidity, returns, CPA'
                className="pl-9"
              />
            </div>
            <Button onClick={() => setAppliedSearch(search)}>Search transcripts</Button>
            {appliedSearch && (
              <Button
                variant="ghost"
                onClick={() => { setSearch(''); setAppliedSearch(''); }}
              >
                Clear
              </Button>
            )}
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-2">
            <Select value={preset} onValueChange={setPreset}>
              <SelectTrigger><SelectValue placeholder="Date range" /></SelectTrigger>
              <SelectContent>
                {DATE_PRESETS.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
              </SelectContent>
            </Select>
            {preset === 'custom' && (
              <>
                <Input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} />
                <Input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} />
              </>
            )}
            <Select value={callStatus} onValueChange={setCallStatus}>
              <SelectTrigger><SelectValue placeholder="Call status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {CALL_STATUSES.map((s) => <SelectItem key={s} value={s}>{statusLabel(s)}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={assignedUser} onValueChange={setAssignedUser}>
              <SelectTrigger><SelectValue placeholder="Assigned user" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All users</SelectItem>
                {users.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={bookedFilter} onValueChange={setBookedFilter}>
              <SelectTrigger><SelectValue placeholder="Appointment booked" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Booked or not</SelectItem>
                <SelectItem value="booked">Appointment booked</SelectItem>
                <SelectItem value="not_booked">Not booked</SelectItem>
              </SelectContent>
            </Select>
            <Select value={appointmentStatus} onValueChange={setAppointmentStatus}>
              <SelectTrigger><SelectValue placeholder="Appointment status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All appointment statuses</SelectItem>
                {APPOINTMENT_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={outcome} onValueChange={setOutcome}>
              <SelectTrigger><SelectValue placeholder="Call outcome" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All outcomes</SelectItem>
                {CALL_OUTCOMES.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={intentBand} onValueChange={setIntentBand}>
              <SelectTrigger><SelectValue placeholder="Intent score" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All intent</SelectItem>
                <SelectItem value="high">High (80-100)</SelectItem>
                <SelectItem value="medium">Medium (50-79)</SelectItem>
                <SelectItem value="low">Low (0-49)</SelectItem>
              </SelectContent>
            </Select>
            <Select value={minDuration} onValueChange={setMinDuration}>
              <SelectTrigger><SelectValue placeholder="Call duration" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any duration</SelectItem>
                <SelectItem value="30">30s+</SelectItem>
                <SelectItem value="60">1m+</SelectItem>
                <SelectItem value="180">3m+</SelectItem>
                <SelectItem value="300">5m+</SelectItem>
              </SelectContent>
            </Select>
            <Input
              value={contactQuery}
              onChange={(e) => setContactQuery(e.target.value)}
              placeholder="Contact name or phone"
            />
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="calls" className="space-y-4">
        <TabsList>
          <TabsTrigger value="calls">Call Reporting ({filtered.length})</TabsTrigger>
          <TabsTrigger value="bookings">AI Booked Appointments ({bookings.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="calls">
          <Card>
            <CardContent className="p-0 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Contact</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead>Rep</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Duration</TableHead>
                    <TableHead>Answered</TableHead>
                    <TableHead>Qualified</TableHead>
                    <TableHead>Booked</TableHead>
                    <TableHead>Appt date</TableHead>
                    <TableHead>Outcome</TableHead>
                    <TableHead>Intent</TableHead>
                    <TableHead>AI summary</TableHead>
                    <TableHead>Media</TableHead>
                    <TableHead>Follow-up</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading && (
                    <TableRow><TableCell colSpan={15} className="text-center py-8 text-muted-foreground">Loading AI calls…</TableCell></TableRow>
                  )}
                  {!isLoading && !filtered.length && (
                    <TableRow>
                      <TableCell colSpan={15} className="text-center py-8 text-muted-foreground">
                        No AI calls yet. Point your AI dialer at the webhook URL above to start reporting.
                      </TableCell>
                    </TableRow>
                  )}
                  {filtered.map((c) => (
                    <TableRow
                      key={c.id}
                      className="cursor-pointer"
                      onClick={() => setSelected(c)}
                    >
                      <TableCell className="whitespace-nowrap">
                        {c.started_at ? new Date(c.started_at).toLocaleString() : '—'}
                      </TableCell>
                      <TableCell className="font-medium whitespace-nowrap">{c.contact_name || '—'}</TableCell>
                      <TableCell className="whitespace-nowrap">{c.contact_phone || '—'}</TableCell>
                      <TableCell className="whitespace-nowrap">{c.assigned_user || '—'}</TableCell>
                      <TableCell>
                        <Badge variant={statusTone(c.call_status)}>{statusLabel(c.call_status)}</Badge>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">{formatDuration(c.duration_seconds)}</TableCell>
                      <TableCell>{isAnswered(c) ? 'Yes' : 'No'}</TableCell>
                      <TableCell>{isQualified(c) ? 'Yes' : 'No'}</TableCell>
                      <TableCell>{isBooked(c) ? 'Yes' : 'No'}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        {c.appointment_date ? new Date(c.appointment_date).toLocaleString() : '—'}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">{c.outcome || '—'}</TableCell>
                      <TableCell>
                        {c.intent_score !== null && c.intent_score !== undefined ? (
                          <Badge variant={intentTone(c.intent_score)}>{c.intent_score}</Badge>
                        ) : '—'}
                      </TableCell>
                      <TableCell className="max-w-[280px] truncate text-muted-foreground">
                        {c.summary || '—'}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          {c.transcript && <FileText className="h-4 w-4 text-muted-foreground" />}
                          {c.recording_url && <Play className="h-4 w-4 text-muted-foreground" />}
                        </div>
                      </TableCell>
                      <TableCell>{c.follow_up_required ? <Badge variant="destructive">Yes</Badge> : 'No'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="bookings" className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Kpi label="Appointments booked" value={kpis.booked.toLocaleString()} />
            <Kpi label="Showed" value={kpis.showed.toLocaleString()} />
            <Kpi label="Show rate" value={pct(kpis.showed, kpis.booked)} />
            <Kpi label="Calls → booked" value={pct(kpis.booked, kpis.total)} />
          </div>
          <Card>
            <CardContent className="p-0 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Contact</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead>Date called</TableHead>
                    <TableHead>Appointment date & time</TableHead>
                    <TableHead>Assigned user</TableHead>
                    <TableHead>Call duration</TableHead>
                    <TableHead>Call summary</TableHead>
                    <TableHead>Appointment status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {!bookings.length && (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                        No AI-booked appointments in this range.
                      </TableCell>
                    </TableRow>
                  )}
                  {bookings.map((c) => (
                    <TableRow key={c.id} className="cursor-pointer" onClick={() => setSelected(c)}>
                      <TableCell className="font-medium whitespace-nowrap">{c.contact_name || '—'}</TableCell>
                      <TableCell className="whitespace-nowrap">{c.contact_phone || '—'}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        {c.started_at ? new Date(c.started_at).toLocaleDateString() : '—'}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {c.appointment_date ? new Date(c.appointment_date).toLocaleString() : '—'}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">{c.assigned_user || '—'}</TableCell>
                      <TableCell className="whitespace-nowrap">{formatDuration(c.duration_seconds)}</TableCell>
                      <TableCell className="max-w-[320px] truncate text-muted-foreground">{c.summary || '—'}</TableCell>
                      <TableCell>
                        <Badge variant={appointmentTone(c.appointment_status)}>
                          {c.appointment_status || 'Booked'}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <AICallerDetail call={selected} open={!!selected} onOpenChange={(o) => !o && setSelected(null)} />
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string | number }) {
  return (
    <Card>
      <CardContent className="p-3">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="text-xl font-bold mt-1">{value}</p>
      </CardContent>
    </Card>
  );
}

function Headline({
  label, value, sub, icon,
}: { label: string; value: string; sub?: string; icon?: React.ReactNode }) {
  return (
    <div>
      <p className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
        {icon}{label}
      </p>
      <p className="text-3xl font-bold mt-1">{value}</p>
      {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
    </div>
  );
}

function FunnelRow({
  label, value, base, showPct = true,
}: { label: string; value: number; base: number; showPct?: boolean }) {
  const width = base ? Math.max(4, Math.min(100, (value / base) * 100)) : 4;
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between text-sm">
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground">
          {value.toLocaleString()}{showPct ? ` — ${pct(value, base)}` : ''}
        </span>
      </div>
      <div className="h-2.5 rounded-full bg-muted overflow-hidden">
        <div className="h-full rounded-full bg-primary" style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}
