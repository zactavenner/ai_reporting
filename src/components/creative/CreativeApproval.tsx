import { useState, useRef } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { useParams } from 'react-router-dom';
import { 
  useCreatives, 
  useCreateCreative, 
  useUpdateCreativeStatus, 
  useAddCreativeComment,
  useDeleteCreative,
  uploadCreativeFile,
  detectAspectRatio,
  Creative,
  CreativeComment 
} from '@/hooks/useCreatives';
import { useClient } from '@/hooks/useClients';
import { useTeamMember } from '@/contexts/TeamMemberContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { CashBagLoader } from '@/components/ui/CashBagLoader';
import { PlatformAdPreview } from './PlatformAdPreview';
import { CreativeHorizontalPreview } from './CreativeHorizontalPreview';
import { CreativeAIActions } from './CreativeAIActions';
import { supabase } from '@/integrations/supabase/client';
import { Json } from '@/integrations/supabase/types';
import { SendToClientDialog } from '@/components/client/SendToClientDialog';
import { 
  Upload, 
  Check, 
  X, 
  MessageSquare, 
  Image, 
  Video, 
  FileText,
  Trash2,
  Send,
  RefreshCw,
  Play,
  Pause,
  Eye,
  Clock,
  Sparkles,
  Link,
  SendHorizontal,
  Download,
  History,
  RotateCcw,
  Paperclip,
  FileUp,
  AlertTriangle,
  ThumbsUp,
  MessageCircle,
  Share2,
  Globe,
  Volume2,
  VolumeX,
  MoreHorizontal,
  ExternalLink,
  Edit3,
} from 'lucide-react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';

interface CreativeApprovalProps {
  clientId: string;
  clientName: string;
  isPublicView?: boolean;
}

