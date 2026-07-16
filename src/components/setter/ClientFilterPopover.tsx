import { useEffect, useMemo, useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Users, Search, Trash2, RotateCcw, EyeOff, Eye } from 'lucide-react';

export interface ClientOption { id: string; name: string; }

interface Props {
  clients: ClientOption[];
  selectedIds: string[]; // empty = ALL (of visible)
  onChange: (ids: string[]) => void;
}

const HIDDEN_LS_KEY = 'setter.hiddenClientIds.v1';

function readHidden(): string[] {
  try {
    const raw = localStorage.getItem(HIDDEN_LS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : [];
  } catch { return []; }
}

function writeHidden(ids: string[]) {
  try { localStorage.setItem(HIDDEN_LS_KEY, JSON.stringify(ids)); } catch {}
}

export function ClientFilterPopover({ clients, selectedIds, onChange }: Props) {
  const [q, setQ] = useState('');
  const [hidden, setHidden] = useState<string[]>(readHidden);
  const [showHidden, setShowHidden] = useState(false);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === HIDDEN_LS_KEY) setHidden(readHidden());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const hiddenSet = useMemo(() => new Set(hidden), [hidden]);
  const visibleClients = useMemo(
    () => clients.filter(c => !hiddenSet.has(c.id)),
    [clients, hiddenSet]
  );
  const listSource = showHidden ? clients.filter(c => hiddenSet.has(c.id)) : visibleClients;
  const filtered = useMemo(() =>
    listSource.filter(c => c.name.toLowerCase().includes(q.toLowerCase())),
  [listSource, q]);

  const updateHidden = (next: string[]) => {
    setHidden(next);
    writeHidden(next);
  };

  const trash = (id: string) => {
    if (hiddenSet.has(id)) return;
    updateHidden([...hidden, id]);
    // Drop from active selection so hidden clients stop pulling data.
    if (selectedIds.length > 0 && !(selectedIds.length === 1 && selectedIds[0] === '__none__')) {
      onChange(selectedIds.filter(x => x !== id));
    }
  };

  const restore = (id: string) => {
    updateHidden(hidden.filter(x => x !== id));
  };

  const selectedSet = new Set(selectedIds);
  const totalVisible = visibleClients.length;
  const activeSelectedCount = selectedIds.length === 0
    ? totalVisible
    : selectedIds.filter(id => id !== '__none__' && !hiddenSet.has(id)).length;
  const allSelected = selectedIds.length === 0 || activeSelectedCount === totalVisible;
  const label = allSelected
    ? `All clients · ${totalVisible}`
    : `${activeSelectedCount} of ${totalVisible} clients`;

  const toggle = (id: string) => {
    const base = selectedIds.length === 0 ? visibleClients.map(c => c.id) : [...selectedIds.filter(x => x !== '__none__')];
    const idx = base.indexOf(id);
    if (idx >= 0) base.splice(idx, 1); else base.push(id);
    onChange(base.length ? base : ['__none__']);
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Users className="w-3.5 h-3.5" />
          <span className="text-xs">{label}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="p-2 border-b">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search clients…" className="pl-7 h-8 text-sm" />
          </div>
          <div className="flex gap-2 mt-2 text-xs items-center">
            <button className="text-primary hover:underline disabled:opacity-40" onClick={() => onChange([])} disabled={showHidden}>All</button>
            <button className="text-muted-foreground hover:underline disabled:opacity-40" onClick={() => onChange(visibleClients.map(c => c.id))} disabled={showHidden}>Every</button>
            <button className="text-muted-foreground hover:underline disabled:opacity-40" onClick={() => onChange(['__none__'])} disabled={showHidden}>None</button>
            <button
              className="ml-auto inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
              onClick={() => setShowHidden(v => !v)}
              title={showHidden ? 'Back to active list' : 'Show hidden clients'}
            >
              {showHidden ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
              {showHidden ? 'Active' : `Hidden (${hidden.length})`}
            </button>
          </div>
        </div>
        <div className="max-h-72 overflow-y-auto p-1">
          {filtered.map(c => {
            if (showHidden) {
              return (
                <div key={c.id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted text-sm">
                  <span className="truncate flex-1 text-muted-foreground">{c.name}</span>
                  <button
                    onClick={() => restore(c.id)}
                    className="text-xs inline-flex items-center gap-1 text-primary hover:underline"
                    title="Restore client"
                  >
                    <RotateCcw className="w-3 h-3" /> Restore
                  </button>
                </div>
              );
            }
            const checked = selectedIds.length === 0 ? true : selectedSet.has(c.id);
            return (
              <div key={c.id} className="group flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted text-sm">
                <label className="flex items-center gap-2 flex-1 cursor-pointer min-w-0">
                  <Checkbox checked={checked} onCheckedChange={() => toggle(c.id)} />
                  <span className="truncate">{c.name}</span>
                </label>
                <button
                  onClick={(e) => { e.stopPropagation(); trash(c.id); }}
                  className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity"
                  title="Hide from list"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })}
          {filtered.length === 0 && (
            <div className="p-4 text-xs text-muted-foreground text-center">
              {showHidden ? 'No hidden clients' : 'No matches'}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}