import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { offer_id, client_id, client_name, file_urls, file_names, current_description } = await req.json();

    const LOVABLE_API_KEY = Deno.env.get('OPENROUTER_API_KEY');
    if (!LOVABLE_API_KEY) throw new Error("OPENROUTER_API_KEY not configured");

    // Build context from files
    let fileContext = "";
    if (file_names?.length) {
      fileContext = `\nAttached files: ${file_names.join(", ")}`;
    }
    if (file_urls?.length) {
      fileContext += `\nFile URLs for reference: ${file_urls.join(", ")}`;
    }

    const userPrompt = `Company: ${client_name || "Unknown"}
Current offer description: ${current_description || "None provided"}
${fileContext}

Based on the company name, any existing description, and the attached file names, generate a comprehensive offer description that covers:
1. What the offer/product is
2. Key value propositions and benefits
3. Target audience
4. Unique differentiators

Write 2-3 detailed paragraphs. Be specific and compelling. If file names suggest pitch decks, investment docs, or marketing materials, infer the offer details from context.`;

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "openrouter/owl-alpha",
        models: ["openrouter/owl-alpha", "google/gemini-2.0-flash-001", "openai/gpt-4o-mini"],
        messages: [
          { role: "system", content: "You are an expert copywriter. Generate compelling offer descriptions based on available context. Be specific, avoid generic filler. Return ONLY the description text, no JSON wrapping." },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.5,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limited, please try again shortly." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Add funds in Settings > Workspace > Usage." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const errText = await response.text();
      console.error("AI error:", response.status, errText);
      throw new Error(`AI error: ${response.status}`);
    }

    const result = await response.json();
    const description = result.choices?.[0]?.message?.content?.trim() || "";

    // Update the offer description in DB
    if (offer_id && description) {
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const supabase = createClient(supabaseUrl, supabaseKey);

      await supabase
        .from("client_offers")
        .update({ description, updated_at: new Date().toISOString() })
        .eq("id", offer_id);
    }

    return new Response(JSON.stringify({ description }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("analyze-offer error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
