import { useState, useEffect } from 'react';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2, Calendar, RefreshCw, AlertCircle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface GHLCalendar {
  id: string;
  name: string;
  description?: string;
  isActive?: boolean;
}

interface CalendarTrackingSectionProps {
  clientId: string;
  /** True when the client has GHL credentials saved server-side. The API key is never sent to the browser flow. */
  ghlConfigured?: boolean;
  trackedCalendarIds: string[];
  reconnectCalendarIds: string[];
  onTrackedChange: (ids: string[]) => void;
  onReconnectChange: (ids: string[]) => void;
}

export function CalendarTrackingSection({
  clientId,
  ghlConfigured,
  trackedCalendarIds,
  reconnectCalendarIds,
  onTrackedChange,
  onReconnectChange,
}: CalendarTrackingSectionProps) {
  const [calendars, setCalendars] = useState<GHLCalendar[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchCalendars = async () => {
    if (!ghlConfigured || !clientId) {
      setError('GHL credentials not configured');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Credentials stay server-side: we only send the client id. The edge
      // function loads the GHL key/location itself and validates results.
      const { data, error: fnError } = await supabase.functions.invoke('fetch-ghl-calendars', {
        body: { action: 'list', clientId },
      });

      if (fnError) {
        throw new Error(fnError.message || 'Failed to fetch calendars');
      }

      if (data?.error) {
        throw new Error(data.error);
      }

      setCalendars(data?.calendars || []);
      if (data?.calendars?.length > 0) {
        toast.success(`Loaded ${data.calendars.length} calendars from GHL`);
      }
    } catch (err) {
      console.error('Error fetching GHL calendars:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch calendars');
      toast.error('Failed to load calendars from GHL');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (ghlConfigured && clientId) {
      fetchCalendars();
    }
  }, [ghlConfigured, clientId]);

  const toggleTrackedCalendar = (calendarId: string) => {
    const newIds = trackedCalendarIds.includes(calendarId)
      ? trackedCalendarIds.filter(id => id !== calendarId)
      : [...trackedCalendarIds, calendarId];
    onTrackedChange(newIds);
  };

  const toggleReconnectCalendar = (calendarId: string) => {
    const newIds = reconnectCalendarIds.includes(calendarId)
      ? reconnectCalendarIds.filter(id => id !== calendarId)
      : [...reconnectCalendarIds, calendarId];
    onReconnectChange(newIds);
  };

  if (!ghlConfigured) {
    return (
      <div className="border-2 border-border p-4 bg-muted/20">
        <div className="flex items-center gap-2 text-muted-foreground">
          <AlertCircle className="h-4 w-4" />
          <span className="text-sm">Configure GHL credentials to enable calendar tracking</span>
        </div>
      </div>
    );
  }

  return (
    <div className="border-2 border-border p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="font-medium mb-1 flex items-center gap-2">
            <Calendar className="h-4 w-4" />
            Calendar Tracking
          </h4>
          <p className="text-sm text-muted-foreground">
            Select which calendars to track for booked calls and reconnect calls
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={fetchCalendars}
          disabled={loading}
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
        </Button>
      </div>

      {error && (
        <div className="p-3 border-2 border-destructive/20 bg-destructive/5 text-sm text-destructive">
          {error}
        </div>
      )}

      {loading && calendars.length === 0 ? (
        <div className="flex items-center justify-center py-4">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : calendars.length === 0 ? (
        <div className="text-sm text-muted-foreground py-2">
          No calendars found. Click refresh to try again.
        </div>
      ) : (
        <div className="space-y-4">
          {/* Booked Call Calendars */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Booked Call Calendars</Label>
            <p className="text-xs text-muted-foreground mb-2">
              Appointments from these calendars count as "Booked Calls"
            </p>
            <div className="grid gap-2 max-h-40 overflow-y-auto">
              {calendars.map(cal => (
                <div
                  key={`tracked-${cal.id}`}
                  className="flex items-center gap-2 p-2 border border-border rounded hover:bg-muted/50"
                >
                  <Checkbox
                    id={`tracked-${cal.id}`}
                    checked={trackedCalendarIds.includes(cal.id)}
                    onCheckedChange={() => toggleTrackedCalendar(cal.id)}
                  />
                  <label
                    htmlFor={`tracked-${cal.id}`}
                    className="flex-1 text-sm cursor-pointer"
                  >
                    {cal.name}
                  </label>
                  {trackedCalendarIds.includes(cal.id) && (
                    <Badge variant="default" className="text-xs">Selected</Badge>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Reconnect Call Calendars */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Reconnect Call Calendars</Label>
            <p className="text-xs text-muted-foreground mb-2">
              Appointments from these calendars count as "Reconnect Calls"
            </p>
            <div className="grid gap-2 max-h-40 overflow-y-auto">
              {calendars.map(cal => (
                <div
                  key={`reconnect-${cal.id}`}
                  className="flex items-center gap-2 p-2 border border-border rounded hover:bg-muted/50"
                >
                  <Checkbox
                    id={`reconnect-${cal.id}`}
                    checked={reconnectCalendarIds.includes(cal.id)}
                    onCheckedChange={() => toggleReconnectCalendar(cal.id)}
                  />
                  <label
                    htmlFor={`reconnect-${cal.id}`}
                    className="flex-1 text-sm cursor-pointer"
                  >
                    {cal.name}
                  </label>
                  {reconnectCalendarIds.includes(cal.id) && (
                    <Badge variant="secondary" className="text-xs">Reconnect</Badge>
                  )}
                </div>
              ))}
            </div>
          </div>

          {(trackedCalendarIds.length > 0 || reconnectCalendarIds.length > 0) && (
            <div className="p-3 bg-muted/30 border border-border text-sm">
              <strong>Selected:</strong> {trackedCalendarIds.length} booked calendar(s), {reconnectCalendarIds.length} reconnect calendar(s)
            </div>
          )}
        </div>
      )}
    </div>
  );
}
