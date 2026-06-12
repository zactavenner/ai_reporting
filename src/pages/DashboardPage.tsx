import { useMemo } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { format, subDays, startOfWeek, startOfMonth } from 'date-fns';
import { Users, FolderOpen, ImageIcon, Briefcase, TrendingUp, Film, User, Palette, LayoutGrid, Video, ArrowRight, Sparkles, Zap, Scissors } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { StatCardSkeletonGrid } from '@/components/ui/LoadingSkeletons';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from 'recharts';

const PIE_COLORS = [
  'hsl(var(--primary))',
  'hsl(220, 70%, 55%)',
  'hsl(160, 60%, 45%)',
  'hsl(30, 80%, 55%)',
  'hsl(280, 60%, 55%)',
];

const quickActions = [
  { label: 'New Client', description: 'Set up a new brand', icon: Users, path: '/?new=1', color: 'from-rose-500/20 to-pink-500/20' },
  { label: 'Generate Ad', description: 'Create static ad variations', icon: LayoutGrid, path: '/static-ads', color: 'from-indigo-500/20 to-purple-500/20' },
  { label: 'Record B-Roll', description: 'AI video generation', icon: Film, path: '/broll', color: 'from-emerald-500/20 to-teal-500/20' },
  { label: 'Open Video Editor', description: 'Edit & combine clips', icon: Scissors, path: '/video-editor', color: 'from-amber-500/20 to-orange-500/20' },
];

