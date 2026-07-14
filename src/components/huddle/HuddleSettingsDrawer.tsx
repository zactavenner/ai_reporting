import { useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Settings, ArrowUp, ArrowDown } from 'lucide-react';
import type { AgendaSegment } from '@/lib/huddle/types';
import { toast } from 'sonner';

interface Props {
  agenda: AgendaSegment[];
  onSave: (next: AgendaSegment[]) => Promise<void> | void;
}

export function HuddleSettingsDrawer({ agenda, onSave }: Props) {
  const [open, setOpen] = useState(false);
  const [local, setLocal] = useState<AgendaSegment[]>(agenda);

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= local.length) return;
    const next = [...local];
    [next[i], next[j]] = [next[j], next[i]];
    setLocal(next);
  };

  const save = async () => {
    await onSave(local);
    toast.success('Agenda saved');
    setOpen(false);
  };

  return (
    <Sheet open={open} onOpenChange={(v) => { setOpen(v); if (v) setLocal(agenda); }}>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm"><Settings className="w-4 h-4 mr-1" />Agenda</Button>
      </SheetTrigger>
      <SheetContent className="w-full sm:max-w-md">
        <SheetHeader><SheetTitle>Huddle agenda</SheetTitle></SheetHeader>
        <div className="space-y-3 mt-4">
          {local.map((s, i) => (
            <div key={s.key} className="grid grid-cols-[1fr_80px_auto] gap-2 items-center">
              <Input value={s.name} onChange={(e) => {
                const next = [...local]; next[i] = { ...s, name: e.target.value }; setLocal(next);
              }} />
              <Input type="number" min={30} step={30} value={s.duration_s} onChange={(e) => {
                const next = [...local]; next[i] = { ...s, duration_s: parseInt(e.target.value) || 30 }; setLocal(next);
              }} />
              <div className="flex flex-col gap-0.5">
                <button onClick={() => move(i, -1)} className="text-muted-foreground hover:text-foreground"><ArrowUp className="w-3 h-3" /></button>
                <button onClick={() => move(i, 1)} className="text-muted-foreground hover:text-foreground"><ArrowDown className="w-3 h-3" /></button>
              </div>
            </div>
          ))}
          <Button className="w-full" onClick={save}>Save agenda</Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}