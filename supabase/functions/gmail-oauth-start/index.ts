import { corsHeaders, SCOPES } from "../_shared/gmail.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const url = new URL(req.url);
  let bodyRedirect: string | null = null;
  let bodyState: string | null = null;
  if (req.method === "POST") {
    try {
      const b = await req.json();
      if (typeof b?.redirect_uri === "string") bodyRedirect = b.redirect_uri;
      if (typeof b?.state === "string") bodyState = b.state;
    } catch (_) { /* empty body */ }
  }
  const projectRef = Deno.env.get("SUPABASE_URL")?.replace(/^https?:\/\//, "").split(".")[0];
  const defaultRedirect = projectRef
    ? `https://${projectRef}.supabase.co/functions/v1/gmail-oauth-callback`
    : `${url.origin.replace(/^http:/, "https:")}/functions/v1/gmail-oauth-callback`;
  const redirectUri = bodyRedirect || url.searchParams.get("redirect_uri") || defaultRedirect;
  const state = bodyState || url.searchParams.get("state") || crypto.randomUUID();

  const clientId = Deno.env.get("GOOGLE_OAUTH_CLIENT_ID");
  if (!clientId) {
    return new Response(
      JSON.stringify({ error: "GOOGLE_OAUTH_CLIENT_ID not configured" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", SCOPES);
  authUrl.searchParams.set("access_type", "offline");
  authUrl.searchParams.set("prompt", "consent");
  authUrl.searchParams.set("state", state);

  return new Response(
    JSON.stringify({ auth_url: authUrl.toString(), state, redirect_uri: redirectUri }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});