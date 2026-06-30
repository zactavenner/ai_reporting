import { useEffect, useState } from "react";
import { Crown, User as UserIcon, Save, Edit3, Cable, Sparkles, Plus, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  type AgencyAgent,
  useUpdateAgencyAgent,
  AGENCY_AGENT_MODELS,
} from "@/hooks/useAgencyAgents";
import { useClientBrain, useUpsertClientBrain, useClientAgentOverride, useUpsertClientAgentOverride } from "@/hooks/useAgencyAgents";
import { useClientOffers } from "@/hooks/useClientOffers";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
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
  const [model, setModel] = useState(agent.default_model || "nvidia/nemotron-3-ultra:free");
  const [editingMemory, setEditingMemory] = useState(false);
  const [editingInstr, setEditingInstr] = useState(false);
  const [editingIdentity, setEditingIdentity] = useState(false);
  const [nameDraft, setNameDraft] = useState(agent.name);
  const [iconDraft, setIconDraft] = useState(agent.icon || "🤖");
  const [roleDraft, setRoleDraft] = useState(agent.role);
  const [fallback1, setFallback1] = useState<string>(agent.fallback_models?.[0] || "");
  const [fallback2, setFallback2] = useState<string>(agent.fallback_models?.[1] || "");

  useEffect(() => {
    setMemory(agent.memory_md || "");
    setInstructions(agent.instructions_md || "");
    setModel(agent.default_model || "nvidia/nemotron-3-ultra:free");
    setNameDraft(agent.name);
    setIconDraft(agent.icon || "🤖");
    setRoleDraft(agent.role);
    setFallback1(agent.fallback_models?.[0] || "");
    setFallback2(agent.fallback_models?.[1] || "");
  }, [agent.id]);

  const isClientView = mode === "client" && !!clientId;

  // Client-only fields
  const { data: brain } = useClientBrain(isClientView ? clientId : null);
  const upsertBrain = useUpsertClientBrain();
  const { data: offers = [] } = useClientOffers(isClientView ? clientId! : "");
  const qc = useQueryClient();
  useEffect(() => {
    if (!isClientView || !clientId) return;
    const ch = supabase
      .channel(`offers-sync:${clientId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "client_offers", filter: `client_id=eq.${clientId}` },
        () => qc.invalidateQueries({ queryKey: ["client-offers", clientId] }),
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [isClientView, clientId, qc]);
  const { data: clientOverride } = useClientAgentOverride(isClientView ? clientId : null, isClientView ? agent.id : null);
  const upsertOverride = useUpsertClientAgentOverride();
  const [clientMemory, setClientMemory] = useState("");
  const [clientInstr, setClientInstr] = useState("");
  const [editingClientMemory, setEditingClientMemory] = useState(false);
  const [editingClientInstr, setEditingClientInstr] = useState(false);
  useEffect(() => {
    setClientMemory(clientOverride?.memory_md || "");
    setClientInstr(clientOverride?.instructions_md || "");
  }, [clientOverride?.client_id, clientOverride?.agent_id, agent.id]);

  const saveClientOverride = (patch: { memory_md?: string; instructions_md?: string }) => {
    if (!isClientView) return;
    upsertOverride.mutate({
      client_id: clientId!,
      agent_id: agent.id,
      memory_md: patch.memory_md ?? clientMemory,
      instructions_md: patch.instructions_md ?? clientInstr,
    });
  };
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

  const toggleConnector = (key: string) => {
    if (mode !== "master") return;
    const set = new Set(connectors);
    if (set.has(key)) set.delete(key); else set.add(key);
    saveMaster({ connectors: Array.from(set) });
  };

  const saveFallbacks = (a?: string, b?: string) => {
    const next = [a ?? fallback1, b ?? fallback2].filter(Boolean) as string[];
    saveMaster({ fallback_models: next });
  };

  const availableConnectorsToAdd = Object.keys(CONNECTOR_REGISTRY).filter(
    (k) => !connectors.includes(k)
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
      {/* LEFT — identity + scope */}
      <Card className="p-4 lg:col-span-2 space-y-3 h-fit">
        <div className="flex items-start gap-3">
          {editingIdentity && mode === "master" ? (
            <Input value={iconDraft} onChange={(e) => setIconDraft(e.target.value)} className="w-12 h-10 text-center text-2xl px-1" />
          ) : (
            <span className="text-3xl">{agent.icon || "🤖"}</span>
          )}
          <div className="flex-1 min-w-0 space-y-1">
            <div className="flex items-center gap-2">
              {editingIdentity && mode === "master" ? (
                <Input value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} className="h-7 text-sm font-bold" />
              ) : (
                <h3 className="text-base font-bold truncate">{agent.name}</h3>
              )}
              {mode === "master" ? (
                <Badge className="text-[10px]"><Crown className="h-2.5 w-2.5 mr-0.5" /> Master</Badge>
              ) : (
                <Badge variant="secondary" className="text-[10px]"><UserIcon className="h-2.5 w-2.5 mr-0.5" /> {clientName || "Client"}</Badge>
              )}
            </div>
            {editingIdentity && mode === "master" ? (
              <Textarea value={roleDraft} onChange={(e) => setRoleDraft(e.target.value)} rows={2} className="text-xs" />
            ) : (
              <p className="text-xs text-muted-foreground">{agent.role}</p>
            )}
            {mode === "master" && (
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-[11px]"
                onClick={() => {
                  if (editingIdentity) {
                    saveMaster({ name: nameDraft, icon: iconDraft, role: roleDraft });
                  }
                  setEditingIdentity(!editingIdentity);
                }}
              >
                {editingIdentity ? <><Save className="h-3 w-3 mr-1" /> Save</> : <><Edit3 className="h-3 w-3 mr-1" /> Edit identity</>}
              </Button>
            )}
          </div>
        </div>

        <Separator />

        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">Primary model</p>
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

        {mode === "master" && (
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">
              Fallback models <span className="text-muted-foreground/70 normal-case">(used for vision / overflow)</span>
            </p>
            <div className="space-y-1.5">
              {[
                { val: fallback1, set: setFallback1, idx: 0 },
                { val: fallback2, set: setFallback2, idx: 1 },
              ].map(({ val, set, idx }) => (
                <div key={idx} className="flex items-center gap-1">
                  <Select
                    value={val || "__none__"}
                    onValueChange={(v) => {
                      const next = v === "__none__" ? "" : v;
                      set(next);
                      if (idx === 0) saveFallbacks(next, fallback2);
                      else saveFallbacks(fallback1, next);
                    }}
                  >
                    <SelectTrigger className="h-7 text-xs"><SelectValue placeholder={`Fallback ${idx + 1}`} /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__" className="text-xs">— None —</SelectItem>
                      {AGENCY_AGENT_MODELS.filter((m) => m.value !== model).map((m) => (
                        <SelectItem key={m.value} value={m.value} className="text-xs">{m.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
          </div>
        )}

        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1 flex items-center gap-1">
            <Cable className="h-3 w-3" /> Connectors
          </p>
          <div className="flex flex-wrap gap-1">
            {connectors.length === 0 && <span className="text-[11px] text-muted-foreground">None configured</span>}
            {connectors.map((c) => {
              const meta = CONNECTOR_REGISTRY[c];
              return (
                <Badge key={c} variant="outline" className="text-[10px] group/conn">
                  {meta ? `${meta.emoji} ${meta.label}` : c}
                  {mode === "master" && (
                    <button
                      onClick={() => toggleConnector(c)}
                      className="ml-1 opacity-60 hover:opacity-100"
                      title="Remove connector"
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  )}
                </Badge>
              );
            })}
          </div>
          {mode === "master" && availableConnectorsToAdd.length > 0 && (
            <div className="mt-2">
              <Select value="" onValueChange={(v) => v && toggleConnector(v)}>
                <SelectTrigger className="h-7 text-[11px] w-full">
                  <span className="flex items-center gap-1 text-muted-foreground">
                    <Plus className="h-3 w-3" /> Add connector
                  </span>
                </SelectTrigger>
                <SelectContent>
                  {availableConnectorsToAdd.map((k) => {
                    const meta = CONNECTOR_REGISTRY[k];
                    return (
                      <SelectItem key={k} value={k} className="text-xs">
                        {meta.emoji} {meta.label}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
          )}
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
                Client offers ({offers.length}) <span className="font-normal normal-case text-muted-foreground">· auto-synced into agent context</span>
              </p>
              <div className="space-y-1 max-h-56 overflow-y-auto">
                {offers.length === 0 && <p className="text-[11px] text-muted-foreground">No offers for this client yet.</p>}
                {offers.map((o: any) => (
                  <div key={o.id} className="text-[11px] px-2 py-1 rounded bg-muted/40">
                    <p className="font-medium truncate">{o.title || o.name || "Untitled offer"}</p>
                    {o.description && (
                      <p className="text-[10px] text-muted-foreground line-clamp-2 mt-0.5">{o.description}</p>
                    )}
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
            <p className="text-sm font-semibold">Memory <span className="text-[10px] font-normal text-muted-foreground">· Master</span></p>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-[10px]">
                {mode === "master" ? "Trains every client" : "Read-only here · edit in Agents tab"}
              </Badge>
              {mode === "master" && (
                <Button size="sm" variant="ghost" onClick={() => editingMemory ? (saveMaster({ memory_md: memory }), setEditingMemory(false)) : setEditingMemory(true)}>
                  {editingMemory ? <><Save className="h-3.5 w-3.5 mr-1" /> Train master</> : <><Edit3 className="h-3.5 w-3.5 mr-1" /> Train master</>}
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

        {/* Client memory addendum */}
        {isClientView && (
          <Card className="p-4 space-y-2 border-primary/30">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold">Memory <span className="text-[10px] font-normal text-muted-foreground">· {clientName || "Client"} addendum</span></p>
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="text-[10px]">Only for this client</Badge>
                <Button size="sm" variant="ghost" onClick={() => editingClientMemory ? (saveClientOverride({ memory_md: clientMemory }), setEditingClientMemory(false)) : setEditingClientMemory(true)}>
                  {editingClientMemory ? <><Save className="h-3.5 w-3.5 mr-1" /> Train client</> : <><Edit3 className="h-3.5 w-3.5 mr-1" /> Train client</>}
                </Button>
              </div>
            </div>
            {editingClientMemory ? (
              <Textarea value={clientMemory} onChange={(e) => setClientMemory(e.target.value)} rows={5} className="text-xs font-mono" placeholder="Client-specific memory that layers on top of master…" />
            ) : (
              <p className="text-xs whitespace-pre-wrap text-muted-foreground min-h-[3em]">
                {clientMemory || "No client-specific memory yet."}
              </p>
            )}
          </Card>
        )}

        {/* Instructions */}
        <Card className="p-4 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold">Instructions <span className="text-[10px] font-normal text-muted-foreground">· Master</span></p>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-[10px]">
                {mode === "master" ? "Trains every client" : "Read-only here · edit in Agents tab"}
              </Badge>
              {mode === "master" && (
                <Button size="sm" variant="ghost" onClick={() => editingInstr ? (saveMaster({ instructions_md: instructions }), setEditingInstr(false)) : setEditingInstr(true)}>
                  {editingInstr ? <><Save className="h-3.5 w-3.5 mr-1" /> Train master</> : <><Edit3 className="h-3.5 w-3.5 mr-1" /> Train master</>}
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

        {/* Client instructions addendum */}
        {isClientView && (
          <Card className="p-4 space-y-2 border-primary/30">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold">Instructions <span className="text-[10px] font-normal text-muted-foreground">· {clientName || "Client"} addendum</span></p>
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="text-[10px]">Only for this client</Badge>
                <Button size="sm" variant="ghost" onClick={() => editingClientInstr ? (saveClientOverride({ instructions_md: clientInstr }), setEditingClientInstr(false)) : setEditingClientInstr(true)}>
                  {editingClientInstr ? <><Save className="h-3.5 w-3.5 mr-1" /> Train client</> : <><Edit3 className="h-3.5 w-3.5 mr-1" /> Train client</>}
                </Button>
              </div>
            </div>
            {editingClientInstr ? (
              <Textarea value={clientInstr} onChange={(e) => setClientInstr(e.target.value)} rows={5} className="text-xs font-mono" placeholder="Client-specific instructions that layer on top of master…" />
            ) : (
              <p className="text-xs whitespace-pre-wrap text-muted-foreground min-h-[3em]">
                {clientInstr || "No client-specific instructions yet."}
              </p>
            )}
          </Card>
        )}

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