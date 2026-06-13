import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Sparkles, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  CHECKLISTS,
  KPI_THRESHOLDS,
  diagnoseConstraint,
  type FunnelSnapshot,
} from '@/lib/constraintRules';

interface Props {
  clientId: string;
  clientName?: string;
  snapshot?: FunnelSnapshot;
}

export function ConstraintDiagnostics({ clientId, clientName, snapshot: initialSnapshot }: Props) {
  const [snapshot, setSnapshot] = useState<FunnelSnapshot>(initialSnapshot ?? {});
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const [aiSuggestion, setAiSuggestion] = useState<string>('');
  const [loadingAi, setLoadingAi] = useState(false);

  const diagnosis = useMemo(() => diagnoseConstraint(snapshot), [snapshot]);
  const visibleChecklists = useMemo(
    () => CHECKLISTS.filter((c) => diagnosis.recommendedChecklists.includes(c.type)),
    [diagnosis],
  );

  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data } = await supabase
        .from('client_constraint_checklists')
        .select('checklist_type, item_key, checked')
        .eq('client_id', clientId);
      if (!mounted || !data) return;
      const map: Record<string, boolean> = {};
      for (const row of data as any[]) {
        map[`${row.checklist_type}:${row.item_key}`] = !!row.checked;
      }
      setChecks(map);
    })();
    return () => {
      mounted = false;
    };
  }, [clientId]);

  async function toggleItem(checklist_type: string, item_key: string, next: boolean) {
    const compoundKey = `${checklist_type}:${item_key}`;
    setChecks((p) => ({ ...p, [compoundKey]: next }));
    const { error } = await supabase
      .from('client_constraint_checklists')
      .upsert(
        {
          client_id: clientId,
          checklist_type,
          item_key,
          checked: next,
          checked_at: next ? new Date().toISOString() : null,
        },
        { onConflict: 'client_id,checklist_type,item_key' },
      );
    if (error) toast.error('Failed to save checklist item');
  }

  async function getAiSuggestion() {
    setLoadingAi(true);
    setAiSuggestion('');
    try {
      const prompt = `You are a senior performance marketing strategist for a capital-raising agency.
Client: ${clientName ?? 'Unknown'}
Funnel snapshot: ${JSON.stringify(snapshot)}
Identified constraint: ${diagnosis.constraint} — ${diagnosis.reason}

Using the agency's playbook (CPBC, funnel, audience, offer, pre-booking, post-booking, close-rate checklists),
suggest the TOP 3 concrete next actions in order of impact. Be specific (audience type, copy angle,
funnel tweak). Use "targeted returns" language — never "guaranteed".`;

      const { data, error } = await supabase.functions.invoke('ai-analysis', {
        body: { prompt, model: 'openrouter/owl-alpha' },
      });
      if (error) throw error;
      setAiSuggestion(data?.text ?? data?.response ?? JSON.stringify(data));
    } catch (e: any) {
      toast.error('AI suggestion failed: ' + (e?.message ?? 'unknown'));
    } finally {
      setLoadingAi(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="h-4 w-4 text-primary" />
            Funnel Snapshot
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {([
            ['cpbc', 'CPBC $', `> ${KPI_THRESHOLDS.cpbcMax}`],
            ['showRate', 'Show Rate (0-1)', `< ${KPI_THRESHOLDS.showRateMin}`],
            ['closeRate', 'Close Rate (0-1)', `< ${KPI_THRESHOLDS.closeRateMin}`],
            ['cashRoas', 'Cash ROAS', `< ${KPI_THRESHOLDS.cashRoasMin}`],
            ['revRoas', 'Revenue ROAS', `< ${KPI_THRESHOLDS.revRoasMin}`],
            ['cplc', 'CPLC $', `> ${KPI_THRESHOLDS.cplcMax}`],
            ['noShows', 'No Shows', ''],
            ['canceledUnqual', 'Canceled (Unqual)', ''],
          ] as const).map(([key, label, hint]) => (
            <div key={key} className="space-y-1">
              <label className="text-xs text-muted-foreground">
                {label} <span className="opacity-60">{hint}</span>
              </label>
              <Input
                type="number"
                step="0.01"
                value={(snapshot[key as keyof FunnelSnapshot] as number | undefined) ?? ''}
                onChange={(e) =>
                  setSnapshot((p) => ({
                    ...p,
                    [key]: e.target.value === '' ? undefined : Number(e.target.value),
                  }))
                }
              />
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="border-primary/50">
        <CardHeader>
          <CardTitle className="flex items-center justify-between text-base">
            <span>Diagnosis</span>
            <Badge variant="secondary" className="uppercase">
              {diagnosis.constraint.replace(/_/g, ' ')}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm">{diagnosis.reason}</p>
          <Button size="sm" onClick={getAiSuggestion} disabled={loadingAi}>
            <Sparkles className="h-4 w-4 mr-2" />
            {loadingAi ? 'Thinking…' : 'AI: Suggest top 3 fixes'}
          </Button>
          {aiSuggestion && (
            <pre className="whitespace-pre-wrap text-sm bg-muted/40 p-3 rounded-md">
              {aiSuggestion}
            </pre>
          )}
        </CardContent>
      </Card>

      {visibleChecklists.map((section) => {
        const done = section.items.filter((i) => checks[`${section.type}:${i.key}`]).length;
        return (
          <Card key={section.type}>
            <CardHeader>
              <CardTitle className="flex items-center justify-between text-base">
                <span>{section.title}</span>
                <Badge variant="outline">
                  {done}/{section.items.length}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {section.items.map((item) => {
                const k = `${section.type}:${item.key}`;
                const checked = !!checks[k];
                return (
                  <label
                    key={k}
                    className="flex items-start gap-3 p-2 rounded-md hover:bg-muted/40 cursor-pointer"
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(v) => toggleItem(section.type, item.key, !!v)}
                    />
                    <div className="space-y-0.5">
                      <div
                        className={`text-sm ${checked ? 'line-through text-muted-foreground' : ''}`}
                      >
                        {item.label}
                      </div>
                      {checked && (
                        <div className="flex items-center gap-1 text-xs text-emerald-500">
                          <CheckCircle2 className="h-3 w-3" /> Done
                        </div>
                      )}
                    </div>
                  </label>
                );
              })}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}