export function CreativeApproval({ clientId, clientName, isPublicView = false }: CreativeApprovalProps) {
  const { data: allCreatives = [], isLoading } = useCreatives(clientId);
  const { clientId: routeClientId } = useParams<{ clientId: string }>();
  const { data: client } = useClient(routeClientId || clientId);
  const createCreative = useCreateCreative();
  const updateStatus = useUpdateCreativeStatus();
  const addComment = useAddCreativeComment();
  const deleteCreative = useDeleteCreative();
  const { currentMember } = useTeamMember();
  const queryClient = useQueryClient();
  
  const isAgencyUpload = !!currentMember && !isPublicView;
  
  const creatives = isPublicView 
    ? allCreatives.filter(c => c.status !== 'draft')
    : allCreatives;
  
  const [uploadOpen, setUploadOpen] = useState(false);
  const [bulkUploadOpen, setBulkUploadOpen] = useState(false);
  const [selectedCreative, setSelectedCreative] = useState<Creative | null>(null);
  const [commentText, setCommentText] = useState('');
  const [uploading, setUploading] = useState(false);
  const [activeTab, setActiveTab] = useState('all');
  const [cardComments, setCardComments] = useState<Record<string, string>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bulkFileInputRef = useRef<HTMLInputElement>(null);
  const [bulkFiles, setBulkFiles] = useState<File[]>([]);
  const [bulkPlatform, setBulkPlatform] = useState<'meta' | 'tiktok' | 'youtube' | 'google'>('meta');
  const [downloadingAll, setDownloadingAll] = useState(false);

  // Canva-link creative state
  const [canvaOpen, setCanvaOpen] = useState(false);
  const [canvaForm, setCanvaForm] = useState({
    url: '',
    title: '',
    platform: 'meta' as 'meta' | 'tiktok' | 'youtube' | 'google',
    aspectRatio: '1:1' as '1:1' | '4:5' | '9:16' | '16:9',
    headline: '',
    body_copy: '',
    cta_text: '',
  });
  const [resolvingCanva, setResolvingCanva] = useState(false);
  
  const [newCreative, setNewCreative] = useState({
    title: '',
    type: 'image' as 'image' | 'video' | 'copy',
    platform: 'meta' as 'meta' | 'tiktok' | 'youtube' | 'google',
    headline: '',
    body_copy: '',
    cta_text: '',
    file: null as File | null,
  });

  const statusCounts = {
    all: creatives.length,
    draft: creatives.filter(c => c.status === 'draft').length,
    pending: creatives.filter(c => c.status === 'pending').length,
    approved: creatives.filter(c => c.status === 'approved').length,
    launched: creatives.filter(c => c.status === 'launched').length,
    revisions: creatives.filter(c => c.status === 'revisions').length,
    rejected: creatives.filter(c => c.status === 'rejected').length,
  };

  const filteredCreatives = activeTab === 'all' 
    ? creatives 
    : creatives.filter(c => c.status === activeTab);

  const handleSendToClient = (creative: Creative) => {
    updateStatus.mutate({ id: creative.id, status: 'pending', clientId, creativeTitle: creative.title });
    toast.success('Creative sent to client for approval');
  };

  const handleCopyApprovalLink = () => {
    const publicToken = client?.public_token;
    if (!publicToken) {
      toast.error('No public link configured for this client. Set up a public token first.');
      return;
    }
    const url = `${window.location.origin}/public/${publicToken}/creatives`;
    navigator.clipboard.writeText(url);
    toast.success('Creative approval link copied to clipboard');
  };

  const handleBulkDownload = async () => {
    const downloadable = filteredCreatives.filter((c) => !!c.file_url);
    if (downloadable.length === 0) {
      toast.error('No downloadable creatives in this view');
      return;
    }
    setDownloadingAll(true);
    const toastId = toast.loading(`Preparing ${downloadable.length} creative${downloadable.length !== 1 ? 's' : ''}...`);
    try {
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();
      const used = new Set<string>();
      let ok = 0;
      let fail = 0;
      for (const c of downloadable) {
        try {
          const res = await fetch(c.file_url as string);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const blob = await res.blob();
          const urlPath = (c.file_url as string).split('?')[0];
          const extFromUrl = urlPath.split('.').pop() || '';
          const ext = extFromUrl.length <= 5 ? extFromUrl : (c.type === 'video' ? 'mp4' : 'png');
          const safeTitle = (c.title || 'creative').replace(/[^\w\-]+/g, '_').slice(0, 80);
          let name = `${safeTitle}.${ext}`;
          let i = 2;
          while (used.has(name)) {
            name = `${safeTitle}_${i}.${ext}`;
            i++;
          }
          used.add(name);
          zip.file(name, blob);
          ok++;
        } catch (err) {
          console.error('Download failed for', c.title, err);
          fail++;
        }
      }
      if (ok === 0) throw new Error('All downloads failed');
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement('a');
      a.href = url;
      const safeClient = (clientName || 'client').replace(/[^\w\-]+/g, '_');
      const stamp = new Date().toISOString().split('T')[0];
      a.download = `${safeClient}-creatives-${activeTab}-${stamp}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success(`Downloaded ${ok} creative${ok !== 1 ? 's' : ''}${fail ? ` (${fail} failed)` : ''}`, { id: toastId });
    } catch (e: any) {
      toast.error('Bulk download failed: ' + (e?.message || 'Unknown error'), { id: toastId });
    } finally {
      setDownloadingAll(false);
    }
  };

  const handleLaunch = (creative: Creative) => {
    updateStatus.mutate({ id: creative.id, status: 'launched', clientId, creativeTitle: creative.title });
  };

  const handleUpload = async () => {
    if (!newCreative.title) {
      toast.error('Please enter a title');
      return;
    }

    setUploading(true);
    try {
      let fileUrl = null;
      let aspectRatio = null;
      
      if (newCreative.file && (newCreative.type === 'image' || newCreative.type === 'video')) {
        aspectRatio = await detectAspectRatio(newCreative.file);
        fileUrl = await uploadCreativeFile(newCreative.file, clientId);
      }

      await createCreative.mutateAsync({
        client_id: clientId,
        client_name: clientName,
        title: newCreative.title,
        type: newCreative.type,
        platform: newCreative.platform,
        file_url: fileUrl,
        headline: newCreative.headline || null,
        body_copy: newCreative.body_copy || null,
        cta_text: newCreative.cta_text || null,
        status: isAgencyUpload ? 'draft' : 'pending',
        comments: [],
        aspect_ratio: aspectRatio,
        isAgencyUpload,
      });

      setUploadOpen(false);
      setBulkUploadOpen(false);
      setNewCreative({
        title: '',
        type: 'image',
        platform: 'meta',
        headline: '',
        body_copy: '',
        cta_text: '',
        file: null,
      });
    } catch (error) {
      console.error('Upload error:', error);
    } finally {
      setUploading(false);
    }
  };

  const handleBulkUpload = async () => {
    if (bulkFiles.length === 0) {
      toast.error('Please select files to upload');
      return;
    }

    setUploading(true);
    let successCount = 0;
    let failCount = 0;

    try {
      for (const file of bulkFiles) {
        try {
          const isVideo = file.type.startsWith('video/');
          const aspectRatio = await detectAspectRatio(file);
          const fileUrl = await uploadCreativeFile(file, clientId);
          const fileName = file.name.replace(/\.[^/.]+$/, '');
          const title = fileName.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

          await createCreative.mutateAsync({
            client_id: clientId,
            client_name: clientName,
            title: title,
            type: isVideo ? 'video' : 'image',
            platform: bulkPlatform,
            file_url: fileUrl,
            headline: null,
            body_copy: null,
            cta_text: null,
            status: isAgencyUpload ? 'draft' : 'pending',
            comments: [],
            aspect_ratio: aspectRatio,
            isAgencyUpload,
          });
          successCount++;
        } catch (err) {
          console.error('Failed to upload file:', file.name, err);
          failCount++;
        }
      }

      if (successCount > 0) {
        toast.success(`Successfully uploaded ${successCount} creative${successCount !== 1 ? 's' : ''}`);
      }
      if (failCount > 0) {
        toast.error(`Failed to upload ${failCount} file${failCount !== 1 ? 's' : ''}`);
      }

      setBulkUploadOpen(false);
      setBulkFiles([]);
    } catch (error) {
      console.error('Bulk upload error:', error);
    } finally {
      setUploading(false);
    }
  };

  const handleStatusChange = (creative: Creative, status: 'approved' | 'revisions' | 'rejected') => {
    updateStatus.mutate({ id: creative.id, status, clientId, creativeTitle: creative.title });
  };

  const handleAddCanvaLink = async () => {
    if (!canvaForm.url.trim()) {
      toast.error('Paste a Canva share link');
      return;
    }
    setResolvingCanva(true);
    try {
      const { data, error } = await supabase.functions.invoke('resolve-canva-link', {
        body: { url: canvaForm.url.trim() },
      });
      if (error || !data?.success) {
        throw new Error(data?.error || error?.message || 'Could not resolve Canva link');
      }
      const { canvaUrl, designId } = data as { canvaUrl: string; designId: string };

      const insertPayload: any = {
        client_id: clientId,
        title: canvaForm.title.trim() || 'Canva design',
        type: 'image',
        platform: canvaForm.platform,
        file_url: null,
        headline: canvaForm.headline || null,
        body_copy: canvaForm.body_copy || null,
        cta_text: canvaForm.cta_text || null,
        status: isAgencyUpload ? 'draft' : 'pending',
        comments: [],
        aspect_ratio: canvaForm.aspectRatio,
        source: 'canva',
        source_type: 'canva',
        canva_url: canvaUrl,
        canva_design_id: designId,
      };

      const { error: insErr } = await supabase.from('creatives').insert(insertPayload);
      if (insErr) throw insErr;

      queryClient.invalidateQueries({ queryKey: ['creatives', clientId] });
      toast.success('Canva design added');
      setCanvaOpen(false);
      setCanvaForm({
        url: '', title: '', platform: 'meta', aspectRatio: '1:1',
        headline: '', body_copy: '', cta_text: '',
      });
    } catch (e: any) {
      toast.error(e?.message || 'Failed to add Canva link');
    } finally {
      setResolvingCanva(false);
    }
  };

  const handleAddComment = (creative: Creative, attachmentUrl?: string, attachmentType?: string) => {
    if (!commentText.trim() && !attachmentUrl) return;
    
    const comment: CreativeComment = {
      id: Date.now().toString(),
      author: isPublicView ? 'Client' : 'Agency',
      text: commentText,
      createdAt: new Date().toISOString(),
      attachmentUrl: attachmentUrl || undefined,
      attachmentType: attachmentType || undefined,
    };
    
    addComment.mutate({ id: creative.id, comment, clientId });
    setCommentText('');
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'draft': return 'bg-slate-100 text-slate-800 dark:bg-slate-900/30 dark:text-slate-400';
      case 'pending': return 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400';
      case 'approved': return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400';
      case 'launched': return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400';
      case 'revisions': return 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400';
      case 'rejected': return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400';
      default: return 'bg-muted text-muted-foreground';
    }
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'image': return <Image className="h-4 w-4" />;
      case 'video': return <Video className="h-4 w-4" />;
      case 'copy': return <FileText className="h-4 w-4" />;
      default: return <FileText className="h-4 w-4" />;
    }
  };

  if (isLoading) {
    return (
      <Card className="border-2 border-border">
        <CardContent className="py-8">
          <CashBagLoader message="Loading creatives..." />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-2 border-border">
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" />
            Creative Approval
          </CardTitle>
          <p className="text-sm text-muted-foreground mt-1">
            Upload and manage creative assets for {clientName}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {!isPublicView && (
            <Button variant="outline" size="sm" onClick={handleCopyApprovalLink}>
              <Link className="h-4 w-4 mr-2" />
              Copy Approval Link
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={handleBulkDownload}
            disabled={downloadingAll || filteredCreatives.filter((c) => !!c.file_url).length === 0}
            title="Download all creatives in current view as a ZIP"
          >
            {downloadingAll ? (
              <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Download className="h-4 w-4 mr-2" />
            )}
            Download All ({filteredCreatives.filter((c) => !!c.file_url).length})
          </Button>
          <Dialog open={bulkUploadOpen} onOpenChange={setBulkUploadOpen}>
            <DialogTrigger asChild>
              <Button variant={isPublicView ? 'default' : 'outline'}>
                <Upload className="h-4 w-4 mr-2" />
                {isPublicView ? 'Upload Creatives' : 'Bulk Upload'}
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>Bulk Upload Creatives</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div>
                  <label className="text-sm font-medium">Platform</label>
                  <div className="flex flex-wrap gap-2 mt-1">
                    {(['meta', 'tiktok', 'youtube', 'google'] as const).map((platform) => (
                      <Button
                        key={platform}
                        type="button"
                        variant={bulkPlatform === platform ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => setBulkPlatform(platform)}
                      >
                        {platform === 'meta' && 'Meta/IG'}
                        {platform === 'tiktok' && 'TikTok'}
                        {platform === 'youtube' && 'YouTube'}
                        {platform === 'google' && 'Google PPC'}
                      </Button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="text-sm font-medium">Select Files</label>
                  <input
                    ref={bulkFileInputRef}
                    type="file"
                    accept="image/*,video/*"
                    multiple
                    onChange={(e) => setBulkFiles(Array.from(e.target.files || []))}
                    className="mt-1 w-full text-sm file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-primary file:text-primary-foreground hover:file:bg-primary/90"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Select multiple images or videos. Titles will be auto-generated from filenames.
                  </p>
                </div>

                {bulkFiles.length > 0 && (
                  <div className="bg-muted/50 p-3 rounded-lg">
                    <p className="text-sm font-medium mb-2">{bulkFiles.length} file(s) selected:</p>
                    <ul className="text-xs space-y-1 max-h-32 overflow-auto">
                      {bulkFiles.map((file, i) => (
                        <li key={i} className="flex items-center gap-2">
                          {file.type.startsWith('video/') ? (
                            <Video className="h-3 w-3" />
                          ) : (
                            <Image className="h-3 w-3" />
                          )}
                          {file.name}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <Button 
                  onClick={handleBulkUpload} 
                  className="w-full"
                  disabled={uploading || bulkFiles.length === 0}
                >
                  {uploading ? (
                    <>
                      <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                      Uploading...
                    </>
                  ) : (
                    <>
                      <Upload className="h-4 w-4 mr-2" />
                      Upload {bulkFiles.length} Creative{bulkFiles.length !== 1 ? 's' : ''}
                    </>
                  )}
                </Button>
              </div>
            </DialogContent>
          </Dialog>

          {!isPublicView && (
            <Dialog open={canvaOpen} onOpenChange={setCanvaOpen}>
              <DialogTrigger asChild>
                <Button variant="outline">
                  <ExternalLink className="h-4 w-4 mr-2" />
                  Add Canva Link
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg">
                <DialogHeader>
                  <DialogTitle>Add a Canva design</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-2">
                  <div>
                    <label className="text-sm font-medium">Canva share link *</label>
                    <Input
                      value={canvaForm.url}
                      onChange={(e) => setCanvaForm({ ...canvaForm, url: e.target.value })}
                      placeholder="https://canva.link/... or https://www.canva.com/design/..."
                    />
                    <p className="text-[11px] text-muted-foreground mt-1">
                      Make sure the design is shared with "Anyone with the link can view" so it embeds.
                    </p>
                  </div>
                  <div>
                    <label className="text-sm font-medium">Title</label>
                    <Input
                      value={canvaForm.title}
                      onChange={(e) => setCanvaForm({ ...canvaForm, title: e.target.value })}
                      placeholder="Q1 hero — Canva"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-sm font-medium">Platform</label>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {(['meta', 'tiktok', 'youtube', 'google'] as const).map((p) => (
                          <Button
                            key={p}
                            type="button"
                            size="sm"
                            variant={canvaForm.platform === p ? 'default' : 'outline'}
                            onClick={() => setCanvaForm({ ...canvaForm, platform: p })}
                          >
                            {p === 'meta' ? 'Meta/IG' : p === 'tiktok' ? 'TikTok' : p === 'youtube' ? 'YouTube' : 'Google'}
                          </Button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <label className="text-sm font-medium">Aspect ratio</label>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {(['1:1', '4:5', '9:16', '16:9'] as const).map((r) => (
                          <Button
                            key={r}
                            type="button"
                            size="sm"
                            variant={canvaForm.aspectRatio === r ? 'default' : 'outline'}
                            onClick={() => setCanvaForm({ ...canvaForm, aspectRatio: r })}
                          >
                            {r}
                          </Button>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div>
                    <label className="text-sm font-medium">Headline</label>
                    <Input
                      value={canvaForm.headline}
                      onChange={(e) => setCanvaForm({ ...canvaForm, headline: e.target.value })}
                      placeholder="Ad headline (optional)"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium">Body copy</label>
                    <Textarea
                      value={canvaForm.body_copy}
                      onChange={(e) => setCanvaForm({ ...canvaForm, body_copy: e.target.value })}
                      rows={2}
                      placeholder="Ad body (optional)"
                    />
                  </div>
                  <Button onClick={handleAddCanvaLink} className="w-full" disabled={resolvingCanva}>
                    {resolvingCanva ? (
                      <><RefreshCw className="h-4 w-4 mr-2 animate-spin" /> Resolving Canva link...</>
                    ) : (
                      <><ExternalLink className="h-4 w-4 mr-2" /> Add Canva creative</>
                    )}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          )}
          {!isPublicView && (
            <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Upload className="h-4 w-4 mr-2" />
                  Upload Creative
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>Upload New Creative</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div>
                  <label className="text-sm font-medium">Title *</label>
                  <Input
                    value={newCreative.title}
                    onChange={(e) => setNewCreative({ ...newCreative, title: e.target.value })}
                    placeholder="Creative title"
                  />
                </div>
                
                <div>
                  <label className="text-sm font-medium">Type</label>
                  <div className="flex gap-2 mt-1">
                    {(['image', 'video', 'copy'] as const).map((type) => (
                      <Button
                        key={type}
                        type="button"
                        variant={newCreative.type === type ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => setNewCreative({ ...newCreative, type })}
                      >
                        {getTypeIcon(type)}
                        <span className="ml-1 capitalize">{type}</span>
                      </Button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="text-sm font-medium">Platform</label>
                  <div className="flex flex-wrap gap-2 mt-1">
                    {(['meta', 'tiktok', 'youtube', 'google'] as const).map((platform) => (
                      <Button
                        key={platform}
                        type="button"
                        variant={newCreative.platform === platform ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => setNewCreative({ ...newCreative, platform })}
                      >
                        {platform === 'meta' && 'Meta/IG'}
                        {platform === 'tiktok' && 'TikTok'}
                        {platform === 'youtube' && 'YouTube'}
                        {platform === 'google' && 'Google PPC'}
                      </Button>
                    ))}
                  </div>
                </div>

                {(newCreative.type === 'image' || newCreative.type === 'video') && (
                  <div>
                    <label className="text-sm font-medium">File</label>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept={newCreative.type === 'image' ? 'image/*' : 'video/*'}
                      onChange={(e) => setNewCreative({ 
                        ...newCreative, 
                        file: e.target.files?.[0] || null 
                      })}
                      className="mt-1 w-full text-sm file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-primary file:text-primary-foreground hover:file:bg-primary/90"
                    />
                  </div>
                )}

                <div>
                  <label className="text-sm font-medium">Headline</label>
                  <Input
                    value={newCreative.headline}
                    onChange={(e) => setNewCreative({ ...newCreative, headline: e.target.value })}
                    placeholder="Ad headline"
                  />
                </div>

                <div>
                  <label className="text-sm font-medium">Body Copy</label>
                  <Textarea
                    value={newCreative.body_copy}
                    onChange={(e) => setNewCreative({ ...newCreative, body_copy: e.target.value })}
                    placeholder="Ad body text"
                    rows={3}
                  />
                </div>

                <div>
                  <label className="text-sm font-medium">CTA Text</label>
                  <Input
                    value={newCreative.cta_text}
                    onChange={(e) => setNewCreative({ ...newCreative, cta_text: e.target.value })}
                    placeholder="Learn More"
                  />
                </div>

                <Button 
                  onClick={handleUpload} 
                  className="w-full"
                  disabled={uploading}
                >
                  {uploading ? (
                    <>
                      <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                      Uploading...
                    </>
                  ) : (
                    <>
                      <Upload className="h-4 w-4 mr-2" />
                      Upload Creative
                    </>
                  )}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
          )}
        </div>
      </CardHeader>
      
      <CardContent>
        {/* Status Summary Cards */}
        <div className={`grid ${isPublicView ? 'grid-cols-4' : 'grid-cols-5'} gap-3 mb-6`}>
          {!isPublicView && (
            <div className="bg-slate-50 dark:bg-slate-900/20 rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-slate-600">{statusCounts.draft}</p>
              <p className="text-xs text-slate-700 dark:text-slate-400">Draft</p>
            </div>
          )}
          <div className="bg-amber-50 dark:bg-amber-900/20 rounded-lg p-3 text-center">
            <p className="text-2xl font-bold text-amber-600">{statusCounts.pending}</p>
            <p className="text-xs text-amber-700 dark:text-amber-400">Pending</p>
          </div>
          <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-3 text-center">
            <p className="text-2xl font-bold text-green-600">{statusCounts.approved}</p>
            <p className="text-xs text-green-700 dark:text-green-400">Approved</p>
          </div>
          <div className="bg-orange-50 dark:bg-orange-900/20 rounded-lg p-3 text-center">
            <p className="text-2xl font-bold text-orange-600">{statusCounts.revisions}</p>
            <p className="text-xs text-orange-700 dark:text-orange-400">Revisions</p>
          </div>
          <div className="bg-red-50 dark:bg-red-900/20 rounded-lg p-3 text-center">
            <p className="text-2xl font-bold text-red-600">{statusCounts.rejected}</p>
            <p className="text-xs text-red-700 dark:text-red-400">Rejected</p>
          </div>
        </div>

        {/* Filter Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="all">All ({statusCounts.all})</TabsTrigger>
            {!isPublicView && <TabsTrigger value="draft">Draft</TabsTrigger>}
            <TabsTrigger value="pending">Pending</TabsTrigger>
            <TabsTrigger value="approved">Approved</TabsTrigger>
            <TabsTrigger value="launched">Launched</TabsTrigger>
            <TabsTrigger value="revisions">Revisions</TabsTrigger>
            <TabsTrigger value="rejected">Rejected</TabsTrigger>
          </TabsList>

          <TabsContent value={activeTab} className="mt-4">
            {filteredCreatives.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <Upload className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>No creatives uploaded yet</p>
                <p className="text-sm">Upload your first creative to get started</p>
              </div>
            ) : (
              <div className={`grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 ${
                activeTab === 'pending' && clientName?.toLowerCase().includes('lscre')
                  ? ''
                  : 'xl:grid-cols-4'
              } gap-4`}>
                {filteredCreatives.map((creative) => (
                  <CreativeCard
                    key={creative.id}
                    creative={creative}
                    clientName={clientName}
                    clientId={clientId}
                    isPublicView={isPublicView}
                    getStatusColor={getStatusColor}
                    getTypeIcon={getTypeIcon}
                    onPreview={() => setSelectedCreative(creative)}
                    onStatusChange={handleStatusChange}
                    onLaunch={() => handleLaunch(creative)}
                    onSendToClient={() => handleSendToClient(creative)}
                    onAddComment={handleAddComment}
                    onDelete={() => deleteCreative.mutate({ id: creative.id, clientId })}
                    commentText={cardComments[creative.id] || ''}
                    onCommentTextChange={(text) => setCardComments(prev => ({ ...prev, [creative.id]: text }))}
                    addCommentMutation={addComment}
                  />
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>

        {/* Creative Detail Modal */}
        <Dialog open={!!selectedCreative} onOpenChange={() => setSelectedCreative(null)}>
          <DialogContent className="max-w-[95vw] max-h-[90vh] overflow-auto sm:max-w-[95vw]">
            {selectedCreative && (
              <CreativeDetailModal
                creative={selectedCreative}
                clientName={clientName}
                clientId={clientId}
                isPublicView={isPublicView}
                getStatusColor={getStatusColor}
                onStatusChange={handleStatusChange}
                onLaunch={() => handleLaunch(selectedCreative)}
                onSendToClient={() => handleSendToClient(selectedCreative)}
                onClose={() => setSelectedCreative(null)}
                onDelete={() => {
                  deleteCreative.mutate({ id: selectedCreative.id, clientId });
                  setSelectedCreative(null);
                }}
                addCommentMutation={addComment}
              />
            )}
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}

// Version history modal component
function VersionHistorySection({ creative, clientId }: { creative: Creative; clientId: string }) {
  const queryClient = useQueryClient();
  const [revertingTo, setRevertingTo] = useState<string | null>(null);
  const [confirmRevert, setConfirmRevert] = useState<string | null>(null);
  const [selectedVersion, setSelectedVersion] = useState<string | null>(null);
  
  const versionHistory = ((creative as any).version_history as Array<{ file_url: string; uploaded_at: string; notes?: string }>) || [];
  
  if (versionHistory.length === 0) {
    return (
      <div className="text-sm text-muted-foreground py-4 text-center">
        No previous versions
      </div>
    );
  }

  const handleRevert = async (versionUrl: string) => {
    setRevertingTo(versionUrl);
    try {
      // Save current as a version entry
      const currentEntry = {
        file_url: creative.file_url,
        uploaded_at: new Date().toISOString(),
        notes: 'Auto-saved before revert',
      };
      const updatedHistory = [...versionHistory, currentEntry];
      
      const { error } = await supabase
        .from('creatives')
        .update({ 
          file_url: versionUrl,
          version_history: updatedHistory as unknown as Json,
        })
        .eq('id', creative.id);
      
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ['creatives', clientId] });
      toast.success('Reverted to previous version');
      setConfirmRevert(null);
    } catch (err) {
      console.error(err);
      toast.error('Failed to revert');
    } finally {
      setRevertingTo(null);
    }
  };

  return (
    <div className="space-y-3">
      <h4 className="text-sm font-medium flex items-center gap-2">
        <History className="h-4 w-4" />
        Version History ({versionHistory.length})
      </h4>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
        {/* Current version */}
        <div className="border-2 border-green-500 rounded-lg overflow-hidden">
          <div className="aspect-square bg-muted relative cursor-pointer" onClick={() => setSelectedVersion(creative.file_url)}>
            {creative.file_url && (
              creative.type === 'video' ? (
                <video src={creative.file_url} className="w-full h-full object-cover" />
              ) : (
                <img src={creative.file_url} alt="Current" className="w-full h-full object-cover" />
              )
            )}
          </div>
          <div className="p-2 text-center">
            <span className="text-xs font-medium text-green-600">Current</span>
          </div>
        </div>
        {/* Previous versions */}
        {[...versionHistory].reverse().map((version, i) => (
          <div key={i} className="border rounded-lg overflow-hidden hover:border-primary transition-colors">
            <div className="aspect-square bg-muted relative cursor-pointer" onClick={() => setSelectedVersion(version.file_url)}>
              {version.file_url && (
                creative.type === 'video' ? (
                  <video src={version.file_url} className="w-full h-full object-cover" />
                ) : (
                  <img src={version.file_url} alt={`v${versionHistory.length - i}`} className="w-full h-full object-cover" />
                )
              )}
            </div>
            <div className="p-2 text-center space-y-1">
              <span className="text-xs text-muted-foreground block">v{versionHistory.length - i}</span>
              {confirmRevert === version.file_url ? (
                <div className="flex gap-1 justify-center">
                  <Button size="sm" className="h-6 text-[10px] gap-0.5" onClick={() => handleRevert(version.file_url)} disabled={!!revertingTo}>
                    {revertingTo === version.file_url ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                    Yes
                  </Button>
                  <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => setConfirmRevert(null)}>
                    No
                  </Button>
                </div>
              ) : (
                <Button size="sm" variant="outline" className="h-6 text-[10px] gap-0.5 w-full" onClick={() => setConfirmRevert(version.file_url)}>
                  <RotateCcw className="h-3 w-3" />
                  Revert
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Large version preview dialog */}
      <Dialog open={!!selectedVersion} onOpenChange={() => setSelectedVersion(null)}>
        <DialogContent className="max-w-4xl max-h-[85vh]">
          <DialogHeader>
            <DialogTitle>Version Preview</DialogTitle>
          </DialogHeader>
          {selectedVersion && (
            <div className="flex items-center justify-center max-h-[70vh] overflow-auto">
              {creative.type === 'video' ? (
                <video src={selectedVersion} controls className="max-w-full max-h-[65vh] rounded" />
              ) : (
                <img src={selectedVersion} alt="Version preview" className="max-w-full max-h-[65vh] object-contain rounded" />
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Comment attachment upload
function CommentAttachmentUpload({ 
  clientId, 
  onUploaded 
}: { 
  clientId: string; 
  onUploaded: (url: string, type: string) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${clientId}/comments/${Date.now()}.${fileExt}`;
      
      const { data, error } = await supabase.storage
        .from('creatives')
        .upload(fileName, file, { upsert: true });
      
      if (error) throw error;
      
      const { data: { publicUrl } } = supabase.storage
        .from('creatives')
        .getPublicUrl(data.path);
      
      const type = file.type.startsWith('video/') ? 'video' : 'image';
      onUploaded(publicUrl, type);
      toast.success('Attachment uploaded');
    } catch (err) {
      console.error(err);
      toast.error('Failed to upload attachment');
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/*,video/*"
        className="hidden"
        onChange={handleFileSelect}
      />
      <Button
        size="icon"
        variant="ghost"
        className="h-7 w-7 flex-shrink-0"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
      >
        {uploading ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Paperclip className="h-3 w-3" />}
      </Button>
    </>
  );
}

// Comment display with attachment support
function CommentBubble({ comment, isInline = false, isPublicView = false }: { comment: CreativeComment; isInline?: boolean; isPublicView?: boolean }) {
  const [showFullImage, setShowFullImage] = useState(false);
  const hasAttachment = comment.attachmentUrl;
  
  return (
    <>
      <div 
        className={`p-2 rounded-lg text-sm ${
          comment.author === 'Client' 
            ? 'bg-primary/10 ml-4' 
            : comment.author === 'AI Review'
            ? 'bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800'
            : 'bg-muted mr-4'
        }`}
      >
        <div className="flex justify-between mb-0.5">
          <span className="text-xs font-medium">{comment.author}:</span>
          {!isInline && !isPublicView && (
            <span className="text-xs text-muted-foreground">
              {new Date(comment.createdAt).toLocaleString()}
            </span>
          )}
        </div>
        {comment.text && <p className={isInline ? 'text-muted-foreground' : ''}>{comment.text}</p>}
        {hasAttachment && (
          <div className="mt-1.5">
            {comment.attachmentType === 'video' ? (
              <video 
                src={comment.attachmentUrl} 
                controls 
                className="max-w-full max-h-48 rounded cursor-pointer"
              />
            ) : (
              <img 
                src={comment.attachmentUrl} 
                alt="Attachment" 
                className="max-w-full max-h-48 rounded cursor-pointer hover:opacity-90 transition-opacity"
                onClick={() => setShowFullImage(true)}
              />
            )}
          </div>
        )}
      </div>
      {showFullImage && comment.attachmentUrl && (
        <Dialog open={showFullImage} onOpenChange={setShowFullImage}>
          <DialogContent className="max-w-4xl max-h-[85vh]">
            <img src={comment.attachmentUrl} alt="Full size" className="max-w-full max-h-[75vh] object-contain mx-auto" />
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

// Creative detail modal content
function CreativeDetailModal({
  creative, clientName, clientId, isPublicView, getStatusColor,
  onStatusChange, onLaunch, onSendToClient, onClose, onDelete, addCommentMutation
}: {
  creative: Creative;
  clientName: string;
  clientId: string;
  isPublicView: boolean;
  getStatusColor: (s: string) => string;
  onStatusChange: (c: Creative, s: 'approved' | 'revisions' | 'rejected') => void;
  onLaunch: () => void;
  onSendToClient: () => void;
  onClose: () => void;
  onDelete: () => void;
  addCommentMutation: ReturnType<typeof useAddCreativeComment>;
}) {
  const [commentText, setCommentText] = useState('');
  const [pendingAttachment, setPendingAttachment] = useState<{ url: string; type: string } | null>(null);
  const [revisionOpen, setRevisionOpen] = useState(false);
  const [revisionText, setRevisionText] = useState('');
  const [notifyOpen, setNotifyOpen] = useState(false);

  const submitRevision = () => {
    if (!revisionText.trim()) {
      toast.error('Please describe what you want changed');
      return;
    }
    const comment: CreativeComment = {
      id: Date.now().toString(),
      author: isPublicView ? 'Client' : 'Agency',
      text: `Revision request: ${revisionText.trim()}`,
      createdAt: new Date().toISOString(),
    };
    addCommentMutation.mutate({ id: creative.id, comment, clientId });
    onStatusChange(creative, 'revisions');
    setRevisionText('');
    setRevisionOpen(false);
    toast.success('Revision requested');
  };

  const handleAddComment = () => {
    if (!commentText.trim() && !pendingAttachment) return;
    const comment: CreativeComment = {
      id: Date.now().toString(),
      author: isPublicView ? 'Client' : 'Agency',
      text: commentText,
      createdAt: new Date().toISOString(),
      attachmentUrl: pendingAttachment?.url,
      attachmentType: pendingAttachment?.type,
    };
    addCommentMutation.mutate({ id: creative.id, comment, clientId });
    setCommentText('');
    setPendingAttachment(null);
  };

  return (
    <>
      <DialogHeader>
        <div className="flex items-center justify-between">
          <DialogTitle>{creative.title}</DialogTitle>
          <Badge className={getStatusColor(creative.status)}>
            {creative.status}
          </Badge>
        </div>
      </DialogHeader>
      
      <div className="space-y-4">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge className={getStatusColor(creative.status)}>
            {creative.status}
          </Badge>
          <Badge variant="outline">{creative.platform}</Badge>
          <span className="text-sm text-muted-foreground">Client: {clientName}</span>
        </div>

        <CreativeHorizontalPreview 
          creative={creative} 
          clientName={clientName}
        />

        {/* Upload New Version + Download + AI Tools */}
        <div className="flex items-center gap-2 flex-wrap border-t pt-4">
          {creative.file_url && (
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={() => {
                const link = document.createElement('a');
                link.href = creative.file_url!;
                link.download = creative.title || 'creative';
                link.target = '_blank';
                link.rel = 'noreferrer';
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                toast.success('Download started');
              }}
            >
              <Download className="h-4 w-4" />
              Download
            </Button>
          )}
          {!isPublicView && (
            <UploadNewVersionButton creative={creative} clientId={clientId} />
          )}
          {!isPublicView && (
            <>
              <Sparkles className="h-4 w-4 text-primary ml-2" />
              <span className="text-sm font-medium mr-1">AI Tools:</span>
              <CreativeAIActions creative={creative} />
            </>
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex gap-2 flex-wrap border-t pt-4">
          {creative.status === 'draft' && !isPublicView && (
            <Button
              className="bg-primary hover:bg-primary/90"
              onClick={() => { onSendToClient(); onClose(); }}
            >
              <SendHorizontal className="h-4 w-4 mr-1" />
              Send to Client
            </Button>
          )}
          {/* Public client view: Approve / Request Revision (with toggle) */}
          {isPublicView && creative.status !== 'launched' && (
            <>
              {creative.status === 'approved' ? (
                <Button variant="outline" onClick={() => setRevisionOpen(true)}>
                  <RefreshCw className="h-4 w-4 mr-1" />
                  Switch to Request Revision
                </Button>
              ) : creative.status === 'revisions' ? (
                <>
                  <Button
                    className="bg-emerald-700 hover:bg-emerald-800 text-white dark:bg-emerald-600 dark:hover:bg-emerald-700"
                    onClick={() => {
                      onStatusChange(creative, 'approved');
                      toast.success('Approved');
                    }}
                  >
                    <Check className="h-4 w-4 mr-1" />
                    Switch to Approve
                  </Button>
                  <Button variant="outline" onClick={() => setRevisionOpen(true)}>
                    <RefreshCw className="h-4 w-4 mr-1" />
                    Update Revision Notes
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    className="bg-emerald-700 hover:bg-emerald-800 text-white dark:bg-emerald-600 dark:hover:bg-emerald-700"
                    onClick={() => {
                      onStatusChange(creative, 'approved');
                      toast.success('Approved');
                    }}
                  >
                    <Check className="h-4 w-4 mr-1" />
                    Approve
                  </Button>
                  <Button variant="outline" onClick={() => setRevisionOpen(true)}>
                    <RefreshCw className="h-4 w-4 mr-1" />
                    Request Revision
                  </Button>
                </>
              )}
            </>
          )}
          {creative.status !== 'launched' && creative.status !== 'draft' && !isPublicView && (
            <>
              {creative.status === 'approved' && !isPublicView && (
                <Button
                  className="bg-primary hover:bg-primary/90 text-primary-foreground"
                  onClick={() => { onLaunch(); onClose(); }}
                >
                  <Play className="h-4 w-4 mr-1" />
                  Launch
                </Button>
              )}
              <Button
                variant="default"
                onClick={() => onStatusChange(creative, 'approved')}
              >
                <Check className="h-4 w-4 mr-1" />
                Approve
              </Button>
              <Button
                variant="outline"
                onClick={() => onStatusChange(creative, 'revisions')}
              >
                <RefreshCw className="h-4 w-4 mr-1" />
                Revisions
              </Button>
              <Button
                variant="destructive"
                onClick={() => onStatusChange(creative, 'rejected')}
              >
                <X className="h-4 w-4 mr-1" />
                Reject
              </Button>
            </>
          )}
          {!isPublicView && (
            <Button variant="ghost" onClick={onDelete}>
              <Trash2 className="h-4 w-4 mr-1 text-destructive" />
              Delete
            </Button>
          )}
          {!isPublicView && (
            <Button
              variant="outline"
              className="ml-auto"
              onClick={() => setNotifyOpen(true)}
            >
              <Send className="h-4 w-4 mr-1" />
              Notify Client (Email/SMS)
            </Button>
          )}
        </div>

        <SendToClientDialog
          open={notifyOpen}
          onOpenChange={setNotifyOpen}
          clientId={clientId}
          clientName={clientName}
          defaultSubject={`New creative for review: ${creative.title || ''}`.trim()}
          defaultMessage={`Hi${clientName ? ` ${clientName}` : ''},\n\nA new creative is ready for your review: "${creative.title || 'Untitled'}".`}
          previewUrl={creative.file_url || undefined}
          creativeId={creative.id}
        />

        {/* Version History */}
        <div className="border-t pt-4">
          <VersionHistorySection creative={creative} clientId={clientId} />
        </div>

        {/* Comments with attachment support */}
        <div className="border-t pt-4">
          <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
            <MessageSquare className="h-4 w-4" />
            Comments ({creative.comments?.length || 0})
          </h4>
          {creative.comments && creative.comments.length > 0 ? (
            <ScrollArea className="h-[250px] border rounded-lg p-3 mb-2">
              <div className="space-y-2">
                {creative.comments.map((comment) => (
                  <CommentBubble key={comment.id} comment={comment} isPublicView={isPublicView} />
                ))}
              </div>
            </ScrollArea>
          ) : (
            <p className="text-sm text-muted-foreground mb-2">No comments yet</p>
          )}
          
          {/* Pending attachment preview */}
          {pendingAttachment && (
            <div className="flex items-center gap-2 mb-2 p-2 bg-muted rounded-lg">
              {pendingAttachment.type === 'video' ? (
                <Video className="h-4 w-4" />
              ) : (
                <Image className="h-4 w-4" />
              )}
              <span className="text-xs truncate flex-1">Attachment ready</span>
              <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => setPendingAttachment(null)}>
                <X className="h-3 w-3" />
              </Button>
            </div>
          )}
          
          <div className="flex gap-2 mt-2">
            <Input
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              placeholder="Add a comment..."
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAddComment();
              }}
            />
            <CommentAttachmentUpload
              clientId={clientId}
              onUploaded={(url, type) => setPendingAttachment({ url, type })}
            />
            <Button 
              size="icon"
              onClick={handleAddComment}
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
      <Dialog open={revisionOpen} onOpenChange={setRevisionOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>What do you want changed?</DialogTitle>
          </DialogHeader>
          <Textarea
            value={revisionText}
            onChange={(e) => setRevisionText(e.target.value)}
            placeholder="Describe the changes you'd like to see..."
            rows={5}
            autoFocus
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setRevisionOpen(false)}>
              Cancel
            </Button>
            <Button onClick={submitRevision}>
              <RefreshCw className="h-4 w-4 mr-1" />
              Submit Revision Request
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

// Upload New Version button - saves current to version_history
function UploadNewVersionButton({ creative, clientId }: { creative: Creative; clientId: string }) {
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const handleNewVersion = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      // Upload new file
      const newUrl = await uploadCreativeFile(file, clientId);
      
      // Save current file_url to version_history
      const existingHistory = ((creative as any).version_history as any[]) || [];
      const updatedHistory = [
        ...existingHistory,
        {
          file_url: creative.file_url,
          uploaded_at: new Date().toISOString(),
          notes: `Previous version`,
        },
      ];

      const { error } = await supabase
        .from('creatives')
        .update({
          file_url: newUrl,
          version_history: updatedHistory as unknown as Json,
        })
        .eq('id', creative.id);
      
      if (error) throw error;
      
      // Add system comment about new version
      const comment: CreativeComment = {
        id: Date.now().toString(),
        author: 'System',
        text: `📎 Previous version: ${creative.file_url}`,
        createdAt: new Date().toISOString(),
      };
      
      const { data: current } = await supabase
        .from('creatives')
        .select('comments')
        .eq('id', creative.id)
        .single();
      
      const existingComments = (current?.comments as unknown as CreativeComment[]) || [];
      await supabase
        .from('creatives')
        .update({ comments: [...existingComments, comment] as unknown as Json })
        .eq('id', creative.id);

      queryClient.invalidateQueries({ queryKey: ['creatives', clientId] });
      toast.success('New version uploaded');
    } catch (err) {
      console.error(err);
      toast.error('Failed to upload new version');
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/*,video/*"
        className="hidden"
        onChange={handleNewVersion}
      />
      <Button
        variant="outline"
        size="sm"
        className="gap-2"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
      >
        {uploading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
        Upload New
      </Button>
    </>
  );
}

// Helper to get aspect ratio CSS class
function getCardAspectClass(aspectRatio: string | null | undefined): string {
  switch (aspectRatio) {
    case '16:9': return 'aspect-video';
    case '9:16': return 'aspect-[9/16]';
    case '1:1': return 'aspect-square';
    case '4:5': return 'aspect-[4/5]';
    default: return 'aspect-square';
  }
}

// Fake Facebook ad chrome — wraps creative media to look like a real FB sponsored post
function FacebookAdChrome({
  pageName,
  headline,
  bodyCopy,
  ctaText,
  ctaSubtext,
  children,
}: {
  pageName: string;
  headline?: string | null;
  bodyCopy?: string | null;
  ctaText?: string | null;
  ctaSubtext?: string | null;
  children: React.ReactNode;
}) {
  const initial = (pageName || 'A').trim().charAt(0).toUpperCase();
  const copy = bodyCopy || headline || 'Ad copy goes here...';
  return (
    <div className="bg-card text-foreground">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 pt-2.5 pb-2">
        <div className="w-8 h-8 rounded-full bg-primary/15 flex items-center justify-center text-[11px] font-semibold text-primary flex-shrink-0">
          {initial}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold text-foreground truncate leading-tight">{pageName}</p>
          <p className="text-[10px] text-muted-foreground flex items-center gap-1 leading-tight">
            Sponsored · <Globe className="h-2.5 w-2.5" />
          </p>
        </div>
        <MoreHorizontal className="h-4 w-4 text-muted-foreground flex-shrink-0" />
      </div>

      {/* Body copy */}
      <p className="px-3 pb-2 text-[11px] text-foreground/90 leading-snug line-clamp-3">
        {copy}
      </p>

      {/* Media (preserves dynamic aspect ratio) */}
      {children}

      {/* CTA bar */}
      <div className="flex items-center justify-between bg-muted/40 border-t border-b border-border px-3 py-2">
        <div className="min-w-0 flex-1">
          <p className="text-[9px] uppercase tracking-wide text-muted-foreground truncate">
            {ctaSubtext || `${pageName.toLowerCase().replace(/\s+/g, '')}.com`}
          </p>
          <p className="text-[11px] font-semibold text-foreground truncate">
            {headline || 'Headline goes here...'}
          </p>
        </div>
        <div className="bg-muted text-foreground text-[10px] font-semibold px-3 py-1.5 rounded ml-2 flex-shrink-0">
          {ctaText || 'Learn More'}
        </div>
      </div>

      {/* Engagement row */}
      <div className="flex items-center justify-around px-2 py-1.5 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1.5"><ThumbsUp className="h-3 w-3" /> Like</span>
        <span className="flex items-center gap-1.5"><MessageCircle className="h-3 w-3" /> Comment</span>
        <span className="flex items-center gap-1.5"><Share2 className="h-3 w-3" /> Share</span>
      </div>
    </div>
  );
}

