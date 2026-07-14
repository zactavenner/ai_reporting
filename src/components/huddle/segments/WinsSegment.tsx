import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useTeamMember } from '@/contexts/TeamMemberContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Trophy, Plus } from 'lucide-react';
import { yesterdayISO } from '@/hooks/useHuddle';

interface Props { huddleId: string; }
interface Win { id: string; member_name: string | null; text: string; huddle_id: string }

export function WinsSegment({ huddleId }: Props) {
  const { currentMember } = useTeamMember();
  const [wins, setWins] = useState<Win[]>([]);
  const [yesterdayWins, setYesterdayWins] = useState<Win[]>([]);
  const [text, setText] = useState('');

  useEffect(() => {
    const load = async () => {
      const { data: today } = await supabase.from('huddle_wins').select('*').eq('huddle_id', huddleId).order('created_at');
      setWins((today as any) || []);
      const { data: yh } = await supabase.from('huddles').select('id').eq('date', yesterdayISO()).maybeSingle();
      if (yh?.id) {
        const { data: yw } = await supabase.from('huddle_wins').select('*').eq('huddle_id', yh.id);
        setYesterdayWins((yw as any) || []);
      }
    };
    load();
    const ch = supabase
      .channel(`wins-${huddleId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'huddle_wins', filter: `huddle_id=eq.${huddleId}` },
        (p) => setWins((prev) => [...prev, p.new as any]))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [huddleId]);

  const add = async () => {
    if (!text.trim()) return;
    await supabase.from('huddle_wins').insert({
      huddle_id: huddleId,
      member_id: currentMember?.id ?? null,
      member_name: currentMember?.name ?? 'Team',
      text: text.trim(),
    });
    setText('');
  };

  return (
    <div className="w-full max-w-4xl mx-auto space-y-4">
      <div className="flex gap-2">
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
          placeholder="A quick win from yesterday…"
          className="text-lg h-12"
        />
        <Button onClick={add} size="lg"><Plus className="w-4 h-4 mr-1" />Add</Button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {wins.map((w) => (
          <Card key={w.id} className="p-4 border-l-4 border-l-primary">
            <div className="flex gap-2 items-start">
              <Trophy className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
              <div>
                <div className="text-xs text-muted-foreground">{w.member_name}</div>
                <div className="text-base">{w.text}</div>
              </div>
            </div>
          </Card>
        ))}
      </div>
      {yesterdayWins.length > 0 && (
        <div className="pt-4 opacity-40">
          <div className="text-xs uppercase tracking-wide mb-2">Yesterday</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {yesterdayWins.map((w) => (
              <div key={w.id} className="text-sm">• {w.member_name}: {w.text}</div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}