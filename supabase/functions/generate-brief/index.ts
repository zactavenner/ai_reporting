import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callOpenRouterJSON } from "../_shared/openrouter.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SYSTEM_PROMPT = `You are a senior performance media buyer at a top ad agency. Analyze these winning ads and produce a creative brief for the next round of ads. Return ONLY valid JSON with these fields:

- hook_patterns: string array of 3-5 hook formulas extracted from winners
- offer_angles: string array of 2-3 offer angles that are converting
- recommended_variations: array of 3 objects, each with: variation_name, concept, hook_draft, body_direction, cta_suggestion, format (static/video/carousel)
- brief_summary: 2-3 sentence summary of what's working and what to try next`;

async function callAI(topAds: any[]): Promise<any> {
  const { data } = await callOpenRouterJSON([
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: `Here are the top performing ads:\n\n${JSON.stringify(topAds, null, 2)}\n\nAnalyze these and produce the creative brief as JSON.`,
    },
  ], { max_tokens: 2000 });
  return data;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { client_id, client_name, top_ads } = await req.json();
    if (!client_id || !client_name || !top_ads?.length) {
      return new Response(JSON.stringify({ error: "client_id, client_name, and top_ads are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const brief = await callAI(top_ads);

    // Save to database
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const row = {
      client_id,
      client_name,
      status: "pending",
      source: "ai_brief",
      winning_ad_summary: top_ads,
      hook_patterns: brief.hook_patterns || [],
      offer_angles: brief.offer_angles || [],
      recommended_variations: brief.recommended_variations || [],
      full_brief_json: brief,
    };

    const { data: saved, error: dbError } = await supabase
      .from("creative_briefs")
      .insert(row)
      .select()
      .single();

    if (dbError) throw new Error(`DB error: ${dbError.message}`);

    return new Response(JSON.stringify(saved), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("generate-brief error:", e);
    return new Response(JSON.stringify({ error: e.message || "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
