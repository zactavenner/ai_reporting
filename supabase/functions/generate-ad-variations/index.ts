import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { clientId, clientName, metric, topAds } = await req.json();
    if (!clientId || !topAds?.length) {
      return new Response(JSON.stringify({ success: false, error: "clientId and topAds required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("ORIGINAL_SUPABASE_URL") || Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("ORIGINAL_SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const openaiKey = Deno.env.get("OPENAI_API_KEY");
    let tasksCreated = 0;

    for (const ad of topAds.slice(0, 3)) {
      // Build performance context
      const perfLines = [
        `Spend: $${Number(ad.spend || 0).toFixed(2)}`,
        `CTR: ${Number(ad.ctr || 0).toFixed(2)}%`,
        `Leads: ${ad.leads || 0}`,
        `Calls: ${ad.calls || 0}`,
        `Funded: ${ad.funded || 0}`,
        `CPL: $${Number(ad.cpl || 0).toFixed(2)}`,
        `CPA: $${Number(ad.cpa || 0).toFixed(2)}`,
        ad.fundedDollars ? `Funded $: $${Number(ad.fundedDollars).toLocaleString()}` : null,
      ].filter(Boolean).join(" | ");

      let variationBriefs: string[];

      if (openaiKey) {
        // Use AI to generate smart variations
        try {
          const prompt = `You are an expert performance marketer. Given this winning ad creative for "${clientName}", generate exactly 4 ad variation briefs.

WINNING AD: "${ad.name}"
Headline: ${ad.headline || 'N/A'}
Body copy: ${ad.body || 'N/A'}
Performance (winning metric: ${metric}): ${perfLines}

For each variation, provide:
1. A new headline (hook)
2. New body copy (2-3 sentences)
3. CTA text
4. Visual direction (describe the image/video concept)

Make each variation test a different angle:
- Variation 1: Different emotional hook (urgency, exclusivity, social proof)
- Variation 2: Different value proposition or benefit angle
- Variation 3: Different CTA approach (direct vs soft vs question)
- Variation 4: Completely different creative concept while maintaining the winning elements

Format as JSON array: [{"headline":"...","body":"...","cta":"...","visual":"..."}]
Return ONLY the JSON array, no other text.`;

          const aiRes = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${openaiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: "gpt-4o-mini",
              messages: [{ role: "user", content: prompt }],
              temperature: 0.8,
              max_tokens: 2000,
            }),
          });

          const aiData = await aiRes.json();
          const content = aiData.choices?.[0]?.message?.content || "";
          
          // Extract JSON from response
          const jsonMatch = content.match(/\[[\s\S]*\]/);
          if (jsonMatch) {
            const variations = JSON.parse(jsonMatch[0]);
            variationBriefs = variations.map((v: any, i: number) =>
              `## Variation ${i + 1}\n**Headline:** ${v.headline}\n**Body:** ${v.body}\n**CTA:** ${v.cta}\n**Visual Direction:** ${v.visual}`
            );
          } else {
            throw new Error("Failed to parse AI response");
          }
        } catch (aiErr) {
          console.error("AI generation failed, using template:", aiErr);
          variationBriefs = generateTemplateBriefs(ad, metric);
        }
      } else {
        variationBriefs = generateTemplateBriefs(ad, metric);
      }

      // Create tasks for each variation
      for (let i = 0; i < variationBriefs.length; i++) {
        const brief = variationBriefs[i];
        const { error: taskErr } = await supabase.from("tasks").insert({
          title: `${ad.name} — Variation ${i + 1}`,
          description: `### Based on winning ad (${metric})\n${perfLines}\n\n---\n\n${brief}\n\n---\n*Original ad: ${ad.name}*\n*Image ref: ${ad.imageUrl || 'N/A'}*`,
          client_id: clientId,
          priority: i === 0 ? 'high' : 'medium',
          stage: 'todo',
          status: 'todo',
          category: 'ad_variation',
        });
        if (!taskErr) tasksCreated++;
      }
    }

    return new Response(JSON.stringify({
      success: true,
      tasksCreated,
      adsProcessed: Math.min(topAds.length, 3),
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (error) {
    console.error("generate-ad-variations error:", error);
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});

function generateTemplateBriefs(ad: any, metric: string): string[] {
  const name = ad.name || "Ad";
  const headline = ad.headline || "Original headline";
  return [
    `## Variation 1 — Different Hook\n**Headline:** Try a urgency/scarcity angle for "${headline}"\n**Body:** Reframe the value proposition with time pressure. Reference the winning ${metric} performance.\n**CTA:** "Claim Your Spot" or "Limited Availability"\n**Visual Direction:** Same creative style, add countdown or limited-slots overlay`,
    `## Variation 2 — Social Proof Angle\n**Headline:** Lead with results/numbers from "${name}"\n**Body:** Use client testimonials or data points. Emphasize credibility.\n**CTA:** "See How Others Succeeded"\n**Visual Direction:** Add testimonial overlay or results screenshot to the creative`,
    `## Variation 3 — Question-Based Hook\n**Headline:** Turn the winning headline into a compelling question\n**Body:** Address pain points directly. Make the reader self-identify.\n**CTA:** "Find Out How" or "Get Started"\n**Visual Direction:** Clean, minimal version of the creative with bold text overlay`,
    `## Variation 4 — Completely New Concept\n**Headline:** Flip the angle entirely — if original was aspirational, go practical\n**Body:** Test a completely different emotional trigger while keeping the offer.\n**CTA:** Direct response CTA\n**Visual Direction:** New creative concept — if original was video, try static; if static, try carousel`,
  ];
}
