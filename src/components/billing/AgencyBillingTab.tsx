import { useState, useMemo } from 'react';
import { Client } from '@/hooks/useClients';
import { useAllClientFullSettings } from '@/hooks/useAllClientSettings';
import { useAllClientsStripePayments, StripeCustomerData } from '@/hooks/useStripePayments';
import { useUpdateClientSettings } from '@/hooks/useClientSettings';
import { BillingForecastChart } from './BillingForecastChart';
import { Sparkline } from '@/components/dashboard/Sparkline';
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
import { format, startOfMonth, startOfYear, subMonths, differenceInMonths } from 'date-fns';
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
  const [linkingClientId, setLinkingClientId] = useState<string | null>(null);
  const [linkEmail, setLinkEmail] = useState('');
  const [linkSubmitting, setLinkSubmitting] = useState(false);

  // Build email map for Stripe lookup
  const clientEmails = useMemo(() => {
    const map: Record<string, string> = {};
    for (const client of clients) {
      const settings = clientFullSettings[client.id];
      const email = (settings as any)?.stripe_email || (settings as any)?.stripe_customer_id;
      if (email) map[client.id] = email;
    }
    return map;
  }, [clients, clientFullSettings]);

  const { data: stripeDataMap = {}, isLoading, refetch } = useAllClientsStripePayments(clientEmails);

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
      {/* KPI Scorecards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="border-2">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground flex items-center gap-1"><TrendingUp className="h-3 w-3" /> Total Rev This Year</p>
                <p className="text-2xl font-bold mt-1">{formatCurrency(kpis.totalRevThisYear)}</p>
              </div>
              <div className="w-20">
                <Sparkline data={kpis.sparklineData} height={32} />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-2">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground flex items-center gap-1"><Calendar className="h-3 w-3" /> Month To Date</p>
                <p className="text-2xl font-bold mt-1">{formatCurrency(kpis.monthToDate)}</p>
              </div>
              <div className="w-20">
                <Sparkline data={kpis.monthlyTotals.slice(Math.max(0, now.getMonth() - 5), now.getMonth() + 1)} height={32} />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-2">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground flex items-center gap-1"><DollarSign className="h-3 w-3" /> Avg Per Month</p>
                <p className="text-2xl font-bold mt-1">{formatCurrency(kpis.avgPerMonth)}</p>
              </div>
              <div className="w-20">
                <Sparkline data={kpis.sparklineData} height={32} />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Enhanced Stats Row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="border-2">
          <CardContent className="p-5 flex items-center gap-3">
            <Users className="h-6 w-6 text-primary" />
            <div>
              <p className="text-2xl font-bold">{enhancedStats.totalClients}</p>
              <p className="text-xs text-muted-foreground">Total Clients</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-2">
          <CardContent className="p-5 flex items-center gap-3">
            <CreditCard className="h-6 w-6 text-chart-2" />
            <div>
              <p className="text-2xl font-bold">{enhancedStats.activeSubscriptions}</p>
              <p className="text-xs text-muted-foreground">Active Subscriptions</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-2">
          <CardContent className="p-5 flex items-center gap-3">
            <AlertTriangle className="h-6 w-6 text-destructive" />
            <div>
              <p className="text-2xl font-bold text-destructive">{enhancedStats.noSubscription}</p>
              <p className="text-xs text-muted-foreground">No Subscription</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Forecast & graphs */}
      <BillingForecastChart
        stripeDataMap={stripeDataMap}
        totalMRR={totalMRR}
        clientNameMap={Object.fromEntries(clients.map((c) => [c.id, c.name]))}
      />

      {/* Actions bar */}
      <div className="flex items-center justify-between">
        <h3 className="text-base font-bold">Client Billing Overview</h3>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isLoading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
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
                  <TableHead className="text-right">Total Paid</TableHead>
                  <TableHead>Next Billing</TableHead>
                  <TableHead>Client Since</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {clientRowsWithMonths.map(({ client, isConnected, customerId, customerEmail, mrr, totalPaid, nextBilling, subStatus, interval, monthsSinceFirstCharge }) => (
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
