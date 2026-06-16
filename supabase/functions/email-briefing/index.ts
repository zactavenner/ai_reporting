import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "../_shared/gmail.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();

  const { data: emails } = await supabase.from("emails")
    .select("id, from_name, from_email, subject, snippet, priority, classification, requires_response, received_at, is_archived, auto_archived")
    .gte("received_at", since)
    .order("received_at", { ascending: false })
    .limit(500);

  const list = emails ?? [];
  const inboxEmails = list.filter((e) => !e.is_archived);
  const requiresResponse = list.filter((e) => e.requires_response && !e.is_archived);
  const high = list.filter((e) => e.priority === "high" && !e.is_archived);
  const autoArchived = list.filter((e) => e.auto_archived).length;

  const summarize = (arr: any[], n = 5) => arr.slice(0, n).map((e) => ({
    id: e.id, from: e.from_name || e.from_email, subject: e.subject, snippet: e.snippet,
    priority: e.priority, classification: e.classification,
  }));

  const lovableKey = Deno.env.get("LOVABLE_API_KEY")!;
  let summary = "";
  try {
    const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${lovableKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: "You write a 3-4 sentence executive email briefing. Be sharp and actionable." },
          { role: "user", content: `Today: ${todayStr}\nInbox: ${inboxEmails.length}\nNeeds response: ${requiresResponse.length}\nHigh priority: ${high.length}\nAuto-archived (noise removed): ${autoArchived}\n\nTop high-priority subjects:\n${high.slice(0, 10).map((e) => `- ${e.from_name || e.from_email}: ${e.subject}`).join("\n")}\n\nWrite the briefing.` },
        ],
      }),
    });
    if (r.ok) {
      const d = await r.json();
      summary = d.choices?.[0]?.message?.content ?? "";
    }
  } catch { /* noop */ }

  const briefing = {
    briefing_date: todayStr,
    summary,
    top_emails: summarize(high, 8),
    pending_replies: summarize(requiresResponse, 8),
    urgent_items: summarize(high.filter((e) => e.requires_response), 5),
    follow_ups: [],
    metrics: {
      inbox_count: inboxEmails.length,
      requires_response: requiresResponse.length,
      high_priority: high.length,
      auto_archived: autoArchived,
      total_received: list.length,
      inbox_zero_pct: list.length === 0 ? 100 : Math.round((1 - inboxEmails.length / list.length) * 100),
    },
  };

  await supabase.from("email_briefings").upsert(briefing, { onConflict: "briefing_date" });

  return new Response(JSON.stringify({ ok: true, briefing }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});