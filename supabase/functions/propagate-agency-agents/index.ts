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
    const forceModel: string | undefined = body?.forceModel; // e.g. "nvidia/nemotron-3-ultra:free"
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

    // Pull every existing client_agent so we can preserve per-client customizations.
    // Anything with is_customized=true keeps its system_prompt/model — propagation only refreshes
    // name/agent_type/enabled and inserts missing rows.
    const { data: existing, error: eErr } = await supabase
      .from("client_agents")
      .select("client_id, handle, system_prompt, model, is_customized");
    if (eErr) throw eErr;
    const existingByKey = new Map<string, any>();
    for (const r of existing ?? []) existingByKey.set(`${r.client_id}::${r.handle}`, r);

    const rows: any[] = [];
    for (const c of clients ?? []) {
      for (const a of agencyAgents ?? []) {
        const prev = existingByKey.get(`${c.id}::${a.slug}`);
        const isCustomized = !!prev?.is_customized;
        rows.push({
          client_id: c.id,
          handle: a.slug,
          name: a.name,
          agent_type: ["static", "video", "copy"].includes(a.role) ? "creatives" : "custom",
          // Preserve customized model/prompt; only overwrite when not customized.
          model: isCustomized
            ? (prev?.model || forceModel || a.default_model || "nvidia/nemotron-3-ultra:free")
            : (forceModel || a.default_model || "nvidia/nemotron-3-ultra:free"),
          system_prompt: isCustomized ? (prev?.system_prompt ?? "") : (a.system_prompt || ""),
          enabled: true,
          is_customized: isCustomized,
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