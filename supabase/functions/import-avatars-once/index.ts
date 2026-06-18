import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SRC = 'https://vzbaxurfhehcwftgidyy.supabase.co';
const SRC_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ6YmF4dXJmaGVoY3dmdGdpZHl5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAzNTE1NjUsImV4cCI6MjA4NTkyNzU2NX0.94_HRHnlYmdgo_BefYNiRwnUZ5Jkx-u9n_gHl-qNDf0';

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const headers = { apikey: SRC_KEY, Authorization: `Bearer ${SRC_KEY}` };
    const [avatarsRes, looksRes] = await Promise.all([
      fetch(`${SRC}/rest/v1/avatars?select=*&is_stock=eq.true&limit=1000`, { headers }),
      fetch(`${SRC}/rest/v1/avatar_looks?select=*&limit=2000`, { headers }),
    ]);
    const avatars = await avatarsRes.json();
    const allLooks = await looksRes.json();
    const ids = new Set(avatars.map((a: any) => a.id));
    const looks = allLooks
      .filter((l: any) => ids.has(l.avatar_id))
      .map((l: any) => ({ ...l, name: l.name || l.angle || 'Look' }));

    const { error: aErr } = await supabase
      .from('avatars')
      .upsert(avatars, { onConflict: 'id', ignoreDuplicates: true });
    if (aErr) throw new Error('avatars upsert: ' + JSON.stringify(aErr));

    const { error: lErr } = await supabase
      .from('avatar_looks')
      .upsert(looks, { onConflict: 'id', ignoreDuplicates: true });
    if (lErr) throw new Error('looks upsert: ' + JSON.stringify(lErr));

    return new Response(
      JSON.stringify({ ok: true, avatars: avatars.length, looks: looks.length }),
      { headers: { ...cors, 'Content-Type': 'application/json' } },
    );
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e instanceof Error ? e.message : e) }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }
});