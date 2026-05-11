import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ExternalLink, Save, Pencil } from 'lucide-react';
import { useAgencySettings, useUpdateAgencySettings } from '@/hooks/useAgencySettings';
import { useClientSettings, useUpdateClientSettings } from '@/hooks/useClientSettings';
import { toast } from 'sonner';

type FieldKey = 'kpi_google_doc_url' | 'kpi_google_sheet_url';

interface InlineUrlEmbedProps {
  label: string;
  url: string;
  fieldKey: FieldKey;
  /** When provided, the URL is saved per-client (client_settings). Otherwise, agency-wide. */
  clientId?: string;
}

export function InlineUrlEmbed({ label, url, fieldKey, clientId }: InlineUrlEmbedProps) {
  const updateAgency = useUpdateAgencySettings();
  const updateClient = useUpdateClientSettings();
  const { data: clientSettings } = useClientSettings(clientId);

  // Per-client URL takes precedence; fall back to provided (agency) URL.
  const effectiveUrl = clientId
    ? ((clientSettings as any)?.[fieldKey] as string | null | undefined) ?? url
    : url;

  const [editing, setEditing] = useState(!effectiveUrl);
  const [value, setValue] = useState(effectiveUrl || '');

  useEffect(() => {
    setValue(effectiveUrl || '');
    setEditing(!effectiveUrl);
  }, [effectiveUrl]);

  const handleSave = async () => {
    const trimmed = value.trim();
    if (!trimmed) {
      toast.error('Please enter a valid URL');
      return;
    }
    try {
      if (clientId) {
        await updateClient.mutateAsync({ client_id: clientId, [fieldKey]: trimmed } as any);
        toast.success(`${label} URL saved for this client`);
      } else {
        await updateAgency.mutateAsync({ [fieldKey]: trimmed } as any);
        toast.success(`${label} URL saved — applied everywhere`);
      }
      setEditing(false);
    } catch (e: any) {
      toast.error('Failed to save: ' + (e?.message || 'Unknown error'));
    }
  };

  const isPending = clientId ? updateClient.isPending : updateAgency.isPending;

  if (editing) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          {clientId
            ? `Paste this client's ${label} URL. It will be saved for this client only.`
            : `Paste the ${label} URL below. It will be saved to Agency Settings and used everywhere.`}
        </p>
        <div className="flex gap-2 max-w-2xl">
          <Input
            placeholder={`https://docs.google.com/...`}
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
          <Button onClick={handleSave} disabled={isPending}>
            <Save className="h-4 w-4 mr-2" />
            Save
          </Button>
          {effectiveUrl && (
            <Button variant="ghost" onClick={() => { setValue(effectiveUrl); setEditing(false); }}>
              Cancel
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Button asChild variant="outline" size="sm">
          <a href={effectiveUrl} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="h-4 w-4 mr-2" />
            Open in new tab
          </a>
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
          <Pencil className="h-4 w-4 mr-2" />
          Edit URL
        </Button>
      </div>
      <iframe
        src={effectiveUrl.replace('/edit', '/preview')}
        className="w-full h-[80vh] border border-border rounded-lg"
        title={label}
      />
    </div>
  );
}