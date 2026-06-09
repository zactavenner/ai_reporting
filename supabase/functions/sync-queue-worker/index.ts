import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface SyncJob {
  id: string;
  client_id: string;
  sync_type: string;
  priority: number;
  status: string;
  date_range_start: string | null;
  date_range_end: string | null;
  batch_number: number;
  total_batches: number;
}

interface Client {
  id: string;
  name: string;
  ghl_api_key: string;
  ghl_location_id: string;
}

const GHL_BASE_URL = 'https://services.leadconnectorhq.com';
const DELAY_MS = 300;

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchGHLContacts(
  apiKey: string, 
  locationId: string, 
  startDate: Date, 
  endDate: Date
): Promise<{ contacts: any[], total: number }> {
  const contacts: any[] = [];
  let nextPageUrl: string | null = null;
  let pageCount = 0;
  const MAX_PAGES = 20; // Safety limit

  console.log(`Fetching contacts from ${startDate.toISOString()} to ${endDate.toISOString()}`);

  do {
    const fetchUrl: string = nextPageUrl || `${GHL_BASE_URL}/contacts/?locationId=${locationId}&limit=100`;
    
    const response: Response = await fetch(fetchUrl, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Version': '2021-07-28',
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`GHL API error: ${response.status} - ${errorText}`);
    }

    const responseData = await response.json();
    const pageContacts = responseData.contacts || [];
    
    // Filter by date range
    const filtered = pageContacts.filter((c: any) => {
      const dateAdded = new Date(c.dateAdded);
      return dateAdded >= startDate && dateAdded <= endDate;
    });
    
    contacts.push(...filtered);
    nextPageUrl = responseData.meta?.nextPageUrl || null;
    pageCount++;
    
    console.log(`Page ${pageCount}: ${filtered.length}/${pageContacts.length} contacts in date range`);

    // Check if we're past the date range
    const oldestInBatch = pageContacts.length > 0 
      ? new Date(pageContacts[pageContacts.length - 1].dateAdded) 
      : null;
    
    if (oldestInBatch && oldestInBatch < startDate) {
      console.log('Reached contacts older than start date, stopping pagination');
      break;
    }

    if (nextPageUrl) await delay(DELAY_MS);
  } while (nextPageUrl && pageCount < MAX_PAGES);

  return { contacts, total: contacts.length };
}

async function syncContactsBatch(
  supabase: any,
  client: Client,
  dateRangeStart: string | null,
  dateRangeEnd: string | null
): Promise<{ created: number, updated: number, total: number }> {
  const startDate = dateRangeStart ? new Date(dateRangeStart) : new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const endDate = dateRangeEnd ? new Date(dateRangeEnd) : new Date();
  
  console.log(`[${client.name}] Syncing contacts from ${startDate.toISOString()} to ${endDate.toISOString()}`);
  
  const { contacts } = await fetchGHLContacts(
    client.ghl_api_key,
    client.ghl_location_id,
    startDate,
    endDate
  );
  
  if (contacts.length === 0) {
    console.log(`[${client.name}] No contacts found in date range`);
    return { created: 0, updated: 0, total: 0 };
  }

  console.log(`[${client.name}] Processing ${contacts.length} contacts`);
  
  let created = 0;
  let updated = 0;
  
  // Batch upsert contacts
  const leadsToUpsert = contacts.map((contact: any) => ({
    client_id: client.id,
    external_id: contact.id,
    name: `${contact.firstName || ''} ${contact.lastName || ''}`.trim() || 'Unknown',
    email: contact.email || null,
    phone: contact.phone || null,
    source: contact.source || 'GHL',
    status: 'active',
    // CRITICAL: Preserve GHL dateAdded as created_at for accurate reporting
    created_at: contact.dateAdded ? new Date(contact.dateAdded).toISOString() : new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }));
  
  // Upsert in batches of 100
  for (let i = 0; i < leadsToUpsert.length; i += 100) {
    const batch = leadsToUpsert.slice(i, i + 100);
    
    const { data, error } = await supabase
      .from('leads')
      .upsert(batch, { 
        onConflict: 'client_id,external_id',
        ignoreDuplicates: false
      })
      .select('id');
    
    if (error) {
      console.error(`[${client.name}] Upsert error:`, error);
    } else {
      // Approximate: all are considered "updated" in upsert
      updated += data?.length || 0;
    }
    
    await delay(50);
  }

  return { created, updated, total: contacts.length };
}

