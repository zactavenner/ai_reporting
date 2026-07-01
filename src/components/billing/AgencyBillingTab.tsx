import { useState, useMemo, useEffect, useRef } from 'react';
import { Client } from '@/hooks/useClients';
import { useAllClientFullSettings } from '@/hooks/useAllClientSettings';
import { useAllClientsStripePayments, StripeCustomerData } from '@/hooks/useStripePayments';
import { useUpdateClientSettings } from '@/hooks/useClientSettings';
import { BillingForecastChart } from './BillingForecastChart';
import { BillingTargetsPanel } from './BillingTargetsPanel';
import { Sparkline } from '@/components/dashboard/Sparkline';
import { BillingKpiGrid, type BillingKpis } from './BillingKpiGrid';
import { BillingActionQueue, type QueueItem } from './BillingActionQueue';
import { useBillingInvoices, useBillingPayments, useBillingActions, useBillingAgreements } from '@/hooks/useBillingData';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { DollarSign, TrendingUp, Calendar, CreditCard, Send, Zap, Loader2, RefreshCw, ExternalLink, Link2, Check } from 'lucide-react';
import { format, startOfMonth, startOfYear, subMonths, differenceInMonths, addDays, differenceInCalendarDays } from 'date-fns';
import { Users, AlertTriangle } from 'lucide-react';

interface AgencyBillingTabProps {
  clients: Client[];
}

const formatCurrency = (amount: number, currency = 'usd') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: currency.toUpperCase(), minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(amount);

