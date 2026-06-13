import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-mg-signature',
};

interface ActionItem {
  text: string;
  source?: string;
  assignee?: string;
  speaker?: string;
}

// Extract action items from summary text
function extractActionItemsFromSummary(summary: string): ActionItem[] {
  if (!summary) return [];
  const actionItems: ActionItem[] = [];
  const patterns = [
    /action items?:?\s*\n([\s\S]*?)(?=\n\n|\n[A-Z]|$)/gi,
    /next steps?:?\s*\n([\s\S]*?)(?=\n\n|\n[A-Z]|$)/gi,
    /tasks?:?\s*\n([\s\S]*?)(?=\n\n|\n[A-Z]|$)/gi,
    /to-?do:?\s*\n([\s\S]*?)(?=\n\n|\n[A-Z]|$)/gi,
    /follow[- ]?ups?:?\s*\n([\s\S]*?)(?=\n\n|\n[A-Z]|$)/gi,
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(summary)) !== null) {
      if (match[1]) {
        const lines = match[1].split('\n')
          .map(line => line.replace(/^[-•*\d.)\]]+\s*/, '').trim())
          .filter(line => line.length > 5 && !line.match(/^(action|next|task|to-?do|follow)/i));
        lines.forEach(line => {
          if (!actionItems.some(item => item.text.toLowerCase() === line.toLowerCase())) {
            actionItems.push({ text: line, source: 'summary_parse' });
          }
        });
      }
    }
  }
  return actionItems;
}

// Deduplicate action items
function deduplicateActionItems(items: ActionItem[]): ActionItem[] {
  const unique: ActionItem[] = [];
  for (const item of items) {
    const normalizedText = item.text.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
    const isDuplicate = unique.some(existing => {
      const existingNormalized = existing.text.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
      return existingNormalized === normalizedText ||
             existingNormalized.includes(normalizedText) ||
             normalizedText.includes(existingNormalized);
    });
    if (!isDuplicate && normalizedText.length > 5) {
      unique.push(item);
    }
  }
  return unique;
}

// Verify HMAC SHA-256 signature
async function verifySignature(body: string, signature: string, secret: string): Promise<boolean> {
  try {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
    const hexSig = Array.from(new Uint8Array(sig))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    return hexSig === signature;
  } catch (e) {
    console.error('Signature verification failed:', e);
    return false;
  }
}

