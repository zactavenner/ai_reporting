import { ClientAgentsManager } from "@/components/agents/ClientAgentsManager";
import { Card } from "@/components/ui/card";
import { Bot } from "lucide-react";

export function AIStudioAgentsTab({ clientId, clientName }: { clientId: string; clientName: string }) {
  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto p-4 space-y-4">
        <Card className="p-4 bg-gradient-to-br from-primary/5 to-transparent border-primary/20">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-primary/10 grid place-items-center">
              <Bot className="h-5 w-5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-semibold">Agents for {clientName}</h3>
              <p className="text-xs text-muted-foreground">
                Edit who the client is, their offers, brand kit and private integrations, plus the specific Creatives / Copy / Strategy agents that work for them. Mention any agent in chat with <code className="px-1 py-0.5 rounded bg-muted">@handle</code>.
              </p>
            </div>
          </div>
        </Card>
        <ClientAgentsManager clientId={clientId} clientName={clientName} />
      </div>
    </div>
  );
}