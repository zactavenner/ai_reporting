import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ExternalLink, Save, Pencil, Sparkles, Loader2 } from 'lucide-react';
import { useAgencySettings, useUpdateAgencySettings } from '@/hooks/useAgencySettings';
import { useClientSettings, useUpdateClientSettings } from '@/hooks/useClientSettings';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';

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

  // When bound to a client, ONLY use that client's saved URL — never fall back
  // to an agency-wide URL. Each client must have their own Doc / Sheet.
  const effectiveUrl = clientId
    ? (((clientSettings as any)?.[fieldKey] as string | null | undefined) ?? '')
    : url;

  const [editing, setEditing] = useState(!effectiveUrl);
  const [value, setValue] = useState(effectiveUrl || '');
  const [aiOpen, setAiOpen] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResult, setAiResult] = useState<string | null>(null);

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

  const isSheet = fieldKey === 'kpi_google_sheet_url';

  // Use Google's "edit" view inside the iframe so the user can actually write
  // (preview was read-only). Anyone signed in to the right Google account
  // will be able to edit directly in-place.
  const embedSrc = effectiveUrl
    ? effectiveUrl.replace('/preview', '/edit') + (effectiveUrl.includes('?') ? '&' : '?') + 'rm=embedded'
    : '';

  const handleAiReview = async () => {
    if (!effectiveUrl) return;
    setAiOpen(true);
    setAiLoading(true);
    setAiResult(null);
    try {
      const fn = isSheet ? 'ai-sheet-summary' : 'ai-sheet-summary';
      const { data, error } = await supabase.functions.invoke(fn, {
        body: clientId ? { client_id: clientId, doc_url: effectiveUrl } : { doc_url: effectiveUrl },
      });
      if (error) throw error;
      const text =
        (data as any)?.summary ||
        (data as any)?.text ||
        (typeof data === 'string' ? data : JSON.stringify(data, null, 2));
      setAiResult(text || 'No insights returned.');
    } catch (e: any) {
      setAiResult('Failed to run AI review: ' + (e?.message || 'Unknown error'));
    } finally {
      setAiLoading(false);
    }
  };

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
        <Button variant="secondary" size="sm" onClick={handleAiReview} disabled={aiLoading}>
          {aiLoading ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Sparkles className="h-4 w-4 mr-2" />
          )}
          AI Review & Improve
        </Button>
        <span className="ml-auto text-xs text-muted-foreground">
          Write directly in the embed — signed-in editors can save changes inline.
        </span>
      </div>
      <iframe
        src={embedSrc}
        className="w-full h-[80vh] border border-border rounded-lg"
        title={label}
      />

      <Dialog open={aiOpen} onOpenChange={setAiOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              AI Review — {label}
            </DialogTitle>
            <DialogDescription>
              Suggested improvements and quality findings based on the current document content.
            </DialogDescription>
          </DialogHeader>
          {aiLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
              <Loader2 className="h-4 w-4 animate-spin" /> Analyzing…
            </div>
          ) : (
            <pre className="whitespace-pre-wrap text-sm leading-relaxed max-h-[60vh] overflow-auto bg-muted/40 rounded-md p-4">
              {aiResult}
            </pre>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}