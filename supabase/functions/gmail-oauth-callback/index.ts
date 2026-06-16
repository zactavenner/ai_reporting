import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "../_shared/gmail.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  const redirectUri = url.searchParams.get("redirect_uri") ||
    `${url.origin}/functions/v1/gmail-oauth-callback`;

  if (error) return html(`<h1>Connection cancelled</h1><p>${error}</p>`);
  if (!code) return html(`<h1>Missing code</h1>`);

  const clientId = Deno.env.get("GOOGLE_OAUTH_CLIENT_ID")!;
  const clientSecret = Deno.env.get("GOOGLE_OAUTH_CLIENT_SECRET")!;

  // Exchange code
  const tokRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!tokRes.ok) return html(`<h1>Token exchange failed</h1><pre>${await tokRes.text()}</pre>`);
  const tok = await tokRes.json();

  // Get profile
  const profRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${tok.access_token}` },
  });
  const prof = await profRes.json();

  if (!tok.refresh_token) {
    return html(`<h1>No refresh token returned</h1>
      <p>This usually happens when the same Google account has already been authorized.
      Revoke access at <a href="https://myaccount.google.com/permissions">Google permissions</a> and reconnect.</p>`);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const expiresAt = new Date(Date.now() + (tok.expires_in ?? 3500) * 1000).toISOString();
  const { error: upErr } = await supabase.from("gmail_accounts").upsert({
    email: prof.email,
    display_name: prof.name || prof.email,
    refresh_token: tok.refresh_token,
    access_token: tok.access_token,
    access_token_expires_at: expiresAt,
    scope: tok.scope,
    status: "active",
  }, { onConflict: "email" });
  if (upErr) return html(`<h1>DB error</h1><pre>${upErr.message}</pre>`);

  return html(`<!doctype html><meta charset="utf-8">
    <style>body{font-family:-apple-system,system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;background:#0a0a0a;color:#fafafa;margin:0}
    .card{padding:48px;border:1px solid #262626;border-radius:16px;text-align:center;max-width:420px}
    h1{margin:0 0 12px;font-weight:600;font-size:22px}
    p{color:#a3a3a3;margin:0 0 24px}
    button{background:#fafafa;color:#0a0a0a;border:0;border-radius:8px;padding:10px 18px;font-weight:500;cursor:pointer}</style>
    <div class="card">
      <h1>${prof.email} connected</h1>
      <p>You can close this window. The inbox will start syncing within 3 minutes.</p>
      <button onclick="window.close()">Close</button>
    </div>
    <script>setTimeout(()=>{try{window.opener?.postMessage({type:'gmail_connected',email:'${prof.email}'},'*')}catch{}}, 100)</script>`);
});

function html(body: string) {
  return new Response(body, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}