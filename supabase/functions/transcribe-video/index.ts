import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY")!;

/**
 * Word-level video transcription via Gemini 2.0 Flash.
 * Input: { videoUrl: string }  (publicly fetchable mp4/webm)
 * Output: { captions: [{ text, startTime, endTime, words: [{word, startTime, endTime}] }] }
 *
 * Uses inline base64 (suitable for short ad clips up to ~20MB).
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { videoUrl } = await req.json();
    if (!videoUrl) return json({ error: "videoUrl required" }, 400);
    if (!GEMINI_API_KEY) return json({ error: "GEMINI_API_KEY missing" }, 500);

    // Download video
    const dl = await fetch(videoUrl);
    if (!dl.ok) return json({ error: `Download failed ${dl.status}` }, 502);
    const buf = new Uint8Array(await dl.arrayBuffer());
    if (buf.byteLength > 19 * 1024 * 1024) {
      return json({ error: "Video too large for inline transcription (>19MB)" }, 413);
    }
    const mimeType =
      dl.headers.get("content-type")?.split(";")[0] ||
      (videoUrl.endsWith(".webm") ? "video/webm" : "video/mp4");

    // Base64 encode in chunks to avoid stack overflow
    let bin = "";
    const chunk = 0x8000;
    for (let i = 0; i < buf.length; i += chunk) {
      bin += String.fromCharCode.apply(null, Array.from(buf.subarray(i, i + chunk)));
    }
    const b64 = btoa(bin);

    const prompt = `Transcribe this video with word-level timestamps. Return ONLY JSON in this exact shape:
{
  "segments": [
    {
      "text": "full sentence",
      "startTime": 0.0,
      "endTime": 2.4,
      "words": [
        { "word": "Hello", "startTime": 0.0, "endTime": 0.4 },
        { "word": "world", "startTime": 0.4, "endTime": 0.9 }
      ]
    }
  ]
}
Times are seconds (decimals). Group ~4-8 words per segment. Include punctuation attached to the word. Do NOT include filler hesitations.`;

    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [
                { inline_data: { mime_type: mimeType, data: b64 } },
                { text: prompt },
              ],
            },
          ],
          generationConfig: {
            responseMimeType: "application/json",
            temperature: 0.1,
          },
        }),
      },
    );
    if (!r.ok) {
      const t = await r.text();
      return json({ error: `Gemini ${r.status}: ${t.slice(0, 400)}` }, 502);
    }
    const data = await r.json();
    const raw: string = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
    let parsed: any = {};
    try { parsed = JSON.parse(raw); } catch {
      const m = raw.match(/\{[\s\S]*\}/);
      parsed = m ? JSON.parse(m[0]) : {};
    }
    const captions = Array.isArray(parsed?.segments) ? parsed.segments : [];
    return json({ captions });
  } catch (e: any) {
    console.error("transcribe-video error", e);
    return json({ error: e?.message || String(e) }, 500);
  }
});

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}