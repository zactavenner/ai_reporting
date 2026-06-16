import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Loader2 } from 'lucide-react';

export function EmailAnalyticsView() {
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { (async () => {
    const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
    const [{ data: emails }, { data: drafts }] = await Promise.all([
      supabase.from('emails').select('id,is_archived,auto_archived,classification,priority,received_at,responded_at,requires_response').gte('received_at', since),
      supabase.from('email_drafts').select('id,status,created_at,sent_at').gte('created_at', since),
    ]);
    const list = emails || [];
    const sent = (drafts || []).filter((d: any) => d.status === 'sent');
    const responseTimes = list
      .filter((e: any) => e.responded_at && e.received_at)
      .map((e: any) => (new Date(e.responded_at).getTime() - new Date(e.received_at).getTime()) / 3600000);
    const avgRespHrs = responseTimes.length ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length : 0;
    const active = list.filter((e: any) => !e.is_archived);
    setStats({
      received: list.length,
      autoArchived: list.filter((e: any) => e.auto_archived).length,
      spamRemoved: list.filter((e: any) => e.classification === 'spam').length,
      draftsGenerated: (drafts || []).length,
      draftsSent: sent.length,
      avgRespHrs: Math.round(avgRespHrs * 10) / 10,
      inboxZeroRate: list.length ? Math.round((1 - active.length / list.length) * 100) : 100,
      byClass: groupBy(list, 'classification'),
      byPriority: groupBy(list, 'priority'),
    });
    setLoading(false);
  })(); }, []);

  if (loading) return <div className="py-20 text-center"><Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" /></div>;

  return (
    <div className="space-y-4">
      <div className="text-sm text-muted-foreground">Last 7 days</div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Emails received" value={stats.received} />
        <Stat label="Auto-archived" value={stats.autoArchived} accent="text-emerald-500" />
        <Stat label="Spam removed" value={stats.spamRemoved} accent="text-red-500" />
        <Stat label="Drafts generated" value={stats.draftsGenerated} accent="text-primary" />
        <Stat label="Drafts sent" value={stats.draftsSent} />
        <Stat label="Avg response time" value={`${stats.avgRespHrs}h`} />
        <Stat label="Inbox Zero rate" value={`${stats.inboxZeroRate}%`} accent="text-primary" />
        <Stat label="Time saved" value={`${Math.round(stats.autoArchived * 0.5)} min`} accent="text-emerald-500" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Breakdown title="By classification" data={stats.byClass} />
        <Breakdown title="By priority" data={stats.byPriority} />
      </div>
    </div>
  );
}

function groupBy(list: any[], key: string) {
  const out: Record<string, number> = {};
  for (const it of list) {
    const k = it[key] || 'none';
    out[k] = (out[k] || 0) + 1;
  }
  return out;
}

function Stat({ label, value, accent }: any) {
  return (
    <Card className="p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-2xl font-semibold mt-1 ${accent || ''}`}>{value}</div>
    </Card>
  );
}

function Breakdown({ title, data }: { title: string; data: Record<string, number> }) {
  const total = Object.values(data).reduce((a, b) => a + b, 0) || 1;
  const entries = Object.entries(data).sort((a, b) => b[1] - a[1]);
  return (
    <Card className="p-4">
      <div className="text-sm font-medium mb-3">{title}</div>
      <div className="space-y-2">
        {entries.map(([k, v]) => (
          <div key={k} className="text-sm">
            <div className="flex justify-between mb-1">
              <span className="capitalize">{k.replace(/_/g, ' ')}</span>
              <span className="text-muted-foreground">{v}</span>
            </div>
            <div className="h-1.5 bg-muted rounded overflow-hidden">
              <div className="h-full bg-primary" style={{ width: `${(v / total) * 100}%` }} />
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}