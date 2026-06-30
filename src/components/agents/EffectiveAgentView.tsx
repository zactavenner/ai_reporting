import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Crown, User as UserIcon, Layers } from "lucide-react";
import { type AgencyAgent, useClientAgentOverride } from "@/hooks/useAgencyAgents";
import { CONNECTOR_REGISTRY, getModelInfo } from "@/lib/modelRegistry";

/**
 * Read-only view of the effective agent configuration the runtime sees for a
 * given client: master defaults overlaid with the client folder overrides.
 *
 * Merge rules (must match the edge runtime):
 *   • identity/model/connectors/files  → master only (no client-scoped override)
 *   • memory_md / instructions_md      → master + "\n\n" + client addendum
 *                                        (empty addendum = master verbatim)
 */
export function EffectiveAgentView({
  agent,
  clientId,
  clientName,
}: {
  agent: AgencyAgent;
  clientId: string;
  clientName?: string;
}) {
  const { data: override, isLoading } = useClientAgentOverride(clientId, agent.id);

  const masterMemory = agent.memory_md || "";
  const masterInstr = agent.instructions_md || "";
  const clientMemory = override?.memory_md || "";
  const clientInstr = override?.instructions_md || "";

  const effectiveMemory = [masterMemory, clientMemory].filter(Boolean).join("\n\n");
  const effectiveInstr = [masterInstr, clientInstr].filter(Boolean).join("\n\n");

  const modelInfo = getModelInfo(agent.default_model);
  const connectors = agent.connectors || [];
  const fallbacks = agent.fallback_models || [];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
      <Card className="p-4 lg:col-span-2 space-y-3 h-fit">
        <div className="flex items-start gap-3">
          <span className="text-3xl">{agent.icon || "🤖"}</span>
          <div className="flex-1 min-w-0 space-y-1">
            <div className="flex items-center gap-2">
              <h3 className="text-base font-bold truncate">{agent.name}</h3>
              <Badge className="text-[10px]">
                <Layers className="h-2.5 w-2.5 mr-0.5" /> Effective · {clientName || "Client"}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">{agent.role}</p>
            <p className="text-[10px] text-muted-foreground">
              Master defaults overlaid with this client's folder overrides — exactly what the runtime sends to the model.
            </p>
          </div>
        </div>

        <Separator />

        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">
            Primary model <span className="normal-case text-muted-foreground/70">· master scope</span>
          </p>
          <p className="text-xs">{modelInfo?.label || agent.default_model}</p>
          {modelInfo && (
            <p className="text-[10px] text-muted-foreground mt-0.5">
              {modelInfo.provider} · {modelInfo.contextTokens.toLocaleString()} token context
            </p>
          )}
        </div>

        {fallbacks.length > 0 && (
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">Fallback chain</p>
            <ol className="text-[11px] text-muted-foreground list-decimal list-inside space-y-0.5">
              {fallbacks.map((m, i) => (
                <li key={`${m}-${i}`}>{getModelInfo(m)?.label || m}</li>
              ))}
            </ol>
          </div>
        )}

        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">Connectors</p>
          <div className="flex flex-wrap gap-1">
            {connectors.length === 0 && (
              <span className="text-[11px] text-muted-foreground">None configured</span>
            )}
            {connectors.map((c) => {
              const meta = CONNECTOR_REGISTRY[c];
              return (
                <Badge key={c} variant="outline" className="text-[10px]">
                  {meta ? `${meta.emoji} ${meta.label}` : c}
                </Badge>
              );
            })}
          </div>
        </div>
      </Card>

      <div className="lg:col-span-3 space-y-4">
        <Card className="p-4 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold">Memory · effective</p>
            <div className="flex items-center gap-1">
              <Badge variant="outline" className="text-[10px]">
                <Crown className="h-2.5 w-2.5 mr-0.5" /> master {masterMemory ? `${masterMemory.length}c` : "—"}
              </Badge>
              <Badge variant="secondary" className="text-[10px]">
                <UserIcon className="h-2.5 w-2.5 mr-0.5" /> client {clientMemory ? `${clientMemory.length}c` : "—"}
              </Badge>
            </div>
          </div>
          {isLoading ? (
            <p className="text-xs text-muted-foreground">Loading override…</p>
          ) : effectiveMemory ? (
            <pre className="text-xs whitespace-pre-wrap font-mono bg-muted/30 rounded p-2 max-h-72 overflow-y-auto">
              {effectiveMemory}
            </pre>
          ) : (
            <p className="text-xs text-muted-foreground">No memory set at either scope.</p>
          )}
        </Card>

        <Card className="p-4 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold">Instructions · effective</p>
            <div className="flex items-center gap-1">
              <Badge variant="outline" className="text-[10px]">
                <Crown className="h-2.5 w-2.5 mr-0.5" /> master {masterInstr ? `${masterInstr.length}c` : "—"}
              </Badge>
              <Badge variant="secondary" className="text-[10px]">
                <UserIcon className="h-2.5 w-2.5 mr-0.5" /> client {clientInstr ? `${clientInstr.length}c` : "—"}
              </Badge>
            </div>
          </div>
          {isLoading ? (
            <p className="text-xs text-muted-foreground">Loading override…</p>
          ) : effectiveInstr ? (
            <pre className="text-xs whitespace-pre-wrap font-mono bg-muted/30 rounded p-2 max-h-72 overflow-y-auto">
              {effectiveInstr}
            </pre>
          ) : (
            <p className="text-xs text-muted-foreground">No instructions set at either scope.</p>
          )}
        </Card>
      </div>
    </div>
  );
}