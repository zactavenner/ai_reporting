import { useState } from 'react';
import { useClient } from '@/hooks/useClients';
import { useClientSettings, useUpdateClientSettings } from '@/hooks/useClientSettings';
import { useIntegrationStatuses, getStatusColor } from '@/hooks/useIntegrationStatus';
import { useSyncMetaAds } from '@/hooks/useMetaAds';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  RefreshCw,
  Pencil,
  ExternalLink,
  Plug,
} from 'lucide-react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import { cn } from '@/lib/utils';

type PlatformId = 'meta' | 'ghl' | 'hubspot' | 'meetgeek' | 'fathom';

interface PlatformDef {
  id: PlatformId;
  name: string;
  icon: string;
  integrationName: string; // matches integration_status.integration_name
  docsUrl: string;
  fields: {
    key: string;
    label: string;
    placeholder: string;
    secret?: boolean;
    source: 'client' | 'client_settings';
    transform?: (v: string) => string;
  }[];
  toggles?: {
    key: string;
    label: string;
    source: 'client_settings';
  }[];
  isConfigured: (client: any, settings: any) => boolean;
  accountLabel: (client: any, settings: any) => string | null;
  lastSyncField?: string; // on client
}

const PLATFORMS: PlatformDef[] = [
  {
    id: 'meta',
    name: 'Meta Ads',
    icon: '📘',
    integrationName: 'meta_ads',
    docsUrl: 'https://business.facebook.com/settings/system-users',
    fields: [
      { key: 'meta_access_token', label: 'Access Token', placeholder: 'EAAx...', secret: true, source: 'client' },
      {
        key: 'meta_ad_account_id',
        label: 'Ad Account ID',
        placeholder: '123456789 (no act_ prefix)',
        source: 'client',
        transform: (v) => v.trim().replace(/^act_/, ''),
      },
    ],
    isConfigured: (c) => !!c?.meta_access_token && !!c?.meta_ad_account_id,
    accountLabel: (c) => (c?.meta_ad_account_id ? `act_${c.meta_ad_account_id}` : null),
  },
  {
    id: 'ghl',
    name: 'GoHighLevel',
    icon: '🏢',
    integrationName: 'ghl',
    docsUrl: 'https://highlevel.stoplight.io/',
    fields: [
      { key: 'ghl_location_id', label: 'Location ID', placeholder: 'loc_...', source: 'client' },
      { key: 'ghl_api_key', label: 'Private Integration Key', placeholder: 'pit-...', secret: true, source: 'client' },
    ],
    toggles: [
      { key: 'ghl_sync_contacts_enabled', label: 'Sync contacts', source: 'client_settings' },
      { key: 'ghl_sync_calls_enabled', label: 'Sync calls', source: 'client_settings' },
    ],
    isConfigured: (c) => !!c?.ghl_location_id && !!c?.ghl_api_key,
    accountLabel: (c) => c?.ghl_location_id || null,
    lastSyncField: 'last_ghl_sync_at',
  },
  {
    id: 'hubspot',
    name: 'HubSpot',
    icon: '🟠',
    integrationName: 'hubspot',
    docsUrl: 'https://developers.hubspot.com/docs/api/private-apps',
    fields: [
      { key: 'hubspot_portal_id', label: 'Portal ID', placeholder: '12345678', source: 'client' },
      { key: 'hubspot_access_token', label: 'Private App Token', placeholder: 'pat-na1-...', secret: true, source: 'client' },
    ],
    toggles: [
      { key: 'hubspot_sync_enabled', label: 'Enable sync', source: 'client_settings' },
    ],
    isConfigured: (c) => !!c?.hubspot_access_token,
    accountLabel: (c) => c?.hubspot_portal_id || null,
    lastSyncField: 'last_hubspot_sync_at',
  },
  {
    id: 'meetgeek',
    name: 'MeetGeek',
    icon: '🎙️',
    integrationName: 'meetgeek',
    docsUrl: 'https://docs.meetgeek.ai/',
    fields: [],
    isConfigured: () => true,
    accountLabel: () => 'Agency-wide webhook',
  },
  {
    id: 'fathom',
    name: 'Fathom',
    icon: '📞',
    integrationName: 'fathom',
    docsUrl: 'https://help.fathom.video/',
    fields: [],
    isConfigured: () => true,
    accountLabel: () => 'Agency-wide webhook',
  },
];

