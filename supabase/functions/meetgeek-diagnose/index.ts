// Temporary diagnostic: verifies agency MeetGeek credentials + hydration shape.
// Never returns or logs the API key itself.
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const PASSWORD = "HPA1234$";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const body = await req.json().catch(() => ({}));
  if (body?.password !== PASSWORD) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const { data: agency } = await supabase
    .from("agency_settings")
    .select("meetgeek_api_key")
    .limit(1)
    .maybeSingle();
  const apiKey = (agency?.meetgeek_api_key || Deno.env.get("MEETGEEK_API_KEY") || "").trim();
  if (!apiKey) {
    return json({ error: "no_api_key" });
  }

  const meetingId = typeof body?.meeting_id === "string" ? body.meeting_id : null;
  const results: any[] = [];
  for (const base of ["https://api-us.meetgeek.ai", "https://api-eu.meetgeek.ai"]) {
    for (const path of [
      "/v1/meetings?limit=3",
      ...(meetingId ? [`/v1/meetings/${encodeURIComponent(meetingId)}`] : []),
    ]) {
      try {
        const res = await fetch(`${base}${path}`, {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        const text = await res.text();
        let parsed: any = null;
        try { parsed = JSON.parse(text); } catch { /* raw */ }
        results.push({
          base,
          path,
          status: res.status,
          keys: parsed && typeof parsed === "object" ? Object.keys(parsed).slice(0, 20) : null,
          sample: text.slice(0, 400),
        });
      } catch (e) {
        results.push({ base, path, error: (e as Error).message });
      }
    }
  }
  return json({ ok: true, key_length: apiKey.length, results });
});

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}