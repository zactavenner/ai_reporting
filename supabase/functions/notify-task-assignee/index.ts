import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';

const GHL_BASE_URL = 'https://services.leadconnectorhq.com';
const APP_URL = 'https://aireporting.lovable.app';
// Agency-owned sender identity for all task notifications. Task alerts should
// always come from HPA's support inbox and dedicated number, never from the
// individual client's GHL location.
const AGENCY_FROM_EMAIL = 'support@highperformanceads.com';
const AGENCY_FROM_NUMBER = '+13239885958';

interface Body {
  task_id: string;
  member_id: string;
  kind: 'assigned' | 'due_today';
  triggered_by?: string;
  /** When present, retry a specific delivery row and increment retry_count. */
  retry_delivery_id?: string;
  /** When set, only attempt this channel (useful for retry). */
  only_channel?: 'sms' | 'email';
}

function normalizePhone(p: string): string {
  const digits = p.replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) return digits;
  if (digits.length === 10) return '+1' + digits;
  if (digits.length === 11 && digits.startsWith('1')) return '+' + digits;
  return '+' + digits;
}

async function findOrCreateContact(
  apiKey: string,
  locationId: string,
  phone: string | null,
  email: string | null,
  name: string,
): Promise<string | null> {
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    Version: '2021-07-28',
  };
  const query = phone || email;
  if (!query) return null;
  try {
    const res = await fetch(
      `${GHL_BASE_URL}/contacts/?locationId=${locationId}&query=${encodeURIComponent(query)}&limit=1`,
      { headers },
    );
    if (res.ok) {
      const data = await res.json();
      if (data.contacts?.length) return data.contacts[0].id;
    }
  } catch (e) {
    console.warn('contact search failed', e);
  }
  const body: Record<string, unknown> = { locationId, name, source: 'Task Notification' };
  if (phone) body.phone = phone;
  if (email) body.email = email;
  const createRes = await fetch(`${GHL_BASE_URL}/contacts/`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  if (!createRes.ok) {
    console.error('contact create failed', createRes.status, await createRes.text());
    return null;
  }
  const created = await createRes.json();
  return created.contact?.id ?? null;
}

