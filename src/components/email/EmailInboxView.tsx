import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Archive, Mail, Sparkles, Send, RefreshCw, Inbox as InboxIcon, AlertCircle, Search } from 'lucide-react';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';
import { cn } from '@/lib/utils';

type Filter = 'all' | 'unread' | 'requires_response' | 'archived' | 'high_priority';

const classificationColors: Record<string, string> = {
  important_human: 'bg-blue-500/10 text-blue-500',
  client: 'bg-emerald-500/10 text-emerald-500',
  sales: 'bg-amber-500/10 text-amber-500',
  partner_vendor: 'bg-purple-500/10 text-purple-500',
  internal: 'bg-indigo-500/10 text-indigo-500',
  newsletter: 'bg-muted text-muted-foreground',
  promotional: 'bg-muted text-muted-foreground',
  cold_outreach: 'bg-muted text-muted-foreground',
  spam: 'bg-destructive/10 text-destructive',
  unclassified: 'bg-muted text-muted-foreground',
};

const priorityColors: Record<string, string> = {
  high: 'bg-red-500',
  medium: 'bg-amber-500',
  low: 'bg-muted-foreground/40',
  none: 'bg-transparent',
};

export function EmailInboxView() {
  const [emails, setEmails] = useState<any[]>([]);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [accountFilter, setAccountFilter] = useState<string>('all');
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<any | null>(null);
  const [draft, setDraft] = useState<any | null>(null);
  const [draftLoading, setDraftLoading] = useState(false);
  const [editedBody, setEditedBody] = useState('');
  const [sending, setSending] = useState(false);

  async function load() {
    setLoading(true);
    const [{ data: ems }, { data: accs }] = await Promise.all([
      supabase.from('emails').select('*').order('received_at', { ascending: false }).limit(300),
      supabase.from('v_gmail_accounts').select('*'),
    ]);
    setEmails(ems || []);
    setAccounts(accs || []);
    setLoading(false);
  }

  useEffect(() => {
    load();
    const ch = supabase
      .channel('emails-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'emails' }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const filtered = useMemo(() => {
    return emails.filter((e) => {
      if (accountFilter !== 'all' && e.account_id !== accountFilter) return false;
      if (filter === 'unread' && !e.is_unread) return false;
      if (filter === 'requires_response' && !e.requires_response) return false;
      if (filter === 'archived' && !e.is_archived) return false;
      if (filter === 'high_priority' && e.priority !== 'high') return false;
      if (filter !== 'archived' && e.is_archived) return false;
      if (search) {
        const q = search.toLowerCase();
        if (
          !e.subject?.toLowerCase().includes(q) &&
          !e.from_email?.toLowerCase().includes(q) &&
          !e.from_name?.toLowerCase().includes(q) &&
          !e.snippet?.toLowerCase().includes(q)
        ) return false;
      }
      return true;
    });
  }, [emails, accountFilter, filter, search]);

  const counts = useMemo(() => {
    const active = emails.filter((e) => !e.is_archived);
    return {
      inbox: active.length,
      unread: active.filter((e) => e.is_unread).length,
      needs: active.filter((e) => e.requires_response).length,
      archived: emails.filter((e) => e.is_archived).length,
      auto: emails.filter((e) => e.auto_archived).length,
      zero: emails.length === 0 ? 100 : Math.round((1 - active.length / emails.length) * 100),
    };
  }, [emails]);

  async function openEmail(e: any) {
    setSelected(e);
    setDraft(null);
    setEditedBody('');
    if (e.is_unread) {
      try {
        await supabase.functions.invoke('email-action', { body: { action: 'mark_read', email_id: e.id } });
      } catch {}
    }
    // load latest draft if exists
    const { data: d } = await supabase.from('email_drafts').select('*').eq('email_id', e.id).order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (d) { setDraft(d); setEditedBody(d.body); }
  }

  async function generateDraft(regenerate = false) {
    if (!selected) return;
    setDraftLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('email-draft', { body: { email_id: selected.id } });
      if (error) throw error;
      const d = (data as any)?.draft;
      setDraft(d);
      setEditedBody(d?.body || '');
      toast.success(regenerate ? 'Regenerated' : 'Draft ready');
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setDraftLoading(false);
    }
  }

  async function sendDraft() {
    if (!selected || !draft) return;
    setSending(true);
    try {
      const { error } = await supabase.functions.invoke('email-action', {
        body: { action: 'send_draft', email_id: selected.id, draft_id: draft.id, edited_body: editedBody },
      });
      if (error) throw error;
      toast.success('Reply sent');
      setDraft(null);
      setSelected(null);
      load();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSending(false);
    }
  }

  async function archive(emailId: string) {
    await supabase.functions.invoke('email-action', { body: { action: 'archive', email_id: emailId } });
    setSelected(null);
    load();
  }

  async function syncAll() {
    toast.info('Syncing all inboxes…');
    await supabase.functions.invoke('gmail-sync', { body: { password: 'HPA1234$' } });
    setTimeout(load, 1500);
  }

  return (
    <div className="space-y-4">
      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <KPI label="Inbox" value={counts.inbox} />
        <KPI label="Needs reply" value={counts.needs} accent="text-amber-500" />
        <KPI label="Unread" value={counts.unread} />
        <KPI label="Auto-archived" value={counts.auto} accent="text-emerald-500" />
        <KPI label="Inbox Zero" value={`${counts.zero}%`} accent="text-primary" />
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search emails…" className="pl-9" />
        </div>
        <Select value={accountFilter} onValueChange={setAccountFilter}>
          <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All inboxes</SelectItem>
            {accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.email}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filter} onValueChange={(v) => setFilter(v as Filter)}>
          <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="unread">Unread</SelectItem>
            <SelectItem value="requires_response">Needs response</SelectItem>
            <SelectItem value="high_priority">High priority</SelectItem>
            <SelectItem value="archived">Archived</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={syncAll} className="gap-2">
          <RefreshCw className="h-4 w-4" /> Sync now
        </Button>
      </div>

      {/* List + reader */}
      <div className="grid grid-cols-1 lg:grid-cols-[420px_1fr] gap-4">
        <Card className="overflow-hidden">
          <div className="max-h-[700px] overflow-y-auto divide-y divide-border">
            {loading ? (
              <div className="p-12 text-center"><Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" /></div>
            ) : filtered.length === 0 ? (
              <div className="p-12 text-center text-muted-foreground">
                <InboxIcon className="h-8 w-8 mx-auto mb-2 opacity-40" />
                Inbox zero. Nothing to see here.
              </div>
            ) : filtered.map((e) => (
              <button
                key={e.id}
                onClick={() => openEmail(e)}
                className={cn(
                  'w-full text-left p-3 hover:bg-accent/50 transition-colors flex gap-3',
                  selected?.id === e.id && 'bg-accent',
                  e.is_unread && 'bg-primary/5',
                )}
              >
                <div className={cn('w-1 self-stretch rounded-full', priorityColors[e.priority || 'none'])} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className={cn('text-sm truncate', e.is_unread && 'font-semibold')}>
                      {e.from_name || e.from_email}
                    </span>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {e.received_at && formatDistanceToNow(new Date(e.received_at), { addSuffix: false })}
                    </span>
                  </div>
                  <div className={cn('text-sm truncate', e.is_unread ? 'text-foreground' : 'text-muted-foreground')}>
                    {e.subject || '(no subject)'}
                  </div>
                  <div className="text-xs text-muted-foreground truncate mt-0.5">{e.snippet}</div>
                  <div className="flex items-center gap-1.5 mt-1.5">
                    {e.classification && e.classification !== 'unclassified' && (
                      <Badge variant="outline" className={cn('text-[10px] px-1.5 py-0 h-4 border-0', classificationColors[e.classification])}>
                        {e.classification.replace(/_/g, ' ')}
                      </Badge>
                    )}
                    {e.requires_response && (
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 border-0 bg-amber-500/10 text-amber-600">
                        needs reply
                      </Badge>
                    )}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </Card>

        {/* Reader */}
        <Card className="p-0 overflow-hidden">
          {!selected ? (
            <div className="h-[700px] flex items-center justify-center text-muted-foreground text-sm">
              <div className="text-center">
                <Mail className="h-10 w-10 mx-auto mb-3 opacity-30" />
                Select an email to read
              </div>
            </div>
          ) : (
            <div className="flex flex-col h-[700px]">
              <div className="p-5 border-b border-border">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <h2 className="text-lg font-semibold truncate">{selected.subject || '(no subject)'}</h2>
                    <div className="text-sm text-muted-foreground mt-1">
                      <span className="font-medium text-foreground">{selected.from_name || selected.from_email}</span>
                      {selected.from_name && <span> &lt;{selected.from_email}&gt;</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button size="sm" variant="ghost" onClick={() => archive(selected.id)} className="gap-1.5">
                      <Archive className="h-4 w-4" /> Archive
                    </Button>
                  </div>
                </div>
                <div className="flex items-center gap-2 mt-3">
                  {selected.classification && selected.classification !== 'unclassified' && (
                    <Badge variant="outline" className={cn('text-xs border-0', classificationColors[selected.classification])}>
                      {selected.classification.replace(/_/g, ' ')}
                    </Badge>
                  )}
                  {selected.priority && selected.priority !== 'none' && (
                    <Badge variant="outline" className="text-xs">{selected.priority} priority</Badge>
                  )}
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-5 text-sm whitespace-pre-wrap">
                {selected.body_text || selected.snippet || '(empty)'}
              </div>

              {/* Draft panel */}
              <div className="border-t border-border p-4 bg-muted/30">
                {!draft ? (
                  <Button onClick={() => generateDraft()} disabled={draftLoading} className="gap-2 w-full" variant="outline">
                    {draftLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                    Generate AI reply
                  </Button>
                ) : (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <div className="flex items-center gap-2">
                        <Sparkles className="h-3.5 w-3.5 text-primary" />
                        AI draft · {Math.round((draft.confidence || 0) * 100)}% confidence · {draft.urgency} urgency
                      </div>
                    </div>
                    <Textarea value={editedBody} onChange={(e) => setEditedBody(e.target.value)} rows={6} className="text-sm" />
                    <div className="flex items-center gap-2">
                      <Button onClick={sendDraft} disabled={sending} className="gap-2 flex-1">
                        {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                        {editedBody === draft.body ? 'Approve & send' : 'Send edited'}
                      </Button>
                      <Button variant="outline" onClick={() => generateDraft(true)} disabled={draftLoading} className="gap-2">
                        {draftLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                        Regenerate
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function KPI({ label, value, accent }: { label: string; value: any; accent?: string }) {
  return (
    <Card className="p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn('text-2xl font-semibold mt-1', accent)}>{value}</div>
    </Card>
  );
}