export default function DashboardPage() {
  const navigate = useNavigate();

  const { data: clients = [], isLoading: clientsLoading } = useQuery({
    queryKey: ['dashboard-clients'],
    queryFn: async () => {
      const { data } = await supabase.from('clients').select('id, name');
      return data || [];
    },
  });

  const { data: projects = [] } = useQuery({
    queryKey: ['dashboard-projects'],
    queryFn: async () => {
      const { data } = await supabase.from('projects').select('id');
      return data || [];
    },
  });

  const { data: avatars = [] } = useQuery({
    queryKey: ['dashboard-avatars'],
    queryFn: async () => {
      const { data } = await supabase.from('avatars').select('id');
      return data || [];
    },
  });

  const { data: assets = [], isLoading: assetsLoading } = useQuery({
    queryKey: ['dashboard-assets'],
    queryFn: async () => {
      const { data } = await supabase
        .from('assets')
        .select('id, type, client_id, created_at, public_url, name, metadata')
        .order('created_at', { ascending: false })
        .limit(500);
      return data || [];
    },
  });

  const { data: batchJobs = [] } = useQuery({
    queryKey: ['dashboard-batch-jobs'],
    queryFn: async () => {
      const { data } = await supabase
        .from('batch_jobs')
        .select('id, status')
        .in('status', ['pending', 'processing']);
      return data || [];
    },
  });

  const { data: apiUsage = [] } = useQuery({
    queryKey: ['dashboard-api-usage'],
    queryFn: async () => {
      const thirtyDaysAgo = subDays(new Date(), 30).toISOString();
      const { data } = await supabase
        .from('api_usage')
        .select('id, created_at, service')
        .gte('created_at', thirtyDaysAgo)
        .eq('success', true)
        .order('created_at', { ascending: false });
      return data || [];
    },
  });

  const now = new Date();
  const weekStart = startOfWeek(now);
  const monthStart = startOfMonth(now);

  const assetsThisWeek = assets.filter(a => new Date(a.created_at) >= weekStart).length;
  const assetsThisMonth = assets.filter(a => new Date(a.created_at) >= monthStart).length;

  const assetsByType = useMemo(() => {
    const counts: Record<string, number> = {};
    assets.forEach(a => {
      const type = a.type === 'image' ? 'Static Ads' : a.type === 'video' ? 'Videos' : a.type === 'avatar' ? 'Avatars' : a.type || 'Other';
      counts[type] = (counts[type] || 0) + 1;
    });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [assets]);

  const assetsByClient = useMemo(() => {
    const counts: Record<string, number> = {};
    assets.forEach(a => {
      const client = clients.find(c => c.id === a.client_id);
      const name = client?.name || 'Unassigned';
      counts[name] = (counts[name] || 0) + 1;
    });
    return Object.entries(counts)
      .map(([name, count]) => ({ name: name.length > 15 ? name.slice(0, 15) + '…' : name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }, [assets, clients]);

  const apiChartData = useMemo(() => {
    const dailyMap = new Map<string, number>();
    for (let i = 29; i >= 0; i--) {
      dailyMap.set(format(subDays(now, i), 'yyyy-MM-dd'), 0);
    }
    apiUsage.forEach(r => {
      const date = format(new Date(r.created_at), 'yyyy-MM-dd');
      if (dailyMap.has(date)) dailyMap.set(date, (dailyMap.get(date) || 0) + 1);
    });
    return Array.from(dailyMap.entries()).map(([date, calls]) => ({
      date: format(new Date(date), 'MMM d'),
      calls,
    }));
  }, [apiUsage]);

  const recentAssets = assets.slice(0, 5);
  const isLoading = clientsLoading || assetsLoading;

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Hero Welcome Section */}
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-primary/10 via-primary/5 to-transparent border border-border p-6 md:p-8">
          <div className="relative z-10">
            <div className="flex items-center gap-2 mb-2">
              <Sparkles className="h-6 w-6 text-primary" />
              <Badge variant="secondary" className="text-xs cursor-pointer" onClick={() => navigate('/dashboard')}>v5.0</Badge>
            </div>
            <h1 className="text-2xl md:text-3xl font-bold mb-1">Welcome to Capital Creative</h1>
            <p className="text-muted-foreground max-w-lg">
              Your AI-powered creative command center — <strong className="text-foreground">{clients.length}</strong> clients, <strong className="text-foreground">{avatars.length}</strong> avatars, and <strong className="text-foreground">{assets.length}</strong> assets ready to go.
            </p>
          </div>
          {/* Decorative elements */}
          <div className="absolute top-0 right-0 w-64 h-64 bg-primary/5 rounded-full -translate-y-1/2 translate-x-1/3 blur-3xl" />
          <div className="absolute bottom-0 left-1/2 w-48 h-48 bg-primary/5 rounded-full translate-y-1/2 blur-2xl" />
        </div>

        {/* Quick Actions */}
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
          {quickActions.map((action, i) => (
            <button
              key={action.label}
              onClick={() => navigate(action.path)}
              className="stagger-item group relative overflow-hidden rounded-xl border border-border bg-card p-4 text-left transition-all duration-200 hover:shadow-lg hover:-translate-y-0.5 hover:border-primary/50"
              style={{ animationDelay: `${i * 80}ms` }}
            >
              <div className={`absolute inset-0 bg-gradient-to-br ${action.color} opacity-0 group-hover:opacity-100 transition-opacity duration-300`} />
              <div className="relative z-10">
                <action.icon className="h-8 w-8 text-primary mb-3" />
                <h3 className="font-semibold text-sm">{action.label}</h3>
                <p className="text-xs text-muted-foreground mt-0.5">{action.description}</p>
              </div>
              <ArrowRight className="absolute bottom-4 right-4 h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 group-hover:translate-x-0 -translate-x-2 transition-all duration-200 z-10" />
            </button>
          ))}
        </div>

        {/* Quick Stats */}
        {isLoading ? (
          <StatCardSkeletonGrid count={4} />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { icon: Users, value: clients.length, label: 'Total Clients' },
              { icon: FolderOpen, value: projects.length, label: 'Total Projects' },
              { icon: ImageIcon, value: assets.length, label: 'Total Assets' },
              { icon: Briefcase, value: batchJobs.length, label: 'Active Batch Jobs' },
            ].map((stat, i) => (
              <Card key={stat.label} className="stagger-item" style={{ animationDelay: `${(i + 4) * 60}ms` }}>
                <CardContent className="flex items-center gap-4 p-6">
                  <div className="p-3 rounded-full bg-primary/10">
                    <stat.icon className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{stat.value}</p>
                    <p className="text-sm text-muted-foreground">{stat.label}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Period Stats */}
        <div className="grid gap-4 sm:grid-cols-3">
          {[
            { value: assetsThisWeek, label: 'This Week' },
            { value: assetsThisMonth, label: 'This Month' },
            { value: assets.length, label: 'All Time' },
          ].map((s) => (
            <Card key={s.label}>
              <CardContent className="p-6 text-center">
                <p className="text-3xl font-bold">{s.value}</p>
                <p className="text-sm text-muted-foreground">{s.label}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          {/* Assets by Type */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Assets by Type</CardTitle>
            </CardHeader>
            <CardContent>
              {assetsByType.length > 0 ? (
                <div className="h-[250px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={assetsByType}
                        cx="50%"
                        cy="50%"
                        labelLine={false}
                        label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                        outerRadius={80}
                        dataKey="value"
                      >
                        {assetsByType.map((_, i) => (
                          <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                        ))}
                      </Pie>
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <ImageIcon className="h-10 w-10 text-muted-foreground/30 mb-2" />
                  <p className="text-muted-foreground text-sm">No assets yet</p>
                  <Button variant="outline" size="sm" className="mt-3" onClick={() => navigate('/static-ads')}>
                    Create your first ad
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Assets by Client */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Assets by Client</CardTitle>
            </CardHeader>
            <CardContent>
              {assetsByClient.length > 0 ? (
                <div className="h-[250px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={assetsByClient} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis dataKey="name" tick={{ fontSize: 11 }} className="fill-muted-foreground" />
                      <YAxis tick={{ fontSize: 12 }} className="fill-muted-foreground" />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: 'hsl(var(--background))',
                          border: '1px solid hsl(var(--border))',
                          borderRadius: '8px',
                          fontSize: '12px',
                        }}
                      />
                      <Bar dataKey="count" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <Users className="h-10 w-10 text-muted-foreground/30 mb-2" />
                  <p className="text-muted-foreground text-sm">No client assets yet</p>
                  <Button variant="outline" size="sm" className="mt-3" onClick={() => navigate('/')}>
                    Add a client
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* API Usage Chart */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              API Usage (Last 30 Days)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[200px]">
              {apiChartData.some(d => d.calls > 0) ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={apiChartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} className="fill-muted-foreground" interval={4} />
                    <YAxis tick={{ fontSize: 12 }} className="fill-muted-foreground" />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'hsl(var(--background))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '8px',
                        fontSize: '12px',
                      }}
                    />
                    <Bar dataKey="calls" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-center py-12 text-muted-foreground">No API usage data yet</p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Recent Activity */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Zap className="h-4 w-4" />
              Recent Activity
            </CardTitle>
          </CardHeader>
          <CardContent>
            {recentAssets.length > 0 ? (
              <div className="space-y-1">
                {recentAssets.map((asset, i) => {
                  const client = clients.find(c => c.id === asset.client_id);
                  const assetLink = asset.client_id ? `/clients/${asset.client_id}` : '/history';
                  return (
                    <div
                      key={asset.id}
                      className="flex items-center gap-3 p-2.5 rounded-lg hover-row stagger-item cursor-pointer"
                      style={{ animationDelay: `${i * 60}ms` }}
                      onClick={() => navigate(assetLink)}
                    >
                      <div className="h-10 w-10 rounded-lg bg-muted overflow-hidden shrink-0">
                        {asset.public_url ? (
                          <img src={asset.public_url} alt="" className="h-full w-full object-cover" loading="lazy" />
                        ) : (
                          <div className="h-full w-full flex items-center justify-center">
                            <ImageIcon className="h-4 w-4 text-muted-foreground" />
                          </div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{asset.name || 'Generated Asset'}</p>
                        <p className="text-xs text-muted-foreground">
                          {client?.name || 'Unassigned'} • {format(new Date(asset.created_at), 'MMM d, h:mm a')}
                        </p>
                      </div>
                      <Badge variant="secondary" className="text-xs shrink-0">
                        {asset.type}
                      </Badge>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Zap className="h-10 w-10 text-muted-foreground/30 mb-2" />
                <p className="text-muted-foreground text-sm">No recent activity</p>
                <p className="text-xs text-muted-foreground mt-1">Start generating ads to see activity here</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
