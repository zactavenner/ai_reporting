import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Zap, Search, Flame, Mail, Phone } from 'lucide-react';
import { useMemo, useState } from 'react';
import { fmtDuration, timeSinceISO, type SetterLead } from '@/hooks/useSetterLeads';
import { formatDistanceToNowStrict } from 'date-fns';

interface Props {
  leads: SetterLead[];
  selectedId: string | null;
  onSelect: (l: SetterLead) => void;
}

type Tab = 'all' | 'uncontacted' | 'contacted';

function speedColor(secondsUncontacted: number) {
  // Green <5m, amber <15m, red >=15m
  if (secondsUncontacted < 5 * 60) return 'text-emerald-500';
  if (secondsUncontacted < 15 * 60) return 'text-amber-500';
  return 'text-destructive';
}

export function SetterQueue({ leads, selectedId, onSelect }: Props) {
  const [tab, setTab] = useState<Tab>('uncontacted');
  const [q, setQ] = useState('');

  const filtered = useMemo(() => {
    let rows = leads.filter(l => !l.is_spam);
    if (tab === 'uncontacted') rows = rows.filter(l => l.touch_count === 0);
    if (tab === 'contacted') rows = rows.filter(l => l.touch_count > 0);
    if (q.trim()) {
      const s = q.toLowerCase();
      rows = rows.filter(l =>
        (l.name || '').toLowerCase().includes(s) ||
        (l.email || '').toLowerCase().includes(s) ||
        (l.phone || '').toLowerCase().includes(s) ||
        (l.client_name || '').toLowerCase().includes(s)
      );
    }
    // Sort uncontacted by oldest first (most urgent), contacted by newest first
    if (tab === 'uncontacted') {
      rows.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    } else {
      rows.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    }
    return rows;
  }, [leads, tab, q]);

  const counts = {
    all: leads.filter(l => !l.is_spam).length,
    uncontacted: leads.filter(l => !l.is_spam && l.touch_count === 0).length,
    contacted: leads.filter(l => l.touch_count > 0).length,
  };

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b space-y-3">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-primary" />
          <h2 className="font-semibold tracking-tight">Setter Queue</h2>
          <Badge variant="secondary" className="ml-auto">{counts.all}</Badge>
        </div>
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, email, client…" className="pl-7 h-8 text-sm" />
        </div>
        <div className="flex gap-1 text-xs">
          {(['uncontacted', 'all', 'contacted'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-2.5 py-1 rounded-full transition-colors capitalize ${
                tab === t ? 'bg-primary text-primary-foreground' : 'bg-muted/60 hover:bg-muted text-muted-foreground'
              }`}
            >
              {t} · {counts[t]}
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 && (
          <div className="p-8 text-center text-sm text-muted-foreground">No leads.</div>
        )}
        {filtered.map((l) => {
          const uncontactedFor = l.touch_count === 0 ? timeSinceISO(l.created_at) : 0;
          const isSel = l.id === selectedId;
          return (
            <button
              key={l.id}
              onClick={() => onSelect(l)}
              className={`w-full text-left px-3 py-3 border-b transition-colors ${
                isSel ? 'bg-primary/5 border-l-2 border-l-primary' : 'hover:bg-muted/40'
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <div className="font-semibold text-sm truncate flex-1">{l.name || 'Unnamed lead'}</div>
                {l.touch_count === 0 ? (
                  <span className={`font-mono tabular-nums text-xs font-semibold ${speedColor(uncontactedFor)}`}>
                    {fmtDuration(uncontactedFor)}
                  </span>
                ) : (
                  <span className="text-[10px] text-emerald-500 inline-flex items-center gap-1">
                    <Flame className="w-3 h-3" />contacted
                  </span>
                )}
              </div>
              <div className="text-xs text-muted-foreground truncate">{l.client_name}</div>
              <div className="flex items-center gap-2 mt-1 text-[10px] text-muted-foreground">
                {l.email && <Mail className="w-3 h-3" />}
                {l.phone && <Phone className="w-3 h-3" />}
                <span className="ml-auto">
                  created {formatDistanceToNowStrict(new Date(l.created_at))} ago
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}