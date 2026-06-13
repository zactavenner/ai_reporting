import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callOpenRouter } from "../_shared/openrouter.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SLACK_GATEWAY_URL = "https://connector-gateway.lovable.dev/slack/api";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  const SLACK_API_KEY = Deno.env.get("SLACK_API_KEY");

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    let body: any = {};
    try { body = await req.json(); } catch (_) {}
    const dryRun = body?.dry_run === true;
    const overrideChannel = body?.channel_id as string | undefined;

    // Resolve target channel
    const { data: settings } = await supabase
      .from("agency_settings")
      .select("standup_slack_channel_id")
      .limit(1)
      .maybeSingle();
    const channelId = overrideChannel || settings?.standup_slack_channel_id;

    // Time window: yesterday (full day) + today
    const now = new Date();
    const startYesterday = new Date(now); startYesterday.setDate(now.getDate() - 1); startYesterday.setHours(0,0,0,0);
    const endYesterday = new Date(now); endYesterday.setHours(0,0,0,0);
    const endToday = new Date(now); endToday.setHours(23,59,59,999);
    const todayStr = now.toISOString().slice(0,10);
    const tomorrowStr = new Date(now.getTime() + 86400000).toISOString().slice(0,10);

    // Members
    const { data: members = [] } = await supabase
      .from("agency_members")
      .select("id, name, email");

    // Completed yesterday (joined by task_assignees, plus legacy assigned_to)
    const { data: completed = [] } = await supabase
      .from("tasks")
      .select("id, title, status, assigned_to, completed_at, client_id, clients(name), task_assignees(member_id)")
      .eq("status", "completed")
      .gte("completed_at", startYesterday.toISOString())
      .lt("completed_at", endYesterday.toISOString());

    // Blocked
    const { data: blocked = [] } = await supabase
      .from("tasks")
      .select("id, title, status, assigned_to, client_id, clients(name), task_assignees(member_id)")
      .eq("status", "blocked");

    // Due today (or overdue not done)
    const { data: dueToday = [] } = await supabase
      .from("tasks")
      .select("id, title, status, assigned_to, due_date, priority, client_id, clients(name), task_assignees(member_id)")
      .in("status", ["todo","in_progress","pending"])
      .lte("due_date", todayStr)
      .gte("due_date", "1970-01-01");

    const assigneeIds = (t: any): string[] => {
      const ids = new Set<string>();
      if (t.assigned_to) ids.add(t.assigned_to);
      for (const a of (t.task_assignees ?? [])) if (a?.member_id) ids.add(a.member_id);
      return Array.from(ids);
    };

    type Row = { done: any[]; blocked: any[]; due: any[] };
    const byMember = new Map<string, Row>();
    const unassigned: Row = { done: [], blocked: [], due: [] };
    for (const m of members) byMember.set(m.id, { done: [], blocked: [], due: [] });

    const fan = (tasks: any[], key: keyof Row) => {
      for (const t of tasks) {
        const ids = assigneeIds(t);
        if (ids.length === 0) { unassigned[key].push(t); continue; }
        for (const id of ids) {
          const row = byMember.get(id);
          if (row) row[key].push(t); else unassigned[key].push(t);
        }
      }
    };
    fan(completed, "done");
    fan(blocked, "blocked");
    fan(dueToday, "due");

    // Build structured payload for AI
    const summary = members.map((m: any) => ({
      name: m.name,
      done: (byMember.get(m.id)?.done ?? []).map((t: any) => ({ title: t.title, client: t.clients?.name })),
      blocked: (byMember.get(m.id)?.blocked ?? []).map((t: any) => ({ title: t.title, client: t.clients?.name })),
      due_today: (byMember.get(m.id)?.due ?? []).map((t: any) => ({ title: t.title, client: t.clients?.name, priority: t.priority, overdue: t.due_date && t.due_date < todayStr })),
    })).filter((r) => r.done.length || r.blocked.length || r.due_today.length);

    const unassignedSummary = {
      done: unassigned.done.map((t: any) => ({ title: t.title, client: t.clients?.name })),
      blocked: unassigned.blocked.map((t: any) => ({ title: t.title, client: t.clients?.name })),
      due_today: unassigned.due.map((t: any) => ({ title: t.title, client: t.clients?.name, priority: t.priority })),
    };

    // Ask AI to format as Slack mrkdwn
    const ai = await callOpenRouter([
      {
        role: "system",
        content:
          "You write daily standup summaries for an agency in Slack mrkdwn. Be terse and scannable. Use *bold* for names, bullet points (•) for tasks. Include client name in parentheses when present. Sections per person: ✅ Yesterday, 🚫 Blocked, 🎯 Today. Skip empty sections. End with a single short hype line. Never use 'guaranteed'. No headers larger than *bold*.",
      },
      {
        role: "user",
        content: `Date: ${todayStr}\n\nPer-member data:\n${JSON.stringify(summary, null, 2)}\n\nUnassigned (mention only if non-empty under a final *Unassigned* section):\n${JSON.stringify(unassignedSummary, null, 2)}`,
      },
    ], { temperature: 0.4, max_tokens: 1500 });

    const header = `🌅 *Daily Standup — ${todayStr}*\n`;
    const messageText = header + "\n" + ai.text.trim();

    if (dryRun) {
      return new Response(JSON.stringify({ ok: true, dry_run: true, channel: channelId, text: messageText, members_in_summary: summary.length }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!channelId) {
      return new Response(JSON.stringify({ ok: false, error: "No standup_slack_channel_id configured in agency_settings" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!LOVABLE_API_KEY || !SLACK_API_KEY) {
      return new Response(JSON.stringify({ ok: false, error: "Slack connector not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const slackRes = await fetch(`${SLACK_GATEWAY_URL}/chat.postMessage`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "X-Connection-Api-Key": SLACK_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ channel: channelId, text: messageText, unfurl_links: false }),
    });
    const slackData = await slackRes.json();

    // Log
    await supabase.from("slack_activity_log").insert({
      client_id: null,
      channel_id: channelId,
      channel_name: null,
      action: "standup_posted",
      details: { ok: slackData.ok, ts: slackData.ts, members: summary.length, model: ai.model },
    } as any).then(() => {}, () => {});

    // Also push standup to Joe on WhatsApp via Hermes
    try {
      const { data: cfg } = await supabase
        .from("agency_settings")
        .select("hermes_callback_url, hermes_enabled, whatsapp_owner_number, eod_send_to_hermes")
        .limit(1)
        .maybeSingle();
      const phone = (cfg as any)?.whatsapp_owner_number || "+19167097345";
      const callback = (cfg as any)?.hermes_callback_url;
      if ((cfg as any)?.eod_send_to_hermes !== false && (cfg as any)?.hermes_enabled && callback) {
        // Pull yesterday's EOD reports to attach
        const yest = new Date(Date.now() - 86400000).toISOString().slice(0,10);
        const { data: eods = [] } = await supabase
          .from("daily_reports")
          .select("member_id, wins_shared, self_assessment, touchpoint_count, touchpoint_notes")
          .eq("report_date", yest)
          .eq("report_type", "eod");
        const eodSection = (eods && eods.length)
          ? `\n\n📋 *Yesterday EOD (${eods.length})*\n` + eods.map((e: any) => {
              const m = (members as any[]).find((mm) => mm.id === e.member_id);
              return `• ${m?.name || "Member"}: ${e.self_assessment ?? "—"}/10${e.wins_shared ? ` — ${e.wins_shared}` : ""}`;
            }).join("\n")
          : "";
        await fetch(callback, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            event: "daily_standup",
            channel: "whatsapp",
            to: phone,
            text: messageText + eodSection,
          }),
        }).catch(() => {});
      }
    } catch (e) {
      console.warn("Hermes WhatsApp push failed:", e);
    }

    return new Response(JSON.stringify({ ok: slackData.ok, ts: slackData.ts, channel: channelId, model: ai.model }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("ai-standup-bot error:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});