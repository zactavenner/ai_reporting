import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

    // Find tasks in todo/in_progress overdue by 48h+
    const { data: tasks, error: tasksErr } = await supabase
      .from("tasks")
      .select("id, client_id, stage, status, due_date, assigned_to")
      .in("stage", ["todo", "in_progress"])
      .neq("status", "completed")
      .not("due_date", "is", null)
      .lt("due_date", cutoff);

    if (tasksErr) throw tasksErr;

    let movedCount = 0;
    let amAssignedCount = 0;
    const errors: string[] = [];

    for (const task of tasks || []) {
      try {
        // Move to stuck
        const { error: updErr } = await supabase
          .from("tasks")
          .update({ stage: "stuck" })
          .eq("id", task.id);
        if (updErr) throw updErr;
        movedCount++;

        // Log history
        await supabase.from("task_history").insert({
          task_id: task.id,
          action: "stage_changed",
          old_value: task.stage,
          new_value: "stuck",
          changed_by: "Overdue Watchdog (48h)",
        });

        if (!task.client_id) continue;

        // Lookup client account_manager
        const { data: client } = await supabase
          .from("clients")
          .select("account_manager")
          .eq("id", task.client_id)
          .maybeSingle();

        const amName = client?.account_manager?.trim();
        if (!amName) continue;

        // Find agency_member by name (case-insensitive)
        const { data: member } = await supabase
          .from("agency_members")
          .select("id, name")
          .ilike("name", amName)
          .maybeSingle();

        if (!member) continue;

        // Check if AM is already assigned
        const { data: existing } = await supabase
          .from("task_assignees")
          .select("id")
          .eq("task_id", task.id)
          .eq("member_id", member.id)
          .maybeSingle();

        if (existing) continue;

        // Add AM as additional assignee (preserving existing)
        const { error: insErr } = await supabase
          .from("task_assignees")
          .insert({ task_id: task.id, member_id: member.id, pod_id: null });

        if (insErr) {
          errors.push(`assignee insert failed for ${task.id}: ${insErr.message}`);
          continue;
        }

        amAssignedCount++;

        await supabase.from("task_history").insert({
          task_id: task.id,
          action: "assignee_added",
          new_value: `${member.name} (account manager auto-assigned: stuck >48h)`,
          changed_by: "Overdue Watchdog (48h)",
        });
      } catch (e) {
        errors.push(`task ${task.id}: ${(e as Error).message}`);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        scanned: tasks?.length ?? 0,
        moved_to_stuck: movedCount,
        account_managers_assigned: amAssignedCount,
        errors,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ success: false, error: (e as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});