import { useState, useRef, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, Pencil } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";

interface Props {
  clientId: string;
  level: "campaign" | "adset";
  rowId: string;
  // Stored value in DOLLARS (DB convention from sync). null when no budget set.
  dailyBudget: number | null;
}

export function EditableBudgetCell({ clientId, level, rowId, dailyBudget }: Props) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(dailyBudget != null ? String(dailyBudget) : "");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setValue(dailyBudget != null ? String(dailyBudget) : "");
  }, [dailyBudget]);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  // Query keys touched by the campaigns / ad sets tables — we optimistically
  // patch each list so the new $ amount appears instantly while Meta's API call resolves.
  const AFFECTED_KEYS = [
    ["admin-meta-campaigns"],
    ["admin-meta-adsets"],
    ["meta-campaigns"],
    ["meta-ad-sets"],
  ] as const;

  const save = useMutation({
    mutationFn: async (dollars: number) => {
      if (!dollars || dollars < 1) throw new Error("Budget must be ≥ $1");
      const { data, error } = await supabase.functions.invoke("update-meta-budget", {
        body: { clientId, level, rowId, dailyBudgetCents: Math.round(dollars * 100) },
      });
      if (error || !data?.success) throw new Error(data?.error || error?.message || "Failed");
      return data;
    },
    onMutate: async (dollars: number) => {
      // Cancel pending refetches so they can't overwrite our optimistic value.
      await Promise.all(AFFECTED_KEYS.map(k => qc.cancelQueries({ queryKey: k as unknown as any[] })));
      const snapshots: Array<[readonly string[], unknown]> = [];
      AFFECTED_KEYS.forEach((k) => {
        const entries = qc.getQueriesData({ queryKey: k as unknown as any[] });
        for (const [queryKey, data] of entries) snapshots.push([queryKey as unknown as readonly string[], data]);
        qc.setQueriesData({ queryKey: k as unknown as any[] }, (old: any) => {
          if (!Array.isArray(old)) return old;
          return old.map((r: any) => (r?.id === rowId ? { ...r, daily_budget: dollars } : r));
        });
      });
      setEditing(false);
      return { snapshots };
    },
    onSuccess: () => {
      toast.success("Budget updated on Meta");
    },
    onError: (e: any, _vars, ctx: any) => {
      // Roll back to pre-mutation snapshots
      if (ctx?.snapshots) for (const [k, v] of ctx.snapshots) qc.setQueryData(k as any, v);
      toast.error(e?.message || "Failed to update budget");
      setValue(dailyBudget != null ? String(dailyBudget) : "");
    },
    onSettled: () => {
      AFFECTED_KEYS.forEach(k => qc.invalidateQueries({ queryKey: k as unknown as any[] }));
    },
  });

  const commit = () => {
    const dollars = Number(value);
    if (!dollars || dollars < 1) {
      toast.error("Budget must be ≥ $1");
      setValue(dailyBudget != null ? String(dailyBudget) : "");
      setEditing(false);
      return;
    }
    if (dollars === dailyBudget) { setEditing(false); return; }
    save.mutate(dollars);
  };

  if (editing) {
    return (
      <div className="inline-flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
        <span className="text-xs text-muted-foreground">$</span>
        <Input
          ref={inputRef}
          type="number"
          min="1"
          step="1"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") { setValue(dailyBudget != null ? String(dailyBudget) : ""); setEditing(false); }
          }}
          disabled={save.isPending}
          className="h-7 w-20 text-xs px-1.5"
        />
        {save.isPending && <Loader2 className="h-3 w-3 animate-spin" />}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); setEditing(true); }}
      className="inline-flex items-center gap-1 text-xs hover:bg-muted/60 rounded px-1.5 py-0.5 group"
      title="Click to edit daily budget on Meta"
    >
      <span className="tabular-nums font-medium">
        {dailyBudget != null ? `$${Number(dailyBudget).toLocaleString()}` : "—"}
      </span>
      <Pencil className="h-2.5 w-2.5 opacity-0 group-hover:opacity-60" />
    </button>
  );
}