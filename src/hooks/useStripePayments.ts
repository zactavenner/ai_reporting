import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface StripePayment {
  id: string;
  amount: number;
  currency: string;
  status: string;
  created: string;
  description: string | null;
  receipt_url: string | null;
  refunded: boolean;
}

export interface StripeSubscription {
  id: string;
  status: string;
  cancel_at_period_end?: boolean;
  pause_collection?: { behavior: string } | null;
  current_period_start: string;
  current_period_end: string;
  items: {
    price_id: string;
    product_id: string;
    unit_amount: number;
    currency: string;
    interval: string;
    quantity: number;
  }[];
}

export interface StripeCustomerData {
  customer: {
    id: string;
    email: string;
    name: string | null;
    created: string;
  } | null;
  payments: StripePayment[];
  subscriptions: StripeSubscription[];
  totalPaid: number;
  mrr: number;
}

export function useStripePayments(emailOrCustomerId: string | null | undefined) {
  return useQuery({
    queryKey: ['stripe-payments', emailOrCustomerId],
    queryFn: async (): Promise<StripeCustomerData> => {
      if (!emailOrCustomerId) {
        return { customer: null, payments: [], subscriptions: [], totalPaid: 0, mrr: 0 };
      }

      const body: any = { action: 'get-customer-payments' };
      if (emailOrCustomerId.startsWith('cus_')) {
        body.customerId = emailOrCustomerId;
      } else {
        body.email = emailOrCustomerId;
      }

      const { data, error } = await supabase.functions.invoke('stripe-payments', { body });

      if (error) {
        console.error('Stripe payments error:', error);
        throw error;
      }

      return data;
    },
    enabled: !!emailOrCustomerId,
    staleTime: 5 * 60 * 1000,
  });
}

export function useAllClientsStripePayments(clientEmails: Record<string, string>) {
  return useQuery({
    queryKey: ['all-clients-stripe-payments', Object.keys(clientEmails)],
    queryFn: async (): Promise<Record<string, StripeCustomerData>> => {
      const results: Record<string, StripeCustomerData> = {};
      
      // Process emails in parallel (batch of 5)
      const entries = Object.entries(clientEmails);
      const batchSize = 5;
      
      for (let i = 0; i < entries.length; i += batchSize) {
        const batch = entries.slice(i, i + batchSize);
        const promises = batch.map(async ([clientId, email]) => {
          try {
            const { data, error } = await supabase.functions.invoke('stripe-payments', {
              body: { email, action: 'get-customer-payments' },
            });
            
            if (error) {
              console.error(`Stripe error for ${email}:`, error);
              return [clientId, { customer: null, payments: [], subscriptions: [], totalPaid: 0, mrr: 0 }];
            }
            
            return [clientId, data];
          } catch (err) {
            console.error(`Stripe error for ${email}:`, err);
            return [clientId, { customer: null, payments: [], subscriptions: [], totalPaid: 0, mrr: 0 }];
          }
        });
        
        const batchResults = await Promise.all(promises);
        batchResults.forEach(([clientId, data]) => {
          results[clientId as string] = data as StripeCustomerData;
        });
      }
      
      return results;
    },
    enabled: Object.keys(clientEmails).length > 0,
    staleTime: 5 * 60 * 1000,
  });
}
