import { cn } from '@/lib/utils';
import { Signal, Wifi, Battery, ChevronLeft, Video, Phone } from 'lucide-react';
import type { DeviceType } from './DeviceSwitcher';

export interface SmsMessage {
  delay_days?: number;
  body: string;
}

interface SmsMockupProps {
  body?: string;
  messages?: SmsMessage[];
  fromName?: string;
  deviceType: DeviceType;
  className?: string;
}

export function SmsMockup({ body, messages, fromName = 'New Message', deviceType, className }: SmsMockupProps) {
  const width = deviceType === 'desktop' ? 380 : deviceType === 'tablet' ? 340 : 320;
  const height = deviceType === 'desktop' ? 620 : deviceType === 'tablet' ? 620 : 620;
  const initial = fromName.trim().charAt(0).toUpperCase() || 'B';

  const list: SmsMessage[] = (messages && messages.length > 0)
    ? messages
    : [{ delay_days: 0, body: body || '' }];

  const dayLabel = (d?: number) => {
    const n = Number(d) || 0;
    if (n <= 0) return 'Day 1 · Now';
    return `Day ${n + 1} · +${n} day${n === 1 ? '' : 's'}`;
  };

  return (
    <div className={cn('flex flex-col items-center', className)}>
      <div className="relative bg-black rounded-[50px] p-[3px] shadow-2xl">
        <div className="bg-black rounded-[48px] p-[2px]">
          <div className="relative bg-white rounded-[46px] overflow-hidden" style={{ width, height }}>
            {/* Dynamic Island */}
            <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 w-28 h-8 bg-black rounded-full" />
            {/* Status Bar */}
            <div className="h-14 flex items-end justify-between px-8 pb-1 pt-4 text-black">
              <span className="text-sm font-semibold">9:41</span>
              <div className="flex items-center gap-1">
                <Signal className="h-4 w-4" />
                <Wifi className="h-4 w-4" />
                <Battery className="h-5 w-5" />
              </div>
            </div>
            {/* Convo Header */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-neutral-200 bg-neutral-50">
              <ChevronLeft className="w-5 h-5 text-[#007AFF]" />
              <div className="flex flex-col items-center">
                <div className="w-9 h-9 rounded-full bg-neutral-300 flex items-center justify-center text-white text-sm font-semibold">
                  {initial}
                </div>
                <span className="text-[10px] text-neutral-600 mt-0.5">{fromName}</span>
              </div>
              <div className="flex items-center gap-3 text-[#007AFF]">
                <Video className="w-5 h-5" />
                <Phone className="w-5 h-5" />
              </div>
            </div>
            {/* Message thread */}
            <div className="p-3 space-y-3 overflow-y-auto" style={{ height: height - 14*4 - 60 }}>
              {list.map((m, i) => (
                <div key={i} className="space-y-1.5">
                  <p className="text-center text-[10px] text-neutral-400 uppercase tracking-wide">
                    {dayLabel(m.delay_days)}
                  </p>
                  <div className="flex justify-start">
                    <div className="max-w-[80%] bg-[#e9e9eb] text-black rounded-2xl rounded-bl-md px-3 py-2">
                      <p className="text-[13px] whitespace-pre-wrap leading-snug">
                        {m.body || 'Your SMS message preview will appear here.'}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="absolute bottom-[6px] left-1/2 -translate-x-1/2 w-32 h-1 bg-neutral-400 rounded-full" />
      </div>
    </div>
  );
}