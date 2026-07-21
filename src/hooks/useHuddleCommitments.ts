import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface HuddleCommitment {
  id: string;
  huddle_id: string;
  member_id: string | null;
  member_name: string;
  client_id: string | null;
  commitment: string;
  for_date: string; // yyyy-mm-dd
  status: 'pending' | 'done' | 'missed' | 'rolled_over';
  notes: string | null;
  created_at: string;
  updated_at: string;
}

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function yesterdayISO(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function useHuddleCommitments(huddleId: string | undefined) {
  const [today, setToday] = useState<HuddleCommitment[]>([]);
  const [yesterday, setYesterday] = useState<HuddleCommitment[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!huddleId) return;
    setLoading(true);
    const [todayRes, yestRes] = await Promise.all([
      (supabase as any).from('huddle_commitments').select('*').eq('for_date', todayISO()).order('created_at'),
      (supabase as any).from('huddle_commitments').select('*').eq('for_date', yesterdayISO()).order('created_at'),
    ]);
    setToday((todayRes.data || []) as HuddleCommitment[]);
    setYesterday((yestRes.data || []) as HuddleCommitment[]);
    setLoading(false);
  }, [huddleId]);

  useEffect(() => { reload(); }, [reload]);

  useEffect(() => {
    if (!huddleId) return;
    const channel = supabase
      .channel(`huddle-commitments-${huddleId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'huddle_commitments' }, () => reload())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [huddleId, reload]);

  const add = async (row: Omit<HuddleCommitment, 'id' | 'created_at' | 'updated_at' | 'status' | 'notes'> & { status?: HuddleCommitment['status']; notes?: string | null }) => {
    await (supabase as any).from('huddle_commitments').insert({ ...row, status: row.status || 'pending' });
    await reload();
  };

  const update = async (id: string, patch: Partial<HuddleCommitment>) => {
    await (supabase as any).from('huddle_commitments').update(patch).eq('id', id);
    await reload();
  };

  const remove = async (id: string) => {
    await (supabase as any).from('huddle_commitments').delete().eq('id', id);
    await reload();
  };

  const rollOver = async (row: HuddleCommitment) => {
    if (!huddleId) return;
    await (supabase as any).from('huddle_commitments').update({ status: 'rolled_over' }).eq('id', row.id);
    await (supabase as any).from('huddle_commitments').insert({
      huddle_id: huddleId,
      member_id: row.member_id,
      member_name: row.member_name,
      client_id: row.client_id,
      commitment: row.commitment,
      for_date: todayISO(),
      status: 'pending',
      notes: row.notes,
    });
    await reload();
  };

  return { today, yesterday, loading, add, update, remove, rollOver, reload };
}