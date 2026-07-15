import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useTeamMember } from '@/contexts/TeamMemberContext';
import { useAgencyMembers } from '@/hooks/useTasks';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Check, UserCheck, UserX, Users } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props { huddleId: string }
interface AttRow { id: string; member_id: string | null; member_name: string | null; joined_at: string }

export function AttendancePanel({ huddleId }: Props) {
  const { currentMember } = useTeamMember();
  const { data: members = [] } = useAgencyMembers();
  const [attendance, setAttendance] = useState<AttRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase
        .from('huddle_attendance')
        .select('id,member_id,member_name,joined_at')
        .eq('huddle_id', huddleId);
      setAttendance((data as any) || []);
      setLoading(false);
    };
    load();
    const ch = supabase
      .channel(`att-${huddleId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'huddle_attendance', filter: `huddle_id=eq.${huddleId}` },
        () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [huddleId]);

  const presentIds = useMemo(() => new Set(attendance.map(a => a.member_id).filter(Boolean) as string[]), [attendance]);

  const toggle = async (memberId: string, memberName: string) => {
    const isPresent = presentIds.has(memberId);
    if (isPresent) {
      await supabase.from('huddle_attendance').delete().eq('huddle_id', huddleId).eq('member_id', memberId);
    } else {
      await supabase.from('huddle_attendance').upsert(
        { huddle_id: huddleId, member_id: memberId, member_name: memberName, joined_at: new Date().toISOString() },
        { onConflict: 'huddle_id,member_id' }
      );
    }
  };

  const markAllPresent = async () => {
    const rows = (members as any[])
      .filter(m => !presentIds.has(m.id))
      .map(m => ({ huddle_id: huddleId, member_id: m.id, member_name: m.name, joined_at: new Date().toISOString() }));
    if (rows.length) await supabase.from('huddle_attendance').upsert(rows as any, { onConflict: 'huddle_id,member_id' });
  };

  const total = members.length || 1;
  const pct = Math.round((presentIds.size / total) * 100);

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4 text-primary" />
          <div className="text-sm font-semibold">Attendance</div>
          <div className="text-xs text-muted-foreground">
            {presentIds.size} of {members.length} present · {pct}%
          </div>
        </div>
        <Button size="sm" variant="outline" onClick={markAllPresent}>
          <Check className="w-3.5 h-3.5 mr-1" /> Mark all present
        </Button>
      </div>
      {loading ? (
        <div className="text-xs text-muted-foreground">Loading roster…</div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {(members as any[]).map(m => {
            const isMe = currentMember?.id === m.id;
            const present = presentIds.has(m.id);
            return (
              <button
                key={m.id}
                onClick={() => toggle(m.id, m.name)}
                className={cn(
                  'group inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition',
                  present
                    ? 'bg-primary/10 border-primary/40 text-primary hover:bg-primary/15'
                    : 'bg-muted/30 border-border text-muted-foreground hover:bg-muted/60',
                )}
                title={present ? 'Present — click to mark absent' : 'Absent — click to check in'}
              >
                {present ? <UserCheck className="w-3.5 h-3.5" /> : <UserX className="w-3.5 h-3.5 opacity-60" />}
                <span className="font-medium">{m.name}</span>
                {isMe && <span className="opacity-60">(you)</span>}
              </button>
            );
          })}
          {members.length === 0 && <div className="text-xs text-muted-foreground">No team members yet.</div>}
        </div>
      )}
    </Card>
  );
}