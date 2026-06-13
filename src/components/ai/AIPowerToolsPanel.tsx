import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Loader2, TrendingDown, Sparkles, ListChecks, Search, DollarSign, RefreshCw, Telescope } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import ReactMarkdown from 'react-markdown';

function useFn() {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<any>(null);
  const call = async (name: string, body: any) => {
    setLoading(true); setData(null);
    try {
      const { data: d, error } = await supabase.functions.invoke(name, { body });
      if (error) throw error;
      if (d?.error) throw new Error(d.error);
      setData(d);
    } catch (e: any) {
      toast({ title: `${name} failed`, description: e.message, variant: 'destructive' });
    } finally { setLoading(false); }
  };
  return { loading, data, call };
}

function ClientPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [clients, setClients] = useState<any[]>([]);
  useState(() => { supabase.from('clients').select('id,name').in('status', ['active','onboarding','paused']).order('name').then(({ data }) => setClients(data || [])); return null; });
  return (
    <select value={value} onChange={e => onChange(e.target.value)} className="border rounded px-2 py-1 text-sm bg-background">
      <option value="">— select client —</option>
      {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
    </select>
  );
}

export function AIPowerToolsPanel() {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 mb-4">
        <Sparkles className="h-5 w-5 text-primary" />
        <h2 className="text-lg font-semibold">AI Power Tools</h2>
      </div>
      <Tabs defaultValue="alerts">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="alerts"><TrendingDown className="h-3.5 w-3.5 mr-1"/>Predictive Alerts</TabsTrigger>
          <TabsTrigger value="spin"><RefreshCw className="h-3.5 w-3.5 mr-1"/>Spin Winners</TabsTrigger>
          <TabsTrigger value="score"><ListChecks className="h-3.5 w-3.5 mr-1"/>Score Creative</TabsTrigger>
          <TabsTrigger value="search"><Search className="h-3.5 w-3.5 mr-1"/>Smart Search</TabsTrigger>
          <TabsTrigger value="budget"><DollarSign className="h-3.5 w-3.5 mr-1"/>Budget Optimizer</TabsTrigger>
          <TabsTrigger value="crm"><Sparkles className="h-3.5 w-3.5 mr-1"/>Auto-CRM</TabsTrigger>
          <TabsTrigger value="intel"><Telescope className="h-3.5 w-3.5 mr-1"/>Competitor Intel</TabsTrigger>
        </TabsList>

        <TabsContent value="alerts" className="mt-4"><PredictiveAlerts/></TabsContent>
        <TabsContent value="spin" className="mt-4"><SpinWinners/></TabsContent>
        <TabsContent value="score" className="mt-4"><ScoreCreative/></TabsContent>
        <TabsContent value="search" className="mt-4"><SmartSearch/></TabsContent>
        <TabsContent value="budget" className="mt-4"><BudgetOpt/></TabsContent>
        <TabsContent value="crm" className="mt-4"><AutoCRM/></TabsContent>
        <TabsContent value="intel" className="mt-4"><CompetitorIntel/></TabsContent>
      </Tabs>
    </Card>
  );
}

