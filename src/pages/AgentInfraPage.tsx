import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2, Search, Cpu, ArrowLeft } from "lucide-react";
import { Link } from "react-router-dom";
import { useAgencyAgents } from "@/hooks/useAgencyAgents";
import { useClients } from "@/hooks/useClients";
import { AgentProfilePanel } from "@/components/agents/AgentProfilePanel";
import { AgentConnectorsPanel } from "@/components/agents/AgentConnectorsPanel";
import { ClientScopePicker } from "@/components/agents/ClientScopePicker";

export default function AgentInfraPage() {
  const { data: agents = [], isLoading } = useAgencyAgents();
  const { data: clients = [] } = useClients();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [clientId, setClientId] = useState<string | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    if (!selectedId && agents.length) setSelectedId(agents[0].id);
  }, [agents, selectedId]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return agents;
    return agents.filter((a) => `${a.name} ${a.role}`.toLowerCase().includes(needle));
  }, [agents, q]);

  const selected = agents.find((a) => a.id === selectedId) || null;
  const clientName = clients.find((c) => c.id === clientId)?.name;

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="border-b bg-background/80 backdrop-blur sticky top-0 z-20">
        <div className="max-w-[1600px] mx-auto px-4 py-3 flex items-center gap-3 flex-wrap">
          <Button asChild variant="ghost" size="sm">
            <Link to="/"><ArrowLeft className="h-4 w-4 mr-1" /> Dashboard</Link>
          </Button>
          <div className="flex items-center gap-2">
            <Cpu className="h-5 w-5 text-primary" />
            <h1 className="text-lg font-semibold">Agent Infrastructure</h1>
          </div>
          <Badge variant="secondary" className="text-[10px]">{agents.length} agents</Badge>
          <div className="ml-auto w-full sm:w-72">
            <ClientScopePicker clientId={clientId} onChange={setClientId} clients={clients} />
          </div>
        </div>
      </header>

      <main className="max-w-[1600px] mx-auto px-4 py-4 grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-4">
        <Card className="p-3 h-fit lg:sticky lg:top-[92px] space-y-2">
          <div className="relative">
            <Search className="absolute left-2 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search agents" className="h-8 pl-7 text-xs" />
          </div>
          {isLoading ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground py-4">
              <Loader2 className="h-3 w-3 animate-spin" /> Loading agents…
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-xs text-muted-foreground py-4 text-center">No agents match “{q}”.</p>
          ) : (
            <div className="space-y-1">
              {filtered.map((a) => (
                <button
                  key={a.id}
                  onClick={() => setSelectedId(a.id)}
                  className={`w-full text-left rounded-lg px-2 py-2 flex items-center gap-2 transition ${
                    a.id === selectedId ? "bg-primary/10 border border-primary/30" : "hover:bg-muted/60 border border-transparent"
                  }`}
                >
                  <span className="text-lg">{a.icon || "🤖"}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-medium truncate">{a.name}</span>
                    <span className="block text-[10px] text-muted-foreground truncate">{a.role}</span>
                  </span>
                  {!a.is_active && <Badge variant="outline" className="text-[9px]">off</Badge>}
                </button>
              ))}
            </div>
          )}
        </Card>

        <div className="space-y-4 min-w-0">
          {selected ? (
            <>
              <AgentProfilePanel
                key={`${selected.id}-${clientId ?? "master"}`}
                agent={selected}
                mode={clientId ? "client" : "master"}
                clientId={clientId}
                clientName={clientName}
              />
              <AgentConnectorsPanel agentId={selected.id} clientId={clientId} clientName={clientName} />
            </>
          ) : (
            !isLoading && (
              <Card className="p-10 text-center text-sm text-muted-foreground">
                No agents configured yet.
              </Card>
            )
          )}
        </div>
      </main>
    </div>
  );
}
