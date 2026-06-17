import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useCreateAdStyle, useAdStyles, useDeleteAdStyle } from '@/hooks/useAdStyles';
import { Loader2, Plus, Trash2, Images } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { ReferenceImagesManager } from './ReferenceImagesManager';
import { CanvaTemplateSync } from './CanvaTemplateSync';

interface StyleManagerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientId?: string;
}

export function StyleManager({ open, onOpenChange, clientId }: StyleManagerProps) {
  const [isAddingNew, setIsAddingNew] = useState(false);
  const [deleteStyleId, setDeleteStyleId] = useState<string | null>(null);
  const [newStyle, setNewStyle] = useState({
    name: '',
    description: '',
    prompt_template: '',
  });

  const { data: styles = [], refetch } = useAdStyles(clientId);
  const createMutation = useCreateAdStyle();
  const deleteMutation = useDeleteAdStyle();

  const handleCreate = async () => {
    if (!newStyle.name || !newStyle.description || !newStyle.prompt_template) return;
    await createMutation.mutateAsync({
      ...newStyle,
      client_id: clientId,
      is_default: false,
      display_order: styles.length + 1,
    });
    setNewStyle({ name: '', description: '', prompt_template: '' });
    setIsAddingNew(false);
  };

  const handleDelete = async () => {
    if (!deleteStyleId) return;
    await deleteMutation.mutateAsync(deleteStyleId);
    setDeleteStyleId(null);
  };

  const handleReferenceImagesChange = () => {
    refetch();
  };

  const customStyles = styles.filter((s) => !s.is_default);
  const defaultStyles = styles.filter((s) => s.is_default);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-5xl max-h-[85vh]">
          <DialogHeader>
            <DialogTitle>Manage Ad Styles</DialogTitle>
          </DialogHeader>

          <ScrollArea className="max-h-[70vh] pr-4">
            <div className="space-y-6">
              {/* Add New Style */}
              {isAddingNew ? (
                <div className="space-y-4 p-4 border rounded-lg bg-muted/50">
                  <h4 className="font-medium">New Custom Style</h4>
                  <div className="space-y-3">
                    <div>
                      <Label htmlFor="name">Style Name</Label>
                      <Input id="name" placeholder="e.g., Carousel Sequence" value={newStyle.name} onChange={(e) => setNewStyle((prev) => ({ ...prev, name: e.target.value }))} />
                    </div>
                    <div>
                      <Label htmlFor="description">Short Description</Label>
                      <Input id="description" placeholder="Brief description" value={newStyle.description} onChange={(e) => setNewStyle((prev) => ({ ...prev, description: e.target.value }))} />
                    </div>
                    <div>
                      <Label htmlFor="prompt">Prompt Template</Label>
                      <Textarea id="prompt" placeholder="Detailed instructions..." rows={3} value={newStyle.prompt_template} onChange={(e) => setNewStyle((prev) => ({ ...prev, prompt_template: e.target.value }))} />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button onClick={handleCreate} disabled={createMutation.isPending}>
                      {createMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                      Create Style
                    </Button>
                    <Button variant="outline" onClick={() => setIsAddingNew(false)}>Cancel</Button>
                  </div>
                </div>
              ) : (
                <Button onClick={() => setIsAddingNew(true)} className="w-full">
                  <Plus className="h-4 w-4 mr-2" />
                  Add Custom Style
                </Button>
              )}

              {/* Custom Styles */}
              {customStyles.length > 0 && (
                <div className="space-y-3">
                  <h4 className="font-medium text-sm text-muted-foreground">Custom Styles</h4>
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {customStyles.map((style) => (
                      <StyleCard
                        key={style.id}
                        style={style}
                        clientId={clientId}
                        onDelete={() => setDeleteStyleId(style.id)}
                        onImagesChange={handleReferenceImagesChange}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Default Styles */}
              <div className="space-y-3">
                <h4 className="font-medium text-sm text-muted-foreground">Default Styles ({defaultStyles.length})</h4>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {defaultStyles.map((style) => (
                    <StyleCard
                      key={style.id}
                      style={style}
                      clientId={clientId}
                      onImagesChange={handleReferenceImagesChange}
                    />
                  ))}
                </div>
              </div>
            </div>
          </ScrollArea>

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteStyleId} onOpenChange={() => setDeleteStyleId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Custom Style?</AlertDialogTitle>
            <AlertDialogDescription>This will permanently delete this custom style.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground">
              {deleteMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

interface StyleCardProps {
  style: {
    id: string;
    name: string;
    description: string;
    is_default: boolean;
    reference_images?: string[] | null;
    canva_url?: string | null;
  };
  clientId?: string;
  onDelete?: () => void;
  onImagesChange: () => void;
}

function StyleCard({ style, clientId, onDelete, onImagesChange }: StyleCardProps) {
  const refImages = style.reference_images || [];

  return (
    <div className="border rounded-lg p-4 space-y-3 bg-card">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-medium text-sm truncate">{style.name}</p>
            {style.is_default && <Badge variant="secondary" className="text-[10px]">Default</Badge>}
            {refImages.length > 0 && (
              <Badge variant="outline" className="text-[10px] gap-1">
                <Images className="h-3 w-3" />
                {refImages.length}
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{style.description}</p>
        </div>
        {onDelete && (
          <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive flex-shrink-0" onClick={onDelete}>
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </div>

      <ReferenceImagesManager
        styleId={style.id}
        styleName={style.name}
        referenceImages={refImages}
        onImagesChange={() => onImagesChange()}
        clientId={clientId}
      />

      <CanvaTemplateSync
        styleId={style.id}
        styleName={style.name}
        canvaUrl={style.canva_url ?? null}
        referenceImages={refImages}
        clientId={clientId}
        onChanged={onImagesChange}
      />
    </div>
  );
}
