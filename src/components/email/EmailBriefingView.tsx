import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Sparkles, Loader2, RefreshCw, AlertCircle, MailQuestion, Flame } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';

export function EmailBriefingView() {
  const [briefing, setBriefing] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  async function load() {
    setLoading(true);
    const { data } = await supabase.from('email_briefings').select('*').order('briefing_date', { ascending: false }).limit(1).maybeSingle();
    setBriefing(data);
    setLoading(false);
  }

  async function refresh() {
    setRefreshing(true);
    try {
      await supabase.functions.invoke('email-briefing', { body: {} });
      toast.success('Briefing regenerated');
      load();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => { load(); }, []);

  if (loading) return <div className="py-20 text-center"><Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" /></div>;

  if (!briefing) {
    return (
      <Card>
        <CardContent className="py-16 text-center text-muted-foreground">
          <Sparkles className="h-10 w-10 mx-auto mb-3 opacity-40" />
          <p>No briefing yet. The daily briefing runs at 7am PST.</p>
          <Button onClick={refresh} disabled={refreshing} className="mt-4 gap-2">
            {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Generate now
          </Button>
        </CardContent>
      </Card>
    );
  }

  const m = briefing.metrics || {};

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm text-muted-foreground">{format(new Date(briefing.briefing_date), 'EEEE, MMMM d')}</div>
          <h2 className="text-xl font-semibold">Today's executive briefing</h2>
        </div>
        <Button onClick={refresh} disabled={refreshing} variant="outline" size="sm" className="gap-2">
          {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Regenerate
        </Button>
      </div>

      {briefing.summary && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="pt-5">
            <div className="flex gap-3">
              <Sparkles className="h-5 w-5 text-primary shrink-0 mt-0.5" />
              <p className="text-sm leading-relaxed">{briefing.summary}</p>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <KPI label="Inbox" value={m.inbox_count ?? 0} />
        <KPI label="Needs reply" value={m.requires_response ?? 0} accent="text-amber-500" />
        <KPI label="High priority" value={m.high_priority ?? 0} accent="text-red-500" />
        <KPI label="Auto-archived" value={m.auto_archived ?? 0} accent="text-emerald-500" />
        <KPI label="Inbox Zero" value={`${m.inbox_zero_pct ?? 0}%`} accent="text-primary" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ListCard icon={<Flame className="h-4 w-4 text-red-500" />} title="Top priority" items={briefing.top_emails || []} />
        <ListCard icon={<MailQuestion className="h-4 w-4 text-amber-500" />} title="Pending replies" items={briefing.pending_replies || []} />
      </div>

      {(briefing.urgent_items || []).length > 0 && (
        <ListCard icon={<AlertCircle className="h-4 w-4 text-red-500" />} title="Urgent — needs your attention" items={briefing.urgent_items} />
      )}
    </div>
  );
}

function KPI({ label, value, accent }: { label: string; value: any; accent?: string }) {
  return (
    <Card className="p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-2xl font-semibold mt-1 ${accent || ''}`}>{value}</div>
    </Card>
  );
}

function ListCard({ icon, title, items }: { icon: React.ReactNode; title: string; items: any[] }) {
  return (
    <Card>
      <CardHeader className="pb-3"><CardTitle className="text-sm font-medium flex items-center gap-2">{icon} {title}</CardTitle></CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <div className="text-sm text-muted-foreground py-4">Nothing here.</div>
        ) : (
          <div className="space-y-2.5">
            {items.map((it: any) => (
              <div key={it.id} className="text-sm">
                <div className="font-medium truncate">{it.subject}</div>
                <div className="text-xs text-muted-foreground truncate">{it.from} · {it.classification?.replace(/_/g, ' ')}</div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}