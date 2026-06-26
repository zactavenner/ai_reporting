import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, stripe-signature",
};

const FAILURE_EVENTS = new Set([
  "invoice.payment_failed",
  "charge.failed",
  "payment_intent.payment_failed",
  "customer.subscription.past_due",
]);

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", { apiVersion: "2025-08-27.basil" });
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

  const sig = req.headers.get("stripe-signature");
  const secret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  const raw = await req.text();

  let event: Stripe.Event;
  try {
    if (sig && secret) {
      event = await stripe.webhooks.constructEventAsync(raw, sig, secret);
    } else {
      event = JSON.parse(raw);
      console.warn("[stripe-webhook] no signature verification (missing STRIPE_WEBHOOK_SECRET)");
    }
  } catch (e: any) {
    console.error("[stripe-webhook] signature verification failed", e.message);
    return new Response(JSON.stringify({ error: e.message }), { status: 400, headers: corsHeaders });
  }

  console.log("[stripe-webhook] event:", event.type);

  if (!FAILURE_EVENTS.has(event.type)) {
    return new Response(JSON.stringify({ received: true, ignored: event.type }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const obj: any = event.data.object;
    const customerId: string | undefined = obj.customer;
    let email: string | undefined = obj.customer_email || obj.receipt_email || obj.billing_details?.email;
    let customerName: string | undefined;

    if (customerId && !email) {
      const cust = await stripe.customers.retrieve(customerId);
      if (!(cust as any).deleted) {
        email = (cust as Stripe.Customer).email ?? undefined;
        customerName = (cust as Stripe.Customer).name ?? undefined;
      }
    }

    // Find client: by stripe customer id stored anywhere, then by email match against team members
    let clientId: string | null = null;
    let clientName: string | null = null;

    if (email) {
      const { data: tm } = await supabase
        .from("client_team_members")
        .select("client_id, clients(name)")
        .ilike("email", email)
        .limit(1)
        .maybeSingle();
      if (tm?.client_id) {
        clientId = tm.client_id;
        clientName = (tm as any).clients?.name ?? null;
      }
    }

    // Exact-name match only — fuzzy ilike '%name%' caused wrong clients to be
    // flipped to billing_error when two clients shared a substring.
    if (!clientId && customerName) {
      const { data: c } = await supabase
        .from("clients")
        .select("id, name")
        .ilike("name", customerName)
        .limit(2);
      if (c && c.length === 1) { clientId = c[0].id; clientName = c[0].name; }
      else if (c && c.length > 1) {
        console.warn("[stripe-webhook] ambiguous client name, skipping auto-flag", { customerName, matches: c.length });
      }
    }

    if (!clientId) {
      console.warn("[stripe-webhook] no client matched for", { email, customerName, customerId });
      return new Response(JSON.stringify({ received: true, matched: false }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const amount = (obj.amount_due ?? obj.amount ?? obj.amount_failed ?? 0) / 100;
    const currency = (obj.currency || "usd").toUpperCase();
    const reason = obj.last_payment_error?.message || obj.failure_message || obj.outcome?.seller_message || event.type;
    const invoiceUrl = obj.hosted_invoice_url || null;

    // 1) Flip client status to billing_error
    await supabase.from("clients").update({ status: "billing_error" }).eq("id", clientId);

    // 2) Create a task (dedupe by open task with same stripe event source for today)
    const title = `Billing Error: payment declined${amount ? ` ($${amount.toFixed(2)} ${currency})` : ""}`;
    const description = [
      `Stripe event: ${event.type}`,
      `Customer: ${email || customerName || customerId}`,
      `Reason: ${reason}`,
      invoiceUrl ? `Invoice: ${invoiceUrl}` : null,
    ].filter(Boolean).join("\n");

    const { data: existing } = await supabase
      .from("tasks")
      .select("id")
      .eq("client_id", clientId)
      .eq("title", title)
      .neq("status", "done")
      .limit(1)
      .maybeSingle();

    if (!existing) {
      await supabase.from("tasks").insert({
        client_id: clientId,
        title,
        description,
        status: "todo",
        priority: "high",
        stage: "backlog",
        created_by: "stripe-webhook",
        assigned_client_name: clientName,
      });
    }

    return new Response(JSON.stringify({ received: true, clientId, taskCreated: !existing }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("[stripe-webhook] handler error:", e);
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders });
  }
});