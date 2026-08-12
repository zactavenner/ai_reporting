import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { useClients } from '@/hooks/useClients';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2, PhoneForwarded, RefreshCw, PhoneOff, ListTree, Copy } from 'lucide-react';

const ADMIN_FN = 'appointment-bridge-admin';
const INTERNAL_PASSWORD = 'HPA1234$';
const WEBHOOK_URL = 'https://jgwwmtuvjlmzapwqiabu.supabase.co/functions/v1/appointment-bridge-webhook';

interface Bridge {
  id: string;
  client_id: string | null;
  appointment_id: string;
  contact_name: string | null;
  contact_phone: string;
  contact_id: string | null;
  assigned_user_name: string | null;
  assigned_user_phone: string;
  appointment_time: string;
  status: string;
  call_started_at: string | null;
  user_answered_at: string | null;
  contact_answered_at: string | null;
  duration_seconds: number | null;
  attempts: number;
  last_error: string | null;
}

interface Kpis {
  total: number;
  scheduled: number;
  connected: number;
  user_not_reached: number;
  contact_not_reached: number;
  failed: number;
}

const STATUS_LABEL: Record<string, string> = {
  scheduled: 'Scheduled',
  retry_user: 'Retrying user',
  dialing_user: 'Dialing user',
  user_answered: 'User answered',
  dialing_contact: 'Dialing contact',
  connected: 'Connected',
  completed: 'Completed',
  user_not_reached: 'Appointment User Not Reached',
  contact_not_reached: 'Contact Not Reached',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

function statusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'connected' || status === 'completed') return 'default';
  if (status === 'user_not_reached' || status === 'contact_not_reached' || status === 'failed') return 'destructive';
  if (status === 'scheduled' || status === 'retry_user' || status === 'cancelled') return 'outline';
  return 'secondary';
}

const fmtTime = (iso?: string | null) =>
  iso
    ? new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : '—';

