import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import {
  ONBOARDING_TEMPLATE_OPTIONS,
  fetchOnboardingTemplate,
  getOnboardingTemplate,
  type OnboardingTemplateKey,
} from '@/lib/onboardingTaskTemplates';
import { seedOnboardingTasksIntoPM, type OnboardingTemplateItem } from '@/lib/onboardingTaskSeeder';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  clientId?: string;
}

export function LoadTemplateDialog({ open, onOpenChange, clientId }: Props) {
  const qc = useQueryClient();
  const [templateKey, setTemplateKey] = useState<OnboardingTemplateKey>('standard');
  const [items, setItems] = useState<OnboardingTemplateItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [seeding, setSeeding] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetchOnboardingTemplate(templateKey)
      .then(rows => setItems(rows ?? getOnboardingTemplate(templateKey)))
      .finally(() => setLoading(false));
  }, [open, templateKey]);

  const grouped = items.reduce<Record<string, OnboardingTemplateItem[]>>((acc, it) => {
    (acc[it.category] ||= []).push(it);
    return acc;
  }, {});

  const load = async () => {
    if (!clientId) {
      toast.error('Pick a client first');
      return;
    }
    if (!items.length) return;
    setSeeding(true);
    try {
      const res = await seedOnboardingTasksIntoPM(clientId, items);
      toast.success(`Loaded ${res.subtaskCount} tasks across ${res.parentCount} sections`);
      qc.invalidateQueries({ queryKey: ['tasks'] });
      qc.invalidateQueries({ queryKey: ['all-tasks'] });
      qc.invalidateQueries({ queryKey: ['projects', clientId] });
      qc.invalidateQueries({ queryKey: ['onboarding-tasks', clientId] });
      onOpenChange(false);
    } catch (e: any) {
      toast.error(`Failed to load template: ${e.message || e}`);
    } finally {
      setSeeding(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Load Task Template</DialogTitle>
          <DialogDescription>
            Pick a template — sections become parent tasks (auto-routed to pods) and items become subtasks under each section.
            Edit templates in Settings → Onboarding Templates.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Select value={templateKey} onValueChange={(v) => setTemplateKey(v as OnboardingTemplateKey)}>
              <SelectTrigger className="w-[280px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ONBOARDING_TEMPLATE_OPTIONS.map(opt => (
                  <SelectItem key={opt.key} value={opt.key}>
                    <div className="flex flex-col">
                      <span>{opt.label}</span>
                      <span className="text-[10px] text-muted-foreground">{opt.description}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Badge variant="outline">
              {items.length} items · {Object.keys(grouped).length} sections
            </Badge>
          </div>

          <ScrollArea className="h-[340px] rounded-md border p-3">
            {loading ? (
              <div className="text-sm text-muted-foreground text-center py-8">Loading…</div>
            ) : items.length === 0 ? (
              <div className="text-sm text-muted-foreground text-center py-8">No items in this template.</div>
            ) : (
              <div className="space-y-4">
                {Object.entries(grouped).map(([cat, list]) => (
                  <div key={cat}>
                    <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                      {cat} <span className="text-foreground/60">({list.length})</span>
                    </div>
                    <ul className="space-y-1 text-sm">
                      {list.map((it, i) => (
                        <li key={`${cat}-${i}`} className="flex gap-2">
                          <span className="text-muted-foreground w-6">{it.sort_order}.</span>
                          <span>{it.title}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={seeding}>Cancel</Button>
          <Button onClick={load} disabled={!clientId || seeding || items.length === 0}>
            {seeding ? 'Loading…' : `Load ${items.length} tasks`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}