export function AgencyBillingTab({ clients }: AgencyBillingTabProps) {
  const clientIds = useMemo(() => clients.map(c => c.id), [clients]);
  const { data: clientFullSettings = {} } = useAllClientFullSettings(clientIds);
  const updateSettings = useUpdateClientSettings();
  const { data: billingInvoices = [] } = useBillingInvoices();
  const { data: billingPayments = [] } = useBillingPayments();
  const { data: billingActions = [] } = useBillingActions();
  const { data: billingAgreements = [] } = useBillingAgreements();
  const [linkingClientId, setLinkingClientId] = useState<string | null>(null);
  const [linkEmail, setLinkEmail] = useState('');
  const [linkSubmitting, setLinkSubmitting] = useState(false);
  const [editingTargetId, setEditingTargetId] = useState<string | null>(null);
  const [targetDraft, setTargetDraft] = useState('');

  // Build email map for Stripe lookup — auto-match via client's notification_email
  // when no explicit stripe_email is set yet.
  const clientEmails = useMemo(() => {
    const map: Record<string, string> = {};
    for (const client of clients) {
      const settings = clientFullSettings[client.id];
      const email =
        (settings as any)?.stripe_email ||
        (settings as any)?.stripe_customer_id ||
        (client as any)?.notification_email ||
        (client as any)?.contact_email;
      if (email) map[client.id] = email;
    }
    return map;
  }, [clients, clientFullSettings]);

  const { data: stripeDataMap = {}, isLoading, refetch } = useAllClientsStripePayments(clientEmails);

  // Auto-persist successful auto-matches so future loads are stable + cached.
  const autoPersistedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const client of clients) {
      const settings = clientFullSettings[client.id] as any;
      if (settings?.stripe_email || settings?.stripe_customer_id) continue;
      const data = stripeDataMap[client.id];
      if (!data?.customer?.email) continue;
      if (autoPersistedRef.current.has(client.id)) continue;
      autoPersistedRef.current.add(client.id);
      updateSettings.mutate({
        client_id: client.id,
        stripe_email: data.customer.email,
        stripe_customer_id: data.customer.id,
      } as any);
    }
  }, [stripeDataMap, clients, clientFullSettings, updateSettings]);

  // Charge/Invoice modal state
  const [chargeModal, setChargeModal] = useState<{ clientId: string; clientName: string; customerId: string; mode: 'invoice' | 'charge' } | null>(null);
  const [chargeAmount, setChargeAmount] = useState('');
  const [chargeDescription, setChargeDescription] = useState('');
  const [chargeDays, setChargeDays] = useState('30');
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState('default');
  const [paymentMethods, setPaymentMethods] = useState<any[]>([]);
  const [loadingMethods, setLoadingMethods] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // KPI calculations
  const now = new Date();
  const yearStart = startOfYear(now);
  const monthStart = startOfMonth(now);

  const kpis = useMemo(() => {
    let totalRevThisYear = 0;
    let monthToDate = 0;
    const monthlyTotals: number[] = Array(12).fill(0);

    for (const [, data] of Object.entries(stripeDataMap)) {
      if (!data?.payments) continue;
      for (const payment of data.payments) {
        if (payment.status !== 'succeeded' || payment.refunded) continue;
        const paymentDate = new Date(payment.created);
        if (paymentDate.getFullYear() === now.getFullYear()) {
          totalRevThisYear += payment.amount;
          monthlyTotals[paymentDate.getMonth()] += payment.amount;
        }
        if (paymentDate >= monthStart) {
          monthToDate += payment.amount;
        }
      }
    }

    const currentMonth = now.getMonth();
    const monthsWithData = monthlyTotals.slice(0, currentMonth + 1).filter(v => v > 0).length;
    const avgPerMonth = monthsWithData > 0 ? totalRevThisYear / monthsWithData : 0;

    // Sparkline data: last 6 months
    const sparklineData = monthlyTotals.slice(Math.max(0, currentMonth - 5), currentMonth + 1);

    return { totalRevThisYear, monthToDate, avgPerMonth, sparklineData, monthlyTotals };
  }, [stripeDataMap, now, monthStart]);

  // Client rows
  const clientRows = useMemo(() => {
    return clients.map(client => {
      const stripeData = stripeDataMap[client.id];
      const isConnected = !!stripeData?.customer;
      const mrr = stripeData?.mrr || 0;
      const totalPaid = stripeData?.totalPaid || 0;
      const nextBilling = stripeData?.subscriptions?.[0]?.current_period_end;
      const subStatus = stripeData?.subscriptions?.[0]?.status;
      const interval = stripeData?.subscriptions?.[0]?.items?.[0]?.interval;

      return {
        client,
        isConnected,
        customerId: stripeData?.customer?.id || '',
        customerEmail: stripeData?.customer?.email || '',
        mrr,
        totalPaid,
        nextBilling,
        subStatus,
        interval,
      };
    }).sort((a, b) => b.mrr - a.mrr);
  }, [clients, stripeDataMap]);

  const enhancedStats = useMemo(() => {
    const totalClients = clients.length;
    let activeSubscriptions = 0;
    let noSubscription = 0;

    for (const row of clientRows) {
      if (row.subStatus === 'active') activeSubscriptions++;
      else if (row.isConnected && !row.subStatus) noSubscription++;
    }

    return { totalClients, activeSubscriptions, noSubscription };
  }, [clients, clientRows]);

  const totalMRR = useMemo(
    () => Object.values(stripeDataMap).reduce((sum, d: any) => sum + (d?.mrr || 0), 0),
    [stripeDataMap]
  );

  // Effective MRR: for every ACTIVE client, use Stripe MRR when present, else fall back
  // to their contracted monthly (client_settings.mrr) or an active billing_agreement base fee.
  // This gives a true agency MRR even when Stripe hasn't been linked yet.
  const effectiveMRR = useMemo(() => {
    const agreementByClient = new Map<string, number>();
    for (const a of billingAgreements) {
      if (!a.active) continue;
      if (a.billing_frequency && a.billing_frequency !== 'monthly') continue;
      const prev = agreementByClient.get(a.client_id) || 0;
      agreementByClient.set(a.client_id, Math.max(prev, Number(a.base_fee || 0)));
    }
    let sum = 0;
    for (const c of clients) {
      if (c.status !== 'active') continue;
      const stripeMrr = Number(stripeDataMap[c.id]?.mrr || 0);
      if (stripeMrr > 0) { sum += stripeMrr; continue; }
      const contracted =
        Number((clientFullSettings[c.id] as any)?.mrr || 0) ||
        agreementByClient.get(c.id) ||
        0;
      sum += contracted;
    }
    return sum;
  }, [clients, stripeDataMap, clientFullSettings, billingAgreements]);

  // Collected revenue by period key (year + year-Qn), for the Targets panel.
  const actualByPeriodKey = useMemo(() => {
    const map: Record<string, number> = {};
    for (const data of Object.values(stripeDataMap) as any[]) {
      if (!data?.payments) continue;
      for (const p of data.payments) {
        if (p.status !== 'succeeded' || p.refunded) continue;
        const d = new Date(p.created);
        const y = d.getFullYear();
        const q = Math.floor(d.getMonth() / 3) + 1;
        const yKey = String(y);
        const qKey = `${y}-Q${q}`;
        map[yKey] = (map[yKey] || 0) + (p.amount || 0);
        map[qKey] = (map[qKey] || 0) + (p.amount || 0);
      }
    }
    return map;
  }, [stripeDataMap]);

  const totalMonthlyTarget = useMemo(() => {
    return Object.values(clientFullSettings).reduce((sum: number, s: any) => sum + (Number(s?.mrr) || 0), 0);
  }, [clientFullSettings]);
  const targetAttainment = totalMonthlyTarget > 0 ? (totalMRR / totalMonthlyTarget) * 100 : 0;

  // ============ Expanded KPIs ============
  const expandedKpis: BillingKpis = useMemo(() => {
    // Prior YTD (last calendar year same range) and prior month from Stripe payments
    const lastYear = now.getFullYear() - 1;
    const dayOfYear = differenceInCalendarDays(now, new Date(now.getFullYear(), 0, 1));
    let priorYtd = 0;
    let priorMtd = 0;
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const thisDayLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
    for (const data of Object.values(stripeDataMap) as any[]) {
      if (!data?.payments) continue;
      for (const p of data.payments) {
        if (p.status !== 'succeeded' || p.refunded) continue;
        const d = new Date(p.created);
        if (d.getFullYear() === lastYear && differenceInCalendarDays(d, new Date(lastYear, 0, 1)) <= dayOfYear) {
          priorYtd += p.amount;
        }
        if (d >= lastMonthStart && d <= thisDayLastMonth) priorMtd += p.amount;
      }
    }

    // Outstanding / overdue / failed from internal tables
    const today = new Date();
    const outstanding = billingInvoices.reduce((s, i) => s + Number(i.amount_outstanding || 0), 0);
    const overdue = billingInvoices
      .filter(i => i.due_date && new Date(i.due_date) < today && Number(i.amount_outstanding) > 0)
      .reduce((s, i) => s + Number(i.amount_outstanding || 0), 0);
    const failedCount = billingPayments.filter(p => p.status === 'failed').length;

    // Subscription counts
    let activeSubs = 0;
    let noSubConnected = 0;
    for (const row of clientRows) {
      if (row.subStatus === 'active') activeSubs++;
      else if (row.isConnected && !row.subStatus) noSubConnected++;
    }
    const activeClients = clients.filter(c => c.status === 'active').length;

    const arpu = activeSubs > 0 ? totalMRR / activeSubs : 0;

    // 30-day forecast: active MRR (scaled by remaining days in current cycle) + scheduled invoices in next 30d
    const next30 = addDays(now, 30);
    const scheduledInvoiceCash = billingInvoices
      .filter(i => i.due_date && new Date(i.due_date) >= now && new Date(i.due_date) <= next30)
      .reduce((s, i) => s + Number(i.amount_outstanding || 0), 0);
    const forecast30d = totalMRR + scheduledInvoiceCash;

    // Projected MRR = active MRR + signed agreements not yet active in Stripe
    const agreedMRR = billingAgreements
      .filter(a => a.active && a.billing_frequency === 'monthly')
      .reduce((s, a) => s + Number(a.base_fee || 0), 0);
    const projectedMRR = Math.max(totalMRR, agreedMRR);

    const ytdChg = priorYtd > 0 ? ((kpis.totalRevThisYear - priorYtd) / priorYtd) * 100 : null;
    const mtdChg = priorMtd > 0 ? ((kpis.monthToDate - priorMtd) / priorMtd) * 100 : null;

    return {
      collectedYTD: kpis.totalRevThisYear,
      collectedMTD: kpis.monthToDate,
      activeMRR: effectiveMRR,
      projectedMRR: Math.max(projectedMRR, effectiveMRR),
      arpu,
      outstanding,
      overdue,
      failedCount,
      activeClients,
      activeSubscriptions: activeSubs,
      noSubscription: noSubConnected,
      targetAttainmentPct: targetAttainment,
      forecast30d: effectiveMRR + scheduledInvoiceCash,
      monthlySpark: kpis.monthlyTotals.slice(0, now.getMonth() + 1),
      ytdPriorChange: ytdChg,
      mtdPriorChange: mtdChg,
      mrrPriorChange: null,
    };
  }, [stripeDataMap, billingInvoices, billingPayments, billingAgreements, clients, clientRows, totalMRR, effectiveMRR, targetAttainment, kpis, now]);

  // ============ Action queue (derived + stored) ============
  const clientNameById = useMemo(() => new Map(clients.map(c => [c.id, c.name] as const)), [clients]);
  const queueItems: QueueItem[] = useMemo(() => {
    const today = new Date();
    const items: QueueItem[] = [];

    // Persisted actions first
    for (const a of billingActions) {
      items.push({
        id: a.id,
        clientId: a.client_id,
        clientName: clientNameById.get(a.client_id) || 'Unknown',
        actionType: (a.action_type as any) || 'invoice_needed',
        amount: a.amount,
        dueDate: a.due_date,
        recommendation: a.notes || 'Review and resolve.',
        priority: a.priority,
      });
    }

    // Derived: overdue + due-soon from invoices
    for (const inv of billingInvoices) {
      if (Number(inv.amount_outstanding) <= 0) continue;
      if (!inv.due_date) continue;
      const days = differenceInCalendarDays(new Date(inv.due_date), today);
      if (days < 0) {
        items.push({
          id: `inv-overdue-${inv.id}`,
          clientId: inv.client_id,
          clientName: clientNameById.get(inv.client_id) || 'Unknown',
          actionType: 'overdue',
          amount: Number(inv.amount_outstanding),
          dueDate: inv.due_date,
          recommendation: `Invoice ${inv.invoice_number ?? ''} is ${Math.abs(days)} day(s) overdue — chase payment.`,
          priority: 1,
        });
      } else if (days <= 7) {
        items.push({
          id: `inv-due-${inv.id}`,
          clientId: inv.client_id,
          clientName: clientNameById.get(inv.client_id) || 'Unknown',
          actionType: 'due_soon',
          amount: Number(inv.amount_outstanding),
          dueDate: inv.due_date,
          recommendation: `Invoice ${inv.invoice_number ?? ''} due in ${days} day(s).`,
          priority: 3,
        });
      }
    }

    // Derived: failed payments
    for (const p of billingPayments) {
      if (p.status !== 'failed') continue;
      items.push({
        id: `pay-failed-${p.id}`,
        clientId: p.client_id,
        clientName: clientNameById.get(p.client_id) || 'Unknown',
        actionType: 'failed_payment',
        amount: Number(p.amount),
        dueDate: p.next_retry_date,
        recommendation: p.failure_reason || 'Stripe reported a failed charge — retry or contact client.',
        priority: 1,
      });
    }

    // Derived: stripe-not-linked + missing subscription
    for (const row of clientRows) {
      if (row.client.status !== 'active') continue;
      if (!row.isConnected) {
        items.push({
          id: `nolink-${row.client.id}`,
          clientId: row.client.id,
          clientName: row.client.name,
          actionType: 'stripe_not_linked',
          recommendation: 'Link this client to a Stripe customer to enable billing.',
          priority: 4,
        });
      } else if (!row.subStatus) {
        items.push({
          id: `nosub-${row.client.id}`,
          clientId: row.client.id,
          clientName: row.client.name,
          actionType: 'invoice_needed',
          recommendation: 'Client linked but has no active subscription — invoice or create one.',
          priority: 3,
        });
      }
    }

    // Derived: contract ending soon
    for (const a of billingAgreements) {
      if (!a.active || !a.contract_end_date) continue;
      const days = differenceInCalendarDays(new Date(a.contract_end_date), today);
      if (days >= 0 && days <= 30) {
        items.push({
          id: `end-${a.id}`,
          clientId: a.client_id,
          clientName: clientNameById.get(a.client_id) || 'Unknown',
          actionType: 'contract_ending',
          dueDate: a.contract_end_date,
          recommendation: `Contract ends in ${days} day(s) — confirm renewal.`,
          priority: 4,
        });
      }
    }

    return items;
  }, [billingActions, billingInvoices, billingPayments, billingAgreements, clientRows, clientNameById]);

  const handleActOnItem = (it: QueueItem) => {
    const row = clientRows.find(r => r.client.id === it.clientId);
    if (row?.customerId) {
      const mode: 'invoice' | 'charge' = it.actionType === 'failed_payment' ? 'charge' : 'invoice';
      openChargeModal(it.clientId, it.clientName, row.customerId, mode);
    } else {
      startLink(it.clientId, it.clientName);
    }
  };

  const saveTarget = async (clientId: string) => {
    const v = parseFloat(targetDraft);
    if (Number.isNaN(v) || v < 0) {
      toast.error('Enter a valid amount');
      return;
    }
    try {
      await updateSettings.mutateAsync({ client_id: clientId, mrr: v } as any);
      toast.success('Monthly target updated');
      setEditingTargetId(null);
    } catch (e: any) {
      toast.error(e?.message || 'Failed to save target');
    }
  };

  const startLink = (clientId: string, clientName: string) => {
    const guess =
      (clients.find((c) => c.id === clientId) as any)?.notification_email || '';
    setLinkEmail(guess);
    setLinkingClientId(clientId);
  };

  const saveLink = async (clientId: string) => {
    const email = linkEmail.trim();
    if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
      toast.error('Enter a valid email');
      return;
    }
    setLinkSubmitting(true);
    try {
      await updateSettings.mutateAsync({
        client_id: clientId,
        stripe_email: email,
      } as any);
      toast.success('Linked — syncing Stripe…');
      setLinkingClientId(null);
      setLinkEmail('');
      refetch();
    } catch (err: any) {
      toast.error(err?.message || 'Failed to link');
    } finally {
      setLinkSubmitting(false);
    }
  };

  // Client rows with months since first charge
  const clientRowsWithMonths = useMemo(() => {
    return clientRows.map(row => {
      const stripeData = stripeDataMap[row.client.id];
      let monthsSinceFirstCharge: number | null = null;
      if (stripeData?.payments?.length) {
        const sortedPayments = [...stripeData.payments]
          .filter(p => p.status === 'succeeded')
          .sort((a, b) => new Date(a.created).getTime() - new Date(b.created).getTime());
        if (sortedPayments.length > 0) {
          monthsSinceFirstCharge = differenceInMonths(now, new Date(sortedPayments[0].created));
        }
      }
      return { ...row, monthsSinceFirstCharge };
    });
  }, [clientRows, stripeDataMap, now]);

  const openChargeModal = async (clientId: string, clientName: string, customerId: string, mode: 'invoice' | 'charge') => {
    setChargeModal({ clientId, clientName, customerId, mode });
    setChargeAmount('');
    setChargeDescription('');
    setChargeDays('30');
    setSelectedPaymentMethod('default');
    setPaymentMethods([]);

    if (mode === 'charge') {
      setLoadingMethods(true);
      try {
        const { data } = await supabase.functions.invoke('stripe-payments', {
          body: { action: 'list-payment-methods', customerId },
        });
        setPaymentMethods(data?.payment_methods || []);
      } catch {
        // ignore
      } finally {
        setLoadingMethods(false);
      }
    }
  };

  const handleSubmit = async () => {
    if (!chargeModal) return;
    const amt = parseFloat(chargeAmount);
    if (!amt || amt <= 0) { toast.error('Enter a valid amount'); return; }

    setSubmitting(true);
    try {
      if (chargeModal.mode === 'invoice') {
        const { data, error } = await supabase.functions.invoke('stripe-payments', {
          body: {
            action: 'create-invoice',
            customerId: chargeModal.customerId,
            amount: amt,
            description: chargeDescription || `Invoice for ${chargeModal.clientName}`,
            daysUntilDue: parseInt(chargeDays) || 30,
          },
        });
        if (error) throw error;
        toast.success(`Invoice #${data.invoice.number} sent!`);
      } else {
        const body: any = {
          action: 'create-charge',
          customerId: chargeModal.customerId,
          amount: amt,
          description: chargeDescription || `Charge for ${chargeModal.clientName}`,
        };
        if (selectedPaymentMethod !== 'default') {
          body.paymentMethodId = selectedPaymentMethod;
        }
        const { data, error } = await supabase.functions.invoke('stripe-payments', { body });
        if (error) throw error;
        const pm = data.payment?.payment_method;
        const pmLabel = pm ? ` (${pm.brand?.toUpperCase()} ••••${pm.last4})` : '';
        if (data.payment.status === 'succeeded') {
          toast.success(`Payment of ${formatCurrency(amt)} succeeded${pmLabel}`);
        } else {
          toast.warning(`Payment status: ${data.payment.status}${pmLabel}`);
        }
      }
      setChargeModal(null);
      refetch();
    } catch (err: any) {
      console.error('Billing error:', err);
      toast.error(err.message || 'Failed to process');
    } finally {
      setSubmitting(false);
    }
  };

  const statusBadge = (status: string | undefined) => {
    if (!status) return null;
    const variant = status === 'active' ? 'default' : status === 'past_due' ? 'destructive' : 'secondary';
    return <Badge variant={variant}>{status}</Badge>;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold tracking-tight">Agency Billing & Revenue</h2>
          <p className="text-sm text-muted-foreground">Internal command center — collected revenue, MRR, outstanding, forecast, and action queue.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isLoading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Expanded KPI grid (13 cards) */}
      <BillingKpiGrid kpis={expandedKpis} />

      {/* Action queue */}
      <BillingActionQueue items={queueItems} onAct={handleActOnItem} />

      {/* Forecast & graphs */}
      <BillingForecastChart
        stripeDataMap={stripeDataMap}
        totalMRR={effectiveMRR}
        clientNameMap={Object.fromEntries(clients.map((c) => [c.id, c.name]))}
      />

      {/* Revenue targets — quarterly + yearly with pace tracking */}
      <BillingTargetsPanel actualByKey={actualByPeriodKey} activeMRR={effectiveMRR} />

      {/* Client billing overview */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-bold">Client Billing Overview</h3>
          <p className="text-xs text-muted-foreground">Per-client subscriptions, targets, and quick actions.</p>
        </div>
      </div>

      {/* Client billing table */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
               <TableRow>
                  <TableHead>Client</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Monthly Sub</TableHead>
                  <TableHead className="text-right">Target / Actual</TableHead>
                  <TableHead className="text-right">Total Paid</TableHead>
                  <TableHead>Next Billing</TableHead>
                  <TableHead>Client Since</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {clientRowsWithMonths.map(({ client, isConnected, customerId, customerEmail, mrr, totalPaid, nextBilling, subStatus, interval, monthsSinceFirstCharge }) => (
                  (() => {
                    const settings = clientFullSettings[client.id] as any;
                    const target = Number(settings?.mrr) || 0;
                    const attain = target > 0 ? (mrr / target) * 100 : 0;
                    const attainColor = attain >= 100 ? 'text-chart-2' : attain >= 75 ? 'text-amber-500' : target > 0 ? 'text-destructive' : 'text-muted-foreground';
                    return (
                  <TableRow key={client.id}>
                    <TableCell>
                      <div>
                        <p className="font-medium">{client.name}</p>
                        {customerEmail && <p className="text-xs text-muted-foreground">{customerEmail}</p>}
                      </div>
                    </TableCell>
                    <TableCell>
                      {isConnected ? (
                        statusBadge(subStatus) || <Badge variant="destructive">No Sub</Badge>
                      ) : (
                        <Badge variant="secondary">Not Linked</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-bold tabular-nums">
                      {isConnected ? formatCurrency(mrr) : '—'}
                      {interval && <span className="text-xs text-muted-foreground ml-1">/{interval}</span>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {editingTargetId === client.id ? (
                        <div className="flex gap-1 justify-end items-center">
                          <Input
                            autoFocus
                            type="number"
                            min="0"
                            step="100"
                            value={targetDraft}
                            onChange={(e) => setTargetDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') saveTarget(client.id);
                              if (e.key === 'Escape') setEditingTargetId(null);
                            }}
                            className="h-7 w-24 text-xs"
                          />
                          <Button size="sm" className="h-7 px-2" onClick={() => saveTarget(client.id)}>
                            <Check className="h-3 w-3" />
                          </Button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="text-right hover:underline"
                          onClick={() => { setEditingTargetId(client.id); setTargetDraft(String(target || '')); }}
                          title="Click to edit monthly target"
                        >
                          <div className="text-xs text-muted-foreground">
                            target {target > 0 ? formatCurrency(target) : '—'}
                          </div>
                          <div className={`text-sm font-semibold ${attainColor}`}>
                            {target > 0 ? `${attain.toFixed(0)}%` : 'set target'}
                          </div>
                        </button>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {isConnected ? formatCurrency(totalPaid) : '—'}
                    </TableCell>
                    <TableCell>
                      {nextBilling ? format(new Date(nextBilling), 'MMM d, yyyy') : '—'}
                    </TableCell>
                    <TableCell>
                      {monthsSinceFirstCharge !== null ? (
                        <span className="text-sm font-medium tabular-nums">
                          {monthsSinceFirstCharge} {monthsSinceFirstCharge === 1 ? 'month' : 'months'}
                        </span>
                      ) : '—'}
                    </TableCell>
                    <TableCell className="text-right">
                      {isConnected && customerId ? (
                        <div className="flex gap-1 justify-end">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => openChargeModal(client.id, client.name, customerId, 'invoice')}
                          >
                            <Send className="h-3 w-3 mr-1" />
                            Invoice
                          </Button>
                          <Button
                            variant="default"
                            size="sm"
                            onClick={() => openChargeModal(client.id, client.name, customerId, 'charge')}
                          >
                            <Zap className="h-3 w-3 mr-1" />
                            Charge
                          </Button>
                        </div>
                      ) : (
                        linkingClientId === client.id ? (
                          <div className="flex gap-1 justify-end items-center">
                            <Input
                              autoFocus
                              type="email"
                              placeholder="billing@client.com"
                              value={linkEmail}
                              onChange={(e) => setLinkEmail(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') saveLink(client.id);
                                if (e.key === 'Escape') setLinkingClientId(null);
                              }}
                              className="h-8 w-56 text-xs"
                            />
                            <Button
                              size="sm"
                              onClick={() => saveLink(client.id)}
                              disabled={linkSubmitting}
                            >
                              {linkSubmitting ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <Check className="h-3 w-3" />
                              )}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setLinkingClientId(null)}
                              disabled={linkSubmitting}
                            >
                              Cancel
                            </Button>
                          </div>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => startLink(client.id, client.name)}
                          >
                            <Link2 className="h-3 w-3 mr-1" />
                            Link Stripe
                          </Button>
                        )
                      )}
                    </TableCell>
                  </TableRow>
                    );
                  })()
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Charge / Invoice Dialog */}
      <Dialog open={!!chargeModal} onOpenChange={(open) => !open && setChargeModal(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {chargeModal?.mode === 'invoice' ? 'Send Invoice' : 'Direct Charge'} — {chargeModal?.clientName}
            </DialogTitle>
            <DialogDescription>
              {chargeModal?.mode === 'invoice'
                ? 'Create and email a Stripe invoice to this client.'
                : 'Charge the client\'s payment method on file immediately.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <Label>Amount ($)</Label>
              <Input type="number" min="0" step="0.01" placeholder="500.00" value={chargeAmount} onChange={e => setChargeAmount(e.target.value)} />
            </div>
            <div>
              <Label>Description</Label>
              <Input placeholder="Ad spend overage" value={chargeDescription} onChange={e => setChargeDescription(e.target.value)} />
            </div>
            {chargeModal?.mode === 'invoice' && (
              <div>
                <Label>Days Until Due</Label>
                <Input type="number" min="1" value={chargeDays} onChange={e => setChargeDays(e.target.value)} />
              </div>
            )}
            {chargeModal?.mode === 'charge' && (
              <div>
                <Label>Payment Method</Label>
                {loadingMethods ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                    <Loader2 className="h-4 w-4 animate-spin" /> Loading methods...
                  </div>
                ) : (
                  <Select value={selectedPaymentMethod} onValueChange={setSelectedPaymentMethod}>
                    <SelectTrigger>
                      <SelectValue placeholder="Default method" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="default">Default on file</SelectItem>
                      {paymentMethods.map(pm => (
                        <SelectItem key={pm.id} value={pm.id}>
                          <span className="flex items-center gap-2">
                            <CreditCard className="h-3 w-3" />
                            {pm.brand?.toUpperCase()} ••••{pm.last4} ({pm.exp_month}/{pm.exp_year})
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setChargeModal(null)}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={submitting}>
              {submitting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : chargeModal?.mode === 'invoice' ? <Send className="h-4 w-4 mr-2" /> : <Zap className="h-4 w-4 mr-2" />}
              {chargeModal?.mode === 'invoice' ? 'Send Invoice' : 'Charge Now'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
