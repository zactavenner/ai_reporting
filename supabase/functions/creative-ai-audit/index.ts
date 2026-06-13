import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const AI_GATEWAY_URL = "https://openrouter.ai/api/v1/chat/completions";

async function callAI(apiKey: string, prompt: string, options?: { temperature?: number; maxTokens?: number; model?: string }) {
  const response = await fetch(AI_GATEWAY_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: options?.model || "openrouter/owl-alpha",
      messages: [{ role: "user", content: prompt }],
      temperature: options?.temperature ?? 0.3,
      max_tokens: options?.maxTokens ?? 4096,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error("AI Gateway error:", response.status, errText);
    if (response.status === 429) {
      return { error: "Rate limited, please try again later", status: 429 };
    }
    if (response.status === 402) {
      return { error: "Payment required", status: 402 };
    }
    return { error: `AI request failed (${response.status})`, status: response.status };
  }

  const data = await response.json();
  const text = data.choices?.[0]?.message?.content || "";
  return { text };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { action, creative, videoUrl, transcript, imageUrl, editPrompt, model, annotatedImageUrl, aspectRatio, duration } = body;

    const LOVABLE_API_KEY = Deno.env.get('OPENROUTER_API_KEY');
    if (!LOVABLE_API_KEY) {
      throw new Error("OPENROUTER_API_KEY is not configured");
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // === SPELLING CHECK ===
    if (action === "spelling_check") {
      let textContent = `
Headline: ${creative?.headline || '(none)'}
Body Copy: ${creative?.body_copy || '(none)'}
CTA: ${creative?.cta_text || '(none)'}
      `.trim();

      if (transcript) {
        textContent += `\n\nVideo Transcript/Spoken Content:\n${transcript}`;
      }

      const hasTextFields = creative?.headline || creative?.body_copy || creative?.cta_text;
      if (!hasTextFields && !transcript) {
        return new Response(
          JSON.stringify({ hasErrors: false, severity: "none", errors: [], summary: "No text content to review" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const prompt = `You are a professional proofreader for advertising copy. Analyze this ad copy for spelling, grammar, and number formatting errors.

${textContent}

Respond ONLY with valid JSON in this exact format, no other text:
{
  "hasErrors": true or false,
  "severity": "none" or "minor" or "critical",
  "errors": [{"text": "the incorrect word/phrase", "issue": "description of error", "suggestion": "corrected version"}],
  "summary": "Brief 1-2 sentence summary of issues found, or 'No issues found' if clean"
}

IMPORTANT RULES:
1. **Number Formatting (CRITICAL)**: Numbers should use "#" symbol, not written out.
   - WRONG: "number one market", "number 1 market"
   - CORRECT: "#1 market"
2. **Spelling & Grammar**: Check for typos, misspellings, subject-verb agreement, etc.
3. **Video/Audio Transcripts**: If transcript is provided, check spoken content for the same issues.

Severity guide:
- "critical" = Spelling mistakes, major grammar errors, or numbers written out instead of using # symbol
- "minor" = Minor punctuation issues, spacing problems, capitalization inconsistencies
- "none" = Clean copy with no errors

Focus ONLY on objective errors, not style preferences. Marketing abbreviations and intentional stylization are acceptable.`;

      const result = await callAI(LOVABLE_API_KEY, prompt, { temperature: 0.1, maxTokens: 1024 });
      if (result.error) {
        return new Response(JSON.stringify({ error: result.error }), {
          status: result.status || 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      try {
        let cleanedText = (result.text || "").trim();
        if (cleanedText.startsWith("```json")) cleanedText = cleanedText.slice(7);
        else if (cleanedText.startsWith("```")) cleanedText = cleanedText.slice(3);
        if (cleanedText.endsWith("```")) cleanedText = cleanedText.slice(0, -3);
        cleanedText = cleanedText.trim();

        const parsed = JSON.parse(cleanedText);
        return new Response(JSON.stringify(parsed), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch {
        return new Response(
          JSON.stringify({ hasErrors: false, severity: "none", errors: [], summary: "Unable to analyze copy" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // === TRANSCRIBE ===
    if (action === "transcribe") {
      if (!videoUrl) {
        return new Response(
          JSON.stringify({ error: "No video URL provided" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const prompt = `You are a video transcription and analysis expert. Analyze this video URL and provide:
1. Describe what's happening in the video in detail
2. Transcribe any spoken words, text overlays, or captions
3. Note any background music or sound effects
4. Identify key messaging and calls to action

Format your response as:
**Visual Description:**
[Description of visuals]

**Spoken/Text Content:**
[Transcription of any speech or text]

**Audio Elements:**
[Description of music/sounds]

**Key Messaging:**
[Main marketing message and CTAs]

Video URL: ${videoUrl}`;

      const result = await callAI(LOVABLE_API_KEY, prompt, { temperature: 0.3, maxTokens: 4096 });
      if (result.error) {
        return new Response(JSON.stringify({ error: result.error, fallback: true }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(
        JSON.stringify({ transcript: result.text }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // === AUDIT ===
    if (action === "audit") {
      const creativeDetails = `
Title: ${creative?.title || 'N/A'}
Type: ${creative?.type || 'N/A'}
Platform: ${creative?.platform || 'N/A'}
Headline: ${creative?.headline || 'N/A'}
Body Copy: ${creative?.body_copy || 'N/A'}
CTA: ${creative?.cta_text || 'N/A'}
${transcript ? `Video Transcript: ${transcript}` : ''}
${creative?.file_url ? `File URL: ${creative.file_url}` : ''}
      `.trim();

      const prompt = `You are an expert digital advertising strategist and creative director with 15+ years of experience in paid social advertising. Analyze this ad creative and provide actionable feedback.

Your audit should cover:
1. **Overall Score (1-10)**: Rate the creative's effectiveness
2. **Headline Analysis**: Is it compelling? Clear value prop?
3. **Visual/Video Quality**: Professional? Attention-grabbing?
4. **Messaging Clarity**: Is the offer clear?
5. **CTA Effectiveness**: Strong action driver?
6. **Platform Optimization**: Suited for the target platform?
7. **Emotional Appeal**: Does it connect with the audience?
8. **Compliance Check**: Any potential ad policy issues?

Format with clear sections and be specific with recommendations.

Ad Creative Details:
${creativeDetails}`;

      const result = await callAI(LOVABLE_API_KEY, prompt, { temperature: 0.7, maxTokens: 4096 });
      if (result.error) {
        return new Response(JSON.stringify({ error: result.error }), {
          status: result.status || 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(
        JSON.stringify({ audit: result.text }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // === AI EDIT ===
    if (action === "ai_edit") {
      const actualImageUrl = imageUrl || creative?.file_url;
      const actualEditPrompt = editPrompt || "";

      if (!actualImageUrl) {
        return new Response(
          JSON.stringify({ error: "No image URL provided" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Default to Gemini flash image; allow caller to pick another image-capable model.
      const editModel = model || "google/gemini-3.1-flash-image-preview";

      // If the user marked up the image, send BOTH images so the model sees what to change.
      const userContent: any[] = [];
      const promptText = annotatedImageUrl
        ? `The second image is the original ad. The first image is the SAME ad with red markup drawn on top to indicate the exact regions the user wants you to change. Apply this edit only to the marked regions and keep everything else identical: ${actualEditPrompt || "improve the marked area"}`
        : (actualEditPrompt || "Enhance this image for advertising");
      userContent.push({ type: "text", text: promptText });
      if (annotatedImageUrl) {
        userContent.push({ type: "image_url", image_url: { url: annotatedImageUrl } });
      }
      userContent.push({ type: "image_url", image_url: { url: actualImageUrl } });

      const editResponse = await fetch(AI_GATEWAY_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: editModel,
          messages: [{ role: "user", content: userContent }],
          modalities: ["image", "text"],
        }),
      });

      if (!editResponse.ok) {
        const errText = await editResponse.text();
        console.error("AI Edit error:", editResponse.status, errText);
        if (editResponse.status === 429) {
          return new Response(JSON.stringify({ error: "Rate limited, try again later" }), {
            status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        if (editResponse.status === 402) {
          return new Response(JSON.stringify({ error: "Payment required, add credits" }), {
            status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        throw new Error("AI Edit failed");
      }

      const editData = await editResponse.json();
      const editedImage = editData.choices?.[0]?.message?.images?.[0]?.image_url?.url;
      const editText = editData.choices?.[0]?.message?.content || "";

      if (!editedImage) throw new Error("No image returned from AI");

      const base64Data = editedImage.replace(/^data:image\/\w+;base64,/, "");
      const imageBytes = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
      const fileName = `ai-edit-${Date.now()}.png`;
      const filePath = `${creative?.client_id || 'unknown'}/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from("creatives")
        .upload(filePath, imageBytes, { contentType: "image/png", upsert: true });

      if (uploadError) throw new Error("Failed to save edited image");

      const { data: publicUrl } = supabase.storage.from("creatives").getPublicUrl(filePath);

      return new Response(
        JSON.stringify({ editedImageUrl: publicUrl.publicUrl, description: editText, model: editModel }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // === IMAGE -> VIDEO (Veo 3.1) ===
    if (action === "to_video") {
      const srcUrl = imageUrl || creative?.file_url;
      if (!srcUrl) {
        return new Response(JSON.stringify({ error: "No image URL provided" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      // Proxy to the existing generate-video-from-image edge function.
      const { data: vData, error: vErr } = await supabase.functions.invoke('generate-video-from-image', {
        body: {
          imageUrl: srcUrl,
          prompt: editPrompt || 'Create a subtle, professional animation from this ad image with gentle parallax and natural motion.',
          aspectRatio: aspectRatio || '9:16',
          duration: duration || 5,
        },
      });
      if (vErr) {
        console.error('to_video kickoff failed:', vErr);
        return new Response(
          JSON.stringify({ error: vErr.message || 'Video kickoff failed', fallback: true }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      return new Response(JSON.stringify(vData || {}), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // === AI VARIATIONS ===
    if (action === "ai_variations") {
      const actualVarImageUrl = imageUrl || creative?.file_url;

      if (!actualVarImageUrl) {
        return new Response(
          JSON.stringify({ error: "No image URL provided" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const variationPrompts = [
        "Create a variation of this ad image with a completely different color palette (warmer tones). Keep the same composition and messaging but change the background, overlay colors, and accent colors to feel warm and inviting.",
        "Create a variation of this ad image with a cool, modern blue/teal color scheme. Adjust the background and visual elements to feel sleek and professional.",
        "Create a variation of this ad image with a bold, high-contrast dark theme. Use deep blacks and bright accent colors. Make the text larger and more impactful.",
      ];

      const variations: { url: string; description: string }[] = [];

      for (let i = 0; i < 3; i++) {
        try {
          const varResponse = await fetch(AI_GATEWAY_URL, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${LOVABLE_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: "google/gemini-3.1-flash-image-preview",
        models: ["google/gemini-3.1-flash-image-preview", "google/gemini-2.0-flash-001", "openai/gpt-4o-mini"],
              messages: [{
                role: "user",
                content: [
                  { type: "text", text: variationPrompts[i] },
                  { type: "image_url", image_url: { url: actualVarImageUrl } },
                ],
              }],
              modalities: ["image", "text"],
            }),
          });

          if (!varResponse.ok) {
            const errText = await varResponse.text();
            console.error(`Variation ${i + 1} error:`, varResponse.status, errText);
            if (varResponse.status === 429) {
              return new Response(JSON.stringify({ error: "Rate limited, try again later", variations }), {
                status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
              });
            }
            continue;
          }

          const varData = await varResponse.json();
          const varImage = varData.choices?.[0]?.message?.images?.[0]?.image_url?.url;
          const varText = varData.choices?.[0]?.message?.content || `Variation ${i + 1}`;

          if (varImage) {
            const b64 = varImage.replace(/^data:image\/\w+;base64,/, "");
            const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
            const fName = `ai-variation-${Date.now()}-${i + 1}.png`;
            const fPath = `${creative?.client_id || 'unknown'}/${fName}`;

            const { error: upErr } = await supabase.storage
              .from("creatives")
              .upload(fPath, bytes, { contentType: "image/png", upsert: true });

            if (!upErr) {
              const { data: pubUrl } = supabase.storage.from("creatives").getPublicUrl(fPath);
              variations.push({ url: pubUrl.publicUrl, description: varText });
            }
          }
        } catch (err) {
          console.error(`Variation ${i + 1} failed:`, err);
        }
      }

      return new Response(
        JSON.stringify({ variations }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ error: "Invalid action" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Creative AI error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error", fallback: true }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
