import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, webhook-id, webhook-timestamp, webhook-signature',
};

// Verify Fathom webhook signature using HMAC-SHA256
async function verifyWebhookSignature(secret: string, webhookId: string, timestamp: string, rawBody: string, signature: string): Promise<boolean> {
  try {
    // Check timestamp freshness (5 min tolerance)
    const ts = parseInt(timestamp, 10);
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - ts) > 300) {
      console.warn('[FathomWebhook] Timestamp too old/future:', now - ts, 'seconds');
      return false;
    }

    // Decode secret (after whsec_ prefix)
    const secretPart = secret.includes('_') ? secret.split('_').slice(1).join('_') : secret;
    const secretBytes = Uint8Array.from(atob(secretPart), c => c.charCodeAt(0));

    // Construct signed content
    const signedContent = `${webhookId}.${timestamp}.${rawBody}`;
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', secretBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(signedContent));
    const expectedSig = btoa(String.fromCharCode(...new Uint8Array(sig)));

    // Compare against all provided signatures
    const signatures = signature.split(' ').map(s => {
      const parts = s.split(',');
      return parts.length > 1 ? parts[1] : parts[0];
    });

    return signatures.some(s => s === expectedSig);
  } catch (e) {
    console.error('[FathomWebhook] Signature verification error:', e);
    return false;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const rawBody = await req.text();
  const webhookId = req.headers.get('webhook-id') || '';
  const webhookTimestamp = req.headers.get('webhook-timestamp') || '';
  const webhookSignature = req.headers.get('webhook-signature') || '';

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const meeting = JSON.parse(rawBody);
    console.log(`[FathomWebhook] Received meeting: ${meeting.title || meeting.meeting_title || 'Unknown'}`);

    // Find which client this webhook belongs to by matching webhook secret
    const { data: allSettings } = await supabase
      .from('client_settings')
      .select('client_id, fathom_api_keys, fathom_enabled, fathom_api_key')
      .eq('fathom_enabled', true);

    let matchedClientId: string | null = null;
    let verified = false;

    if (allSettings) {
      for (const cs of allSettings) {
        // Check multi-key array first
        const keys = (cs as any).fathom_api_keys || [];
        for (const entry of keys) {
          if (entry.webhook_secret && webhookSignature) {
            const isValid = await verifyWebhookSignature(entry.webhook_secret, webhookId, webhookTimestamp, rawBody, webhookSignature);
            if (isValid) {
              matchedClientId = cs.client_id;
              verified = true;
              console.log(`[FathomWebhook] Verified for client ${cs.client_id} via key "${entry.label}"`);
              break;
            }
          }
        }
        if (matchedClientId) break;
      }
    }

    // If no multi-key match, accept unverified if only one fathom-enabled client exists (backward compat)
    if (!matchedClientId && allSettings && allSettings.length === 1) {
      matchedClientId = allSettings[0].client_id;
      console.log(`[FathomWebhook] Single fathom client fallback: ${matchedClientId}`);
    }

    if (!matchedClientId) {
      console.error('[FathomWebhook] Could not match webhook to any client');
      return new Response(JSON.stringify({ success: false, error: 'No matching client' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ========== PROCESS MEETING ==========
    const meetingId = meeting.id?.toString() || `fathom-wh-${Date.now()}`;
    const title = meeting.title || meeting.meeting_title || 'Untitled Meeting';
    const meetingDate = meeting.created_at || meeting.recording_start_time || new Date().toISOString();
    const duration = meeting.recording_start_time && meeting.recording_end_time
      ? Math.round((new Date(meeting.recording_end_time).getTime() - new Date(meeting.recording_start_time).getTime()) / 1000 / 60)
      : null;

    // Extract attendees from calendar_invitees (v1 API format)
    const attendees = meeting.calendar_invitees || meeting.attendees || meeting.participants || [];
    const participants = attendees.map((a: any) => ({
      name: a.name || a.display_name,
      email: a.email,
      is_internal: a.is_internal === true || a.is_external === false,
    }));

    // Extract action items
    const actionItems = (meeting.action_items || []).map((ai: any) => ({
      text: ai.description || ai.text || ai.content,
      assignee: ai.assignee?.name || ai.assignee,
      completed: ai.completed || false,
      timestamp: ai.recording_timestamp || null,
    }));

    // Recording URL
    const recordingUrl = meeting.url || meeting.share_url || null;
    const fathomUrl = meeting.url || `https://fathom.video/calls/${meetingId}`;

    // Summary
    const summary = meeting.default_summary?.markdown_formatted || meeting.summary || null;

    // Transcript - handle array format from Fathom v1
    let transcript: string | null = null;
    if (Array.isArray(meeting.transcript)) {
      transcript = meeting.transcript.map((t: any) => 
        `[${t.timestamp || ''}] ${t.speaker?.display_name || 'Speaker'}: ${t.text}`
      ).join('\n');
    } else if (typeof meeting.transcript === 'string') {
      transcript = meeting.transcript;
    } else if (meeting.transcript?.text) {
      transcript = meeting.transcript.text;
    }

    // Highlights
    const highlights = meeting.highlights || meeting.key_topics || null;

    // Upsert into agency_meetings (capture inserted row id for pending tasks)
    const { data: upsertedMeeting, error: upsertErr } = await supabase
      .from('agency_meetings')
      .upsert({
        meeting_id: `fathom-${meetingId}`,
        client_id: matchedClientId,
        title,
        meeting_date: meetingDate,
        duration_minutes: duration,
        summary,
        transcript,
        action_items: actionItems.length > 0 ? actionItems : null,
        participants,
        recording_url: recordingUrl,
        meetgeek_url: fathomUrl,
        highlights,
      } as any, { onConflict: 'meeting_id' })
      .select('id')
      .single();

    if (upsertErr) {
      console.error(`[FathomWebhook] Upsert error:`, upsertErr);
    }

    // ========== CREATE PENDING REVIEWABLE TASKS ==========
    if (upsertedMeeting?.id && actionItems.length > 0) {
      const pendingRows = actionItems
        .filter((ai: any) => ai.text && String(ai.text).trim())
        .map((ai: any) => ({
          meeting_id: upsertedMeeting.id,
          client_id: matchedClientId,
          title: String(ai.text).slice(0, 200),
          description: ai.assignee ? `Assigned to: ${ai.assignee}` : '',
          priority: 'medium',
          status: 'pending',
        }));
      if (pendingRows.length) {
        const { error: pendErr } = await supabase.from('pending_meeting_tasks').insert(pendingRows);
        if (pendErr) console.error('[FathomWebhook] pending_meeting_tasks insert failed:', pendErr);
        else console.log(`[FathomWebhook] Created ${pendingRows.length} pending tasks for client ${matchedClientId}`);
      }
    }

    // ========== MATCH CONTACTS & UPDATE CALLS ==========
    const externalAttendees = participants.filter((p: any) => !p.is_internal && (p.email || p.name));
    let matched = 0;
    let callsUpdated = 0;

    for (const attendee of externalAttendees) {
      const email = attendee.email?.toLowerCase()?.trim();
      const name = attendee.name?.trim();
      let lead: any = null;

      // 1) Match by call date proximity (+/- 24h)
      if (meetingDate) {
        const meetDate = new Date(meetingDate);
        const dayBefore = new Date(meetDate.getTime() - 24 * 60 * 60 * 1000).toISOString();
        const dayAfter = new Date(meetDate.getTime() + 24 * 60 * 60 * 1000).toISOString();

        const { data: callsByDate } = await supabase
          .from('calls')
          .select('id, lead_id, contact_phone, contact_email, contact_name')
          .eq('client_id', matchedClientId)
          .gte('scheduled_at', dayBefore)
          .lte('scheduled_at', dayAfter)
          .limit(20);

        if (callsByDate?.length) {
          let matchedCall = email
            ? callsByDate.find((c: any) => c.contact_email?.toLowerCase() === email)
            : null;
          if (!matchedCall && name) {
            matchedCall = callsByDate.find((c: any) => c.contact_name?.toLowerCase() === name.toLowerCase());
          }
          if (matchedCall?.lead_id) {
            const { data: leadData } = await supabase.from('leads').select('id, external_id, name, email, phone').eq('id', matchedCall.lead_id).single();
            if (leadData) lead = leadData;
          }
        }
      }

      // 2) Match by email
      if (!lead && email) {
        const { data: leads } = await supabase.from('leads').select('id, external_id, name, email, phone').eq('client_id', matchedClientId).ilike('email', email).limit(1);
        if (leads?.length) lead = leads[0];
      }

      // 3) Match by name
      if (!lead && name) {
        const { data: leads } = await supabase.from('leads').select('id, external_id, name, email, phone').eq('client_id', matchedClientId).ilike('name', name).limit(1);
        if (leads?.length) lead = leads[0];
      }

      if (!lead) continue;
      matched++;

      // Update lead email if missing
      if (email && !lead.email) {
        await supabase.from('leads').update({ email } as any).eq('id', lead.id);
      }

      // Find/create call record
      const meetDate = new Date(meetingDate);
      const dayBefore = new Date(meetDate.getTime() - 24 * 60 * 60 * 1000).toISOString();
      const dayAfter = new Date(meetDate.getTime() + 24 * 60 * 60 * 1000).toISOString();

      const { data: calls } = await supabase
        .from('calls')
        .select('id')
        .eq('client_id', matchedClientId)
        .eq('lead_id', lead.id)
        .gte('scheduled_at', dayBefore)
        .lte('scheduled_at', dayAfter)
        .limit(1);

      if (calls?.length) {
        const updateData: any = {};
        if (transcript) updateData.transcript = transcript;
        if (summary) updateData.summary = summary;
        if (recordingUrl) updateData.recording_url = recordingUrl;
        if (email) updateData.contact_email = email;
        if (Object.keys(updateData).length > 0) {
          await supabase.from('calls').update(updateData).eq('id', calls[0].id);
          callsUpdated++;
        }
      } else {
        const { error: insertErr } = await supabase.from('calls').insert({
          client_id: matchedClientId,
          external_id: `fathom-${meetingId}-${lead.external_id}`,
          lead_id: lead.id,
          contact_name: lead.name || name,
          contact_email: email || lead.email,
          contact_phone: lead.phone || null,
          scheduled_at: meetingDate,
          showed: true,
          showed_at: meetingDate,
          outcome: 'completed',
          transcript,
          summary,
          recording_url: recordingUrl,
          call_duration_seconds: duration ? duration * 60 : null,
        } as any);
        if (!insertErr) callsUpdated++;
      }

      // ========== PUSH TO GHL ==========
      try {
        const { data: clientData } = await supabase
          .from('clients')
          .select('ghl_api_key, ghl_location_id')
          .eq('id', matchedClientId)
          .single();

        if (clientData?.ghl_api_key && lead.external_id) {
          // Build meeting note for GHL
          const noteLines = [
            `📞 **Fathom Meeting: ${title}**`,
            '',
            `📅 ${new Date(meetingDate).toLocaleString()}`,
            duration ? `⏱ ${duration} min` : '',
            '',
          ];
          if (summary) {
            noteLines.push('**Summary:**', summary, '');
          }
          if (actionItems.length > 0) {
            noteLines.push('**Action Items:**');
            actionItems.forEach((ai: any) => noteLines.push(`  • ${ai.text}${ai.assignee ? ` (@${ai.assignee})` : ''}`));
            noteLines.push('');
          }
          if (fathomUrl) noteLines.push(`🔗 ${fathomUrl}`);

          const noteRes = await fetch(`https://services.leadconnectorhq.com/contacts/${lead.external_id}/notes`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${clientData.ghl_api_key}`,
              'Version': '2021-07-28',
              'Content-Type': 'application/json',
              'Accept': 'application/json',
            },
            body: JSON.stringify({ body: noteLines.filter(Boolean).join('\n') }),
          });

          if (noteRes.ok) {
            console.log(`[FathomWebhook] ✓ Pushed meeting note to GHL contact ${lead.external_id}`);
          } else {
            const errText = await noteRes.text();
            console.error(`[FathomWebhook] GHL note push failed (${noteRes.status}):`, errText);
          }
        }
      } catch (ghlErr) {
        console.error('[FathomWebhook] GHL push error (non-fatal):', ghlErr);
      }
    }

    console.log(`[FathomWebhook] ✓ Processed: ${title}, ${matched} contacts matched, ${callsUpdated} calls updated`);

    return new Response(JSON.stringify({ success: true, matched, callsUpdated }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err: unknown) {
    console.error('[FathomWebhook] Error:', err);
    return new Response(JSON.stringify({ success: false, error: err instanceof Error ? err.message : String(err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
