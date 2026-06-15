import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Signal, Wifi, Battery } from 'lucide-react';

interface IPhoneMockupProps {
  url: string;
  title?: string;
  className?: string;
}

export function IPhoneMockup({ url, title, className }: IPhoneMockupProps) {
  const [iframeKey, setIframeKey] = useState(0);

  const getDomain = (urlStr: string) => {
    try {
      return new URL(urlStr).hostname;
    } catch {
      return urlStr;
    }
  };

  const handleRefresh = () => {
    setIframeKey(k => k + 1);
  };

  return (
    <div className={cn("flex flex-col items-center", className)}>
      {title && (
        <h3 className="text-sm font-medium text-muted-foreground mb-2">{title}</h3>
      )}
      <div className="relative">
        {/* iPhone Frame - Black outer shell */}
        <div className="relative bg-foreground rounded-[50px] p-[3px] shadow-2xl">
          {/* Inner bezel - slightly lighter */}
          <div className="bg-foreground/90 rounded-[48px] p-[2px]">
            {/* Screen container */}
            <div className="relative bg-background rounded-[46px] overflow-hidden">
              {/* Dynamic Island */}
              <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20">
                <div className="w-28 h-8 bg-foreground rounded-full flex items-center justify-center gap-2">
                  <div className="w-2.5 h-2.5 bg-muted/30 rounded-full" />
                </div>
              </div>
              
              {/* Status Bar */}
              <div className="h-14 bg-background flex items-end justify-between px-8 pb-1 pt-4">
                <span className="text-sm font-semibold text-foreground">9:41</span>
                <div className="flex items-center gap-1">
                  <Signal className="h-4 w-4 text-foreground" />
                  <Wifi className="h-4 w-4 text-foreground" />
                  <div className="flex items-center gap-0.5">
                    <Battery className="h-5 w-5 text-foreground" />
                  </div>
                </div>
              </div>
              
              {/* Screen Content */}
              <div className="w-[320px] h-[620px] overflow-hidden bg-background">
                <iframe
                  key={iframeKey}
                  src={url}
                  className="w-full h-full border-0"
                  style={{ 
                    width: '390px', 
                    height: '760px',
                    transform: 'scale(0.82)',
                    transformOrigin: 'top left',
                    pointerEvents: 'auto'
                  }}
                  title={title || 'Funnel Preview'}
                  sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
                />
              </div>
              
              {/* Safari Bottom Navigation Bar */}
              <div className="h-20 bg-background/95 backdrop-blur border-t border-border flex items-center justify-around px-3 pb-2">
                <button className="p-2.5 bg-muted rounded-full">
                  <svg className="h-4 w-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
                <button className="p-2.5 bg-muted rounded-full">
                  <svg className="h-4 w-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </button>
                <div className="px-4 py-2 bg-muted rounded-full flex-1 mx-2 max-w-[140px]">
                  <p className="text-xs text-muted-foreground truncate text-center">
                    {getDomain(url)}
                  </p>
                </div>
                <button 
                  onClick={handleRefresh}
                  className="p-2.5 bg-muted rounded-full hover:bg-muted/80 transition-colors"
                  title="Refresh"
                >
                  <svg className="h-4 w-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                </button>
                <button className="p-2.5 bg-muted rounded-full">
                  <svg className="h-4 w-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </div>
        
        {/* Home Indicator */}
        <div className="absolute bottom-[6px] left-1/2 -translate-x-1/2 w-32 h-1 bg-muted-foreground/50 rounded-full" />
        
        {/* Side buttons */}
        <div className="absolute left-[-2px] top-28 w-[3px] h-8 bg-muted-foreground/70 rounded-l-sm" />
        <div className="absolute left-[-2px] top-44 w-[3px] h-14 bg-muted-foreground/70 rounded-l-sm" />
        <div className="absolute left-[-2px] top-64 w-[3px] h-14 bg-muted-foreground/70 rounded-l-sm" />
        <div className="absolute right-[-2px] top-36 w-[3px] h-20 bg-muted-foreground/70 rounded-r-sm" />
      </div>
    </div>
  );
}
