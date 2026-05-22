import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useCreateCustomTab, useUpdateCustomTab, type CustomTab } from '@/hooks/useCustomTabs';
import { Plus, Save } from 'lucide-react';

interface AddCustomTabModalProps {
  clientId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editTab?: CustomTab | null;
}

export function AddCustomTabModal({ clientId, open, onOpenChange, editTab }: AddCustomTabModalProps) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const createTab = useCreateCustomTab();
  const updateTab = useUpdateCustomTab();
  const isEdit = !!editTab;

  useEffect(() => {
    if (open) {
      setName(editTab?.name ?? '');
      setUrl(editTab?.url ?? '');
    }
  }, [open, editTab]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!name.trim() || !url.trim()) return;
    
    // Validate URL
    let validUrl = url;
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      validUrl = 'https://' + url;
    }

    if (isEdit && editTab) {
      await updateTab.mutateAsync({ id: editTab.id, clientId, name: name.trim(), url: validUrl });
    } else {
      await createTab.mutateAsync({ client_id: clientId, name: name.trim(), url: validUrl });
    }

    setName('');
    setUrl('');
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit Link' : 'Add Custom Tab'}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? 'Update the title or URL for this custom link.'
              : 'Create a new tab that will embed an external URL in the client dashboard and public report.'}
          </DialogDescription>
        </DialogHeader>
        
        <form onSubmit={handleSubmit} className="space-y-4 pt-4">
          <div className="space-y-2">
            <Label htmlFor="tab-name">Title</Label>
            <Input
              id="tab-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Analytics, Reports, CRM"
            />
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="tab-url">URL</Label>
            <Input
              id="tab-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com/embed"
            />
            <p className="text-xs text-muted-foreground">
              The URL will be displayed in an iframe. Make sure the site allows embedding.
            </p>
          </div>
          
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim() || !url.trim() || createTab.isPending || updateTab.isPending}>
              {isEdit ? <Save className="h-4 w-4 mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
              {isEdit ? 'Save Changes' : 'Add Tab'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
