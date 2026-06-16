import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Plus, Mail, Trash2, RefreshCw, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';

interface GmailAccount {
  id: string;
  email: string;
  display_name: string | null;
  status: string;
  last_synced_at: string | null;
  created_at: string;
}

export function EmailInboxesSettings() {
  const [accounts, setAccounts] = useState<GmailAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [syncingId, setSyncingId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const { data } = await supabase.from('v_gmail_accounts').select('*').order('created_at');
    setAccounts((data as any) || []);
    setLoading(false);
  }

  useEffect(() => {
    load();
    const onMsg = (e: MessageEvent) => {
      if (e.data?.type === 'gmail_connected') {
        toast.success(`Connected ${e.data.email}`);
        load();
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);

  async function connectGmail() {
    setConnecting(true);
    try {
      const redirectUri = `https://jgwwmtuvjlmzapwqiabu.supabase.co/functions/v1/gmail-oauth-callback`;
      const { data, error } = await supabase.functions.invoke('gmail-oauth-start', {
        body: { redirect_uri: redirectUri },
      });
      if (error) throw error;
      const url = (data as any)?.auth_url;
      if (!url) throw new Error('No auth URL returned');
      window.open(url, 'gmail-oauth', 'width=520,height=720');
    } catch (e: any) {
      toast.error(e.message || 'Failed to start OAuth');
    } finally {
      setConnecting(false);
    }
  }

  async function removeAccount(id: string, email: string) {
    if (!confirm(`Remove ${email}? Synced emails will be deleted.`)) return;
    await supabase.from('gmail_accounts').delete().eq('id', id);
    toast.success('Removed');
    load();
  }

  async function syncNow(id: string) {
    setSyncingId(id);
    try {
      await supabase.functions.invoke('gmail-sync', { body: { account_id: id, password: 'HPA1234$' } });
      toast.success('Sync started');
      load();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSyncingId(null);
    }
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Connected Inboxes</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              Connect each teammate's Gmail. The Zero Inbox engine syncs all of them every 3 minutes.
            </p>
          </div>
          <Button onClick={connectGmail} disabled={connecting} className="gap-2">
            {connecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Connect Gmail
          </Button>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-12 text-center"><Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" /></div>
          ) : accounts.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              <Mail className="h-8 w-8 mx-auto mb-3 opacity-40" />
              No inboxes connected. Click <strong>Connect Gmail</strong> to add your first one.
            </div>
          ) : (
            <div className="divide-y divide-border">
              {accounts.map((a) => (
                <div key={a.id} className="flex items-center justify-between py-3">
                  <div className="flex items-center gap-3">
                    <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center">
                      <Mail className="h-4 w-4 text-primary" />
                    </div>
                    <div>
                      <div className="font-medium text-sm">{a.email}</div>
                      <div className="text-xs text-muted-foreground">
                        {a.last_synced_at ? `Last synced ${format(new Date(a.last_synced_at), 'MMM d, h:mm a')}` : 'Not synced yet'}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={a.status === 'active' ? 'default' : 'secondary'}>{a.status}</Badge>
                    <Button size="sm" variant="ghost" onClick={() => syncNow(a.id)} disabled={syncingId === a.id}>
                      {syncingId === a.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => removeAccount(a.id, a.email)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}