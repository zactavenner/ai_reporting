import { cn } from '@/lib/utils';
import { Reply, ReplyAll, Forward, Archive, Trash2, MoreHorizontal, Star } from 'lucide-react';
import type { DeviceType } from './DeviceSwitcher';

interface EmailMockupProps {
  subject: string;
  body: string;
  fromName?: string;
  deviceType: DeviceType;
  className?: string;
}

export function EmailMockup({ subject, body, fromName = 'Your Brand', deviceType, className }: EmailMockupProps) {
  const width = deviceType === 'desktop' ? 560 : deviceType === 'tablet' ? 440 : 340;
  const initial = fromName.trim().charAt(0).toUpperCase() || 'B';

  return (
    <div
      className={cn('bg-white text-black rounded-2xl shadow-xl border border-neutral-200 overflow-hidden flex flex-col', className)}
      style={{ width, minHeight: 560 }}
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

      {/* Subject */}
      <div className="px-4 pt-4 pb-2">
        <h2 className="text-base font-semibold leading-tight">
          {subject || 'Your email subject will appear here'}
        </h2>
      </div>

      {/* Sender row */}
      <div className="px-4 pb-3 flex items-start gap-3 border-b border-neutral-100">
        <div className="w-9 h-9 rounded-full bg-primary/15 text-primary flex items-center justify-center text-sm font-semibold">
          {initial}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium truncate">{fromName}</p>
            <p className="text-[11px] text-neutral-500">to me</p>
          </div>
          <p className="text-[11px] text-neutral-500">Today · 9:41 AM</p>
        </div>
        <Star className="w-4 h-4 text-neutral-400" />
      </div>

      {/* Body */}
      <div className="px-4 py-4 flex-1 overflow-y-auto">
        <div className="text-[13px] leading-relaxed text-neutral-800 whitespace-pre-wrap">
          {body || 'Your email body will appear here. Add copy in the step editor to preview how it will render.'}
        </div>
      </div>
    </div>
  );
}