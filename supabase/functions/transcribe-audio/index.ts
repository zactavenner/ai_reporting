import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { callOpenRouter, AUDIO_MODELS } from "../_shared/openrouter.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { audio } = await req.json() as { audio: string };

    if (!audio) {
      return new Response(
        JSON.stringify({ error: "No audio provided" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Extract base64 data and mime type from data URL.
    // Mime types can contain attributes (e.g. "audio/webm;codecs=opus") before
    // the trailing ";base64,..." segment, so allow any chars up to the final
    // ";base64," marker.
    const matches = audio.match(/^data:(.+);base64,(.+)$/);
    if (!matches) {
      return new Response(
        JSON.stringify({ error: "Invalid audio format" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const result = await callOpenRouter([{
      role: "user",
      content: [
        { type: "text", text: "You are a transcription assistant. Transcribe the audio content. Return ONLY the transcribed text — no explanations, no formatting, just the exact words spoken." },
        { type: "image_url", image_url: { url: audio } },
      ],
    }], { models: AUDIO_MODELS, temperature: 0.1 });

    return new Response(
      JSON.stringify({ text: result.text, model: result.model }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Transcription error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
