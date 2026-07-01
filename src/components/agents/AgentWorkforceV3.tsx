import { useState, useMemo } from "react";
import { Bot, Crown, ChevronRight, Plus } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useAgencyAgents, useCreateCustomAgent, AGENCY_AGENT_MODELS } from "@/hooks/useAgencyAgents";
import { AgentProfilePanel } from "./AgentProfilePanel";
import { useAgencyAgentFiles, totalTokensForFiles } from "@/hooks/useAgencyAgentFiles";
import { getModelInfo } from "@/lib/modelRegistry";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

function AgentCard({
  agent,
  selected,
  onClick,
}: {
  agent: any;
  selected: boolean;
  onClick: () => void;
}) {
  const { data: files = [] } = useAgencyAgentFiles(agent.id, null);
  const capacity = getModelInfo(agent.default_model)?.contextTokens || 200_000;
  const used = totalTokensForFiles(files);
  const pct = Math.min(100, Math.round((used / Math.max(capacity, 1)) * 100));
  return (
    <Card
      onClick={onClick}
      className={`p-3 cursor-pointer transition-all hover:border-primary/40 ${
        selected ? "border-primary ring-1 ring-primary/30" : ""
      }`}
    >
      <div className="flex items-center gap-3">
        <span className="text-2xl">{agent.icon || "🤖"}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold truncate">{agent.name}</p>
            <Badge variant="outline" className="text-[9px] h-4"><Crown className="h-2.5 w-2.5 mr-0.5" />Master</Badge>
          </div>
          <p className="text-[11px] text-muted-foreground truncate">{agent.role}</p>
          <div className="mt-1.5 h-1 rounded-full bg-muted overflow-hidden">
            <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
          </div>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            {pct}% capacity · {files.length} file{files.length === 1 ? "" : "s"}
          </p>
        </div>
        <ChevronRight className="h-4 w-4 text-muted-foreground" />
      </div>
    </Card>
  );
}

export function AgentWorkforceV3() {
  const { data: agents = [], isLoading } = useAgencyAgents();
  const createCustom = useCreateCustomAgent();
  const coreAgents = useMemo(
    () => agents.filter((a) => a.is_active !== false && !a.archived_at),
    [agents]
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = coreAgents.find((a) => a.id === selectedId) || coreAgents[0] || null;
  const [showNew, setShowNew] = useState(false);
  const [newDraft, setNewDraft] = useState({
    name: "",
    role: "",
    icon: "🤖",
    default_model: "nvidia/nemotron-3-ultra-550b-a55b:free",
    instructions_md: "",
  });

  return (
    <Card className="p-5 bg-gradient-to-br from-primary/5 via-transparent to-transparent">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Bot className="h-5 w-5 text-primary" /> Agent Workforce
          </h2>
          <p className="text-xs text-muted-foreground">
            Master profiles below trickle into every client. Per-client overrides live in <strong>AI Studio → Agents</strong>.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-[10px]">{coreAgents.length} agents</Badge>
          <Button size="sm" variant="outline" onClick={() => setShowNew(true)}>
            <Plus className="h-3.5 w-3.5 mr-1" /> New agent
          </Button>
        </div>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading agents…</p>
      ) : coreAgents.length === 0 ? (
        <p className="text-sm text-muted-foreground">No agency agents seeded yet.</p>
      ) : (
        <Tabs value={selected?.id || ""} onValueChange={setSelectedId}>
          <TabsList className="flex flex-wrap gap-1 h-auto bg-transparent p-0">
            {coreAgents.map((a) => (
              <TabsTrigger key={a.id} value={a.id} className="text-xs data-[state=active]:bg-primary/10">
                <span className="mr-1">{a.icon || "🤖"}</span>{a.name}
              </TabsTrigger>
            ))}
          </TabsList>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mt-4">
            <div className="md:col-span-1 space-y-2">
              {coreAgents.map((a) => (
                <AgentCard
                  key={a.id}
                  agent={a}
                  selected={selected?.id === a.id}
                  onClick={() => setSelectedId(a.id)}
                />
              ))}
            </div>
            <div className="md:col-span-3">
              {coreAgents.map((a) => (
                <TabsContent key={a.id} value={a.id} className="m-0">
                  <AgentProfilePanel agent={a} mode="master" />
                </TabsContent>
              ))}
              {!coreAgents.some((a) => a.id === selected?.id) && selected && (
                <AgentProfilePanel agent={selected} mode="master" />
              )}
            </div>
          </div>
        </Tabs>
      )}

      <Dialog open={showNew} onOpenChange={setShowNew}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Create custom master agent</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-[80px_1fr] gap-2">
              <div>
                <Label className="text-xs">Icon</Label>
                <Input value={newDraft.icon} onChange={(e) => setNewDraft({ ...newDraft, icon: e.target.value })} className="text-center text-2xl" />
              </div>
              <div>
                <Label className="text-xs">Name</Label>
                <Input value={newDraft.name} onChange={(e) => setNewDraft({ ...newDraft, name: e.target.value })} placeholder="e.g. Athena (Research Analyst)" />
              </div>
            </div>
            <div>
              <Label className="text-xs">Role / one-liner</Label>
              <Input value={newDraft.role} onChange={(e) => setNewDraft({ ...newDraft, role: e.target.value })} placeholder="Deep research and competitor intel" />
            </div>
            <div>
              <Label className="text-xs">Primary model</Label>
              <Select value={newDraft.default_model} onValueChange={(v) => setNewDraft({ ...newDraft, default_model: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {AGENCY_AGENT_MODELS.map((m) => (
                    <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Instructions</Label>
              <Textarea
                rows={5}
                className="text-xs font-mono"
                placeholder="How should this agent behave? What SOPs must it follow?"
                value={newDraft.instructions_md}
                onChange={(e) => setNewDraft({ ...newDraft, instructions_md: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowNew(false)}>Cancel</Button>
            <Button
              disabled={!newDraft.name.trim() || !newDraft.role.trim() || createCustom.isPending}
              onClick={async () => {
                const created = await createCustom.mutateAsync({ ...newDraft });
                setShowNew(false);
                setNewDraft({ name: "", role: "", icon: "🤖", default_model: newDraft.default_model, instructions_md: "" });
                if (created?.id) setSelectedId(created.id);
              }}
            >
              Create agent
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}