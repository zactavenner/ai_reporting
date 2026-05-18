import { useMemo, useState } from 'react';
import { useGHLContacts, type GHLContact } from '@/hooks/useGHLContacts';
import { useClients, type Client } from '@/hooks/useClients';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Sparkles, Loader2, CheckCircle2, AlertTriangle, ShieldOff, RefreshCw, Filter,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

type Routing = 'fast_track' | 'standard' | 'nurture' | 'disqualified';

interface LeadScore {
  score: number;
  routing: Routing;
  reasons: string[];
  phone_valid: boolean;
  email_valid: boolean;
  investor_signals: string[];
}

const ROUTING_LABEL: Record<Routing, string> = {
  fast_track: 'Fast Track',
  standard: 'Standard',
  nurture: 'Nurture Only',
  disqualified: 'Low Quality',
};

const ROUTING_VARIANT: Record<Routing, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  fast_track: 'default',
  standard: 'secondary',
  nurture: 'outline',
  disqualified: 'destructive',
};

function scoreBadgeColor(score: number) {
  if (score >= 80) return 'bg-green-500 text-white';
  if (score >= 50) return 'bg-yellow-500 text-white';
  if (score >= 20) return 'bg-orange-500 text-white';
  return 'bg-red-500 text-white';
}

const SCORING_SYSTEM = `You are a capital raising lead scoring expert. Score this lead 0-100 for investment intent quality.
Output ONLY valid JSON matching: { score: number, routing: 'fast_track'|'standard'|'nurture'|'disqualified', reasons: string[], phone_valid: boolean, email_valid: boolean, investor_signals: string[] }
- fast_track: 80+, strong investor signals, valid contact
- standard: 50-79, qualified but needs nurturing
- nurture: 20-49, weak signals
- disqualified: <20 or invalid contact info`;

