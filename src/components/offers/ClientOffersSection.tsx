import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useClientOffers, useCreateOffer, useUpdateOffer, useDeleteOffer, uploadOfferFile, ClientOffer } from '@/hooks/useClientOffers';
import { useOfferFiles, useAddOfferFile, useDeleteOfferFile, OfferFile } from '@/hooks/useOfferFiles';
import { useTeamMember } from '@/contexts/TeamMemberContext';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Plus, FileText, Image, File, Trash2, Download, ExternalLink, Upload, Pencil, ChevronRight, Paperclip, X, Sparkles, Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { OfferAssetHub } from './OfferAssetHub';
import { BrandTemplateEditor } from './BrandTemplateEditor';

interface ClientOffersSectionProps {
  clientId: string;
  clientName: string;
  isPublicView?: boolean;
  brandColors?: string[] | null;
  brandFonts?: string[] | null;
  clientDescription?: string | null;
  offerDescription?: string | null;
  websiteUrl?: string | null;
  industry?: string | null;
  clientType?: string | null;
}

export function ClientOffersSection({ clientId, clientName, isPublicView = false, brandColors, brandFonts, clientDescription, offerDescription, websiteUrl, industry, clientType }: ClientOffersSectionProps) {
  const { data: offers = [], isLoading } = useClientOffers(clientId);
  const createOffer = useCreateOffer();
  const updateOffer = useUpdateOffer();
  const deleteOffer = useDeleteOffer();
  const { currentMember } = useTeamMember();
  const navigate = useNavigate();
  const [autoCreated, setAutoCreated] = useState(false);

  // Auto-create a primary offer if none exist for this client
  useEffect(() => {
    if (!isLoading && offers.length === 0 && !autoCreated && !isPublicView && clientId) {
      setAutoCreated(true);
      const desc = clientDescription || offerDescription || '';
      createOffer.mutate({
        client_id: clientId,
        title: 'Primary Offer',
        description: desc ? desc.substring(0, 2000) : undefined,
        offer_type: 'offer',
        uploaded_by: currentMember?.name || 'Auto',
      });
    }
  }, [isLoading, offers.length, autoCreated, isPublicView, clientId]);

  const [addOpen, setAddOpen] = useState(false);
  const [editOffer, setEditOffer] = useState<ClientOffer | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [offerType, setOfferType] = useState('file');
  const [uploading, setUploading] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const [filesViewOffer, setFilesViewOffer] = useState<ClientOffer | null>(null);

  const resetForm = () => {
    setTitle('');
    setDescription('');
    setOfferType('file');
    setSelectedFiles([]);
    setEditOffer(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const openEdit = (offer: ClientOffer) => {
    setEditOffer(offer);
    setTitle(offer.title);
    setDescription(offer.description || '');
    setOfferType(offer.offer_type);
    setSelectedFiles([]);
  };

  const handleSubmit = async () => {
    if (!title.trim()) {
      toast.error('Title is required');
      return;
    }

    setUploading(true);
    try {
      let fileUrl: string | undefined;
      let fileName: string | undefined;
      let fileType: string | undefined;
      let fileSizeBytes: number | undefined;

      if (selectedFiles.length > 0) {
        const primaryFile = selectedFiles[0];
        const result = await uploadOfferFile(clientId, primaryFile);
        fileUrl = result.url;
        fileName = primaryFile.name;
        fileType = primaryFile.name.split('.').pop()?.toLowerCase() || 'unknown';
        fileSizeBytes = primaryFile.size;
      }

      if (editOffer) {
        const updates: any = {
          title: title.trim(),
          description: description.trim() || null,
          offer_type: offerType,
        };
        if (selectedFiles.length > 0 && fileUrl) {
          updates.file_url = fileUrl;
          updates.file_name = fileName;
          updates.file_type = fileType;
          updates.file_size_bytes = fileSizeBytes;
        }
        await updateOffer.mutateAsync({ id: editOffer.id, clientId, updates });

        if (selectedFiles.length > 1) {
          for (let i = 1; i < selectedFiles.length; i++) {
            const f = selectedFiles[i];
            const res = await uploadOfferFile(clientId, f);
            const ft = f.name.split('.').pop()?.toLowerCase() || 'unknown';
            await supabase
              .from('client_offer_files' as any)
              .insert({
                offer_id: editOffer.id,
                client_id: clientId,
                file_url: res.url,
                file_name: f.name,
                file_type: ft,
                file_size_bytes: f.size,
                uploaded_by: currentMember?.name || 'Unknown',
              } as any);
          }
        }
      } else {
        const newOffer = await createOffer.mutateAsync({
          client_id: clientId,
          title: title.trim(),
          description: description.trim() || undefined,
          file_url: fileUrl,
          file_name: fileName,
          file_type: fileType,
          file_size_bytes: fileSizeBytes,
          offer_type: offerType,
          uploaded_by: currentMember?.name || 'Unknown',
        });

        const newOfferId = (newOffer as any)?.id;
        if (newOfferId && selectedFiles.length > 1) {
          for (let i = 1; i < selectedFiles.length; i++) {
            const f = selectedFiles[i];
            const res = await uploadOfferFile(clientId, f);
            const ft = f.name.split('.').pop()?.toLowerCase() || 'unknown';
            await supabase
              .from('client_offer_files' as any)
              .insert({
                offer_id: newOfferId,
                client_id: clientId,
                file_url: res.url,
                file_name: f.name,
                file_type: ft,
                file_size_bytes: f.size,
                uploaded_by: currentMember?.name || 'Unknown',
              } as any);
          }
        }
      }

      resetForm();
      setAddOpen(false);
    } catch (err) {
      console.error('Upload error:', err);
    } finally {
      setUploading(false);
    }
  };

  const handleFilesSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files) {
      setSelectedFiles(prev => [...prev, ...Array.from(files)]);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeSelectedFile = (idx: number) => {
    setSelectedFiles(prev => prev.filter((_, i) => i !== idx));
  };

  // Drag and drop handlers
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      setSelectedFiles(prev => [...prev, ...Array.from(files)]);
    }
  }, []);

  const getFileIcon = (fileType: string | null) => {
    if (!fileType) return <File className="h-5 w-5" />;
    if (['pdf'].includes(fileType)) return <FileText className="h-5 w-5 text-destructive" />;
    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(fileType)) return <Image className="h-5 w-5 text-primary" />;
    return <File className="h-5 w-5 text-muted-foreground" />;
  };

  const formatFileSize = (bytes: number | null) => {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1048576).toFixed(1)} MB`;
  };

  const getTypeBadge = (type: string) => {
    switch (type) {
      case 'offer': return <Badge variant="default">Offer</Badge>;
      case 'document': return <Badge variant="secondary">Document</Badge>;
      default: return <Badge variant="outline">File</Badge>;
    }
  };

  const isImageFile = (fileType: string | null) => {
    return fileType && ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(fileType);
  };

  const isDialogOpen = addOpen || !!editOffer;

  return (
    <div className="space-y-4">
      {!isPublicView && (
        <BrandTemplateEditor
          clientId={clientId}
          initialColors={brandColors}
          initialFonts={brandFonts}
        />
      )}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold">Offers & Files</h2>
          <p className="text-sm text-muted-foreground">
            Upload PDFs, images, and offer documents for {clientName}
          </p>
        </div>
        {!isPublicView && (
          <Button size="sm" onClick={() => { resetForm(); setAddOpen(true); }}>
            <Plus className="h-4 w-4 mr-1" />
            Add Offer / File
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground">Loading...</div>
      ) : offers.length === 0 ? (
        <Card className="p-8 text-center">
          <FileText className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
          <p className="text-muted-foreground">Setting up your first offer...</p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {offers.map((offer) => (
            <OfferCard
              key={offer.id}
              offer={offer}
              clientId={clientId}
              clientName={clientName}
              isPublicView={isPublicView}
              brandColors={brandColors}
              brandFonts={brandFonts}
              clientDescription={clientDescription}
              offerDescription={offerDescription}
              websiteUrl={websiteUrl}
              industry={industry}
              clientType={clientType}
              getFileIcon={getFileIcon}
              formatFileSize={formatFileSize}
              getTypeBadge={getTypeBadge}
              isImage={isImageFile}
              onEdit={openEdit}
              onDelete={(id: string) => deleteOffer.mutate({ id, clientId })}
              onViewFiles={() => setFilesViewOffer(offer)}
              navigate={navigate}
            />
          ))}
        </div>
      )}

      {/* Add / Edit Offer Modal */}
      <Dialog open={isDialogOpen} onOpenChange={(o) => { if (!o) { resetForm(); setAddOpen(false); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editOffer ? 'Edit Offer / File' : 'Add Offer / File'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div>
              <label className="text-sm font-semibold">Type</label>
              <Select value={offerType} onValueChange={setOfferType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="offer">Offer</SelectItem>
                  <SelectItem value="document">Document</SelectItem>
                  <SelectItem value="file">File</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-semibold">Title *</label>
              <Input
                placeholder="e.g. Investment Deck Q1 2026"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>
            <div>
              <label className="text-sm font-semibold">Description</label>
              <Textarea
                placeholder="Optional description..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
              />
            </div>
            <div>
              <label className="text-sm font-semibold">
                Files {selectedFiles.length > 0 && `(${selectedFiles.length})`}
              </label>
              <div
                className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
                  dragOver ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'
                }`}
                onClick={() => fileInputRef.current?.click()}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
              >
                <Upload className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground">
                  {dragOver ? 'Drop files here' : 'Drag & drop or click to select files'}
                </p>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                multiple
                accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.svg,.doc,.docx,.xls,.xlsx,.pptx,.csv,.txt"
                onChange={handleFilesSelected}
              />
              {selectedFiles.length > 0 && (
                <div className="mt-2 space-y-1">
                  {selectedFiles.map((f, idx) => (
                    <div key={idx} className="flex items-center justify-between text-sm bg-muted/50 rounded px-2 py-1">
                      <span className="truncate flex-1">{f.name} ({formatFileSize(f.size)})</span>
                      <button type="button" onClick={() => removeSelectedFile(idx)} className="ml-2 text-muted-foreground hover:text-foreground">
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => { resetForm(); setAddOpen(false); }}>
                Cancel
              </Button>
              <Button onClick={handleSubmit} disabled={uploading || !title.trim()}>
                {uploading ? 'Saving...' : editOffer ? 'Save Changes' : 'Add'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Files viewer for existing offer */}
      {filesViewOffer && (
        <OfferFilesDialog
          offer={filesViewOffer}
          clientId={clientId}
          clientName={clientName}
          onClose={() => setFilesViewOffer(null)}
        />
      )}
    </div>
  );
}

// --- Offer Card ---
function OfferCard({
  offer, clientId, clientName, isPublicView, brandColors, brandFonts, clientDescription, offerDescription, websiteUrl, industry, clientType,
  getFileIcon, formatFileSize, getTypeBadge, isImage, onEdit, onDelete, onViewFiles, navigate,
}: any) {
  const [aiDescribing, setAiDescribing] = useState(false);
  const { data: files = [] } = useOfferFiles(offer.id);
  const queryClient = useQueryClient();

  const handleAiDescribe = async () => {
    setAiDescribing(true);
    try {
      const allFileNames = [
        ...(offer.file_name ? [offer.file_name] : []),
        ...files.map((f: OfferFile) => f.file_name),
      ];
      const allFileUrls = [
        ...(offer.file_url ? [offer.file_url] : []),
        ...files.map((f: OfferFile) => f.file_url),
      ];

      const { data, error } = await supabase.functions.invoke('analyze-offer', {
        body: {
          offer_id: offer.id,
          client_id: clientId,
          client_name: clientName,
          file_urls: allFileUrls,
          file_names: allFileNames,
          current_description: offer.description,
        },
      });

      if (error) throw error;
      if (data?.description) {
        toast.success('Offer description updated by AI');
        queryClient.invalidateQueries({ queryKey: ['client-offers', clientId] });
      }
    } catch (err: any) {
      toast.error(`AI describe failed: ${err.message || 'Unknown error'}`);
    } finally {
      setAiDescribing(false);
    }
  };

  const totalFiles = (offer.file_url ? 1 : 0) + files.length;

  return (
    <Card className="p-4 space-y-3">
      {isImage(offer.file_type) && offer.file_url && (
        <div className="rounded-md overflow-hidden border border-border bg-muted/30">
          <img src={offer.file_url} alt={offer.title} className="w-full h-40 object-cover" />
        </div>
      )}

      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2 min-w-0">
          {getFileIcon(offer.file_type)}
          <div className="min-w-0">
            <p className="font-semibold text-sm truncate">{offer.title}</p>
            {offer.file_name && (
              <p className="text-xs text-muted-foreground truncate">{offer.file_name}</p>
            )}
            {totalFiles > 1 && (
              <p className="text-xs text-muted-foreground">{totalFiles} files attached</p>
            )}
          </div>
        </div>
        {getTypeBadge(offer.offer_type)}
      </div>

      {offer.description && (
        <p className="text-xs text-muted-foreground line-clamp-3">{offer.description}</p>
      )}

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{format(new Date(offer.created_at), 'MMM d, yyyy')}</span>
        <div className="flex items-center gap-1">
          {offer.file_size_bytes && <span>{formatFileSize(offer.file_size_bytes)}</span>}
          {offer.uploaded_by && <span>• {offer.uploaded_by}</span>}
        </div>
      </div>

      {/* AI Auto-Describe */}
      {!isPublicView && (
        <Button
          variant="outline"
          size="sm"
          className="w-full gap-1.5"
          onClick={handleAiDescribe}
          disabled={aiDescribing}
        >
          {aiDescribing ? (
            <><Loader2 className="h-3 w-3 animate-spin" /> Analyzing...</>
          ) : (
            <><Sparkles className="h-3 w-3" /> AI Auto-Describe</>
          )}
        </Button>
      )}

      {!isPublicView && (
        <OfferAssetHub
          offer={offer}
          clientId={clientId}
          clientName={clientName}
          brandColors={brandColors}
          brandFonts={brandFonts}
          clientDescription={clientDescription}
          offerDescription={offerDescription}
          websiteUrl={websiteUrl}
          industry={industry}
          clientType={clientType}
        />
      )}

      <div className="flex items-center gap-2">
        <Button
          variant="default"
          size="sm"
          className="flex-1 gap-1.5"
          onClick={() => navigate(`/client/${clientId}/offer/${offer.id}`)}
        >
          View All Assets <ChevronRight className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="flex items-center gap-2">
        {!isPublicView && (
          <Button variant="outline" size="sm" className="gap-1" onClick={onViewFiles}>
            <Paperclip className="h-3 w-3" /> Files {totalFiles > 0 && `(${totalFiles})`}
          </Button>
        )}
        {offer.file_url && (
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            onClick={() => window.open(offer.file_url!, '_blank')}
          >
            {offer.file_type === 'pdf' ? (
              <><ExternalLink className="h-3 w-3 mr-1" /> View</>
            ) : (
              <><Download className="h-3 w-3 mr-1" /> Download</>
            )}
          </Button>
        )}
        {!isPublicView && (
          <>
            <Button variant="outline" size="sm" onClick={() => onEdit(offer)}>
              <Pencil className="h-3 w-3" />
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" size="sm">
                  <Trash2 className="h-3 w-3 text-destructive" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete "{offer.title}"?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will permanently remove this file. This action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={() => onDelete(offer.id)}>
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </>
        )}
      </div>
    </Card>
  );
}

// --- Offer Files Dialog with drag-drop ---
function OfferFilesDialog({ offer, clientId, clientName, onClose }: { offer: ClientOffer; clientId: string; clientName: string; onClose: () => void }) {
  const { data: files = [], isLoading } = useOfferFiles(offer.id);
  const addFile = useAddOfferFile();
  const deleteFile = useDeleteOfferFile();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { currentMember } = useTeamMember();
  const [dragOver, setDragOver] = useState(false);

  const handleUpload = async (fileList: FileList | File[]) => {
    for (const file of Array.from(fileList)) {
      await addFile.mutateAsync({
        offerId: offer.id,
        clientId,
        file,
        uploadedBy: currentMember?.name,
      });
    }
  };

  const handleInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList) return;
    await handleUpload(fileList);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      await handleUpload(e.dataTransfer.files);
    }
  }, [offer.id, clientId]);

  const formatFileSize = (bytes: number | null) => {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1048576).toFixed(1)} MB`;
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Files — {offer.title}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          {/* Primary file */}
          {offer.file_url && (
            <div className="flex items-center justify-between bg-muted/50 rounded-md px-3 py-2">
              <div className="flex items-center gap-2 min-w-0">
                <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="text-sm truncate">{offer.file_name || 'Primary file'}</span>
                {offer.file_size_bytes && <span className="text-xs text-muted-foreground">({formatFileSize(offer.file_size_bytes)})</span>}
              </div>
              <Button variant="ghost" size="sm" onClick={() => window.open(offer.file_url!, '_blank')}>
                <ExternalLink className="h-3 w-3" />
              </Button>
            </div>
          )}

          {/* Additional files */}
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading files...</p>
          ) : files.length > 0 ? (
            files.map((f) => (
              <div key={f.id} className="flex items-center justify-between bg-muted/50 rounded-md px-3 py-2">
                <div className="flex items-center gap-2 min-w-0">
                  <Paperclip className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="text-sm truncate">{f.file_name}</span>
                  {f.file_size_bytes && <span className="text-xs text-muted-foreground">({formatFileSize(f.file_size_bytes)})</span>}
                </div>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="sm" onClick={() => window.open(f.file_url, '_blank')}>
                    <ExternalLink className="h-3 w-3" />
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => deleteFile.mutate({ id: f.id, offerId: offer.id })}>
                    <Trash2 className="h-3 w-3 text-destructive" />
                  </Button>
                </div>
              </div>
            ))
          ) : !offer.file_url ? (
            <p className="text-sm text-muted-foreground text-center py-4">No files attached</p>
          ) : null}

          {/* Upload with drag-drop */}
          <div
            className={`border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors ${
              dragOver ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'
            }`}
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={(e) => { e.preventDefault(); setDragOver(false); }}
            onDrop={handleDrop}
          >
            <Upload className="h-6 w-6 mx-auto text-muted-foreground mb-1" />
            <p className="text-sm text-muted-foreground">
              {dragOver ? 'Drop files here' : 'Drag & drop or click to add files'}
            </p>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            multiple
            accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.svg,.doc,.docx,.xls,.xlsx,.pptx,.csv,.txt"
            onChange={handleInputChange}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
