import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { taskId } = await req.json();
    if (!taskId) {
      return new Response(JSON.stringify({ error: "taskId required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: task, error: taskErr } = await supabase
      .from("tasks")
      .select("id, title, description, priority, assigned_to, client_id, clients(name)")
      .eq("id", taskId)
      .single();
    if (taskErr || !task) throw taskErr || new Error("Task not found");

    if (task.assigned_to) {
      return new Response(JSON.stringify({ skipped: "already_assigned" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: members } = await supabase
      .from("agency_members")
      .select("id, name, role, pod:agency_pods(id, name, description)")
      .order("name");

    if (!members || members.length === 0) {
      return new Response(JSON.stringify({ skipped: "no_members" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const memberList = members.map((m: any) => ({
      id: m.id,
      name: m.name,
      role: m.role,
      team: m.pod?.name || null,
      team_description: m.pod?.description || null,
    }));

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const prompt = `You are a project manager assigning tasks to team members based on their role/team and the task content.

Task:
- Title: ${task.title}
- Description: ${task.description || "(none)"}
- Priority: ${task.priority || "medium"}
- Client: ${(task as any).clients?.name || "(internal)"}

Team members (JSON):
${JSON.stringify(memberList, null, 2)}

Pick the single best member for this task. Consider their role and team specialty (e.g. creative, ads, dev, account management).
Return ONLY a JSON object: { "member_id": "<uuid>", "reason": "<short explanation>" }
If no member is a good fit, return { "member_id": null, "reason": "<why>" }`;

    const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
      }),
    });

    if (!aiRes.ok) {
      const errTxt = await aiRes.text();
      throw new Error(`AI gateway ${aiRes.status}: ${errTxt}`);
    }

    const aiData = await aiRes.json();
    const content = aiData?.choices?.[0]?.message?.content || "{}";
    let parsed: { member_id?: string | null; reason?: string };
    try {
      parsed = JSON.parse(content);
    } catch {
      parsed = {};
    }

    if (!parsed.member_id) {
      return new Response(JSON.stringify({ assigned: false, reason: parsed.reason || "no match" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const match = members.find((m: any) => m.id === parsed.member_id);
    if (!match) {
      return new Response(JSON.stringify({ assigned: false, reason: "invalid member_id" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { error: updErr } = await supabase
      .from("tasks")
      .update({ assigned_to: match.id })
      .eq("id", taskId);
    if (updErr) throw updErr;

    // Best-effort history entry
    try {
      await supabase.from("task_history").insert({
        task_id: taskId,
        action: "ai_auto_assigned",
        new_value: match.name,
        changed_by: "AI",
      });
    } catch (_) {}

    // Notify the assignee
    try {
      await supabase.functions.invoke("send-task-notification", {
        body: { taskId, action: "assigned", clientId: task.client_id },
      });
    } catch (_) {}

    return new Response(
      JSON.stringify({ assigned: true, member_id: match.id, member_name: match.name, reason: parsed.reason }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("ai-auto-assign-task error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});