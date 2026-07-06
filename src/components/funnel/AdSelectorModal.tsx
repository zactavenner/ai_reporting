import { useEffect, useMemo, useState } from 'react';
import { Search, Check, Loader2, Image as ImageIcon, Video as VideoIcon } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useCreatives } from '@/hooks/useCreatives';
import { cn } from '@/lib/utils';
import type { AdPlatform } from './AdRotatorMockup';

interface AdSelectorModalProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  clientId: string;
  initialSelected: string[];
  initialPlatform: AdPlatform;
  onSave: (creativeIds: string[], platform: AdPlatform) => Promise<void> | void;
}

export function AdSelectorModal({ open, onOpenChange, clientId, initialSelected, initialPlatform, onSave }: AdSelectorModalProps) {
  const { data: creatives = [], isLoading } = useCreatives(clientId);
  const [selected, setSelected] = useState<string[]>(initialSelected);
  const [platform, setPlatform] = useState<AdPlatform>(initialPlatform);
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setSelected(initialSelected);
      setPlatform(initialPlatform);
      setQuery('');
    }
  }, [open, initialSelected, initialPlatform]);

  const eligible = useMemo(
    () =>
      creatives.filter(
        c => (c.status === 'approved' || c.status === 'launched') && (c.type === 'image' || c.type === 'video') && c.file_url
      ),
    [creatives]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return eligible;
    return eligible.filter(
      c =>
        c.title?.toLowerCase().includes(q) ||
        c.headline?.toLowerCase().includes(q) ||
        c.body_copy?.toLowerCase().includes(q)
    );
  }, [eligible, query]);

  const toggle = (id: string) => {
    setSelected(prev => {
      if (prev.includes(id)) return prev.filter(x => x !== id);
      if (prev.length >= 3) return prev;
      return [...prev, id];
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(selected, platform);
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Select ads for this step</DialogTitle>
          <DialogDescription>
            Pick 1–3 approved or launched creatives. They will rotate in the ad preview.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between gap-3 pt-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search creatives..."
              className="pl-8"
            />
          </div>
          <ToggleGroup type="single" value={platform} onValueChange={v => v && setPlatform(v as AdPlatform)}>
            <ToggleGroupItem value="facebook" className="text-xs">Facebook</ToggleGroupItem>
            <ToggleGroupItem value="instagram" className="text-xs">Instagram</ToggleGroupItem>
          </ToggleGroup>
        </div>

        <div className="text-xs text-muted-foreground">
          {selected.length}/3 selected
        </div>

        <div className="flex-1 overflow-y-auto -mx-2 px-2">
          {isLoading ? (
            <div className="flex items-center justify-center py-12"><Loader2 className="h-5 w-5 animate-spin" /></div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-10 text-sm text-muted-foreground">
              No approved or launched creatives yet.
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 pb-2">
              {filtered.map(c => {
                const isSelected = selected.includes(c.id);
                const orderIdx = selected.indexOf(c.id);
                return (
                  <button
                    key={c.id}
                    onClick={() => toggle(c.id)}
                    className={cn(
                      'group relative rounded-lg overflow-hidden border-2 text-left bg-muted transition-all',
                      isSelected ? 'border-primary ring-2 ring-primary/30' : 'border-transparent hover:border-border'
                    )}
                  >
                    <div className="aspect-square bg-black relative">
                      {c.type === 'video' ? (
                        <video src={c.file_url || ''} muted className="w-full h-full object-cover" />
                      ) : (
                        <img src={c.file_url || ''} alt={c.title} className="w-full h-full object-cover" />
                      )}
                      <div className="absolute top-1.5 left-1.5">
                        <Badge variant="secondary" className="text-[10px] gap-1">
                          {c.type === 'video' ? <VideoIcon className="h-2.5 w-2.5" /> : <ImageIcon className="h-2.5 w-2.5" />}
                          {c.status}
                        </Badge>
                      </div>
                      {isSelected && (
                        <div className="absolute top-1.5 right-1.5 h-6 w-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold">
                          {orderIdx + 1}
                        </div>
                      )}
                    </div>
                    <div className="p-2">
                      <p className="text-xs font-medium truncate">{c.title}</p>
                      {c.headline && <p className="text-[10px] text-muted-foreground truncate">{c.headline}</p>}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-3 border-t">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />}
            <Check className="h-3.5 w-3.5 mr-2" /> Save selection
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}