import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';

const GHL_BASE_URL = 'https://services.leadconnectorhq.com';
const HPA_CLIENT_ID = '18acd701-92ff-4bbc-86aa-1f7cd9a9c973'; // HPA - AI Capital Raising

interface Body {
  member_ids?: string[];
  phones?: string[]; // raw phone numbers (alternative to member_ids)
  channel: 'SMS' | 'WhatsApp';
  message: string;
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
  phone: string,
  name: string
): Promise<string | null> {
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    Version: '2021-07-28',
  };

  try {
    const res = await fetch(
      `${GHL_BASE_URL}/contacts/?locationId=${locationId}&query=${encodeURIComponent(phone)}&limit=1`,
      { headers }
    );
    if (res.ok) {
      const data = await res.json();
      if (data.contacts?.length) return data.contacts[0].id;
    }
  } catch (e) {
    console.warn('contact search failed', e);
  }

  const createRes = await fetch(`${GHL_BASE_URL}/contacts/`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ locationId, phone, name, source: 'Team Notification' }),
  });
  if (!createRes.ok) {
    const txt = await createRes.text();
    console.error('contact create failed', createRes.status, txt);
    return null;
  }
  const created = await createRes.json();
  return created.contact?.id ?? null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const body = (await req.json()) as Body;
    if (!body.message?.trim()) {
      return new Response(JSON.stringify({ error: 'message is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const channel = body.channel === 'WhatsApp' ? 'WhatsApp' : 'SMS';

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Load HPA GHL creds
    const { data: client, error: clientErr } = await supabase
      .from('clients')
      .select('id, name, ghl_api_key, ghl_location_id')
      .eq('id', HPA_CLIENT_ID)
      .maybeSingle();
    if (clientErr || !client?.ghl_api_key || !client?.ghl_location_id) {
      return new Response(
        JSON.stringify({ error: 'HPA GHL credentials not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Resolve recipients
    type R = { name: string; phone: string; member_id?: string };
    const recipients: R[] = [];

    if (body.member_ids?.length) {
      const { data: members } = await supabase
        .from('agency_members')
        .select('id, name, phone')
        .in('id', body.member_ids);
      for (const m of members || []) {
        if (m.phone) recipients.push({ name: m.name, phone: normalizePhone(m.phone), member_id: m.id });
      }
    }
    for (const raw of body.phones || []) {
      recipients.push({ name: 'Team', phone: normalizePhone(raw) });
    }

    if (!recipients.length) {
      return new Response(
        JSON.stringify({ error: 'No recipients with phone numbers found' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const headers = {
      Authorization: `Bearer ${client.ghl_api_key}`,
      'Content-Type': 'application/json',
      Version: '2021-04-15',
    };

    const results = [];
    for (const r of recipients) {
      const contactId = await findOrCreateContact(
        client.ghl_api_key,
        client.ghl_location_id,
        r.phone,
        r.name
      );
      if (!contactId) {
        results.push({ phone: r.phone, success: false, error: 'contact not found/created' });
        continue;
      }

      const sendRes = await fetch(`${GHL_BASE_URL}/conversations/messages`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          type: channel,
          contactId,
          message: body.message,
        }),
      });
      const sendBody = await sendRes.text();
      if (!sendRes.ok) {
        console.error('send failed', sendRes.status, sendBody);
        results.push({ phone: r.phone, success: false, error: `${sendRes.status} ${sendBody}` });
      } else {
        results.push({ phone: r.phone, success: true });
      }
    }

    const sent = results.filter((r) => r.success).length;
    return new Response(
      JSON.stringify({ success: true, sent, total: recipients.length, channel, results }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (e) {
    console.error('send-team-message error', e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});