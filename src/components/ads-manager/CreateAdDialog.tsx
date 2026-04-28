import { useState } from 'react';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { UploadCloud, Loader2, Image as ImageIcon, Video } from 'lucide-react';
import { uploadWithProgress } from '@/lib/uploadWithProgress';
import { toast } from 'sonner';
import { useMetaAccountAssets } from './shared/useMetaAccountAssets';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  clientId: string;
  adSetId: string;
  adSetName: string;
}

const CTA_OPTIONS = [
  'LEARN_MORE', 'SIGN_UP', 'GET_QUOTE', 'APPLY_NOW', 'BOOK_TRAVEL',
  'CONTACT_US', 'DOWNLOAD', 'GET_OFFER', 'SHOP_NOW', 'SUBSCRIBE',
];

export function CreateAdDialog({ open, onOpenChange, clientId, adSetId, adSetName }: Props) {
  const qc = useQueryClient();
  const { allPages } = useMetaAccountAssets(clientId);
  const [name, setName] = useState('');
  const [pageId, setPageId] = useState('');
  const [headline, setHeadline] = useState('');
  const [message, setMessage] = useState('');
  const [description, setDescription] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [cta, setCta] = useState('LEARN_MORE');
  const [file, setFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [stage, setStage] = useState<'idle' | 'uploading' | 'meta-upload' | 'creating'>('idle');

  // Auto-pick page if exactly one is cached
  if (!pageId && allPages.length === 1) setTimeout(() => setPageId(allPages[0].id), 0);

  const reset = () => {
    setName(''); setHeadline(''); setMessage(''); setDescription(''); setLinkUrl('');
    setFile(null); setUploadProgress(0); setStage('idle');
  };

  const submit = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error('Select a file');
      if (!name) throw new Error('Ad name required');
      if (!pageId) throw new Error('Facebook Page ID required');

      // 1. Upload to Supabase storage so Meta can fetch it
      setStage('uploading');
      const ext = file.name.split('.').pop() || 'bin';
      const path = `meta-uploads/${clientId}/${Date.now()}.${ext}`;
      const fileUrl = await uploadWithProgress('creatives', path, file, setUploadProgress);

      // 2. Push to Meta ad account
      setStage('meta-upload');
      const fileType = file.type.startsWith('video') ? 'video' : 'image';
      const { data: upData, error: upErr } = await supabase.functions.invoke('upload-meta-creative', {
        body: { clientId, fileUrl, fileType, fileName: file.name },
      });
      if (upErr || !upData?.success) throw new Error(upData?.error || upErr?.message || 'Meta upload failed');

      // 3. Create the ad
      setStage('creating');
      const { data: adData, error: adErr } = await supabase.functions.invoke('create-meta-ad', {
        body: {
          clientId, adSetId, pageId, name, message, headline, description, linkUrl,
          callToActionType: cta,
          imageHash: upData.imageHash || undefined,
          videoId: upData.videoId || undefined,
          status: 'PAUSED',
        },
      });
      if (adErr || !adData?.success) throw new Error(adData?.error || adErr?.message || 'Ad creation failed');
      return adData;
    },
    onSuccess: (data) => {
      toast.success(data.message || 'Ad created in PAUSED state');
      qc.invalidateQueries({ queryKey: ['admin-meta-ads'] });
      reset();
      onOpenChange(false);
    },
    onError: (e: any) => {
      toast.error(e.message || 'Failed to create ad');
      setStage('idle');
    },
  });

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create ad in "{adSetName}"</DialogTitle>
          <DialogDescription>Upload creative + launch into existing ad set (paused by default)</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Ad Name *</Label>
              <Input value={name} onChange={e => setName(e.target.value)} placeholder="Q1 Hero Video v2" />
            </div>
            <div>
              <Label>Facebook Page ID *</Label>
              {allPages.length > 0 ? (
                <Select value={pageId} onValueChange={setPageId}>
                  <SelectTrigger><SelectValue placeholder="Select page" /></SelectTrigger>
                  <SelectContent>
                    {allPages.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              ) : (
                <Input value={pageId} onChange={e => setPageId(e.target.value)} placeholder="1234567890" />
              )}
            </div>
          </div>

          <div>
            <Label>Creative File *</Label>
            <div
              className="border-2 border-dashed border-border rounded-lg p-6 text-center cursor-pointer hover:border-primary/50"
              onClick={() => document.getElementById('ad-file-input')?.click()}
            >
              {file ? (
                <div className="flex items-center justify-center gap-2 text-sm">
                  {file.type.startsWith('video') ? <Video className="h-4 w-4" /> : <ImageIcon className="h-4 w-4" />}
                  <span className="truncate">{file.name}</span>
                  <span className="text-muted-foreground text-xs">({(file.size / 1024 / 1024).toFixed(1)}MB)</span>
                </div>
              ) : (
                <>
                  <UploadCloud className="h-8 w-8 mx-auto mb-2 text-muted-foreground/50" />
                  <p className="text-sm text-muted-foreground">Click to upload image or video</p>
                </>
              )}
            </div>
            <input
              id="ad-file-input" type="file" accept="image/*,video/*"
              className="hidden" onChange={(e) => setFile(e.target.files?.[0] || null)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Headline</Label>
              <Input value={headline} onChange={e => setHeadline(e.target.value)} placeholder="Get a free quote" />
            </div>
            <div>
              <Label>Call to Action</Label>
              <Select value={cta} onValueChange={setCta}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CTA_OPTIONS.map(c => <SelectItem key={c} value={c}>{c.replace(/_/g, ' ')}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label>Primary Text</Label>
            <Textarea value={message} onChange={e => setMessage(e.target.value)} placeholder="The body copy users see in feed" rows={3} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Description</Label>
              <Input value={description} onChange={e => setDescription(e.target.value)} />
            </div>
            <div>
              <Label>Destination URL *</Label>
              <Input value={linkUrl} onChange={e => setLinkUrl(e.target.value)} placeholder="https://..." />
            </div>
          </div>

          {stage !== 'idle' && (
            <div className="rounded-lg border border-border/50 bg-muted/30 p-3 text-xs space-y-1">
              <div className="flex items-center gap-2">
                <Loader2 className="h-3 w-3 animate-spin text-primary" />
                <span>
                  {stage === 'uploading' && `Uploading file… ${uploadProgress}%`}
                  {stage === 'meta-upload' && 'Pushing creative to Meta…'}
                  {stage === 'creating' && 'Creating ad…'}
                </span>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submit.isPending}>Cancel</Button>
          <Button onClick={() => submit.mutate()} disabled={submit.isPending || !file || !name || !pageId || !linkUrl}>
            {submit.isPending ? 'Creating…' : 'Create Ad (Paused)'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
