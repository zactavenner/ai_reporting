import { useEffect, useState, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { Heart, MessageCircle, Send, Bookmark, ThumbsUp, MoreHorizontal, Play, Signal, Wifi, Battery } from 'lucide-react';
import type { Creative } from '@/hooks/useCreatives';
import type { DeviceType } from './DeviceSwitcher';

export type AdPlatform = 'facebook' | 'instagram';

interface AdRotatorMockupProps {
  creatives: Creative[];
  platform: AdPlatform;
  deviceType: DeviceType;
  brandName?: string;
  className?: string;
}

export function AdRotatorMockup({ creatives, platform, deviceType, brandName = 'Your Brand', className }: AdRotatorMockupProps) {
  const slides = useMemo(() => creatives.slice(0, 3), [creatives]);
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    if (slides.length <= 1) return;
    const t = setInterval(() => setIdx(i => (i + 1) % slides.length), 4000);
    return () => clearInterval(t);
  }, [slides.length]);

  const current = slides[idx];
  const isVideo = current?.type === 'video';
  const aspectRatio = (current as any)?.aspect_ratio || '1:1';
  const aspectCss = aspectRatio.replace(':', ' / ');
  const fitClass = aspectRatio === '9:16' ? 'object-cover' : 'object-contain';

  // Match IPhoneMockup inner screen dimensions so ad previews align with other steps
  const screenW = 320;
  const screenH = 620;

  if (!current) {
    return (
      <PhoneShell platform={platform}>
        <div className="w-full h-full flex items-center justify-center text-center p-6 bg-muted/20">
          <p className="text-xs text-muted-foreground">
            Select up to 3 approved or launched creatives to preview rotating ads for this step.
          </p>
        </div>
      </PhoneShell>
    );
  }

  const MediaEl = isVideo ? (
    <video
      key={current.id}
      src={current.file_url || ''}
      autoPlay
      muted
      loop
      playsInline
      className={cn('w-full h-full', fitClass)}
    />
  ) : (
    <img key={current.id} src={current.file_url || ''} alt={current.title} className={cn('w-full h-full', fitClass)} />
  );

  if (platform === 'instagram') {
    return (
      <PhoneShell platform={platform} className={className}>
        <div className="w-full h-full bg-white text-black flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 flex-shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-yellow-400 via-pink-500 to-purple-600 p-[2px]">
              <div className="w-full h-full bg-white rounded-full flex items-center justify-center text-[10px] font-bold">
                {brandName[0]}
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold leading-tight">{brandName.toLowerCase().replace(/\s+/g, '')}</p>
              <p className="text-[10px] text-neutral-500 leading-tight">Sponsored</p>
            </div>
          </div>
          <MoreHorizontal className="w-4 h-4" />
        </div>
          <div className="relative bg-black flex-1 min-h-0" style={{ maxHeight: screenW * (aspectRatio === '9:16' ? 16/9 : aspectRatio === '16:9' ? 9/16 : 1) }}>
          {MediaEl}
          {isVideo && (
            <div className="absolute top-2 right-2 bg-black/40 rounded-full p-1">
              <Play className="w-3 h-3 text-white fill-white" />
            </div>
          )}
        </div>
          <div className="flex items-center justify-between px-3 py-2 flex-shrink-0">
          <div className="flex items-center gap-3">
            <Heart className="w-5 h-5" />
            <MessageCircle className="w-5 h-5" />
            <Send className="w-5 h-5" />
          </div>
          <Bookmark className="w-5 h-5" />
        </div>
          <div className="px-3 pb-2 flex-shrink-0">
          <p className="text-xs">
            <span className="font-semibold">{brandName.toLowerCase().replace(/\s+/g, '')}</span>{' '}
            {current.headline || current.title}
          </p>
          {current.body_copy && (
            <p className="text-[11px] text-neutral-700 mt-0.5 line-clamp-2">{current.body_copy}</p>
          )}
        </div>
          <div className="mt-auto">
            {slides.length > 1 && <RotatorDots count={slides.length} active={idx} />}
          </div>
        </div>
      </PhoneShell>
    );
  }

  // Facebook
  return (
    <PhoneShell platform={platform} className={className}>
      <div className="w-full h-full bg-white text-black flex flex-col overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2 flex-shrink-0">
        <div className="w-9 h-9 rounded-full bg-[#1877F2] flex items-center justify-center text-white text-xs font-bold">
          {brandName[0]}
        </div>
        <div className="flex-1">
          <p className="text-xs font-semibold leading-tight">{brandName}</p>
          <p className="text-[10px] text-neutral-500 leading-tight">Sponsored · 🌐</p>
        </div>
        <MoreHorizontal className="w-4 h-4 text-neutral-500" />
      </div>
      {(current.body_copy || current.headline) && (
          <p className="px-3 pb-2 text-xs text-neutral-800 whitespace-pre-line line-clamp-3 flex-shrink-0">
          {current.body_copy || current.headline}
        </p>
      )}
        <div className="relative bg-black flex-1 min-h-0" style={{ maxHeight: screenW * (aspectRatio === '9:16' ? 16/9 : aspectRatio === '16:9' ? 9/16 : 1) }}>
        {MediaEl}
      </div>
      {(current.headline || current.cta_text) && (
          <div className="flex items-center justify-between bg-[#f0f2f5] px-3 py-2 flex-shrink-0">
          <div className="min-w-0">
            <p className="text-[10px] text-neutral-500 uppercase truncate">Sponsored</p>
            <p className="text-xs font-semibold truncate">{current.headline || current.title}</p>
          </div>
          <button className="bg-[#e4e6eb] text-black text-xs font-semibold px-3 py-1.5 rounded-md flex-shrink-0">
            {current.cta_text || 'Learn More'}
          </button>
        </div>
      )}
        <div className="flex items-center justify-around px-2 py-1 border-t border-neutral-200 text-neutral-600 text-xs flex-shrink-0">
        <button className="flex items-center gap-1 py-1.5"><ThumbsUp className="w-4 h-4" /> Like</button>
        <button className="flex items-center gap-1 py-1.5"><MessageCircle className="w-4 h-4" /> Comment</button>
        <button className="flex items-center gap-1 py-1.5"><Send className="w-4 h-4" /> Share</button>
      </div>
        <div className="mt-auto">
          {slides.length > 1 && <RotatorDots count={slides.length} active={idx} />}
        </div>
      </div>
    </PhoneShell>
  );
}

