import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Zap, Search, Flame, Mail, Phone, Bell, CalendarClock, Clock } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { List, type RowComponentProps } from 'react-window';
import { fmtDuration, timeSinceISO, type SetterLead } from '@/hooks/useSetterLeads';
import { formatDistanceToNowStrict } from 'date-fns';
import { getAllLastViewed, subscribeViewed } from '@/lib/setterViewState';
import { getPhoneTimezone, isBusinessHours } from '@/lib/areaCodeTimezone';

interface Props {
  leads: SetterLead[];
  selectedId: string | null;
  onSelect: (l: SetterLead) => void;
}

type Tab = 'uncontacted' | 'all' | 'contacted' | 'callbacks' | 'unread';

const ROW_HEIGHT = 82;

function speedColor(secondsUncontacted: number) {
  // Green <5m, amber <15m, red >=15m
  if (secondsUncontacted < 5 * 60) return 'text-emerald-600 dark:text-emerald-400';
  if (secondsUncontacted < 15 * 60) return 'text-amber-600 dark:text-amber-400';
  return 'text-destructive';
}

function hasUnread(l: SetterLead, viewedAt: number): boolean {
  if (!l.last_inbound_at) return false;
  const inboundMs = new Date(l.last_inbound_at).getTime();
  return inboundMs > viewedAt;
}

function callbackState(l: SetterLead): 'overdue' | 'due-soon' | 'upcoming' | null {
  if (!l.next_callback_at) return null;
  const diff = new Date(l.next_callback_at).getTime() - Date.now();
  if (diff <= 0) return 'overdue';
  if (diff <= 60 * 60 * 1000) return 'due-soon';
  return 'upcoming';
}

export function SetterQueue({ leads, selectedId, onSelect }: Props) {
  const [tab, setTab] = useState<Tab>('uncontacted');
  const [q, setQ] = useState('');
  const [viewedMap, setViewedMap] = useState<Record<string, number>>(() => getAllLastViewed());

  useEffect(() => {
    const off = subscribeViewed(() => setViewedMap(getAllLastViewed()));
    return off;
  }, []);

  const filtered = useMemo(() => {
    let rows = leads.filter(l => !l.is_spam);
    if (tab === 'uncontacted') rows = rows.filter(l => l.touch_count === 0);
    else if (tab === 'contacted') rows = rows.filter(l => l.touch_count > 0);
    else if (tab === 'callbacks') rows = rows.filter(l => !!l.next_callback_at);
    else if (tab === 'unread') rows = rows.filter(l => hasUnread(l, viewedMap[l.id] || 0));
    if (q.trim()) {
      const s = q.toLowerCase();
      rows = rows.filter(l =>
        (l.name || '').toLowerCase().includes(s) ||
        (l.email || '').toLowerCase().includes(s) ||
        (l.phone || '').toLowerCase().includes(s) ||
        (l.client_name || '').toLowerCase().includes(s)
      );
    }
    // Sort: callbacks by due-time asc (overdue first); unread by newest inbound; uncontacted oldest-first; else newest
    if (tab === 'callbacks') {
      rows.sort((a, b) => new Date(a.next_callback_at!).getTime() - new Date(b.next_callback_at!).getTime());
    } else if (tab === 'unread') {
      rows.sort((a, b) => new Date(b.last_inbound_at || 0).getTime() - new Date(a.last_inbound_at || 0).getTime());
    } else {
      rows.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    }
    return rows;
  }, [leads, tab, q, viewedMap]);

  const counts = {
    all: leads.filter(l => !l.is_spam).length,
    uncontacted: leads.filter(l => !l.is_spam && l.touch_count === 0).length,
    contacted: leads.filter(l => l.touch_count > 0).length,
    callbacks: leads.filter(l => !!l.next_callback_at).length,
    unread: leads.filter(l => !l.is_spam && hasUnread(l, viewedMap[l.id] || 0)).length,
  };

  const rowProps: RowData = { rows: filtered, selectedId, onSelect, viewedMap };

  return (
    <div className="flex flex-col h-full" role="region" aria-label="Setter queue">
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
        <div className="flex gap-1 text-xs flex-wrap" role="tablist">
          {([
            { k: 'uncontacted', label: 'Uncontacted' },
            { k: 'unread', label: 'Unread' },
            { k: 'callbacks', label: 'Callbacks' },
            { k: 'all', label: 'All' },
            { k: 'contacted', label: 'Contacted' },
          ] as { k: Tab; label: string }[]).map(({ k, label }) => {
            const active = tab === k;
            const count = counts[k];
            const highlight = !active && (
              (k === 'unread' && count > 0) ||
              (k === 'callbacks' && leads.some(l => callbackState(l) === 'overdue'))
            );
            return (
              <button
                key={k}
                role="tab"
                aria-selected={active}
                onClick={() => setTab(k)}
                className={`px-2.5 py-1 rounded-full transition-colors ${
                  active
                    ? 'bg-primary text-primary-foreground'
                    : highlight
                      ? 'bg-primary/10 text-primary hover:bg-primary/20'
                      : 'bg-muted/60 hover:bg-muted text-muted-foreground'
                }`}
              >
                {label} · {count}
              </button>
            );
          })}
        </div>
      </div>
      <VirtualizedQueue rowProps={rowProps} emptyLabel={emptyLabel(tab)} />
    </div>
  );
}

