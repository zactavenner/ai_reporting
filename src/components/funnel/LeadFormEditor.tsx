import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Trash2, GripVertical, Sparkles } from 'lucide-react';

export type LeadFormQuestion =
  | { id: string; type: 'short_text'; label: string; required?: boolean }
  | { id: string; type: 'multiple_choice'; label: string; required?: boolean; options: string[] }
  | { id: string; type: 'capital'; label: string; required?: boolean; min_k: number; options?: string[] };

function fmtK(k: number): string {
  if (k >= 1000) {
    const m = k / 1000;
    return m === Math.floor(m) ? `$${m}M` : `$${m.toFixed(1)}M`;
  }
  return `$${k}K`;
}

export function generateCapitalOptions(min_k: number): string[] {
  const minSafe = Math.max(10, Math.round(min_k));
  const disqualifier = `Less than ${fmtK(Math.max(1, minSafe - 10))}`;
  const tiers = [100, 150, 250, 500, 1000].filter(t => t > minSafe);
  const buckets: string[] = [disqualifier];
  let prev = minSafe;
  for (const t of tiers) {
    buckets.push(`${fmtK(prev)} – ${fmtK(t)}`);
    prev = t;
  }
  buckets.push(`${fmtK(1000)}+`);
  return buckets;
}

function uid() { return crypto.randomUUID(); }

export const DEFAULT_LEAD_FORM_QUESTIONS: LeadFormQuestion[] = [
  { id: uid(), type: 'multiple_choice', label: 'Are you an accredited investor?', required: true, options: ['Yes', 'No'] },
  (() => {
    const min_k = 100;
    return { id: uid(), type: 'capital', label: 'How much capital do you have to deploy?', required: true, min_k, options: generateCapitalOptions(min_k) };
  })(),
];

interface LeadFormEditorProps {
  questions: LeadFormQuestion[];
  onChange: (q: LeadFormQuestion[]) => void;
}