const fmtDuration = (seconds?: number | null) => {
  if (!seconds) return '—';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${String(s).padStart(2, '0')}s`;
};

export default function CallBridgePage() {
  const { toast } = useToast();
  const { data: clients } = useClients();
  const [bridges, setBridges] = useState<Bridge[]>([]);
  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [clientFilter, setClientFilter] = useState<string>('all');
  const [timelineFor, setTimelineFor] = useState<Bridge | null>(null);
  const [timeline, setTimeline] = useState<any[]>([]);

  const callAdmin = useCallback(async (payload: Record<string, unknown>) => {
    const { data, error } = await supabase.functions.invoke(ADMIN_FN, {
      body: { password: INTERNAL_PASSWORD, ...payload },
    });
    if (error) throw new Error(error.message);
    if ((data as any)?.error) throw new Error((data as any).error);
    return data as any;
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await callAdmin({ action: 'list', client_id: clientFilter === 'all' ? null : clientFilter });
      setBridges(res.bridges || []);
      setKpis(res.kpis || null);
    } catch (e) {
      toast({ title: 'Could not load call bridges', description: String((e as Error).message), variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [callAdmin, clientFilter, toast]);

  useEffect(() => {
    load();
    const t = setInterval(load, 20_000);
    return () => clearInterval(t);
  }, [load]);

  const runAction = async (bridge: Bridge, action: 'call_now' | 'cancel') => {
    setBusyId(bridge.id);
    try {
      await callAdmin({ action, bridge_id: bridge.id });
      toast({
        title: action === 'call_now' ? 'Calling the assigned user' : 'Bridge cancelled',
        description:
          action === 'call_now'
            ? `${bridge.assigned_user_name || bridge.assigned_user_phone} is being dialed first.`
            : undefined,
      });
      await load();
    } catch (e) {
      toast({ title: 'Action failed', description: String((e as Error).message), variant: 'destructive' });
    } finally {
      setBusyId(null);
    }
  };

  const openTimeline = async (bridge: Bridge) => {
    setTimelineFor(bridge);
    setTimeline([]);
    try {
      const res = await callAdmin({ action: 'timeline', bridge_id: bridge.id });
      setTimeline(res.events || []);
    } catch (e) {
      toast({ title: 'Could not load timeline', description: String((e as Error).message), variant: 'destructive' });
    }
  };

  const clientName = useMemo(() => {
    const map = new Map((clients || []).map((c: any) => [c.id, c.name]));
    return (id: string | null) => (id ? map.get(id) || '—' : '—');
  }, [clients]);

  const kpiCards = [
    { label: 'Appointments', value: kpis?.total ?? 0 },
    { label: 'Scheduled', value: kpis?.scheduled ?? 0 },
    { label: 'Connected', value: kpis?.connected ?? 0 },
    { label: 'User not reached', value: kpis?.user_not_reached ?? 0 },
    { label: 'Contact not reached', value: kpis?.contact_not_reached ?? 0 },
    { label: 'Failed', value: kpis?.failed ?? 0 },
  ];

  return (
    <div className="space-y-6 p-4 md:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Appointment Call Bridge</h1>
          <p className="text-sm text-muted-foreground">
            At the appointment start time we call the assigned user first, then dial the contact and bridge both legs.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={clientFilter} onValueChange={setClientFilter}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="All clients" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All clients</SelectItem>
              {(clients || []).map((c: any) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={load} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            <span className="ml-2">Refresh</span>
          </Button>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
        {kpiCards.map((k) => (
          <Card key={k.label}>
            <CardContent className="p-4">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">{k.label}</div>
              <div className="mt-1 text-2xl font-semibold">{k.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">GoHighLevel webhook</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-muted-foreground">
            Point a GHL workflow webhook (Customer Booked Appointment) at this URL. Send the shared secret in the
            <code className="mx-1 rounded bg-muted px-1">x-hpa-webhook-token</code> header.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 overflow-x-auto rounded bg-muted p-2 text-xs">{WEBHOOK_URL}</code>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                navigator.clipboard.writeText(WEBHOOK_URL);
                toast({ title: 'Webhook URL copied' });
              }}
            >
              <Copy className="h-4 w-4" />
            </Button>
          </div>
          <pre className="overflow-x-auto rounded bg-muted p-3 text-xs">{`{
  "appointment_id": "{{appointment.id}}",
  "appointment_time": "{{appointment.start_time}}",
  "contact_id": "{{contact.id}}",
  "contact_name": "{{contact.name}}",
  "contact_phone": "{{contact.phone}}",
  "assigned_user_id": "{{appointment.user_id}}",
  "assigned_user_name": "{{user.name}}",
  "assigned_user_phone": "{{user.phone}}"
}`}</pre>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Bridge calls</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-2">Appointment</th>
                  <th className="px-4 py-2">Client</th>
                  <th className="px-4 py-2">Assigned user</th>
                  <th className="px-4 py-2">Contact</th>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2">User answered</th>
                  <th className="px-4 py-2">Contact answered</th>
                  <th className="px-4 py-2">Duration</th>
                  <th className="px-4 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {bridges.map((b) => (
                  <tr key={b.id} className="border-b last:border-0">
                    <td className="px-4 py-2">
                      <div className="font-medium">{fmtTime(b.appointment_time)}</div>
                      <div className="text-xs text-muted-foreground">{b.appointment_id}</div>
                    </td>
                    <td className="px-4 py-2">{clientName(b.client_id)}</td>
                    <td className="px-4 py-2">
                      <div>{b.assigned_user_name || '—'}</div>
                      <div className="text-xs text-muted-foreground">{b.assigned_user_phone}</div>
                    </td>
                    <td className="px-4 py-2">
                      <div>{b.contact_name || '—'}</div>
                      <div className="text-xs text-muted-foreground">{b.contact_phone}</div>
                    </td>
                    <td className="px-4 py-2">
                      <Badge variant={statusVariant(b.status)}>{STATUS_LABEL[b.status] || b.status}</Badge>
                      {b.last_error && <div className="mt-1 text-xs text-muted-foreground">{b.last_error}</div>}
                    </td>
                    <td className="px-4 py-2 text-xs">{fmtTime(b.user_answered_at)}</td>
                    <td className="px-4 py-2 text-xs">{fmtTime(b.contact_answered_at)}</td>
                    <td className="px-4 py-2 text-xs">{fmtDuration(b.duration_seconds)}</td>
                    <td className="px-4 py-2">
                      <div className="flex items-center justify-end gap-1">
                        <Button size="sm" variant="ghost" onClick={() => openTimeline(b)}>
                          <ListTree className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busyId === b.id}
                          onClick={() => runAction(b, 'call_now')}
                        >
                          {busyId === b.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <PhoneForwarded className="h-4 w-4" />
                          )}
                          <span className="ml-1">Call now</span>
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busyId === b.id}
                          onClick={() => runAction(b, 'cancel')}
                        >
                          <PhoneOff className="h-4 w-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
                {!bridges.length && (
                  <tr>
                    <td colSpan={9} className="px-4 py-10 text-center text-sm text-muted-foreground">
                      {loading ? 'Loading…' : 'No appointment bridge calls yet.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={!!timelineFor} onOpenChange={(open) => !open && setTimelineFor(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Call timeline</DialogTitle>
          </DialogHeader>
          <div className="max-h-[60vh] space-y-2 overflow-y-auto text-sm">
            {timeline.map((ev) => (
              <div key={ev.id} className="rounded border p-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{ev.event_type}</span>
                  <span className="text-xs text-muted-foreground">{fmtTime(ev.created_at)}</span>
                </div>
                {ev.detail && <div className="text-xs text-muted-foreground">{ev.detail}</div>}
                {ev.leg && <div className="text-xs text-muted-foreground">leg: {ev.leg}</div>}
              </div>
            ))}
            {!timeline.length && <div className="text-muted-foreground">No events recorded yet.</div>}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}