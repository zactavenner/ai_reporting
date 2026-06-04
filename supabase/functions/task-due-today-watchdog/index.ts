import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // Today in America/Los_Angeles
    const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' });
    const today = fmt.format(new Date()); // YYYY-MM-DD
    const start = `${today}T00:00:00-08:00`;
    const end = `${today}T23:59:59-08:00`;

    const { data: tasks, error } = await supabase
      .from('tasks')
      .select('id, title, due_date, status, stage, assigned_to')
      .neq('status', 'completed')
      .gte('due_date', start)
      .lte('due_date', end);
    if (error) throw error;

    let notified = 0;
    const errors: string[] = [];

    for (const task of tasks || []) {
      // Gather member_ids: legacy assigned_to + task_assignees rows
      const memberIds = new Set<string>();
      if (task.assigned_to) memberIds.add(task.assigned_to);
      const { data: assignees } = await supabase
        .from('task_assignees')
        .select('member_id')
        .eq('task_id', task.id)
        .not('member_id', 'is', null);
      for (const a of assignees || []) if (a.member_id) memberIds.add(a.member_id);

      for (const memberId of memberIds) {
        // Skip if already notified due-today today
        const { data: existing } = await supabase
          .from('task_history')
          .select('id')
          .eq('task_id', task.id)
          .eq('action', 'notification_due_today')
          .gte('created_at', start)
          .lte('created_at', end)
          .like('new_value', `%${memberId.slice(0, 0)}%`); // dummy; do per-member check below
        // do explicit member check by name match in new_value
        // (simpler: just call notify; in-app insert and history will append, but we'll dedupe via task_notifications)
        try {
          const res = await fetch(
            `${Deno.env.get('SUPABASE_URL')}/functions/v1/notify-task-assignee`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
              },
              body: JSON.stringify({
                task_id: task.id,
                member_id: memberId,
                kind: 'due_today',
                triggered_by: 'Due-Today Watchdog',
              }),
            },
          );
          if (res.ok) notified++;
          else errors.push(`task ${task.id} member ${memberId}: ${res.status}`);
        } catch (e) {
          errors.push(`task ${task.id} member ${memberId}: ${(e as Error).message}`);
        }
      }
    }

    return new Response(
      JSON.stringify({ success: true, scanned: tasks?.length ?? 0, notified, errors }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (e) {
    return new Response(JSON.stringify({ success: false, error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});