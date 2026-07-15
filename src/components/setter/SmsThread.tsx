import { useEffect, useMemo, useRef } from 'react';
import { format, formatDistanceToNowStrict, isToday, isYesterday } from 'date-fns';
import { RefreshCw, ChevronsDown, Check, CheckCheck, AlertCircle, Mail, MessageSquare } from 'lucide-react';

export interface ThreadEvent {
  id: string;
  event_type: string;
  event_subtype: string | null;
  title: string | null;
  body: string | null;
  event_at: string;
  metadata: any;
}

interface Props {
  events: ThreadEvent[];
  leadName: string | null;
  channel: 'sms' | 'email' | 'all';
  lastSyncedAt?: Date | null;
  syncing?: boolean;
  onRefresh?: () => void;
}

function classify(e: ThreadEvent): { outbound: boolean; kind: 'sms' | 'email' | 'other' } {
  const sub = (e.event_subtype || '').toLowerCase();
  const t = (e.event_type || '').toLowerCase();
  const outbound = sub === 'outbound' || sub === 'sent' || sub.startsWith('out');
  const kind: 'sms' | 'email' | 'other' =
    t.includes('sms') || t.includes('text') || t === 'message' ? 'sms'
    : t.includes('email') || t.includes('mail') ? 'email'
    : 'other';
  return { outbound, kind };
}

function providerLabel(e: ThreadEvent, kind: 'sms' | 'email' | 'other'): string {
  const md = (e.metadata || {}) as any;
  const p = md.messageProvider || md.provider || md.source || md.channel;
  if (typeof p === 'string' && p.length) {
    const s = p.toLowerCase();
    if (s.includes('sendblue')) return 'Sendblue';
    if (s.includes('twilio')) return 'Twilio';
    if (s.includes('ghl')) return 'GHL';
    if (s.includes('gmail')) return 'Gmail';
    if (s.includes('mailgun')) return 'Mailgun';
    if (s === 'calls_table') return 'CRM';
    return p.slice(0, 12);
  }
  return kind === 'email' ? 'Email' : kind === 'sms' ? 'SMS' : '';
}

function deliveryStatus(e: ThreadEvent): 'sent' | 'delivered' | 'read' | 'failed' | 'pending' | null {
  const md = (e.metadata || {}) as any;
  const raw = (md.status || md.deliveryStatus || md.delivery_status || '').toString().toLowerCase();
  if (!raw) return null;
  if (raw.includes('fail') || raw.includes('undeliver') || raw.includes('bounce') || raw.includes('error')) return 'failed';
  if (raw.includes('read') || raw.includes('open')) return 'read';
  if (raw.includes('deliver')) return 'delivered';
  if (raw.includes('pend') || raw.includes('queue')) return 'pending';
  if (raw.includes('sent') || raw.includes('accept')) return 'sent';
  return null;
}

function DayHeader({ date }: { date: Date }) {
  const label = isToday(date) ? 'Today' : isYesterday(date) ? 'Yesterday' : format(date, 'EEE, MMM d');
  return (
    <div className="flex items-center gap-2 py-2">
      <div className="flex-1 h-px bg-border" />
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">{label}</div>
      <div className="flex-1 h-px bg-border" />
    </div>
  );
}