// iPhone shell matching IPhoneMockup dimensions (320x620 screen) so the ad
// preview aligns with the other funnel step mockups.
function PhoneShell({ children, className, platform }: { children: React.ReactNode; className?: string; platform: AdPlatform }) {
  const platformLabel = platform === 'instagram' ? 'instagram.com' : 'facebook.com';
  return (
    <div className={cn('flex flex-col items-center', className)}>
      <div className="relative">
        <div className="relative bg-foreground rounded-[50px] p-[3px] shadow-2xl">
          <div className="bg-foreground/90 rounded-[48px] p-[2px]">
            <div className="relative bg-background rounded-[46px] overflow-hidden">
              {/* Dynamic Island */}
              <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20">
                <div className="w-28 h-8 bg-foreground rounded-full" />
              </div>
              {/* Status Bar */}
              <div className="h-14 bg-background flex items-end justify-between px-8 pb-1 pt-4">
                <span className="text-sm font-semibold text-foreground">9:41</span>
                <div className="flex items-center gap-1">
                  <Signal className="h-4 w-4 text-foreground" />
                  <Wifi className="h-4 w-4 text-foreground" />
                  <Battery className="h-5 w-5 text-foreground" />
                </div>
              </div>
              {/* Screen content */}
              <div className="w-[320px] h-[620px] overflow-hidden bg-background">
                {children}
              </div>
              {/* Bottom nav */}
              <div className="h-20 bg-background/95 backdrop-blur border-t border-border flex items-center justify-around px-3 pb-2">
                <div className="px-4 py-2 bg-muted rounded-full flex-1 mx-2 max-w-[160px]">
                  <p className="text-xs text-muted-foreground truncate text-center">{platformLabel}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div className="absolute bottom-[6px] left-1/2 -translate-x-1/2 w-32 h-1 bg-muted-foreground/50 rounded-full" />
        <div className="absolute left-[-2px] top-28 w-[3px] h-8 bg-muted-foreground/70 rounded-l-sm" />
        <div className="absolute left-[-2px] top-44 w-[3px] h-14 bg-muted-foreground/70 rounded-l-sm" />
        <div className="absolute left-[-2px] top-64 w-[3px] h-14 bg-muted-foreground/70 rounded-l-sm" />
        <div className="absolute right-[-2px] top-36 w-[3px] h-20 bg-muted-foreground/70 rounded-r-sm" />
      </div>
    </div>
  );
}

function RotatorDots({ count, active }: { count: number; active: number }) {
  return (
    <div className="flex items-center justify-center gap-1.5 py-2 bg-white">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className={cn(
            'h-1.5 rounded-full transition-all',
            i === active ? 'w-6 bg-primary' : 'w-1.5 bg-neutral-300'
          )}
        />
      ))}
    </div>
  );
}