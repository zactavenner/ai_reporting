import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { StickyNote, Trash2, Plus, ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { format, formatDistanceToNowStrict } from 'date-fns';
import { useTeamMember } from '@/contexts/TeamMemberContext';

interface Note {
  id: string;
  title: string | null;
  kind: string;
  content: string;
  source: string | null;
  occurred_at: string | null;
  created_at: string;
}

const KINDS = [
  { value: 'note', label: 'Note' },
  { value: 'transcript', label: 'Transcript' },
  { value: 'email', label: 'Email' },
  { value: 'sms', label: 'SMS thread' },
  { value: 'meeting', label: 'Ad-hoc meeting' },
];

export function ClientCallNotesPanel({ clientId }: { clientId: string }) {
  const { currentMember } = useTeamMember();
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState('note');
  const [source, setSource] = useState('');
  const [content, setContent] = useState('');

  const load = async () => {
    setLoading(true);
    const { data } = await (supabase as any)
      .from('client_call_notes')
      .select('id, title, kind, content, source, occurred_at, created_at')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false })
      .limit(50);
    setNotes((data as any) || []);
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [clientId]);

  const save = async () => {
    if (!content.trim()) { toast.error('Paste some content first'); return; }
    setSaving(true);
    try {
      const { error } = await (supabase as any).from('client_call_notes').insert({
        client_id: clientId,
        title: title.trim() || null,
        kind,
        source: source.trim() || null,
        content: content.trim(),
        created_by: currentMember?.id ?? null,
      });
      if (error) throw error;
      setTitle(''); setSource(''); setContent(''); setKind('note');
      setOpen(false);
      toast.success('Saved — available to the AI review chat');
      load();
    } catch (e: any) {
      toast.error(e?.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm('Delete this note? It will no longer be available to the AI review chat.')) return;
    const { error } = await (supabase as any).from('client_call_notes').delete().eq('id', id);
    if (error) { toast.error(error.message); return; }
    setNotes((n) => n.filter((x) => x.id !== id));
  };

  return (
    <Card className="p-4 md:p-5">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <StickyNote className="h-5 w-5 text-primary" />
          <div>
            <div className="text-sm font-semibold">Notes & pasted transcripts</div>
            <div className="text-[11px] text-muted-foreground">Saved to this client and searched by the AI review chat below.</div>
          </div>
        </div>
        <Button size="sm" onClick={() => setOpen((o) => !o)}>
          <Plus className="w-3.5 h-3.5 mr-1" />{open ? 'Close' : 'Add note'}
        </Button>
      </div>

      {open && (
        <div className="space-y-2 border rounded-md p-3 mb-4 bg-muted/20">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <Input placeholder="Title (optional)" value={title} onChange={(e) => setTitle(e.target.value)} />
            <select
              className="h-9 rounded-md border bg-background px-2 text-sm"
              value={kind}
              onChange={(e) => setKind(e.target.value)}
            >
              {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
            </select>
            <Input placeholder="Source (e.g. Zoom, Slack, Loom link)" value={source} onChange={(e) => setSource(e.target.value)} />
          </div>
          <Textarea
            placeholder="Paste transcript or notes here…"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={8}
            className="font-mono text-xs"
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => { setOpen(false); setContent(''); }}>Cancel</Button>
            <Button size="sm" onClick={save} disabled={saving || !content.trim()}>
              {saving ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : null}Save note
            </Button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-xs text-muted-foreground italic">Loading…</div>
      ) : notes.length === 0 ? (
        <div className="text-xs text-muted-foreground italic">No pasted notes yet.</div>
      ) : (
        <ul className="space-y-2">
          {notes.map((n) => {
            const isOpen = !!expanded[n.id];
            const label = KINDS.find((k) => k.value === n.kind)?.label || n.kind;
            const preview = n.content.length > 220 ? n.content.slice(0, 220) + '…' : n.content;
            return (
              <li key={n.id} className="border rounded-md p-3 text-xs bg-background">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-sm truncate">{n.title || `${label} — ${format(new Date(n.created_at), 'MMM d, yyyy')}`}</div>
                    <div className="text-[10px] text-muted-foreground flex flex-wrap gap-x-2 mt-0.5">
                      <Badge variant="outline" className="text-[9px]">{label}</Badge>
                      {n.source && <span>· {n.source}</span>}
                      <span>· {formatDistanceToNowStrict(new Date(n.created_at), { addSuffix: true })}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setExpanded((e) => ({ ...e, [n.id]: !isOpen }))}>
                      {isOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                    </Button>
                    <Button size="icon" variant="ghost" className="h-6 w-6 text-muted-foreground hover:text-destructive" onClick={() => remove(n.id)}>
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
                <div className="mt-2 whitespace-pre-wrap leading-relaxed bg-muted/30 rounded p-2 border max-h-96 overflow-y-auto">
                  {isOpen ? n.content : preview}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}