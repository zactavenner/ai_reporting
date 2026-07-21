import { useMemo, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Check, X, RotateCcw, Trash2, Plus } from 'lucide-react';
import { useHuddleCommitments, type HuddleCommitment } from '@/hooks/useHuddleCommitments';
import { useHuddleClients } from '@/hooks/useHuddleClients';
import { useTeamMember } from '@/contexts/TeamMemberContext';

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function CommitmentsSegment({ huddleId }: { huddleId: string }) {
  const { currentMember } = useTeamMember();
  const { clients } = useHuddleClients();
  const { today, yesterday, add, update, remove, rollOver } = useHuddleCommitments(huddleId);

  const [text, setText] = useState('');
  const [clientId, setClientId] = useState<string>('__none');

  const grouped = (rows: HuddleCommitment[]) => {
    const map = new Map<string, HuddleCommitment[]>();
    for (const r of rows) {
      const key = r.member_name || 'Unassigned';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r);
    }
    return Array.from(map.entries());
  };

  const yGroups = useMemo(() => grouped(yesterday), [yesterday]);
  const tGroups = useMemo(() => grouped(today), [today]);

  const clientName = (id: string | null) => clients.find((c) => c.id === id)?.name;

  const canAdd = !!currentMember && text.trim().length > 0;

  const submitToday = async () => {
    if (!canAdd) return;
    await add({
      huddle_id: huddleId,
      member_id: currentMember!.id,
      member_name: currentMember!.name,
      client_id: clientId === '__none' ? null : clientId,
      commitment: text.trim(),
      for_date: todayISO(),
    });
    setText('');
    setClientId('__none');
  };

  return (
    <div className="w-full max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* YESTERDAY */}
      <Card className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">Yesterday's Commitments</h3>
          <Badge variant="outline">{yesterday.length}</Badge>
        </div>
        {yesterday.length === 0 ? (
          <div className="text-sm text-muted-foreground">Nothing was committed yesterday.</div>
        ) : (
          <div className="space-y-4">
            {yGroups.map(([name, rows]) => (
              <div key={name}>
                <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">{name}</div>
                <ul className="space-y-2">
                  {rows.map((r) => (
                    <li key={r.id} className="flex items-start gap-2 rounded-md border p-2">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm">
                          {r.commitment}
                          {r.client_id && (
                            <Badge variant="secondary" className="ml-2">{clientName(r.client_id) || 'Client'}</Badge>
                          )}
                        </div>
                        {r.notes && <div className="text-xs text-muted-foreground mt-1">{r.notes}</div>}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Badge variant={
                          r.status === 'done' ? 'default' :
                          r.status === 'missed' ? 'destructive' :
                          r.status === 'rolled_over' ? 'outline' : 'secondary'
                        }>
                          {r.status}
                        </Badge>
                        <Button size="sm" variant="ghost" title="Done" onClick={() => update(r.id, { status: 'done' })}>
                          <Check className="w-4 h-4 text-emerald-500" />
                        </Button>
                        <Button size="sm" variant="ghost" title="Missed" onClick={() => update(r.id, { status: 'missed' })}>
                          <X className="w-4 h-4 text-destructive" />
                        </Button>
                        <Button size="sm" variant="ghost" title="Roll over to today" onClick={() => rollOver(r)}>
                          <RotateCcw className="w-4 h-4" />
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* TODAY */}
      <Card className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">Today's Commitments</h3>
          <Badge variant="outline">{today.length}</Badge>
        </div>

        <div className="space-y-2">
          <Textarea
            placeholder="What are you committing to today?"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={2}
          />
          <div className="flex items-center gap-2">
            <Select value={clientId} onValueChange={setClientId}>
              <SelectTrigger className="h-9 w-56"><SelectValue placeholder="Client (optional)" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">Internal / Agency</SelectItem>
                {clients.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button onClick={submitToday} disabled={!canAdd}>
              <Plus className="w-4 h-4 mr-1" /> Add
            </Button>
          </div>
          {!currentMember && (
            <div className="text-xs text-muted-foreground">Sign in as a team member to post commitments.</div>
          )}
        </div>

        {today.length > 0 && (
          <div className="space-y-4">
            {tGroups.map(([name, rows]) => (
              <div key={name}>
                <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">{name}</div>
                <ul className="space-y-2">
                  {rows.map((r) => (
                    <li key={r.id} className="flex items-start gap-2 rounded-md border p-2">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm">
                          {r.commitment}
                          {r.client_id && (
                            <Badge variant="secondary" className="ml-2">{clientName(r.client_id) || 'Client'}</Badge>
                          )}
                        </div>
                        <Input
                          className="mt-1 h-7 text-xs"
                          placeholder="Notes (optional)"
                          defaultValue={r.notes || ''}
                          onBlur={(e) => {
                            const v = e.target.value.trim();
                            if ((r.notes || '') !== v) update(r.id, { notes: v || null });
                          }}
                        />
                      </div>
                      <Button size="sm" variant="ghost" onClick={() => remove(r.id)} title="Remove">
                        <Trash2 className="w-4 h-4 text-muted-foreground" />
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}