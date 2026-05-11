import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ExternalLink, Save, Pencil } from 'lucide-react';
import { useAgencySettings, useUpdateAgencySettings } from '@/hooks/useAgencySettings';
import { toast } from 'sonner';

interface InlineUrlEmbedProps {
  label: string;
  url: string;
  fieldKey: 'kpi_google_doc_url' | 'kpi_google_sheet_url';
}

export function InlineUrlEmbed({ label, url, fieldKey }: InlineUrlEmbedProps) {
  const { data: settings } = useAgencySettings();
  const updateSettings = useUpdateAgencySettings();
  const [editing, setEditing] = useState(!url);
  const [value, setValue] = useState(url);

  useEffect(() => {
    setValue(url);
    setEditing(!url);
  }, [url]);

  const handleSave = async () => {
    const trimmed = value.trim();
    if (!trimmed) {
      toast.error('Please enter a valid URL');
      return;
    }
    try {
      await updateSettings.mutateAsync({ [fieldKey]: trimmed } as any);
      toast.success(`${label} URL saved — applied everywhere`);
      setEditing(false);
    } catch (e: any) {
      toast.error('Failed to save: ' + (e?.message || 'Unknown error'));
    }
  };

  if (editing) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Paste the {label} URL below. It will be saved to Agency Settings and used everywhere.
        </p>
        <div className="flex gap-2 max-w-2xl">
          <Input
            placeholder={`https://docs.google.com/...`}
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
          <Button onClick={handleSave} disabled={updateSettings.isPending}>
            <Save className="h-4 w-4 mr-2" />
            Save
          </Button>
          {url && (
            <Button variant="ghost" onClick={() => { setValue(url); setEditing(false); }}>
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
          <a href={url} target="_blank" rel="noopener noreferrer">
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
        src={url.replace('/edit', '/preview')}
        className="w-full h-[80vh] border border-border rounded-lg"
        title={label}
      />
    </div>
  );
}