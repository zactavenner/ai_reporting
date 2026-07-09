import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", {
      apiVersion: "2025-08-27.basil",
    });

    const { email, clientId, action, customerId, amount, currency, description, daysUntilDue, lineItems, paymentMethodId, priceId, quantity, subscriptionId, cancelAtPeriodEnd } = await req.json();
    console.log(`Stripe request: action=${action}, email=${email}, customerId=${customerId}`);

    // ── get-customer-payments (existing) ──
    if (action === "get-customer-payments") {
      if (!email && !customerId) {
        return new Response(
          JSON.stringify({ customer: null, payments: [], subscriptions: [], totalPaid: 0, mrr: 0 }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
        );
      }

      let customer: any = null;
      if (customerId) {
        try { customer = await stripe.customers.retrieve(customerId); } catch (_) {}
      }
      if (!customer && email) {
        const customers = await stripe.customers.list({ email, limit: 1 });
        customer = customers.data[0] || null;
      }

      if (!customer || customer.deleted) {
        return new Response(
          JSON.stringify({ customer: null, payments: [], subscriptions: [], totalPaid: 0, mrr: 0 }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
        );
      }

      // Paginate ALL charges so historical revenue isn't truncated at 100.
      const allCharges: any[] = [];
      let startingAfter: string | undefined = undefined;
      // Safety cap: 20 pages * 100 = 2000 charges per client.
      for (let i = 0; i < 20; i++) {
        const page: any = await stripe.charges.list({
          customer: customer.id,
          limit: 100,
          ...(startingAfter ? { starting_after: startingAfter } : {}),
        });
        allCharges.push(...page.data);
        if (!page.has_more || page.data.length === 0) break;
        startingAfter = page.data[page.data.length - 1].id;
      }
      const charges = { data: allCharges };
      const subscriptions = await stripe.subscriptions.list({ customer: customer.id, status: 'active', limit: 10 });

      const totalPaid = charges.data
        .filter((c: any) => c.status === 'succeeded' && !c.refunded)
        .reduce((sum: number, c: any) => sum + c.amount, 0) / 100;

      let mrr = 0;
      for (const sub of subscriptions.data) {
        for (const item of sub.items.data) {
          const price = item.price;
          if (price.recurring) {
            let monthlyAmount = price.unit_amount || 0;
            switch (price.recurring.interval) {
              case 'day': monthlyAmount *= 30; break;
              case 'week': monthlyAmount *= 4; break;
              case 'year': monthlyAmount /= 12; break;
            }
            mrr += (monthlyAmount * (item.quantity || 1)) / 100;
          }
        }
      }

      const payments = charges.data.map((charge: any) => ({
        id: charge.id,
        amount: charge.amount / 100,
        currency: charge.currency,
        status: charge.status,
        created: new Date(charge.created * 1000).toISOString(),
        description: charge.description,
        receipt_url: charge.receipt_url,
        refunded: charge.refunded,
      }));

      const formattedSubscriptions = subscriptions.data.map((sub: any) => ({
        id: sub.id,
        status: sub.status,
        cancel_at_period_end: !!sub.cancel_at_period_end,
        pause_collection: sub.pause_collection || null,
        current_period_start: sub.current_period_start ? new Date(sub.current_period_start * 1000).toISOString() : null,
        current_period_end: sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null,
        items: sub.items.data.map((item: any) => ({
          price_id: item.price.id,
          product_id: typeof item.price.product === 'string' ? item.price.product : item.price.product?.id,
          unit_amount: (item.price.unit_amount || 0) / 100,
          currency: item.price.currency,
          interval: item.price.recurring?.interval,
          quantity: item.quantity,
        })),
      }));

      return new Response(
        JSON.stringify({
          customer: {
            id: customer.id,
            email: customer.email,
            name: customer.name,
            created: new Date(customer.created * 1000).toISOString(),
          },
          payments,
          subscriptions: formattedSubscriptions,
          totalPaid,
          mrr,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

    // ── search-customer ──
    if (action === "search-customer") {
      if (!email) {
        return new Response(
          JSON.stringify({ customer: null }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
        );
      }
      const customers = await stripe.customers.list({ email, limit: 1 });
      const customer = customers.data[0] || null;
      return new Response(
        JSON.stringify({
          customer: customer ? {
            id: customer.id,
            email: customer.email,
            name: customer.name,
            created: new Date(customer.created * 1000).toISOString(),
          } : null,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

    // ── create-invoice ──
    if (action === "create-invoice") {
      if (!customerId) {
        return new Response(
          JSON.stringify({ error: "customerId is required" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
        );
      }

      const invoiceData: any = {
        customer: customerId,
        collection_method: 'send_invoice',
        days_until_due: daysUntilDue || 30,
        auto_advance: true,
      };
      if (description) invoiceData.description = description;

      const invoice = await stripe.invoices.create(invoiceData);

      // Add line items
      if (lineItems && Array.isArray(lineItems)) {
        for (const item of lineItems) {
          await stripe.invoiceItems.create({
            customer: customerId,
            invoice: invoice.id,
            amount: Math.round((item.amount || 0) * 100),
            currency: item.currency || currency || 'usd',
            description: item.description || 'Service charge',
          });
        }
      } else if (amount) {
        await stripe.invoiceItems.create({
          customer: customerId,
          invoice: invoice.id,
          amount: Math.round(amount * 100),
          currency: currency || 'usd',
          description: description || 'Service charge',
        });
      }

      // Finalize and send
      const finalizedInvoice = await stripe.invoices.finalizeInvoice(invoice.id);
      await stripe.invoices.sendInvoice(finalizedInvoice.id);

      console.log(`Invoice ${finalizedInvoice.id} created and sent for customer ${customerId}`);

      return new Response(
        JSON.stringify({
          invoice: {
            id: finalizedInvoice.id,
            number: finalizedInvoice.number,
            amount_due: (finalizedInvoice.amount_due || 0) / 100,
            status: finalizedInvoice.status,
            hosted_invoice_url: finalizedInvoice.hosted_invoice_url,
            due_date: finalizedInvoice.due_date ? new Date(finalizedInvoice.due_date * 1000).toISOString() : null,
          },
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

    // ── list-invoices ──
    if (action === "list-invoices") {
      if (!customerId) {
        return new Response(
          JSON.stringify({ invoices: [] }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
        );
      }

      const invoices = await stripe.invoices.list({ customer: customerId, limit: 50 });

      const formattedInvoices = invoices.data.map((inv: any) => ({
        id: inv.id,
        number: inv.number,
        amount_due: (inv.amount_due || 0) / 100,
        amount_paid: (inv.amount_paid || 0) / 100,
        status: inv.status,
        created: new Date(inv.created * 1000).toISOString(),
        due_date: inv.due_date ? new Date(inv.due_date * 1000).toISOString() : null,
        hosted_invoice_url: inv.hosted_invoice_url,
        invoice_pdf: inv.invoice_pdf,
      }));

      return new Response(
        JSON.stringify({ invoices: formattedInvoices }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

    // ── list-payment-methods ──
    if (action === "list-payment-methods") {
      if (!customerId) {
        return new Response(
          JSON.stringify({ payment_methods: [] }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
        );
      }
      const methods = await stripe.paymentMethods.list({ customer: customerId, type: 'card', limit: 10 });
      const formatted = methods.data.map((pm: any) => ({
        id: pm.id,
        brand: pm.card?.brand,
        last4: pm.card?.last4,
        exp_month: pm.card?.exp_month,
        exp_year: pm.card?.exp_year,
      }));
      return new Response(
        JSON.stringify({ payment_methods: formatted }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

    // ── create-charge ──
    if (action === "create-charge") {
      if (!customerId || !amount) {
        return new Response(
          JSON.stringify({ error: "customerId and amount are required" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
        );
      }
      const amountCents = Math.round(amount * 100);

      const piData: any = {
        amount: amountCents,
        currency: currency || 'usd',
        customer: customerId,
        description: description || 'Agency charge',
        confirm: true,
        automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
      };
      if (paymentMethodId) {
        piData.payment_method = paymentMethodId;
        delete piData.automatic_payment_methods;
      }

      const paymentIntent = await stripe.paymentIntents.create(piData);
      console.log(`PaymentIntent ${paymentIntent.id} created for customer ${customerId}`);

      // Fetch payment method details for last4 display
      let paymentMethodDetails: any = null;
      const pmId = paymentIntent.payment_method;
      if (pmId) {
        try {
          const pm = await stripe.paymentMethods.retrieve(typeof pmId === 'string' ? pmId : pmId.id);
          if (pm.card) {
            paymentMethodDetails = { type: 'card', brand: pm.card.brand, last4: pm.card.last4 };
          } else if ((pm as any).us_bank_account) {
            paymentMethodDetails = { type: 'bank', brand: (pm as any).us_bank_account.bank_name, last4: (pm as any).us_bank_account.last4 };
          }
        } catch (_) {}
      }

      return new Response(
        JSON.stringify({
          payment: {
            id: paymentIntent.id,
            amount: (paymentIntent.amount || 0) / 100,
            status: paymentIntent.status,
            currency: paymentIntent.currency,
            payment_method: paymentMethodDetails,
          },
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

    // ── list-prices ── returns active recurring prices with product info
    if (action === "list-prices") {
      const prices = await stripe.prices.list({ active: true, limit: 100, expand: ["data.product"] });
      const formatted = prices.data
        .filter((p: any) => p.recurring)
        .map((p: any) => ({
          id: p.id,
          nickname: p.nickname,
          unit_amount: (p.unit_amount || 0) / 100,
          currency: p.currency,
          interval: p.recurring?.interval,
          interval_count: p.recurring?.interval_count,
          product_name: typeof p.product === "object" ? p.product?.name : null,
          product_id: typeof p.product === "object" ? p.product?.id : p.product,
        }));
      return new Response(
        JSON.stringify({ prices: formatted }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

    // ── create-subscription ──
    if (action === "create-subscription") {
      if (!customerId || !priceId) {
        return new Response(
          JSON.stringify({ error: "customerId and priceId are required" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
        );
      }
      const sub = await stripe.subscriptions.create({
        customer: customerId,
        items: [{ price: priceId, quantity: quantity || 1 }],
      });
      console.log(`Subscription ${sub.id} created for customer ${customerId}`);
      return new Response(
        JSON.stringify({ subscription: { id: sub.id, status: sub.status } }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

    // ── update-subscription ── change price or quantity
    if (action === "update-subscription") {
      if (!subscriptionId) {
        return new Response(
          JSON.stringify({ error: "subscriptionId is required" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
        );
      }
      const current = await stripe.subscriptions.retrieve(subscriptionId);
      const firstItem = current.items.data[0];
      const updateItems: any[] = [{
        id: firstItem.id,
        ...(priceId ? { price: priceId } : {}),
        ...(quantity ? { quantity } : {}),
      }];
      const sub = await stripe.subscriptions.update(subscriptionId, {
        items: updateItems,
        proration_behavior: "create_prorations",
      });
      return new Response(
        JSON.stringify({ subscription: { id: sub.id, status: sub.status } }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

    // ── cancel-subscription ── immediate or at period end
    if (action === "cancel-subscription") {
      if (!subscriptionId) {
        return new Response(
          JSON.stringify({ error: "subscriptionId is required" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
        );
      }
      let sub;
      if (cancelAtPeriodEnd) {
        sub = await stripe.subscriptions.update(subscriptionId, { cancel_at_period_end: true });
      } else {
        sub = await stripe.subscriptions.cancel(subscriptionId);
      }
      return new Response(
        JSON.stringify({ subscription: { id: sub.id, status: sub.status, cancel_at_period_end: sub.cancel_at_period_end } }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

    // ── pause-subscription ──
    if (action === "pause-subscription") {
      if (!subscriptionId) {
        return new Response(
          JSON.stringify({ error: "subscriptionId is required" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
        );
      }
      const sub = await stripe.subscriptions.update(subscriptionId, {
        pause_collection: { behavior: "void" },
      });
      return new Response(
        JSON.stringify({ subscription: { id: sub.id, status: sub.status, paused: true } }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

    // ── resume-subscription ──
    if (action === "resume-subscription") {
      if (!subscriptionId) {
        return new Response(
          JSON.stringify({ error: "subscriptionId is required" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
        );
      }
      const sub = await stripe.subscriptions.update(subscriptionId, {
        pause_collection: "",
        cancel_at_period_end: false,
      } as any);
      return new Response(
        JSON.stringify({ subscription: { id: sub.id, status: sub.status } }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

    return new Response(
      JSON.stringify({ error: "Invalid action" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
    );

  } catch (error: any) {
    console.error("Stripe payments error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