// Inline video player
function InlineVideoPlayer({ src, aspectRatio }: { src: string; aspectRatio?: string | null }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const [hasInteracted, setHasInteracted] = useState(false);

  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (videoRef.current) {
      if (videoRef.current.paused) {
        // Unmute on first user-initiated play so audio is audible
        if (!hasInteracted) {
          videoRef.current.muted = false;
          setMuted(false);
          setHasInteracted(true);
        }
        videoRef.current.play();
        setPlaying(true);
      } else {
        videoRef.current.pause();
        setPlaying(false);
      }
    }
  };

  const toggleMute = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (videoRef.current) {
      const next = !videoRef.current.muted;
      videoRef.current.muted = next;
      setMuted(next);
      setHasInteracted(true);
    }
  };

  return (
    <div className="relative w-full h-full group cursor-pointer" onClick={toggle}>
      <video 
        ref={videoRef}
        src={src}
        className="w-full h-full object-contain"
        loop
        playsInline
        muted
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
      />
      <div className={`absolute inset-0 flex items-center justify-center transition-opacity ${playing ? 'opacity-0 group-hover:opacity-100' : 'opacity-100'}`}>
        <div className="bg-black/50 rounded-full p-4">
          {playing ? (
            <Pause className="h-8 w-8 text-white fill-white" />
          ) : (
            <Play className="h-8 w-8 text-white fill-white" />
          )}
        </div>
      </div>
      {/* Mute / unmute control */}
      <button
        type="button"
        onClick={toggleMute}
        className="absolute bottom-2 right-2 z-10 bg-black/60 hover:bg-black/80 text-white rounded-full p-1.5 transition-opacity opacity-80 hover:opacity-100"
        aria-label={muted ? 'Unmute video' : 'Mute video'}
      >
        {muted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}

// Creative card (compact for 4-col grid)
function CreativeCard({ 
  creative, clientName, clientId, isPublicView, getStatusColor, getTypeIcon,
  onPreview, onStatusChange, onLaunch, onSendToClient, onDelete, commentText, onCommentTextChange, addCommentMutation
}: {
  creative: Creative;
  clientName: string;
  clientId: string;
  isPublicView: boolean;
  getStatusColor: (s: string) => string;
  getTypeIcon: (t: string) => React.ReactNode;
  onPreview: () => void;
  onStatusChange: (c: Creative, s: 'approved' | 'revisions' | 'rejected') => void;
  onLaunch: () => void;
  onSendToClient: () => void;
  onAddComment: (c: Creative, attachmentUrl?: string, attachmentType?: string) => void;
  onDelete: () => void;
  commentText: string;
  onCommentTextChange: (t: string) => void;
  addCommentMutation: ReturnType<typeof useAddCreativeComment>;
}) {
  const handleCardComment = () => {
    if (!commentText.trim()) return;
    const comment: CreativeComment = {
      id: Date.now().toString(),
      author: isPublicView ? 'Client' : 'Agency',
      text: commentText,
      createdAt: new Date().toISOString(),
    };
    addCommentMutation.mutate({ id: creative.id, comment, clientId });
    onCommentTextChange('');
  };

  const commentCount = creative.comments?.length || 0;

  const [revisionOpen, setRevisionOpen] = useState(false);
  const [revisionText, setRevisionText] = useState('');

  const submitRevision = () => {
    if (!revisionText.trim()) {
      toast.error('Please describe what you want changed');
      return;
    }
    const comment: CreativeComment = {
      id: Date.now().toString(),
      author: isPublicView ? 'Client' : 'Agency',
      text: `Revision request: ${revisionText.trim()}`,
      createdAt: new Date().toISOString(),
    };
    addCommentMutation.mutate({ id: creative.id, comment, clientId });
    onStatusChange(creative, 'revisions');
    setRevisionText('');
    setRevisionOpen(false);
    toast.success('Revision requested');
  };

  return (
    <Card className={`border hover:shadow-md transition-shadow overflow-hidden ${creative.source_type === 'canva' ? 'ring-1 ring-blue-500/15' : ''}`}>
      {creative.source_type === 'canva' && (
        <div className="h-1.5 bg-gradient-to-r from-blue-500 via-sky-400 to-blue-500" />
      )}
      <CardContent className="p-0">
        {/* Media area */}
        <div className="relative">
          <Badge className={`absolute top-2 right-2 z-10 text-[10px] ${getStatusColor(creative.status)}`}>
            {creative.status.charAt(0).toUpperCase() + creative.status.slice(1)}
          </Badge>

          <FacebookAdChrome
            pageName={clientName || 'Sponsored Page'}
            headline={creative.headline}
            bodyCopy={creative.body_copy}
            ctaText={null}
            ctaSubtext={null}
          >
            <div className={`${getCardAspectClass(creative.aspect_ratio)} bg-muted relative overflow-hidden`}>
              {creative.source_type === 'canva' && creative.canva_url ? (
                <>
                  <iframe
                    src={`${creative.canva_url}?embed`}
                    title={creative.title}
                    className="w-full h-full border-0"
                    loading="lazy"
                    allow="fullscreen; clipboard-write"
                    allowFullScreen
                  />
                  <Badge className="absolute top-2 left-2 z-10 text-[9px] bg-purple-600 hover:bg-purple-600 text-white">
                    Canva
                  </Badge>
                </>
              ) : creative.type === 'image' && creative.file_url ? (
                <img 
                  src={creative.file_url} 
                  alt={creative.title}
                  className="w-full h-full object-contain cursor-pointer"
                  onClick={onPreview}
                />
              ) : creative.type === 'video' && creative.file_url ? (
                <InlineVideoPlayer src={creative.file_url} aspectRatio={creative.aspect_ratio} />
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center p-4 text-center cursor-pointer" onClick={onPreview}>
                  {getTypeIcon(creative.type)}
                  <p className="text-xs text-muted-foreground mt-1">
                    {creative.headline || 'Ad Copy'}
                  </p>
                </div>
              )}
            </div>
          </FacebookAdChrome>
        </div>
        
        {/* Info */}
        <div className="px-3 pt-2.5 pb-1.5">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 min-w-0">
                {creative.source_type === 'canva' && (
                  <span className="flex-shrink-0 w-4 h-4 rounded bg-blue-500/10 flex items-center justify-center">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="text-blue-500">
                      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z" fill="currentColor" opacity="0.3"/>
                      <path d="M12 6c-3.31 0-6 2.69-6 6 0 1.66.67 3.16 1.76 4.24l1.41-1.41C8.45 14.09 8 13.09 8 12c0-2.21 1.79-4 4-4 1.09 0 2.09.45 2.83 1.17l1.41-1.41C15.16 6.67 13.66 6 12 6z" fill="currentColor"/>
                    </svg>
                  </span>
                )}
                <h4 className="font-medium text-xs truncate">{creative.title}</h4>
              </div>
              <p className="text-[10px] text-muted-foreground mt-0.5">{clientName}</p>
            </div>
            <Badge variant="outline" className="text-[10px] ml-1 flex-shrink-0">
              {creative.platform}
            </Badge>
          </div>
          {!isPublicView && (
            <p className="text-[10px] text-muted-foreground mt-0.5">
              {formatDistanceToNow(new Date(creative.created_at), { addSuffix: true })}
            </p>
          )}
        </div>

        {/* Action buttons - compact */}
        <div className="px-3 pb-1.5 flex items-center gap-1 flex-wrap">
          {creative.source_type === 'canva' && creative.canva_design_id && (
            <Button
              size="sm"
              variant="outline"
              className="h-6 text-[10px] gap-0.5"
              onClick={() => window.open(`https://www.canva.com/design/${creative.canva_design_id}/edit`, '_blank')}
              title="Opens this design in Canva for editing"
            >
              <Edit3 className="h-2.5 w-2.5" />
              Edit in Canva
            </Button>
          )}
          {creative.status === 'draft' && !isPublicView && (
            <Button size="sm" className="h-6 text-[10px] gap-0.5 bg-primary hover:bg-primary/90" onClick={onSendToClient}>
              <SendHorizontal className="h-2.5 w-2.5" />
              Send
            </Button>
          )}
          {/* Approve / Request Revision for public/client view */}
          {isPublicView && creative.status !== 'launched' && (
            <>
              {creative.status === 'approved' ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 text-[10px] gap-0.5"
                  onClick={() => setRevisionOpen(true)}
                >
                  <RefreshCw className="h-2.5 w-2.5" />
                  Request Revision
                </Button>
              ) : creative.status === 'revisions' ? (
                <Button
                  size="sm"
                  className="h-6 text-[10px] gap-0.5 bg-emerald-700 hover:bg-emerald-800 text-white dark:bg-emerald-600 dark:hover:bg-emerald-700"
                  onClick={() => {
                    onStatusChange(creative, 'approved');
                    toast.success('Approved');
                  }}
                >
                  <Check className="h-2.5 w-2.5" />
                  Switch to Approve
                </Button>
              ) : (
                <>
                  <Button
                    size="sm"
                    className="h-6 text-[10px] gap-0.5 bg-emerald-700 hover:bg-emerald-800 text-white dark:bg-emerald-600 dark:hover:bg-emerald-700"
                    onClick={() => {
                      onStatusChange(creative, 'approved');
                      toast.success('Approved');
                    }}
                  >
                    <Check className="h-2.5 w-2.5" />
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 text-[10px] gap-0.5"
                    onClick={() => setRevisionOpen(true)}
                  >
                    <RefreshCw className="h-2.5 w-2.5" />
                    Request Revision
                  </Button>
                </>
              )}
            </>
          )}
          {creative.status !== 'launched' && creative.status !== 'draft' && !isPublicView && (
            <>
              {creative.status === 'approved' && (
                <Button size="sm" className="h-6 text-[10px] gap-0.5 bg-primary hover:bg-primary/90 text-primary-foreground" onClick={onLaunch}>
                  <Play className="h-2.5 w-2.5" />
                  Launch
                </Button>
              )}
              <Button size="sm" className="h-6 text-[10px] gap-0.5" onClick={() => onStatusChange(creative, 'approved')}>
                <Check className="h-2.5 w-2.5" />
                Approve
              </Button>
              <Button variant="outline" size="sm" className="h-6 text-[10px] gap-0.5" onClick={() => onStatusChange(creative, 'revisions')}>
                <RefreshCw className="h-2.5 w-2.5" />
                Revisions
              </Button>
              <Button variant="destructive" size="sm" className="h-6 text-[10px] gap-0.5" onClick={() => onStatusChange(creative, 'rejected')}>
                <X className="h-2.5 w-2.5" />
                Reject
              </Button>
            </>
          )}
          {creative.file_url && (
            <Button
              variant="outline"
              size="sm"
              className="h-6 text-[10px] gap-0.5"
              onClick={(e) => {
                e.stopPropagation();
                const link = document.createElement('a');
                link.href = creative.file_url!;
                link.download = creative.title || 'creative';
                link.target = '_blank';
                link.rel = 'noreferrer';
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
              }}
            >
              <Download className="h-2.5 w-2.5" />
              Download
            </Button>
          )}
          <Button
            variant="secondary"
            size="sm"
            className="h-6 text-[10px] gap-0.5 ml-auto"
            onClick={onPreview}
          >
            <Eye className="h-2.5 w-2.5" />
            Preview
          </Button>
          {!isPublicView && (
            <Button variant="ghost" size="sm" className="h-6 text-[10px]" onClick={onDelete}>
              <Trash2 className="h-2.5 w-2.5 text-destructive" />
            </Button>
          )}
        </div>

        {/* Inline comment section */}
        <div className="px-3 pb-2 border-t border-border mt-1 pt-1.5">
          {commentCount > 0 && (
            <div className="mb-1.5 max-h-20 overflow-y-auto space-y-0.5">
              {creative.comments.slice(-2).map((comment) => (
                <div key={comment.id} className="text-[10px] bg-muted rounded px-1.5 py-0.5">
                  <span className="font-medium">{comment.author}:</span>{' '}
                  <span className="text-muted-foreground">{comment.text}</span>
                  {comment.attachmentUrl && (
                    <span className="text-primary ml-1">📎</span>
                  )}
                </div>
              ))}
              {commentCount > 2 && (
                <button 
                  className="text-[10px] text-primary hover:underline"
                  onClick={onPreview}
                >
                  View all {commentCount} comments
                </button>
              )}
            </div>
          )}
          <div className="flex gap-1">
            <Input
              value={commentText}
              onChange={(e) => onCommentTextChange(e.target.value)}
              placeholder="Add a comment..."
              className="h-6 text-[10px]"
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCardComment();
              }}
            />
            <Button 
              size="icon"
              className="h-6 w-6 flex-shrink-0"
              onClick={handleCardComment}
            >
              <Send className="h-2.5 w-2.5" />
            </Button>
          </div>
        </div>
      </CardContent>
      <Dialog open={revisionOpen} onOpenChange={setRevisionOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>What do you want changed?</DialogTitle>
          </DialogHeader>
          <Textarea
            value={revisionText}
            onChange={(e) => setRevisionText(e.target.value)}
            placeholder="Describe the changes you'd like to see..."
            rows={5}
            autoFocus
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setRevisionOpen(false)}>
              Cancel
            </Button>
            <Button onClick={submitRevision}>
              <RefreshCw className="h-4 w-4 mr-1" />
              Submit Revision Request
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
