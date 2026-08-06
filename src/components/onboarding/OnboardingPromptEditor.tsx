import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, RotateCcw, Save, FileText, Image as ImageIcon, Film, ListChecks, ShieldCheck, Eye } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface PromptRow {
  id: string;
  key: string;
  section: string;
  label: string;
  description: string | null;
  prompt: string;
  default_prompt: string;
  meta: any;
  sort_order: number;
  is_active: boolean;
  updated_at: string;
}

const SECTIONS: { key: string; label: string; hint: string; icon: any }[] = [
  { key: 'brief', label: 'Mission brief', hint: 'The opening instruction the mission engine receives', icon: FileText },
  { key: 'deliverables', label: 'Deliverables', hint: 'One instruction per saved asset, in run order', icon: ListChecks },
  { key: 'statics', label: 'Static ad concepts', hint: '10 concept slots — one creative each', icon: ImageIcon },
  { key: 'videos', label: 'Video styles', hint: '5 style slots — 30s each, one video per slot', icon: Film },
  { key: 'workflow', label: 'Limits & approval workflow', hint: 'Budgets, Jeremy consults, approval gates, final report', icon: ShieldCheck },
];

interface Props {
  clientId?: string | null;
  clientName?: string;
}

export function OnboardingPromptEditor({ clientId, clientName }: Props) {
  const [rows, setRows] = useState<PromptRow[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [active, setActive] = useState('brief');
  const [preview, setPreview] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('onboarding_prompts')
      .select('*')
      .order('sort_order');
    if (error) toast.error(error.message);
    const list = (data || []) as unknown as PromptRow[];
    setRows(list);
    setDrafts(Object.fromEntries(list.map((r) => [r.id, r.prompt])));
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const dirty = useMemo(
    () => rows.filter((r) => (drafts[r.id] ?? r.prompt) !== r.prompt),
    [rows, drafts],
  );

  async function saveAll() {
    if (!dirty.length) return;
    setSaving(true);
    const { data: auth } = await supabase.auth.getUser();
    for (const row of dirty) {
      const { error } = await supabase
        .from('onboarding_prompts')
        .update({ prompt: drafts[row.id], updated_by: auth?.user?.id || null })
        .eq('id', row.id);
      if (error) {
        toast.error(`${row.label}: ${error.message}`);
        setSaving(false);
        return;
      }
    }
    toast.success(`Saved ${dirty.length} prompt${dirty.length === 1 ? '' : 's'} — the next build uses them`);
    setSaving(false);
    await load();
  }

  async function resetRow(row: PromptRow) {
    setDrafts((d) => ({ ...d, [row.id]: row.default_prompt }));
  }

  async function toggleActive(row: PromptRow) {
    const { error } = await supabase
      .from('onboarding_prompts')
      .update({ is_active: !row.is_active })
      .eq('id', row.id);
    if (error) return toast.error(error.message);
    await load();
  }

  async function loadPreview() {
    if (!clientId) {
      toast.error('Pick a client to preview the composed prompt');
      return;
    }
    setPreviewing(true);
    try {
      const { data, error } = await supabase.functions.invoke('onboarding-build', {
        body: { password: 'HPA1234$', action: 'preview', client_id: clientId },
      });
      if (error) throw error;
      const p = (data as any)?.prompt;
      if (!p) throw new Error((data as any)?.error || 'No prompt returned');
      setPreview(p);
    } catch (e: any) {
      toast.error(e?.message || 'Preview failed');
    } finally {
      setPreviewing(false);
    }
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex-1 flex min-h-0 gap-4">
      {/* Section rail */}
      <div className="hidden md:flex w-56 shrink-0 flex-col gap-1">
        {SECTIONS.map((s) => {
          const Icon = s.icon;
          const count = rows.filter((r) => r.section === s.key).length;
          const edited = rows.filter((r) => r.section === s.key && (drafts[r.id] ?? r.prompt) !== r.prompt).length;
          return (
            <button
              key={s.key}
              onClick={() => {
                setActive(s.key);
                document.getElementById(`prompt-section-${s.key}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }}
              className={cn(
                'text-left rounded-lg border px-3 py-2 transition-colors',
                active === s.key ? 'bg-muted border-primary/40' : 'hover:bg-muted/50',
              )}
            >
              <div className="flex items-center gap-2">
                <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-sm font-medium truncate">{s.label}</span>
              </div>
              <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <span>{count} prompt{count === 1 ? '' : 's'}</span>
                {edited > 0 && <Badge variant="outline" className="h-4 text-[10px]">{edited} edited</Badge>}
              </div>
            </button>
          );
        })}
      </div>

      {/* Prompt document */}
      <div className="flex-1 min-w-0 flex flex-col">
        <div className="flex flex-wrap items-center justify-between gap-2 pb-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold">Onboarding prompts</h2>
            <p className="text-xs text-muted-foreground truncate">
              Exactly what the automation is instructed to do, section by section.
              {clientName ? ` Preview resolves against ${clientName}.` : ''}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={loadPreview} disabled={previewing}>
              {previewing ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Eye className="h-3.5 w-3.5 mr-1" />}
              Preview composed prompt
            </Button>
            <Button size="sm" onClick={saveAll} disabled={saving || dirty.length === 0}>
              {saving ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1" />}
              Save{dirty.length ? ` (${dirty.length})` : ''}
            </Button>
          </div>
        </div>

        <ScrollArea className="flex-1 min-h-0 pr-3">
          <div className="space-y-6 pb-10">
            {preview && (
              <Card className="p-4">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span className="text-sm font-semibold">Composed prompt (read-only)</span>
                  <Button size="sm" variant="ghost" onClick={() => setPreview(null)}>Close</Button>
                </div>
                <pre className="text-[11px] leading-relaxed whitespace-pre-wrap font-mono text-muted-foreground">{preview}</pre>
              </Card>
            )}

            {SECTIONS.map((s) => {
              const list = rows.filter((r) => r.section === s.key);
              if (!list.length) return null;
              return (
                <div key={s.key} id={`prompt-section-${s.key}`} className="space-y-3">
                  <div>
                    <h3 className="text-sm font-semibold">{s.label}</h3>
                    <p className="text-xs text-muted-foreground">{s.hint}</p>
                  </div>
                  {list.map((row) => {
                    const value = drafts[row.id] ?? row.prompt;
                    const isDirty = value !== row.prompt;
                    const isDefault = value.trim() === row.default_prompt.trim();
                    return (
                      <Card key={row.id} className={cn('p-3', !row.is_active && 'opacity-60')}>
                        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-sm font-medium truncate">{row.label}</span>
                            {row.description && (
                              <Badge variant="outline" className="text-[10px] h-4">{row.description}</Badge>
                            )}
                            {isDirty && <Badge className="text-[10px] h-4">unsaved</Badge>}
                            {!row.is_active && <Badge variant="secondary" className="text-[10px] h-4">skipped</Badge>}
                          </div>
                          <div className="flex items-center gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 text-xs"
                              onClick={() => toggleActive(row)}
                            >
                              {row.is_active ? 'Skip' : 'Include'}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 text-xs"
                              disabled={isDefault}
                              onClick={() => resetRow(row)}
                            >
                              <RotateCcw className="h-3 w-3 mr-1" />
                              Default
                            </Button>
                          </div>
                        </div>
                        <Textarea
                          value={value}
                          onChange={(e) => setDrafts((d) => ({ ...d, [row.id]: e.target.value }))}
                          className="min-h-[88px] text-xs font-mono leading-relaxed"
                        />
                      </Card>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}