export function LeadQualityManager() {
  const { data: clients = [] } = useClients();
  const { data, isLoading, refetch, isFetching } = useGHLContacts(30);
  const contacts: GHLContact[] = data?.contacts || [];

  const [scores, setScores] = useState<Record<string, LeadScore | 'loading'>>({});
  const [decisions, setDecisions] = useState<Record<string, 'approved' | 'nurture' | 'spam'>>({});
  const [clientFilter, setClientFilter] = useState<string>('all');
  const [routingFilter, setRoutingFilter] = useState<string>('all');
  const [scoreMin, setScoreMin] = useState<string>('');

  async function runScore(contact: GHLContact) {
    setScores(prev => ({ ...prev, [contact.id]: 'loading' }));
    try {
      const { supabase } = await import('@/integrations/supabase/client');
      const userPrompt = `Lead details:
Name: ${contact.name || `${contact.firstName} ${contact.lastName}`.trim()}
Email: ${contact.email || 'N/A'}
Phone: ${contact.phone || 'N/A'}
Source: ${contact.source || 'N/A'}
Type: ${contact.type || 'N/A'}
Tags: ${(contact.tags || []).join(', ') || 'none'}
Date added: ${contact.dateAdded}

Score this capital raising lead 0-100 and respond with ONLY the JSON object.`;

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-analysis`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
          body: JSON.stringify({
            messages: [
              { role: 'user', content: `${SCORING_SYSTEM}\n\n${userPrompt}` },
            ],
            context: { clientName: 'Lead Quality Scoring' },
            model: 'gemini',
          }),
        },
      );

      if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);

      // Drain SSE
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let textOut = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 1);
          if (!line.startsWith('data: ')) continue;
          const json = line.slice(6);
          if (json === '[DONE]') break;
          try {
            const p = JSON.parse(json);
            textOut += p.choices?.[0]?.delta?.content || '';
          } catch { /* ignore */ }
        }
      }

      // Extract JSON block
      const match = textOut.match(/\{[\s\S]*\}/);
      if (!match) throw new Error('No JSON in AI response');
      const parsed: LeadScore = JSON.parse(match[0]);
      setScores(prev => ({ ...prev, [contact.id]: parsed }));
      toast.success(`Scored ${contact.name || contact.email}: ${parsed.score}/100`);
    } catch (err: any) {
      setScores(prev => {
        const next = { ...prev };
        delete next[contact.id];
        return next;
      });
      toast.error(`Score failed: ${err?.message || 'unknown'}`);
    }
  }

  const filtered = useMemo(() => {
    return contacts.filter(c => {
      const score = scores[c.id];
      if (clientFilter !== 'all') {
        // GHL contacts don't always carry client_id, soft-match via tag containing client name
        const client = clients.find(cl => cl.id === clientFilter);
        if (client && !(c.tags || []).some(t => t.toLowerCase().includes(client.name.toLowerCase()))) {
          return false;
        }
      }
      if (routingFilter !== 'all') {
        if (typeof score !== 'object') return false;
        if (score.routing !== routingFilter) return false;
      }
      if (scoreMin) {
        if (typeof score !== 'object') return false;
        if (score.score < parseInt(scoreMin, 10)) return false;
      }
      return true;
    });
  }, [contacts, scores, clientFilter, routingFilter, scoreMin, clients]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold">Lead Quality Manager</h2>
          <p className="text-sm text-muted-foreground">
            AI-powered scoring & routing for incoming leads · {contacts.length} loaded
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={cn('h-4 w-4 mr-2', isFetching && 'animate-spin')} /> Refresh
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Filter className="h-4 w-4" /> Filters
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Select value={clientFilter} onValueChange={setClientFilter}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="Client" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All clients</SelectItem>
              {clients.map((c: Client) => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={routingFilter} onValueChange={setRoutingFilter}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Routing" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Any routing</SelectItem>
              <SelectItem value="fast_track">Fast Track</SelectItem>
              <SelectItem value="standard">Standard</SelectItem>
              <SelectItem value="nurture">Nurture</SelectItem>
              <SelectItem value="disqualified">Low Quality</SelectItem>
            </SelectContent>
          </Select>
          <Input
            type="number"
            placeholder="Min score"
            value={scoreMin}
            onChange={(e) => setScoreMin(e.target.value)}
            className="w-[120px]"
          />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm">No leads match the filters.</div>
          ) : (
            <TooltipProvider>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Lead</TableHead>
                    <TableHead>Contact</TableHead>
                    <TableHead>Score</TableHead>
                    <TableHead>Routing</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map(contact => {
                    const score = scores[contact.id];
                    const isLoadingScore = score === 'loading';
                    const scoreObj = typeof score === 'object' ? score : null;
                    const decision = decisions[contact.id];
                    return (
                      <TableRow key={contact.id}>
                        <TableCell>
                          <div className="font-medium text-sm">
                            {contact.name || `${contact.firstName || ''} ${contact.lastName || ''}`.trim() || 'Unknown'}
                          </div>
                          <div className="text-[11px] text-muted-foreground">
                            {contact.source || 'Direct'} · {new Date(contact.dateAdded).toLocaleDateString()}
                          </div>
                        </TableCell>
                        <TableCell className="text-xs">
                          <div className="truncate max-w-[180px]" title={contact.email}>{contact.email || '—'}</div>
                          <div className="text-muted-foreground">{contact.phone || '—'}</div>
                        </TableCell>
                        <TableCell>
                          {scoreObj ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Badge className={cn('text-xs font-bold cursor-help', scoreBadgeColor(scoreObj.score))}>
                                  {scoreObj.score}
                                </Badge>
                              </TooltipTrigger>
                              <TooltipContent className="max-w-xs space-y-1">
                                <p className="font-semibold text-xs">Breakdown</p>
                                <p className="text-[11px]">📱 Phone valid: {scoreObj.phone_valid ? '✓' : '✗'}</p>
                                <p className="text-[11px]">📧 Email valid: {scoreObj.email_valid ? '✓' : '✗'}</p>
                                {scoreObj.investor_signals?.length > 0 && (
                                  <p className="text-[11px]">💼 Signals: {scoreObj.investor_signals.join(', ')}</p>
                                )}
                                {scoreObj.reasons?.length > 0 && (
                                  <p className="text-[11px] text-muted-foreground">
                                    {scoreObj.reasons.slice(0, 3).join(' · ')}
                                  </p>
                                )}
                              </TooltipContent>
                            </Tooltip>
                          ) : isLoadingScore ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {scoreObj ? (
                            <Badge variant={ROUTING_VARIANT[scoreObj.routing]} className="text-[10px]">
                              {ROUTING_LABEL[scoreObj.routing]}
                            </Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {decision ? (
                            <Badge variant="outline" className="text-[10px]">{decision}</Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              size="sm" variant="ghost" className="h-7 px-2 text-[11px]"
                              onClick={() => runScore(contact)}
                              disabled={isLoadingScore}
                            >
                              {isLoadingScore ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <><Sparkles className="h-3 w-3 mr-1" /> Score</>
                              )}
                            </Button>
                            <Button
                              size="sm" variant="ghost" className="h-7 px-2 text-[11px] text-green-600"
                              onClick={() => {
                                setDecisions(p => ({ ...p, [contact.id]: 'approved' }));
                                toast.success('Approved for booking');
                              }}
                            >
                              <CheckCircle2 className="h-3 w-3" />
                            </Button>
                            <Button
                              size="sm" variant="ghost" className="h-7 px-2 text-[11px] text-yellow-600"
                              onClick={() => {
                                setDecisions(p => ({ ...p, [contact.id]: 'nurture' }));
                                toast.message('Moved to nurture');
                              }}
                            >
                              <AlertTriangle className="h-3 w-3" />
                            </Button>
                            <Button
                              size="sm" variant="ghost" className="h-7 px-2 text-[11px] text-destructive"
                              onClick={() => {
                                setDecisions(p => ({ ...p, [contact.id]: 'spam' }));
                                toast.message('Flagged as spam');
                              }}
                            >
                              <ShieldOff className="h-3 w-3" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TooltipProvider>
          )}
        </CardContent>
      </Card>
    </div>
  );
}