import { useState, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Bot, BookOpen, Crown, User as UserIcon, ChevronRight, Layers } from "lucide-react";
import { useAgencyAgents } from "@/hooks/useAgencyAgents";
import { AgentProfilePanel } from "./AgentProfilePanel";
import { EffectiveAgentView } from "./EffectiveAgentView";

/**
 * Per-client agent surface.
 *
 * The 6 master agency agents are auto-mapped to every client. There are two
 * tabs with identical editing surfaces:
 *   • "Agents"        — edits the master agency agent (shared across clients)
 *   • "Client Folder" — edits the per-client addendum (memory + instructions
 *                       overrides scoped to this client only)
 *
 * Both tabs render the same <AgentProfilePanel> component so the editing
 * abilities are identical; only the persistence scope differs.
 */
export function ClientAgentsManager({ clientId, clientName }: { clientId: string; clientName: string }) {
  const { data: agents = [], isLoading } = useAgencyAgents();
  const coreAgents = useMemo(
    () => agents.filter((a) => a.is_active !== false).slice(0, 8),
    [agents],
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = coreAgents.find((a) => a.id === selectedId) || coreAgents[0] || null;

  return (
    <div className="flex flex-col gap-4 h-full overflow-y-auto p-1">
      <Tabs defaultValue="agents" className="w-full">
        <TabsList>
          <TabsTrigger value="agents"><Crown className="h-3.5 w-3.5 mr-1" />Agents</TabsTrigger>
          <TabsTrigger value="folder"><BookOpen className="h-3.5 w-3.5 mr-1" />Client Folder</TabsTrigger>
          <TabsTrigger value="effective"><Layers className="h-3.5 w-3.5 mr-1" />Effective Config</TabsTrigger>
        </TabsList>

        {(["agents", "folder", "effective"] as const).map((tab) => {
          const mode: "master" | "client" = tab === "agents" ? "master" : "client";
          return (
            <TabsContent key={tab} value={tab} className="mt-3">
              {isLoading ? (
                <p className="text-sm text-muted-foreground p-4">Loading agents…</p>
              ) : coreAgents.length === 0 ? (
                <Card className="p-6 text-center text-sm text-muted-foreground">
                  No agency agents seeded yet.
                </Card>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                  <div className="md:col-span-1 space-y-2">
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground px-1">
                      {tab === "agents"
                        ? "Master agency profile"
                        : tab === "folder"
                        ? `Client folder · ${clientName}`
                        : `Effective config · ${clientName}`}
                    </p>
                    {coreAgents.map((a) => (
                      <Card
                        key={a.id}
                        onClick={() => setSelectedId(a.id)}
                        className={`p-3 cursor-pointer transition-all hover:border-primary/40 ${
                          selected?.id === a.id ? "border-primary ring-1 ring-primary/30" : ""
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-xl">{a.icon || "🤖"}</span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1">
                              <p className="text-sm font-semibold truncate">{a.name}</p>
                              <Badge variant="outline" className="text-[9px] h-4">
                                {tab === "agents" ? (
                                  <><Crown className="h-2.5 w-2.5 mr-0.5" />Master</>
                                ) : tab === "folder" ? (
                                  <><UserIcon className="h-2.5 w-2.5 mr-0.5" />Client</>
                                ) : (
                                  <><Layers className="h-2.5 w-2.5 mr-0.5" />Effective</>
                                )}
                              </Badge>
                            </div>
                            <p className="text-[11px] text-muted-foreground truncate">{a.role}</p>
                          </div>
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        </div>
                      </Card>
                    ))}
                  </div>
                  <div className="md:col-span-3">
                    {selected && tab === "effective" ? (
                      <EffectiveAgentView
                        key={`effective:${selected.id}`}
                        agent={selected}
                        clientId={clientId}
                        clientName={clientName}
                      />
                    ) : selected ? (
                      <AgentProfilePanel
                        key={`${tab}:${selected.id}`}
                        agent={selected}
                        mode={mode}
                        clientId={mode === "client" ? clientId : null}
                        clientName={clientName}
                      />
                    ) : null}
                  </div>
                </div>
              )}
            </TabsContent>
          );
        })}
      </Tabs>
    </div>
  );
}