export function LeadFormEditor({ questions, onChange }: LeadFormEditorProps) {
  const update = (i: number, patch: Partial<LeadFormQuestion>) => {
    onChange(questions.map((q, idx) => (idx === i ? ({ ...q, ...patch } as LeadFormQuestion) : q)));
  };
  const remove = (i: number) => onChange(questions.filter((_, idx) => idx !== i));
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= questions.length) return;
    const next = [...questions];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  const addQuestion = (type: LeadFormQuestion['type']) => {
    if (type === 'multiple_choice') {
      onChange([...questions, { id: uid(), type, label: 'New question', required: true, options: ['Option 1', 'Option 2'] }]);
    } else if (type === 'capital') {
      const min_k = 100;
      onChange([...questions, { id: uid(), type, label: 'How much capital do you have to deploy?', required: true, min_k, options: generateCapitalOptions(min_k) }]);
    } else {
      onChange([...questions, { id: uid(), type: 'short_text', label: 'New question', required: false }]);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="text-sm">Form questions</Label>
        <span className="text-[11px] text-muted-foreground">{questions.length} question{questions.length === 1 ? '' : 's'}</span>
      </div>

      {questions.length === 0 && (
        <p className="text-xs text-muted-foreground rounded-lg border border-dashed p-4 text-center">
          No custom questions yet. Add one below — the default Facebook Lead Form template will be shown until you do.
        </p>
      )}

      {questions.map((q, i) => (
        <div key={q.id} className="rounded-lg border border-border p-3 space-y-2 bg-muted/30">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">#{i + 1}</span>
            <Select value={q.type} onValueChange={(v) => {
              if (v === 'multiple_choice' && q.type !== 'multiple_choice') {
                update(i, { type: 'multiple_choice', options: (q as any).options || ['Option 1', 'Option 2'] } as any);
              } else if (v === 'capital' && q.type !== 'capital') {
                const min_k = (q as any).min_k || 100;
                update(i, { type: 'capital', min_k, options: generateCapitalOptions(min_k) } as any);
              } else if (v === 'short_text' && q.type !== 'short_text') {
                update(i, { type: 'short_text' } as any);
              }
            }}>
              <SelectTrigger className="h-7 w-40 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="short_text">Short text</SelectItem>
                <SelectItem value="multiple_choice">Multiple choice</SelectItem>
                <SelectItem value="capital">Capital range (auto)</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex-1" />
            <label className="text-[11px] text-muted-foreground flex items-center gap-1 select-none">
              <input type="checkbox" checked={!!q.required} onChange={e => update(i, { required: e.target.checked })} />
              Required
            </label>
            <div className="flex items-center gap-0.5">
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => move(i, -1)} disabled={i === 0} title="Move up">↑</Button>
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => move(i, 1)} disabled={i === questions.length - 1} title="Move down">↓</Button>
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => remove(i)} title="Remove"><Trash2 className="h-3 w-3 text-destructive" /></Button>
            </div>
          </div>

          <Input
            value={q.label}
            onChange={e => update(i, { label: e.target.value })}
            placeholder="Question text"
            className="h-8 text-xs"
          />

          {q.type === 'multiple_choice' && (
            <div className="space-y-1.5 pl-2 border-l-2 border-border/60">
              {q.options.map((opt, oi) => (
                <div key={oi} className="flex items-center gap-2">
                  <GripVertical className="h-3 w-3 text-muted-foreground/50" />
                  <Input
                    value={opt}
                    onChange={e => {
                      const next = [...q.options];
                      next[oi] = e.target.value;
                      update(i, { options: next } as any);
                    }}
                    placeholder={`Option ${oi + 1}`}
                    className="h-7 text-xs"
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0"
                    onClick={() => update(i, { options: q.options.filter((_, x) => x !== oi) } as any)}
                    disabled={q.options.length <= 1}
                  >
                    <Trash2 className="h-3 w-3 text-destructive" />
                  </Button>
                </div>
              ))}
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() => update(i, { options: [...q.options, `Option ${q.options.length + 1}`] } as any)}
              >
                <Plus className="h-3 w-3 mr-1" /> Add option
              </Button>
            </div>
          )}

          {q.type === 'capital' && (
            <div className="pl-2 border-l-2 border-primary/40 space-y-2">
              <div className="flex items-center gap-2">
                <Label className="text-[11px] whitespace-nowrap">Minimum ($K)</Label>
                <Input
                  type="number"
                  min={10}
                  step={10}
                  value={q.min_k}
                  onChange={e => {
                    const min_k = parseInt(e.target.value) || 0;
                    update(i, { min_k, options: generateCapitalOptions(min_k) } as any);
                  }}
                  className="h-7 w-24 text-xs"
                />
                <Sparkles className="h-3 w-3 text-primary" />
                <span className="text-[11px] text-muted-foreground">Ranges auto-generate below</span>
              </div>
              <div className="rounded-md bg-background/60 border p-2 space-y-0.5">
                {(q.options || generateCapitalOptions(q.min_k)).map((opt, oi) => (
                  <div key={oi} className="text-[11px] text-foreground/80 flex items-center gap-2">
                    <span className="inline-block w-3 h-3 rounded-full border border-muted-foreground/40" />
                    {opt}
                    {oi === 0 && <span className="text-[10px] text-destructive/70 ml-1">(disqualifier)</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ))}

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <Button variant="outline" size="sm" onClick={() => addQuestion('short_text')}>
          <Plus className="h-3 w-3 mr-1" /> Short text
        </Button>
        <Button variant="outline" size="sm" onClick={() => addQuestion('multiple_choice')}>
          <Plus className="h-3 w-3 mr-1" /> Multiple choice
        </Button>
        <Button variant="outline" size="sm" onClick={() => addQuestion('capital')}>
          <Plus className="h-3 w-3 mr-1" /> Capital range
        </Button>
      </div>
    </div>
  );
}