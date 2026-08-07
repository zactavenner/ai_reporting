// Public Google redirect target. Verifies the signed state, exchanges the code
// server-side and stores the refresh token in the service-role-only
// google_calendar_connections table. Tokens are never rendered or logged.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { verifyOauthState } from '../_shared/calendarOauthState.ts';

function html(body: string, status = 200) {
  return new Response(
    `<!doctype html><meta charset="utf-8">
     <style>body{font-family:-apple-system,system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;background:#0a0a0a;color:#fafafa;margin:0}
     .card{padding:44px;border:1px solid #262626;border-radius:16px;text-align:center;max-width:440px}
     h1{margin:0 0 10px;font-weight:600;font-size:21px}p{color:#a3a3a3;margin:0}</style>
     <div class="card">${body}</div>`,
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  );
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const err = url.searchParams.get('error');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

  if (err) return html('<h1>Connection cancelled</h1><p>No calendar was connected.</p>', 400);
  if (!(await verifyOauthState(state, serviceKey))) {
    return html('<h1>Invalid or expired request</h1><p>Start the connection again from Settings.</p>', 400);
  }
  if (!code) return html('<h1>Missing authorization code</h1>', 400);

  const projectRef = Deno.env.get('SUPABASE_URL')?.replace(/^https?:\/\//, '').split('.')[0];
  const redirectUri = `https://${projectRef}.supabase.co/functions/v1/google-calendar-oauth-callback`;

  const tokRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: Deno.env.get('GOOGLE_OAUTH_CLIENT_ID') || '',
      client_secret: Deno.env.get('GOOGLE_OAUTH_CLIENT_SECRET') || '',
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  if (!tokRes.ok) {
    console.error('calendar token exchange failed', tokRes.status);
    return html('<h1>Token exchange failed</h1><p>Check the Google OAuth client configuration.</p>', 502);
  }
  const tok = await tokRes.json();
  if (!tok.refresh_token) {
    return html(
      '<h1>No refresh token returned</h1><p>Revoke this app at Google account permissions, then reconnect.</p>',
      400,
    );
  }

  let email = '';
  let name: string | null = null;
  try {
    const prof = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tok.access_token}` },
    }).then((r) => r.json());
    email = String(prof?.email || '').toLowerCase();
    name = prof?.name || null;
  } catch {
    /* email stays empty → rejected below */
  }
  if (!email) return html('<h1>Could not read the Google account email</h1>', 400);

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey);
  const { error: upErr } = await supabase.from('google_calendar_connections').upsert(
    {
      organizer_email: email,
      display_name: name || email,
      refresh_token: tok.refresh_token,
      access_token: tok.access_token,
      access_token_expires_at: new Date(Date.now() + (tok.expires_in ?? 3500) * 1000).toISOString(),
      scope: tok.scope,
      status: 'active',
      last_refreshed_at: new Date().toISOString(),
      last_error: null,
      last_error_at: null,
    },
    { onConflict: 'organizer_email' },
  );
  if (upErr) {
    console.error('calendar connection store failed');
    return html('<h1>Could not save the connection</h1>', 500);
  }

  return html(
    `<h1>${email} connected</h1><p>Calendar access is stored server-side. You can close this window.</p>
     <script>setTimeout(()=>{try{window.opener?.postMessage({type:'calendar_connected'},'*')}catch{}},100)</script>`,
  );
});