function emptyLabel(tab: Tab): string {
  switch (tab) {
    case 'unread': return 'No unread replies.';
    case 'callbacks': return 'No callbacks scheduled.';
    case 'uncontacted': return 'No uncontacted leads — you\'re caught up.';
    default: return 'No leads.';
  }
}

type RowData = {
  rows: SetterLead[];
  selectedId: string | null;
  onSelect: (l: SetterLead) => void;
  viewedMap: Record<string, number>;
};

function VirtualizedQueue({ rowProps, emptyLabel }: { rowProps: RowData; emptyLabel: string }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  if (rowProps.rows.length === 0) {
    return <div className="flex-1 flex items-center justify-center p-8 text-center text-sm text-muted-foreground">{emptyLabel}</div>;
  }
  return (
    <div ref={wrapRef} className="flex-1 min-h-0">
      <List
        rowCount={rowProps.rows.length}
        rowHeight={ROW_HEIGHT}
        rowComponent={QueueRow}
        rowProps={rowProps}
      />
    </div>
  );
}

function QueueRow({ index, style, rows, selectedId, onSelect, viewedMap }: RowComponentProps<RowData>) {
  const l = rows[index];
  if (!l) return null;
  const uncontactedFor = l.touch_count === 0 ? timeSinceISO(l.created_at) : 0;
  const isSel = l.id === selectedId;
  const unread = hasUnread(l, viewedMap[l.id] || 0);
  const cbState = callbackState(l);
  return (
    <button
      key={l.id}
      style={style}
      onClick={() => onSelect(l)}
      role="option"
      aria-selected={isSel}
      className={`w-full text-left px-3 py-3 border-b transition-colors ${
        isSel ? 'bg-primary/5 border-l-2 border-l-primary' : 'hover:bg-muted/40'
      }`}
    >
      <div className="flex items-center gap-2 mb-1">
        {unread && (
          <span
            className="w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0"
            aria-label="Unread inbound reply"
            title="Unread inbound"
          />
        )}
        <div className={`text-sm truncate flex-1 ${unread ? 'font-bold text-foreground' : 'font-semibold'}`}>
          {l.name || 'Unnamed lead'}
        </div>
        {cbState && (
          <span
            className={`inline-flex items-center gap-0.5 text-[10px] font-medium ${
              cbState === 'overdue' ? 'text-destructive' : cbState === 'due-soon' ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'
            }`}
            title={`Callback ${new Date(l.next_callback_at!).toLocaleString()}`}
          >
            <CalendarClock className="w-3 h-3" />
            {cbState === 'overdue' ? 'due' : cbState === 'due-soon' ? '<1h' : formatDistanceToNowStrict(new Date(l.next_callback_at!))}
          </span>
        )}
        {!cbState && (
          l.touch_count === 0 ? (
            <span className={`font-mono tabular-nums text-xs font-semibold ${speedColor(uncontactedFor)}`}>
              {fmtDuration(uncontactedFor)}
            </span>
          ) : unread ? (
            <span className="text-[10px] text-primary inline-flex items-center gap-1 font-semibold">
              <Bell className="w-3 h-3" />reply
            </span>
          ) : (
            <span className="text-[10px] text-emerald-600 dark:text-emerald-400 inline-flex items-center gap-1">
              <Flame className="w-3 h-3" />contacted
            </span>
          )
        )}
      </div>
      <div className="text-xs text-muted-foreground truncate">{l.client_name}</div>
      <div className="flex items-center gap-2 mt-1 text-[10px] text-muted-foreground">
        {l.email && <Mail className="w-3 h-3" />}
        {l.phone && <Phone className="w-3 h-3" />}
        {l.inbound_count > 0 && <span className="text-[10px]">{l.inbound_count} reply{l.inbound_count === 1 ? '' : 'ies'}</span>}
        {(() => {
          const tz = getPhoneTimezone(l.phone);
          if (!tz) return null;
          const biz = isBusinessHours(l.phone);
          return (
            <span
              className={`inline-flex items-center gap-0.5 font-mono tabular-nums ${
                biz === false ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'
              }`}
              title={`${tz.tz} · ${tz.offsetLabel}${biz === false ? ' · outside 8am–8pm local' : ''}`}
            >
              <Clock className="w-3 h-3" />{tz.localTime} {tz.abbrev}
            </span>
          );
        })()}
        <span className="ml-auto">
          created {formatDistanceToNowStrict(new Date(l.created_at))} ago
        </span>
      </div>
    </button>
  );
}