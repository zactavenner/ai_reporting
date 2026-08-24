import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Loader2, Search, Hash, Link, Play } from 'lucide-react';
import { useQuoteInstagramScrape, useRunInstagramScrape } from '@/hooks/useInstagramScraper';
import { useClients } from '@/hooks/useClients';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export function InstagramScrapeForm() {
  const [scrapeType, setScrapeType] = useState<'profile' | 'hashtag' | 'url'>('profile');
  const [targets, setTargets] = useState('');
  const [resultsLimit, setResultsLimit] = useState(50);
  const [clientId, setClientId] = useState('');
  const [quote, setQuote] = useState<{ id: string; estimated_cost_usd: number } | null>(null);
  const { data: clients } = useClients();
  const quoteScrape = useQuoteInstagramScrape();
  const runScrape = useRunInstagramScrape();

  const targetList = targets
    .split('\n')
    .map(t => t.trim())
    .filter(Boolean);

  const handleQuote = async () => {
    if (!clientId || targetList.length === 0) return;
    const result = await quoteScrape.mutateAsync({ clientId, scrapeType, targets: targetList, resultsLimit });
    setQuote({ id: result.job.id, estimated_cost_usd: Number(result.job.estimated_cost_usd) });
  };

  const handleRun = () => {
    if (!quote || !clientId) return;
    runScrape.mutate({ clientId, jobId: quote.id, scrapeType, targets: targetList, resultsLimit });
    setQuote(null);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">New Scrape</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label>Client (discovery spend is attributed to this client)</Label>
          <Select value={clientId} onValueChange={(v) => { setClientId(v); setQuote(null); }}>
            <SelectTrigger><SelectValue placeholder="Select a client" /></SelectTrigger>
            <SelectContent>
              {(clients ?? []).map((c: any) => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Tabs value={scrapeType} onValueChange={(v) => setScrapeType(v as any)}>
          <TabsList className="w-full">
            <TabsTrigger value="profile" className="flex-1 gap-1">
              <Search className="h-3 w-3" /> Profile
            </TabsTrigger>
            <TabsTrigger value="hashtag" className="flex-1 gap-1">
              <Hash className="h-3 w-3" /> Hashtag
            </TabsTrigger>
            <TabsTrigger value="url" className="flex-1 gap-1">
              <Link className="h-3 w-3" /> URL
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="space-y-2">
          <Label>
            {scrapeType === 'profile' ? 'Usernames (one per line)' :
             scrapeType === 'hashtag' ? 'Hashtags (one per line)' :
             'URLs (one per line)'}
          </Label>
          <Textarea
            value={targets}
            onChange={(e) => setTargets(e.target.value)}
            placeholder={
              scrapeType === 'profile' ? '@nike\n@adidas\n@gymshark' :
              scrapeType === 'hashtag' ? '#fitness\n#skincare\n#recipe' :
              'https://www.instagram.com/p/ABC123/'
            }
            rows={4}
          />
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{targetList.length} / 20 targets</span>
            {targetList.length > 20 && (
              <Badge variant="destructive" className="text-[10px]">Max 20</Badge>
            )}
          </div>
        </div>

        <div className="space-y-2">
          <Label>Results Limit</Label>
          <Input
            type="number"
            min={1}
            max={200}
            value={resultsLimit}
            onChange={(e) => setResultsLimit(Math.min(200, Number(e.target.value)))}
          />
        </div>

        {quote ? (
          <div className="space-y-2 p-3 rounded-lg border bg-muted/50 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Exact maximum cost</span>
              <Badge variant="outline">${quote.estimated_cost_usd.toFixed(2)}</Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              {targetList.length} target(s) × {resultsLimit} results. Approving runs the scrape and spends up to this amount.
            </p>
            <div className="flex gap-2">
              <Button onClick={handleRun} disabled={runScrape.isPending} className="flex-1">
                {runScrape.isPending ? (
                  <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Running...</>
                ) : (
                  <><Play className="h-4 w-4 mr-2" /> Approve & run</>
                )}
              </Button>
              <Button variant="ghost" onClick={() => setQuote(null)}>Cancel</Button>
            </div>
          </div>
        ) : (
          <Button
            onClick={handleQuote}
            disabled={quoteScrape.isPending || !clientId || targetList.length === 0 || targetList.length > 20}
            className="w-full"
          >
            {quoteScrape.isPending ? (
              <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Quoting...</>
            ) : (
              <><Play className="h-4 w-4 mr-2" /> Get exact quote</>
            )}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
