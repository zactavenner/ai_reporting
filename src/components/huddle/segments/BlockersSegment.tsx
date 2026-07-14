import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useTeamMember } from '@/contexts/TeamMemberContext';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { Ban, Plus, CheckCircle2 } from 'lucide-react';

interface Blocker {
  id: string;
  huddle_id: string;
  member_name: string | null;
  description: string;
  unblocker_name: string | null;
  task_id: string | null;
}

export function BlockersSegment({ huddleId }: { huddleId: string }) {
  const { currentMember } = useTeamMember();
  const [rows, setRows] = useState<Blocker[]>([]);
  const [desc, setDesc] = useState('');
  const [unblocker, setUnblocker] = useState('');

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase.from('huddle_blockers').select('*').eq('huddle_id', huddleId).order('created_at');
      setRows((data as any) || []);
    };
    load();
    const ch = supabase
      .channel(`blockers-${huddleId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'huddle_blockers', filter: `huddle_id=eq.${huddleId}` },
        () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [huddleId]);

  const add = async () => {
    if (!desc.trim()) return;
    await supabase.from('huddle_blockers').insert({
      huddle_id: huddleId,
      member_id: currentMember?.id ?? null,
      member_name: currentMember?.name ?? 'Team',
      description: desc.trim(),
      unblocker_name: unblocker.trim() || null,
    });
    setDesc(''); setUnblocker('');
  };

  const convertToTask = async (b: Blocker) => {
    const { data } = await supabase.from('tasks').insert({
      title: `Unblock: ${b.description}`,
      status: 'pending',
      priority: 'high',
      stage: 'today',
      source: 'huddle',
      huddle_id: huddleId,
      due_date: new Date().toISOString().slice(0, 10),
    } as any).select('id').single();
    if (data) await supabase.from('huddle_blockers').update({ task_id: data.id }).eq('id', b.id);
    toast.success('Converted to task');
  };

  return (
    <div className="w-full max-w-4xl mx-auto space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-[1fr_240px_auto] gap-2">
        <Input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="What are you stuck on?" />
        <Input value={unblocker} onChange={(e) => setUnblocker(e.target.value)} placeholder="Who can unblock?" />
        <Button onClick={add}><Plus className="w-4 h-4 mr-1" />Add</Button>
      </div>
      <div className="space-y-2 max-h-[45vh] overflow-y-auto">
        {rows.map((b) => (
          <Card key={b.id} className="p-3 flex items-center gap-3">
            <Ban className="w-4 h-4 text-destructive flex-shrink-0" />
            <div className="flex-1">
              <div className="text-sm">{b.description}</div>
              <div className="text-xs text-muted-foreground">{b.member_name} → {b.unblocker_name || 'anyone'}</div>
            </div>
            {b.task_id ? (
              <span className="text-xs text-emerald-500 inline-flex items-center gap-1"><CheckCircle2 className="w-3 h-3" />Task</span>
            ) : (
              <Button size="sm" variant="outline" onClick={() => convertToTask(b)}>To task</Button>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}