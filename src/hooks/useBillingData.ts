import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface BillingAgreement {
  id: string;
  client_id: string;
  billing_type: string;
  base_fee: number;
  setup_fee: number;
  remaining_setup_fee: number;
  included_ad_spend: number;
  variable_fee_percentage: number;
  performance_fee_percentage: number;
  billing_frequency: string;
  billing_day: number;
  auto_charge: boolean;
  approval_required: boolean;
  contract_start_date: string | null;
  contract_end_date: string | null;
  notes: string | null;
  active: boolean;
}

export interface BillingInvoice {
  id: string;
  client_id: string;
  invoice_number: string | null;
  billing_period_start: string | null;
  billing_period_end: string | null;
  issue_date: string | null;
  due_date: string | null;
  amount: number;
  amount_paid: number;
  amount_outstanding: number;
  status: string;
  paid_date: string | null;
  stripe_invoice_id: string | null;
  hosted_url: string | null;
}

export interface BillingPayment {
  id: string;
  client_id: string;
  invoice_id: string | null;
  payment_date: string | null;
  attempted_at: string;
  amount: number;
  payment_method: string | null;
  status: string;
  failure_reason: string | null;
  next_retry_date: string | null;
  stripe_payment_intent_id: string | null;
  stripe_charge_id: string | null;
}

export interface BillingAction {
  id: string;
  client_id: string;
  action_type: string;
  priority: number;
  amount: number | null;
  due_date: string | null;
  assigned_to: string | null;
  status: string;
  notes: string | null;
  related_invoice_id: string | null;
  related_payment_id: string | null;
  created_at: string;
}

export function useBillingAgreements() {
  return useQuery({
    queryKey: ['billing-agreements'],
    queryFn: async (): Promise<BillingAgreement[]> => {
      const { data, error } = await (supabase as any)
        .from('billing_agreements')
        .select('*');
      if (error) throw error;
      return (data || []) as BillingAgreement[];
    },
    staleTime: 60_000,
  });
}

export function useBillingInvoices() {
  return useQuery({
    queryKey: ['billing-invoices'],
    queryFn: async (): Promise<BillingInvoice[]> => {
      const { data, error } = await (supabase as any)
        .from('billing_invoices')
        .select('*')
        .order('issue_date', { ascending: false });
      if (error) throw error;
      return (data || []) as BillingInvoice[];
    },
    staleTime: 30_000,
  });
}

export function useBillingPayments() {
  return useQuery({
    queryKey: ['billing-payments'],
    queryFn: async (): Promise<BillingPayment[]> => {
      const { data, error } = await (supabase as any)
        .from('billing_payments')
        .select('*')
        .order('attempted_at', { ascending: false });
      if (error) throw error;
      return (data || []) as BillingPayment[];
    },
    staleTime: 30_000,
  });
}

export function useBillingActions() {
  return useQuery({
    queryKey: ['billing-actions'],
    queryFn: async (): Promise<BillingAction[]> => {
      const { data, error } = await (supabase as any)
        .from('billing_actions')
        .select('*')
        .eq('status', 'open')
        .order('priority', { ascending: true })
        .order('due_date', { ascending: true });
      if (error) throw error;
      return (data || []) as BillingAction[];
    },
    staleTime: 15_000,
  });
}
