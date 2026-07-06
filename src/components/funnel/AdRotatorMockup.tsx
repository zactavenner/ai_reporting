import { useEffect, useState, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { Heart, MessageCircle, Send, Bookmark, ThumbsUp, MoreHorizontal, Play } from 'lucide-react';
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

  const width = deviceType === 'desktop' ? 480 : deviceType === 'tablet' ? 420 : 320;

  if (!current) {
    return (
      <div
        className={cn('rounded-2xl border-2 border-dashed border-border bg-muted/30 flex items-center justify-center text-center p-6', className)}
        style={{ width, height: 560 }}
      >
        <p className="text-xs text-muted-foreground">
          Select up to 3 approved or launched creatives to preview rotating ads for this step.
        </p>
      </div>
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
      className="w-full h-full object-cover"
    />
  ) : (
    <img key={current.id} src={current.file_url || ''} alt={current.title} className="w-full h-full object-cover" />
  );

  if (platform === 'instagram') {
    return (
      <div className={cn('bg-white text-black rounded-2xl overflow-hidden shadow-lg', className)} style={{ width }}>
        <div className="flex items-center justify-between px-3 py-2">
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
        <div className="relative bg-black" style={{ aspectRatio: '1 / 1' }}>
          {MediaEl}
          {isVideo && (
            <div className="absolute top-2 right-2 bg-black/40 rounded-full p-1">
              <Play className="w-3 h-3 text-white fill-white" />
            </div>
          )}
        </div>
        <div className="flex items-center justify-between px-3 py-2">
          <div className="flex items-center gap-3">
            <Heart className="w-5 h-5" />
            <MessageCircle className="w-5 h-5" />
            <Send className="w-5 h-5" />
          </div>
          <Bookmark className="w-5 h-5" />
        </div>
        <div className="px-3 pb-2">
          <p className="text-xs">
            <span className="font-semibold">{brandName.toLowerCase().replace(/\s+/g, '')}</span>{' '}
            {current.headline || current.title}
          </p>
          {current.body_copy && (
            <p className="text-[11px] text-neutral-700 mt-0.5 line-clamp-2">{current.body_copy}</p>
          )}
        </div>
        {slides.length > 1 && <RotatorDots count={slides.length} active={idx} />}
      </div>
    );
  }

  // Facebook
  return (
    <div className={cn('bg-white text-black rounded-xl overflow-hidden shadow-lg', className)} style={{ width }}>
      <div className="flex items-center gap-2 px-3 py-2">
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
        <p className="px-3 pb-2 text-xs text-neutral-800 whitespace-pre-line line-clamp-3">
          {current.body_copy || current.headline}
        </p>
      )}
      <div className="relative bg-black" style={{ aspectRatio: '1 / 1' }}>
        {MediaEl}
      </div>
      {(current.headline || current.cta_text) && (
        <div className="flex items-center justify-between bg-[#f0f2f5] px-3 py-2">
          <div className="min-w-0">
            <p className="text-[10px] text-neutral-500 uppercase truncate">Sponsored</p>
            <p className="text-xs font-semibold truncate">{current.headline || current.title}</p>
          </div>
          <button className="bg-[#e4e6eb] text-black text-xs font-semibold px-3 py-1.5 rounded-md flex-shrink-0">
            {current.cta_text || 'Learn More'}
          </button>
        </div>
      )}
      <div className="flex items-center justify-around px-2 py-1 border-t border-neutral-200 text-neutral-600 text-xs">
        <button className="flex items-center gap-1 py-1.5"><ThumbsUp className="w-4 h-4" /> Like</button>
        <button className="flex items-center gap-1 py-1.5"><MessageCircle className="w-4 h-4" /> Comment</button>
        <button className="flex items-center gap-1 py-1.5"><Send className="w-4 h-4" /> Share</button>
      </div>
      {slides.length > 1 && <RotatorDots count={slides.length} active={idx} />}
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