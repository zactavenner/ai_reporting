import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const INTERNAL_PASSWORD = "HPA1234$";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    if (body?.password !== INTERNAL_PASSWORD) {
      return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const cadence: "weekly" | "monthly" = body.cadence;
    const testRecipientId: string | undefined = body.test_recipient_id;
    const onlyClientId: string | undefined = body.client_id;
    if (!["weekly", "monthly"].includes(cadence)) {
      return new Response(JSON.stringify({ error: "cadence required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const supabase = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const origin = body.origin || "https://aireporting.lovable.app";

    let q = supabase.from("clients").select("id,name,status").eq("status", "active");
    if (onlyClientId) q = q.eq("id", onlyClientId);
    const { data: clients } = await q;

    const results: any[] = [];
    for (const client of clients || []) {
      // Generate report
      const genRes = await fetch(`${SUPABASE_URL}/functions/v1/generate-client-report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: INTERNAL_PASSWORD, client_id: client.id, cadence, origin }),
      });
      if (!genRes.ok) {
        results.push({ client: client.id, error: `generate failed: ${genRes.status}` });
        continue;
      }
      const report = await genRes.json();

      // Recipients
      let rq = supabase
        .from("client_report_recipients")
        .select("*")
        .eq("client_id", client.id)
        .eq("active", true)
        .is("unsubscribed_at", null)
        .contains("cadences", [cadence]);
      if (testRecipientId) rq = rq.eq("id", testRecipientId);
      const { data: recipients } = await rq;

      for (const r of recipients || []) {
        for (const channel of r.channels || []) {
          if (channel === "email" && !r.email) continue;
          if (channel === "sms" && !r.phone_e164) continue;

          const idem = `${client.id}:${cadence}:${report.period_start}:${r.id}:${channel}${testRecipientId ? ":test:" + Date.now() : ""}`;
          // skip if already sent
          const { data: existing } = await supabase
            .from("client_report_sends")
            .select("id,status")
            .eq("idempotency_key", idem)
            .maybeSingle();
          if (existing && existing.status === "sent") {
            results.push({ client: client.id, recipient: r.id, channel, skipped: "already sent" });
            continue;
          }

          const unsubUrl = `${origin}/unsubscribe?token=${r.unsubscribe_token}`;
          const html = (report.html || "").replaceAll("__UNSUB__", r.unsubscribe_token);
          const sendBody: any = {
            password: INTERNAL_PASSWORD,
            channel,
            to_email: r.email,
            to_phone: r.phone_e164,
            name: r.name,
            subject: `${client.name} · ${cadence === "weekly" ? "Weekly" : "Monthly"} performance recap`,
            html,
            text: report.sms,
          };

          const { data: logRow } = await supabase
            .from("client_report_sends")
            .upsert({
              client_id: client.id,
              recipient_id: r.id,
              cadence, channel,
              period_start: report.period_start,
              period_end: report.period_end,
              status: "pending",
              idempotency_key: idem,
              payload: { subject: sendBody.subject },
            }, { onConflict: "idempotency_key" })
            .select()
            .single();

          try {
            const sendRes = await fetch(`${SUPABASE_URL}/functions/v1/send-ghl-message`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(sendBody),
            });
            const sendJson = await sendRes.json();
            if (!sendRes.ok) throw new Error(sendJson?.error || `send failed ${sendRes.status}`);
            await supabase.from("client_report_sends").update({
              status: "sent",
              ghl_message_id: sendJson.messageId,
              ghl_contact_id: sendJson.contactId,
              sent_at: new Date().toISOString(),
            }).eq("id", logRow!.id);
            results.push({ client: client.id, recipient: r.id, channel, ok: true });
          } catch (e) {
            await supabase.from("client_report_sends").update({
              status: "failed",
              error: String((e as any)?.message || e),
            }).eq("id", logRow!.id);
            results.push({ client: client.id, recipient: r.id, channel, error: String((e as any)?.message || e) });
          }
        }
      }
    }

    return new Response(JSON.stringify({ cadence, results }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e?.message || e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});