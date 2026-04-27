import { corsHeaders } from '@supabase/supabase-js/cors';

const MASTER_SHEET_ID = '1tm-qpPRzv38JtIL9-KvZVThqTk4OJcWv3duw8H2KHhY';
const GATEWAY = 'https://connector-gateway.lovable.dev/google_drive/drive/v3';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    const GOOGLE_DRIVE_API_KEY = Deno.env.get('GOOGLE_DRIVE_API_KEY');
    if (!LOVABLE_API_KEY) throw new Error('LOVABLE_API_KEY is not configured');
    if (!GOOGLE_DRIVE_API_KEY) throw new Error('GOOGLE_DRIVE_API_KEY is not configured. Link the Google Drive connector.');

    const body = await req.json().catch(() => ({}));
    const clientName: string = (body?.client_name || 'Client').toString().trim() || 'Client';
    const sourceId: string = (body?.source_sheet_id || MASTER_SHEET_ID).toString();
    const newName = `KPI Sheet — ${clientName}`;

    const headers = {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      'X-Connection-Api-Key': GOOGLE_DRIVE_API_KEY,
      'Content-Type': 'application/json',
    };

    // Copy master template
    const copyRes = await fetch(`${GATEWAY}/files/${sourceId}/copy?fields=id,name,webViewLink`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: newName }),
    });
    const copyData = await copyRes.json();
    if (!copyRes.ok) {
      throw new Error(`Drive copy failed [${copyRes.status}]: ${JSON.stringify(copyData)}`);
    }

    const newId = copyData.id as string;
    // Try to make the new file readable by anyone with the link so the Sheets connector can read it.
    try {
      await fetch(`${GATEWAY}/files/${newId}/permissions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ role: 'reader', type: 'anyone' }),
      });
    } catch (_e) {
      // Non-fatal — owner can still share manually.
    }

    const url = copyData.webViewLink || `https://docs.google.com/spreadsheets/d/${newId}/edit`;
    return new Response(
      JSON.stringify({ sheet_id: newId, name: copyData.name, url }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('create-client-sheet error:', message);
    return new Response(JSON.stringify({ error: message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});