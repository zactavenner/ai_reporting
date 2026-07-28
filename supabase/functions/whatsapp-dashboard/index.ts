// WhatsApp dashboard proxy — the ONLY way the /whatsapp UI reads/writes
// WhatsApp state. Validates the custom dashboard_session_token, then uses the
// service-role client (bypassing RLS) to serve requests.
//
// This function is deliberately configured with `verify_jwt = false` because
// the app uses a custom HMAC token (not a Supabase Auth JWT). We do our own
// server-side token check via verifyDashboardToken.
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { verifyDashboardToken, readDashboardToken } from '../_shared/dashboardToken.ts';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
});

async function getOrCreateSession(admin: ReturnType<typeof createClient>, label = 'default') {
  const { data: existing } = await admin
    .from('whatsapp_sessions').select('*').eq('label', label).maybeSingle();
  if (existing) return existing;
  const { data: created, error } = await admin
    .from('whatsapp_sessions')
    .insert({ label, status: 'disconnected' })
    .select('*')
    .single();
  if (error) throw error;
  return created;
}

// Timeout-safe bridge fetch. Any transport failure (DNS, TLS, timeout, TCP
// reset) is captured as { configured: true, ok: false, status: 0, error }
// so the caller can surface a real diagnostic to the UI instead of hanging
// or throwing.
async function callBridge(
  path: string,
  method: 'GET' | 'POST',
  body?: unknown,
  timeoutMs = 10_000,
) {
  const url = Deno.env.get('WHATSAPP_BRIDGE_URL');
  const token = Deno.env.get('WHATSAPP_BRIDGE_TOKEN');
  if (!url) return { configured: false, ok: false, status: 0, body: null as any, error: 'WHATSAPP_BRIDGE_URL not set' };
  if (!token) return { configured: false, ok: false, status: 0, body: null as any, error: 'WHATSAPP_BRIDGE_TOKEN not set' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const target = `${url.replace(/\/$/, '')}${path}`;
  try {
    const res = await fetch(target, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const text = await res.text();
    let parsed: any = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
    return { configured: true, ok: res.ok, status: res.status, body: parsed, error: res.ok ? null : `bridge ${res.status}` };
  } catch (e) {
    const msg = (e as Error)?.name === 'AbortError'
      ? `bridge timeout after ${timeoutMs}ms (${target})`
      : `bridge fetch failed: ${(e as Error).message} (${target})`;
    console.error('[callBridge]', msg);
    return { configured: true, ok: false, status: 0, body: null as any, error: msg };
  } finally {
    clearTimeout(timer);
  }
}

// Actively probe /health so the UI can distinguish "URL configured" from
// "bridge answering right now". Short timeout — this is called on every load.
async function probeBridge(timeoutMs = 4_000) {
  const url = Deno.env.get('WHATSAPP_BRIDGE_URL');
  if (!url) return { configured: false, reachable: false, error: 'WHATSAPP_BRIDGE_URL not set', body: null as any };
  const r = await callBridge('/health', 'GET', undefined, timeoutMs);
  return {
    configured: true,
    reachable: r.ok,
    status: r.status,
    error: r.ok ? null : r.error,
    body: r.body,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { error: 'method not allowed' });

  let body: any = {};
  try { body = await req.json(); } catch { /* keep {} */ }

  const token = readDashboardToken(req, body);
  const member = await verifyDashboardToken(token);
  if (!member) return json(401, { error: 'invalid dashboard session — sign in again' });

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const action = String(body.action ?? '');
  const sessionLabel = String(body.session_label ?? 'default');

  try {
    switch (action) {
      case 'session_get': {
        const session = await getOrCreateSession(admin, sessionLabel);
        const probe = await probeBridge();
        return json(200, {
          session,
          bridgeConfigured: probe.configured,
          bridgeReachable: probe.reachable,
          bridgeError: probe.error,
          bridgeProbe: probe.body,
        });
      }

      case 'bridge_probe': {
        const probe = await probeBridge(6_000);
        return json(200, {
          bridgeConfigured: probe.configured,
          bridgeReachable: probe.reachable,
          bridgeError: probe.error,
          bridgeStatus: probe.status,
          bridgeBody: probe.body,
          bridgeUrlPresent: !!Deno.env.get('WHATSAPP_BRIDGE_URL'),
          bridgeTokenPresent: !!Deno.env.get('WHATSAPP_BRIDGE_TOKEN'),
        });
      }

      case 'status_refresh': {
        const session = await getOrCreateSession(admin, sessionLabel);
        const r = await callBridge(`/status?session_label=${encodeURIComponent(sessionLabel)}`, 'GET');
        if (!r.configured) {
          const patch = { status: 'error', last_error: r.error ?? 'Bridge not configured' };
          const { data: updated } = await admin.from('whatsapp_sessions')
            .update(patch).eq('id', session.id).select('*').single();
          return json(200, {
            session: updated ?? { ...session, ...patch },
            bridgeConfigured: false, bridgeReachable: false,
            error: patch.last_error, message: patch.last_error,
          });
        }
        if (!r.ok) {
          // Transport / non-2xx — persist the actual error so the UI can show it.
          const detail = r.body != null
            ? (typeof r.body === 'string' ? r.body : JSON.stringify(r.body)).slice(0, 500)
            : (r.error ?? 'unknown bridge error');
          const patch = { status: 'error', last_error: `${r.error ?? 'bridge error'}${r.body ? ` — ${detail}` : ''}` };
          const { data: updated } = await admin.from('whatsapp_sessions')
            .update(patch).eq('id', session.id).select('*').single();
          console.error('[status_refresh] bridge non-ok', { status: r.status, error: r.error, body: r.body });
          return json(200, {
            session: updated ?? { ...session, ...patch },
            bridgeConfigured: true, bridgeReachable: false,
            error: patch.last_error,
          });
        }
        const live = r.body ?? {};
        const nowIso = new Date().toISOString();
        const patch: Record<string, unknown> = {
          status: live.status ?? 'disconnected',
          phone_number: live.phone_number || null,
          last_qr: live.qr || null,
          last_qr_at: live.qr_at || (live.qr ? nowIso : session.last_qr_at),
          last_error: live.error || null,
          bridge_meta: live,
        };
        if (live.status === 'connected') patch.last_connected_at = nowIso;
        const { data: updated } = await admin.from('whatsapp_sessions')
          .update(patch).eq('id', session.id).select('*').single();
        return json(200, {
          session: updated ?? { ...session, ...patch },
          bridgeConfigured: true, bridgeReachable: true,
        });
      }

      case 'status_reset':
      case 'status_logout': {
        const session = await getOrCreateSession(admin, sessionLabel);
        const path = action === 'status_reset' ? '/reset' : '/logout';
        const r = await callBridge(`${path}?session_label=${encodeURIComponent(sessionLabel)}`, 'POST');
        if (!r.configured) {
          const patch = { status: 'error', last_error: r.error ?? 'Bridge not configured' };
          await admin.from('whatsapp_sessions').update(patch).eq('id', session.id);
          return json(200, { ok: false, bridgeConfigured: false, error: patch.last_error });
        }
        const detail = r.body != null
          ? (typeof r.body === 'string' ? r.body : JSON.stringify(r.body)).slice(0, 400)
          : null;
        const errorText = r.ok ? null : `${r.error ?? 'bridge error'}${detail ? ` — ${detail}` : ''}`;
        await admin.from('whatsapp_sessions').update({
          status: r.ok ? 'connecting' : 'error',
          phone_number: action === 'status_reset' ? null : session.phone_number,
          last_qr: null,
          last_qr_at: null,
          last_error: errorText,
        }).eq('id', session.id);
        if (!r.ok) console.error(`[${action}] bridge`, { status: r.status, error: r.error, body: r.body });
        return json(200, { ok: r.ok, bridgeConfigured: true, bridgeReachable: r.ok, bridge: r.body, error: errorText });
      }

      case 'contacts_list': {
        const session = await getOrCreateSession(admin, sessionLabel);
        const { data } = await admin.from('whatsapp_contacts')
          .select('*').eq('session_id', session.id)
          .order('last_message_at', { ascending: false, nullsFirst: false })
          .limit(400);
        return json(200, { contacts: data ?? [] });
      }

      case 'messages_list': {
        const session = await getOrCreateSession(admin, sessionLabel);
        const jid = String(body.jid ?? '');
        if (!jid) return json(400, { error: 'jid required' });
        const { data } = await admin.from('whatsapp_messages')
          .select('*').eq('session_id', session.id).eq('jid', jid)
          .order('wa_timestamp', { ascending: true }).limit(500);
        return json(200, { messages: data ?? [] });
      }

      case 'contact_mark_read': {
        const session = await getOrCreateSession(admin, sessionLabel);
        const jid = String(body.jid ?? '');
        if (!jid) return json(400, { error: 'jid required' });
        await admin.from('whatsapp_contacts')
          .update({ unread_count: 0 }).eq('session_id', session.id).eq('jid', jid);
        return json(200, { ok: true });
      }

      case 'contact_link_client': {
        const contact_id = String(body.contact_id ?? '');
        if (!contact_id) return json(400, { error: 'contact_id required' });
        const linked_client_id = body.linked_client_id ?? null;
        const { data, error } = await admin.from('whatsapp_contacts')
          .update({ linked_client_id }).eq('id', contact_id).select('*').single();
        if (error) return json(500, { error: error.message });
        return json(200, { contact: data });
      }

      case 'send_message': {
        const jid = String(body.jid ?? '');
        const message = String(body.message ?? '');
        if (!jid || !message) return json(400, { error: 'jid and message required' });
        const session = await getOrCreateSession(admin, sessionLabel);
        const phone = jid.includes('@s.whatsapp.net') ? '+' + jid.split('@')[0] : null;

        // Always upsert queue row so we have a persistent audit trail.
        const enqueueRow = {
          session_id: session.id, jid, phone, message,
          source: String(body.source ?? 'manual'),
          alert_type: body.alert_type ?? null,
          client_id: body.client_id ?? null,
          task_id: body.task_id ?? null,
          created_by: member.id,
          status: 'pending',
          next_attempt_at: new Date().toISOString(),
        };

        // Direct bridge call when connected
        if (session.status === 'connected' && Deno.env.get('WHATSAPP_BRIDGE_URL')) {
          const r = await callBridge('/send', 'POST', { session_label: sessionLabel, jid, message });
          if (r.ok) {
            const waMessageId = typeof r.body?.wa_message_id === 'string' ? r.body.wa_message_id : null;
            const { data: contact } = await admin.from('whatsapp_contacts').upsert({
              session_id: session.id, jid, is_group: jid.endsWith('@g.us'),
              phone, display_name: phone ?? jid,
              last_message_at: new Date().toISOString(),
              last_message_preview: message.slice(0, 200),
            }, { onConflict: 'session_id,jid' }).select('id').single();
            const outbound = {
              session_id: session.id, contact_id: contact?.id ?? null,
              jid, wa_message_id: waMessageId, direction: 'outbound',
              body: message, message_type: 'text', status: 'sent',
              sender_name: member.name,
              wa_timestamp: new Date().toISOString(),
            };
            if (waMessageId) {
              await admin.from('whatsapp_messages').upsert(outbound, {
                onConflict: 'session_id,wa_message_id', ignoreDuplicates: false,
              });
            } else {
              await admin.from('whatsapp_messages').insert(outbound);
            }
            return json(200, { ok: true, wa_message_id: waMessageId, queued: false });
          }
          // Fall through to queue
          await admin.from('whatsapp_send_queue').insert({
            ...enqueueRow, last_error: `bridge ${r.status}`,
          });
          return json(202, { ok: false, queued: true, error: `bridge ${r.status}` });
        }

        await admin.from('whatsapp_send_queue').insert({
          ...enqueueRow,
          last_error: session.status !== 'connected'
            ? `session ${session.status}` : 'bridge not configured',
        });
        return json(202, { ok: false, queued: true, error: 'not connected — queued' });
      }

      case 'queue_list': {
        const { data } = await admin.from('whatsapp_send_queue')
          .select('*').order('created_at', { ascending: false }).limit(100);
        const { data: counts } = await admin.from('whatsapp_send_queue').select('status');
        const stats = {
          pending: 0, failed: 0, sending: 0, sent: 0, dead: 0,
        } as Record<string, number>;
        (counts ?? []).forEach((r: any) => { stats[r.status] = (stats[r.status] ?? 0) + 1; });
        return json(200, { queue: data ?? [], stats });
      }

      case 'queue_retry': {
        const id = String(body.id ?? '');
        if (!id) return json(400, { error: 'id required' });
        await admin.from('whatsapp_send_queue').update({
          status: 'pending', next_attempt_at: new Date().toISOString(), last_error: null,
        }).eq('id', id);
        return json(200, { ok: true });
      }
      case 'queue_cancel': {
        const id = String(body.id ?? '');
        if (!id) return json(400, { error: 'id required' });
        await admin.from('whatsapp_send_queue').update({ status: 'dead' }).eq('id', id);
        return json(200, { ok: true });
      }
      case 'queue_purge': {
        await admin.from('whatsapp_send_queue').delete().in('status', ['sent', 'dead']);
        return json(200, { ok: true });
      }
      case 'queue_drain_now': {
        const drainRes = await fetch(
          `${Deno.env.get('SUPABASE_URL')}/functions/v1/whatsapp-queue-drain`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
              'Content-Type': 'application/json',
            },
            body: '{}',
          });
        const t = await drainRes.text();
        return json(drainRes.status, t ? JSON.parse(t) : { ok: true });
      }

      case 'recipients_list': {
        const { data } = await admin.from('jarvis_alert_recipients')
          .select('*').order('created_at', { ascending: true });
        return json(200, { recipients: data ?? [] });
      }
      case 'recipient_upsert': {
        const row = body.row ?? {};
        if (!row.name || !row.phone_e164) return json(400, { error: 'name and phone_e164 required' });
        if (row.id) {
          const { data, error } = await admin.from('jarvis_alert_recipients')
            .update({
              name: row.name, phone_e164: row.phone_e164,
              active: row.active ?? true,
              alert_types: row.alert_types ?? ['all'],
              notes: row.notes ?? null,
            }).eq('id', row.id).select('*').single();
          if (error) return json(500, { error: error.message });
          return json(200, { recipient: data });
        }
        const { data, error } = await admin.from('jarvis_alert_recipients').insert({
          name: row.name, phone_e164: row.phone_e164,
          active: row.active ?? true,
          alert_types: row.alert_types ?? ['all'],
          notes: row.notes ?? null,
        }).select('*').single();
        if (error) return json(500, { error: error.message });
        return json(200, { recipient: data });
      }
      case 'recipient_delete': {
        const id = String(body.id ?? '');
        if (!id) return json(400, { error: 'id required' });
        await admin.from('jarvis_alert_recipients').delete().eq('id', id);
        return json(200, { ok: true });
      }

      case 'clients_list': {
        const { data } = await admin.from('clients').select('id, name').order('name');
        return json(200, { clients: data ?? [] });
      }

      case 'whoami':
        return json(200, { member });

      default:
        return json(400, { error: `unknown action: ${action}` });
    }
  } catch (e) {
    console.error('whatsapp-dashboard error', e);
    return json(500, { error: (e as Error).message });
  }
});