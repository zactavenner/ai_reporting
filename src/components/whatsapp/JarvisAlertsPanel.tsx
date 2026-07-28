import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { whatsappDashboard } from '@/lib/whatsappDashboard';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Trash2, Plus, Send, Loader2, BellRing } from 'lucide-react';
import { toast } from 'sonner';

interface Recipient {
  id: string;
  name: string;
  phone_e164: string;
  active: boolean;
  alert_types: string[];
  notes: string | null;
  created_at: string;
}

const ALERT_TYPES = ['all', 'huddle', 'agent', 'escalation', 'billing', 'system'];

export function JarvisAlertsPanel() {
  const [rows, setRows] = useState<Recipient[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const r = await whatsappDashboard<{ recipients: Recipient[] }>('recipients_list');
      setRows(r.recipients || []);
    } catch (e: any) { toast.error('Load failed: ' + e.message); }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const addRecipient = async () => {
    const phone = newPhone.trim();
    if (!newName.trim() || !phone) { toast.error('Name and phone required'); return; }
    const e164 = phone.startsWith('+') ? phone : '+' + phone.replace(/\D/g, '');
    setSaving(true);
    try {
      await whatsappDashboard('recipient_upsert', {
        row: { name: newName.trim(), phone_e164: e164, active: true, alert_types: ['all'] },
      });
      setNewName(''); setNewPhone('');
      load();
    } catch (e: any) { toast.error(e.message); }
    finally { setSaving(false); }
  };

  const toggle = async (r: Recipient, active: boolean) => {
    try { await whatsappDashboard('recipient_upsert', { row: { ...r, active } }); load(); }
    catch (e: any) { toast.error(e.message); }
  };

  const remove = async (r: Recipient) => {
    if (!confirm(`Remove ${r.name}?`)) return;
    try { await whatsappDashboard('recipient_delete', { id: r.id }); load(); }
    catch (e: any) { toast.error(e.message); }
  };

  const toggleType = async (r: Recipient, t: string) => {
    let next = new Set(r.alert_types || []);
    if (next.has(t)) next.delete(t); else next.add(t);
    if (next.size === 0) next = new Set(['all']);
    try { await whatsappDashboard('recipient_upsert', { row: { ...r, alert_types: Array.from(next) } }); load(); }
    catch (e: any) { toast.error(e.message); }
  };

  const sendTest = async (r: Recipient) => {
    setTesting(r.id);
    try {
      const { data, error } = await supabase.functions.invoke('jarvis-notify', {
        body: {
          message: `🧠 Jarvis test alert for ${r.name} — reply received? Sent ${new Date().toLocaleTimeString()}`,
          alert_type: 'all',
          recipients: [r.phone_e164],
        },
      });
      if (error) throw error;
      if (data?.sent >= 1) toast.success(`Test sent to ${r.name}`);
      else toast.error(`Send failed: ${JSON.stringify(data?.results?.[0] ?? data)}`);
    } catch (e: any) {
      toast.error('Test failed: ' + (e?.message || 'unknown'));
    } finally { setTesting(null); }
  };

  return (
    <Card className="p-6 space-y-6">
      <div className="flex items-center gap-2">
        <BellRing className="h-5 w-5 text-emerald-600" />
        <div>
          <h2 className="font-semibold">Jarvis Alert Recipients</h2>
          <p className="text-xs text-muted-foreground">Automated alerts (huddle summaries, agent escalations, billing) sent over WhatsApp.</p>
        </div>
      </div>

      <div className="flex gap-2">
        <Input placeholder="Name" value={newName} onChange={(e) => setNewName(e.target.value)} className="max-w-[200px]" />
        <Input placeholder="+19167097345" value={newPhone} onChange={(e) => setNewPhone(e.target.value)} className="max-w-[220px]" />
        <Button onClick={addRecipient} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Plus className="h-4 w-4 mr-1" />Add</>}
        </Button>
      </div>

      <div className="space-y-3">
        {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {!loading && rows.length === 0 && <p className="text-sm text-muted-foreground">No recipients yet.</p>}
        {rows.map(r => (
          <div key={r.id} className="border rounded-lg p-3 space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium">{r.name} <span className="text-muted-foreground text-sm ml-2">{r.phone_e164}</span></div>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Active</span>
                  <Switch checked={r.active} onCheckedChange={(v) => toggle(r, v)} />
                </div>
                <Button variant="outline" size="sm" onClick={() => sendTest(r)} disabled={testing === r.id}>
                  {testing === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5 mr-1" />}
                  Test
                </Button>
                <Button variant="ghost" size="sm" onClick={() => remove(r)}>
                  <Trash2 className="h-3.5 w-3.5 text-red-500" />
                </Button>
              </div>
            </div>
            <div className="flex flex-wrap gap-1">
              {ALERT_TYPES.map(t => (
                <button key={t} onClick={() => toggleType(r, t)}>
                  <Badge variant={r.alert_types?.includes(t) ? 'default' : 'outline'} className="cursor-pointer">
                    {t}
                  </Badge>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}