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

  const save = useMutation({
    mutationFn: async () => {
      const dollars = Number(value);
      if (!dollars || dollars < 1) throw new Error("Budget must be ≥ $1");
      const { data, error } = await supabase.functions.invoke("update-meta-budget", {
        body: { clientId, level, rowId, dailyBudgetCents: Math.round(dollars * 100) },
      });
      if (error || !data?.success) throw new Error(data?.error || error?.message || "Failed");
      return data;
    },
    onSuccess: () => {
      toast.success("Budget updated on Meta");
      qc.invalidateQueries({ queryKey: ["admin-meta-campaigns"] });
      qc.invalidateQueries({ queryKey: ["admin-meta-adsets"] });
      qc.invalidateQueries({ queryKey: ["meta-campaigns"] });
      qc.invalidateQueries({ queryKey: ["meta-ad-sets"] });
      setEditing(false);
    },
    onError: (e: any) => {
      toast.error(e.message || "Failed to update budget");
      setValue(dailyBudget != null ? String(dailyBudget) : "");
    },
  });

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
          onBlur={() => { if (Number(value) !== dailyBudget) save.mutate(); else setEditing(false); }}
          onKeyDown={(e) => {
            if (e.key === "Enter") save.mutate();
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