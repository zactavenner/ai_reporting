// Resolve a Canva share/short link to its canonical design URL + design id.
// Accepts canva.link/* short URLs (follows the redirect chain) or full canva.com/design URLs.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ALLOWED_HOSTS = new Set([
  "canva.com",
  "www.canva.com",
  "canva.link",
  "www.canva.link",
]);

function extractDesignId(url: string): string | null {
  // https://www.canva.com/design/DAGxxxxxxxx/view?...
  const m = url.match(/canva\.com\/design\/([A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
}

async function followRedirects(startUrl: string, maxHops = 6): Promise<string> {
  let current = startUrl;
  for (let i = 0; i < maxHops; i++) {
    const res = await fetch(current, { method: "GET", redirect: "manual" });
    const loc = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && loc) {
      current = new URL(loc, current).toString();
      continue;
    }
    return current;
  }
  return current;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { url } = await req.json();
    if (!url || typeof url !== "string") throw new Error("url is required");

    let parsed: URL;
    try { parsed = new URL(url.trim()); }
    catch { throw new Error("Invalid URL"); }

    if (!ALLOWED_HOSTS.has(parsed.hostname)) {
      throw new Error("Only canva.com or canva.link URLs are allowed");
    }

    // If it's already a canonical /design/<id>/... URL, no need to fetch.
    let finalUrl = parsed.toString();
    if (!finalUrl.includes("/design/")) {
      finalUrl = await followRedirects(finalUrl);
    }

    const designId = extractDesignId(finalUrl);
    if (!designId) throw new Error("Could not extract Canva design id from the resolved URL");

    // Normalize to a clean /view URL (drops tracking params)
    const canvaUrl = `https://www.canva.com/design/${designId}/view`;

    return new Response(
      JSON.stringify({ success: true, canvaUrl, designId, resolvedUrl: finalUrl }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ success: false, error: e instanceof Error ? e.message : String(e) }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});