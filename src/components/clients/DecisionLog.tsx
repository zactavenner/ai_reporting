import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface Decision {
  id: string;
  topic: string;
  decision: string | null;
  owner_name: string | null;
  status: string;
  notes: string | null;
  updated_at: string;
}

const STATUSES = ['not_started', 'in_progress', 'blocked', 'approved'] as const;

const STATUS_COLORS: Record<string, string> = {
  not_started: 'bg-muted text-foreground',
  in_progress: 'bg-blue-500/15 text-blue-500',
  blocked: 'bg-destructive/15 text-destructive',
  approved: 'bg-emerald-500/15 text-emerald-500',
};

export function DecisionLog({ clientId }: { clientId: string }) {
  const [rows, setRows] = useState<Decision[]>([]);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ topic: '', decision: '', owner_name: '', notes: '', status: 'not_started' });

  async function load() {
    const { data } = await supabase
      .from('client_decisions')
      .select('*')
      .eq('client_id', clientId)
      .order('updated_at', { ascending: false });
    setRows((data as Decision[]) ?? []);
  }

  useEffect(() => { load(); }, [clientId]);

  async function save() {
    if (!draft.topic.trim()) {
      toast.error('Topic required');
      return;
    }
    const { error } = await supabase.from('client_decisions').insert({ client_id: clientId, ...draft });
    if (error) {
      toast.error(error.message);
      return;
    }
    setDraft({ topic: '', decision: '', owner_name: '', notes: '', status: 'not_started' });
    setAdding(false);
    load();
  }

  async function updateStatus(id: string, status: string) {
    await supabase.from('client_decisions').update({ status }).eq('id', id);
    load();
  }

  async function remove(id: string) {
    await supabase.from('client_decisions').delete().eq('id', id);
    load();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between text-base">
          <span>Decision Log</span>
          <Button size="sm" variant="outline" onClick={() => setAdding((p) => !p)}>
            <Plus className="h-4 w-4 mr-1" /> Add
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {adding && (
          <div className="border rounded-md p-3 space-y-2 bg-muted/30">
            <Input placeholder="Topic" value={draft.topic} onChange={(e) => setDraft({ ...draft, topic: e.target.value })} />
            <Textarea placeholder="Decision" rows={2} value={draft.decision} onChange={(e) => setDraft({ ...draft, decision: e.target.value })} />
            <div className="grid grid-cols-2 gap-2">
              <Input placeholder="Owner" value={draft.owner_name} onChange={(e) => setDraft({ ...draft, owner_name: e.target.value })} />
              <Select value={draft.status} onValueChange={(v) => setDraft({ ...draft, status: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATUSES.map((s) => <SelectItem key={s} value={s}>{s.replace(/_/g, ' ')}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Textarea placeholder="Notes" rows={2} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
            <div className="flex gap-2 justify-end">
              <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
              <Button size="sm" onClick={save}>Save</Button>
            </div>
          </div>
        )}
        {rows.length === 0 && !adding && (
          <p className="text-sm text-muted-foreground">No decisions yet.</p>
        )}
        {rows.map((d) => (
          <div key={d.id} className="border rounded-md p-3 flex items-start gap-3">
            <div className="flex-1 space-y-1">
              <div className="flex items-center gap-2">
                <span className="font-medium text-sm">{d.topic}</span>
                <Select value={d.status} onValueChange={(v) => updateStatus(d.id, v)}>
                  <SelectTrigger className={`h-6 text-xs w-32 ${STATUS_COLORS[d.status] ?? ''}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUSES.map((s) => <SelectItem key={s} value={s}>{s.replace(/_/g, ' ')}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {d.decision && <div className="text-sm">{d.decision}</div>}
              {d.notes && <div className="text-xs text-muted-foreground">{d.notes}</div>}
              {d.owner_name && <Badge variant="outline" className="mt-1">{d.owner_name}</Badge>}
            </div>
            <Button size="icon" variant="ghost" onClick={() => remove(d.id)}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}