import { useState, useMemo } from 'react';
import { Client } from '@/hooks/useClients';
import { AggregatedMetrics } from '@/hooks/useMetrics';
import { ClientSettings } from '@/hooks/useClientSettings';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { AlertTriangle, CheckCircle, Calendar, Unplug, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

interface DataHealthSummaryProps {
  clients: Client[];
  metrics: Record<string, AggregatedMetrics>;
  fullSettings: Record<string, ClientSettings>;
}

interface HealthCategory {
  key: string;
  label: string;
  clients: string[];
  color: 'red' | 'yellow' | 'gray' | 'green';
  icon: React.ReactNode;
}

export function DataHealthSummary({ clients, metrics, fullSettings }: DataHealthSummaryProps) {
  const [openCategory, setOpenCategory] = useState<string | null>(null);

  const categories = useMemo(() => {
    const adSpendNoCRM: string[] = [];
    const leadsNoCalls: string[] = [];
    const noMeta: string[] = [];
    const noGHL: string[] = [];
    const healthy: string[] = [];

    for (const client of clients) {
      const m = metrics[client.id];
      const settings = fullSettings[client.id];
      const hasGHL = !!(client.ghl_api_key && client.ghl_location_id);
      const hasMeta = !!client.meta_ad_account_id;
      const hasCalendars = !!(settings?.tracked_calendar_ids?.length && settings.tracked_calendar_ids.length > 0);

      // Check for missing integrations first
      if (!hasMeta && !hasGHL) {
        noMeta.push(client.name); // will also count in noGHL check below -- but we group them
        continue;
      }

      if (!hasMeta) {
        noMeta.push(client.name);
        continue;
      }

      if (!hasGHL) {
        noGHL.push(client.name);
        continue;
      }

      // Both integrations configured -- check data flow
      const adSpend = m?.totalAdSpend ?? 0;
      const crmLeads = m?.crmLeads ?? 0;
      const totalCalls = m?.totalCalls ?? 0;

      if (adSpend > 0 && crmLeads === 0) {
        adSpendNoCRM.push(client.name);
      } else if (crmLeads > 0 && totalCalls === 0) {
        leadsNoCalls.push(client.name);
      } else {
        healthy.push(client.name);
      }
    }

    const result: HealthCategory[] = [];

    if (adSpendNoCRM.length > 0) {
      result.push({
        key: 'no-crm',
        label: `${adSpendNoCRM.length} client${adSpendNoCRM.length === 1 ? '' : 's'} with ad spend but no CRM leads`,
        clients: adSpendNoCRM,
        color: 'red',
        icon: <AlertTriangle className="h-3 w-3" />,
      });
    }

    if (leadsNoCalls.length > 0) {
      result.push({
        key: 'no-calls',
        label: `${leadsNoCalls.length} client${leadsNoCalls.length === 1 ? '' : 's'} with leads but no calls`,
        clients: leadsNoCalls,
        color: 'yellow',
        icon: <Calendar className="h-3 w-3" />,
      });
    }

    const notConfigured = [...new Set([...noMeta, ...noGHL])];
    if (notConfigured.length > 0) {
      result.push({
        key: 'not-configured',
        label: `${notConfigured.length} not configured`,
        clients: notConfigured,
        color: 'gray',
        icon: <Unplug className="h-3 w-3" />,
      });
    }

    if (healthy.length > 0) {
      result.push({
        key: 'healthy',
        label: `${healthy.length} healthy`,
        clients: healthy,
        color: 'green',
        icon: <CheckCircle className="h-3 w-3" />,
      });
    }

    return result;
  }, [clients, metrics, fullSettings]);

  // Only show if there are issues (non-healthy categories)
  const hasIssues = categories.some(c => c.color !== 'green');
  if (!hasIssues) return null;

  const colorClasses: Record<string, string> = {
    red: 'bg-red-500/15 text-red-400 border-red-500/30 hover:bg-red-500/25',
    yellow: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30 hover:bg-yellow-500/25',
    gray: 'bg-muted/50 text-muted-foreground border-border hover:bg-muted/70',
    green: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/25',
  };

  return (
    <div className="flex flex-wrap items-start gap-2 mb-3">
      {categories.map((cat) => (
        <Collapsible
          key={cat.key}
          open={openCategory === cat.key}
          onOpenChange={(open) => setOpenCategory(open ? cat.key : null)}
        >
          <CollapsibleTrigger asChild>
            <Badge
              className={cn(
                'cursor-pointer select-none gap-1.5 text-xs font-medium px-2.5 py-1 border transition-colors',
                colorClasses[cat.color]
              )}
            >
              {cat.icon}
              {cat.label}
              <ChevronDown
                className={cn(
                  'h-3 w-3 transition-transform',
                  openCategory === cat.key && 'rotate-180'
                )}
              />
            </Badge>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="mt-1.5 ml-1 rounded-md border border-border bg-card/80 px-3 py-2 text-xs text-muted-foreground space-y-0.5 max-w-xs">
              {cat.clients.map((name) => (
                <div key={name} className="truncate">{name}</div>
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>
      ))}
    </div>
  );
}
