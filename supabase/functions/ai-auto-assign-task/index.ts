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

    const [{ data: members }, { data: pods }] = await Promise.all([
      supabase
        .from("agency_members")
        .select("id, name, role, pod:agency_pods(id, name, description)")
        .order("name"),
      supabase
        .from("agency_pods")
        .select("id, name, description"),
    ]);

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
    const podList = (pods ?? []).map((p: any) => ({
      id: p.id,
      name: p.name,
      description: p.description,
    }));

    const OPENROUTER_API_KEY = (Deno.env.get('OPENROUTER_API_KEY') || '').trim().replace(/^['"]|['"]$/g, '');
    if (!OPENROUTER_API_KEY.startsWith('sk-or-')) throw new Error("OPENROUTER_API_KEY not configured or invalid");

    const prompt = `You are a project manager routing a task to the right people.

Task:
- Title: ${task.title}
- Description: ${task.description || "(none)"}
- Priority: ${task.priority || "medium"}
- Client: ${(task as any).clients?.name || "(internal)"}

Team members (JSON):
${JSON.stringify(memberList, null, 2)}

Pods / Teams (JSON):
${JSON.stringify(podList, null, 2)}

You may assign to one OR more individual members, and/or to one OR more pods (departments).
Prefer specific members when a clear owner exists; fall back to the owning pod when the work is
department-wide (e.g. "creative review" → Creatives pod).

Return ONLY a JSON object with this shape:
{
  "member_ids": ["<uuid>", ...],   // 0+ member uuids
  "pod_ids":    ["<uuid>", ...],   // 0+ pod uuids
  "reason":     "<short explanation>"
}
At least one of member_ids or pod_ids must be non-empty unless nothing fits.`;

    const aiRes = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://reporting.highperformanceads.com",
        "X-Title": "HPA Auto Assign Task",
      },
      body: JSON.stringify({
        model: "nvidia/nemotron-3-ultra-550b-a55b:free",
        models: ["nvidia/nemotron-3-ultra-550b-a55b:free", "google/gemini-2.0-flash-001", "openai/gpt-4o-mini"],
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
    let parsed: {
      member_id?: string | null;
      member_ids?: string[];
      pod_ids?: string[];
      reason?: string;
    };
    try {
      parsed = JSON.parse(content);
    } catch {
      parsed = {};
    }

    // Backwards-compat: collapse legacy single member_id into array.
    let memberIds = Array.from(new Set([
      ...(parsed.member_ids ?? []),
      ...(parsed.member_id ? [parsed.member_id] : []),
    ])).filter((id) => members.some((m: any) => m.id === id));
    let podIds = Array.from(new Set(parsed.pod_ids ?? []))
      .filter((id) => (pods ?? []).some((p: any) => p.id === id));

    // Policy: when the AI routes to a pod, resolve it to ONE individual owner
    // (round-robin by current open-task load) so every task has a real person
    // accountable. Pods stay in the assignee set only if a specific member is
    // also picked; otherwise we drop pod-only rows in favor of that member.
    if (podIds.length > 0 && memberIds.length === 0) {
      const podMembers = members.filter((m: any) => podIds.includes((m as any).pod?.id));
      const candidateIds = (podMembers.length > 0 ? podMembers : members).map((m: any) => m.id);
      if (candidateIds.length > 0) {
        // Pick the member with the fewest open (non-done) tasks — simple load balance.
        const { data: loadRows } = await supabase
          .from("tasks")
          .select("assigned_to, status")
          .in("assigned_to", candidateIds)
          .neq("status", "done");
        const load = new Map<string, number>();
        for (const id of candidateIds) load.set(id, 0);
        for (const r of (loadRows ?? []) as any[]) {
          if (r.assigned_to && load.has(r.assigned_to)) {
            load.set(r.assigned_to, (load.get(r.assigned_to) || 0) + 1);
          }
        }
        const chosen = candidateIds.slice().sort(
          (a, b) => (load.get(a) ?? 0) - (load.get(b) ?? 0),
        )[0];
        memberIds = [chosen];
      }
      podIds = []; // never assign to a pod alone
    }

    if (memberIds.length === 0 && podIds.length === 0) {
      return new Response(
        JSON.stringify({ assigned: false, reason: parsed.reason || "no match" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Write to task_assignees (multi-assignee source of truth used by the UI badges).
    const assigneeRows = [
      ...memberIds.map((id) => ({ task_id: taskId, member_id: id, pod_id: null })),
      ...podIds.map((id) => ({ task_id: taskId, member_id: null, pod_id: id })),
    ];
    if (assigneeRows.length) {
      await supabase.from("task_assignees").insert(assigneeRows);
    }

    // Keep legacy single-assignee column in sync when there's exactly one member.
    if (memberIds.length >= 1) {
      await supabase.from("tasks").update({ assigned_to: memberIds[0] }).eq("id", taskId);
    }

    const assignedNames = [
      ...memberIds.map((id) => members.find((m: any) => m.id === id)?.name).filter(Boolean),
      ...podIds.map((id) => `${(pods ?? []).find((p: any) => p.id === id)?.name} Team`).filter(Boolean),
    ];

    try {
      await supabase.from("task_history").insert({
        task_id: taskId,
        action: "ai_auto_assigned",
        new_value: assignedNames.join(", "),
        changed_by: "AI",
      });
    } catch (_) {}

    try {
      await supabase.functions.invoke("send-task-notification", {
        body: { taskId, action: "assigned", clientId: task.client_id },
      });
    } catch (_) {}

    return new Response(
      JSON.stringify({
        assigned: true,
        member_ids: memberIds,
        pod_ids: podIds,
        member_name: assignedNames.join(", "),
        reason: parsed.reason,
      }),
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