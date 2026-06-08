import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Plus, Trash2, Save, ArrowUp, ArrowDown, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { ONBOARDING_TEMPLATE_OPTIONS, type OnboardingTemplateKey, getOnboardingTemplate } from '@/lib/onboardingTaskTemplates';

type Row = {
  id?: string;
  template_key: OnboardingTemplateKey;
  category: string;
  parent_title?: string | null;
  title: string;
  sort_order: number;
  _dirty?: boolean;
  _new?: boolean;
};

export function OnboardingTemplatesSection() {
  const [templateKey, setTemplateKey] = useState<OnboardingTemplateKey>('standard');
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletedIds, setDeletedIds] = useState<string[]>([]);

  const load = async (key: OnboardingTemplateKey) => {
    setLoading(true);
    const { data, error } = await supabase
      .from('onboarding_template_items' as any)
      .select('id, template_key, category, parent_title, title, sort_order')
      .eq('template_key', key)
      .order('sort_order', { ascending: true });
    setLoading(false);
    if (error) {
      toast.error('Failed to load template');
      return;
    }
    setRows((data as any[]) ?? []);
    setDeletedIds([]);
  };

  useEffect(() => { load(templateKey); }, [templateKey]);

  const categories = useMemo(() => Array.from(new Set(rows.map(r => r.category))), [rows]);

  const update = (idx: number, patch: Partial<Row>) => {
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, ...patch, _dirty: true } : r));
  };

  const addRow = (category?: string) => {
    const maxSort = rows.reduce((m, r) => Math.max(m, r.sort_order || 0), 0);
    setRows(prev => [...prev, {
      template_key: templateKey,
      category: category || categories[0] || 'New Section',
      title: '',
      sort_order: maxSort + 1,
      _new: true,
      _dirty: true,
    }]);
  };

  const addCategory = () => {
    const name = prompt('New section name?');
    if (!name) return;
    addRow(name);
  };

  const removeRow = (idx: number) => {
    setRows(prev => {
      const r = prev[idx];
      if (r.id) setDeletedIds(d => [...d, r.id!]);
      return prev.filter((_, i) => i !== idx);
    });
  };

  const move = (idx: number, dir: -1 | 1) => {
    setRows(prev => {
      const next = [...prev];
      const j = idx + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[idx], next[j]] = [next[j], next[idx]];
      // Re-number sort_order sequentially
      return next.map((r, i) => ({ ...r, sort_order: i + 1, _dirty: true }));
    });
  };

  const renumber = () => {
    setRows(prev => prev.map((r, i) => ({ ...r, sort_order: i + 1, _dirty: true })));
    toast.success('Renumbered — click Save to persist');
  };

  const save = async () => {
    setSaving(true);
    try {
      // Deletes
      if (deletedIds.length) {
        const { error } = await supabase
          .from('onboarding_template_items' as any)
          .delete()
          .in('id', deletedIds);
        if (error) throw error;
      }
      // Inserts
      const inserts = rows.filter(r => r._new && r.title.trim()).map(r => ({
        template_key: r.template_key,
        category: r.category,
        parent_title: r.parent_title || null,
        title: r.title,
        sort_order: r.sort_order,
      }));
      if (inserts.length) {
        const { error } = await supabase.from('onboarding_template_items' as any).insert(inserts);
        if (error) throw error;
      }
      // Updates
      const updates = rows.filter(r => !r._new && r._dirty && r.id);
      for (const r of updates) {
        const { error } = await supabase
          .from('onboarding_template_items' as any)
          .update({ category: r.category, parent_title: r.parent_title || null, title: r.title, sort_order: r.sort_order })
          .eq('id', r.id!);
        if (error) throw error;
      }
      toast.success('Template saved');
      await load(templateKey);
    } catch (e: any) {
      toast.error(`Save failed: ${e.message || e}`);
    } finally {
      setSaving(false);
    }
  };

  const resetToDefault = async () => {
    if (!confirm(`Replace current "${templateKey}" template with the bundled default? This deletes your customizations.`)) return;
    setSaving(true);
    try {
      await supabase.from('onboarding_template_items' as any).delete().eq('template_key', templateKey);
      const defaults = getOnboardingTemplate(templateKey).map(t => ({ ...t, template_key: templateKey }));
      const { error } = await supabase.from('onboarding_template_items' as any).insert(defaults);
      if (error) throw error;
      toast.success('Reset to default');
      await load(templateKey);
    } catch (e: any) {
      toast.error(`Reset failed: ${e.message || e}`);
    } finally {
      setSaving(false);
    }
  };

  const dirty = rows.some(r => r._dirty || r._new) || deletedIds.length > 0;

  // Group rows by category for display
  const grouped = useMemo(() => {
    const map = new Map<string, { row: Row; idx: number }[]>();
    rows.forEach((r, idx) => {
      const arr = map.get(r.category) ?? [];
      arr.push({ row: r, idx });
      map.set(r.category, arr);
    });
    return Array.from(map.entries());
  }, [rows]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Onboarding Templates</CardTitle>
        <CardDescription>
          Edit the checklist that auto-generates as Project Management tasks & subtasks when a client is onboarded.
          Sections become parent tasks (routed to pods); items become subtasks.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Select value={templateKey} onValueChange={(v) => setTemplateKey(v as OnboardingTemplateKey)}>
            <SelectTrigger className="w-[260px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ONBOARDING_TEMPLATE_OPTIONS.map(opt => (
                <SelectItem key={opt.key} value={opt.key}>{opt.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Badge variant="outline">{rows.length} items · {categories.length} sections</Badge>
          <div className="ml-auto flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={addCategory}>
              <Plus className="h-4 w-4 mr-1" /> Section
            </Button>
            <Button size="sm" variant="outline" onClick={() => addRow()}>
              <Plus className="h-4 w-4 mr-1" /> Item
            </Button>
            <Button size="sm" variant="outline" onClick={renumber}>
              <RefreshCw className="h-4 w-4 mr-1" /> Renumber
            </Button>
            <Button size="sm" variant="ghost" onClick={resetToDefault} disabled={saving}>
              Reset to default
            </Button>
            <Button size="sm" onClick={save} disabled={!dirty || saving}>
              <Save className="h-4 w-4 mr-1" /> {saving ? 'Saving…' : 'Save changes'}
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="text-sm text-muted-foreground py-8 text-center">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="text-sm text-muted-foreground py-8 text-center">
            No items yet. Add a section, then add items underneath.
          </div>
        ) : (
          <div className="space-y-6">
            {grouped.map(([cat, items]) => (
              <div key={cat} className="border rounded-lg p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <Input
                    value={cat}
                    onChange={(e) => {
                      const newCat = e.target.value;
                      setRows(prev => prev.map(r => r.category === cat ? { ...r, category: newCat, _dirty: true } : r));
                    }}
                    className="h-8 font-semibold w-[280px]"
                  />
                  <Badge variant="secondary">{items.length}</Badge>
                  <Button size="sm" variant="ghost" className="ml-auto" onClick={() => addRow(cat)}>
                    <Plus className="h-3 w-3 mr-1" /> Add item
                  </Button>
                </div>
                <div className="space-y-1">
                  {items.map(({ row, idx }) => (
                    <div key={row.id ?? `new-${idx}`} className="flex items-center gap-2">
                      <Input
                        type="number"
                        value={row.sort_order}
                        onChange={(e) => update(idx, { sort_order: parseInt(e.target.value || '0', 10) })}
                        className="h-8 w-16"
                      />
                      <Input
                        value={row.parent_title || ''}
                        onChange={(e) => update(idx, { parent_title: e.target.value })}
                        placeholder="Nest under (optional)"
                        className="h-8 w-48"
                      />
                      <Input
                        value={row.title}
                        onChange={(e) => update(idx, { title: e.target.value })}
                        placeholder="Task title"
                        className="h-8 flex-1"
                      />
                      <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => move(idx, -1)}>
                        <ArrowUp className="h-3 w-3" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => move(idx, 1)}>
                        <ArrowDown className="h-3 w-3" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => removeRow(idx)}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}