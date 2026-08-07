// Scheduled (and operator-triggerable) polling ingest for the MeetGeek
// guest-invite pipeline. Runs every 10 minutes via pg_cron; the signed webhook
// remains an optional real-time boost.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { authorizeOperator } from '../_shared/operatorAuth.ts';
import { runGuestInvitePolling } from '../_shared/guestPoller.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-dashboard-token',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  // Cron uses the service-role bearer; operators use the dashboard session token.
  const auth = await authorizeOperator(req, supabase, createClient, body);
  if (!auth.ok) return json({ error: auth.error, code: auth.code }, auth.status);

  try {
    const result = await runGuestInvitePolling({
      supabase,
      clientId: body?.client_id ? String(body.client_id) : null,
      horizonDays: Number(body?.horizon_days) > 0 ? Number(body.horizon_days) : 14,
      scanGoogle: body?.scan_google !== false,
    });
    return json({ ok: true, ...result });
  } catch (e) {
    console.error('meetgeek-guest-poll failed', String((e as Error).message).slice(0, 300));
    return json({ error: 'poll_failed' }, 500);
  }
});
