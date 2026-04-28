import { Badge } from "@/components/ui/badge";
import { Trophy, AlertTriangle, Sparkles, LayoutGrid } from "lucide-react";
import { type AdHealth } from "./healthSignals";

export type HealthFilter = "all" | AdHealth;

interface Props {
  value: HealthFilter;
  onChange: (v: HealthFilter) => void;
  counts: Record<HealthFilter, number>;
}

const OPTS: Array<{ value: HealthFilter; label: string; Icon: any; activeClass: string }> = [
  { value: "all", label: "All", Icon: LayoutGrid, activeClass: "bg-foreground text-background" },
  { value: "winner", label: "Winners", Icon: Trophy, activeClass: "bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border-emerald-500/40" },
  { value: "underperforming", label: "Pause candidates", Icon: AlertTriangle, activeClass: "bg-destructive/20 text-destructive border-destructive/40" },
  { value: "learning", label: "Learning", Icon: Sparkles, activeClass: "bg-blue-500/20 text-blue-700 dark:text-blue-300 border-blue-500/40" },
];

export function HealthFilterBar({ value, onChange, counts }: Props) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {OPTS.map(({ value: v, label, Icon, activeClass }) => {
        const active = value === v;
        return (
          <button
            key={v}
            type="button"
            onClick={() => onChange(v)}
            className="focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-full"
          >
            <Badge
              variant="outline"
              className={`gap-1.5 cursor-pointer transition-colors text-xs h-7 px-2.5 ${active ? activeClass : "hover:bg-muted/60"}`}
            >
              <Icon className="h-3 w-3" />
              {label}
              <span className="ml-0.5 tabular-nums opacity-70">{counts[v] ?? 0}</span>
            </Badge>
          </button>
        );
      })}
    </div>
  );
}