function getBaseUrl(region: string): string {
  return region === 'eu' ? 'https://api-eu.meetgeek.ai' : 'https://api-us.meetgeek.ai';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const rawBody = await req.text();
    const body = JSON.parse(rawBody);
    console.log('Received webhook/request:', JSON.stringify(body).slice(0, 500));

    // Determine client_id from body or query
    const clientId = body.client_id || new URL(req.url).searchParams.get('client_id');

    // Fetch per-client MeetGeek settings from client_settings
    let meetgeekApiKey = '';
    let meetgeekWebhookSecret = '';
    let meetgeekRegion = 'us';

    if (clientId) {
      const { data: cs } = await supabase
        .from('client_settings')
        .select('meetgeek_api_key, meetgeek_webhook_secret, meetgeek_region, meetgeek_enabled')
        .eq('client_id', clientId)
        .maybeSingle();
      
      if (cs?.meetgeek_enabled && cs?.meetgeek_api_key) {
        meetgeekApiKey = cs.meetgeek_api_key;
        meetgeekWebhookSecret = cs.meetgeek_webhook_secret || '';
        meetgeekRegion = cs.meetgeek_region || 'us';
      }
    }

    // Fallback to agency-level settings or env secret
    if (!meetgeekApiKey) {
      const { data: settings } = await supabase
        .from('agency_settings')
        .select('meetgeek_api_key, meetgeek_webhook_secret')
        .limit(1)
        .maybeSingle();

      if (settings?.meetgeek_api_key) {
        meetgeekApiKey = settings.meetgeek_api_key;
        meetgeekWebhookSecret = settings.meetgeek_webhook_secret || '';
      } else {
        meetgeekApiKey = Deno.env.get('MEETGEEK_API_KEY') || '';
      }
      // Auto-detect region from key prefix
      if (meetgeekApiKey.startsWith('eu-')) {
        meetgeekRegion = 'eu';
      }
    }

    if (!meetgeekApiKey) {
      return new Response(JSON.stringify({ error: 'MeetGeek API key not configured' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Verify webhook signature if secret is configured
    const signature = req.headers.get('x-mg-signature');
    if (meetgeekWebhookSecret && signature) {
      const isValid = await verifySignature(rawBody, signature, meetgeekWebhookSecret);
      if (!isValid) {
        console.error('Invalid webhook signature');
        return new Response(JSON.stringify({ error: 'Invalid signature' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      console.log('Webhook signature verified');
    }

    const baseUrl = getBaseUrl(meetgeekRegion);

    // Handle manual sync request
    if (body.action === 'sync') {
      const since = body.since || undefined;
      const result = await syncRecentMeetings(supabase, meetgeekApiKey, baseUrl, clientId, since);
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Handle daily cron sync for all clients with MeetGeek enabled
    if (body.action === 'sync_all') {
      const { data: allSettings } = await supabase
        .from('client_settings')
        .select('client_id, meetgeek_api_key, meetgeek_region')
        .eq('meetgeek_enabled', true);

      const results: any[] = [];
      // Also sync with agency-level key (unassigned meetings)
      const agencySince = body.since || new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
      const agencyResult = await syncRecentMeetings(supabase, meetgeekApiKey, baseUrl, undefined, agencySince);
      results.push({ client: 'agency', ...agencyResult });

      // Sync per-client if they have their own key
      if (allSettings?.length) {
        for (const cs of allSettings) {
          if (cs.meetgeek_api_key) {
            const cBaseUrl = getBaseUrl(cs.meetgeek_region || 'us');
            const cResult = await syncRecentMeetings(supabase, cs.meetgeek_api_key, cBaseUrl, cs.client_id, agencySince);
            results.push({ client: cs.client_id, ...cResult });
          }
        }
      }

      return new Response(JSON.stringify({ success: true, results }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Handle manual single-call transcript sync
    if (body.action === 'sync_call_transcript') {
      const result = await syncCallTranscript(supabase, meetgeekApiKey, baseUrl, body.call_id, body.meeting_id);
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Handle MeetGeek webhook (meeting analyzed)
    if (body.meeting_id) {
      const result = await processMeeting(supabase, meetgeekApiKey, baseUrl, body.meeting_id, clientId);
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ message: 'No action taken' }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: unknown) {
    console.error('Error processing webhook:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

async function syncCallTranscript(
  supabase: any, apiKey: string, baseUrl: string,
  callId: string, meetingId?: string
) {
  try {
    // If we have a meetingId, fetch transcript directly
    if (meetingId) {
      const transcript = await fetchTranscript(apiKey, baseUrl, meetingId);
      const summary = await fetchSummary(apiKey, baseUrl, meetingId);

      const { error } = await supabase
        .from('calls')
        .update({
          transcript: transcript || null,
          summary: summary || null,
        })
        .eq('id', callId);

      if (error) throw error;
      return { success: true, callId, hasTranscript: !!transcript, hasSummary: !!summary };
    }

    // Otherwise, try to match by searching recent meetings
    const response = await fetch(`${baseUrl}/v1/meetings?limit=50`, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });
    if (!response.ok) throw new Error(`MeetGeek API error: ${response.status}`);
    
    const data = await response.json();
    const meetings = data.meetings || data.data || [];

    // Get the call to match
    const { data: call } = await supabase
      .from('calls')
      .select('*')
      .eq('id', callId)
      .single();

    if (!call) throw new Error('Call not found');

    // Try to match by external_id or timestamp
    let matched = meetings.find((m: any) => m.id === call.external_id);
    
    if (!matched && call.scheduled_at) {
      const callTime = new Date(call.scheduled_at).getTime();
      matched = meetings.find((m: any) => {
        const meetingTime = new Date(m.start_time).getTime();
        return Math.abs(meetingTime - callTime) < 30 * 60 * 1000; // 30 min window
      });
    }

    if (!matched) {
      return { success: false, error: 'No matching MeetGeek meeting found' };
    }

    const transcript = await fetchTranscript(apiKey, baseUrl, matched.id);
    const summary = await fetchSummary(apiKey, baseUrl, matched.id);

    const { error } = await supabase
      .from('calls')
      .update({
        transcript: transcript || null,
        summary: summary || null,
        external_id: matched.id,
      })
      .eq('id', callId);

    if (error) throw error;
    return { success: true, callId, meetingId: matched.id, hasTranscript: !!transcript, hasSummary: !!summary };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return { success: false, error: message };
  }
}

async function fetchTranscript(apiKey: string, baseUrl: string, meetingId: string): Promise<string> {
  try {
    const response = await fetch(`${baseUrl}/v1/meetings/${meetingId}/transcript`, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });
    if (response.ok) {
      const data = await response.json();
      return data.transcript || '';
    }
  } catch (e) {
    console.log('Could not fetch transcript:', e);
  }
  return '';
}

async function fetchSummary(apiKey: string, baseUrl: string, meetingId: string): Promise<string> {
  try {
    const response = await fetch(`${baseUrl}/v1/meetings/${meetingId}/summary`, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });
    if (response.ok) {
      const data = await response.json();
      return data.summary || '';
    }
  } catch (e) {
    console.log('Could not fetch summary:', e);
  }
  return '';
}

async function syncRecentMeetings(supabase: any, apiKey: string, baseUrl: string, clientId?: string, since?: string) {
  try {
    let allMeetings: any[] = [];
    let page = 1;
    const perPage = 50;
    const sinceDate = since ? new Date(since) : null;

    // Paginate through meetings
    while (true) {
      const url = `${baseUrl}/v1/meetings?limit=${perPage}&page=${page}`;
      const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${apiKey}` },
      });
      if (!response.ok) {
        const errText = await response.text();
        console.error(`MeetGeek API error: ${response.status} - ${errText}`);
        throw new Error(`MeetGeek API error: ${response.status}`);
      }

      const data = await response.json();
      const meetings = data.meetings || data.data || data.results || [];
      if (meetings.length === 0) break;

      // Normalize field names (API may use meeting_id/timestamp_start_utc or id/start_time)
      const normalized = meetings.map((m: any) => ({
        ...m,
        id: m.id || m.meeting_id,
        start_time: m.start_time || m.timestamp_start_utc,
        end_time: m.end_time || m.timestamp_end_utc,
      }));

      // Filter by since date if provided
      let reachedOlder = false;
      for (const m of normalized) {
        const mDate = new Date(m.start_time || m.created_at || 0);
        if (sinceDate && mDate < sinceDate) {
          reachedOlder = true;
          break;
        }
        allMeetings.push(m);
      }

      if (reachedOlder || meetings.length < perPage) break;
      page++;
      // Safety cap at 10 pages (500 meetings)
      if (page > 10) break;
    }

    console.log(`Found ${allMeetings.length} meetings to sync (since: ${since || 'all'})`);

    let synced = 0;
    let skipped = 0;
    let callsUpdated = 0;

    for (const meeting of allMeetings) {
      const { data: existing } = await supabase
        .from('agency_meetings')
        .select('id')
        .eq('meeting_id', meeting.id)
        .maybeSingle();

      if (existing) {
        skipped++;
        continue;
      }

      const result = await processMeeting(supabase, apiKey, baseUrl, meeting.id, clientId);
      if (result.success) synced++;
      if (result.callUpdated) callsUpdated++;
    }

    // Update last sync timestamp if we have a clientId
    if (clientId) {
      await supabase
        .from('client_settings')
        .update({ meetgeek_last_sync: new Date().toISOString() })
        .eq('client_id', clientId);
    }

    return { success: true, synced, skipped, callsUpdated, total: allMeetings.length };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return { success: false, error: message };
  }
}

async function matchClientByTitle(supabase: any, title: string): Promise<string | null> {
  try {
    const { data: clients } = await supabase.from('clients').select('id, name');
    if (!clients?.length) return null;

    const STOP = new Set(['the','and','inc','llc','corp','group','capital','investments','investment','management','fund','company','co','partners','holdings','hpa']);
    const titleLower = ` ${title.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ')} `;

    // Score each client by distinctive-word matches; longest distinctive word wins ties.
    let best: { id: string; score: number; longest: number } | null = null;
    for (const client of clients) {
      const cleanName = client.name.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

      // 1. Exact full-name substring match — strongest signal.
      if (cleanName.length >= 4 && titleLower.includes(` ${cleanName} `)) {
        return client.id;
      }

      // 2. Score on distinctive (non-stop) words present as whole words in the title.
      const words = cleanName.split(/\s+/).filter((w: string) => w.length > 2 && !STOP.has(w));
      if (!words.length) continue;
      let score = 0;
      let longest = 0;
      for (const w of words) {
        if (titleLower.includes(` ${w} `)) {
          score++;
          if (w.length > longest) longest = w.length;
        }
      }
      if (score === 0) continue;
      if (!best || score > best.score || (score === best.score && longest > best.longest)) {
        best = { id: client.id, score, longest };
      }
    }
    return best?.id || null;
  } catch { return null; }
}

async function processMeeting(supabase: any, apiKey: string, baseUrl: string, meetingId: string, forClientId?: string) {
  try {
    const meetingResponse = await fetch(`${baseUrl}/v1/meetings/${meetingId}`, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });
    if (!meetingResponse.ok) throw new Error(`Failed to fetch meeting: ${meetingResponse.status}`);

    const meeting = await meetingResponse.json();
    const transcript = await fetchTranscript(apiKey, baseUrl, meetingId);
    const summary = await fetchSummary(apiKey, baseUrl, meetingId);

    // Fetch action items from insights
    let allActionItems: ActionItem[] = [];
    try {
      const insightsResponse = await fetch(`${baseUrl}/v1/meetings/${meetingId}/insights`, {
        headers: { 'Authorization': `Bearer ${apiKey}` },
      });
      if (insightsResponse.ok) {
        const data = await insightsResponse.json();
        allActionItems.push(...(data.action_items || []).map((i: any) => ({
          text: i.text, assignee: i.assignee, source: 'insights'
        })));
      }
    } catch {}

    // Fetch highlights
    let meetingHighlights: any[] = [];
    try {
      const hlResponse = await fetch(`${baseUrl}/v1/meetings/${meetingId}/highlights`, {
        headers: { 'Authorization': `Bearer ${apiKey}` },
      });
      if (hlResponse.ok) {
        const data = await hlResponse.json();
        meetingHighlights = (data.highlights || data || []);
        // Also extract action items from highlights
        const tasks = meetingHighlights
          .filter((h: any) => h.label === 'Task' || h.label === 'Action Item')
          .map((h: any) => ({ text: h.highlightText || h.text, source: 'highlights', speaker: h.speaker }));
        allActionItems.push(...tasks);
      }
    } catch {}

    // Parse summary
    allActionItems.push(...extractActionItemsFromSummary(summary));
    const uniqueActionItems = deduplicateActionItems(allActionItems);

    let durationMinutes = meeting.duration;
    const startTime = meeting.start_time || meeting.timestamp_start_utc;
    const endTime = meeting.end_time || meeting.timestamp_end_utc;
    if (startTime && endTime) {
      durationMinutes = Math.round((new Date(endTime).getTime() - new Date(startTime).getTime()) / 60000);
    }

    const meetingDate = startTime || new Date().toISOString();
    const matchedClientId = forClientId || await matchClientByTitle(supabase, meeting.title || '');

    // Store in agency_meetings
    const { data: insertedMeeting, error: insertError } = await supabase
      .from('agency_meetings')
      .upsert({
        meeting_id: meetingId,
        title: meeting.title || 'Untitled Meeting',
        meeting_date: meetingDate,
        duration_minutes: durationMinutes,
        participants: meeting.participants || [],
        summary,
        transcript,
        action_items: uniqueActionItems,
        recording_url: meeting.recording_url,
        meetgeek_url: meeting.meetgeek_url || `https://app.meetgeek.ai/meetings/${meetingId}`,
        client_id: matchedClientId,
        highlights: meetingHighlights.length > 0 ? meetingHighlights : (meeting.highlights || []),
      }, { onConflict: 'meeting_id' })
      .select()
      .single();

    if (insertError) throw insertError;

    // Try to match and update a call record with transcript/summary
    let callUpdated = false;
    if (matchedClientId && meeting.start_time) {
      const meetingTime = new Date(meeting.start_time).getTime();
      const { data: calls } = await supabase
        .from('calls')
        .select('id, scheduled_at, external_id')
        .eq('client_id', matchedClientId)
        .gte('scheduled_at', new Date(meetingTime - 60 * 60 * 1000).toISOString())
        .lte('scheduled_at', new Date(meetingTime + 60 * 60 * 1000).toISOString())
        .limit(5);

      if (calls?.length) {
        // Find closest call
        let closest = calls[0];
        let minDiff = Infinity;
        for (const c of calls) {
          if (c.scheduled_at) {
            const diff = Math.abs(new Date(c.scheduled_at).getTime() - meetingTime);
            if (diff < minDiff) { minDiff = diff; closest = c; }
          }
        }
        
        const { error: updateErr } = await supabase
          .from('calls')
          .update({
            transcript: transcript || null,
            summary: summary || null,
          })
          .eq('id', closest.id);
        
        if (!updateErr) {
          callUpdated = true;
          console.log(`Updated call ${closest.id} with transcript from meeting ${meetingId}`);
        }
      }
    }

    // Create pending tasks (works for ALL clients, including unmatched — they appear in
    // the global pending queue so an admin can re-assign the meeting client_id later).
    if (uniqueActionItems.length > 0) {
      const pendingTasks = uniqueActionItems.map((item: ActionItem) => ({
        meeting_id: insertedMeeting.id,
        client_id: matchedClientId,
        title: item.text.slice(0, 200),
        description: item.assignee ? `Assigned to: ${item.assignee}` : '',
        priority: 'medium',
        status: 'pending',
      }));
      const { error: pendErr } = await supabase.from('pending_meeting_tasks').insert(pendingTasks);
      if (pendErr) {
        console.error('[MeetGeek] pending_meeting_tasks insert failed:', pendErr);
      } else {
        console.log(`[MeetGeek] Created ${pendingTasks.length} pending tasks (client=${matchedClientId || 'UNMATCHED'})`);
      }
    }

    return { success: true, meetingId: insertedMeeting.id, actionItems: uniqueActionItems.length, callUpdated };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return { success: false, error: message, callUpdated: false };
  }
}
