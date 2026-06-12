import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { tasks } = await req.json();

    if (!Array.isArray(tasks) || tasks.length === 0) {
      return new Response(
        JSON.stringify({ error: "tasks array is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("ORIGINAL_SUPABASE_URL") || Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("ORIGINAL_SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const results = [];

    for (const task of tasks) {
      const { client_id, title, description, priority, due_date, status } = task;

      if (!client_id || !title) {
        results.push({ error: "client_id and title required", task });
        continue;
      }

      const { data, error } = await supabase.from("tasks").insert({
        client_id,
        title,
        description: description || null,
        priority: priority || "medium",
        due_date: due_date || null,
        status: status || "todo",
      }).select().single();

      if (error) {
        results.push({ error: error.message, task });
      } else {
        results.push({ success: true, id: data.id, title: data.title, client_id: data.client_id });
        // Fire-and-forget auto-assign for every AI-created task
        try {
          fetch(`${supabaseUrl}/functions/v1/ai-auto-assign-task`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${supabaseServiceKey}`,
              apikey: supabaseServiceKey,
            },
            body: JSON.stringify({ taskId: data.id }),
          }).catch((e) => console.warn('auto-assign dispatch failed', e));
        } catch (e) { console.warn('auto-assign dispatch threw', e); }
      }
    }

    return new Response(
      JSON.stringify({ results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("ai-create-tasks error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
