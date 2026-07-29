import { Client } from '@/hooks/useClients';
import { ClientMRRSettings, calculateClientRevenue } from '@/hooks/useClientMRR';
import { ClientSettings, getEffectiveMonthlyTarget } from '@/hooks/useClientSettings';
import { useAgencyCostOfCapital } from '@/hooks/useAgencyPerformance';
import { Sparkline } from './Sparkline';
import { Card, CardContent } from '@/components/ui/card';
import { Users, UserCheck, Pause, DollarSign, TrendingUp, Target, Percent } from 'lucide-react';

interface AgencyStatsBarProps {
  clients: Client[];
  clientMRRSettings: Record<string, ClientMRRSettings>;
  clientAdSpends: Record<string, number>;
  clientFullSettings?: Record<string, ClientSettings>;
  isAdmin?: boolean;
}

export function AgencyStatsBar({ 
  clients, 
  clientMRRSettings,
  clientAdSpends,
  clientFullSettings = {},
  isAdmin = false,
}: AgencyStatsBarProps) {
  const activeClients = clients.filter(c => c.status === 'active').length;
  const onboardingClients = clients.filter(c => c.status === 'onboarding').length;
  const pausedClients = clients.filter(c => c.status === 'paused' || c.status === 'on_hold').length;
  
  const { costOfCapital, sparkline, isLoading: cocLoading } = useAgencyCostOfCapital();

  // Calculate total MRR with actual ad spend fees (current performance)
  const activeClientsForRevenue = clients.filter(c => c.status === 'active');
  
  let totalMRR = 0;
  for (const client of activeClientsForRevenue) {
    const settings = clientMRRSettings[client.id] || {
      mrr: 0,
      ad_spend_fee_threshold: 30000,
      ad_spend_fee_percent: 10,
    };
    const adSpend = clientAdSpends[client.id] || 0;
    totalMRR += calculateClientRevenue(
      settings.mrr,
      adSpend,
      settings.ad_spend_fee_threshold,
      settings.ad_spend_fee_percent
    );
  }
  
  // Calculate estimated monthly revenue based on targets
  let estimatedMonthlyRevenue = 0;
  for (const client of activeClientsForRevenue) {
    const fullSettings = clientFullSettings[client.id];
    if (fullSettings) {
      const monthlyTarget = getEffectiveMonthlyTarget(fullSettings);
      estimatedMonthlyRevenue += calculateClientRevenue(
        fullSettings.mrr || 0,
        monthlyTarget,
        fullSettings.ad_spend_fee_threshold || 30000,
        fullSettings.ad_spend_fee_percent || 10
      );
    }
  }
  
  const projectedAnnual = estimatedMonthlyRevenue * 12;

  const formatCurrency = (val: number) =>
    `$${val.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

  // Base stats visible to all
  const baseStats = [
    {
      label: 'Active Clients',
      value: activeClients.toString(),
      icon: UserCheck,
      color: 'text-chart-2' as const,
    },
    {
      label: 'Onboarding',
      value: onboardingClients.toString(),
      icon: Users,
      color: 'text-primary' as const,
    },
    {
      label: 'On Hold / Paused',
      value: pausedClients.toString(),
      icon: Pause,
      color: 'text-muted-foreground' as const,
    },
  ];

  // Revenue stats only visible to admins
  const revenueStats = [
    {
      label: 'Current MRR',
      value: formatCurrency(totalMRR),
      icon: DollarSign,
      color: 'text-chart-2' as const,
    },
    {
      label: 'Est. Monthly Rev',
      value: formatCurrency(estimatedMonthlyRevenue),
      icon: Target,
      color: 'text-primary' as const,
    },
    {
      label: 'Projected Annual',
      value: formatCurrency(projectedAnnual),
      icon: TrendingUp,
      color: 'text-chart-2' as const,
    },
  ];

  const stats = isAdmin ? [...baseStats, ...revenueStats] : baseStats;

  return (
    <div className="grid grid-cols-3 lg:grid-cols-6 xl:grid-cols-7 gap-4 mb-4">
      {stats.map((stat) => (
        <Card key={stat.label} className="border-2">
          <CardContent className="p-4 flex items-center gap-3">
            <stat.icon className={`h-8 w-8 ${stat.color}`} />
            <div>
              <p className="text-2xl font-bold tabular-nums">{stat.value}</p>
              <p className="text-xs text-muted-foreground">{stat.label}</p>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
