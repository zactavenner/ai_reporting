import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Mail, MessageSquare, Plus, Send, Trash2 } from "lucide-react";

type Client = { id: string; name: string };
type Recipient = {
  id: string;
  client_id: string;
  name: string;
  role: string | null;
  email: string | null;
  phone_e164: string | null;
  channels: string[];
  cadences: string[];
  active: boolean;
  unsubscribed_at: string | null;
};
type SendRow = {
  id: string; client_id: string; cadence: string; channel: string; status: string;
  period_start: string; period_end: string; sent_at: string | null; error: string | null; ghl_message_id: string | null;
};

const CHANNELS = ["email", "sms"] as const;
const CADENCES = ["weekly", "monthly"] as const;

export function ClientReportsTab() {
  const [clients, setClients] = useState<Client[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [sends, setSends] = useState<SendRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState({ name: "", role: "CEO", email: "", phone_e164: "" });

  const load = async (clientId: string) => {
    setLoading(true);
    const [r, s] = await Promise.all([
      supabase.from("client_report_recipients").select("*").eq("client_id", clientId).order("created_at"),
      supabase.from("client_report_sends").select("*").eq("client_id", clientId).order("created_at", { ascending: false }).limit(20),
    ]);
    setRecipients((r.data as any) || []);
    setSends((s.data as any) || []);
    setLoading(false);
  };

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("clients").select("id,name").eq("status", "active").order("name");
      setClients((data as any) || []);
      if (data && data[0]) {
        setSelected(data[0].id);
        load(data[0].id);
      }
    })();
  }, []);

  const addRecipient = async () => {
    if (!selected) return;
    if (!draft.name || (!draft.email && !draft.phone_e164)) {
      toast.error("Name + email or phone required");
      return;
    }
    const channels = [draft.email ? "email" : null, draft.phone_e164 ? "sms" : null].filter(Boolean) as string[];
    const { error } = await supabase.from("client_report_recipients").insert({
      client_id: selected,
      name: draft.name, role: draft.role,
      email: draft.email || null,
      phone_e164: draft.phone_e164 || null,
      channels,
      cadences: ["weekly", "monthly"],
    });
    if (error) return toast.error(error.message);
    setDraft({ name: "", role: "CEO", email: "", phone_e164: "" });
    toast.success("Recipient added");
    load(selected);
  };

  const updateRecipient = async (id: string, patch: Partial<Recipient>) => {
    const { error } = await supabase.from("client_report_recipients").update(patch as any).eq("id", id);
    if (error) return toast.error(error.message);
    load(selected);
  };

  const removeRecipient = async (id: string) => {
    if (!confirm("Remove recipient?")) return;
    const { error } = await supabase.from("client_report_recipients").delete().eq("id", id);
    if (error) return toast.error(error.message);
    load(selected);
  };

  const sendTest = async (recipientId: string, cadence: "weekly" | "monthly") => {
    toast.info(`Sending ${cadence} test…`);
    const { data, error } = await supabase.functions.invoke("dispatch-client-reports", {
      body: {
        password: "HPA1234$",
        cadence,
        client_id: selected,
        test_recipient_id: recipientId,
        origin: window.location.origin,
      },
    });
    if (error) return toast.error(error.message);
    const failed = (data?.results || []).filter((r: any) => r.error);
    if (failed.length) toast.error(failed[0].error);
    else toast.success("Test report sent");
    load(selected);
  };

  const toggleChannel = (rec: Recipient, ch: string) => {
    const next = rec.channels.includes(ch) ? rec.channels.filter((c) => c !== ch) : [...rec.channels, ch];
    updateRecipient(rec.id, { channels: next });
  };
  const toggleCadence = (rec: Recipient, c: string) => {
    const next = rec.cadences.includes(c) ? rec.cadences.filter((x) => x !== c) : [...rec.cadences, c];
    updateRecipient(rec.id, { cadences: next });
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Client Reports</CardTitle>
          <CardDescription>
            Branded weekly (Monday) and monthly (1st) performance recaps sent via your agency GHL account over email and SMS.
            Each recipient gets a deep-link to the public client report.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2">
            <Label className="text-xs">Client</Label>
            <Select value={selected} onValueChange={(v) => { setSelected(v); load(v); }}>
              <SelectTrigger className="w-72"><SelectValue /></SelectTrigger>
              <SelectContent>
                {clients.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="rounded-lg border p-4 bg-muted/30 grid gap-3 sm:grid-cols-5">
            <div className="space-y-1">
              <Label className="text-xs">Name</Label>
              <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Role</Label>
              <Input value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Email</Label>
              <Input type="email" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Phone (E.164)</Label>
              <Input placeholder="+15558675309" value={draft.phone_e164} onChange={(e) => setDraft({ ...draft, phone_e164: e.target.value })} />
            </div>
            <div className="flex items-end">
              <Button onClick={addRecipient} className="w-full gap-2"><Plus className="h-4 w-4"/>Add</Button>
            </div>
          </div>

          <div className="space-y-2">
            {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
            {recipients.map((r) => (
              <div key={r.id} className="rounded-lg border p-3 flex flex-wrap items-center gap-3">
                <div className="min-w-[180px]">
                  <div className="font-medium">{r.name} <span className="text-muted-foreground text-xs">· {r.role || "—"}</span></div>
                  <div className="text-xs text-muted-foreground">{r.email || "—"} · {r.phone_e164 || "—"}</div>
                </div>
                <div className="flex items-center gap-1">
                  {CHANNELS.map((ch) => (
                    <Badge key={ch} variant={r.channels.includes(ch) ? "default" : "outline"}
                      className="cursor-pointer gap-1" onClick={() => toggleChannel(r, ch)}>
                      {ch === "email" ? <Mail className="h-3 w-3"/> : <MessageSquare className="h-3 w-3"/>}{ch}
                    </Badge>
                  ))}
                </div>
                <div className="flex items-center gap-1">
                  {CADENCES.map((c) => (
                    <Badge key={c} variant={r.cadences.includes(c) ? "secondary" : "outline"}
                      className="cursor-pointer" onClick={() => toggleCadence(r, c)}>{c}</Badge>
                  ))}
                </div>
                <div className="flex items-center gap-2 ml-auto">
                  <div className="flex items-center gap-1">
                    <Switch checked={r.active && !r.unsubscribed_at} onCheckedChange={(v) => updateRecipient(r.id, { active: v })} />
                    <span className="text-xs text-muted-foreground">{r.unsubscribed_at ? "Unsubscribed" : "Active"}</span>
                  </div>
                  <Button size="sm" variant="outline" className="gap-1" onClick={() => sendTest(r.id, "weekly")}>
                    <Send className="h-3 w-3"/>Weekly test
                  </Button>
                  <Button size="sm" variant="outline" className="gap-1" onClick={() => sendTest(r.id, "monthly")}>
                    <Send className="h-3 w-3"/>Monthly test
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => removeRecipient(r.id)}><Trash2 className="h-4 w-4"/></Button>
                </div>
              </div>
            ))}
            {!loading && !recipients.length && (
              <p className="text-sm text-muted-foreground">No recipients yet. Add one above.</p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent sends</CardTitle>
          <CardDescription>Last 20 deliveries for this client.</CardDescription>
        </CardHeader>
        <CardContent>
          {!sends.length ? (
            <p className="text-sm text-muted-foreground">No sends yet.</p>
          ) : (
            <div className="space-y-1 text-sm">
              {sends.map((s) => (
                <div key={s.id} className="flex items-center gap-3 p-2 rounded border">
                  <Badge variant={s.status === "sent" ? "default" : s.status === "failed" ? "destructive" : "secondary"}>{s.status}</Badge>
                  <span className="text-xs text-muted-foreground">{s.cadence} · {s.channel}</span>
                  <span className="text-xs">{s.period_start} → {s.period_end}</span>
                  <span className="text-xs text-muted-foreground ml-auto">{s.sent_at ? new Date(s.sent_at).toLocaleString() : "—"}</span>
                  {s.error && <span className="text-xs text-destructive truncate max-w-[260px]" title={s.error}>{s.error}</span>}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}