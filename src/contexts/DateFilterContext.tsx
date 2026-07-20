import React, { createContext, useContext, useState, useMemo, ReactNode } from 'react';

interface DateRange {
  from: Date;
  to: Date;
}

interface DateFilterContextType {
  dateRange: DateRange;
  setDateRange: (range: DateRange) => void;
  startDate: string;
  endDate: string;
  // Source filtering
  sourceFilter: string[];
  setSourceFilter: (sources: string[]) => void;
  availableSources: string[];
  setAvailableSources: (sources: string[]) => void;
}

const DateFilterContext = createContext<DateFilterContextType | undefined>(undefined);

export function DateFilterProvider({ children }: { children: ReactNode }) {
  // Default to "yesterday" in the Meta ad-account reporting timezone
  // (America/Los_Angeles). Using the browser TZ can shift the date by a
  // day for viewers outside PT and cause the dashboard to disagree with
  // Ads Manager. See mem://architecture/reporting/meta-ads-compliance-and-logging.
  const AD_TZ = 'America/Los_Angeles';
  const partsInTz = (d: Date) => {
    const p = new Intl.DateTimeFormat('en-CA', {
      timeZone: AD_TZ,
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(d).reduce<Record<string, string>>((a, x) => {
      if (x.type !== 'literal') a[x.type] = x.value;
      return a;
    }, {});
    return { y: Number(p.year), m: Number(p.month), d: Number(p.day) };
  };
  const now = new Date();
  const { y, m, d } = partsInTz(now);
  // Build a Date whose local Y/M/D match yesterday-in-PT; time-of-day is
  // irrelevant because we format via formatLocalDate below.
  const yesterday = new Date(y, m - 1, d - 1);

  const [dateRange, setDateRange] = useState<DateRange>({
    from: yesterday,
    to: yesterday,
  });

  // Source filter state
  const [sourceFilter, setSourceFilter] = useState<string[]>([]);
  const [availableSources, setAvailableSources] = useState<string[]>([]);

  // Format dates for SQL queries using local timezone (not UTC)
  const formatLocalDate = (date: Date): string => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const startDate = useMemo(() => formatLocalDate(dateRange.from), [dateRange.from]);
  const endDate = useMemo(() => formatLocalDate(dateRange.to), [dateRange.to]);

  return (
    <DateFilterContext.Provider value={{ 
      dateRange, 
      setDateRange, 
      startDate, 
      endDate,
      sourceFilter,
      setSourceFilter,
      availableSources,
      setAvailableSources,
    }}>
      {children}
    </DateFilterContext.Provider>
  );
}

export function useDateFilter() {
  const context = useContext(DateFilterContext);
  if (context === undefined) {
    throw new Error('useDateFilter must be used within a DateFilterProvider');
  }
  return context;
}
