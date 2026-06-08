import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { Loader2, Download, Save, RefreshCw } from "lucide-react";

type Client = {
  id: string;
  name: string;
  ghl_location_id: string | null;
  ghl_firebase_refresh_token: string | null;
};

type WorkflowSummary = { id?: string; _id?: string; name?: string; status?: string };

export default function GhlWorkflowsPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [clientId, setClientId] = useState<string>("");
  const [tokenDraft, setTokenDraft] = useState("");
  const [locationDraft, setLocationDraft] = useState("");
  const [savingToken, setSavingToken] = useState(false);
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [filter, setFilter] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [workflowJson, setWorkflowJson] = useState<string>("");
  const [loadingWf, setLoadingWf] = useState(false);
  const [saving, setSaving] = useState(false);

  const selectedClient = useMemo(
    () => clients.find((c) => c.id === clientId) || null,
    [clients, clientId],
  );

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from("clients")
        .select("id, name, ghl_location_id, ghl_firebase_refresh_token")
        .in("status", ["active", "onboarding", "paused"])
        .order("name");
      if (error) { toast.error(error.message); return; }
      setClients((data || []) as Client[]);
    })();
  }, []);

  useEffect(() => {
    if (selectedClient) {
      setTokenDraft(selectedClient.ghl_firebase_refresh_token || "");
      setLocationDraft(selectedClient.ghl_location_id || "");
      setWorkflows([]);
      setSelectedId(null);
      setWorkflowJson("");
    }
  }, [clientId]);

  async function saveToken() {
    if (!selectedClient) return;
    setSavingToken(true);
    const { error } = await supabase
      .from("clients")
      .update({
        ghl_firebase_refresh_token: tokenDraft.trim() || null,
        ghl_location_id: locationDraft.trim() || null,
      })
      .eq("id", selectedClient.id);
    setSavingToken(false);
    if (error) { toast.error(error.message); return; }
    toast.success("GHL credentials saved");
    setClients((cs) => cs.map((c) => c.id === selectedClient.id
      ? { ...c, ghl_firebase_refresh_token: tokenDraft.trim() || null, ghl_location_id: locationDraft.trim() || null }
      : c));
  }

  async function callGhl(action: string, extra: Record<string, unknown> = {}) {
    const { data, error } = await supabase.functions.invoke("ghl-internal", {
      body: { clientId, action, ...extra },
    });
    if (error) throw new Error(error.message);
    if (data && (data as { error?: string }).error) throw new Error((data as { error: string }).error);
    return data as { status: number; data: unknown };
  }

  async function loadWorkflows() {
    if (!clientId) return;
    setLoadingList(true);
    try {
      const res = await callGhl("list_workflows");
      const payload = (res.data as { workflows?: unknown[] })?.workflows
        || (Array.isArray(res.data) ? res.data : []);
      setWorkflows(payload as WorkflowSummary[]);
      toast.success(`Loaded ${(payload as unknown[]).length} workflows`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoadingList(false);
    }
  }

  async function openWorkflow(id: string) {
    setSelectedId(id);
    setLoadingWf(true);
    setWorkflowJson("");
    try {
      const res = await callGhl("get_workflow", { workflowId: id });
      setWorkflowJson(JSON.stringify(res.data, null, 2));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoadingWf(false);
    }
  }

  async function saveWorkflow() {
    if (!selectedId) return;
    let body: unknown;
    try { body = JSON.parse(workflowJson); }
    catch { toast.error("Invalid JSON"); return; }
    setSaving(true);
    try {
      await callGhl("update_workflow", { workflowId: selectedId, body });
      toast.success("Workflow updated in GHL");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const filtered = workflows.filter((w) =>
    !filter || (w.name || "").toLowerCase().includes(filter.toLowerCase()),
  );

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold">GHL Workflows</h1>
        <p className="text-muted-foreground text-sm mt-1">
          List, view, and manually edit GoHighLevel workflows using the internal API
          (token-id auth). Pick a client, paste their Firebase refresh token, and load workflows.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">1. Choose client &amp; paste credentials</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid md:grid-cols-3 gap-3">
            <div>
              <label className="text-xs font-medium">Client</label>
              <select
                className="w-full mt-1 h-9 rounded-md border bg-background px-2 text-sm"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
              >
                <option value="">Select…</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium">GHL Location ID</label>
              <Input
                value={locationDraft}
                onChange={(e) => setLocationDraft(e.target.value)}
                placeholder="e.g. abcd1234XYZ"
                disabled={!clientId}
              />
            </div>
            <div className="flex items-end">
              <a
                href="/ghl-token-grabber.zip"
                download
                className="inline-flex items-center gap-2 text-sm underline"
              >
                <Download className="h-4 w-4" /> Download Chrome extension
              </a>
            </div>
          </div>
          <div>
            <label className="text-xs font-medium">
              Firebase refresh token (from extension → Grab Refresh Token → Copy)
            </label>
            <Textarea
              value={tokenDraft}
              onChange={(e) => setTokenDraft(e.target.value)}
              placeholder="AMf-vBx…"
              rows={3}
              disabled={!clientId}
              className="font-mono text-xs"
            />
          </div>
          <div className="flex gap-2">
            <Button onClick={saveToken} disabled={!clientId || savingToken}>
              {savingToken && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Save credentials
            </Button>
            <Button variant="secondary" onClick={loadWorkflows} disabled={!clientId || loadingList}>
              {loadingList ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              Load workflows
            </Button>
          </div>
        </CardContent>
      </Card>

      {workflows.length > 0 && (
        <div className="grid md:grid-cols-[320px_1fr] gap-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Workflows ({workflows.length})</CardTitle>
              <Input
                placeholder="Filter…"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                className="mt-2"
              />
            </CardHeader>
            <CardContent className="max-h-[70vh] overflow-y-auto space-y-1">
              {filtered.map((w) => {
                const id = (w.id || w._id) as string;
                return (
                  <button
                    key={id}
                    onClick={() => openWorkflow(id)}
                    className={`w-full text-left p-2 rounded text-sm hover:bg-muted ${
                      selectedId === id ? "bg-muted font-medium" : ""
                    }`}
                  >
                    <div className="truncate">{w.name || "(no name)"}</div>
                    <div className="text-xs text-muted-foreground">{w.status || ""}</div>
                  </button>
                );
              })}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3 flex flex-row items-center justify-between">
              <CardTitle className="text-base">
                {selectedId ? "Workflow JSON (edit & save)" : "Select a workflow"}
              </CardTitle>
              {selectedId && (
                <Button onClick={saveWorkflow} disabled={saving || loadingWf} size="sm">
                  {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                  Save to GHL
                </Button>
              )}
            </CardHeader>
            <CardContent>
              {loadingWf ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <Textarea
                  value={workflowJson}
                  onChange={(e) => setWorkflowJson(e.target.value)}
                  rows={28}
                  className="font-mono text-xs"
                  placeholder="Workflow JSON will appear here"
                />
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}