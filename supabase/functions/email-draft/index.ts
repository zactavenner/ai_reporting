import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "../_shared/gmail.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const { email_id, tone_hint } = await req.json().catch(() => ({}));
  if (!email_id) return json({ error: "email_id required" }, 400);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: email, error } = await supabase.from("emails").select("*").eq("id", email_id).single();
  if (error || !email) return json({ error: "email not found" }, 404);

  const openRouterKey = (Deno.env.get("OPENROUTER_API_KEY") || "").trim().replace(/^[']|[']$/g, "").replace(/^[\"]|[\"]$/g, "");
  if (!openRouterKey.startsWith("sk-or-")) return json({ error: "OPENROUTER_API_KEY missing or invalid" }, 500);
  const system = `You are an executive email assistant for High Performance Ads, a premium ad agency.
Write professional, concise, warm replies. Match the recipient's formality. Get to the point.
Sign off as "Best," (the team member will add their name). Never invent facts.
Return JSON only.`;
  const user = `Draft a reply to this email.
${tone_hint ? `Tone preference: ${tone_hint}\n` : ""}
From: ${email.from_name} <${email.from_email}>
Subject: ${email.subject}
Body:
${(email.body_text || email.snippet || "").slice(0, 4000)}

Return: {"reply":"...","confidence":0-1,"urgency":"high|medium|low"}`;

  const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openRouterKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://reporting.highperformanceads.com",
      "X-Title": "HPA Email Draft",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      response_format: { type: "json_object" },
    }),
  });
  if (!r.ok) return json({ error: await r.text() }, 500);
  const data = await r.json();
  const content = data.choices?.[0]?.message?.content ?? "{}";
  let parsed: any = {};
  try { parsed = JSON.parse(content); } catch { parsed = { reply: content, confidence: 0.5, urgency: "medium" }; }

  const { data: draft, error: dErr } = await supabase.from("email_drafts").insert({
    email_id,
    body: parsed.reply || "",
    confidence: parsed.confidence ?? 0.7,
    urgency: parsed.urgency || "medium",
    model: "google/gemini-2.5-flash",
  }).select().single();
  if (dErr) return json({ error: dErr.message }, 500);

  return json({ draft });
});

function json(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}