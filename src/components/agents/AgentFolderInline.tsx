import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Bot, ChevronRight } from "lucide-react";
import { ClientAgentsManager } from "./ClientAgentsManager";
import { useClientAgents, useClientAgentProfile } from "@/hooks/useClientAgents";

export function AgentFolderInline({ clientId, clientName }: { clientId: string; clientName: string }) {
  const [open, setOpen] = useState(false);
  const { data: agents = [] } = useClientAgents(clientId);
  const { data: profile } = useClientAgentProfile(clientId);
  const profileSet = !!profile?.profile_md?.trim();

  return (
    <>
      <Card className="p-4 bg-gradient-to-br from-primary/5 to-transparent border-primary/20">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-primary/10 grid place-items-center">
            <Bot className="h-5 w-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold">Agent Folder</h3>
              <Badge variant="outline" className="text-[10px]">
                {agents.length} {agents.length === 1 ? "agent" : "agents"}
              </Badge>
              {!profileSet && (
                <Badge variant="destructive" className="text-[10px]">profile empty</Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Who {clientName} is, their offers, private integrations, and the agents that work for them. Use <code className="px-1 py-0.5 rounded bg-muted">@handle</code> in AI Studio to summon any agent.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
            Manage <ChevronRight className="h-3.5 w-3.5 ml-1" />
          </Button>
        </div>
      </Card>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>Agent Folder — {clientName}</DialogTitle>
          </DialogHeader>
          <div className="flex-1 min-h-0 overflow-y-auto">
            <ClientAgentsManager clientId={clientId} clientName={clientName} />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}