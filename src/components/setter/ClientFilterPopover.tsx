import { useMemo, useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Users, Search } from 'lucide-react';

export interface ClientOption { id: string; name: string; }

interface Props {
  clients: ClientOption[];
  selectedIds: string[]; // empty = ALL
  onChange: (ids: string[]) => void;
}

export function ClientFilterPopover({ clients, selectedIds, onChange }: Props) {
  const [q, setQ] = useState('');
  const filtered = useMemo(() =>
    clients.filter(c => c.name.toLowerCase().includes(q.toLowerCase())),
  [clients, q]);

  const selectedSet = new Set(selectedIds);
  const allSelected = selectedIds.length === 0 || selectedIds.length === clients.length;
  const label = allSelected
    ? `All clients · ${clients.length}`
    : `${selectedIds.length} of ${clients.length} clients`;

  const toggle = (id: string) => {
    // Treat empty as "all". If user picks something specific, switch to explicit set.
    const base = selectedIds.length === 0 ? clients.map(c => c.id) : [...selectedIds];
    const idx = base.indexOf(id);
    if (idx >= 0) base.splice(idx, 1); else base.push(id);
    onChange(base);
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Users className="w-3.5 h-3.5" />
          <span className="text-xs">{label}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-0">
        <div className="p-2 border-b">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search clients…" className="pl-7 h-8 text-sm" />
          </div>
          <div className="flex gap-2 mt-2 text-xs">
            <button className="text-primary hover:underline" onClick={() => onChange([])}>All</button>
            <button className="text-muted-foreground hover:underline" onClick={() => onChange(clients.map(c => c.id))}>Every</button>
            <button className="text-muted-foreground hover:underline ml-auto" onClick={() => onChange(['__none__'])}>None</button>
          </div>
        </div>
        <div className="max-h-72 overflow-y-auto p-1">
          {filtered.map(c => {
            const checked = selectedIds.length === 0 ? true : selectedSet.has(c.id);
            return (
              <label key={c.id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted cursor-pointer text-sm">
                <Checkbox checked={checked} onCheckedChange={() => toggle(c.id)} />
                <span className="truncate">{c.name}</span>
              </label>
            );
          })}
          {filtered.length === 0 && <div className="p-4 text-xs text-muted-foreground text-center">No matches</div>}
        </div>
      </PopoverContent>
    </Popover>
  );
}