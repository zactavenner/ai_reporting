import { useState, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Video, RefreshCw, Loader2, Copy, CheckCircle, Eye, EyeOff } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';

interface MeetGeekIntegrationSectionProps {
  clientId: string;
  settings: any;
}

export function MeetGeekIntegrationSection({ clientId, settings }: MeetGeekIntegrationSectionProps) {
  const queryClient = useQueryClient();
  const [enabled, setEnabled] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [webhookSecret, setWebhookSecret] = useState('');
  const [region, setRegion] = useState('us');
  const [showApiKey, setShowApiKey] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [remapping, setRemapping] = useState(false);

  useEffect(() => {
    if (settings) {
      const s = settings as any;
      setEnabled(s.meetgeek_enabled || false);
      setApiKey(s.meetgeek_api_key || '');
      setWebhookSecret(s.meetgeek_webhook_secret || '');
      setRegion(s.meetgeek_region || 'us');
    }
  }, [settings]);

  const webhookUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/meetgeek-webhook?client_id=${clientId}`;

  const handleCopyWebhook = () => {
    navigator.clipboard.writeText(webhookUrl);
    setCopied(true);
    toast.success('Webhook URL copied');
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const { error } = await supabase
        .from('client_settings')
        .upsert({
          client_id: clientId,
          meetgeek_enabled: enabled,
          meetgeek_api_key: apiKey || null,
          meetgeek_webhook_secret: webhookSecret || null,
          meetgeek_region: region,
        } as any, { onConflict: 'client_id' });

      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ['client-settings', clientId] });
      toast.success('MeetGeek settings saved');
    } catch (error) {
      console.error(error);
      toast.error('Failed to save MeetGeek settings');
    } finally {
      setSaving(false);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke('meetgeek-webhook', {
        body: { action: 'sync', client_id: clientId },
      });
      if (error) throw error;
      const synced = data?.synced || 0;
      const callsUpdated = data?.callsUpdated || 0;
      toast.success(`Synced ${synced} meetings, ${callsUpdated} call transcripts updated`);
      queryClient.invalidateQueries({ queryKey: ['meetings'] });
      queryClient.invalidateQueries({ queryKey: ['calls'] });
      queryClient.invalidateQueries({ queryKey: ['call-recordings'] });
    } catch (error) {
      console.error(error);
      toast.error('Failed to sync meetings');
    } finally {
      setSyncing(false);
    }
  };

  const handleRemap = async () => {
    setRemapping(true);
    try {
      const { data, error } = await supabase.functions.invoke('meetgeek-webhook', {
        body: { action: 'remap_clients', only_unmatched: true },
      });
      if (error) throw error;
      toast.success(`Re-mapped ${data?.updated || 0} of ${data?.scanned || 0} meetings`);
      queryClient.invalidateQueries({ queryKey: ['meetings'] });
    } catch (e) {
      console.error(e);
      toast.error('Failed to re-map meetings');
    } finally {
      setRemapping(false);
    }
  };

  return (
    <div className="border-2 border-border p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="font-medium mb-1 flex items-center gap-2">
            <Video className="h-4 w-4" />
            MeetGeek Integration
          </h4>
          <p className="text-sm text-muted-foreground">
            Auto-import call transcripts and summaries from MeetGeek.ai
          </p>
        </div>
        <Switch checked={enabled} onCheckedChange={setEnabled} />
      </div>

      {enabled && (
        <div className="space-y-4 pt-2">
          <div className="space-y-2">
            <Label>API Key</Label>
            <div className="relative">
              <Input
                type={showApiKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="Your MeetGeek API key"
                className="pr-10"
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 p-0"
                onClick={() => setShowApiKey(!showApiKey)}
              >
                {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Found in MeetGeek → Settings → API & Integrations
            </p>
          </div>

          <div className="space-y-2">
            <Label>Region</Label>
            <Select value={region} onValueChange={setRegion}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="us">US (api-us.meetgeek.ai)</SelectItem>
                <SelectItem value="eu">EU (api-eu.meetgeek.ai)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Webhook Secret (optional)</Label>
            <Input
              type="password"
              value={webhookSecret}
              onChange={(e) => setWebhookSecret(e.target.value)}
              placeholder="HMAC SHA-256 secret for signature verification"
            />
            <p className="text-xs text-muted-foreground">
              If set, incoming webhooks will be verified using X-MG-Signature header
            </p>
          </div>

          <div className="space-y-2">
            <Label>Webhook URL</Label>
            <div className="flex gap-2">
              <Input
                readOnly
                value={webhookUrl}
                className="font-mono text-xs bg-muted/50"
              />
              <Button variant="outline" size="sm" onClick={handleCopyWebhook}>
                {copied ? <CheckCircle className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Paste this URL in MeetGeek → Settings → Webhooks → "Meeting Analyzed" event
            </p>
          </div>

          {(settings as any)?.meetgeek_last_sync && (
            <div className="flex justify-between items-center text-sm p-2 border border-border bg-muted/30">
              <span className="text-muted-foreground">Last Sync:</span>
              <span className="font-medium">
                {new Date((settings as any).meetgeek_last_sync).toLocaleString()}
              </span>
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <Button variant="outline" onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Save MeetGeek Settings
            </Button>
            <Button
              variant="secondary"
              onClick={handleSync}
              disabled={syncing || !apiKey}
            >
              {syncing ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-2" />
              )}
              Sync Now
            </Button>
            <Button variant="ghost" onClick={handleRemap} disabled={remapping}>
              {remapping ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Re-match unmatched
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
