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
  // Default to last 7 days (ending yesterday, since today is partial)
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const sevenDaysAgo = new Date(yesterday);
  sevenDaysAgo.setDate(yesterday.getDate() - 6);

  const [dateRange, setDateRange] = useState<DateRange>({
    from: sevenDaysAgo,
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