function PredictiveAlerts() {
  const { loading, data, call } = useFn();
  return (
    <div className="space-y-3">
      <Button onClick={() => call('predictive-alerts', {})} disabled={loading}>
        {loading ? <Loader2 className="h-4 w-4 mr-1 animate-spin"/> : null}Run scan
      </Button>
      {data && (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">{data.count} risks detected</p>
          {data.summary && <Card className="p-3 bg-muted/30"><ReactMarkdown>{data.summary}</ReactMarkdown></Card>}
          <div className="space-y-2">
            {(data.alerts || []).map((a: any, i: number) => (
              <Card key={i} className="p-3 flex items-start gap-3">
                <Badge variant={a.severity === 'critical' ? 'destructive' : 'secondary'}>{a.risk}%</Badge>
                <div className="flex-1">
                  <p className="text-sm font-semibold">{a.client_name} — {a.label}</p>
                  <p className="text-xs text-muted-foreground">{a.forecast}</p>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function SpinWinners() {
  const [adId, setAdId] = useState('');
  const [count, setCount] = useState(5);
  const { loading, data, call } = useFn();
  return (
    <div className="space-y-3">
      <div className="flex gap-2 items-center flex-wrap">
        <Input placeholder="meta_ads.id (uuid)" value={adId} onChange={e=>setAdId(e.target.value)} className="max-w-sm"/>
        <Input type="number" min={1} max={10} value={count} onChange={e=>setCount(+e.target.value)} className="w-20"/>
        <Button onClick={()=>call('creative-spin-winners', { ad_id: adId, count })} disabled={!adId || loading}>
          {loading ? <Loader2 className="h-4 w-4 mr-1 animate-spin"/> : null}Generate
        </Button>
      </div>
      {data?.variations && (
        <div className="grid md:grid-cols-2 gap-2">
          {data.variations.map((v: any, i: number) => (
            <Card key={i} className="p-3 space-y-1">
              <p className="text-xs text-muted-foreground">{v.angle}</p>
              <p className="font-semibold">{v.headline}</p>
              <p className="text-sm">{v.body}</p>
              <Badge variant="outline" className="text-xs">{v.cta}</Badge>
              <p className="text-xs text-muted-foreground italic">{v.reason}</p>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function ScoreCreative() {
  const [adId, setAdId] = useState('');
  const { loading, data, call } = useFn();
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Input placeholder="meta_ads.id" value={adId} onChange={e=>setAdId(e.target.value)} className="max-w-sm"/>
        <Button onClick={()=>call('score-creative', { ad_id: adId })} disabled={!adId || loading}>
          {loading ? <Loader2 className="h-4 w-4 mr-1 animate-spin"/> : null}Score
        </Button>
      </div>
      {data?.score && (
        <Card className="p-4 space-y-2">
          <div className="grid grid-cols-5 gap-2 text-center">
            {(['hook','clarity','cta','compliance','overall'] as const).map(k => (
              <div key={k}>
                <p className="text-3xl font-bold text-primary">{data.score[k]}</p>
                <p className="text-xs text-muted-foreground capitalize">{k}</p>
              </div>
            ))}
          </div>
          <p className="text-sm">{data.score.verdict}</p>
          {data.score.fixes && <ul className="text-xs list-disc pl-4 space-y-1">{data.score.fixes.map((f: string, i: number) => <li key={i}>{f}</li>)}</ul>}
        </Card>
      )}
    </div>
  );
}

function SmartSearch() {
  const [q, setQ] = useState('');
  const [client, setClient] = useState('');
  const { loading, data, call } = useFn();
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <ClientPicker value={client} onChange={setClient}/>
        <Input placeholder="e.g. 'leads concerned about taxes'" value={q} onChange={e=>setQ(e.target.value)} className="flex-1"/>
        <Button onClick={()=>call('smart-search', { query: q, client_id: client || undefined })} disabled={!q || loading}>
          {loading ? <Loader2 className="h-4 w-4 mr-1 animate-spin"/> : null}Search
        </Button>
      </div>
      {data && (
        <div className="space-y-2">
          {data.answer && <Card className="p-3 bg-muted/30 prose prose-sm dark:prose-invert max-w-none"><ReactMarkdown>{data.answer}</ReactMarkdown></Card>}
          {(['calls','tasks','deals','assets'] as const).map(k => data.results?.[k]?.length ? (
            <div key={k}>
              <p className="text-xs font-semibold text-muted-foreground uppercase mt-2">{k} ({data.results[k].length})</p>
              <div className="space-y-1">
                {data.results[k].slice(0, 5).map((r: any) => (
                  <Card key={r.id} className="p-2 text-xs"><span className="font-mono opacity-50">{r.id.slice(0,8)}</span> · {r.title || r.contact_name || r.name || r.summary?.slice(0,80)}</Card>
                ))}
              </div>
            </div>
          ) : null)}
        </div>
      )}
    </div>
  );
}

function BudgetOpt() {
  const [client, setClient] = useState('');
  const { loading, data, call } = useFn();
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <ClientPicker value={client} onChange={setClient}/>
        <Button onClick={()=>call('budget-optimizer', { client_id: client })} disabled={!client || loading}>
          {loading ? <Loader2 className="h-4 w-4 mr-1 animate-spin"/> : null}Optimize
        </Button>
      </div>
      {data && (
        <div className="space-y-2">
          {data.summary && <Card className="p-3 bg-muted/30 text-sm">{data.summary}</Card>}
          {(data.recommendations || []).map((r: any, i: number) => (
            <Card key={i} className="p-3 flex items-center gap-3">
              <div className="flex-1">
                <p className="text-sm font-semibold">{r.name}</p>
                <p className="text-xs text-muted-foreground">{r.rationale}</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-muted-foreground">${r.current_daily_budget}/d →</p>
                <p className="text-sm font-bold">${r.recommended_daily_budget}/d</p>
                <Badge variant={r.delta > 0 ? 'default' : 'secondary'} className="text-xs">{r.delta > 0 ? '+' : ''}{r.delta}</Badge>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function AutoCRM() {
  const [client, setClient] = useState('');
  const { loading, data, call } = useFn();
  return (
    <div className="space-y-3">
      <div className="flex gap-2 items-center">
        <ClientPicker value={client} onChange={setClient}/>
        <Button onClick={()=>call('auto-crm-sync', { client_id: client || undefined, limit: 20 })} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 mr-1 animate-spin"/> : null}Sync transcripts → CRM
        </Button>
      </div>
      {data && (
        <div className="space-y-1">
          <p className="text-sm text-muted-foreground">Processed {data.processed}</p>
          {(data.results || []).map((r: any, i: number) => (
            <Card key={i} className="p-2 text-xs flex gap-2 items-start">
              <Badge variant={r.pushed ? 'default' : 'secondary'}>{r.pushed ? 'pushed' : r.skipped || r.error || 'skipped'}</Badge>
              <div className="flex-1">
                <p className="font-semibold">{r.contact}</p>
                <p className="opacity-70">{r.note}</p>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function CompetitorIntel() {
  const [client, setClient] = useState('');
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const { loading, data, call } = useFn();
  return (
    <div className="space-y-3">
      <div className="grid md:grid-cols-3 gap-2">
        <ClientPicker value={client} onChange={setClient}/>
        <Input placeholder="Competitor name" value={name} onChange={e=>setName(e.target.value)}/>
        <Input placeholder="https://competitor.com" value={url} onChange={e=>setUrl(e.target.value)}/>
      </div>
      <Button onClick={()=>call('competitive-intel', { client_id: client || undefined, competitor_name: name, competitor_url: url })} disabled={!url || loading}>
        {loading ? <Loader2 className="h-4 w-4 mr-1 animate-spin"/> : null}Analyze
      </Button>
      {data?.intel && (
        <Card className="p-4 space-y-2 text-sm">
          <p><b>Positioning:</b> {data.intel.positioning}</p>
          <p><b>Primary offer:</b> {data.intel.primary_offer}</p>
          {data.intel.hooks && <div><b>Hooks:</b><ul className="list-disc pl-4">{data.intel.hooks.map((h:string,i:number)=><li key={i}>{h}</li>)}</ul></div>}
          {data.intel.recommended_counter_angles && <div><b>Counter angles:</b><ul className="list-disc pl-4">{data.intel.recommended_counter_angles.map((h:string,i:number)=><li key={i}>{h}</li>)}</ul></div>}
          {data.intel.swot_vs_client && (
            <div className="grid grid-cols-3 gap-2 text-xs mt-2">
              <Card className="p-2"><b>Their strength</b><p>{data.intel.swot_vs_client.their_strength}</p></Card>
              <Card className="p-2"><b>Their weakness</b><p>{data.intel.swot_vs_client.their_weakness}</p></Card>
              <Card className="p-2 bg-primary/10"><b>Our opportunity</b><p>{data.intel.swot_vs_client.our_opportunity}</p></Card>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}