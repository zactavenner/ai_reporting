import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { ArrowLeft, Sparkles, User, ShieldCheck, Palette, ImagePlus, X, Upload, UserCheck } from 'lucide-react';
import type { StaticBatchConfig, AspectRatio } from '@/types';
import { useAvatars } from '@/hooks/useAvatars';
import { useAvatarLooks } from '@/hooks/useAvatarLooks';
import { useAdStyles } from '@/hooks/useAdStyles';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface GenerationConfigProps {
  config: StaticBatchConfig;
  updateConfig: (updates: Partial<StaticBatchConfig>) => void;
  toggleAspectRatio: (ratio: AspectRatio) => void;
  getTotalAdsCount: (styles?: { id: string; reference_images?: string[]; example_image_url?: string }[]) => number;
  onGenerate: () => void;
  onBack: () => void;
  isGenerating: boolean;
  clientId?: string;
  onAvatarConfig?: (config: { enabled: boolean; avatarId?: string; lookUrl?: string; avatarDescription?: string }) => void;
}

const aspectRatios: { value: AspectRatio; label: string; description: string }[] = [
  { value: '1:1', label: '1:1', description: 'Instagram Feed' },
  { value: '4:5', label: '4:5', description: 'Facebook/Instagram' },
  { value: '9:16', label: '9:16', description: 'IG Stories/Reels (safe zone)' },
  { value: '16:9', label: '16:9', description: 'YouTube/Display' },
];

