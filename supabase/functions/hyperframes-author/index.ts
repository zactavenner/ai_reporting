import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
const INTERNAL_PW = "HPA1234$";

/**
 * Hyperframes timeline authoring agent.
 * Takes an existing composition + a natural-language instruction and returns
 * a fully-rewritten composition JSON that adheres to the same schema. The
 * editor (canvas runtime) re-renders the updated composition immediately.
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json();
    if (body?.password !== INTERNAL_PW) {
      return json({ error: "Unauthorized" }, 401);
    }
    const composition = body.composition;
    const instruction: string = (body.instruction || "").trim();
    const videoPrompt: string | undefined = body.videoPrompt;
    if (!composition || !instruction) {
      return json({ error: "composition + instruction required" }, 400);
    }

    const sys = `You are a Hyperframes timeline editor. Given a composition JSON and a user instruction, return ONLY a JSON object of the form:
{"composition": <full updated composition>, "reply": "<one-sentence summary of the change>"}

The composition schema is:
{
  "width": int, "height": int, "fps": int, "duration": seconds (number),
  "bgColor": "#000",
  "layers": [
    { "id": string, "type": "video"|"text"|"subtitle"|"icon"|"rect",
      "start": seconds, "end": seconds,
      "x": 0..1, "y": 0..1, "anchor": "center"|"tl"|...,
      "opacity": 0..1, "scale": number, "rotate": deg,
      "animations": [ { "prop": "opacity"|"x"|"y"|"scale"|"rotate", "from": n, "to": n, "start": s, "end": s, "ease": "linear"|"easeIn"|"easeOut"|"easeInOut"|"spring" } ],
      // text/subtitle:
      "text": string, "fontSize": px, "fontWeight": 400|600|800, "color": "#fff", "bgColor": "rgba(0,0,0,0.55)", "padding": px, "borderRadius": px, "align": "center"|"left"|"right", "maxWidthPct": 0..1,
      // icon:
      "glyph": "🔥", "size": px,
      // rect:
      "width": 0..1, "height": 0..1, "color": "#C5A55A"
    }
  ]
}

Rules:
- Preserve the base "video" layer (id=base) — never delete it.
- Keep all existing layers unless the user explicitly asks to remove them.
- Always include short entrance animations (opacity+scale, easeOut/spring) for new text/icon layers.
- Subtitles go near y=0.85 with bg "rgba(0,0,0,0.55)".
- Headlines go near y=0.18 or 0.5 with no bg, large font.
- Stickers/icons should bounce in (scale 0->1 spring, ~0.35s).
- Stay inside composition duration; clip ends to duration if needed.
- Output ONLY valid JSON, no markdown fences.`;

    const userMsg = `CURRENT COMPOSITION:\n${JSON.stringify(composition)}\n\nORIGINAL VIDEO PROMPT (context, may be empty):\n${videoPrompt || ""}\n\nINSTRUCTION:\n${instruction}`;

    const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: sys },
          { role: "user", content: userMsg },
        ],
        response_format: { type: "json_object" },
      }),
    });
    if (!r.ok) {
      const t = await r.text();
      return json({ error: `AI gateway ${r.status}: ${t.slice(0, 300)}` }, 500);
    }
    const data = await r.json();
    const raw = data?.choices?.[0]?.message?.content ?? "{}";
    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch {
      const m = raw.match(/\{[\s\S]*\}$/);
      parsed = m ? JSON.parse(m[0]) : {};
    }
    if (!parsed?.composition) {
      return json({ error: "AI did not return composition", raw }, 502);
    }
    return json({ composition: parsed.composition, reply: parsed.reply || "Updated." });
  } catch (e: any) {
    console.error("hyperframes-author error", e);
    return json({ error: e?.message || String(e) }, 500);
  }
});

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}