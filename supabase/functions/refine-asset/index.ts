import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { asset_id, message, conversation_history } = await req.json();
    if (!asset_id || !message) {
      return new Response(JSON.stringify({ error: "asset_id and message required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get('OPENROUTER_API_KEY');
    if (!LOVABLE_API_KEY) throw new Error("OPENROUTER_API_KEY not configured");

    const supabaseUrl = Deno.env.get("ORIGINAL_SUPABASE_URL") || Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("ORIGINAL_SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Fetch the asset
    const { data: asset, error: assetError } = await supabase
      .from("client_assets")
      .select("*")
      .eq("id", asset_id)
      .single();

    if (assetError || !asset) {
      return new Response(JSON.stringify({ error: "Asset not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const systemPrompt = `You are an expert marketing copywriter and strategist helping refine onboarding assets.

Current asset type: ${asset.asset_type}
Current asset title: ${asset.title}
Current content:
${JSON.stringify(asset.content, null, 2)}

The user wants to improve or modify this asset. Apply their feedback and return the COMPLETE updated asset content as valid JSON (same structure as the current content). If the user asks a question, answer it and also provide the updated content.

IMPORTANT: Always return your response as a JSON object with two keys:
- "reply": your conversational response to the user
- "updated_content": the full updated asset content (same JSON structure), or null if no changes needed`;

    const messages: any[] = [
      { role: "system", content: systemPrompt },
    ];

    // Add conversation history
    if (conversation_history && Array.isArray(conversation_history)) {
      messages.push(...conversation_history);
    }

    messages.push({ role: "user", content: message });

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "nvidia/nemotron-3-ultra:free",
        models: ["nvidia/nemotron-3-ultra:free", "google/gemini-2.0-flash-001", "openai/gpt-4o-mini"],
        messages,
        temperature: 0.7,
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please wait a moment." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Please add funds." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error(`AI Gateway error: ${response.status} - ${errText}`);
    }

    const result = await response.json();
    let content = result.choices?.[0]?.message?.content || "";
    content = content.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();

    let parsed: any;
    try {
      parsed = JSON.parse(content);
    } catch {
      parsed = { reply: content, updated_content: null };
    }

    // If there's updated content, save it
    if (parsed.updated_content) {
      await supabase
        .from("client_assets")
        .update({ content: parsed.updated_content, updated_at: new Date().toISOString() })
        .eq("id", asset_id);
    }

    return new Response(JSON.stringify({
      reply: parsed.reply || "Content updated.",
      updated_content: parsed.updated_content || null,
      asset_id,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e) {
    console.error("refine-asset error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
