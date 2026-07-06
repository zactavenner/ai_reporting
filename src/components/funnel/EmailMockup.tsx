import { cn } from '@/lib/utils';
import { Reply, ReplyAll, Forward, Archive, Trash2, MoreHorizontal, Star } from 'lucide-react';
import type { DeviceType } from './DeviceSwitcher';

export interface EmailMessage {
  delay_days?: number;
  subject: string;
  from_name?: string;
  body: string;
}

interface EmailMockupProps {
  subject?: string;
  body?: string;
  messages?: EmailMessage[];
  fromName?: string;
  deviceType: DeviceType;
  className?: string;
}

export function EmailMockup({ subject, body, messages, fromName = 'Your Brand', deviceType, className }: EmailMockupProps) {
  const width = deviceType === 'desktop' ? 560 : deviceType === 'tablet' ? 440 : 340;

  const list: EmailMessage[] = (messages && messages.length > 0)
    ? messages
    : [{ delay_days: 0, subject: subject || '', from_name: fromName, body: body || '' }];

  const dayLabel = (d?: number) => {
    const n = Number(d) || 0;
    if (n <= 0) return 'Day 1 · Sent now';
    return `Day ${n + 1} · +${n} day${n === 1 ? '' : 's'}`;
  };

  const renderEmail = (m: EmailMessage, idx: number) => {
    const name = m.from_name || fromName;
    const initial = name.trim().charAt(0).toUpperCase() || 'B';
    return (
      <div
        key={idx}
        className="bg-white text-black rounded-2xl shadow-md border border-neutral-200 overflow-hidden"
      >
        {/* Mail toolbar */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-neutral-200 bg-neutral-50">
          <div className="flex items-center gap-3 text-neutral-500">
            <Archive className="w-4 h-4" />
            <Trash2 className="w-4 h-4" />
          </div>
          <div className="flex items-center gap-3 text-neutral-500">
            <Reply className="w-4 h-4" />
            <ReplyAll className="w-4 h-4" />
            <Forward className="w-4 h-4" />
            <MoreHorizontal className="w-4 h-4" />
          </div>
        </div>
        <div className="px-4 pt-4 pb-2">
          <h2 className="text-base font-semibold leading-tight">
            {m.subject || 'Your email subject will appear here'}
          </h2>
        </div>
        <div className="px-4 pb-3 flex items-start gap-3 border-b border-neutral-100">
          <div className="w-9 h-9 rounded-full bg-primary/15 text-primary flex items-center justify-center text-sm font-semibold">
            {initial}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium truncate">{name}</p>
              <p className="text-[11px] text-neutral-500">to me</p>
            </div>
            <p className="text-[11px] text-neutral-500">{dayLabel(m.delay_days)} · 9:41 AM</p>
          </div>
          <Star className="w-4 h-4 text-neutral-400" />
        </div>
        <div className="px-4 py-4">
          <div className="text-[13px] leading-relaxed text-neutral-800 whitespace-pre-wrap">
            {m.body || 'Your email body will appear here. Add copy in the step editor to preview how it will render.'}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className={cn('flex flex-col gap-3', className)} style={{ width }}>
      {list.map((m, i) => (
        <div key={i} className="flex flex-col gap-1.5">
          {list.length > 1 && (
            <div className="flex items-center gap-2 px-1">
              <div className="h-px flex-1 bg-neutral-200" />
              <span className="text-[10px] uppercase tracking-wide text-neutral-500 font-medium">
                {dayLabel(m.delay_days)}
              </span>
              <div className="h-px flex-1 bg-neutral-200" />
            </div>
          )}
          {renderEmail(m, i)}
        </div>
      ))}
    </div>
  );
}