import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { ExternalLink, FileText, Link2, RefreshCw, Search } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { toast } from '@/hooks/use-toast';

interface Field { label: string; value: string; group: string }
interface IntakeResponse {
  matched: boolean;
  client_name?: string;
  matched_company?: string;
  match_score?: number;
  fields?: Field[];
  source?: string;
  fetched_at?: string;
  reason?: string;
}

const GROUP_ORDER = ['Company', 'Offer & Strategy', 'Operations & Access', 'Budget', 'Other'];

function isUrl(v: string) {
  return /^https?:\/\//i.test(v.trim());
}

function renderValue(v: string) {
  const trimmed = v.trim();
  if (isUrl(trimmed)) {
    return (
      <a href={trimmed} target="_blank" rel="noopener noreferrer"
         className="text-primary hover:underline inline-flex items-center gap-1 break-all">
        {trimmed} <ExternalLink className="h-3 w-3 shrink-0" />
      </a>
    );
  }
  // Long-form answers get a softer treatment
  return <span className="whitespace-pre-wrap break-words">{trimmed}</span>;
}

interface Props { clientId: string; isPublicView?: boolean }

export function OnboardingIntake({ clientId, isPublicView }: Props) {
  const queryClient = useQueryClient();
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideValue, setOverrideValue] = useState('');

  const { data, isLoading, error, refetch, isFetching } = useQuery<IntakeResponse>({
    queryKey: ['onboarding-intake', clientId, 'v2-strict-match'],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('fetch-onboarding-intake', {
        body: { client_id: clientId },
      });
      if (error) throw error;
      return data as IntakeResponse;
    },
    staleTime: 5 * 60 * 1000,
    enabled: !!clientId,
  });

  const saveOverride = useMutation({
    mutationFn: async (name: string) => {
      const { error } = await supabase
        .from('clients')
        .update({ intake_company_name: name || null } as any)
        .eq('id', clientId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: 'Intake mapping saved' });
      setOverrideOpen(false);
      queryClient.invalidateQueries({ queryKey: ['onboarding-intake', clientId] });
    },
    onError: (e: any) => toast({ title: 'Failed to save', description: e.message, variant: 'destructive' }),
  });

  const grouped = useMemo(() => {
    const map = new Map<string, Field[]>();
    (data?.fields || []).forEach((f) => {
      if (!map.has(f.group)) map.set(f.group, []);
      map.get(f.group)!.push(f);
    });
    return GROUP_ORDER
      .filter((g) => map.has(g))
      .map((g) => [g, map.get(g)!] as const)
      .concat([...map.entries()].filter(([k]) => !GROUP_ORDER.includes(k)));
  }, [data]);

  if (isLoading) {
    return (
      <Card className="p-6 rounded-2xl border-border/60">
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-6 w-full" />)}
        </div>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="p-6 rounded-2xl border-destructive/40 bg-destructive/5">
        <p className="text-sm text-destructive font-medium">Could not load onboarding intake</p>
        <p className="text-xs text-muted-foreground mt-1">{(error as any)?.message}</p>
      </Card>
    );
  }

  if (!data?.matched) {
    return (
      <Card className="p-6 rounded-2xl border-dashed">
        <div className="flex items-start gap-3">
          <Search className="h-5 w-5 text-muted-foreground mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-medium">No intake record found for this client</p>
            <p className="text-xs text-muted-foreground mt-1">
              We couldn't match "{data?.client_name || 'this client'}" against the CRA Onboarding sheet.
              Enter the exact company name as it appears in CRA Onboarding / AICR below to map it.
            </p>
            {!isPublicView && (
              <div className="mt-3 flex gap-2">
                <Input
                  placeholder="Exact intake company name…"
                  value={overrideValue}
                  onChange={(e) => setOverrideValue(e.target.value)}
                  className="h-8 text-xs"
                />
                <Button
                  size="sm"
                  onClick={() => saveOverride.mutate(overrideValue.trim())}
                  disabled={!overrideValue.trim() || saveOverride.isPending}
                >
                  <Link2 className="h-3 w-3 mr-1" /> Map
                </Button>
              </div>
            )}
          </div>
          <Button size="sm" variant="ghost" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`h-3 w-3 ${isFetching ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card className="rounded-2xl border-border/60 overflow-hidden">
      {/* Header */}
      <div className="relative px-6 py-5 bg-gradient-to-br from-primary/[0.06] via-card to-card border-b border-border/50">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground font-semibold">Client Intake</p>
            <h3 className="mt-1 text-xl font-semibold tracking-tight" style={{ fontFamily: 'Playfair Display, Georgia, serif' }}>
              {data.matched_company}
            </h3>
            <div className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
              <FileText className="h-3 w-3" />
              Pulled from {data.source}
              {data.match_score !== undefined && data.match_score < 500 && (
                <Badge variant="outline" className="text-[10px] h-4">Fuzzy match · {data.match_score}</Badge>
              )}
              {(data as any).override_used && (
                <Badge variant="outline" className="text-[10px] h-4">Manual map</Badge>
              )}
            </div>
          </div>
          {!isPublicView && (
            <div className="flex items-center gap-1">
              <Button size="sm" variant="ghost" onClick={() => { setOverrideValue(data.matched_company || ''); setOverrideOpen((v) => !v); }}>
                <Link2 className="h-3 w-3 mr-1" /> Remap
              </Button>
              <Button size="sm" variant="ghost" onClick={() => refetch()} disabled={isFetching}>
                <RefreshCw className={`h-3 w-3 mr-1 ${isFetching ? 'animate-spin' : ''}`} /> Refresh
              </Button>
            </div>
          )}
        </div>
        {!isPublicView && overrideOpen && (
          <div className="mt-3 flex gap-2">
            <Input
              placeholder="Exact intake company name (blank = auto match)"
              value={overrideValue}
              onChange={(e) => setOverrideValue(e.target.value)}
              className="h-8 text-xs"
            />
            <Button size="sm" onClick={() => saveOverride.mutate(overrideValue.trim())} disabled={saveOverride.isPending}>
              Save
            </Button>
          </div>
        )}
      </div>

      {/* Groups */}
      <div className="p-6 space-y-6">
        {grouped.map(([group, fields]) => (
          <section key={group}>
            <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground font-semibold mb-3">
              {group}
            </p>
            <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
              {fields.map((f) => (
                <div key={f.label} className="border-b border-border/30 pb-3 last:border-0">
                  <dt className="text-[11px] font-medium text-muted-foreground leading-snug">{f.label}</dt>
                  <dd className="mt-1 text-sm text-foreground">{renderValue(f.value)}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Card>
  );
}

export default OnboardingIntake;