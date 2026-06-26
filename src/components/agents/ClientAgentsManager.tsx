import { useState, useMemo } from "react";
import {
  useClientAgents,
  useSaveClientAgent,
  useDeleteClientAgent,
  useClientAgentProfile,
  useUpsertClientAgentProfile,
  type ClientAgent,
  type AgentType,
} from "@/hooks/useClientAgents";
import { useClientOffers } from "@/hooks/useClientOffers";
import { useClientSettings } from "@/hooks/useClientSettings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Bot, Plus, Trash2, Pencil, Image as ImageIcon, FileText, LineChart, Sparkles, KeyRound, Package, BookOpen,
  Library,
} from "lucide-react";
import { ReferencesManager } from "./ReferencesManager";

const TYPE_META: Record<AgentType, { label: string; icon: any; prompt: string }> = {
  creatives: {
    label: "Creatives",
    icon: ImageIcon,
    prompt:
      "You are the Creatives agent. Produce on-brand static images, video concepts, and ad creative. Always respect the client's brand colors, fonts, voice, and offer positioning. When asked to make images/videos, use the available generation tools.",
  },
  copy: {
    label: "Copy",
    icon: FileText,
    prompt:
      "You are the Copy agent. Write ads, hooks, emails, scripts, and landing-page copy in the client's voice. Use proven direct-response frameworks. Follow all compliance rules — never use 'guaranteed returns'; always use 'targeted returns' and add required risk disclaimers when relevant.",
  },
  strategy: {
    label: "Strategy / Analyst",
    icon: LineChart,
    prompt:
      "You are the Strategy & Analyst agent. Review performance data (spend, leads, CPL, CoC), spot wins and bleeders, recommend concrete next actions (budget moves, new angles, retargeting), and explain the reasoning in 1–2 sentences each.",
  },
  custom: {
    label: "Custom",
    icon: Sparkles,
    prompt: "You are a custom client agent. Follow the instructions below.",
  },
};

const MODELS = [
  { value: "openrouter/owl-alpha", label: "Owl Alpha (default)" },
  { value: "openrouter/deepseek/deepseek-v4-flash", label: "DeepSeek V4 Flash" },
  { value: "openai/gpt-5", label: "GPT-5" },
  { value: "openai/gpt-5-mini", label: "GPT-5 Mini" },
];

function slugify(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 32);
}

