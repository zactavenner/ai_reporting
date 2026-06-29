import { useEffect, useState } from "react";
import { Crown, User as UserIcon, Save, Edit3, Cable, Sparkles } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  type AgencyAgent,
  useUpdateAgencyAgent,
  AGENCY_AGENT_MODELS,
} from "@/hooks/useAgencyAgents";
import { useClientBrain, useUpsertClientBrain } from "@/hooks/useAgencyAgents";
import { useClientOffers } from "@/hooks/useClientOffers";
import { AgentFilesUploader } from "./AgentFilesUploader";
import { CONNECTOR_REGISTRY, MODEL_REGISTRY, getModelInfo } from "@/lib/modelRegistry";

type Mode = "master" | "client";

export function AgentProfilePanel({
  agent,
  mode,
  clientId = null,
  clientName,
}: {
  agent: AgencyAgent;
  mode: Mode;
  clientId?: string | null;
  clientName?: string;
}) {
  const update = useUpdateAgencyAgent();
  const [memory, setMemory] = useState(agent.memory_md || "");
  const [instructions, setInstructions] = useState(agent.instructions_md || "");
  const [model, setModel] = useState(agent.default_model || "openrouter/owl-alpha");
  const [editingMemory, setEditingMemory] = useState(false);
  const [editingInstr, setEditingInstr] = useState(false);

  useEffect(() => {
    setMemory(agent.memory_md || "");
    setInstructions(agent.instructions_md || "");
    setModel(agent.default_model || "openrouter/owl-alpha");
  }, [agent.id, agent.memory_md, agent.instructions_md, agent.default_model]);

  const isClientView = mode === "client" && !!clientId;

  // Client-only fields
  const { data: brain } = useClientBrain(isClientView ? clientId : null);
  const upsertBrain = useUpsertClientBrain();
  const { data: offers = [] } = useClientOffers(isClientView ? clientId! : "");
  const [brainDraft, setBrainDraft] = useState<{ voice: string; icp: string; brand_guidelines: string; do_not_say: string }>({
    voice: "", icp: "", brand_guidelines: "", do_not_say: "",
  });
  useEffect(() => {
    setBrainDraft({
      voice: brain?.voice || "",
      icp: brain?.icp || "",
      brand_guidelines: brain?.brand_guidelines || "",
      do_not_say: brain?.do_not_say || "",
    });
  }, [brain?.client_id]);

  const connectors = agent.connectors || [];
  const capabilityModels = (agent.capabilities?.models || []) as string[];
  const modelInfo = getModelInfo(model);

  const saveMaster = (patch: Partial<AgencyAgent>) => {
    update.mutate({ id: agent.id, ...patch });
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
      {/* LEFT — identity + scope */}
      <Card className="p-4 lg:col-span-2 space-y-3 h-fit">
        <div className="flex items-start gap-3">
          <span className="text-3xl">{agent.icon || "🤖"}</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-base font-bold truncate">{agent.name}</h3>
              {mode === "master" ? (
                <Badge className="text-[10px]"><Crown className="h-2.5 w-2.5 mr-0.5" /> Master</Badge>
              ) : (
                <Badge variant="secondary" className="text-[10px]"><UserIcon className="h-2.5 w-2.5 mr-0.5" /> {clientName || "Client"}</Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground">{agent.role}</p>
          </div>
        </div>

        <Separator />

        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">Model</p>
          {mode === "master" ? (
            <Select value={model} onValueChange={(v) => { setModel(v); saveMaster({ default_model: v }); }}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {AGENCY_AGENT_MODELS.map((m) => (
                  <SelectItem key={m.value} value={m.value} className="text-xs">{m.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <p className="text-xs">{modelInfo?.label || model}</p>
          )}
          {modelInfo && (
            <p className="text-[10px] text-muted-foreground mt-1">
              {modelInfo.provider} · {modelInfo.contextTokens.toLocaleString()} token context
            </p>
          )}
        </div>

        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1 flex items-center gap-1">
            <Cable className="h-3 w-3" /> Connectors
          </p>
          <div className="flex flex-wrap gap-1">
            {connectors.length === 0 && <span className="text-[11px] text-muted-foreground">None configured</span>}
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

        {capabilityModels.length > 0 && (
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1 flex items-center gap-1">
              <Sparkles className="h-3 w-3" /> Generative models available
            </p>
            <div className="flex flex-wrap gap-1">
              {capabilityModels.map((m) => {
                const info = MODEL_REGISTRY[m];
                return (
                  <Badge key={m} variant="secondary" className="text-[10px]">
                    {info ? `${info.label}` : m}
                  </Badge>
                );
              })}
            </div>
          </div>
        )}

        {isClientView && (
          <>
            <Separator />
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                Client offers ({offers.length})
              </p>
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {offers.length === 0 && <p className="text-[11px] text-muted-foreground">No offers for this client yet.</p>}
                {offers.map((o: any) => (
                  <div key={o.id} className="text-[11px] px-2 py-1 rounded bg-muted/40 truncate">
                    {o.name || o.title || "Untitled offer"}
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </Card>

      {/* RIGHT — Memory / Instructions / Files (+ client brain) */}
      <div className="lg:col-span-3 space-y-4">
        {/* Memory */}
        <Card className="p-4 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold">Memory</p>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-[10px]">
                {mode === "master" ? "Master · trickles to every client" : "Master (read-only here)"}
              </Badge>
              {mode === "master" && (
                <Button size="sm" variant="ghost" onClick={() => editingMemory ? (saveMaster({ memory_md: memory }), setEditingMemory(false)) : setEditingMemory(true)}>
                  {editingMemory ? <><Save className="h-3.5 w-3.5 mr-1" /> Save</> : <><Edit3 className="h-3.5 w-3.5 mr-1" /> Edit</>}
                </Button>
              )}
            </div>
          </div>
          {editingMemory && mode === "master" ? (
            <Textarea value={memory} onChange={(e) => setMemory(e.target.value)} rows={6} className="text-xs font-mono" placeholder="Purpose & context for this agent…" />
          ) : (
            <p className="text-xs whitespace-pre-wrap text-muted-foreground min-h-[3em]">
              {agent.memory_md || "No memory set."}
            </p>
          )}
        </Card>

        {/* Instructions */}
        <Card className="p-4 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold">Instructions</p>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-[10px]">
                {mode === "master" ? "Master · trickles to every client" : "Master (read-only here)"}
              </Badge>
              {mode === "master" && (
                <Button size="sm" variant="ghost" onClick={() => editingInstr ? (saveMaster({ instructions_md: instructions }), setEditingInstr(false)) : setEditingInstr(true)}>
                  {editingInstr ? <><Save className="h-3.5 w-3.5 mr-1" /> Save</> : <><Edit3 className="h-3.5 w-3.5 mr-1" /> Edit</>}
                </Button>
              )}
            </div>
          </div>
          {editingInstr && mode === "master" ? (
            <Textarea value={instructions} onChange={(e) => setInstructions(e.target.value)} rows={6} className="text-xs font-mono" placeholder="Add instructions to tailor responses…" />
          ) : (
            <p className="text-xs whitespace-pre-wrap text-muted-foreground min-h-[3em]">
              {agent.instructions_md || "Add instructions to tailor this agent's responses."}
            </p>
          )}
        </Card>

        {/* Files */}
        <Card className="p-4">
          <AgentFilesUploader
            agentId={agent.id}
            agentModel={model}
            clientId={isClientView ? clientId : null}
            scopeLabel={isClientView ? `${clientName || "Client"} addendum + Master` : "Master · trickles to every client"}
          />
        </Card>

        {/* Client brain (client view only) */}
        {isClientView && (
          <Card className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold">Client brain & details</p>
              <Button size="sm" variant="outline" onClick={() => upsertBrain.mutate({ client_id: clientId!, ...brainDraft })}>
                <Save className="h-3.5 w-3.5 mr-1" /> Save
              </Button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <p className="text-[11px] text-muted-foreground mb-1">Voice</p>
                <Textarea rows={3} className="text-xs" value={brainDraft.voice} onChange={(e) => setBrainDraft((d) => ({ ...d, voice: e.target.value }))} />
              </div>
              <div>
                <p className="text-[11px] text-muted-foreground mb-1">ICP</p>
                <Textarea rows={3} className="text-xs" value={brainDraft.icp} onChange={(e) => setBrainDraft((d) => ({ ...d, icp: e.target.value }))} />
              </div>
              <div>
                <p className="text-[11px] text-muted-foreground mb-1">Brand guidelines</p>
                <Textarea rows={3} className="text-xs" value={brainDraft.brand_guidelines} onChange={(e) => setBrainDraft((d) => ({ ...d, brand_guidelines: e.target.value }))} />
              </div>
              <div>
                <p className="text-[11px] text-muted-foreground mb-1">Do not say</p>
                <Textarea rows={3} className="text-xs" value={brainDraft.do_not_say} onChange={(e) => setBrainDraft((d) => ({ ...d, do_not_say: e.target.value }))} />
              </div>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}