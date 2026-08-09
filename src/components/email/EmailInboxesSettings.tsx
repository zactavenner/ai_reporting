import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Plus, Mail, Trash2, RefreshCw, Loader2, Copy } from 'lucide-react';
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
  const REDIRECT_URI = `https://jgwwmtuvjlmzapwqiabu.supabase.co/functions/v1/gmail-oauth-callback`;

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
      const returnUrl = window.location.href;
      const { data, error } = await supabase.functions.invoke('gmail-oauth-start', {
        body: { redirect_uri: redirectUri, state: returnUrl },
      });
      if (error) throw error;
      const url = (data as any)?.auth_url;
      if (!url) throw new Error('No auth URL returned');
      // OAuth must happen at the top level; popups are blocked in the Lovable preview iframe.
      const top = window.top;
      if (top && top !== window.self) {
        top.location.href = url;
      } else {
        window.location.href = url;
      }
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

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Google OAuth setup</CardTitle>
          <p className="text-sm text-muted-foreground mt-1">
            <strong>Not recommended for automated sending.</strong> If this Google project's consent screen is in
            Testing mode, refresh tokens for restricted Gmail scopes expire every 7 days, so the connection dies weekly
            without warning. For shadow-invite / notetaker sending use Resend or SMTP secrets instead — this connection
            is an optional convenience only.
          </p>
          <p className="text-sm text-muted-foreground mt-1">
            If Google shows <strong>Error 400: redirect_uri_mismatch</strong>, add this exact URL as an
            Authorized redirect URI on your Google OAuth client (APIs &amp; Services → Credentials), then retry.
          </p>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2">
            <code className="flex-1 rounded-md bg-muted px-3 py-2 text-xs break-all">{REDIRECT_URI}</code>
            <Button
              size="sm"
              variant="outline"
              className="gap-2"
              onClick={() => {
                navigator.clipboard.writeText(REDIRECT_URI);
                toast.success('Redirect URI copied');
              }}
            >
              <Copy className="h-3.5 w-3.5" /> Copy
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}