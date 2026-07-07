import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Signal, Wifi, Battery } from 'lucide-react';
import type { DeviceType } from './DeviceSwitcher';
import type { LeadFormQuestion } from './LeadFormEditor';
import { generateCapitalOptions } from './LeadFormEditor';

interface FacebookLeadFormMockupProps {
  stepName?: string;
  deviceType: DeviceType;
  className?: string;
  questions?: LeadFormQuestion[];
}

export function FacebookLeadFormMockup({ stepName, deviceType, className, questions }: FacebookLeadFormMockupProps) {
  if (deviceType === 'desktop') {
    return <DesktopLeadForm stepName={stepName} className={className} questions={questions} />;
  }
  if (deviceType === 'tablet') {
    return <TabletLeadForm stepName={stepName} className={className} questions={questions} />;
  }
  return <PhoneLeadForm stepName={stepName} className={className} questions={questions} />;
}

function LeadFormContent({ questions }: { questions?: LeadFormQuestion[] }) {
  const hasCustom = !!(questions && questions.length > 0);
  return (
    <div className="w-full h-full bg-[#ffffff] flex flex-col text-[#1c1e21] overflow-y-auto">
      {/* FB Header */}
      <div className="bg-[#1877F2] px-4 py-3 flex items-center gap-2 flex-shrink-0">
        <svg viewBox="0 0 36 36" className="w-6 h-6 fill-white flex-shrink-0">
          <path d="M20.18 35.87C29.07 34.58 36 26.82 36 17.5 36 7.84 28.16 0 18.5 0S1 7.84 1 17.5c0 8.52 5.74 15.68 13.55 17.82V22.5h-3.93v-5h3.93V14c0-4.02 2.34-6.16 5.88-6.16 1.72 0 3.52.31 3.52.31v3.95h-1.98c-1.95 0-2.56 1.21-2.56 2.46v3.01h4.42l-.71 5h-3.71v13.31z" />
        </svg>
        <span className="text-white font-semibold text-sm">Instant Form</span>
      </div>

      {/* Form Content */}
      <div className="flex-1 px-4 py-3 space-y-3">
        <div className="flex items-center gap-2 pb-2 border-b border-[#dadde1]">
          <div className="w-10 h-10 rounded-full bg-[#e4e6eb] flex items-center justify-center">
            <svg viewBox="0 0 24 24" className="w-5 h-5 fill-[#65676b]">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"/>
            </svg>
          </div>
          <div>
            <p className="text-xs font-semibold text-[#1c1e21]">Investment Opportunity</p>
            <p className="text-[10px] text-[#65676b]">Sponsored · Learn More</p>
          </div>
        </div>

        <p className="text-xs text-[#65676b] leading-relaxed">
          Complete this form to learn more about this investment opportunity.
        </p>

        {hasCustom ? (
          questions!.map((q, qi) => {
            const opts = q.type === 'multiple_choice'
              ? q.options
              : q.type === 'capital'
              ? (q.options && q.options.length ? q.options : generateCapitalOptions(q.min_k))
              : null;
            const selectedIdx = opts ? Math.min(1, opts.length - 1) : -1;
            return (
              <div key={q.id} className="space-y-1.5">
                <label className="text-xs font-semibold text-[#1c1e21]">
                  {q.label}{q.required && <span className="text-[#e41e3f]"> *</span>}
                </label>
                {opts ? (
                  <div className="space-y-1.5">
                    {opts.map((opt, i) => (
                      <label
                        key={i}
                        className={cn(
                          "flex items-center gap-2 px-3 py-2 border rounded-lg cursor-default",
                          i === selectedIdx ? "border-[#1877F2] bg-[#e7f3ff]" : "border-[#dadde1]",
                        )}
                      >
                        <div className={cn(
                          "w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0",
                          i === selectedIdx ? "border-[#1877F2]" : "border-[#dadde1]",
                        )}>
                          {i === selectedIdx && <div className="w-2 h-2 rounded-full bg-[#1877F2]" />}
                        </div>
                        <span className="text-xs text-[#1c1e21]">{opt}</span>
                      </label>
                    ))}
                  </div>
                ) : (
                  <div className="px-3 py-2.5 border border-[#dadde1] rounded-lg bg-[#f0f2f5]">
                    <span className="text-xs text-[#65676b]">Short answer...</span>
                  </div>
                )}
              </div>
            );
          })
        ) : (
          <>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-[#1c1e21]">
                Are you an accredited investor? <span className="text-[#e41e3f]">*</span>
              </label>
              <div className="space-y-1.5">
                <label className="flex items-center gap-2 px-3 py-2.5 border border-[#1877F2] rounded-lg bg-[#e7f3ff] cursor-default">
                  <div className="w-4 h-4 rounded-full border-2 border-[#1877F2] flex items-center justify-center flex-shrink-0">
                    <div className="w-2 h-2 rounded-full bg-[#1877F2]" />
                  </div>
                  <span className="text-xs text-[#1c1e21]">Yes</span>
                </label>
                <label className="flex items-center gap-2 px-3 py-2.5 border border-[#dadde1] rounded-lg cursor-default">
                  <div className="w-4 h-4 rounded-full border-2 border-[#dadde1] flex-shrink-0" />
                  <span className="text-xs text-[#1c1e21]">No</span>
                </label>
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-[#1c1e21]">
                Available liquidity <span className="text-[#e41e3f]">*</span>
              </label>
              <div className="space-y-1.5">
                {['$50k or less', '$50k – $100k', '$100k – $250k', '$250k – $500k', '$500k – $1M', '$1M+'].map((range, i) => (
                  <label key={range} className={cn("flex items-center gap-2 px-3 py-2 border rounded-lg cursor-default", i === 3 ? "border-[#1877F2] bg-[#e7f3ff]" : "border-[#dadde1]")}>
                    <div className={cn("w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0", i === 3 ? "border-[#1877F2]" : "border-[#dadde1]")}>
                      {i === 3 && <div className="w-2 h-2 rounded-full bg-[#1877F2]" />}
                    </div>
                    <span className="text-xs text-[#1c1e21]">{range}</span>
                  </label>
                ))}
              </div>
            </div>
          </>
        )}

        {/* Prefill section */}
        <div className="pt-2 border-t border-[#dadde1]">
          <p className="text-[10px] text-[#65676b] mb-2">
            The following info was provided by Facebook. Please confirm your details.
          </p>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-semibold text-[#1c1e21]">Full name</label>
          <div className="px-3 py-2.5 border border-[#dadde1] rounded-lg bg-[#f0f2f5]">
            <span className="text-xs text-[#65676b]">John Smith</span>
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-semibold text-[#1c1e21]">Email</label>
          <div className="px-3 py-2.5 border border-[#dadde1] rounded-lg bg-[#f0f2f5]">
            <span className="text-xs text-[#65676b]">john.smith@email.com</span>
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-semibold text-[#1c1e21]">Phone number</label>
          <div className="px-3 py-2.5 border border-[#dadde1] rounded-lg bg-[#f0f2f5]">
            <span className="text-xs text-[#65676b]">(555) 123-4567</span>
          </div>
        </div>

        <p className="text-[9px] text-[#65676b] leading-relaxed">
          By clicking Submit, you agree that the business may contact you using the information provided.
          Read Facebook's <span className="text-[#1877F2]">Privacy Policy</span>.
        </p>
      </div>

      {/* Submit */}
      <div className="px-4 py-3 border-t border-[#dadde1] bg-white flex-shrink-0">
        <div className="w-full py-2.5 bg-[#1877F2] rounded-lg flex items-center justify-center">
          <span className="text-white font-semibold text-sm">Submit</span>
        </div>
      </div>
    </div>
  );
}

function PhoneLeadForm({ stepName, className, questions }: { stepName?: string; className?: string; questions?: LeadFormQuestion[] }) {
  return (
    <div className={cn("flex flex-col items-center", className)}>
      {stepName && (
        <h3 className="text-sm font-medium text-muted-foreground mb-2">{stepName}</h3>
      )}
      <div className="relative">
        {/* iPhone Frame */}
        <div className="relative bg-foreground rounded-[50px] p-[3px] shadow-2xl">
          <div className="bg-foreground/90 rounded-[48px] p-[2px]">
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
                  <Battery className="h-5 w-5 text-foreground" />
                </div>
              </div>

              {/* Screen Content */}
              <div className="w-[320px] h-[620px] overflow-hidden">
                <LeadFormContent questions={questions} />
              </div>

              {/* Safari Bottom Bar */}
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
                  <p className="text-xs text-muted-foreground truncate text-center">facebook.com</p>
                </div>
                <button className="p-2.5 bg-muted rounded-full">
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

function TabletLeadForm({ stepName, className, questions }: { stepName?: string; className?: string; questions?: LeadFormQuestion[] }) {
  return (
    <div className={cn("flex flex-col items-center", className)}>
      {stepName && (
        <h3 className="text-sm font-medium text-muted-foreground mb-2">{stepName}</h3>
      )}
      <div className="relative">
        <div className="relative bg-foreground rounded-[30px] p-[6px] shadow-2xl">
          <div className="relative bg-background rounded-[24px] overflow-hidden">
            {/* Camera */}
            <div className="absolute top-4 left-1/2 -translate-x-1/2 w-2 h-2 rounded-full bg-muted z-10" />

            {/* Status Bar */}
            <div className="h-8 bg-background flex items-center justify-between px-6 pt-2">
              <span className="text-xs font-semibold text-foreground">9:41</span>
              <div className="flex items-center gap-1">
                <Signal className="h-3 w-3 text-foreground" />
                <Wifi className="h-3 w-3 text-foreground" />
                <Battery className="h-4 w-4 text-foreground" />
              </div>
            </div>

            {/* Screen */}
            <div className="w-[500px] h-[680px] overflow-hidden">
              <LeadFormContent questions={questions} />
            </div>
          </div>
        </div>
        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 w-24 h-1 bg-muted-foreground/50 rounded-full" />
      </div>
    </div>
  );
}

function DesktopLeadForm({ stepName, className, questions }: { stepName?: string; className?: string; questions?: LeadFormQuestion[] }) {
  return (
    <div className={cn("flex flex-col items-center", className)}>
      {stepName && (
        <h3 className="text-sm font-medium text-muted-foreground mb-2">{stepName}</h3>
      )}
      <div className="relative">
        <div className="bg-foreground rounded-t-xl p-[2px] pb-0">
          <div className="bg-background rounded-t-lg overflow-hidden">
            {/* Browser chrome */}
            <div className="h-8 bg-muted flex items-center px-3 gap-1.5">
              <div className="w-2.5 h-2.5 rounded-full bg-destructive/60" />
              <div className="w-2.5 h-2.5 rounded-full bg-yellow-400/60" />
              <div className="w-2.5 h-2.5 rounded-full bg-green-400/60" />
              <div className="ml-3 flex-1 max-w-[300px] h-5 bg-background rounded-md flex items-center px-2">
                <span className="text-[10px] text-muted-foreground truncate">facebook.com/lead-form</span>
              </div>
            </div>
            {/* Screen */}
            <div className="w-[700px] h-[500px] overflow-hidden">
              <LeadFormContent questions={questions} />
            </div>
          </div>
        </div>
        {/* Stand */}
        <div className="mx-auto w-[200px] h-4 bg-foreground rounded-b-lg" />
        <div className="mx-auto w-[280px] h-2 bg-foreground/80 rounded-b-lg" />
      </div>
    </div>
  );
}