function StatusPill({ color, label }: { color: 'green' | 'yellow' | 'red'; label: string }) {
  const Icon = color === 'green' ? CheckCircle2 : color === 'yellow' ? AlertTriangle : XCircle;
  const cls =
    color === 'green'
      ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30'
      : color === 'yellow'
        ? 'bg-amber-500/10 text-amber-600 border-amber-500/30'
        : 'bg-rose-500/10 text-rose-600 border-rose-500/30';
  return (
    <Badge variant="outline" className={cn('gap-1', cls)}>
      <Icon className="h-3 w-3" />
      {label}
    </Badge>
  );
}

export default function ConnectionsTab({ clientId }: { clientId: string }) {
  const { data: client } = useClient(clientId);
  const { data: settings } = useClientSettings(clientId);
  const { data: statuses = [] } = useIntegrationStatuses();
  const [editing, setEditing] = useState<PlatformId | null>(null);

  if (!client) {
    return <div className="text-sm text-muted-foreground">Loading…</div>;
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-bold flex items-center gap-2">
          <Plug className="h-5 w-5" />
          Connections
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          Single source of truth for every integration on this client. Edit once — everything else (dashboards, syncs, ad manager) reads from here.
        </p>
      </div>

      <div className="grid gap-3">
        {PLATFORMS.map((p) => {
          const status = statuses.find((s) => s.integration_name === p.integrationName && (s.client_id === clientId || s.client_id === null));
          const configured = p.isConfigured(client, settings);
          const color: 'green' | 'yellow' | 'red' = configured ? getStatusColor(status) : 'red';
          const label = !configured ? 'Not connected' : color === 'green' ? 'Healthy' : color === 'yellow' ? 'Needs attention' : 'Broken';
          const lastSync = p.lastSyncField ? (client as any)[p.lastSyncField] : status?.last_sync_at;
          const accountLabel = p.accountLabel(client, settings);

          return (
            <Card key={p.id} className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3 flex-1 min-w-0">
                  <span className="text-2xl leading-none mt-0.5">{p.icon}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-semibold">{p.name}</h3>
                      <StatusPill color={color} label={label} />
                    </div>
                    <div className="text-xs text-muted-foreground mt-1 space-y-0.5">
                      {accountLabel && <div className="font-mono truncate">{accountLabel}</div>}
                      {lastSync && (
                        <div>Last sync: {formatDistanceToNow(new Date(lastSync), { addSuffix: true })}</div>
                      )}
                      {status?.last_error_message && color !== 'green' && (
                        <div className="text-rose-600 truncate" title={status.last_error_message}>
                          {status.last_error_message}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {p.id === 'meta' && configured && <SyncMetaButton clientId={clientId} />}
                  {p.fields.length > 0 && (
                    <Button variant="outline" size="sm" onClick={() => setEditing(p.id)} className="gap-1.5">
                      <Pencil className="h-3.5 w-3.5" />
                      Edit
                    </Button>
                  )}
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      <p className="text-xs text-muted-foreground pt-2">
        Need to manage agency-wide defaults (shared Meta token, webhook secrets)?{' '}
        <a href="/settings" className="text-primary hover:underline inline-flex items-center gap-1">
          Agency settings <ExternalLink className="h-3 w-3" />
        </a>
      </p>

      {PLATFORMS.map((p) => (
        <EditDrawer
          key={p.id}
          platform={p}
          open={editing === p.id}
          onOpenChange={(o) => setEditing(o ? p.id : null)}
          clientId={clientId}
          client={client}
          settings={settings}
        />
      ))}
    </div>
  );
}

function SyncMetaButton({ clientId }: { clientId: string }) {
  const syncMeta = useSyncMetaAds();
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => syncMeta.mutate({ clientId })}
      disabled={syncMeta.isPending}
      className="gap-1.5"
    >
      <RefreshCw className={cn('h-3.5 w-3.5', syncMeta.isPending && 'animate-spin')} />
      Sync now
    </Button>
  );
}

function EditDrawer({
  platform,
  open,
  onOpenChange,
  clientId,
  client,
  settings,
}: {
  platform: PlatformDef;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientId: string;
  client: any;
  settings: any;
}) {
  const queryClient = useQueryClient();
  const updateSettings = useUpdateClientSettings();
  const [values, setValues] = useState<Record<string, string>>({});
  const [toggleValues, setToggleValues] = useState<Record<string, boolean>>({});
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);

  // Initialize from existing data when opening
  const initFromProps = () => {
    const v: Record<string, string> = {};
    platform.fields.forEach((f) => {
      const src = f.source === 'client' ? client : settings;
      v[f.key] = (src?.[f.key] as string) || '';
    });
    const t: Record<string, boolean> = {};
    platform.toggles?.forEach((tg) => {
      t[tg.key] = !!settings?.[tg.key];
    });
    setValues(v);
    setToggleValues(t);
  };

  // Sheet handles its own mount/unmount; reset on open transition
  const handleOpenChange = (o: boolean) => {
    if (o) initFromProps();
    onOpenChange(o);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      // Split into client vs client_settings
      const clientUpdates: Record<string, any> = {};
      const settingsUpdates: Record<string, any> = { client_id: clientId };
      platform.fields.forEach((f) => {
        const raw = values[f.key] ?? '';
        const final = f.transform ? f.transform(raw) : raw.trim();
        const target = f.source === 'client' ? clientUpdates : settingsUpdates;
        target[f.key] = final || null;
      });
      platform.toggles?.forEach((tg) => {
        settingsUpdates[tg.key] = !!toggleValues[tg.key];
      });

      if (Object.keys(clientUpdates).length > 0) {
        const { error } = await supabase.from('clients').update(clientUpdates).eq('id', clientId);
        if (error) throw error;
      }
      if (Object.keys(settingsUpdates).length > 1) {
        await updateSettings.mutateAsync(settingsUpdates as any);
      }

      queryClient.invalidateQueries({ queryKey: ['client', clientId] });
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      queryClient.invalidateQueries({ queryKey: ['client-settings', clientId] });
      queryClient.invalidateQueries({ queryKey: ['integration-statuses'] });
      toast.success(`${platform.name} connection updated`);
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <span className="text-xl">{platform.icon}</span>
            {platform.name}
          </SheetTitle>
          <SheetDescription>
            <a
              href={platform.docsUrl}
              target="_blank"
              rel="noreferrer"
              className="text-primary hover:underline inline-flex items-center gap-1 text-xs"
            >
              Where do I find these? <ExternalLink className="h-3 w-3" />
            </a>
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-4 py-4">
          {platform.fields.map((f) => (
            <div key={f.key} className="space-y-1.5">
              <Label className="text-sm">{f.label}</Label>
              <Input
                type={f.secret && !showSecrets[f.key] ? 'password' : 'text'}
                value={values[f.key] || ''}
                onChange={(e) => setValues((prev) => ({ ...prev, [f.key]: e.target.value }))}
                placeholder={f.placeholder}
                className="font-mono text-sm"
              />
              {f.secret && (
                <button
                  type="button"
                  onClick={() => setShowSecrets((s) => ({ ...s, [f.key]: !s[f.key] }))}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  {showSecrets[f.key] ? 'Hide' : 'Show'}
                </button>
              )}
            </div>
          ))}

          {platform.toggles && platform.toggles.length > 0 && (
            <div className="space-y-3 pt-2 border-t">
              {platform.toggles.map((tg) => (
                <div key={tg.key} className="flex items-center justify-between">
                  <Label className="text-sm">{tg.label}</Label>
                  <Switch
                    checked={!!toggleValues[tg.key]}
                    onCheckedChange={(c) => setToggleValues((prev) => ({ ...prev, [tg.key]: c }))}
                  />
                </div>
              ))}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}