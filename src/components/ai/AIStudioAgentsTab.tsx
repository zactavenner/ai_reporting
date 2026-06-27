import { ClientAgentsManager } from "@/components/agents/ClientAgentsManager";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Bot, Crown } from "lucide-react";
import { useAgents } from "@/hooks/useAgents";

export function AIStudioAgentsTab({ clientId, clientName }: { clientId: string; clientName: string }) {
  const { data: agencyAgents = [] } = useAgents();
  const masters = (agencyAgents as any[])
    .filter((a) => !a.client_id && (a.is_core || /jarvis|media buyer|creative agent|reporting agent|qa agent|sentry|canvas|pulse|scale/i.test(a.name || "")))
    .slice(0, 8);

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
                Master agency agents below run for every client. This client also has their own offers, brand kit, and additional Creatives / Copy / Strategy training. Mention any agent in chat with <code className="px-1 py-0.5 rounded bg-muted">@handle</code>.
              </p>
            </div>
          </div>
        </Card>

        {masters.length > 0 && (
          <Card className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <Crown className="h-4 w-4 text-amber-500" />
              <h4 className="text-sm font-semibold">Inherited master agents</h4>
              <Badge variant="outline" className="text-[10px]">Agency-wide</Badge>
              <span className="ml-auto text-[11px] text-muted-foreground">
                Manage in <strong>Agents → Agency Agents</strong>
              </span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {masters.map((a: any) => (
                <div
                  key={a.id}
                  className="px-2.5 py-2 rounded-md border bg-card/50 text-xs flex items-center gap-2"
                >
                  <span className="text-base">{a.icon || "🤖"}</span>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{a.name}</p>
                    <p className="text-[10px] text-muted-foreground truncate">
                      {a.model || "openrouter/owl-alpha"}
                    </p>
                  </div>
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      a.enabled ? "bg-emerald-500" : "bg-muted-foreground/40"
                    }`}
                  />
                </div>
              ))}
            </div>
            <p className="mt-3 text-[11px] text-muted-foreground">
              These run with this client's Brain + Offers as context. Customize per-client agents
              below to override or extend their behavior.
            </p>
          </Card>
        )}

        <ClientAgentsManager clientId={clientId} clientName={clientName} />
      </div>
    </div>
  );
}