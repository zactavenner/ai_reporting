import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const GHL_BASE = 'https://rest.gohighlevel.com/v1';

async function ghlUpsertContact(apiKey: string, locationId: string, payload: {
  email?: string | null;
  phone?: string | null;
  firstName?: string;
}) {
  const body: any = { locationId };
  if (payload.email) body.email = payload.email;
  if (payload.phone) body.phone = payload.phone;
  if (payload.firstName) body.firstName = payload.firstName;
  const res = await fetch(`${GHL_BASE}/contacts/`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok && res.status !== 422) {
    throw new Error(`GHL contact upsert failed (${res.status}): ${JSON.stringify(data)}`);
  }
  const contactId = data?.contact?.id || data?.id;
  if (contactId) return contactId;
  // Fallback lookup by email or phone
  const q = payload.email || payload.phone || '';
  const lookup = await fetch(`${GHL_BASE}/contacts/lookup?email=${encodeURIComponent(payload.email || '')}&phone=${encodeURIComponent(payload.phone || '')}`, {
    headers: { 'Authorization': `Bearer ${apiKey}` },
  });
  const ldata = await lookup.json().catch(() => ({}));
  const id = ldata?.contacts?.[0]?.id;
  if (!id) throw new Error(`GHL contact not found after upsert for ${q}`);
  return id;
}

async function ghlSendMessage(apiKey: string, payload: any) {
  const res = await fetch(`${GHL_BASE}/conversations/messages`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`GHL send failed (${res.status}): ${JSON.stringify(data)}`);
  return data;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const {
      client_id,
      subject,
      message,
      preview_url,
      channels = ['email', 'sms'],
      task_id,
      creative_id,
      override_email,
      override_phone,
    } = await req.json();

    if (!client_id || !message) {
      return new Response(JSON.stringify({ error: 'client_id and message are required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: client, error: cErr } = await supabase
      .from('clients')
      .select('id, name, notification_email, notification_phone')
      .eq('id', client_id)
      .single();
    if (cErr || !client) throw new Error('Client not found');

    const email = (override_email ?? client.notification_email)?.trim() || null;
    const phone = (override_phone ?? client.notification_phone)?.trim() || null;

    const apiKey = Deno.env.get('AGENCY_GHL_API_KEY');
    const locationId = Deno.env.get('AGENCY_GHL_LOCATION_ID');
    if (!apiKey || !locationId) {
      return new Response(JSON.stringify({
        error: 'Agency GHL credentials not configured. Add AGENCY_GHL_API_KEY and AGENCY_GHL_LOCATION_ID secrets.',
      }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const wantEmail = channels.includes('email') && !!email;
    const wantSms = channels.includes('sms') && !!phone;

    if (!wantEmail && !wantSms) {
      return new Response(JSON.stringify({
        error: 'No notification email or phone configured on this client (and no override provided).',
      }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const contactId = await ghlUpsertContact(apiKey, locationId, {
      email,
      phone,
      firstName: client.name,
    });

    const results: any = { email: null, sms: null };

    const linkLine = preview_url ? `\n\nPreview: ${preview_url}` : '';
    const smsBody = `${message}${linkLine}`;

    if (wantSms) {
      try {
        results.sms = await ghlSendMessage(apiKey, {
          type: 'SMS',
          contactId,
          message: smsBody,
        });
      } catch (e: any) {
        results.sms = { error: e.message };
      }
    }

    if (wantEmail) {
      const html = `
        <div style="font-family: -apple-system, system-ui, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px;">
          <h2 style="margin: 0 0 12px;">${subject || 'Update from your team'}</h2>
          <p style="white-space: pre-wrap; line-height: 1.5; color: #222;">${message.replace(/</g, '&lt;')}</p>
          ${preview_url ? `<p style="margin-top:20px"><a href="${preview_url}" style="background:#0B2B26;color:#fff;padding:10px 18px;text-decoration:none;border-radius:6px;display:inline-block">View preview</a></p>` : ''}
        </div>`;
      try {
        results.email = await ghlSendMessage(apiKey, {
          type: 'Email',
          contactId,
          subject: subject || 'Update from your team',
          html,
          message,
        });
      } catch (e: any) {
        results.email = { error: e.message };
      }
    }

    // Append note on the task if provided
    if (task_id) {
      const sentParts: string[] = [];
      if (wantEmail && !results.email?.error) sentParts.push(`📧 Email → ${email}`);
      if (wantSms && !results.sms?.error) sentParts.push(`📱 SMS → ${phone}`);
      const failed: string[] = [];
      if (results.email?.error) failed.push(`Email failed: ${results.email.error}`);
      if (results.sms?.error) failed.push(`SMS failed: ${results.sms.error}`);

      const noteLines = [
        `Client notification sent.`,
        ...sentParts,
        ...(failed.length ? ['', ...failed] : []),
        '',
        `Message: ${message}`,
        preview_url ? `Preview: ${preview_url}` : '',
      ].filter(Boolean);

      await supabase.from('task_comments').insert({
        task_id,
        author_name: 'System',
        content: noteLines.join('\n'),
        comment_type: 'text',
      });
    }

    return new Response(JSON.stringify({
      success: true,
      sent_to: { email: wantEmail ? email : null, phone: wantSms ? phone : null },
      results,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (err: any) {
    console.error('send-client-notification error:', err);
    return new Response(JSON.stringify({ error: err.message || 'Unknown error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});