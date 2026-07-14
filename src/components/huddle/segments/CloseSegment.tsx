import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useTeamMember } from '@/contexts/TeamMemberContext';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { Copy, Check } from 'lucide-react';
import { buildSummary, copyText } from '@/lib/huddle/summary';
import type { AgendaSegment } from '@/lib/huddle/types';
import type { HuddleRecord } from '@/hooks/useHuddle';

interface Props {
  huddle: HuddleRecord;
  agenda: AgendaSegment[];
}

export function CloseSegment({ huddle, agenda }: Props) {
  const { currentMember } = useTeamMember();
  const [summary, setSummary] = useState('');
  const [rating, setRating] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const build = async () => {
      const [{ data: att }, { data: wins }, { data: flags }, { data: tasks }, { data: blockers }, { data: ratings }] = await Promise.all([
        supabase.from('huddle_attendance').select('member_name').eq('huddle_id', huddle.id),
        supabase.from('huddle_wins').select('member_name,text').eq('huddle_id', huddle.id),
        supabase.from('huddle_flags').select('client_id,reason').eq('huddle_id', huddle.id),
        supabase.from('tasks').select('title,assigned_to,due_date').eq('huddle_id', huddle.id),
        supabase.from('huddle_blockers').select('description,unblocker_name').eq('huddle_id', huddle.id),
        supabase.from('huddle_ratings').select('rating').eq('huddle_id', huddle.id),
      ]);
      const { data: clients } = await supabase.from('clients').select('id,name').in('id', (flags || []).map((f: any) => f.client_id).filter(Boolean));
      const { data: members } = await supabase.from('agency_members').select('id,name');
      const cMap = Object.fromEntries((clients || []).map((c: any) => [c.id, c.name]));
      const mMap = Object.fromEntries((members || []).map((m: any) => [m.id, m.name]));
      const text = buildSummary({
        date: huddle.date,
        actual_duration_s: huddle.actual_duration_s,
        planned_duration_s: huddle.planned_duration_s,
        attendance: (att as any) || [],
        wins: (wins as any) || [],
        flags: ((flags as any) || []).map((f: any) => ({ client_name: cMap[f.client_id], reason: f.reason })),
        new_tasks: ((tasks as any) || []).map((t: any) => ({ title: t.title, owner_name: mMap[t.assigned_to || ''], due_date: t.due_date })),
        blockers: (blockers as any) || [],
        ratings: (ratings as any) || [],
        agenda,
      });
      setSummary(text);
    };
    build();
  }, [huddle, agenda]);

  const submitRating = async (n: number) => {
    setRating(n);
    await supabase.from('huddle_ratings').upsert(
      {
        huddle_id: huddle.id,
        member_id: currentMember?.id ?? null,
        member_name: currentMember?.name ?? 'Anon',
        rating: n,
      },
      { onConflict: 'huddle_id,member_id' }
    );
    toast.success('Rating saved');
  };

  const doCopy = async () => {
    const ok = await copyText(summary);
    if (ok) { setCopied(true); setTimeout(() => setCopied(false), 2000); toast.success('Copied'); }
  };

  return (
    <div className="w-full max-w-4xl mx-auto space-y-4">
      <Card className="p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="text-sm font-semibold">Summary preview</div>
          <Button size="sm" variant="outline" onClick={doCopy}>
            {copied ? <Check className="w-4 h-4 mr-1" /> : <Copy className="w-4 h-4 mr-1" />}
            Copy
          </Button>
        </div>
        <pre className="text-xs whitespace-pre-wrap font-mono max-h-[35vh] overflow-y-auto">{summary}</pre>
      </Card>
      <div>
        <div className="text-sm font-semibold mb-2">Rate this huddle (1–10)</div>
        <div className="flex gap-1 flex-wrap">
          {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
            <Button
              key={n}
              variant={rating === n ? 'default' : 'outline'}
              className="w-10 h-10"
              onClick={() => submitRating(n)}
            >
              {n}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}