async function syncTimelineBatch(
  supabase: any,
  client: Client,
  dateRangeStart: string | null,
  dateRangeEnd: string | null
): Promise<{ synced: number }> {
  // Get contacts in date range to sync timeline for
  const startDate = dateRangeStart || new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const endDate = dateRangeEnd || new Date().toISOString();
  
  const { data: leads, error } = await supabase
    .from('leads')
    .select('id, external_id')
    .eq('client_id', client.id)
    .gte('created_at', startDate)
    .lte('created_at', endDate)
    .limit(50); // Process 50 contacts per job
  
  if (error || !leads?.length) {
    console.log(`[${client.name}] No leads found for timeline sync`);
    return { synced: 0 };
  }
  
  console.log(`[${client.name}] Syncing timeline for ${leads.length} contacts`);
  
  let synced = 0;
  
  for (const lead of leads) {
    try {
      // Fetch conversations/notes for this contact
      const conversationsUrl = `${GHL_BASE_URL}/conversations/search?locationId=${client.ghl_location_id}&contactId=${lead.external_id}`;
      
      const response = await fetch(conversationsUrl, {
        headers: {
          'Authorization': `Bearer ${client.ghl_api_key}`,
          'Version': '2021-07-28',
          'Accept': 'application/json'
        }
      });
      
      if (response.ok) {
        const data = await response.json();
        const conversations = data.conversations || [];
        
        // Process each conversation
        for (const conv of conversations.slice(0, 10)) { // Limit per contact
          const timelineEvent = {
            client_id: client.id,
            ghl_contact_id: lead.external_id,
            lead_id: lead.id,
            event_type: 'message',
            event_subtype: conv.type || 'unknown',
            event_at: conv.dateUpdated || conv.dateCreated || new Date().toISOString(),
            title: `${conv.type || 'Message'} conversation`,
            body: conv.lastMessageBody || null,
            metadata: { conversation_id: conv.id }
          };
          
          await supabase
            .from('contact_timeline_events')
            .upsert(timelineEvent, { 
              onConflict: 'client_id,ghl_contact_id,event_type,event_at' 
            });
        }
        
        synced++;
      }
      
      await delay(DELAY_MS);
    } catch (err) {
      console.error(`[${client.name}] Timeline sync error for ${lead.external_id}:`, err);
    }
  }
  
  return { synced };
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);
  
  console.log('Sync queue worker starting...');
  
  let currentJobId: string | null = null;
  
  try {
    // 1. Claim the next pending job (atomic update with row lock)
    const { data: jobs, error: claimError } = await supabase
      .from('sync_queue')
      .select('*')
      .eq('status', 'pending')
      .or(`next_retry_at.is.null,next_retry_at.lte.${new Date().toISOString()}`)
      .order('priority', { ascending: true })
      .order('created_at', { ascending: true })
      .limit(1);
    
    if (claimError) throw claimError;
    
    if (!jobs || jobs.length === 0) {
      console.log('No pending jobs in queue');
      return new Response(
        JSON.stringify({ success: true, message: 'No pending jobs' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    const job = jobs[0] as SyncJob;
    currentJobId = job.id;
    
    // Update status to processing
    const { error: updateError } = await supabase
      .from('sync_queue')
      .update({ 
        status: 'processing', 
        started_at: new Date().toISOString() 
      })
      .eq('id', job.id)
      .eq('status', 'pending'); // Only update if still pending (optimistic locking)
    
    if (updateError) {
      console.log('Job already claimed by another worker');
      return new Response(
        JSON.stringify({ success: true, message: 'Job already claimed' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    console.log(`Processing job ${job.id}: ${job.sync_type} for client ${job.client_id} (batch ${job.batch_number}/${job.total_batches})`);
    
    // 2. Get client credentials
    const { data: client, error: clientError } = await supabase
      .from('clients')
      .select('id, name, ghl_api_key, ghl_location_id')
      .eq('id', job.client_id)
      .single();
    
    if (clientError || !client?.ghl_api_key || !client?.ghl_location_id) {
      throw new Error(`Client ${job.client_id} missing GHL credentials`);
    }
    
    // 3. Process based on sync_type
    let totalRecords = 0;
    
    if (job.sync_type === 'contacts' || job.sync_type === 'full') {
      const contactResult = await syncContactsBatch(
        supabase,
        client as Client,
        job.date_range_start,
        job.date_range_end
      );
      totalRecords += contactResult.total;
      console.log(`[${client.name}] Contacts: ${contactResult.total} processed`);
    }
    
    if (job.sync_type === 'timeline' || job.sync_type === 'full') {
      const timelineResult = await syncTimelineBatch(
        supabase,
        client as Client,
        job.date_range_start,
        job.date_range_end
      );
      totalRecords += timelineResult.synced;
      console.log(`[${client.name}] Timeline: ${timelineResult.synced} contacts synced`);
    }
    
    // 4. Update client last sync timestamp
    await supabase
      .from('clients')
      .update({ 
        last_ghl_sync_at: new Date().toISOString(),
        ghl_sync_status: 'healthy',
        ghl_sync_error: null
      })
      .eq('id', job.client_id);
    
    // 5. Mark job complete
    await supabase.from('sync_queue').update({
      status: 'completed',
      records_processed: totalRecords,
      completed_at: new Date().toISOString()
    }).eq('id', job.id);
    
    console.log(`Job ${job.id} completed: ${totalRecords} records processed`);
    
    return new Response(
      JSON.stringify({ 
        success: true, 
        job_id: job.id,
        client_name: client.name,
        records_processed: totalRecords,
        batch: `${job.batch_number}/${job.total_batches}`
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
    
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Sync queue worker error:', errorMessage);
    
    // Retry with exponential backoff, or dead-letter after max_attempts
    if (currentJobId) {
      const { data: jobData } = await supabase
        .from('sync_queue')
        .select('client_id, attempts, max_attempts')
        .eq('id', currentJobId)
        .single();

      const attempts = (jobData?.attempts ?? 0) + 1;
      const maxAttempts = jobData?.max_attempts ?? 5;
      const isFinal = attempts >= maxAttempts;

      if (isFinal) {
        await supabase.from('sync_queue').update({
          status: 'failed',
          error_message: errorMessage.slice(0, 500),
          completed_at: new Date().toISOString(),
          attempts,
          last_attempted_at: new Date().toISOString(),
          dead_letter: true,
        }).eq('id', currentJobId);
      } else {
        // Exponential backoff: 2^attempts minutes, capped at 60min
        const backoffMin = Math.min(Math.pow(2, attempts), 60);
        const nextRetry = new Date(Date.now() + backoffMin * 60_000).toISOString();
        await supabase.from('sync_queue').update({
          status: 'pending',
          error_message: errorMessage.slice(0, 500),
          attempts,
          last_attempted_at: new Date().toISOString(),
          next_retry_at: nextRetry,
        }).eq('id', currentJobId);
      }

      if (jobData?.client_id && isFinal) {
        await supabase.from('clients').update({
          ghl_sync_status: 'error',
          ghl_sync_error: errorMessage.slice(0, 255)
        }).eq('id', jobData.client_id);
      }
    }
    
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: errorMessage,
        job_id: currentJobId
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
