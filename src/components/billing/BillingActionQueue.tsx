import { useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AlertOctagon, AlertTriangle, Clock, FileWarning, Link2Off, CreditCard, FileQuestion, BadgeCheck, ScrollText } from 'lucide-react';
import { differenceInCalendarDays, format } from 'date-fns';
import { cn } from '@/lib/utils';

export type ActionType =
  | 'failed_payment' | 'overdue' | 'due_soon' | 'invoice_needed'
  | 'missing_pm' | 'stripe_not_linked' | 'fee_review' | 'contract_ending' | 'subscription_mismatch';

export interface QueueItem {
  id: string;
  clientId: string;
  clientName: string;
  actionType: ActionType;
  amount?: number | null;
  dueDate?: string | null;
  accountManager?: string | null;
  recommendation: string;
  priority: number; // 1=urgent .. 5
}

const meta: Record<ActionType, { label: string; icon: any; tone: string }> = {
  failed_payment: { label: 'Failed Payment', icon: AlertOctagon, tone: 'text-destructive bg-destructive/10 border-destructive/30' },
  overdue: { label: 'Overdue', icon: AlertTriangle, tone: 'text-destructive bg-destructive/10 border-destructive/30' },
  due_soon: { label: 'Due Soon', icon: Clock, tone: 'text-amber-700 bg-amber-50 border-amber-200 dark:text-amber-300 dark:bg-amber-950/30 dark:border-amber-900' },
  invoice_needed: { label: 'Invoice Needed', icon: FileWarning, tone: 'text-blue-700 bg-blue-50 border-blue-200 dark:text-blue-300 dark:bg-blue-950/30 dark:border-blue-900' },
  missing_pm: { label: 'Missing Payment Method', icon: CreditCard, tone: 'text-amber-700 bg-amber-50 border-amber-200 dark:text-amber-300 dark:bg-amber-950/30' },
  stripe_not_linked: { label: 'Stripe Not Linked', icon: Link2Off, tone: 'text-muted-foreground bg-muted border-border' },
  fee_review: { label: 'Fee Review', icon: BadgeCheck, tone: 'text-blue-700 bg-blue-50 border-blue-200 dark:text-blue-300 dark:bg-blue-950/30' },
  contract_ending: { label: 'Contract Ending', icon: ScrollText, tone: 'text-amber-700 bg-amber-50 border-amber-200 dark:text-amber-300 dark:bg-amber-950/30' },
  subscription_mismatch: { label: 'Sub Mismatch', icon: FileQuestion, tone: 'text-amber-700 bg-amber-50 border-amber-200 dark:text-amber-300 dark:bg-amber-950/30' },
};

const fmt = (v?: number | null) =>
  v == null ? '' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v);

const TABS: Array<{ id: 'all' | ActionType; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'due_soon', label: 'Due Soon' },
  { id: 'invoice_needed', label: 'Invoice Needed' },
  { id: 'failed_payment', label: 'Failed' },
  { id: 'overdue', label: 'Overdue' },
  { id: 'missing_pm', label: 'Missing PM' },
  { id: 'stripe_not_linked', label: 'Not Linked' },
  { id: 'fee_review', label: 'Fee Review' },
  { id: 'contract_ending', label: 'Contract Ending' },
  { id: 'subscription_mismatch', label: 'Mismatch' },
];

function dueLabel(due?: string | null): string {
  if (!due) return 'No date';
  const d = differenceInCalendarDays(new Date(due), new Date());
  if (d < 0) return `${Math.abs(d)}d overdue`;
  if (d === 0) return 'Today';
  if (d === 1) return 'Tomorrow';
  return `In ${d}d`;
}

export function BillingActionQueue({ items, onAct }: { items: QueueItem[]; onAct?: (it: QueueItem) => void }) {
  const [tab, setTab] = useState<'all' | ActionType>('all');

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: items.length };
    for (const it of items) c[it.actionType] = (c[it.actionType] ?? 0) + 1;
    return c;
  }, [items]);

  const filtered = useMemo(() => {
    const list = tab === 'all' ? items : items.filter(i => i.actionType === tab);
    return [...list].sort((a, b) => a.priority - b.priority);
  }, [items, tab]);

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">Billing Action Queue</h3>
            <p className="text-xs text-muted-foreground">{items.length} open items needing internal review</p>
          </div>
        </div>

        <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
          <TabsList className="flex flex-wrap h-auto">
            {TABS.map(t => (
              <TabsTrigger key={t.id} value={t.id} className="text-xs gap-1.5">
                {t.label}
                <Badge variant="secondary" className="h-4 px-1.5 text-[10px] tabular-nums">{counts[t.id] ?? 0}</Badge>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        {filtered.length === 0 ? (
          <div className="text-center py-10 text-sm text-muted-foreground">
            All clear — no open billing actions in this view.
          </div>
        ) : (
          <div className="divide-y divide-border rounded-md border">
            {filtered.slice(0, 25).map((it) => {
              const m = meta[it.actionType];
              const Icon = m.icon;
              const isUrgent = it.actionType === 'failed_payment' || it.actionType === 'overdue';
              return (
                <div key={it.id} className="flex items-center gap-3 px-3 py-2.5 hover:bg-muted/40">
                  <div className={cn('h-8 w-8 rounded-md border flex items-center justify-center shrink-0', m.tone)}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm truncate">{it.clientName}</span>
                      <Badge variant="outline" className={cn('text-[10px] h-5 px-1.5', m.tone)}>{m.label}</Badge>
                      {isUrgent && <Badge variant="destructive" className="h-5 text-[10px] px-1.5">Urgent</Badge>}
                    </div>
                    <div className="text-xs text-muted-foreground truncate">{it.recommendation}</div>
                  </div>
                  <div className="text-right shrink-0 hidden sm:block">
                    {it.amount != null && <div className="text-sm font-semibold tabular-nums">{fmt(it.amount)}</div>}
                    <div className="text-[11px] text-muted-foreground">{dueLabel(it.dueDate)}</div>
                  </div>
                  {it.accountManager && (
                    <div className="hidden md:block text-[11px] text-muted-foreground w-28 truncate">AM: {it.accountManager}</div>
                  )}
                  <Button size="sm" variant="outline" onClick={() => onAct?.(it)}>Review</Button>
                </div>
              );
            })}
            {filtered.length > 25 && (
              <div className="px-3 py-2 text-xs text-muted-foreground text-center">
                +{filtered.length - 25} more — refine with the tabs above.
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