export function SmsThread({ events, leadName, channel, lastSyncedAt, syncing, onRefresh }: Props) {
  const filtered = useMemo(() => {
    const rows = events.filter((e) => {
      const { kind } = classify(e);
      if (channel === 'all') return kind !== 'other';
      return kind === channel;
    });
    return rows.sort((a, b) => new Date(a.event_at).getTime() - new Date(b.event_at).getTime());
  }, [events, channel]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to newest whenever the count changes
  const countKey = filtered.length;
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    // Only auto-scroll if user is already near the bottom (within 120px)
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (isNearBottom) el.scrollTop = el.scrollHeight;
    // First-render always jump to bottom
  }, [countKey]);

  const jumpToLatest = () => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  };

  const syncedLabel = lastSyncedAt
    ? `Synced ${formatDistanceToNowStrict(lastSyncedAt)} ago`
    : 'Not synced yet';

  const ChannelIcon = channel === 'email' ? Mail : MessageSquare;
  const channelTitle = channel === 'email' ? 'Email thread' : channel === 'sms' ? 'SMS thread' : 'Conversation';

  return (
    <div className="mb-3 rounded-lg border bg-muted/10 flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/30 text-[10px] uppercase tracking-wider text-muted-foreground">
        <div className="flex items-center gap-2">
          <ChannelIcon className="w-3 h-3" />
          <span>{channelTitle}</span>
          {filtered.length > 0 && <span className="normal-case text-muted-foreground/70">· {filtered.length}</span>}
        </div>
        <div className="flex items-center gap-2 normal-case">
          <span className="text-[10px]">{syncedLabel}</span>
          {onRefresh && (
            <button
              onClick={onRefresh}
              disabled={syncing}
              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-background disabled:opacity-50"
              title="Pull latest messages from GHL"
            >
              <RefreshCw className={`w-3 h-3 ${syncing ? 'animate-spin' : ''}`} />
              {syncing ? 'Syncing…' : 'Refresh'}
            </button>
          )}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="flex items-center justify-center text-xs text-muted-foreground py-12 min-h-[280px]">
          No {channel === 'email' ? 'email' : 'SMS'} history yet with {leadName?.split(' ')[0] || 'this lead'}.
        </div>
      ) : (
        <div ref={scrollRef} className="h-[440px] overflow-y-auto p-4 space-y-1 relative">
          {filtered.map((e, i) => {
            const { outbound, kind } = classify(e);
            const prev = filtered[i - 1];
            const showDayBreak =
              !prev || new Date(prev.event_at).toDateString() !== new Date(e.event_at).toDateString();
            const groupStart = !prev || classify(prev).outbound !== outbound || showDayBreak;
            const provider = providerLabel(e, kind);
            const status = outbound ? deliveryStatus(e) : null;

            return (
              <div key={e.id}>
                {showDayBreak && <DayHeader date={new Date(e.event_at)} />}
                <div className={`flex ${outbound ? 'justify-end' : 'justify-start'} ${groupStart ? 'mt-2' : 'mt-0.5'}`}>
                  <div className={`max-w-[78%] group ${outbound ? 'items-end' : 'items-start'} flex flex-col`}>
                    {groupStart && (
                      <div className={`flex items-center gap-1.5 mb-0.5 text-[10px] text-muted-foreground ${outbound ? 'flex-row-reverse' : ''}`}>
                        <span className="font-medium">{outbound ? 'You' : leadName?.split(' ')[0] || 'Lead'}</span>
                        {provider && <span className="opacity-70">· {provider}</span>}
                      </div>
                    )}
                    <div
                      className={`rounded-2xl px-3.5 py-2 text-sm shadow-sm break-words ${
                        outbound
                          ? 'bg-primary text-primary-foreground rounded-br-md'
                          : 'bg-background border rounded-bl-md'
                      } ${groupStart ? '' : (outbound ? 'rounded-tr-md' : 'rounded-tl-md')}`}
                    >
                      {kind === 'email' && e.title && (
                        <div className={`text-[10px] font-semibold mb-1 truncate ${outbound ? 'opacity-90' : 'text-muted-foreground'}`}>
                          {e.title}
                        </div>
                      )}
                      <div className="whitespace-pre-wrap">{e.body || e.title || '(no content)'}</div>
                    </div>
                    <div className={`flex items-center gap-1 mt-0.5 text-[10px] text-muted-foreground opacity-0 group-hover:opacity-100 transition ${outbound ? 'flex-row-reverse' : ''}`}>
                      <span>{format(new Date(e.event_at), 'h:mm a')}</span>
                      {outbound && status && <DeliveryIcon status={status} />}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
          <div ref={bottomRef} />
          <button
            onClick={jumpToLatest}
            className="sticky bottom-2 float-right inline-flex items-center gap-1 rounded-full bg-background border shadow px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground hover:bg-muted"
            title="Jump to latest"
          >
            <ChevronsDown className="w-3 h-3" /> latest
          </button>
        </div>
      )}
    </div>
  );
}

function DeliveryIcon({ status }: { status: 'sent' | 'delivered' | 'read' | 'failed' | 'pending' }) {
  if (status === 'failed') return <span className="inline-flex items-center gap-0.5 text-destructive"><AlertCircle className="w-3 h-3" />failed</span>;
  if (status === 'read') return <span className="inline-flex items-center gap-0.5 text-primary"><CheckCheck className="w-3 h-3" />read</span>;
  if (status === 'delivered') return <span className="inline-flex items-center gap-0.5"><CheckCheck className="w-3 h-3" />delivered</span>;
  if (status === 'pending') return <span className="inline-flex items-center gap-0.5 opacity-70">pending</span>;
  return <span className="inline-flex items-center gap-0.5"><Check className="w-3 h-3" />sent</span>;
}