export function ClientAgentsManager({ clientId, clientName }: { clientId: string; clientName: string }) {
  const { data: agents = [] } = useClientAgents(clientId);
  const { data: profile } = useClientAgentProfile(clientId);
  const saveAgent = useSaveClientAgent();
  const delAgent = useDeleteClientAgent();
  const saveProfile = useUpsertClientAgentProfile();
  const { data: offers = [] } = useClientOffers(clientId);
  const { data: settings } = useClientSettings(clientId);

  const [editing, setEditing] = useState<Partial<ClientAgent> | null>(null);
  const [profileDraft, setProfileDraft] = useState<{ profile_md: string; notes: string } | null>(null);

  const profileView = profileDraft ?? { profile_md: profile?.profile_md ?? "", notes: profile?.notes ?? "" };

  const integrationsSummary = useMemo(() => {
    const s = settings as any;
    if (!s) return [] as { label: string; value: string }[];
    const rows: { label: string; value: string }[] = [];
    if (s.ghl_last_contacts_sync || s.ghl_sync_contacts_enabled) rows.push({ label: "GoHighLevel", value: "Connected" });
    if (s.hubspot_sync_enabled) rows.push({ label: "HubSpot", value: "Connected" });
    if (s.ads_library_page_id) rows.push({ label: "Meta Ads Library", value: s.ads_library_page_id });
    if (s.stripe_customer_id) rows.push({ label: "Stripe", value: s.stripe_customer_id });
    return rows;
  }, [settings]);

  function openNew(type: AgentType) {
    const meta = TYPE_META[type];
    setEditing({
      client_id: clientId,
      agent_type: type,
      name: `${meta.label} Agent`,
      handle: type,
      model: "openrouter/owl-alpha",
      system_prompt: meta.prompt,
      knowledge_md: "",
      enabled: true,
    });
  }

  return (
    <div className="flex flex-col gap-4 h-full overflow-y-auto p-1">
      <Tabs defaultValue="agents" className="w-full">
        <TabsList>
          <TabsTrigger value="agents"><Bot className="h-3.5 w-3.5 mr-1" />Agents</TabsTrigger>
          <TabsTrigger value="folder"><BookOpen className="h-3.5 w-3.5 mr-1" />Agent Folder</TabsTrigger>
          <TabsTrigger value="refs"><Library className="h-3.5 w-3.5 mr-1" />References</TabsTrigger>
        </TabsList>

        <TabsContent value="agents" className="mt-3 space-y-3">
          <div className="flex flex-wrap gap-2">
            {(Object.keys(TYPE_META) as AgentType[]).map((t) => {
              const Icon = TYPE_META[t].icon;
              return (
                <Button key={t} size="sm" variant="outline" onClick={() => openNew(t)}>
                  <Icon className="h-3.5 w-3.5 mr-1" />
                  <Plus className="h-3 w-3 mr-1" /> {TYPE_META[t].label}
                </Button>
              );
            })}
          </div>

          {agents.length === 0 ? (
            <Card className="p-6 text-center text-sm text-muted-foreground">
              No agents yet. Create your first agent above. In AI Studio you can summon any agent with <code className="px-1 py-0.5 rounded bg-muted">@handle</code>.
            </Card>
          ) : (
            <div className="grid sm:grid-cols-2 gap-3">
              {agents.map((a) => {
                const Icon = TYPE_META[a.agent_type]?.icon ?? Sparkles;
                return (
                  <Card key={a.id} className="p-3 flex flex-col gap-2">
                    <div className="flex items-start gap-2">
                      <div className="h-9 w-9 rounded-lg bg-primary/10 grid place-items-center shrink-0">
                        <Icon className="h-4 w-4 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <div className="font-medium text-sm truncate">{a.name}</div>
                          {!a.enabled && <Badge variant="outline" className="text-[10px]">off</Badge>}
                        </div>
                        <div className="text-[11px] text-muted-foreground">@{a.handle} · {a.model}</div>
                      </div>
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setEditing(a)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive"
                        onClick={() => {
                          if (confirm(`Delete ${a.name}?`)) delAgent.mutate({ id: a.id, client_id: clientId });
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                    {a.system_prompt && (
                      <p className="text-xs text-muted-foreground line-clamp-3">{a.system_prompt}</p>
                    )}
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="folder" className="mt-3 space-y-3">
          <Card className="p-4 space-y-3">
            <div className="flex items-center gap-2">
              <BookOpen className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold">Client profile</h3>
              <p className="ml-auto text-[11px] text-muted-foreground">Read by every agent.</p>
            </div>
            <Textarea
              rows={10}
              placeholder={`Who is ${clientName}?\n- Brand voice / tone\n- Ideal customer (ICP)\n- Offer summary\n- Do/don't list`}
              value={profileView.profile_md}
              onChange={(e) => setProfileDraft({ ...profileView, profile_md: e.target.value })}
            />
            <Textarea
              rows={4}
              placeholder="Internal notes (private context, brand guardrails, etc.)"
              value={profileView.notes}
              onChange={(e) => setProfileDraft({ ...profileView, notes: e.target.value })}
            />
            <div className="flex justify-end">
              <Button
                size="sm"
                disabled={!profileDraft || saveProfile.isPending}
                onClick={() => {
                  if (!profileDraft) return;
                  saveProfile.mutate(
                    { client_id: clientId, profile_md: profileDraft.profile_md, notes: profileDraft.notes, brand_kit: (profile?.brand_kit as any) || {} },
                    { onSuccess: () => setProfileDraft(null) },
                  );
                }}
              >
                Save profile
              </Button>
            </div>
          </Card>

          <Card className="p-4 space-y-2">
            <div className="flex items-center gap-2">
              <Package className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold">Offers</h3>
              <Badge variant="outline" className="ml-auto">{offers.length}</Badge>
            </div>
            {offers.length === 0 ? (
              <p className="text-xs text-muted-foreground">No offers yet. Add them in the Offers tab — agents will reference them automatically.</p>
            ) : (
              <ul className="text-sm space-y-1">
                {offers.map((o: any) => (
                  <li key={o.id} className="flex items-center justify-between gap-2">
                    <span className="truncate">{o.name || o.offer_name || "Untitled"}</span>
                    {o.is_active && <Badge variant="secondary" className="text-[10px]">active</Badge>}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="p-4 space-y-2">
            <div className="flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold">Private integrations</h3>
              <p className="ml-auto text-[11px] text-muted-foreground">Admin-only.</p>
            </div>
            {integrationsSummary.length === 0 ? (
              <p className="text-xs text-muted-foreground">No integrations detected. Connect GHL, HubSpot, Stripe, or Meta in the Connections tab.</p>
            ) : (
              <ul className="text-sm space-y-1">
                {integrationsSummary.map((row) => (
                  <li key={row.label} className="flex items-center justify-between">
                    <span>{row.label}</span>
                    <span className="text-[11px] text-muted-foreground truncate max-w-[60%]">{row.value}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="refs" className="mt-3">
          <ReferencesManager clientId={clientId} />
        </TabsContent>
      </Tabs>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing?.id ? "Edit agent" : "New agent"}</DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground">Name</label>
                  <Input
                    value={editing.name || ""}
                    onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">@ handle</label>
                  <Input
                    value={editing.handle || ""}
                    onChange={(e) => setEditing({ ...editing, handle: slugify(e.target.value) })}
                    placeholder="creatives"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground">Type</label>
                  <Select
                    value={(editing.agent_type as string) || "custom"}
                    onValueChange={(v) => setEditing({ ...editing, agent_type: v as AgentType })}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {(Object.keys(TYPE_META) as AgentType[]).map((t) => (
                        <SelectItem key={t} value={t}>{TYPE_META[t].label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Model</label>
                  <Select
                    value={editing.model || "google/gemini-3-flash-preview"}
                    onValueChange={(v) => setEditing({ ...editing, model: v })}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {MODELS.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">System prompt (role)</label>
                <Textarea
                  rows={5}
                  value={editing.system_prompt || ""}
                  onChange={(e) => setEditing({ ...editing, system_prompt: e.target.value })}
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Knowledge / reference notes</label>
                <Textarea
                  rows={6}
                  placeholder="Paste brand guidelines, sample copy, do's and don'ts, examples..."
                  value={editing.knowledge_md || ""}
                  onChange={(e) => setEditing({ ...editing, knowledge_md: e.target.value })}
                />
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={editing.enabled ?? true}
                  onCheckedChange={(v) => setEditing({ ...editing, enabled: v })}
                />
                <span className="text-sm">Enabled (responds to @{editing.handle || "handle"})</span>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
            <Button
              disabled={!editing?.name || !editing?.handle || saveAgent.isPending}
              onClick={() => {
                if (!editing) return;
                saveAgent.mutate(editing as any, { onSuccess: () => setEditing(null) });
              }}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}