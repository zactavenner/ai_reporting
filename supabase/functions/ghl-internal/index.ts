// GHL Internal API proxy — uses Firebase refresh token captured by the GHL Chrome
// extension to call backend.leadconnectorhq.com endpoints not exposed by the public API
// (workflow list/get/update/trigger). Tokens are stored per-client in clients table.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const FIREBASE_API_KEY = "AIzaSyB_w3vXmsI7WeQtrIOkjR6xTRVN5uOieiE";
const BASE_URL = "https://backend.leadconnectorhq.com";
const CHROME_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// Tiny per-instance JWT cache keyed by refresh token (<50 min lifespan).
const tokenCache = new Map<string, { token: string; at: number }>();

async function exchangeRefreshToken(refreshToken: string): Promise<string> {
  const cached = tokenCache.get(refreshToken);
  if (cached && Date.now() - cached.at < 50 * 60 * 1000) return cached.token;

  const res = await fetch(
    `https://securetoken.googleapis.com/v1/token?key=${FIREBASE_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}`,
    },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Firebase refresh failed (${res.status}): ${text.slice(0, 300)}`);
  }
  const data = await res.json();
  const idToken = data.id_token as string | undefined;
  if (!idToken) throw new Error("Firebase response missing id_token");
  tokenCache.set(refreshToken, { token: idToken, at: Date.now() });
  return idToken;
}

async function ghlInternal(
  refreshToken: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; data: unknown }> {
  const doFetch = async (token: string) => {
    const res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        "token-id": token,
        channel: "APP",
        source: "WEB_USER",
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": CHROME_UA,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let data: unknown = text;
    try { data = text ? JSON.parse(text) : null; } catch { /* keep text */ }
    return { status: res.status, data };
  };

  let token = await exchangeRefreshToken(refreshToken);
  let result = await doFetch(token);
  if (result.status === 401 || result.status === 403) {
    tokenCache.delete(refreshToken);
    token = await exchangeRefreshToken(refreshToken);
    result = await doFetch(token);
  }
  return result;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { clientId, action, workflowId, body } = await req.json();
    if (!clientId || !action) {
      return new Response(JSON.stringify({ error: "clientId and action required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: client, error } = await supabase
      .from("clients")
      .select("id, ghl_location_id, ghl_firebase_refresh_token")
      .eq("id", clientId)
      .maybeSingle();
    if (error || !client) {
      return new Response(JSON.stringify({ error: "Client not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const locationId = client.ghl_location_id;
    const refresh = client.ghl_firebase_refresh_token;
    if (!locationId || !refresh) {
      return new Response(
        JSON.stringify({
          error:
            "Client missing ghl_location_id or ghl_firebase_refresh_token. Capture the token with the GHL Chrome extension and paste it into Client Settings.",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let path = "";
    let method = "GET";
    let payload: unknown = undefined;

    switch (action) {
      case "list_workflows":
        method = "GET";
        path = `/workflow/${locationId}`;
        break;
      case "get_workflow":
        if (!workflowId) throw new Error("workflowId required");
        method = "GET";
        path = `/workflow/${locationId}/${workflowId}`;
        break;
      case "update_workflow":
        if (!workflowId) throw new Error("workflowId required");
        method = "PUT";
        path = `/workflow/${locationId}/${workflowId}`;
        payload = body;
        break;
      case "create_trigger":
        method = "POST";
        path = `/workflow/${locationId}/trigger`;
        payload = body;
        break;
      case "update_trigger": {
        const triggerId = (body as { triggerId?: string } | undefined)?.triggerId;
        if (!triggerId) throw new Error("body.triggerId required");
        method = "PUT";
        path = `/workflow/${locationId}/trigger/${triggerId}`;
        payload = body;
        break;
      }
      case "create_tag":
        method = "POST";
        path = `/workflow/${locationId}/tags/create`;
        payload = body;
        break;
      default:
        return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }

    const result = await ghlInternal(refresh, method, path, payload);
    return new Response(JSON.stringify(result), {
      status: result.status >= 400 ? result.status : 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});