import { useState } from "react";
import { ClientAgentsManager } from "@/components/agents/ClientAgentsManager";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Bot, Crown } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useAgencyAgents } from "@/hooks/useAgencyAgents";
import { AgentProfilePanel } from "@/components/agents/AgentProfilePanel";

export function AIStudioAgentsTab({ clientId, clientName }: { clientId: string; clientName: string }) {
  const { data: masters = [] } = useAgencyAgents();
  const visible = masters.filter((a) => a.is_active !== false).slice(0, 8);
  const [selectedId, setSelectedId] = useState<string | null>(visible[0]?.id || null);
  const selected = visible.find((a) => a.id === selectedId) || visible[0] || null;

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-6xl mx-auto p-4 space-y-4">
        <Card className="p-4 bg-gradient-to-br from-primary/5 to-transparent border-primary/20">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-primary/10 grid place-items-center">
              <Bot className="h-5 w-5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-semibold">Agents for {clientName}</h3>
              <p className="text-xs text-muted-foreground">
                These are your master agency agents — Memory & Instructions are read-only here (manage them in <strong>Agents</strong>). You can upload client-specific files and edit this client's brain & offers below.
              </p>
            </div>
          </div>
        </Card>

        {visible.length > 0 && selected && (
          <Card className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <Crown className="h-4 w-4 text-amber-500" />
              <h4 className="text-sm font-semibold">Inherited master agents</h4>
              <Badge variant="outline" className="text-[10px]">Agency-wide</Badge>
            </div>
            <Tabs value={selected.id} onValueChange={setSelectedId}>
              <TabsList className="flex flex-wrap gap-1 h-auto bg-transparent p-0 mb-3">
                {visible.map((a) => (
                  <TabsTrigger key={a.id} value={a.id} className="text-xs data-[state=active]:bg-primary/10">
                    <span className="mr-1">{a.icon || "🤖"}</span>{a.name}
                  </TabsTrigger>
                ))}
              </TabsList>
              {visible.map((a) => (
                <TabsContent key={a.id} value={a.id} className="m-0">
                  <AgentProfilePanel agent={a} mode="client" clientId={clientId} clientName={clientName} />
                </TabsContent>
              ))}
            </Tabs>
          </Card>
        )}

        <ClientAgentsManager clientId={clientId} clientName={clientName} />
      </div>
    </div>
  );
}