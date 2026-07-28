import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { whatsappDashboard } from '@/lib/whatsappDashboard';
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
  const [bridgeReachable, setBridgeReachable] = useState<boolean | null>(null);
  const [bridgeError, setBridgeError] = useState<string | null>(null);
  const [bridgeProbeBody, setBridgeProbeBody] = useState<unknown>(null);
  const [tab, setTab] = useState<'chats' | 'groups' | 'alerts' | 'health' | 'settings'>('chats');
  const [chatFilter, setChatFilter] = useState<'all' | 'direct' | 'groups' | 'unread'>('all');
  const [chatSearch, setChatSearch] = useState('');
  const [clients, setClients] = useState<{ id: string; name: string }[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  // ---- Client roster ------------------------------------------------------
  useEffect(() => {
    whatsappDashboard<{ clients: { id: string; name: string }[] }>('clients_list')
      .then(r => setClients(r.clients || []))
      .catch(() => {/* non-fatal */});
  }, []);

  const linkContactToClient = async (contactId: string, clientId: string | null) => {
    try {
      const r = await whatsappDashboard<{ contact: Contact }>('contact_link_client', {
        contact_id: contactId, linked_client_id: clientId,
      });
      setContacts(prev => prev.map(c => c.id === contactId ? { ...c, linked_client_id: r.contact?.linked_client_id ?? null } : c));
      toast.success(clientId ? 'Linked to client' : 'Unlinked');
    } catch (e: any) { toast.error('Link failed: ' + e.message); }
  };

  // ---- Session polling (every 4s) ----------------------------------------
  const loadSession = useCallback(async () => {
    try {
      const r = await whatsappDashboard<{
        session: Session;
        bridgeConfigured: boolean;
        bridgeReachable?: boolean;
        bridgeError?: string | null;
        bridgeProbe?: unknown;
      }>('session_get');
      setSession(r.session);
      setBridgeConfigured(r.bridgeConfigured);
      setBridgeReachable(r.bridgeReachable ?? null);
      setBridgeError(r.bridgeError ?? null);
      setBridgeProbeBody(r.bridgeProbe ?? null);
    } catch (e: any) {
      setBridgeError(e?.message || 'dashboard proxy failed');
      console.warn('session_get failed', e?.message);
    }
  }, []);
  useEffect(() => {
    loadSession();
    const id = window.setInterval(loadSession, 4000);
    return () => window.clearInterval(id);
  }, [loadSession]);

  // ---- Contact list polling ----------------------------------------------
  useEffect(() => {
    if (!session?.id) return;
    let mounted = true;
    const load = () => whatsappDashboard<{ contacts: Contact[] }>('contacts_list')
      .then(r => { if (mounted) setContacts(r.contacts || []); })
      .catch(() => {/* ignore transient */});
    load();
    const id = window.setInterval(load, 5000);
    return () => { mounted = false; window.clearInterval(id); };
  }, [session?.id]);

  // ---- Active thread polling ---------------------------------------------
  useEffect(() => {
    if (!session?.id || !activeJid) { setMessages([]); return; }
    let mounted = true;
    const load = () => whatsappDashboard<{ messages: Msg[] }>('messages_list', { jid: activeJid })
      .then(r => {
        if (!mounted) return;
        setMessages(r.messages || []);
        setTimeout(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }), 50);
      })
      .catch(() => {/* ignore */});
    load();
    whatsappDashboard('contact_mark_read', { jid: activeJid }).catch(() => {});
    const id = window.setInterval(load, 3500);
    return () => { mounted = false; window.clearInterval(id); };
  }, [session?.id, activeJid]);

  const refreshStatus = async () => {
    setStatusLoading(true);
    try {
      const r = await whatsappDashboard<{
        session: Session; bridgeConfigured: boolean; bridgeReachable?: boolean;
        error?: string; message?: string;
      }>('status_refresh');
      setSession(r.session);
      setBridgeConfigured(r.bridgeConfigured);
      setBridgeReachable(r.bridgeReachable ?? null);
      setBridgeError(r.error ?? null);
      if (r.error) toast.error(r.error);
      else if (r.bridgeConfigured === false) toast.error(r.message || 'Bridge not configured');
      else toast.success('Status refreshed');
    } catch (e: any) {
      setBridgeError(e?.message || 'dashboard proxy failed');
      toast.error('Status failed: ' + e.message);
    }
    finally { setStatusLoading(false); }
  };

  const resetPairing = async () => {
    setStatusLoading(true);
    try {
      await whatsappDashboard('status_reset');
      toast.success('Pairing reset — fetching a fresh QR…');
      // Poll a few times for the fresh QR to arrive from the bridge.
      for (let i = 0; i < 6; i++) {
        await new Promise(r => setTimeout(r, 1500));
        const r = await whatsappDashboard<{ session: Session }>('status_refresh').catch(() => null);
        if (r?.session) { setSession(r.session); if (r.session.last_qr) break; }
      }
    } catch (e: any) { toast.error('Reset failed: ' + e.message); }
    finally { setStatusLoading(false); }
  };

  const logout = async () => {
    if (!confirm('Disconnect and force re-pairing?')) return;
    try {
      await whatsappDashboard('status_logout');
      toast.success('Logged out — click Refresh for a new QR');
      loadSession();
    } catch (e: any) { toast.error('Logout failed: ' + e.message); }
  };

  const send = async (overrideJid?: string) => {
    const jid = overrideJid || activeJid;
    if (!jid || !draft.trim()) return;
    setSending(true);
    try {
      const r = await whatsappDashboard<{ ok: boolean; queued?: boolean; error?: string }>('send_message', {
        jid, message: draft.trim(),
      });
      if (r.queued) toast.warning('Not connected — queued for retry');
      setDraft('');
    } catch (e: any) { toast.error('Send failed: ' + e.message); }
    finally { setSending(false); }
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
          {(session?.last_error || bridgeError) && (
            <div className="rounded-md border border-red-300 bg-red-50 dark:bg-red-950/30 p-3 text-red-700 dark:text-red-300">
              <p className="font-medium">Bridge error</p>
              <p className="text-xs whitespace-pre-wrap break-all">{session?.last_error || bridgeError}</p>
            </div>
          )}
          {bridgeConfigured && bridgeReachable === false && (
            <p className="text-amber-600">
              Bridge URL is set but not responding to /health. Verify the deploy is running and BRIDGE_TOKEN matches.
            </p>
          )}
          <p className="text-muted-foreground">
            Click <strong>Refresh</strong> above to fetch the latest QR / connection state from the bridge.
          </p>
        </div>
      )}
    </Card>
  );

  const InboxGrid = (
    <div className="grid grid-cols-12 gap-4 h-[75vh]">
      <Card className="col-span-4 p-0 flex flex-col overflow-hidden">
        <div className="p-3 border-b space-y-2">
          <Input
            placeholder="Search chats, groups, phone…"
            value={chatSearch}
            onChange={(e) => setChatSearch(e.target.value)}
            className="h-8 text-sm"
          />
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
            <div className="p-4 text-sm text-muted-foreground">
              {session?.status === 'connected'
                ? 'No conversations yet. Send or receive a message to start one.'
                : 'Not paired yet — connect your phone in the Settings tab. Past history will appear here once paired.'}
            </div>
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
              <div className="flex items-center justify-between gap-2 mt-0.5">
              {c.last_message_preview && (
                  <p className="text-xs text-muted-foreground truncate flex-1">{c.last_message_preview}</p>
              )}
                {c.linked_client_id && (
                  <Badge variant="outline" className="text-[10px] shrink-0 border-emerald-500/40 text-emerald-700 dark:text-emerald-400">
                    <Link2 className="h-2.5 w-2.5 mr-0.5" />{clientNameFor(c.linked_client_id)}
                  </Badge>
                )}
                {c.last_message_at && !c.linked_client_id && (
                  <span className="text-[10px] text-muted-foreground shrink-0">
                    {formatDistanceToNow(new Date(c.last_message_at), { addSuffix: false })}
                  </span>
                )}
              </div>
            </button>
          ))}
        </ScrollArea>
      </Card>

      <Card className="col-span-8 p-0 flex flex-col overflow-hidden">
        {!activeJid ? (
          <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground text-sm gap-2 p-6 text-center">
            <MessageCircle className="h-10 w-10 opacity-30" />
            <p className="font-medium text-foreground">Select a conversation</p>
            <p className="max-w-xs">
              Direct chats and groups sync in real time from the paired WhatsApp number. Full message history is persisted per thread.
            </p>
          </div>
        ) : (
          <>
            <div className="p-3 border-b flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium flex items-center gap-2 truncate">
                  {activeContact?.is_group && <Users className="h-4 w-4 text-muted-foreground" />}
                  {activeContact?.display_name || activeJid}
                </p>
                <p className="text-xs text-muted-foreground truncate">{activeContact?.phone || activeJid}</p>
              </div>
              {activeContact && (
                <div className="flex items-center gap-1.5 shrink-0">
                  <Link2 className="h-3.5 w-3.5 text-muted-foreground" />
                  <Select
                    value={activeContact.linked_client_id || 'none'}
                    onValueChange={(v) => linkContactToClient(activeContact.id, v === 'none' ? null : v)}
                  >
                    <SelectTrigger className="h-8 w-[200px] text-xs">
                      <SelectValue placeholder="Link to client…" />
                    </SelectTrigger>
                    <SelectContent className="max-h-72">
                      <SelectItem value="none">— Unlinked —</SelectItem>
                      {clients.map(c => (
                        <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
            <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-2 bg-muted/20">
              {messages.length === 0 ? (
                <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
                  No messages in this thread yet.
                </div>
              ) : messages.map(m => (
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
                placeholder={session?.status === 'connected' ? 'Type a message…' : 'Not paired — messages will queue and send after connect'}
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
            <Button variant="outline" size="sm" onClick={resetPairing} disabled={statusLoading}>
              New QR
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
            {session?.status !== 'connected' && (
              <Card className="p-3 text-xs flex items-center justify-between gap-3 border-amber-500/40 bg-amber-500/5">
                <span>
                  <strong>Not paired.</strong> Message history stays visible below. Open the <em>Settings</em> tab and scan the QR to start syncing new messages.
                </span>
                <Button size="sm" variant="outline" onClick={() => setTab('settings')}>Open pairing</Button>
              </Card>
            )}
            {InboxGrid}
          </TabsContent>

          <TabsContent value="groups" className="mt-4 space-y-4">
            {session?.status !== 'connected' && (
              <Card className="p-3 text-xs border-amber-500/40 bg-amber-500/5">
                <strong>Not paired.</strong> Existing group threads still appear below. Pair a device to receive new messages.
              </Card>
            )}
            {(
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
                      <div key={g.id} className="px-4 py-3 hover:bg-muted/50 flex items-center justify-between gap-3">
                        <button
                          onClick={() => { setActiveJid(g.jid); setTab('chats'); setChatFilter('groups'); }}
                          className="text-left flex-1 min-w-0"
                        >
                          <div className="font-medium truncate">{g.display_name || g.jid}</div>
                          {g.last_message_preview && (
                            <div className="text-xs text-muted-foreground truncate max-w-md">{g.last_message_preview}</div>
                          )}
                        </button>
                        <div className="flex items-center gap-2 shrink-0">
                          <Select
                            value={g.linked_client_id || 'none'}
                            onValueChange={(v) => linkContactToClient(g.id, v === 'none' ? null : v)}
                          >
                            <SelectTrigger className="h-8 w-[180px] text-xs">
                              <SelectValue placeholder="Link to client…" />
                            </SelectTrigger>
                            <SelectContent className="max-h-72">
                              <SelectItem value="none">— Unlinked —</SelectItem>
                              {clients.map(c => (
                                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
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
                        </div>
                      </div>
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
              bridgeReachable={bridgeReachable}
              bridgeError={bridgeError}
              onRefresh={refreshStatus}
              onLogout={logout}
              onReset={resetPairing}
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