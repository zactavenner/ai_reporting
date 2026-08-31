// HyperFrames render-job API.
//
// verify_jwt = false is intentional: this app's agency operators authenticate
// through the password+name gate (no auth.users rows), so the caller identity is
// the HMAC-signed `dashboard_session_token` minted by `verify-password`. The
// handler verifies that signature against the server-only signing key and then
// REVALIDATES the current agency_members row as admin/owner. Nothing here trusts
// a client-supplied role, and the queue tables are service-role only.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { verifyDashboardToken, readDashboardToken } from '../_shared/dashboardToken.ts';
import { canonicalSpec, validateRenderSpec } from '../_shared/hyperframes-spec.mjs';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, apikey, content-type, x-client-info, x-dashboard-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const uuid = (s: unknown) =>
  typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
const WORKER_WINDOW_MS = 90_000;
const ADMIN_ROLES = new Set(['admin', 'owner']);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return reply({ error: 'POST required' }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return reply({ error: 'JSON body required' }, 400);
  }

  const member = await verifyDashboardToken(readDashboardToken(req, body));
  if (!member) return reply({ error: 'Sign in to the dashboard again' }, 401);
  if (!ADMIN_ROLES.has(String(member.role || '').toLowerCase())) {
    return reply({ error: 'Administrator access required for rendering' }, 403);
  }

  const url = Deno.env.get('SUPABASE_URL')!;
  const db = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const freshSince = () => new Date(Date.now() - WORKER_WINDOW_MS).toISOString();

  try {
    if (body.action === 'health') {
      const { data, error } = await db
        .from('hyperframes_workers')
        .select('last_seen_at')
        .gte('last_seen_at', freshSince())
        .limit(1);
      if (error) throw new Error('HyperFrames database setup is not deployed');
      return reply({ online: !!data?.length });
    }

    if (!uuid(body.jobId)) return reply({ error: 'Valid jobId required' }, 400);

    if (body.action === 'status') {
      const { data, error } = await db
        .from('hyperframes_render_jobs')
        .select('id,client_id,status,error,output_url,creative_id,created_at')
        .eq('id', body.jobId as string)
        .eq('requested_by', member.id)
        .maybeSingle();
      if (error) throw error;
      return data ? reply(data) : reply({ error: 'Job not found' }, 404);
    }

    if (
      body.action !== 'enqueue' || !uuid(body.projectId) || !uuid(body.clientId) ||
      body.approved !== true
    ) {
      return reply({ error: 'Project, client, and final-render approval required' }, 400);
    }

    // Rejects unsupported effects loudly (never silently drops them).
    validateRenderSpec(body.spec, url, body.clientId);

    const { data: project } = await db
      .from('video_projects')
      .select('id,client_id,name')
      .eq('id', body.projectId as string)
      .maybeSingle();
    if (!project || project.client_id !== body.clientId) {
      return reply({ error: 'Project does not belong to the selected client' }, 400);
    }

    // Idempotency: the same jobId + owner + target + spec returns the same job.
    const { data: existing } = await db
      .from('hyperframes_render_jobs')
      .select('id,requested_by,client_id,project_id,spec')
      .eq('id', body.jobId as string)
      .maybeSingle();
    if (existing) {
      if (
        existing.requested_by !== member.id ||
        existing.client_id !== body.clientId ||
        existing.project_id !== body.projectId ||
        canonicalSpec(existing.spec) !== canonicalSpec(body.spec)
      ) {
        return reply({ error: 'Request ID already belongs to a different render' }, 409);
      }
      return reply({ id: existing.id });
    }

    const { data: workers } = await db
      .from('hyperframes_workers')
      .select('id')
      .gte('last_seen_at', freshSince())
      .limit(1);
    if (!workers?.length) {
      return reply({ error: 'No HyperFrames worker is online. Start the render worker first' }, 503);
    }

    const { error } = await db.from('hyperframes_render_jobs').insert({
      id: body.jobId as string,
      project_id: project.id,
      client_id: project.client_id,
      requested_by: member.id,
      title: project.name,
      spec: body.spec,
    });
    if (error) throw error;
    return reply({ id: body.jobId }, 202);
  } catch (error) {
    return reply(
      { error: error instanceof Error ? error.message : 'Unable to process render request' },
      400,
    );
  }
});
