import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';

interface Body {
  delivery_id: string;
  triggered_by?: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const { delivery_id, triggered_by } = (await req.json()) as Body;
    if (!delivery_id) {
      return new Response(JSON.stringify({ error: 'delivery_id required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data: delivery, error } = await supabase
      .from('task_notification_deliveries')
      .select('id, task_id, member_id, channel, kind')
      .eq('id', delivery_id)
      .maybeSingle();

    if (error || !delivery) {
      return new Response(JSON.stringify({ error: 'delivery not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!(delivery.channel === 'sms' || delivery.channel === 'email')) {
      return new Response(JSON.stringify({ error: `retry not supported for channel ${delivery.channel}` }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Mark as pending so the UI shows the in-flight state immediately.
    await supabase
      .from('task_notification_deliveries')
      .update({ status: 'pending', last_attempt_at: new Date().toISOString() })
      .eq('id', delivery.id);

    const resp = await supabase.functions.invoke('notify-task-assignee', {
      body: {
        task_id: delivery.task_id,
        member_id: delivery.member_id,
        kind: (delivery.kind as 'assigned' | 'due_today') || 'assigned',
        triggered_by: triggered_by || 'Manual retry',
        retry_delivery_id: delivery.id,
        only_channel: delivery.channel,
      },
    });

    if (resp.error) {
      await supabase
        .from('task_notification_deliveries')
        .update({ status: 'failed', error: resp.error.message ?? 'invoke failed' })
        .eq('id', delivery.id);
      return new Response(JSON.stringify({ error: resp.error.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ success: true, data: resp.data }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});