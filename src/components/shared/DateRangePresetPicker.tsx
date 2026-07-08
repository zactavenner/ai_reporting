import { useMemo, useState } from 'react';
import { Calendar as CalendarIcon } from 'lucide-react';
import { format, subDays, startOfMonth, endOfMonth, subMonths, startOfYear } from 'date-fns';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { cn } from '@/lib/utils';

type Preset = 'y' | '7d' | '14d' | '30d' | '90d' | 'tm' | 'lm' | 'ty' | 'custom';

const PRESETS: { id: Preset; label: string }[] = [
  { id: 'y', label: 'Yesterday' },
  { id: '7d', label: 'Last 7d' },
  { id: '14d', label: 'Last 14d' },
  { id: '30d', label: 'Last 30d' },
  { id: '90d', label: 'Last 90d' },
  { id: 'tm', label: 'This month' },
  { id: 'lm', label: 'Last month' },
  { id: 'ty', label: 'This year' },
];

function rangeFor(p: Preset): { from: Date; to: Date } {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = subDays(today, 1);
  switch (p) {
    case 'y': return { from: yesterday, to: yesterday };
    case '7d': return { from: subDays(yesterday, 6), to: yesterday };
    case '14d': return { from: subDays(yesterday, 13), to: yesterday };
    case '30d': return { from: subDays(yesterday, 29), to: yesterday };
    case '90d': return { from: subDays(yesterday, 89), to: yesterday };
    case 'tm': return { from: startOfMonth(today), to: yesterday };
    case 'lm': {
      const prev = subMonths(today, 1);
      return { from: startOfMonth(prev), to: endOfMonth(prev) };
    }
    case 'ty': return { from: startOfYear(today), to: yesterday };
    default: return { from: subDays(yesterday, 6), to: yesterday };
  }
}

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

interface Props {
  value: { from: Date; to: Date };
  onChange: (r: { from: Date; to: Date }) => void;
  className?: string;
}

export function DateRangePresetPicker({ value, onChange, className }: Props) {
  const [open, setOpen] = useState(false);

  const activePreset: Preset = useMemo(() => {
    for (const p of PRESETS) {
      const r = rangeFor(p.id);
      if (sameDay(r.from, value.from) && sameDay(r.to, value.to)) return p.id;
    }
    return 'custom';
  }, [value.from, value.to]);

  const label =
    activePreset === 'custom'
      ? `${format(value.from, 'MMM d')} – ${format(value.to, 'MMM d, yyyy')}`
      : PRESETS.find((p) => p.id === activePreset)?.label ?? 'Custom';

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className={cn(
            'h-8 px-3 rounded-md border border-input bg-background text-xs font-medium inline-flex items-center gap-1.5 hover:bg-accent hover:text-accent-foreground transition-colors',
            className
          )}
        >
          <CalendarIcon className="h-3.5 w-3.5" />
          {label}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-2" align="end">
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-1 max-w-[280px]">
            {PRESETS.map((p) => {
              const active = activePreset === p.id;
              return (
                <button
                  key={p.id}
                  onClick={() => {
                    onChange(rangeFor(p.id));
                    setOpen(false);
                  }}
                  className={cn(
                    'px-2.5 py-1 text-xs rounded-full transition-colors',
                    active ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'
                  )}
                >
                  {p.label}
                </button>
              );
            })}
          </div>
          <div className="border-t border-border pt-2">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold px-1 mb-1">Custom range</p>
            <Calendar
              mode="range"
              selected={{ from: value.from, to: value.to }}
              onSelect={(r: any) => {
                if (r?.from && r?.to) {
                  onChange({ from: r.from, to: r.to });
                }
              }}
              numberOfMonths={2}
            />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}