import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface CampaignWithCPL {
  clientId: string;
  clientName: string;
  campaignId: string;
  campaignName: string;
  cpl: number;
  targetCpl: number;
  spend: number;
  leads: number;
}

interface TopCreative {
  file_url: string;
  headline: string | null;
  body_copy: string | null;
  cta_text: string | null;
  platform: string;
  type: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const LOVABLE_API_KEY = Deno.env.get('OPENROUTER_API_KEY');
  const supabase = createClient(supabaseUrl, supabaseKey);

  if (!LOVABLE_API_KEY) {
    return new Response(JSON.stringify({ error: "OPENROUTER_API_KEY not configured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const dryRun = body.dry_run === true;
    const forceClientId = body.client_id as string | undefined;

    console.log(`CPL Creative Trigger starting... dryRun=${dryRun}`);

    // 1. Get all clients with their CPL thresholds
    const { data: clients, error: clientsErr } = await supabase
      .from("clients")
      .select("id, name, status")
      .eq("status", "active");
    if (clientsErr) throw new Error(`Failed to fetch clients: ${clientsErr.message}`);

    const { data: allSettings, error: settingsErr } = await supabase
      .from("client_settings")
      .select("client_id, cpl_threshold_red, cpl_threshold_yellow, daily_ad_spend_target");
    if (settingsErr) throw new Error(`Failed to fetch settings: ${settingsErr.message}`);

    const settingsMap = new Map(
      (allSettings || []).map((s) => [s.client_id, s])
    );

    // 2. Get yesterday's metrics for CPL calculation
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split("T")[0];

    // Get last 7 days for better CPL signal
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    const weekAgoStr = weekAgo.toISOString().split("T")[0];

    const { data: recentMetrics, error: metricsErr } = await supabase
      .from("daily_metrics")
      .select("client_id, ad_spend, leads")
      .gte("date", weekAgoStr)
      .lte("date", yesterdayStr);
    if (metricsErr) throw new Error(`Failed to fetch metrics: ${metricsErr.message}`);

    // Aggregate 7-day metrics per client
    const clientAgg: Record<string, { spend: number; leads: number }> = {};
    for (const m of recentMetrics || []) {
      if (!clientAgg[m.client_id]) clientAgg[m.client_id] = { spend: 0, leads: 0 };
      clientAgg[m.client_id].spend += m.ad_spend || 0;
      clientAgg[m.client_id].leads += m.leads || 0;
    }

    // 3. Identify clients with CPL above threshold
    const triggeredClients: CampaignWithCPL[] = [];
    for (const client of clients || []) {
      if (forceClientId && client.id !== forceClientId) continue;

      const settings = settingsMap.get(client.id);
      const agg = clientAgg[client.id];
      if (!agg || agg.leads === 0 || agg.spend === 0) continue;

      const currentCpl = agg.spend / agg.leads;
      const targetCpl = settings?.cpl_threshold_red || settings?.cpl_threshold_yellow || 0;

      if (targetCpl > 0 && currentCpl > targetCpl) {
        triggeredClients.push({
          clientId: client.id,
          clientName: client.name,
          campaignId: "aggregate",
          campaignName: "All Campaigns",
          cpl: currentCpl,
          targetCpl,
          spend: agg.spend,
          leads: agg.leads,
        });
      }
    }

    console.log(`Found ${triggeredClients.length} clients with CPL above threshold`);

    if (triggeredClients.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        message: "No clients exceeded CPL threshold",
        triggered: 0,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (dryRun) {
      return new Response(JSON.stringify({
        success: true,
        dry_run: true,
        triggered_clients: triggeredClients,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 4. For each triggered client, find best performing creative and generate variations
    const results: any[] = [];
    for (const triggered of triggeredClients) {
      try {
        console.log(`Processing ${triggered.clientName} (CPL: $${triggered.cpl.toFixed(2)} > target: $${triggered.targetCpl.toFixed(2)})`);

        // Find best-performing existing creative (approved/launched with image)
        const { data: existingCreatives } = await supabase
          .from("creatives")
          .select("*")
          .eq("client_id", triggered.clientId)
          .in("status", ["approved", "launched"])
          .eq("type", "image")
          .not("file_url", "is", null)
          .order("created_at", { ascending: false })
          .limit(5);

        // Also check live ads for top performers
        const { data: liveAds } = await supabase
          .from("client_live_ads")
          .select("*")
          .eq("client_id", triggered.clientId)
          .eq("status", "active")
          .not("thumbnail_url", "is", null)
          .order("scraped_at", { ascending: false })
          .limit(5);

        // Build reference material for AI
        const referenceCreative = existingCreatives?.[0] || null;
        const referenceLiveAd = liveAds?.[0] || null;

        if (!referenceCreative && !referenceLiveAd) {
          console.log(`No reference creatives found for ${triggered.clientName}, skipping`);
          results.push({ client: triggered.clientName, status: "skipped", reason: "no reference creatives" });
          continue;
        }

        // 5. Analyze best creative and generate 3 variations
        const analysisMessages: any[] = [
          {
            role: "system",
            content: `You are a performance marketing creative strategist. A client's CPL is $${triggered.cpl.toFixed(2)} which exceeds their target of $${triggered.targetCpl.toFixed(2)}. 

Analyze the reference creative and generate 3 NEW creative variation concepts that could lower CPL. Focus on:
- Stronger hooks that stop the scroll
- Clearer value propositions
- More compelling CTAs
- Better visual hierarchy

Return ONLY valid JSON with this structure:
{
  "analysis": "Brief analysis of why current creatives may have high CPL",
  "variations": [
    {
      "title": "Variation name",
      "concept": "Visual concept description",
      "headline": "Ad headline text",
      "body_copy": "Primary text / body copy",
      "cta_text": "CTA button text",
      "image_prompt": "Detailed prompt to generate ad creative image - include style, colors, composition, text overlays"
    }
  ]
}`
          },
        ];

        // Add image analysis if available
        const imageUrl = referenceCreative?.file_url || referenceLiveAd?.thumbnail_url;
        const refText = referenceCreative
          ? `Headline: ${referenceCreative.headline || "N/A"}\nBody: ${referenceCreative.body_copy || "N/A"}\nCTA: ${referenceCreative.cta_text || "N/A"}`
          : `Headline: ${referenceLiveAd?.headline || "N/A"}\nPrimary Text: ${referenceLiveAd?.primary_text || "N/A"}\nCTA: ${referenceLiveAd?.cta_type || "N/A"}`;

        const userContent: any[] = [
          {
            type: "text",
            text: `Client: ${triggered.clientName}\nCurrent CPL: $${triggered.cpl.toFixed(2)}\nTarget CPL: $${triggered.targetCpl.toFixed(2)}\n\nReference creative details:\n${refText}\n\nGenerate 3 creative variations to lower CPL.`,
          },
        ];

        if (imageUrl) {
          userContent.push({
            type: "image_url",
            image_url: { url: imageUrl },
          });
        }

        analysisMessages.push({ role: "user", content: userContent });

        // Call AI for analysis and variation concepts
        const aiResponse = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${LOVABLE_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "openrouter/owl-alpha",
        models: ["openrouter/owl-alpha", "google/gemini-2.0-flash-001", "openai/gpt-4o-mini"],
            messages: analysisMessages,
            max_tokens: 3000,
          }),
        });

        if (!aiResponse.ok) {
          const errText = await aiResponse.text();
          if (aiResponse.status === 429) {
            console.warn("Rate limited, stopping batch");
            break;
          }
          throw new Error(`AI error ${aiResponse.status}: ${errText}`);
        }

        const aiData = await aiResponse.json();
        const rawContent = aiData.choices?.[0]?.message?.content || "";
        const cleaned = rawContent.replace(/```json\s*/gi, "").replace(/```\s*/gi, "").trim();

        let variations: any;
        try {
          variations = JSON.parse(cleaned);
        } catch {
          console.error("Failed to parse AI response:", cleaned.substring(0, 300));
          results.push({ client: triggered.clientName, status: "error", reason: "AI returned invalid JSON" });
          continue;
        }

        // 6. Generate images for each variation using AI image generation
        const createdCreatives: string[] = [];
        for (const variation of variations.variations || []) {
          try {
            // Generate image via Lovable AI image model
            const imageGenResponse = await fetch("https://openrouter.ai/api/v1/chat/completions", {
              method: "POST",
              headers: {
                Authorization: `Bearer ${LOVABLE_API_KEY}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                model: "google/gemini-3-pro-image-preview",
        models: ["google/gemini-3-pro-image-preview", "google/gemini-2.0-flash-001", "openai/gpt-4o-mini"],
                messages: [
                  {
                    role: "user",
                    content: `Create a professional Facebook/Instagram ad creative image. ${variation.image_prompt}. The image should be 1080x1080 pixels, high quality, with clean professional design suitable for paid social advertising.`,
                  },
                ],
                modalities: ["image", "text"],
              }),
            });

            let fileUrl: string | null = null;
            if (imageGenResponse.ok) {
              const imageData = await imageGenResponse.json();
              const base64Image = imageData.choices?.[0]?.message?.images?.[0]?.image_url?.url;

              if (base64Image) {
                // Upload to storage
                const imageBytes = Uint8Array.from(
                  atob(base64Image.replace(/^data:image\/\w+;base64,/, "")),
                  (c) => c.charCodeAt(0)
                );
                const fileName = `${triggered.clientId}/ai-auto-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;

                const { error: uploadErr } = await supabase.storage
                  .from("creatives")
                  .upload(fileName, imageBytes, { contentType: "image/png" });

                if (!uploadErr) {
                  const { data: { publicUrl } } = supabase.storage
                    .from("creatives")
                    .getPublicUrl(fileName);
                  fileUrl = publicUrl;
                } else {
                  console.warn("Storage upload failed:", uploadErr.message);
                }
              }
            } else {
              console.warn("Image generation failed, creating text-only creative");
            }

            // 7. Insert creative into approval workflow
            const { data: created, error: insertErr } = await supabase
              .from("creatives")
              .insert({
                client_id: triggered.clientId,
                title: `[AI Auto] ${variation.title}`,
                type: "image",
                platform: "meta",
                file_url: fileUrl,
                headline: variation.headline,
                body_copy: variation.body_copy,
                cta_text: variation.cta_text,
                status: "pending",
                source: "ai-auto",
                trigger_campaign_id: triggered.campaignId,
                comments: [
                  {
                    id: Date.now().toString(),
                    author: "CPL Auto-Generator",
                    text: `🤖 **Auto-Generated Creative**\n\nTriggered because CPL ($${triggered.cpl.toFixed(2)}) exceeded target ($${triggered.targetCpl.toFixed(2)}).\n\n**Concept:** ${variation.concept}\n\n**Analysis:** ${variations.analysis || "N/A"}`,
                    createdAt: new Date().toISOString(),
                  },
                ],
              })
              .select("id")
              .single();

            if (insertErr) {
              console.error("Failed to insert creative:", insertErr.message);
            } else {
              createdCreatives.push(created.id);
            }

            // Small delay between image generations to avoid rate limits
            await new Promise((r) => setTimeout(r, 2000));
          } catch (varErr) {
            console.error(`Variation generation error:`, varErr);
          }
        }

        results.push({
          client: triggered.clientName,
          cpl: triggered.cpl.toFixed(2),
          targetCpl: triggered.targetCpl.toFixed(2),
          status: "generated",
          creativesCreated: createdCreatives.length,
          creativeIds: createdCreatives,
        });
      } catch (clientErr) {
        console.error(`Error processing ${triggered.clientName}:`, clientErr);
        results.push({
          client: triggered.clientName,
          status: "error",
          reason: clientErr instanceof Error ? clientErr.message : "Unknown error",
        });
      }
    }

    return new Response(JSON.stringify({
      success: true,
      triggered: triggeredClients.length,
      results,
      run_at: new Date().toISOString(),
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("cpl-creative-trigger error:", e);
    return new Response(JSON.stringify({ error: e.message || "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
