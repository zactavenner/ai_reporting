import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Clone a stock avatar (and all its looks) into a specific client's library.
// The duplicate is a fully independent row: is_stock=false, client_id=<clientId>.
// Edits to the clone do not affect the original stock avatar.

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { stockAvatarId, clientId } = await req.json();
    if (!stockAvatarId || !clientId) {
      return new Response(JSON.stringify({ error: 'stockAvatarId and clientId required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data: stock, error: fetchErr } = await supabase
      .from('avatars').select('*').eq('id', stockAvatarId).maybeSingle();
    if (fetchErr) throw fetchErr;
    if (!stock) {
      return new Response(JSON.stringify({ error: 'Stock avatar not found' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Avoid duplicate clone for the same client (match on source stock id stored in metadata).
    const meta = (stock.metadata as Record<string, unknown>) || {};
    const { data: existing } = await supabase
      .from('avatars').select('id, name')
      .eq('client_id', clientId)
      .eq('is_stock', false)
      .contains('metadata', { cloned_from: stockAvatarId })
      .maybeSingle();
    if (existing) {
      return new Response(JSON.stringify({ success: true, avatarId: existing.id, alreadyAssigned: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: newAvatar, error: insertErr } = await supabase
      .from('avatars').insert({
        client_id: clientId,
        name: stock.name,
        description: stock.description,
        gender: stock.gender,
        age_range: stock.age_range,
        ethnicity: stock.ethnicity,
        style: stock.style,
        image_url: stock.image_url,
        base_image_url: stock.base_image_url || stock.image_url,
        elevenlabs_voice_id: stock.elevenlabs_voice_id,
        is_stock: false,
        is_active: true,
        metadata: { ...meta, cloned_from: stockAvatarId, cloned_at: new Date().toISOString() },
      })
      .select().single();
    if (insertErr) throw insertErr;

    // Copy all looks
    const { data: looks, error: looksErr } = await supabase
      .from('avatar_looks').select('*').eq('avatar_id', stockAvatarId);
    if (looksErr) throw looksErr;
    if (looks && looks.length > 0) {
      const rows = looks.map((l) => ({
        avatar_id: newAvatar.id,
        name: l.name,
        image_url: l.image_url,
        prompt: l.prompt,
        is_default: l.is_default,
        angle: l.angle,
        background: l.background,
        outfit: l.outfit,
        is_primary: l.is_primary,
        metadata: l.metadata,
      }));
      await supabase.from('avatar_looks').insert(rows);
      await supabase.from('avatars').update({ looks_count: rows.length }).eq('id', newAvatar.id);
    }

    return new Response(JSON.stringify({ success: true, avatarId: newAvatar.id, looksCopied: looks?.length || 0 }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('clone-stock-avatar error', err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});