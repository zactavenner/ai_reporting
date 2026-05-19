import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Sparkles, Copy } from 'lucide-react';
import { toast } from 'sonner';

interface CampaignRow {
  name: string;
  spend: string;
  leads: string;
  cpl: string;
  calls: string;
  showed: string;
}

interface Props {
  clientId?: string;
  clientName?: string;
}

const EMPTY_ROW: CampaignRow = { name: '', spend: '', leads: '', cpl: '', calls: '', showed: '' };

export function WeeklyReportBuilder({ clientId, clientName }: Props) {
  const [progress, setProgress] = useState('');
  const [pendingAds, setPendingAds] = useState('');
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([{ ...EMPTY_ROW, name: 'Campaign A' }]);
  const [insights, setInsights] = useState('');
  const [updates, setUpdates] = useState('');
  const [adjustments, setAdjustments] = useState('');
  const [output, setOutput] = useState('');
  const [loading, setLoading] = useState(false);

  function updateRow(i: number, patch: Partial<CampaignRow>) {
    setCampaigns((p) => p.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  async function generate() {
    setLoading(true);
    try {
      const payload = {
        client: clientName,
        progress,
        pendingAds,
        campaigns,
        insights,
        updates,
        adjustments,
      };
      const prompt = `Write a polished, client-ready Weekly Performance Report email for ${clientName ?? 'the client'} using the data below.
Sections (in order, with headers): Progress Report, New Ads Pending Approval, Campaign Performance Overview (per campaign: Spend, Leads, CPL, Calls, Showed), Performance Summary & Insights, Specific Campaign Updates, Adjustments & Expected Outcomes.
Tone: confident, plain-English, no hype. Use "targeted returns" language only — never "guaranteed". Keep under 500 words.

DATA:
${JSON.stringify(payload, null, 2)}`;
      const { data, error } = await supabase.functions.invoke('ai-analysis', {
        body: { prompt, model: 'google/gemini-2.5-flash' },
      });
      if (error) throw error;
      setOutput(data?.text ?? data?.response ?? JSON.stringify(data));
    } catch (e: any) {
      toast.error('Generation failed: ' + (e?.message ?? 'unknown'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Weekly Report Inputs</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>Progress Report</Label>
            <Textarea rows={3} value={progress} onChange={(e) => setProgress(e.target.value)} placeholder="In progress / completed / review + next steps" />
          </div>
          <div>
            <Label>New Ads Pending Approval (links, one per line)</Label>
            <Textarea rows={2} value={pendingAds} onChange={(e) => setPendingAds(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Campaign Performance</Label>
            {campaigns.map((c, i) => (
              <div key={i} className="grid grid-cols-6 gap-2">
                <Input placeholder="Name" value={c.name} onChange={(e) => updateRow(i, { name: e.target.value })} />
                <Input placeholder="Spend" value={c.spend} onChange={(e) => updateRow(i, { spend: e.target.value })} />
                <Input placeholder="Leads" value={c.leads} onChange={(e) => updateRow(i, { leads: e.target.value })} />
                <Input placeholder="CPL" value={c.cpl} onChange={(e) => updateRow(i, { cpl: e.target.value })} />
                <Input placeholder="Calls" value={c.calls} onChange={(e) => updateRow(i, { calls: e.target.value })} />
                <Input placeholder="Showed" value={c.showed} onChange={(e) => updateRow(i, { showed: e.target.value })} />
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={() => setCampaigns((p) => [...p, { ...EMPTY_ROW, name: `Campaign ${String.fromCharCode(65 + p.length)}` }])}>
              + Add campaign
            </Button>
          </div>
          <div>
            <Label>Summary & Insights</Label>
            <Textarea rows={3} value={insights} onChange={(e) => setInsights(e.target.value)} />
          </div>
          <div>
            <Label>Specific Campaign Updates</Label>
            <Textarea rows={2} value={updates} onChange={(e) => setUpdates(e.target.value)} />
          </div>
          <div>
            <Label>Adjustments & Expected Outcomes</Label>
            <Textarea rows={2} value={adjustments} onChange={(e) => setAdjustments(e.target.value)} />
          </div>
          <Button onClick={generate} disabled={loading} className="w-full">
            <Sparkles className="h-4 w-4 mr-2" />
            {loading ? 'Generating…' : 'Generate polished email'}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between text-base">
            <span>Generated Email</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                navigator.clipboard.writeText(output);
                toast.success('Copied to clipboard');
              }}
              disabled={!output}
            >
              <Copy className="h-4 w-4 mr-1" /> Copy
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="whitespace-pre-wrap text-sm bg-muted/40 p-3 rounded-md min-h-[300px]">
            {output || 'Fill the form and click Generate.'}
          </pre>
        </CardContent>
      </Card>
    </div>
  );
}