async function ghlSend(
  apiKey: string,
  contactId: string,
  type: 'SMS' | 'Email',
  payload: { message?: string; subject?: string; html?: string },
) {
  const body: Record<string, unknown> = { type, contactId };
  if (type === 'SMS') {
    body.message = payload.message;
    body.fromNumber = AGENCY_FROM_NUMBER;
  }
  if (type === 'Email') {
    body.subject = payload.subject;
    body.html = payload.html;
    body.emailFrom = AGENCY_FROM_EMAIL;
  }
  const res = await fetch(`${GHL_BASE_URL}/conversations/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      Version: '2021-04-15',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text();
    console.error(`${type} send failed`, res.status, txt);
    return { ok: false, error: `${res.status} ${txt}` };
  }
  return { ok: true };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const { task_id, member_id, kind, triggered_by, retry_delivery_id, only_channel } =
      (await req.json()) as Body;
    if (!task_id || !member_id || !kind) {
      return new Response(JSON.stringify({ error: 'task_id, member_id, kind required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const [{ data: task }, { data: member }] = await Promise.all([
      supabase
        .from('tasks')
        .select('id, title, description, due_date, status, stage, client_id, clients(name)')
        .eq('id', task_id)
        .maybeSingle(),
      supabase
        .from('agency_members')
        .select('id, name, email, phone')
        .eq('id', member_id)
        .maybeSingle(),
    ]);

    if (!task || !member) {
      return new Response(JSON.stringify({ error: 'task or member not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Always send from the agency's own GHL location so notifications come from
    // support@highperformanceads.com and +1 323-988-5958 — never from the
    // client's brand. Fall back to the client's GHL only if agency creds are
    // missing (should not happen in production).
    const agencyKey = Deno.env.get('AGENCY_GHL_API_KEY') || Deno.env.get('AGENCY_GHL_PIT_TOKEN');
    const agencyLoc = Deno.env.get('AGENCY_GHL_LOCATION_ID');
    let client: { ghl_api_key: string | null; ghl_location_id: string | null } | null = null;
    if (agencyKey && agencyLoc) {
      client = { ghl_api_key: agencyKey, ghl_location_id: agencyLoc };
    } else if (task.client_id) {
      const { data } = await supabase
        .from('clients')
        .select('ghl_api_key, ghl_location_id')
        .eq('id', task.client_id)
        .maybeSingle();
      client = data as any;
    }
    const canSendGhl = !!(client?.ghl_api_key && client?.ghl_location_id);

    const clientName = (task as any).clients?.name || 'Internal';
    const taskUrl = `${APP_URL}/?task=${task.id}`;

    let dueStr = 'No due date';
    let daysUntilStr = '';
    if (task.due_date) {
      const due = new Date(task.due_date);
      dueStr = due.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
      const msPerDay = 1000 * 60 * 60 * 24;
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const dueMid = new Date(due);
      dueMid.setHours(0, 0, 0, 0);
      const days = Math.round((dueMid.getTime() - today.getTime()) / msPerDay);
      if (days === 0) daysUntilStr = 'today';
      else if (days === 1) daysUntilStr = 'tomorrow';
      else if (days === -1) daysUntilStr = '1 day overdue';
      else if (days < 0) daysUntilStr = `${Math.abs(days)} days overdue`;
      else daysUntilStr = `in ${days} days`;
    }

    const descSnippet = task.description
      ? String(task.description).replace(/\s+/g, ' ').trim().slice(0, 200)
      : '';

    const heading =
      kind === 'assigned'
        ? `New task assigned: ${task.title}`
        : `Task due today: ${task.title}`;

    const icon = kind === 'assigned' ? '📋' : '⏰';
    const dueLine = task.due_date
      ? `Due: ${dueStr}${daysUntilStr ? ` (${daysUntilStr})` : ''}`
      : 'Due: —';
    const smsLines = [
      `${icon} ${heading}`,
      `Client: ${clientName}`,
      dueLine,
    ];
    if (descSnippet) smsLines.push(`Details: ${descSnippet}`);
    smsLines.push(`Open: ${taskUrl}`);
    const smsBody = smsLines.join('\n');

    const emailSubject = `[${clientName}] ${heading}`;
    const emailHtml = `
      <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#111">
        <h2 style="margin:0 0 12px">${heading}</h2>
        <p style="margin:0 0 8px"><strong>Client:</strong> ${clientName}</p>
        <p style="margin:0 0 8px"><strong>Due:</strong> ${dueStr}</p>
        ${task.description ? `<p style="margin:12px 0;white-space:pre-wrap">${String(task.description).replace(/</g, '&lt;')}</p>` : ''}
        <p style="margin:20px 0"><a href="${taskUrl}" style="background:#0B2B26;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">Open Task</a></p>
        ${triggered_by ? `<p style="color:#666;font-size:12px">From ${triggered_by}</p>` : ''}
      </div>`;

    const phone = member.phone ? normalizePhone(member.phone) : null;
    const email = member.email || null;

    const results: Record<string, unknown> = {};

    // Helper: record a delivery attempt (sent/failed/skipped) and return its row.
    const logDelivery = async (
      channel: 'sms' | 'email',
      recipient: string | null,
      status: 'sent' | 'failed' | 'skipped',
      error: string | null,
      subject: string | null,
      body: string | null,
    ) => {
      // If retrying, update the existing row and bump retry_count.
      if (retry_delivery_id) {
        const { data: existing } = await supabase
          .from('task_notification_deliveries')
          .select('id, retry_count')
          .eq('id', retry_delivery_id)
          .eq('channel', channel)
          .maybeSingle();
        if (existing) {
          await supabase
            .from('task_notification_deliveries')
            .update({
              status,
              error,
              recipient,
              subject,
              message: body,
              retry_count: (existing.retry_count ?? 0) + 1,
              last_attempt_at: new Date().toISOString(),
              sent_at: status === 'sent' ? new Date().toISOString() : null,
              triggered_by: triggered_by || null,
              kind,
              provider: 'ghl',
            })
            .eq('id', existing.id);
          return;
        }
      }
      await supabase.from('task_notification_deliveries').insert({
        task_id: task.id,
        member_id: member.id,
        channel,
        status,
        provider: 'ghl',
        recipient,
        subject,
        message: body,
        error,
        retry_count: 0,
        sent_at: status === 'sent' ? new Date().toISOString() : null,
        kind,
        triggered_by: triggered_by || null,
      });
    };

    const wantSms = !only_channel || only_channel === 'sms';
    const wantEmail = !only_channel || only_channel === 'email';

    if (canSendGhl) {
      const contactId = await findOrCreateContact(
        client!.ghl_api_key!,
        client!.ghl_location_id!,
        phone,
        email,
        member.name,
      );
      if (contactId) {
        if (wantSms) {
          const smsRes = phone
            ? await ghlSend(client!.ghl_api_key!, contactId, 'SMS', { message: smsBody })
            : { ok: false, error: 'no phone' };
          results.sms = smsRes;
          await logDelivery(
            'sms',
            phone,
            smsRes.ok ? 'sent' : (phone ? 'failed' : 'skipped'),
            smsRes.ok ? null : (smsRes as any).error ?? 'unknown',
            null,
            smsBody,
          );
        }
        if (wantEmail) {
          const emailRes = email
            ? await ghlSend(client!.ghl_api_key!, contactId, 'Email', {
                subject: emailSubject,
                html: emailHtml,
              })
            : { ok: false, error: 'no email' };
          results.email = emailRes;
          await logDelivery(
            'email',
            email,
            emailRes.ok ? 'sent' : (email ? 'failed' : 'skipped'),
            emailRes.ok ? null : (emailRes as any).error ?? 'unknown',
            emailSubject,
            smsBody,
          );
        }
      } else {
        const err = 'contact create failed';
        if (wantSms) { results.sms = { ok: false, error: err }; await logDelivery('sms', phone, 'failed', err, null, smsBody); }
        if (wantEmail) { results.email = { ok: false, error: err }; await logDelivery('email', email, 'failed', err, emailSubject, smsBody); }
      }
    } else {
      const err = 'ghl not configured';
      if (wantSms) { results.sms = { ok: false, error: err }; await logDelivery('sms', phone, 'failed', err, null, smsBody); }
      if (wantEmail) { results.email = { ok: false, error: err }; await logDelivery('email', email, 'failed', err, emailSubject, smsBody); }
    }

    // In-app notification record
    await supabase.from('task_notifications').insert({
      task_id: task.id,
      member_id: member.id,
      triggered_by: triggered_by || (kind === 'due_today' ? 'Due-Today Watchdog' : 'Assignment'),
      message: heading,
    });

    await supabase.from('task_history').insert({
      task_id: task.id,
      action: kind === 'assigned' ? 'notification_assigned' : 'notification_due_today',
      new_value: `${member.name} (sms:${(results.sms as any).ok ? 'ok' : 'skip'}, email:${(results.email as any).ok ? 'ok' : 'skip'})`,
      changed_by: triggered_by || 'system',
    });

    return new Response(JSON.stringify({ success: true, results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('notify-task-assignee error', e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});