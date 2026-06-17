import { useState, useCallback, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { ExternalLink, RefreshCw, Loader2, UploadCloud, Link2 } from 'lucide-react';

interface CanvaTemplateSyncProps {
  styleId: string;
  styleName: string;
  canvaUrl?: string | null;
  referenceImages: string[];
  clientId?: string;
  onChanged: () => void;
}

function normalizeCanvaViewUrl(url: string): string {
  const m = url.match(/canva\.com\/design\/([A-Za-z0-9_-]+)/);
  if (m) return `https://www.canva.com/design/${m[1]}/view`;
  return url;
}

export function CanvaTemplateSync({
  styleId,
  styleName,
  canvaUrl,
  referenceImages,
  clientId,
  onChanged,
}: CanvaTemplateSyncProps) {
  const [editing, setEditing] = useState(false);
  const [draftUrl, setDraftUrl] = useState(canvaUrl ?? '');
  const [saving, setSaving] = useState(false);
  const [syncOpen, setSyncOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const saveUrl = async () => {
    setSaving(true);
    try {
      let resolved: string | null = null;
      const trimmed = draftUrl.trim();
      if (trimmed) {
        // Resolve canva.link short URLs via edge function; fall back to raw input.
        try {
          const { data } = await supabase.functions.invoke('resolve-canva-link', {
            body: { url: trimmed },
          });
          if (data?.success && data.canvaUrl) resolved = data.canvaUrl;
        } catch {
          // ignore — fall back below
        }
        if (!resolved) resolved = normalizeCanvaViewUrl(trimmed);
      }
      const { error } = await supabase
        .from('ad_styles')
        .update({ canva_url: resolved })
        .eq('id', styleId);
      if (error) throw error;
      toast.success(resolved ? 'Canva template linked' : 'Canva template cleared');
      setEditing(false);
      onChanged();
    } catch (e) {
      toast.error('Failed to save Canva link');
    } finally {
      setSaving(false);
    }
  };

  const openCanva = () => {
    if (canvaUrl) window.open(canvaUrl, '_blank', 'noopener,noreferrer');
  };

  const handleFiles = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      setUploading(true);
      const newUrls: string[] = [];
      try {
        for (const file of Array.from(files)) {
          if (!file.type.startsWith('image/')) {
            toast.error(`${file.name} is not an image`);
            continue;
          }
          const ext = file.name.split('.').pop();
          const path = `style-references/${clientId || 'global'}/${styleId}/canva-${Date.now()}-${Math.random()
            .toString(36)
            .slice(2, 9)}.${ext}`;
          const { error: upErr } = await supabase.storage.from('assets').upload(path, file);
          if (upErr) {
            toast.error(`Failed to upload ${file.name}`);
            continue;
          }
          const { data } = supabase.storage.from('assets').getPublicUrl(path);
          newUrls.push(data.publicUrl);
        }
        if (newUrls.length > 0) {
          const merged = [...referenceImages, ...newUrls];
          const { error: updErr } = await supabase
            .from('ad_styles')
            .update({ reference_images: merged })
            .eq('id', styleId);
          if (updErr) throw updErr;
          toast.success(`Added ${newUrls.length} reference${newUrls.length > 1 ? 's' : ''} from Canva export`);
          onChanged();
        }
      } catch (e) {
        toast.error('Upload failed');
      } finally {
        setUploading(false);
      }
    },
    [styleId, clientId, referenceImages, onChanged],
  );

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    handleFiles(e.dataTransfer.files);
  };

  return (
    <>
      <div className="rounded-md border border-blue-500/20 bg-blue-500/5 p-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Link2 className="h-3.5 w-3.5 text-blue-500 flex-shrink-0" />
            <span className="text-xs font-medium text-blue-700 dark:text-blue-400">
              Canva master template
            </span>
          </div>
          {!editing && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-[11px]"
              onClick={() => {
                setDraftUrl(canvaUrl ?? '');
                setEditing(true);
              }}
            >
              {canvaUrl ? 'Change' : 'Add link'}
            </Button>
          )}
        </div>

        {editing ? (
          <div className="space-y-2">
            <Input
              autoFocus
              placeholder="https://www.canva.com/design/..."
              value={draftUrl}
              onChange={(e) => setDraftUrl(e.target.value)}
              className="h-8 text-xs"
            />
            <div className="flex gap-2">
              <Button size="sm" className="h-7 text-xs" onClick={saveUrl} disabled={saving}>
                {saving && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
                Save
              </Button>
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : canvaUrl ? (
          <div className="flex gap-2">
            <Button size="sm" variant="outline" className="h-7 text-xs flex-1" onClick={openCanva}>
              <ExternalLink className="h-3 w-3 mr-1" />
              Open in Canva
            </Button>
            <Button
              size="sm"
              className="h-7 text-xs flex-1 bg-blue-600 hover:bg-blue-700 text-white"
              onClick={() => setSyncOpen(true)}
            >
              <RefreshCw className="h-3 w-3 mr-1" />
              Sync from Canva
            </Button>
          </div>
        ) : (
          <p className="text-[11px] text-muted-foreground">
            Pin a Canva design to use as the AI's visual style anchor.
          </p>
        )}
      </div>

      <Dialog open={syncOpen} onOpenChange={setSyncOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Sync references from Canva</DialogTitle>
            <DialogDescription>
              {styleName} — export pages from your Canva template and drop them here. Each PNG becomes a
              visual reference the AI uses when generating creatives in this style.
            </DialogDescription>
          </DialogHeader>

          <ol className="text-xs text-muted-foreground space-y-1.5 list-decimal list-inside">
            <li>
              <button
                onClick={openCanva}
                className="text-blue-600 hover:underline font-medium inline-flex items-center gap-1"
              >
                Open the template in Canva
                <ExternalLink className="h-3 w-3" />
              </button>
            </li>
            <li>In Canva: <span className="font-mono">Share → Download → PNG → All pages</span></li>
            <li>Drop the PNGs into the area below</li>
          </ol>

          <div
            onDrop={onDrop}
            onDragOver={(e) => e.preventDefault()}
            onClick={() => fileRef.current?.click()}
            className="cursor-pointer rounded-lg border-2 border-dashed border-blue-500/30 bg-blue-500/5 hover:bg-blue-500/10 transition-colors p-8 text-center"
          >
            {uploading ? (
              <div className="flex flex-col items-center gap-2 text-sm text-blue-600">
                <Loader2 className="h-6 w-6 animate-spin" />
                Uploading...
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2">
                <UploadCloud className="h-8 w-8 text-blue-500" />
                <div className="text-sm font-medium">Drop Canva PNG exports here</div>
                <div className="text-[11px] text-muted-foreground">
                  or click to browse — multi-select supported
                </div>
              </div>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => handleFiles(e.target.files)}
            />
          </div>

          {referenceImages.length > 0 && (
            <p className="text-[11px] text-muted-foreground">
              Currently {referenceImages.length} reference image{referenceImages.length === 1 ? '' : 's'} on this style.
              New uploads are added to the existing set.
            </p>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setSyncOpen(false)}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}