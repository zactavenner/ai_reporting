import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Bot, Copy, Eye, EyeOff, RefreshCw, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useAgencySettings, useUpdateAgencySettings } from "@/hooks/useAgencySettings";

const PROJECT_ID = (import.meta.env.VITE_SUPABASE_PROJECT_ID as string) || "";
const FUNCTIONS_BASE = PROJECT_ID
  ? `https://${PROJECT_ID}.functions.supabase.co/hermes-orchestrator`
  : `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/hermes-orchestrator`;

function CodeBlock({ code }: { code: string }) {
  return (
    <div className="relative">
      <pre className="text-[11px] bg-muted/60 border border-border rounded-md p-3 overflow-x-auto font-mono whitespace-pre">
        {code}
      </pre>
      <Button
        size="icon"
        variant="ghost"
        className="absolute top-1 right-1 h-6 w-6"
        onClick={() => {
          navigator.clipboard.writeText(code);
          toast.success("Copied");
        }}
      >
        <Copy className="h-3 w-3" />
      </Button>
    </div>
  );
}

export function HermesIntegrationTab() {
  const { data: settings, refetch } = useAgencySettings();
  const update = useUpdateAgencySettings();
  const [apiKey, setApiKey] = useState("");
  const [callbackUrl, setCallbackUrl] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!settings) return;
    setApiKey((settings as any).hermes_api_key || "");
    setCallbackUrl((settings as any).hermes_callback_url || "");
    setEnabled(Boolean((settings as any).hermes_enabled));
  }, [settings]);

  const generateKey = () => {
    const rand = crypto.getRandomValues(new Uint8Array(32));
    const key = "hermes_" + Array.from(rand).map((b) => b.toString(16).padStart(2, "0")).join("");
    setApiKey(key);
    setShowKey(true);
    toast.success("New key generated — save to activate.");
  };

  const save = async () => {
    setSaving(true);
    try {
      await update.mutateAsync({
        hermes_api_key: apiKey || null,
        hermes_callback_url: callbackUrl.trim() || null,
        hermes_enabled: enabled,
      } as any);
      toast.success("Hermes settings saved");
      refetch();
    } catch (e: any) {
      toast.error(e.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const exampleKey = apiKey || "<HERMES_API_KEY>";

  const curlCreate = `curl -X POST ${FUNCTIONS_BASE}/create_task \\
  -H "Authorization: Bearer ${exampleKey}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "client_slug": "blue-capital",
    "task_type": "video",
    "instructions": "Generate 4x 15-second vertical video ads featuring the latest offer.",
    "hermes_external_id": "hermes_job_123",
    "callback_url": "https://hermes.example.com/webhooks/lovable"
  }'`;

  const curlList = `curl ${FUNCTIONS_BASE}/list_clients \\
  -H "Authorization: Bearer ${exampleKey}"`;

  const curlComplete = `curl -X POST ${FUNCTIONS_BASE}/complete_task \\
  -H "Authorization: Bearer ${exampleKey}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "task_id": "<task uuid returned by create_task>",
    "status": "completed",
    "assets": [{ "type": "video", "title": "Hook A", "url": "https://..." }]
  }'`;

  const webhookPayload = `{
  "event": "task.completed",
  "task_id": "uuid",
  "hermes_external_id": "hermes_job_123",
  "client_id": "uuid",
  "task_type": "video",
  "status": "completed",
  "assets": [
    { "type": "video", "title": "Seedance 9:16", "url": "https://...mp4", "poster_url": "https://...jpg", "duration": 15 }
  ]
}`;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold flex items-center gap-2">
            <Bot className="h-5 w-5" /> Hermes Orchestrator API
          </h2>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Let your external Hermes master agent dispatch tasks to this platform. Each client gets a dedicated{" "}
            <Badge variant="secondary">🤖 Hermes Orchestrator</Badge> conversation inside AI Studio where every task,
            agent reply, and delivered asset is logged.
          </p>
        </div>
        <Badge variant={enabled ? "default" : "secondary"}>{enabled ? "Active" : "Inactive"}</Badge>
      </div>

      <Card className="p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <Label className="text-sm font-medium">Enable Hermes integration</Label>
            <p className="text-xs text-muted-foreground">Required for the API endpoints to accept requests.</p>
          </div>
          <Switch checked={enabled} onCheckedChange={setEnabled} />
        </div>

        <div className="space-y-1">
          <Label className="text-sm">Hermes API Key</Label>
          <div className="flex gap-2">
            <Input
              type={showKey ? "text" : "password"}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="hermes_..."
              className="font-mono text-sm"
            />
            <Button variant="outline" size="icon" onClick={() => setShowKey((v) => !v)}>
              {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </Button>
            <Button variant="outline" size="icon" onClick={generateKey} title="Generate new key">
              <Sparkles className="h-4 w-4" />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Hermes sends this as <code>Authorization: Bearer ...</code>. Rotate any time and re-save.
          </p>
        </div>

        <div className="space-y-1">
          <Label className="text-sm">Default Callback URL</Label>
          <Input
            value={callbackUrl}
            onChange={(e) => setCallbackUrl(e.target.value)}
            placeholder="https://hermes.example.com/webhooks/lovable"
            className="font-mono text-sm"
          />
          <p className="text-xs text-muted-foreground">
            Used to notify Hermes when assets are produced if a task doesn't specify its own <code>callback_url</code>.
          </p>
        </div>

        <div className="flex justify-end">
          <Button onClick={save} disabled={saving}>
            <RefreshCw className={`h-4 w-4 mr-2 ${saving ? "animate-spin" : ""}`} />
            {saving ? "Saving..." : "Save Hermes Settings"}
          </Button>
        </div>
      </Card>

      <Card className="p-4 space-y-4">
        <div>
          <h3 className="font-semibold text-sm">Base URL</h3>
          <CodeBlock code={FUNCTIONS_BASE} />
          <p className="text-xs text-muted-foreground mt-2">
            Every request must include <code>Authorization: Bearer &lt;HERMES_API_KEY&gt;</code>.
          </p>
        </div>

        <div>
          <h3 className="font-semibold text-sm mb-1">1. Discover clients</h3>
          <p className="text-xs text-muted-foreground mb-2">
            <code>GET /list_clients</code> — returns id, name, slug, status for every active/onboarding/paused client.
          </p>
          <CodeBlock code={curlList} />
        </div>

        <div>
          <h3 className="font-semibold text-sm mb-1">2. Create a task</h3>
          <p className="text-xs text-muted-foreground mb-2">
            <code>POST /create_task</code> — identify the client with <code>client_id</code>, <code>client_slug</code>,
            or <code>client_name</code>. Supported <code>task_type</code> values auto-route to the matching enabled
            agent: <code>video</code>, <code>static_ad</code>, <code>copy</code>, <code>research</code>, or any custom
            type. The task immediately appears in the client's <strong>🤖 Hermes Orchestrator</strong> channel inside
            AI Studio.
          </p>
          <CodeBlock code={curlCreate} />
        </div>

        <div>
          <h3 className="font-semibold text-sm mb-1">3. Receive the callback</h3>
          <p className="text-xs text-muted-foreground mb-2">
            When generation finishes (e.g. a Seedance video lands in the client library), the platform POSTs to your{" "}
            <code>callback_url</code> with the assets. <code>video</code> tasks auto-complete from AI Studio production;
            other task types can be closed manually via <code>POST /complete_task</code>.
          </p>
          <CodeBlock code={webhookPayload} />
          <div className="mt-3">
            <CodeBlock code={curlComplete} />
          </div>
        </div>

        <div>
          <h3 className="font-semibold text-sm mb-1">Other endpoints</h3>
          <ul className="text-xs text-muted-foreground list-disc pl-5 space-y-1">
            <li><code>POST /post_message</code> — push a free-form message into a client's Hermes channel.</li>
            <li><code>POST /get_task</code> with <code>{`{ "task_id": "..." }`}</code> — current status and assets.</li>
            <li><code>POST /list_tasks</code> — filter by <code>client_id</code>, <code>status</code>, <code>task_type</code>.</li>
            <li><code>GET /ping</code> — auth + connectivity check.</li>
          </ul>
        </div>
      </Card>
    </div>
  );
}