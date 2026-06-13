// Generates a 1-page AI prep document for an upcoming meeting.
// Pulls: client metrics (30d), recent calls, open tasks, last meeting recap.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callOpenRouter } from "../_shared/openrouter.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { meeting_id } = await req.json();
    if (!meeting_id) throw new Error("meeting_id required");

    const SB_URL = Deno.env.get("SUPABASE_URL")!;
    const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SB_URL, SB_KEY);

    const { data: meeting } = await supabase
      .from("agency_meetings")
      .select("id,title,scheduled_at,client_id,summary,transcript_url,attendees")
      .eq("id", meeting_id).maybeSingle();
    if (!meeting) throw new Error("meeting not found");

    const clientId = meeting.client_id;
    const today = new Date();
    const start = new Date(today); start.setDate(today.getDate() - 30);

    const [{ data: client }, metricsRes, callsRes, tasksRes, lastMeetingRes] = await Promise.all([
      supabase.from("clients").select("id,name,status,offer_name,industry").eq("id", clientId).maybeSingle(),
      supabase.rpc("get_client_source_metrics", { p_start_date: start.toISOString(), p_end_date: today.toISOString() }),
      supabase.from("calls").select("booked_at,showed,call_outcome,notes").eq("client_id", clientId).order("booked_at", { ascending: false }).limit(10),
      supabase.from("tasks").select("title,status,priority,due_date").eq("client_id", clientId).neq("status", "done").order("due_date", { ascending: true }).limit(15),
      supabase.from("agency_meetings").select("title,summary,scheduled_at").eq("client_id", clientId).neq("id", meeting_id).order("scheduled_at", { ascending: false }).limit(1),
    ]);

    const metrics = (metricsRes.data || []).find((m: any) => m.client_id === clientId) || {};
    const lastMeeting = (lastMeetingRes.data || [])[0];

    const context = {
      meeting: { title: meeting.title, when: meeting.scheduled_at, attendees: meeting.attendees },
      client: client ? { name: client.name, offer: client.offer_name, industry: client.industry, status: client.status } : null,
      last_30d_metrics: metrics,
      recent_calls: callsRes.data || [],
      open_tasks: tasksRes.data || [],
      last_meeting: lastMeeting,
    };

    const { text } = await callOpenRouter([
      { role: "system", content: `You prepare meeting briefs for an investment-marketing agency. Compliance: never use "guaranteed"; say "targeted returns".
Output crisp markdown with sections:
## Meeting context
## Where they stand (last 30 days)
## Wins to celebrate
## Risks / open issues
## Suggested talking points (5 bullets)
## Open tasks to mention
Keep total under 400 words. Use specific numbers.` },
      { role: "user", content: JSON.stringify(context).slice(0, 12000) },
    ], { temperature: 0.4, max_tokens: 1500 });

    const { data: saved } = await supabase.from("ai_meeting_briefs").insert({
      meeting_id, client_id: clientId, brief_markdown: text, context_used: context,
    }).select("id").single();

    return new Response(JSON.stringify({ ok: true, id: saved?.id, brief_markdown: text }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500,
    });
  }
});