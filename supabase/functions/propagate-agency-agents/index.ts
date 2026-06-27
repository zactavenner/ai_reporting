import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = await req.json().catch(() => ({}));
    const forceModel: string | undefined = body?.forceModel; // e.g. "openrouter/owl-alpha"
    const onlyClientIds: string[] | undefined = body?.clientIds;

    const { data: agencyAgents, error: aErr } = await supabase
      .from("agency_agents")
      .select("*")
      .eq("is_active", true);
    if (aErr) throw aErr;

    let clientsQ = supabase.from("clients").select("id, name").eq("status", "active");
    if (onlyClientIds?.length) clientsQ = clientsQ.in("id", onlyClientIds);
    const { data: clients, error: cErr } = await clientsQ;
    if (cErr) throw cErr;

    const rows: any[] = [];
    for (const c of clients ?? []) {
      for (const a of agencyAgents ?? []) {
        rows.push({
          client_id: c.id,
          handle: a.slug,
          name: a.name,
          agent_type: ["static", "video", "copy"].includes(a.role) ? "creatives" : "custom",
          model: forceModel || a.default_model || "openrouter/owl-alpha",
          system_prompt: a.system_prompt || "",
          enabled: true,
        });
      }
    }

    let upserted = 0;
    if (rows.length) {
      const { error: uErr, count } = await supabase
        .from("client_agents")
        .upsert(rows, { onConflict: "client_id,handle", count: "exact" });
      if (uErr) throw uErr;
      upserted = count ?? rows.length;
    }

    return new Response(
      JSON.stringify({
        ok: true,
        clients: clients?.length ?? 0,
        agents: agencyAgents?.length ?? 0,
        upserted,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e: any) {
    console.error("propagate-agency-agents error", e);
    return new Response(JSON.stringify({ ok: false, error: e?.message || String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});