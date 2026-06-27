import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Plus, Trash2, Brain, GraduationCap, Target, Users, Send, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  useAgencyAgents,
  useUpdateAgencyAgent,
  useAgencyAgentTraining,
  useAddAgencyAgentTraining,
  useDeleteAgencyAgentTraining,
  useClientBrain,
  useUpsertClientBrain,
  useOfferTraining,
  useAddOfferTraining,
  useDeleteOfferTraining,
  AGENCY_AGENT_MODELS,
  CREATIVE_TYPES,
  type AgencyAgent,
} from "@/hooks/useAgencyAgents";
import type { Client } from "@/hooks/useClients";
import { useClientOffers } from "@/hooks/useClientOffers";

interface Props { clients: Client[]; }

export function AgencyAgentsManager({ clients }: Props) {
  const { data: agents = [], isLoading } = useAgencyAgents();
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [selectedOfferId, setSelectedOfferId] = useState<string | null>(null);
  const [propagating, setPropagating] = useState(false);

  const handlePropagate = async () => {
    if (!confirm(`Push ${agents.length} master agents (with OWL Alpha) to all ${clients.length} clients? This will upsert per-client agent rows.`)) return;
    setPropagating(true);
    try {
      const { data, error } = await supabase.functions.invoke("propagate-agency-agents", {
        body: { forceModel: "openrouter/owl-alpha" },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || "Propagation failed");
      toast.success(`Propagated ${data.agents} agents × ${data.clients} clients (${data.upserted} rows)`);
    } catch (e: any) {
      toast.error(`Propagate failed: ${e?.message || e}`);
    } finally {
      setPropagating(false);
    }
  };

  const selected = useMemo(() => agents.find(a => a.id === selectedAgentId) || agents[0] || null, [agents, selectedAgentId]);
  const updateAgent = useUpdateAgencyAgent();

  return (
    <Card className="mb-6">
      <CardContent className="p-0">
        <div className="px-4 py-3 border-b flex items-center gap-2">
          <Users className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold">Agency Agents</h2>
          <Badge variant="secondary" className="text-[10px]">3-layer knowledge: Agency → Client Brain → Offer</Badge>
          <div className="ml-auto">
            <Button size="sm" variant="outline" onClick={handlePropagate} disabled={propagating || !agents.length || !clients.length}>
              {propagating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              Propagate to all clients
            </Button>
          </div>
        </div>
        <div className="grid grid-cols-12 min-h-[520px]">
          {/* Left rail */}
          <div className="col-span-12 md:col-span-3 border-r p-2 space-y-1 max-h-[600px] overflow-y-auto">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-2 py-1">Shared Workforce</p>
            {isLoading && <p className="text-xs text-muted-foreground px-2">Loading…</p>}
            {agents.map(a => (
              <button
                key={a.id}
                onClick={() => setSelectedAgentId(a.id)}
                className={`w-full text-left px-2 py-2 rounded-md flex items-center gap-2 hover:bg-muted/60 transition-colors ${selected?.id === a.id ? "bg-muted" : ""}`}
              >
                <span className="text-base">{a.icon || "🤖"}</span>
                <div className="min-w-0">
                  <p className="text-xs font-medium truncate">{a.name}</p>
                  <p className="text-[10px] text-muted-foreground truncate">{a.role}</p>
                </div>
              </button>
            ))}
          </div>

          {/* Middle: agent config */}
          <div className="col-span-12 md:col-span-4 border-r p-4 space-y-3">
            {selected ? (
              <AgentConfigPane agent={selected} onSave={(patch) => updateAgent.mutate({ id: selected.id, ...patch })} />
            ) : (
              <p className="text-xs text-muted-foreground">Select an agent.</p>
            )}
          </div>

          {/* Right: 3-tab training */}
          <div className="col-span-12 md:col-span-5 p-4">
            <Tabs defaultValue="agency" className="w-full">
              <TabsList className="grid grid-cols-3 w-full">
                <TabsTrigger value="agency" className="text-xs"><GraduationCap className="h-3 w-3 mr-1" />Agency Training</TabsTrigger>
                <TabsTrigger value="brain" className="text-xs"><Brain className="h-3 w-3 mr-1" />Client Brain</TabsTrigger>
                <TabsTrigger value="offer" className="text-xs"><Target className="h-3 w-3 mr-1" />Offer Training</TabsTrigger>
              </TabsList>

              <TabsContent value="agency" className="mt-3">
                {selected ? <AgencyTrainingPane agentId={selected.id} /> : null}
              </TabsContent>

              <TabsContent value="brain" className="mt-3 space-y-3">
                <Select value={selectedClientId || ""} onValueChange={(v) => setSelectedClientId(v || null)}>
                  <SelectTrigger><SelectValue placeholder="Select client…" /></SelectTrigger>
                  <SelectContent>
                    {clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                {selectedClientId ? <ClientBrainPane clientId={selectedClientId} /> : <p className="text-xs text-muted-foreground">Pick a client to edit its brain.</p>}
              </TabsContent>

              <TabsContent value="offer" className="mt-3 space-y-3">
                <Select value={selectedClientId || ""} onValueChange={(v) => { setSelectedClientId(v || null); setSelectedOfferId(null); }}>
                  <SelectTrigger><SelectValue placeholder="Select client…" /></SelectTrigger>
                  <SelectContent>
                    {clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                {selectedClientId ? (
                  <OfferPickerAndTraining
                    clientId={selectedClientId}
                    selectedOfferId={selectedOfferId}
                    onSelectOffer={setSelectedOfferId}
                  />
                ) : <p className="text-xs text-muted-foreground">Pick a client first.</p>}
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function AgentConfigPane({ agent, onSave }: { agent: AgencyAgent; onSave: (p: Partial<AgencyAgent>) => void }) {
  const [name, setName] = useState(agent.name);
  const [role, setRole] = useState(agent.role);
  const [icon, setIcon] = useState(agent.icon || "🤖");
  const [model, setModel] = useState(agent.default_model);
  const [prompt, setPrompt] = useState(agent.system_prompt);
  const [allowed, setAllowed] = useState<string[]>(agent.allowed_creative_types || []);

  // sync when switching agents
  useMemo(() => {
    setName(agent.name); setRole(agent.role); setIcon(agent.icon || "🤖");
    setModel(agent.default_model); setPrompt(agent.system_prompt);
    setAllowed(agent.allowed_creative_types || []);
  }, [agent.id]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Input className="w-14" value={icon} onChange={e => setIcon(e.target.value)} />
        <Input value={name} onChange={e => setName(e.target.value)} />
      </div>
      <Input value={role} onChange={e => setRole(e.target.value)} placeholder="Short role description" />
      <div>
        <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Default Model</label>
        <Select value={model} onValueChange={setModel}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {AGENCY_AGENT_MODELS.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div>
        <label className="text-[10px] text-muted-foreground uppercase tracking-wider">System Prompt</label>
        <Textarea rows={6} value={prompt} onChange={e => setPrompt(e.target.value)} />
      </div>
      <div>
        <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">Allowed creative types</label>
        <div className="flex flex-wrap gap-1">
          {CREATIVE_TYPES.map(t => {
            const on = allowed.includes(t);
            return (
              <Badge
                key={t}
                variant={on ? "default" : "outline"}
                className="cursor-pointer text-[10px]"
                onClick={() => setAllowed(p => on ? p.filter(x => x !== t) : [...p, t])}
              >{t}</Badge>
            );
          })}
        </div>
      </div>
      <Button size="sm" onClick={() => onSave({ name, role, icon, default_model: model, system_prompt: prompt, allowed_creative_types: allowed })}>
        Save Agent
      </Button>
    </div>
  );
}

function AgencyTrainingPane({ agentId }: { agentId: string }) {
  const { data: items = [] } = useAgencyAgentTraining(agentId);
  const add = useAddAgencyAgentTraining();
  const del = useDeleteAgencyAgentTraining();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [kind, setKind] = useState<"note" | "doc" | "url" | "example">("note");

  return (
    <div className="space-y-3">
      <div className="space-y-2 border rounded-md p-2">
        <div className="flex gap-2">
          <Select value={kind} onValueChange={(v: any) => setKind(v)}>
            <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="note">Note</SelectItem>
              <SelectItem value="example">Example</SelectItem>
              <SelectItem value="doc">Doc</SelectItem>
              <SelectItem value="url">URL</SelectItem>
            </SelectContent>
          </Select>
          <Input placeholder="Title" value={title} onChange={e => setTitle(e.target.value)} />
        </div>
        <Textarea rows={3} placeholder="Body (paste training, examples, rules…)" value={body} onChange={e => setBody(e.target.value)} />
        <Button
          size="sm"
          disabled={!title.trim() || add.isPending}
          onClick={async () => {
            await add.mutateAsync({ agent_id: agentId, kind, title: title.trim(), body: body || null, file_url: null, weight: 1, created_at: new Date().toISOString() } as any);
            setTitle(""); setBody("");
          }}
        ><Plus className="h-3 w-3 mr-1" />Add training</Button>
      </div>
      <div className="space-y-1 max-h-[320px] overflow-y-auto">
        {items.length === 0 && <p className="text-xs text-muted-foreground">No training yet.</p>}
        {items.map(it => (
          <div key={it.id} className="flex items-start justify-between gap-2 border rounded-md p-2 text-xs">
            <div className="min-w-0">
              <p className="font-medium truncate"><Badge variant="outline" className="mr-1 text-[9px]">{it.kind}</Badge>{it.title}</p>
              {it.body && <p className="text-muted-foreground line-clamp-2 mt-1">{it.body}</p>}
            </div>
            <Button size="icon" variant="ghost" onClick={() => del.mutate({ id: it.id, agent_id: agentId })}><Trash2 className="h-3 w-3" /></Button>
          </div>
        ))}
      </div>
    </div>
  );
}

function ClientBrainPane({ clientId }: { clientId: string }) {
  const { data: brain } = useClientBrain(clientId);
  const upsert = useUpsertClientBrain();
  const [voice, setVoice] = useState("");
  const [icp, setIcp] = useState("");
  const [brand, setBrand] = useState("");
  const [avoid, setAvoid] = useState("");

  useMemo(() => {
    setVoice(brain?.voice || "");
    setIcp(brain?.icp || "");
    setBrand(brain?.brand_guidelines || "");
    setAvoid(brain?.do_not_say || "");
  }, [brain?.client_id]);

  return (
    <div className="space-y-2">
      <Field label="Voice & tone" value={voice} onChange={setVoice} />
      <Field label="ICP / target customer" value={icp} onChange={setIcp} />
      <Field label="Brand guidelines" value={brand} onChange={setBrand} />
      <Field label="Do NOT say / avoid" value={avoid} onChange={setAvoid} />
      <Button size="sm" onClick={() => upsert.mutate({ client_id: clientId, voice, icp, brand_guidelines: brand, do_not_say: avoid })}>Save Brain</Button>
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</label>
      <Textarea rows={2} value={value} onChange={e => onChange(e.target.value)} />
    </div>
  );
}

function OfferPickerAndTraining({ clientId, selectedOfferId, onSelectOffer }: { clientId: string; selectedOfferId: string | null; onSelectOffer: (id: string | null) => void }) {
  const { data: offers = [] } = useClientOffers(clientId);
  return (
    <div className="space-y-3">
      <Select value={selectedOfferId || ""} onValueChange={(v) => onSelectOffer(v || null)}>
        <SelectTrigger><SelectValue placeholder="Select offer…" /></SelectTrigger>
        <SelectContent>
          {(offers as any[]).map((o: any) => <SelectItem key={o.id} value={o.id}>{o.title || o.name || o.id.slice(0, 6)}</SelectItem>)}
        </SelectContent>
      </Select>
      {selectedOfferId ? <OfferTrainingPane offerId={selectedOfferId} clientId={clientId} /> : <p className="text-xs text-muted-foreground">Pick an offer to manage training.</p>}
    </div>
  );
}

function OfferTrainingPane({ offerId, clientId }: { offerId: string; clientId: string }) {
  const { data: items = [] } = useOfferTraining(offerId);
  const add = useAddOfferTraining();
  const del = useDeleteOfferTraining();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [type, setType] = useState<typeof CREATIVE_TYPES[number]>("copy");

  return (
    <div className="space-y-3">
      <div className="space-y-2 border rounded-md p-2">
        <div className="flex gap-2">
          <Select value={type} onValueChange={(v: any) => setType(v)}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              {CREATIVE_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input placeholder="Title" value={title} onChange={e => setTitle(e.target.value)} />
        </div>
        <Textarea rows={3} placeholder="Body / example…" value={body} onChange={e => setBody(e.target.value)} />
        <Button
          size="sm"
          disabled={!title.trim() || add.isPending}
          onClick={async () => {
            await add.mutateAsync({ offer_id: offerId, client_id: clientId, creative_type: type, title: title.trim(), body: body || null, asset_url: null, source_canvas_item_id: null, weight: 1, created_by: null } as any);
            setTitle(""); setBody("");
          }}
        ><Plus className="h-3 w-3 mr-1" />Add</Button>
      </div>
      <div className="space-y-1 max-h-[260px] overflow-y-auto">
        {items.length === 0 && <p className="text-xs text-muted-foreground">No offer training yet.</p>}
        {items.map(it => (
          <div key={it.id} className="flex items-start justify-between gap-2 border rounded-md p-2 text-xs">
            <div className="min-w-0">
              <p className="font-medium truncate"><Badge variant="outline" className="mr-1 text-[9px]">{it.creative_type}</Badge>{it.title}</p>
              {it.body && <p className="text-muted-foreground line-clamp-2 mt-1">{it.body}</p>}
              {it.asset_url && <a href={it.asset_url} target="_blank" rel="noreferrer" className="text-primary underline text-[10px]">asset</a>}
            </div>
            <Button size="icon" variant="ghost" onClick={() => del.mutate({ id: it.id, offer_id: offerId })}><Trash2 className="h-3 w-3" /></Button>
          </div>
        ))}
      </div>
    </div>
  );
}