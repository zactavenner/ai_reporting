import { format } from 'date-fns';
import { Calendar as CalendarIcon, Download, Plus, RefreshCw, Upload, Filter, X, Globe } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { useDateFilter } from '@/contexts/DateFilterContext';
import { useState, useEffect, useMemo } from 'react';
import { KNOWN_SOURCES, normalizeSource, getSourceColor } from '@/lib/sourceUtils';

interface DateRangeFilterProps {
  onExportCSV?: () => void;
  onAddClient?: () => void;
  onRefresh?: () => void;
  onImport?: () => void;
  showAddClient?: boolean;
  showImport?: boolean;
  compact?: boolean;
}

export function DateRangeFilter({ 
  onExportCSV, 
  onAddClient, 
  onRefresh, 
  onImport,
  showAddClient = true,
  showImport = false,
  compact = false,
}: DateRangeFilterProps) {
  const { dateRange, setDateRange, sourceFilter, setSourceFilter, availableSources } = useDateFilter();
  const [preset, setPreset] = useState('yesterday');
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [sourceSearch, setSourceSearch] = useState('');

  // Combine known sources with available sources from data
  const allSources = useMemo(() => {
    const combined = new Set([...KNOWN_SOURCES, ...availableSources]);
    return Array.from(combined).sort();
  }, [availableSources]);

  const filteredSources = useMemo(() => {
    if (!sourceSearch) return allSources;
    return allSources.filter(s => s.toLowerCase().includes(sourceSearch.toLowerCase()));
  }, [allSources, sourceSearch]);

  const handleSourceToggle = (source: string, checked: boolean) => {
    if (checked) {
      setSourceFilter([...sourceFilter, source]);
    } else {
      setSourceFilter(sourceFilter.filter(s => s !== source));
    }
  };

  const clearSourceFilters = () => {
    setSourceFilter([]);
  };

  // Determine current preset based on actual date range
  const currentPreset = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const from = new Date(dateRange.from);
    from.setHours(0, 0, 0, 0);
    const to = new Date(dateRange.to);
    to.setHours(0, 0, 0, 0);
    
    // Check each preset
    const daysDiff = Math.round((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24));
    const isToday = to.getTime() === today.getTime();
    
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    const isYesterday = to.getTime() === yesterday.getTime();
    
    if (isToday && from.getTime() === today.getTime()) return 'today';
    if (from.getTime() === yesterday.getTime() && isYesterday) return 'yesterday';
    
    if (isYesterday && daysDiff === 7) return 'last7';
    if (isYesterday && daysDiff === 14) return 'last14';
    if (isYesterday && daysDiff === 30) return 'last30';
    if (isYesterday && daysDiff === 90) return 'last90';
    
    const thisMonthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    if (from.getTime() === thisMonthStart.getTime() && isYesterday) return 'thisMonth';
    
    const lastMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const lastMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0);
    if (from.getTime() === lastMonthStart.getTime() && to.getTime() === lastMonthEnd.getTime()) return 'lastMonth';
    
    const yearStart = new Date(today.getFullYear(), 0, 1);
    if (from.getTime() === yearStart.getTime() && isYesterday) return 'ytd';
    
    // Check for "all" - very old start date
    const allStartDate = new Date(2020, 0, 1);
    if (from.getTime() <= allStartDate.getTime() && isYesterday) return 'all';
    
    return 'custom';
  }, [dateRange]);

  // Keep preset state in sync with actual computed preset
  useEffect(() => {
    if (currentPreset !== 'custom') {
      setPreset(currentPreset);
    }
  }, [currentPreset]);

  const handlePresetChange = (value: string) => {
    setPreset(value);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    let from = new Date(today);
    let to = new Date(today);
    
    switch (value) {
      case 'today':
        // from and to already set to today
        break;
      case 'yesterday':
        from = new Date(yesterday);
        to = new Date(yesterday);
        break;
      case 'last7':
        from = new Date(yesterday);
        from.setDate(yesterday.getDate() - 6);
        to = new Date(yesterday);
        break;
      case 'last14':
        from = new Date(yesterday);
        from.setDate(yesterday.getDate() - 13);
        to = new Date(yesterday);
        break;
      case 'last30':
        from = new Date(yesterday);
        from.setDate(yesterday.getDate() - 29);
        to = new Date(yesterday);
        break;
      case 'last90':
        from = new Date(yesterday);
        from.setDate(yesterday.getDate() - 89);
        to = new Date(yesterday);
        break;
      case 'thisMonth':
        from = new Date(today.getFullYear(), today.getMonth(), 1);
        to = new Date(yesterday);
        break;
      case 'lastMonth':
        from = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        to = new Date(today.getFullYear(), today.getMonth(), 0);
        break;
      case 'ytd':
        from = new Date(today.getFullYear(), 0, 1);
        to = new Date(yesterday);
        break;
      case 'all':
        // Set to a very old date to show all data
        from = new Date(2020, 0, 1);
        to = new Date(yesterday);
        break;
    }
    
    setDateRange({ from, to });
  };

  const handleCalendarSelect = (range: { from?: Date; to?: Date } | undefined) => {
    if (range?.from && range?.to) {
      setPreset('custom');
      setDateRange({ from: range.from, to: range.to });
      setCalendarOpen(false);
    } else if (range?.from) {
      // Partial selection - wait for complete range
    }
  };

  return (
    <div className={compact ? '' : 'border-2 border-border bg-card p-4'}>
      {!compact && (
        <>
          <h2 className="font-bold text-lg mb-1">Filters & Actions</h2>
          <p className="text-sm text-muted-foreground mb-4">Select date range, filter by source, and export data</p>
        </>
      )}

      <div className={cn('flex flex-wrap items-center', compact ? 'gap-2' : 'gap-3')}>
        <Select value={currentPreset === 'custom' ? 'custom' : preset} onValueChange={handlePresetChange}>
          <SelectTrigger className={compact ? 'w-32 h-8 text-xs' : 'w-40'}>
            <SelectValue placeholder="Select range" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="today">Today</SelectItem>
            <SelectItem value="yesterday">Yesterday</SelectItem>
            <SelectItem value="last7">Last 7 Days</SelectItem>
            <SelectItem value="last14">Last 14 Days</SelectItem>
            <SelectItem value="last30">Last 30 Days</SelectItem>
            <SelectItem value="last90">Last 90 Days</SelectItem>
            <SelectItem value="thisMonth">This Month</SelectItem>
            <SelectItem value="lastMonth">Last Month</SelectItem>
            <SelectItem value="ytd">Year to Date</SelectItem>
            <SelectItem value="all">All Time (Max)</SelectItem>
            {currentPreset === 'custom' && <SelectItem value="custom">Custom Range</SelectItem>}
          </SelectContent>
        </Select>

        <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size={compact ? 'sm' : 'default'}
              className={cn(
                'justify-start text-left font-normal',
                compact ? 'h-8 text-xs w-56' : 'w-64',
                !dateRange && 'text-muted-foreground'
              )}
            >
              <CalendarIcon className={compact ? 'mr-2 h-3.5 w-3.5' : 'mr-2 h-4 w-4'} />
              {dateRange?.from ? (
                dateRange.to ? (
                  <>
                    {format(dateRange.from, 'LLL dd, yyyy')} -{' '}
                    {format(dateRange.to, 'LLL dd, yyyy')}
                  </>
                ) : (
                  format(dateRange.from, 'LLL dd, yyyy')
                )
              ) : (
                <span>Pick a date range</span>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              initialFocus
              mode="range"
              defaultMonth={dateRange?.from}
              selected={dateRange}
              onSelect={handleCalendarSelect}
              numberOfMonths={2}
            />
          </PopoverContent>
        </Popover>

        {/* Source Filter Dropdown */}
        <Popover open={sourceOpen} onOpenChange={setSourceOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" size={compact ? 'sm' : 'default'} className={cn('gap-2', compact && 'h-8 text-xs')}>
              <Filter className={compact ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
              Source
              {sourceFilter.length > 0 && (
                <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">
                  {sourceFilter.length}
                </Badge>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-64 p-2" align="start">
            <Input 
              placeholder="Search sources..."
              value={sourceSearch}
              onChange={(e) => setSourceSearch(e.target.value)}
              className="mb-2 h-8 text-xs"
            />
            <div className="flex items-center justify-between mb-2 px-1">
              <button 
                onClick={() => setSourceFilter([...allSources])}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Select All
              </button>
              {sourceFilter.length > 0 && (
                <button 
                  onClick={clearSourceFilters}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  Clear
                </button>
              )}
            </div>
            <ScrollArea className="h-48">
              <div className="space-y-1">
                {filteredSources.map(source => (
                  <label 
                    key={source}
                    className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-muted cursor-pointer"
                  >
                    <Checkbox 
                      checked={sourceFilter.includes(source)}
                      onCheckedChange={(checked) => handleSourceToggle(source, !!checked)}
                    />
                    <span className="text-xs truncate flex-1">{source}</span>
                  </label>
                ))}
              </div>
            </ScrollArea>
          </PopoverContent>
        </Popover>

        {onRefresh && (
          <Button variant="outline" size={compact ? 'sm' : 'default'} className={compact ? 'h-8 text-xs' : ''} onClick={onRefresh}>
            <RefreshCw className={compact ? 'mr-1.5 h-3.5 w-3.5' : 'mr-2 h-4 w-4'} />
            Refresh
          </Button>
        )}

        {showImport && onImport && (
          <Button variant="outline" size={compact ? 'sm' : 'default'} className={compact ? 'h-8 text-xs' : ''} onClick={onImport}>
            <Upload className={compact ? 'mr-1.5 h-3.5 w-3.5' : 'mr-2 h-4 w-4'} />
            Import CSV
          </Button>
        )}

        {onExportCSV && (
          <Button variant="outline" size={compact ? 'sm' : 'default'} className={compact ? 'h-8 text-xs' : ''} onClick={onExportCSV}>
            <Download className={compact ? 'mr-1.5 h-3.5 w-3.5' : 'mr-2 h-4 w-4'} />
            Export CSV
          </Button>
        )}

        {showAddClient && onAddClient && (
          <Button size={compact ? 'sm' : 'default'} className={compact ? 'h-8 text-xs' : ''} onClick={onAddClient}>
            <Plus className={compact ? 'mr-1.5 h-3.5 w-3.5' : 'mr-2 h-4 w-4'} />
            Add Client
          </Button>
        )}
      </div>

      {/* Active Source Filter Chips */}
      {sourceFilter.length > 0 && (
        <div className={cn('flex flex-wrap items-center gap-2', compact ? 'mt-2' : 'mt-3 pt-3 border-t border-border')}>
          <span className="text-xs text-muted-foreground">Active filters:</span>
          {sourceFilter.map(source => (
            <Badge 
              key={source} 
              variant="outline"
              className={cn("gap-1 cursor-pointer", getSourceColor(source))}
              onClick={() => setSourceFilter(sourceFilter.filter(s => s !== source))}
            >
              {source}
              <X className="h-3 w-3" />
            </Badge>
          ))}
          <button 
            onClick={clearSourceFilters}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors ml-2"
          >
            Clear all
          </button>
        </div>
      )}
    </div>
  );
}
