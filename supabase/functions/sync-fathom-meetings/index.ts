import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const FATHOM_BASE = 'https://api.fathom.ai/external/v1';

async function fetchFathomMeetings(apiKey: string, cursor?: string, sinceDate?: string): Promise<{ meetings: any[]; nextCursor: string | null }> {
  const params = new URLSearchParams({ limit: '50', include_transcript: 'true', include_summary: 'true' });
  if (cursor) params.set('cursor', cursor);
  if (sinceDate) params.set('created_after', sinceDate);

  const url = `${FATHOM_BASE}/meetings?${params.toString()}`;

  const res = await fetch(url, {
    headers: { 'X-Api-Key': apiKey },
  });

  if (res.status === 429) {
    console.warn('[Fathom] Rate limited, waiting 5s...');
    await new Promise(r => setTimeout(r, 5000));
    // Retry once
    const retry = await fetch(url, { headers: { 'X-Api-Key': apiKey } });
    if (!retry.ok) throw new Error(`Fathom API rate limit ${retry.status}`);
    const retryData = await retry.json();
    return {
      meetings: retryData.items || retryData.meetings || retryData.data || [],
      nextCursor: retryData.next_cursor || retryData.pagination?.next_cursor || null,
    };
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Fathom API error ${res.status}: ${text}`);
  }

  const data = await res.json();
  return {
    // Fathom v1 API returns "items", not "meetings"
    meetings: data.items || data.meetings || data.data || [],
    nextCursor: data.next_cursor || data.pagination?.next_cursor || null,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { client_id, max_pages } = await req.json();
    if (!client_id) {
      return new Response(JSON.stringify({ success: false, error: 'client_id required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Get Fathom settings
    const { data: settings, error: settingsErr } = await supabase
      .from('client_settings')
      .select('fathom_api_key, fathom_api_keys, fathom_enabled, fathom_last_sync')
      .eq('client_id', client_id)
      .single();

    if (settingsErr || !settings) {
      return new Response(JSON.stringify({ success: false, error: 'Client settings not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Collect all API keys (multi-key + legacy fallback + global)
    const allApiKeys: { label: string; key: string }[] = [];
    const multiKeys = (settings as any).fathom_api_keys || [];
    if (Array.isArray(multiKeys)) {
      for (const entry of multiKeys) {
        if (entry.api_key) allApiKeys.push({ label: entry.label || 'Unlabeled', key: entry.api_key });
      }
    }
    // Legacy single key if no multi-keys
    if (allApiKeys.length === 0) {
      const legacyKey = (settings as any).fathom_api_key || Deno.env.get('FATHOM_API_KEY');
      if (legacyKey) allApiKeys.push({ label: 'Default', key: legacyKey });
    }

    if (allApiKeys.length === 0) {
      return new Response(JSON.stringify({ success: false, error: 'No Fathom API key configured' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Only fetch meetings since last sync to avoid re-processing
    const lastSync = (settings as any).fathom_last_sync || null;
    const sinceDate = lastSync ? new Date(new Date(lastSync).getTime() - 2 * 60 * 60 * 1000).toISOString() : undefined; // 2h overlap

    // Deduplicate meetings across all keys
    const meetingMap = new Map<string, any>();
    const maxPagesToFetch = max_pages || 10;

    for (const { label, key } of allApiKeys) {
      console.log(`[Fathom] Fetching with key "${label}"`);
      let cursor: string | null = null;

      for (let page = 0; page < maxPagesToFetch; page++) {
        try {
          const { meetings, nextCursor } = await fetchFathomMeetings(key, cursor || undefined, sinceDate);
          for (const m of meetings) {
            const id = m.id?.toString() || `${Date.now()}-${Math.random()}`;
            if (!meetingMap.has(id)) meetingMap.set(id, m);
          }
          console.log(`[Fathom] Key "${label}" page ${page + 1}: ${meetings.length} meetings`);
          if (!nextCursor || meetings.length === 0) break;
          cursor = nextCursor;
          // Rate limit: 500ms between pages
          await new Promise(r => setTimeout(r, 500));
        } catch (e) {
          console.error(`[Fathom] Error fetching with key "${label}":`, e);
          break;
        }
      }

      // Delay between keys to avoid rate limits
      if (allApiKeys.length > 1) await new Promise(r => setTimeout(r, 1000));
    }

    const allMeetings = Array.from(meetingMap.values());
    console.log(`[Fathom] Total unique meetings: ${allMeetings.length}`);

    if (allMeetings.length === 0) {
      await supabase.from('client_settings').update({ fathom_last_sync: new Date().toISOString() } as any).eq('client_id', client_id);
      return new Response(JSON.stringify({ success: true, synced: 0, matched: 0, callsUpdated: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let synced = 0;
    let matched = 0;
    let callsUpdated = 0;

    for (const meeting of allMeetings) {
      const meetingId = meeting.id?.toString() || meeting.recording_id?.toString() || `fathom-${Date.now()}-${Math.random()}`;
      const title = meeting.title || meeting.meeting_title || 'Untitled Meeting';
      const meetingDate = meeting.created_at || meeting.recording_start_time || null;
      const duration = meeting.recording_start_time && meeting.recording_end_time
        ? Math.round((new Date(meeting.recording_end_time).getTime() - new Date(meeting.recording_start_time).getTime()) / 1000 / 60)
        : (meeting.duration_seconds ? Math.round(meeting.duration_seconds / 60) : null);

      // Extract attendees - handle both v1 (calendar_invitees) and legacy format
      const attendees = meeting.calendar_invitees || meeting.attendees || meeting.participants || [];
      const participants = attendees.map((a: any) => ({
        name: a.name || a.display_name,
        email: a.email,
        is_internal: a.is_internal === true || a.is_external === false,
      }));

      // Action items
      const actionItems = (meeting.action_items || []).map((ai: any) => ({
        text: ai.description || ai.text || ai.content,
        assignee: ai.assignee?.name || ai.assignee,
        completed: ai.completed || false,
        timestamp: ai.recording_timestamp || null,
      }));

      const recordingUrl = meeting.url || meeting.share_url || null;
      const fathomUrl = meeting.url || `https://fathom.video/calls/${meetingId}`;

      // Summary - handle v1 format (default_summary object)
      const summary = meeting.default_summary?.markdown_formatted || meeting.summary || null;

      // Transcript - handle array format
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

      const highlights = meeting.highlights || meeting.key_topics || null;

      // Upsert (capture id for pending task creation)
      const { data: upserted, error: upsertErr } = await supabase
        .from('agency_meetings')
        .upsert({
          meeting_id: `fathom-${meetingId}`,
          client_id,
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
        console.error(`[Fathom] Upsert error for ${meetingId}:`, upsertErr);
        continue;
      }
      synced++;

      // Create reviewable pending tasks from action items
      if (upserted?.id && actionItems.length > 0) {
        const pendingRows = actionItems
          .filter((ai: any) => ai.text && String(ai.text).trim())
          .map((ai: any) => ({
            meeting_id: upserted.id,
            client_id,
            title: String(ai.text).slice(0, 200),
            description: ai.assignee ? `Assigned to: ${ai.assignee}` : '',
            priority: 'medium',
            status: 'pending',
          }));
        if (pendingRows.length) {
          const { error: pendErr } = await supabase.from('pending_meeting_tasks').insert(pendingRows);
          if (pendErr) console.error('[Fathom] pending_meeting_tasks insert failed:', pendErr);
        }
      }

      // Match attendees to contacts
      const externalAttendees = participants.filter((p: any) => !p.is_internal && (p.email || p.name));

      if (externalAttendees.length > 0 && meetingDate) {
        for (const attendee of externalAttendees) {
          const email = attendee.email?.toLowerCase()?.trim();
          const name = attendee.name?.trim();
          let lead: any = null;

          // 1) Date proximity match via calls
          if (!lead && meetingDate) {
            const meetDate = new Date(meetingDate);
            const dayBefore = new Date(meetDate.getTime() - 24 * 60 * 60 * 1000).toISOString();
            const dayAfter = new Date(meetDate.getTime() + 24 * 60 * 60 * 1000).toISOString();

            const { data: callsByDate } = await supabase
              .from('calls')
              .select('id, lead_id, contact_phone, contact_email, contact_name')
              .eq('client_id', client_id)
              .gte('scheduled_at', dayBefore)
              .lte('scheduled_at', dayAfter)
              .limit(20);

            if (callsByDate?.length) {
              let matchedCall = email ? callsByDate.find((c: any) => c.contact_email?.toLowerCase() === email) : null;
              if (!matchedCall && name) {
                matchedCall = callsByDate.find((c: any) => c.contact_name?.toLowerCase() === name.toLowerCase());
              }
              if (matchedCall?.lead_id) {
                const { data: leadData } = await supabase.from('leads').select('id, external_id, name, email, phone').eq('id', matchedCall.lead_id).single();
                if (leadData) lead = leadData;
              }
            }
          }

          // 2) Email match
          if (!lead && email) {
            const { data: leads } = await supabase.from('leads').select('id, external_id, name, email, phone').eq('client_id', client_id).ilike('email', email).limit(1);
            if (leads?.length) lead = leads[0];
          }

          // 3) Name match
          if (!lead && name) {
            const { data: leads } = await supabase.from('leads').select('id, external_id, name, email, phone').eq('client_id', client_id).ilike('name', name).limit(1);
            if (leads?.length) lead = leads[0];
          }

          if (!lead) continue;
          matched++;

          if (email && !lead.email) {
            await supabase.from('leads').update({ email } as any).eq('id', lead.id);
          }

          const meetDate = new Date(meetingDate);
          const dayBefore = new Date(meetDate.getTime() - 24 * 60 * 60 * 1000).toISOString();
          const dayAfter = new Date(meetDate.getTime() + 24 * 60 * 60 * 1000).toISOString();

          const { data: calls } = await supabase
            .from('calls')
            .select('id')
            .eq('client_id', client_id)
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
              client_id,
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
        }
      }
    }

    // Update last sync
    await supabase.from('client_settings').update({ fathom_last_sync: new Date().toISOString() } as any).eq('client_id', client_id);

    console.log(`[Fathom] Sync complete: ${synced} meetings, ${matched} matched, ${callsUpdated} calls`);

    return new Response(JSON.stringify({
      success: true,
      synced,
      matched,
      callsUpdated,
      total: allMeetings.length,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[Fathom] Sync error:', err);
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
