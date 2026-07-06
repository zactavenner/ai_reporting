import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

export function usePendingApprovalsCount() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      const { count: c } = await supabase
        .from('approval_queue')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending');
      if (mounted) setCount(c ?? 0);
    };
    load();

    const channel = supabase
      .channel('approval_queue_count')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'approval_queue' },
        () => load(),
      )
      .subscribe();

    return () => {
      mounted = false;
      supabase.removeChannel(channel);
    };
  }, []);

  return count;
}