function AdImageUploader({ config, updateConfig }: { config: StaticBatchConfig; updateConfig: (u: Partial<StaticBatchConfig>) => void }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const adImages = config.adImageUrls || [];

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files?.length) return;
    setUploading(true);
    const newUrls: string[] = [];
    for (const file of Array.from(files)) {
      const path = `ad-images/${Date.now()}-${file.name}`;
      const { error } = await supabase.storage.from('assets').upload(path, file, { contentType: file.type });
      if (error) { toast.error(`Failed to upload ${file.name}`); continue; }
      const { data: { publicUrl } } = supabase.storage.from('assets').getPublicUrl(path);
      newUrls.push(publicUrl);
    }
    updateConfig({ adImageUrls: [...adImages, ...newUrls] });
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeImage = (url: string) => {
    updateConfig({ adImageUrls: adImages.filter(u => u !== url) });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <ImagePlus className="h-4 w-4" />
          Ad Image Assets
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">Upload images to include in the generated ads (product shots, lifestyle images, etc.)</p>
        <div className="flex flex-wrap gap-2">
          {adImages.map((url, i) => (
            <div key={i} className="relative group w-16 h-16">
              <img src={url} alt="" className="w-full h-full rounded-lg object-cover border" />
              <button onClick={() => removeImage(url)} className="absolute -top-1 -right-1 h-5 w-5 bg-destructive text-destructive-foreground rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="w-16 h-16 rounded-lg border-2 border-dashed border-muted-foreground/30 flex items-center justify-center hover:border-primary/50 transition-colors"
          >
            {uploading ? <span className="text-[10px]">...</span> : <Upload className="h-4 w-4 text-muted-foreground" />}
          </button>
        </div>
        <input ref={fileInputRef} type="file" accept="image/*" multiple onChange={handleUpload} className="hidden" />
      </CardContent>
    </Card>
  );
}

export function GenerationConfig({
  config,
  updateConfig,
  toggleAspectRatio,
  getTotalAdsCount,
  onGenerate,
  onBack,
  isGenerating,
  clientId,
  onAvatarConfig,
}: GenerationConfigProps) {
  const { data: stylesForCount = [] } = useAdStyles(clientId);
  const totalAds = getTotalAdsCount(stylesForCount);
  const [includeAvatar, setIncludeAvatar] = useState(false);
  const [selectedAvatarId, setSelectedAvatarId] = useState<string>('');
  const [selectedLookUrl, setSelectedLookUrl] = useState<string>('');

  const { data: avatars = [] } = useAvatars(clientId);
  const { data: looks = [] } = useAvatarLooks(selectedAvatarId || null);
  const { data: allStyles = [] } = useAdStyles(clientId);

  const selectedAvatar = avatars.find(a => a.id === selectedAvatarId);
  const styleVariations = config.styleVariations || {};

  const setStyleVariation = (styleId: string, count: number) => {
    updateConfig({ styleVariations: { ...styleVariations, [styleId]: count } });
  };

  const handleAvatarToggle = (enabled: boolean) => {
    setIncludeAvatar(enabled);
    onAvatarConfig?.({ enabled, avatarId: selectedAvatarId, lookUrl: selectedLookUrl, avatarDescription: selectedAvatar?.description || undefined });
  };

  const handleAvatarSelect = (avatarId: string) => {
    setSelectedAvatarId(avatarId);
    const avatar = avatars.find(a => a.id === avatarId);
    setSelectedLookUrl(avatar?.image_url || '');
    onAvatarConfig?.({ enabled: includeAvatar, avatarId, lookUrl: avatar?.image_url || '', avatarDescription: avatar?.description || undefined });
  };

  const handleLookSelect = (lookUrl: string) => {
    setSelectedLookUrl(lookUrl);
    onAvatarConfig?.({ enabled: includeAvatar, avatarId: selectedAvatarId, lookUrl, avatarDescription: selectedAvatar?.description || undefined });
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Generation Config</h2>
        <p className="text-sm text-muted-foreground">
          Configure aspect ratios and variations for your ad batch.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Image Model */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Sparkles className="h-4 w-4" /> Image Model
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3">
              {[
                { value: 'openai/gpt-image-2', label: 'GPT Image 2', desc: 'Best text legibility & branded layouts' },
                { value: 'google/gemini-3.1-flash-image-preview', label: 'Nano Banana Pro 2', desc: 'Fastest photoreal & cheaper at scale' },
              ].map((m) => {
                const active = (config.imageModel || 'openai/gpt-image-2') === m.value;
                return (
                  <button
                    key={m.value}
                    type="button"
                    onClick={() => updateConfig({ imageModel: m.value as any })}
                    className={`text-left p-3 border rounded-lg transition-colors ${active ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'}`}
                  >
                    <p className="font-medium text-sm">{m.label}</p>
                    <p className="text-xs text-muted-foreground">{m.desc}</p>
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Aspect Ratios */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Aspect Ratios</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3">
              {aspectRatios.map((ratio) => (
                <label
                  key={ratio.value}
                  className="flex items-center gap-3 p-3 border rounded-lg cursor-pointer hover:bg-muted/50 transition-colors"
                >
                  <Checkbox
                    checked={config.aspectRatios.includes(ratio.value)}
                    onCheckedChange={() => toggleAspectRatio(ratio.value)}
                  />
                  <div>
                    <p className="font-medium text-sm">{ratio.label}</p>
                    <p className="text-xs text-muted-foreground">{ratio.description}</p>
                  </div>
                </label>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Variations Per Style */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Variations Per Style</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Default for all */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <Label className="text-sm text-muted-foreground">Default for all styles</Label>
                <span className="text-sm font-medium">{config.variationsPerStyle}</span>
              </div>
              <Slider
                value={[config.variationsPerStyle]}
                onValueChange={([value]) => updateConfig({ variationsPerStyle: value })}
                min={1}
                max={10}
                step={1}
                className="w-full"
              />
              <div className="flex justify-between text-xs text-muted-foreground mt-1">
                <span>1</span>
                <span>10</span>
              </div>
            </div>

            {/* Per-style overrides */}
            {config.selectedStyles.length > 0 && (
              <div className="border-t pt-4 space-y-3">
                <Label className="text-xs text-muted-foreground uppercase tracking-wide">Per-style overrides</Label>
                {config.selectedStyles.map((styleId) => {
                  const style = allStyles.find(s => s.id === styleId);
                  if (!style) return null;
                  const count = styleVariations[styleId] ?? config.variationsPerStyle;
                  return (
                    <div key={styleId} className="flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{style.name}</p>
                      </div>
                      <div className="flex items-center gap-2 w-40">
                        <Slider
                          value={[count]}
                          onValueChange={([v]) => setStyleVariation(styleId, v)}
                          min={1}
                          max={10}
                          step={1}
                          className="flex-1"
                        />
                        <span className="text-sm font-mono w-6 text-right">{count}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Calculation */}
            <div className="p-4 bg-muted rounded-lg">
              <p className="text-sm text-muted-foreground mb-2">Total Calculation</p>
              <div className="space-y-1">
                {config.selectedStyles.map((styleId) => {
                  const style = allStyles.find(s => s.id === styleId);
                  const count = styleVariations[styleId] ?? config.variationsPerStyle;
                  return (
                    <p key={styleId} className="text-xs text-muted-foreground">
                      {style?.name || 'Style'}: {config.aspectRatios.length} ratios × {count} = {config.aspectRatios.length * count}
                    </p>
                  );
                })}
              </div>
              <p className="text-2xl font-bold text-primary mt-2">
                = {totalAds} ads
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Generation Options */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Disclaimer */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <ShieldCheck className="h-4 w-4" />
              Compliance Disclaimer
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <Label className="text-sm">Include disclaimer on all ads</Label>
              <Switch
                checked={config.includeDisclaimer || false}
                onCheckedChange={(checked) => updateConfig({ includeDisclaimer: checked })}
              />
            </div>
            {config.includeDisclaimer && (
              <Textarea
                value={config.disclaimerText || ''}
                onChange={(e) => updateConfig({ disclaimerText: e.target.value })}
                placeholder="e.g. Past performance does not guarantee future results. Capital at risk."
                className="min-h-[80px] text-xs"
              />
            )}
          </CardContent>
        </Card>

        {/* Brand Adherence */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Palette className="h-4 w-4" />
              Brand Adherence
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-sm">Strict Brand Color & Font Adherence</Label>
                <p className="text-[11px] text-muted-foreground mt-0.5">AI will not deviate from brand colors/fonts</p>
              </div>
              <Switch
                checked={config.strictBrandAdherence || false}
                onCheckedChange={(checked) => updateConfig({ strictBrandAdherence: checked })}
              />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Ad Image Uploads */}
      <AdImageUploader config={config} updateConfig={updateConfig} />

      {/* Include Avatar */}
      {avatars.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <User className="h-4 w-4" />
                Avatar in Ads
              </CardTitle>
              <Switch checked={includeAvatar} onCheckedChange={handleAvatarToggle} />
            </div>
          </CardHeader>
          {includeAvatar && (
            <CardContent className="space-y-4">
              {/* Avatar Grid */}
              <div>
                <Label className="text-xs mb-2 block">Select Avatar</Label>
                <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-2">
                  {avatars.map((a) => (
                    <button
                      key={a.id}
                      onClick={() => handleAvatarSelect(a.id)}
                      className={`relative rounded-lg overflow-hidden border-2 transition-all aspect-[3/4] ${selectedAvatarId === a.id ? 'border-primary ring-2 ring-primary/20' : 'border-border hover:border-primary/50'}`}
                    >
                      <img src={a.image_url} className="w-full h-full object-cover" alt={a.name} />
                      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-1">
                        <p className="text-[9px] text-white font-medium truncate">{a.name}</p>
                      </div>
                      {a.is_stock && (
                        <span className="absolute top-1 right-1 text-[8px] bg-muted/80 text-muted-foreground px-1 rounded">Stock</span>
                      )}
                    </button>
                  ))}
                </div>
              </div>

              {/* Looks for selected avatar */}
              {selectedAvatar && looks.length > 0 && (
                <div>
                  <Label className="text-xs mb-2 block">Look</Label>
                  <div className="flex gap-2 flex-wrap">
                    <button
                      onClick={() => handleLookSelect(selectedAvatar.image_url)}
                      className={`w-14 h-[72px] rounded-lg overflow-hidden border-2 transition-all ${selectedLookUrl === selectedAvatar.image_url ? 'border-primary' : 'border-border hover:border-primary/50'}`}
                    >
                      <img src={selectedAvatar.image_url} className="w-full h-full object-cover" alt="Primary" />
                    </button>
                    {looks.filter(l => l.image_url !== selectedAvatar.image_url).map((look) => (
                      <button
                        key={look.id}
                        onClick={() => handleLookSelect(look.image_url)}
                        className={`w-14 h-[72px] rounded-lg overflow-hidden border-2 transition-all ${selectedLookUrl === look.image_url ? 'border-primary' : 'border-border hover:border-primary/50'}`}
                      >
                        <img src={look.image_url} className="w-full h-full object-cover" alt="Look" />
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Avatar Usage Settings */}
              <div className="border-t pt-4 space-y-4">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <Label className="text-sm">Avatar usage percentage</Label>
                    <span className="text-sm font-medium">{config.avatarPercentage ?? 30}%</span>
                  </div>
                  <Slider
                    value={[config.avatarPercentage ?? 30]}
                    onValueChange={([v]) => updateConfig({ avatarPercentage: v })}
                    min={10}
                    max={100}
                    step={10}
                    className="w-full"
                  />
                  <div className="flex justify-between text-xs text-muted-foreground mt-1">
                    <span>10%</span>
                    <span>100%</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Only ~{config.avatarPercentage ?? 30}% of generated ads will include the avatar. The rest will be without a human.
                  </p>
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-sm flex items-center gap-1.5">
                      <UserCheck className="h-3.5 w-3.5" />
                      Only on human-reference ads
                    </Label>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      Only add avatar when the reference template already features a person
                    </p>
                  </div>
                  <Switch
                    checked={config.avatarOnlyWithHuman ?? false}
                    onCheckedChange={(checked) => updateConfig({ avatarOnlyWithHuman: checked })}
                  />
                </div>
              </div>
            </CardContent>
          )}
        </Card>
      )}

      {/* Summary */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Generation Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-center">
            <div className="p-3 bg-muted rounded-lg">
              <p className="text-2xl font-bold">{config.selectedStyles.length}</p>
              <p className="text-xs text-muted-foreground">Styles</p>
            </div>
            <div className="p-3 bg-muted rounded-lg">
              <p className="text-2xl font-bold">{config.aspectRatios.length}</p>
              <p className="text-xs text-muted-foreground">Ratios</p>
            </div>
            <div className="p-3 bg-muted rounded-lg">
              <p className="text-2xl font-bold">{config.variationsPerStyle}</p>
              <p className="text-xs text-muted-foreground">Variations</p>
            </div>
            <div className="p-3 bg-primary/10 rounded-lg">
              <p className="text-2xl font-bold text-primary">{totalAds}</p>
              <p className="text-xs text-muted-foreground">Total Ads</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Navigation */}
      <div className="flex justify-between pt-4">
        <Button variant="outline" onClick={onBack}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back
        </Button>
        <Button 
          onClick={onGenerate} 
          disabled={totalAds === 0 || config.aspectRatios.length === 0 || isGenerating}
          size="lg"
        >
          <Sparkles className="h-4 w-4 mr-2" />
          Generate {totalAds} Ads
        </Button>
      </div>
    </div>
  );
}
