// hermes-daily-review: scans active clients, flags stalled tasks (>3d no activity),
// posts a Slack summary, and writes an agent_escalations row for each stalled item.
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY")!;
    const SLACK_BOT_TOKEN = Deno.env.get("SLACK_BOT_TOKEN");
    const supa = createClient(SUPABASE_URL, SERVICE_KEY);

    const cutoff = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    const { data: clients = [] } = await supa
      .from("clients")
      .select("id,name")
      .in("status", ["active", "onboarding"]);

    const stalledByClient: Record<string, any[]> = {};
    let totalStalled = 0;

    for (const c of clients || []) {
      const { data: tasks = [] } = await supa
        .from("tasks")
        .select("id,title,status,updated_at,due_date,assigned_to,priority")
        .eq("client_id", c.id)
        .neq("status", "done")
        .lt("updated_at", cutoff)
        .limit(20);
      if (tasks && tasks.length) {
        stalledByClient[c.id] = tasks.map((t: any) => ({ ...t, client_name: c.name }));
        totalStalled += tasks.length;
      }
    }

    // AI commentary
    let summary = "";
    try {
      const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${OPENROUTER_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "openrouter/owl-alpha",
          messages: [
            { role: "system", content: "You are Hermes, an operations triage agent. Output a tight markdown daily triage. Group by client, list at-risk tasks, suggest a single next action per item, and tag owners. No fluff." },
            { role: "user", content: JSON.stringify({ stalled: stalledByClient, cutoff_days: 3 }) },
          ],
          temperature: 0.2,
        }),
      });
      if (r.ok) summary = (await r.json())?.choices?.[0]?.message?.content || "";
    } catch (_) {}

    // Escalation rows
    const escalations = Object.entries(stalledByClient).flatMap(([client_id, items]) =>
      items.slice(0, 5).map((t: any) => ({
        client_id,
        type: "stalled_task",
        severity: "medium",
        title: `Stalled: ${t.title}`,
        details: { task_id: t.id, days_idle: Math.floor((Date.now() - new Date(t.updated_at).getTime()) / 86400000), assigned_to: t.assigned_to },
        status: "open",
      }))
    );
    if (escalations.length) {
      await supa.from("agent_escalations").insert(escalations);
    }

    // Slack
    let deliveredSlack = false;
    if (SLACK_BOT_TOKEN && summary) {
      try {
        const { data: agency } = await supa.from("agency_settings").select("slack_daily_channel_id").limit(1).maybeSingle();
        const channel = (agency as any)?.slack_daily_channel_id;
        if (channel) {
          const sr = await fetch("https://slack.com/api/chat.postMessage", {
            method: "POST",
            headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}`, "Content-Type": "application/json" },
            body: JSON.stringify({ channel, text: `*Hermes daily triage*\n${totalStalled} stalled task(s)\n\n${summary.slice(0, 3500)}` }),
          });
          deliveredSlack = !!(await sr.json())?.ok;
        }
      } catch (_) {}
    }

    return new Response(JSON.stringify({ success: true, total_stalled: totalStalled, escalations: escalations.length, delivered_slack: deliveredSlack, summary }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
