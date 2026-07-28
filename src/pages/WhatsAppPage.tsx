import { useEffect, useState, useMemo, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, RefreshCw, Send, LogOut, MessageCircle, Users, BellRing, Settings as SettingsIcon, HeartPulse } from 'lucide-react';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { JarvisAlertsPanel } from '@/components/whatsapp/JarvisAlertsPanel';
import { WhatsAppHealthTab } from '@/components/whatsapp/WhatsAppHealthTab';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Link2 } from 'lucide-react';

const sb = supabase as any;

interface Session {
  id: string;
  label: string;
  phone_number: string | null;
  status: string;
  last_qr: string | null;
  last_qr_at: string | null;
  last_connected_at: string | null;
  last_error: string | null;
}
interface Contact {
  id: string;
  jid: string;
  display_name: string | null;
  phone: string | null;
  is_group: boolean;
  last_message_at: string | null;
  last_message_preview: string | null;
  unread_count: number;
  linked_client_id?: string | null;
}
interface Msg {
  id: string;
  jid: string;
  direction: 'inbound' | 'outbound';
  body: string | null;
  message_type: string;
  sender_name: string | null;
  wa_timestamp: string | null;
  status: string;
}

export default function WhatsAppPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [activeJid, setActiveJid] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [draft, setDraft] = useState('');
  const [composeJid, setComposeJid] = useState('');
  const [sending, setSending] = useState(false);
  const [statusLoading, setStatusLoading] = useState(false);
  const [bridgeConfigured, setBridgeConfigured] = useState<boolean | null>(null);
  const [tab, setTab] = useState<'chats' | 'groups' | 'alerts' | 'health' | 'settings'>('chats');
  const [chatFilter, setChatFilter] = useState<'all' | 'direct' | 'groups' | 'unread'>('all');
  const [chatSearch, setChatSearch] = useState('');
  const [clients, setClients] = useState<{ id: string; name: string }[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Load client roster once for the link-to-client selector
  useEffect(() => {
    (async () => {
      const { data } = await sb.from('clients').select('id, name').order('name');
      setClients((data as any[]) || []);
    })();
  }, []);

  const linkContactToClient = async (contactId: string, clientId: string | null) => {
    const { error } = await sb.from('whatsapp_contacts').update({ linked_client_id: clientId }).eq('id', contactId);
    if (error) { toast.error('Link failed: ' + error.message); return; }
    setContacts(prev => prev.map(c => c.id === contactId ? { ...c, linked_client_id: clientId } : c));
    toast.success(clientId ? 'Linked to client' : 'Unlinked');
  };

  // Load session row + subscribe
  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data } = await sb.from('whatsapp_sessions').select('*').eq('label', 'default').maybeSingle();
      if (mounted) setSession(data);
    })();
    const ch = sb.channel('wa-session')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'whatsapp_sessions' },
        (p: any) => setSession(p.new))
      .subscribe();
    return () => { mounted = false; sb.removeChannel(ch); };
  }, []);

  // Contacts + realtime
  useEffect(() => {
    if (!session?.id) return;
    let mounted = true;
    const load = async () => {
      const { data } = await sb.from('whatsapp_contacts')
        .select('*').eq('session_id', session.id)
        .order('last_message_at', { ascending: false, nullsFirst: false }).limit(200);
      if (mounted) setContacts(data || []);
    };
    load();
    const ch = sb.channel('wa-contacts')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'whatsapp_contacts' }, load)
      .subscribe();
    return () => { mounted = false; sb.removeChannel(ch); };
  }, [session?.id]);

  // Messages for active thread
  useEffect(() => {
    if (!session?.id || !activeJid) { setMessages([]); return; }
    let mounted = true;
    const load = async () => {
      const { data } = await sb.from('whatsapp_messages')
        .select('*').eq('session_id', session.id).eq('jid', activeJid)
        .order('wa_timestamp', { ascending: true }).limit(500);
      if (mounted) {
        setMessages(data || []);
        setTimeout(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }), 50);
      }
    };
    load();
    const ch = sb.channel(`wa-msgs-${activeJid}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'whatsapp_messages', filter: `jid=eq.${activeJid}` },
        load)
      .subscribe();
    // mark read
    sb.from('whatsapp_contacts').update({ unread_count: 0 }).eq('session_id', session.id).eq('jid', activeJid).then(() => {});
    return () => { mounted = false; sb.removeChannel(ch); };
  }, [session?.id, activeJid]);

  const refreshStatus = async () => {
    setStatusLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('whatsapp-status', {
        body: { action: 'status' },
      });
      if (error) throw error;
      if (data?.configured === false) {
        setBridgeConfigured(false);
        toast.error(data.message || 'Bridge not configured');
        return;
      }
      setBridgeConfigured(true);
      // The bridge response gets stored via the next webhook automatically; for QR we also update directly
      if (data?.qr && session) {
        await sb.from('whatsapp_sessions').update({
          status: data.status || 'qr', last_qr: data.qr, last_qr_at: new Date().toISOString(),
        }).eq('id', session.id);
      }
      toast.success('Status refreshed');
    } catch (e: any) {
      toast.error('Status failed: ' + (e?.message || 'unknown'));
    } finally { setStatusLoading(false); }
  };

  const logout = async () => {
    if (!confirm('Disconnect and force re-pairing?')) return;
    try {
      const { error } = await supabase.functions.invoke('whatsapp-status', { body: { action: 'logout' } });
      if (error) throw error;
      toast.success('Logged out — refresh status to get a new QR');
    } catch (e: any) { toast.error('Logout failed: ' + e.message); }
  };

  const send = async (overrideJid?: string) => {
    const jid = overrideJid || activeJid;
    if (!jid || !draft.trim()) return;
    setSending(true);
    try {
      const { error } = await supabase.functions.invoke('whatsapp-send', {
        body: { jid, message: draft.trim() },
      });
      if (error) throw error;
      setDraft('');
    } catch (e: any) {
      toast.error('Send failed: ' + (e?.message || 'unknown'));
    } finally { setSending(false); }
  };

  const startNewThread = () => {
    const raw = composeJid.trim().replace(/[^\d]/g, '');
    if (!raw) { toast.error('Enter phone in international format, e.g. 14155551234'); return; }
    const jid = `${raw}@s.whatsapp.net`;
    setActiveJid(jid);
    setComposeJid('');
  };

  const statusBadge = useMemo(() => {
    const s = session?.status || 'disconnected';
    const map: Record<string, string> = {
      connected: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
      qr: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
      connecting: 'bg-blue-500/15 text-blue-700 dark:text-blue-400',
      disconnected: 'bg-muted text-muted-foreground',
      logged_out: 'bg-red-500/15 text-red-700 dark:text-red-400',
      error: 'bg-red-500/15 text-red-700 dark:text-red-400',
    };
    return <Badge variant="outline" className={map[s] || map.disconnected}>{s}</Badge>;
  }, [session?.status]);

  const activeContact = contacts.find(c => c.jid === activeJid);

  const directContacts = contacts.filter(c => !c.is_group);
  const groupContacts = contacts.filter(c => c.is_group);

  const visibleContacts = (() => {
    const base = chatFilter === 'direct' ? directContacts
      : chatFilter === 'groups' ? groupContacts
      : chatFilter === 'unread' ? contacts.filter(c => c.unread_count > 0)
      : contacts;
    const q = chatSearch.trim().toLowerCase();
    if (!q) return base;
    return base.filter(c =>
      (c.display_name || '').toLowerCase().includes(q) ||
      (c.phone || '').toLowerCase().includes(q) ||
      (c.jid || '').toLowerCase().includes(q),
    );
  })();

  const clientNameFor = (id?: string | null) => id ? (clients.find(c => c.id === id)?.name || '—') : null;

  const ConnectionCard = (
    <Card className="p-6">
      {bridgeConfigured === false ? (
        <div className="text-sm space-y-2">
          <p className="font-medium">Bridge not configured yet.</p>
          <p className="text-muted-foreground">
            Deploy <code>bridge/</code> (whatsmeow — see <code>bridge/README.md</code>) to Railway / Fly / your VPS,
            then add three secrets in this Lovable project:
          </p>
          <ul className="list-disc pl-6 text-muted-foreground">
            <li><code>WHATSAPP_BRIDGE_URL</code> — public URL of your deployed bridge</li>
            <li><code>WHATSAPP_BRIDGE_TOKEN</code> — same value as bridge's <code>BRIDGE_TOKEN</code></li>
            <li><code>WHATSAPP_WEBHOOK_SECRET</code> — same value as bridge's <code>WEBHOOK_SECRET</code></li>
          </ul>
        </div>
      ) : session?.status === 'qr' && session.last_qr ? (
        <div className="flex flex-col items-center gap-3">
          <p className="text-sm text-muted-foreground">
            Open WhatsApp on your phone → Settings → Linked Devices → Link a Device → scan this code.
          </p>
          <img src={session.last_qr} alt="WhatsApp QR" className="w-64 h-64 border rounded-lg" />
          {session.last_qr_at && (
            <p className="text-xs text-muted-foreground">
              Generated {formatDistanceToNow(new Date(session.last_qr_at), { addSuffix: true })} — refresh if expired.
            </p>
          )}
        </div>
      ) : (
        <div className="text-sm space-y-2">
          <p className="font-medium">Status: {session?.status || 'unknown'}</p>
          {session?.phone_number && <p className="text-muted-foreground">Number: +{session.phone_number}</p>}
          {session?.last_error && <p className="text-red-600">Last error: {session.last_error}</p>}
          <p className="text-muted-foreground">
            Click <strong>Refresh</strong> above to fetch the latest QR / connection state from the bridge.
          </p>
        </div>
      )}
    </Card>
  );

  const InboxGrid = (
    <div className="grid grid-cols-12 gap-4 h-[70vh]">
      <Card className="col-span-4 p-0 flex flex-col overflow-hidden">
        <div className="p-3 border-b space-y-2">
          <div className="flex gap-2">
            <Input
              placeholder="New chat: 14155551234"
              value={composeJid}
              onChange={(e) => setComposeJid(e.target.value)}
              className="h-8 text-sm"
            />
            <Button size="sm" onClick={startNewThread}>Start</Button>
          </div>
          <div className="flex gap-1 text-xs">
            {(['all','direct','groups','unread'] as const).map(f => (
              <button
                key={f}
                onClick={() => setChatFilter(f)}
                className={`px-2 py-1 rounded ${chatFilter === f ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/70'}`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
        <ScrollArea className="flex-1">
          {visibleContacts.length === 0 && (
            <div className="p-4 text-sm text-muted-foreground">No conversations.</div>
          )}
          {visibleContacts.map(c => (
            <button
              key={c.id}
              onClick={() => setActiveJid(c.jid)}
              className={`w-full text-left px-3 py-2 border-b hover:bg-muted/50 ${activeJid === c.jid ? 'bg-muted' : ''}`}
            >
              <div className="flex items-center justify-between">
                <span className="font-medium truncate flex items-center gap-1">
                  {c.is_group && <Users className="h-3 w-3 text-muted-foreground" />}
                  {c.display_name || c.phone || c.jid}
                </span>
                {c.unread_count > 0 && (
                  <Badge className="ml-2 bg-emerald-500 text-white">{c.unread_count}</Badge>
                )}
              </div>
              {c.last_message_preview && (
                <p className="text-xs text-muted-foreground truncate mt-0.5">{c.last_message_preview}</p>
              )}
            </button>
          ))}
        </ScrollArea>
      </Card>

      <Card className="col-span-8 p-0 flex flex-col overflow-hidden">
        {!activeJid ? (
          <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
            Pick a conversation
          </div>
        ) : (
          <>
            <div className="p-3 border-b">
              <p className="font-medium flex items-center gap-2">
                {activeContact?.is_group && <Users className="h-4 w-4 text-muted-foreground" />}
                {activeContact?.display_name || activeJid}
              </p>
              <p className="text-xs text-muted-foreground">{activeContact?.phone || activeJid}</p>
            </div>
            <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-2 bg-muted/20">
              {messages.map(m => (
                <div key={m.id} className={`flex ${m.direction === 'outbound' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[70%] rounded-lg px-3 py-2 text-sm ${
                    m.direction === 'outbound'
                      ? 'bg-emerald-500 text-white'
                      : 'bg-background border'
                  }`}>
                    {activeContact?.is_group && m.direction === 'inbound' && m.sender_name && (
                      <div className="text-[10px] font-medium text-emerald-700 mb-0.5">{m.sender_name}</div>
                    )}
                    {m.body || <em className="opacity-70">[{m.message_type}]</em>}
                    <div className="text-[10px] opacity-70 mt-1">
                      {m.wa_timestamp ? new Date(m.wa_timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="p-3 border-t flex gap-2">
              <Input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
                placeholder="Type a message…"
                disabled={sending}
              />
              <Button onClick={() => send()} disabled={sending || !draft.trim()}>
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            </div>
          </>
        )}
      </Card>
    </div>
  );

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold flex items-center gap-2">
              <MessageCircle className="h-6 w-6" /> WhatsApp — Team Comms
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              {session?.phone_number ? `Connected as +${session.phone_number}` : 'Not paired'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {statusBadge}
            <Button variant="outline" size="sm" onClick={refreshStatus} disabled={statusLoading}>
              {statusLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
              Refresh
            </Button>
            {session?.status === 'connected' && (
              <Button variant="outline" size="sm" onClick={logout}>
                <LogOut className="h-4 w-4 mr-2" /> Disconnect
              </Button>
            )}
          </div>
        </div>

        <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
          <TabsList>
            <TabsTrigger value="chats"><MessageCircle className="h-4 w-4 mr-1.5" />Chats</TabsTrigger>
            <TabsTrigger value="groups"><Users className="h-4 w-4 mr-1.5" />Groups ({groupContacts.length})</TabsTrigger>
            <TabsTrigger value="alerts"><BellRing className="h-4 w-4 mr-1.5" />Jarvis Alerts</TabsTrigger>
            <TabsTrigger value="health"><HeartPulse className="h-4 w-4 mr-1.5" />Health & Queue</TabsTrigger>
            <TabsTrigger value="settings"><SettingsIcon className="h-4 w-4 mr-1.5" />Settings</TabsTrigger>
          </TabsList>

          <TabsContent value="chats" className="mt-4 space-y-4">
            {session?.status !== 'connected' ? ConnectionCard : InboxGrid}
          </TabsContent>

          <TabsContent value="groups" className="mt-4 space-y-4">
            {session?.status !== 'connected' ? ConnectionCard : (
              <Card className="p-0">
                <div className="p-3 border-b flex items-center justify-between">
                  <p className="font-medium flex items-center gap-2"><Users className="h-4 w-4" /> Monitored Groups</p>
                  <span className="text-xs text-muted-foreground">{groupContacts.length} total</span>
                </div>
                {groupContacts.length === 0 ? (
                  <div className="p-6 text-sm text-muted-foreground">
                    No group chats yet. Get added to a WhatsApp group from the paired number and messages will appear here.
                  </div>
                ) : (
                  <div className="divide-y">
                    {groupContacts.map(g => (
                      <button
                        key={g.id}
                        onClick={() => { setActiveJid(g.jid); setTab('chats'); setChatFilter('groups'); }}
                        className="w-full text-left px-4 py-3 hover:bg-muted/50 flex items-center justify-between"
                      >
                        <div>
                          <div className="font-medium">{g.display_name || g.jid}</div>
                          {g.last_message_preview && (
                            <div className="text-xs text-muted-foreground truncate max-w-md">{g.last_message_preview}</div>
                          )}
                        </div>
                        <div className="text-right">
                          {g.last_message_at && (
                            <div className="text-xs text-muted-foreground">
                              {formatDistanceToNow(new Date(g.last_message_at), { addSuffix: true })}
                            </div>
                          )}
                          {g.unread_count > 0 && (
                            <Badge className="mt-1 bg-emerald-500 text-white">{g.unread_count} unread</Badge>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </Card>
            )}
          </TabsContent>

          <TabsContent value="alerts" className="mt-4 space-y-4">
            <JarvisAlertsPanel />
          </TabsContent>

          <TabsContent value="health" className="mt-4 space-y-4">
            <WhatsAppHealthTab
              session={session as any}
              bridgeConfigured={bridgeConfigured}
              onRefresh={refreshStatus}
              onLogout={logout}
              refreshing={statusLoading}
            />
          </TabsContent>

          <TabsContent value="settings" className="mt-4 space-y-4">
            {ConnectionCard}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}