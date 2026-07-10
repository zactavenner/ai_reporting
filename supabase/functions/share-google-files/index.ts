// Share Google Drive files (Sheets/Docs) with the internal team so they never
// see a "request access" screen when opening embedded URLs. Also enforces
// "anyone with link can view" as a safety net.
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const GATEWAY = 'https://connector-gateway.lovable.dev/google_drive/drive/v3';

// Internal team — always granted writer access to any shared file.
export const TEAM_EMAILS = [
  'ads@highperformanceads.com',
  'billmediabuyer@gmail.com',
  'emilyebradshaw01@gmail.com',
  'louie.jayavila93@gmail.com',
];

function extractFileId(input: string): string | null {
  if (!input) return null;
  const s = input.trim();
  // Already an ID
  if (/^[a-zA-Z0-9-_]{20,}$/.test(s)) return s;
  const m =
    s.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/) ||
    s.match(/\/document\/d\/([a-zA-Z0-9-_]+)/) ||
    s.match(/\/presentation\/d\/([a-zA-Z0-9-_]+)/) ||
    s.match(/\/file\/d\/([a-zA-Z0-9-_]+)/) ||
    s.match(/[?&]id=([a-zA-Z0-9-_]+)/);
  return m?.[1] ?? null;
}

async function shareOne(
  fileId: string,
  headers: Record<string, string>,
  emails: string[],
  role: 'reader' | 'writer',
  makeLinkPublic: boolean,
): Promise<{ fileId: string; granted: string[]; errors: any[] }> {
  const granted: string[] = [];
  const errors: any[] = [];

  if (makeLinkPublic) {
    try {
      const r = await fetch(`${GATEWAY}/files/${fileId}/permissions?sendNotificationEmail=false`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ role: 'reader', type: 'anyone' }),
      });
      if (!r.ok) errors.push({ step: 'anyone', status: r.status, body: await r.text() });
    } catch (e) {
      errors.push({ step: 'anyone', message: (e as Error).message });
    }
  }

  for (const email of emails) {
    try {
      const r = await fetch(
        `${GATEWAY}/files/${fileId}/permissions?sendNotificationEmail=false&supportsAllDrives=true`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({ role, type: 'user', emailAddress: email }),
        },
      );
      if (r.ok) {
        granted.push(email);
      } else {
        const text = await r.text();
        // 400 with "already exists" style responses are fine
        if (r.status === 400 && /already|exist/i.test(text)) {
          granted.push(email);
        } else {
          errors.push({ email, status: r.status, body: text });
        }
      }
    } catch (e) {
      errors.push({ email, message: (e as Error).message });
    }
  }

  return { fileId, granted, errors };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    const GOOGLE_DRIVE_API_KEY = Deno.env.get('GOOGLE_DRIVE_API_KEY');
    if (!LOVABLE_API_KEY) throw new Error('LOVABLE_API_KEY is not configured');
    if (!GOOGLE_DRIVE_API_KEY) throw new Error('GOOGLE_DRIVE_API_KEY is not configured. Link the Google Drive connector.');

    const body = await req.json().catch(() => ({}));
    const urls: string[] = Array.isArray(body?.urls) ? body.urls : body?.url ? [body.url] : [];
    const fileIds: string[] = Array.isArray(body?.file_ids) ? body.file_ids : body?.file_id ? [body.file_id] : [];
    const emails: string[] = Array.isArray(body?.emails) && body.emails.length ? body.emails : TEAM_EMAILS;
    const role: 'reader' | 'writer' = body?.role === 'reader' ? 'reader' : 'writer';
    const makeLinkPublic: boolean = body?.make_link_public !== false;

    const ids = [
      ...fileIds,
      ...urls.map(extractFileId).filter((x): x is string => !!x),
    ];
    const uniqueIds = Array.from(new Set(ids));

    if (uniqueIds.length === 0) {
      return new Response(JSON.stringify({ error: 'Provide urls[], url, file_ids[], or file_id' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const headers = {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      'X-Connection-Api-Key': GOOGLE_DRIVE_API_KEY,
      'Content-Type': 'application/json',
    };

    const results = [];
    for (const id of uniqueIds) {
      results.push(await shareOne(id, headers, emails, role, makeLinkPublic));
    }

    return new Response(
      JSON.stringify({ ok: true, emails, role, results }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('share-google-files error:', message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});