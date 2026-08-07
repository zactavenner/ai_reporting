// Operator-gated start of the SEPARATE Google Calendar OAuth flow.
// It never touches the existing Gmail connection or its scopes.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { CALENDAR_SCOPES } from '../_shared/calendarGuest.ts';
import { createOauthState } from '../_shared/calendarOauthState.ts';
import { authorizeOperator } from '../_shared/operatorAuth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const auth = await authorizeOperator(req, supabase, createClient);
  if (!auth.ok) return json({ error: auth.error, code: auth.code }, auth.status);

  const clientId = Deno.env.get('GOOGLE_OAUTH_CLIENT_ID');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  if (!clientId) return json({ error: 'Google OAuth client is not configured' }, 500);

  const projectRef = Deno.env.get('SUPABASE_URL')?.replace(/^https?:\/\//, '').split('.')[0];
  const redirectUri = `https://${projectRef}.supabase.co/functions/v1/google-calendar-oauth-callback`;
  const state = await createOauthState(serviceKey);

  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', CALENDAR_SCOPES);
  authUrl.searchParams.set('access_type', 'offline');
  authUrl.searchParams.set('prompt', 'consent');
  authUrl.searchParams.set('include_granted_scopes', 'false');
  authUrl.searchParams.set('state', state);

  return json({ auth_url: authUrl.toString(), redirect_uri: redirectUri, scopes: CALENDAR_SCOPES });
});