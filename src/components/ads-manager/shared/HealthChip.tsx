import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Trophy, AlertTriangle, Sparkles, Minus } from "lucide-react";
import { type AdHealth, HEALTH_LABEL } from "./healthSignals";

const STYLES: Record<AdHealth, { className: string; Icon: any; tip: string }> = {
  winner: {
    className: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
    Icon: Trophy,
    tip: "ROAS > 3, or high spend + strong CTR with funded leads",
  },
  underperforming: {
    className: "bg-destructive/15 text-destructive border-destructive/30",
    Icon: AlertTriangle,
    tip: "Spent > $500, no funded yet, > 7 days old — consider pausing",
  },
  learning: {
    className: "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30",
    Icon: Sparkles,
    tip: "New or low spend — too early to judge",
  },
  neutral: {
    className: "bg-muted text-muted-foreground border-border",
    Icon: Minus,
    tip: "Steady performance — keep monitoring",
  },
};

export function HealthChip({ health, compact = false }: { health: AdHealth; compact?: boolean }) {
  const s = STYLES[health];
  const { Icon } = s;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge variant="outline" className={`gap-1 text-[10px] font-medium ${s.className}`}>
          <Icon className="h-3 w-3" />
          {!compact && HEALTH_LABEL[health]}
        </Badge>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs max-w-[200px]">{s.tip}</TooltipContent>
    </Tooltip>
  );
}