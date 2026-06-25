import { useState, useEffect } from 'react';
import { ScrapingScheduleSection } from '@/components/ad-scraping/ScrapingScheduleSection';
import { ApifySettings } from '@/components/instagram/ApifySettings';
import { VoiceManagementSection } from '@/components/settings/VoiceManagementSection';
import { ClientReportsTab } from '@/components/settings/ClientReportsTab';
import { AppLayout } from '@/components/layout/AppLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Key,
  Image,
  Film,
  Plus,
  Eye,
  EyeOff,
  Check,
  AlertCircle,
  X,
  RefreshCw,
  Clock,
  Radar,
  Volume2,
  Instagram,
  Palette,
  Globe,
  Plug,
  ListChecks,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { 
  useApiRateLimiter, 
  TIER_CONFIGS,
  type ApiKeyConfig, 
  type ApiKeyTier,
  type ServiceType 
} from '@/hooks/useApiRateLimiter';
import { UsageDashboard } from '@/components/settings/UsageDashboard';
import { StyleSettingsView } from '@/components/project/StyleSettingsView';
import { ApiKeysSection } from '@/components/settings/ApiKeysSection';
import { OnboardingTemplatesSection } from '@/components/settings/OnboardingTemplatesSection';

interface Reference {
  id: string;
  name: string;
  url: string;
  type: 'image' | 'video';
  tags: string[];
}

// API Key Pool Component
function ApiKeyPool({ 
  service, 
  title, 
  description 
}: { 
  service: ServiceType; 
  title: string; 
  description: string;
}) {
  const { 
    keys, 
    updateKeys, 
    getTotalUsage, 
    refreshUsage, 
  } = useApiRateLimiter(service);
  
  const [showKeys, setShowKeys] = useState<Record<number, boolean>>({});
  const [localKeys, setLocalKeys] = useState<ApiKeyConfig[]>(keys);
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    setLocalKeys(keys);
  }, [keys]);

  const usage = getTotalUsage();

  const toggleKeyVisibility = (index: number) => {
    setShowKeys(prev => ({ ...prev, [index]: !prev[index] }));
  };

  const updateLocalKey = (index: number, key: string) => {
    setLocalKeys(prev => prev.map((k, i) => 
      i === index ? { ...k, key } : k
    ));
  };

  const updateLocalTier = (index: number, tier: ApiKeyTier) => {
    const updated = localKeys.map((k, i) => i === index ? { ...k, tier } : k);
    setLocalKeys(updated);
    // Auto-save tier changes immediately
    updateKeys(updated);
    toast.success(`${localKeys[index].label} tier set to ${TIER_CONFIGS[tier].label}`);
  };

  const saveKey = (index: number) => {
    const key = localKeys[index];
    if (!key.key.trim()) {
      toast.error('Please enter an API key');
      return;
    }
    updateKeys(localKeys);
    toast.success(`${key.label} key saved`);
  };

  const clearKey = (index: number) => {
    const updated = localKeys.map((k, i) => i === index ? { ...k, key: '' } : k);
    setLocalKeys(updated);
    updateKeys(updated);
    toast.success(`${localKeys[index].label} key removed`);
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await refreshUsage();
    setTimeout(() => setIsRefreshing(false), 500);
  };

  const getUsageColor = (current: number, max: number) => {
    const percent = (current / max) * 100;
    if (percent >= 100) return 'text-destructive';
    if (percent >= 80) return 'text-yellow-500';
    return 'text-primary';
  };

  const activeKeyCount = keys.filter(k => k.key.trim()).length;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Key className="h-5 w-5" />
              {title}
            </CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleRefresh}
            disabled={isRefreshing}
          >
            <RefreshCw className={cn('h-4 w-4', isRefreshing && 'animate-spin')} />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Rate Limit Info */}
        <div className="flex items-center gap-4 p-3 rounded-lg bg-muted/50 text-sm">
          <Badge variant="outline" className="shrink-0">
            <Clock className="h-3 w-3 mr-1" />
            Tier Limits
          </Badge>
          <span className="text-muted-foreground">
            Set the tier for each key to match your Google AI plan. Limits auto-adjust per tier.
          </span>
        </div>

        {/* Combined Usage */}
        {usage.maxDaily > 0 && (
          <div className="space-y-2 p-3 rounded-lg border">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">Combined Daily Capacity</span>
              <span className={getUsageColor(usage.totalDaily, usage.maxDaily)}>
                {usage.totalDaily.toLocaleString()} / {usage.maxDaily.toLocaleString()}
              </span>
            </div>
            <Progress 
              value={Math.min((usage.totalDaily / usage.maxDaily) * 100, 100)} 
              className="h-2"
            />
          </div>
        )}

        {/* Key Inputs */}
        {localKeys.map((keyConfig, index) => {
          const keyUsage = usage.perKey[index];
          const tierLimits = TIER_CONFIGS[keyConfig.tier || 'free'];
          const dailyPercent = keyConfig.key.trim() 
            ? ((keyUsage?.usage?.dailyCount || 0) / tierLimits.perDay) * 100 
            : 0;
          const isNearLimit = dailyPercent >= 80;
          const isAtLimit = dailyPercent >= 100;

          return (
            <div 
              key={index} 
              className={cn(
                'space-y-3 p-4 rounded-lg border transition-colors',
                isAtLimit && 'border-destructive/50 bg-destructive/5',
                isNearLimit && !isAtLimit && 'border-yellow-500/50 bg-yellow-500/5',
                !keyConfig.key.trim() && 'opacity-60'
              )}
            >
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <Badge variant={keyConfig.key.trim() ? 'default' : 'secondary'}>
                    {keyConfig.label}
                  </Badge>
                  {keyConfig.key.trim() && (
                    <Badge variant="outline" className="text-xs">
                      <Check className="h-3 w-3 mr-1 text-green-500" />
                      Active
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {/* Tier Selector */}
                  <Select 
                    value={keyConfig.tier || 'free'} 
                    onValueChange={(v) => updateLocalTier(index, v as ApiKeyTier)}
                  >
                    <SelectTrigger className="w-[150px] h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.entries(TIER_CONFIGS) as [ApiKeyTier, typeof TIER_CONFIGS[ApiKeyTier]][]).map(([tier, config]) => (
                        <SelectItem key={tier} value={tier}>
                          <span className="flex items-center gap-2">
                            <span className="font-medium">{config.label}</span>
                            <span className="text-muted-foreground text-[10px]">{config.description}</span>
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {keyConfig.key.trim() && (
                    <span className={cn('text-sm whitespace-nowrap', getUsageColor(keyUsage?.usage?.dailyCount || 0, tierLimits.perDay))}>
                      {keyUsage?.usage?.dailyCount || 0} / {tierLimits.perDay.toLocaleString()} today
                    </span>
                  )}
                </div>
              </div>

              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Input
                    type={showKeys[index] ? 'text' : 'password'}
                    value={localKeys[index].key}
                    onChange={(e) => updateLocalKey(index, e.target.value)}
                    placeholder={`Enter ${keyConfig.label} API key...`}
                    className="pr-10 font-mono text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => toggleKeyVisibility(index)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showKeys[index] ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
                <Button
                  onClick={() => saveKey(index)}
                  variant="secondary"
                  disabled={localKeys[index].key === keys[index]?.key}
                >
                  Save
                </Button>
                {keyConfig.key.trim() && (
                  <Button
                    onClick={() => clearKey(index)}
                    variant="ghost"
                    size="icon"
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>

              {keyConfig.key.trim() && (
                <div className="space-y-1">
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Daily usage ({TIER_CONFIGS[keyConfig.tier || 'free'].label} tier)</span>
                    <span>{Math.round(dailyPercent)}%</span>
                  </div>
                  <Progress 
                    value={Math.min(dailyPercent, 100)} 
                    className={cn(
                      'h-1.5',
                      isAtLimit && '[&>div]:bg-destructive',
                      isNearLimit && !isAtLimit && '[&>div]:bg-yellow-500'
                    )}
                  />
                </div>
              )}
            </div>
          );
        })}

        {/* Status summary */}
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <AlertCircle className="h-4 w-4" />
          <span>
            {activeKeyCount === 0 
              ? 'Add at least one API key to start generating'
              : `${activeKeyCount} key(s) configured • Auto-rotates to next available key when one hits its tier limit`
            }
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

export default function SettingsPage() {
  // References state
  const [imageRefs, setImageRefs] = useState<Reference[]>([]);
  const [videoRefs, setVideoRefs] = useState<Reference[]>([]);
  const [newRefUrl, setNewRefUrl] = useState('');
  const [newRefName, setNewRefName] = useState('');
  const [newRefTags, setNewRefTags] = useState('');

  const addImageRef = () => {
    if (!newRefUrl.trim()) {
      toast.error('Please enter an image URL');
      return;
    }
    const newRef: Reference = {
      id: `img-${Date.now()}`,
      name: newRefName || 'Untitled',
      url: newRefUrl,
      type: 'image',
      tags: newRefTags.split(',').map(t => t.trim()).filter(Boolean),
    };
    setImageRefs(prev => [...prev, newRef]);
    setNewRefUrl('');
    setNewRefName('');
    setNewRefTags('');
    toast.success('Image reference added');
  };

  const addVideoRef = () => {
    if (!newRefUrl.trim()) {
      toast.error('Please enter a video URL');
      return;
    }
    const newRef: Reference = {
      id: `vid-${Date.now()}`,
      name: newRefName || 'Untitled',
      url: newRefUrl,
      type: 'video',
      tags: newRefTags.split(',').map(t => t.trim()).filter(Boolean),
    };
    setVideoRefs(prev => [...prev, newRef]);
    setNewRefUrl('');
    setNewRefName('');
    setNewRefTags('');
    toast.success('Video reference added');
  };

  const deleteRef = (id: string, type: 'image' | 'video') => {
    if (type === 'image') {
      setImageRefs(prev => prev.filter(r => r.id !== id));
    } else {
      setVideoRefs(prev => prev.filter(r => r.id !== id));
    }
    toast.success('Reference deleted');
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Settings</h1>
          <p className="text-muted-foreground">
            Manage API keys, integrations, and creative brand settings
          </p>
        </div>

        <div className="rounded-lg border border-primary/40 bg-primary/5 p-4 flex items-start gap-3">
          <Plug className="h-5 w-5 text-primary mt-0.5 shrink-0" />
          <div className="text-sm">
            <p className="font-medium">Looking for per-client integrations (Meta, GHL, HubSpot, etc.)?</p>
            <p className="text-muted-foreground mt-0.5">
              Those moved to each client's <strong>Connections</strong> tab — one place per client, one set of fields. This page is now for <strong>agency-wide defaults</strong> only (API key pools, brand refs, scraping).
            </p>
          </div>
        </div>

        <Tabs defaultValue="api-keys" className="space-y-6">
          <TabsList>
            <TabsTrigger value="api-keys" className="gap-2">
              <Key className="h-4 w-4" />
              API Keys
            </TabsTrigger>
            <TabsTrigger value="image-refs" className="gap-2">
              <Image className="h-4 w-4" />
              Image References
            </TabsTrigger>
            <TabsTrigger value="video-refs" className="gap-2">
              <Film className="h-4 w-4" />
              Video Style References
            </TabsTrigger>
            <TabsTrigger value="scraping" className="gap-2">
              <Radar className="h-4 w-4" />
              Scraping Schedule
            </TabsTrigger>
            <TabsTrigger value="voices" className="gap-2">
              <Volume2 className="h-4 w-4" />
              Voices
            </TabsTrigger>
            <TabsTrigger value="integrations" className="gap-2">
              <Instagram className="h-4 w-4" />
              Integrations
            </TabsTrigger>
            <TabsTrigger value="ad-styles" className="gap-2">
              <Palette className="h-4 w-4" />
              Ad Styles
            </TabsTrigger>
            <TabsTrigger value="api-access" className="gap-2">
              <Globe className="h-4 w-4" />
              API Access
            </TabsTrigger>
            <TabsTrigger value="onboarding-templates" className="gap-2">
              <ListChecks className="h-4 w-4" />
              Onboarding Templates
            </TabsTrigger>
            <TabsTrigger value="client-reports" className="gap-2">
              <Mail className="h-4 w-4" />
              Client Reports
            </TabsTrigger>
          </TabsList>

          <TabsContent value="api-keys" className="space-y-4">
            <ApiKeyPool
              service="veo3"
              title="Google Veo 3 / Gemini API Keys"
              description="Up to 5 keys with auto-rotation. Set each key's tier to match your Google AI billing plan."
            />

            <UsageDashboard />

            <Card>
              <CardHeader>
                <CardTitle className="text-base">How to get API keys & understand tiers</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-muted-foreground">
                <div className="flex items-start gap-3">
                  <Badge variant="outline">Google AI</Badge>
                  <span>
                    Visit{' '}
                    <a 
                      href="https://aistudio.google.com/apikey" 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="text-primary hover:underline"
                    >
                      Google AI Studio
                    </a>
                    {' '}→ Get API Key → Create new key (works for both Veo 3 and Gemini)
                  </span>
                </div>
                <div className="p-3 rounded-lg bg-muted/50 border border-dashed space-y-2">
                  <p className="font-medium text-foreground">Tier Rate Limits</p>
                  <div className="grid gap-2 sm:grid-cols-3">
                    {(Object.entries(TIER_CONFIGS) as [ApiKeyTier, typeof TIER_CONFIGS[ApiKeyTier]][]).map(([tier, config]) => (
                      <div key={tier} className="p-2 rounded border bg-background">
                        <p className="font-medium text-foreground">{config.label}</p>
                        <p className="text-xs">{config.perMinute} RPM • {config.perDay.toLocaleString()} RPD</p>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs mt-2">
                    Add up to 5 keys and set each one's tier. The system auto-rotates to the next available key when one hits its limit.
                  </p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Image References Tab */}
          <TabsContent value="image-refs" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Image References</CardTitle>
                <CardDescription>
                  Add reference images for style guidance in AI generation
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 p-4 rounded-lg border bg-muted/30">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Name</Label>
                      <Input
                        value={newRefName}
                        onChange={(e) => setNewRefName(e.target.value)}
                        placeholder="Reference name..."
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Tags (comma separated)</Label>
                      <Input
                        value={newRefTags}
                        onChange={(e) => setNewRefTags(e.target.value)}
                        placeholder="modern, minimal, dark..."
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Image URL</Label>
                    <div className="flex gap-2">
                      <Input
                        value={newRefUrl}
                        onChange={(e) => setNewRefUrl(e.target.value)}
                        placeholder="https://example.com/image.jpg"
                      />
                      <Button onClick={addImageRef} className="gap-2">
                        <Plus className="h-4 w-4" />
                        Add
                      </Button>
                    </div>
                  </div>
                </div>

                {imageRefs.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <Image className="h-12 w-12 mx-auto mb-3 opacity-50" />
                    <p>No image references added yet</p>
                  </div>
                ) : (
                  <ScrollArea className="h-[300px]">
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {imageRefs.map((ref) => (
                        <div key={ref.id} className="group relative rounded-lg border overflow-hidden">
                          <img
                            src={ref.url}
                            alt={ref.name}
                            className="w-full h-32 object-cover"
                            onError={(e) => {
                              (e.target as HTMLImageElement).src = '/placeholder.svg';
                            }}
                          />
                          <div className="p-2">
                            <p className="font-medium text-sm truncate">{ref.name}</p>
                            <div className="flex flex-wrap gap-1 mt-1">
                              {ref.tags.slice(0, 3).map((tag) => (
                                <Badge key={tag} variant="secondary" className="text-xs">
                                  {tag}
                                </Badge>
                              ))}
                            </div>
                          </div>
                          <button
                            onClick={() => deleteRef(ref.id, 'image')}
                            className="absolute top-2 right-2 p-1.5 rounded-full bg-background/80 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-destructive hover:text-destructive-foreground"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Video Style References Tab */}
          <TabsContent value="video-refs" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Video Style References</CardTitle>
                <CardDescription>
                  Add video references to guide B-roll generation style
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 p-4 rounded-lg border bg-muted/30">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Name</Label>
                      <Input
                        value={newRefName}
                        onChange={(e) => setNewRefName(e.target.value)}
                        placeholder="Style reference name..."
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Tags (comma separated)</Label>
                      <Input
                        value={newRefTags}
                        onChange={(e) => setNewRefTags(e.target.value)}
                        placeholder="cinematic, slow-mo, aerial..."
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Video URL</Label>
                    <div className="flex gap-2">
                      <Input
                        value={newRefUrl}
                        onChange={(e) => setNewRefUrl(e.target.value)}
                        placeholder="https://example.com/video.mp4"
                      />
                      <Button onClick={addVideoRef} className="gap-2">
                        <Plus className="h-4 w-4" />
                        Add
                      </Button>
                    </div>
                  </div>
                </div>

                {videoRefs.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <Film className="h-12 w-12 mx-auto mb-3 opacity-50" />
                    <p>No video style references added yet</p>
                  </div>
                ) : (
                  <ScrollArea className="h-[300px]">
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {videoRefs.map((ref) => (
                        <div key={ref.id} className="group relative rounded-lg border overflow-hidden">
                          <video
                            src={ref.url}
                            className="w-full h-32 object-cover"
                            muted
                            playsInline
                            onMouseEnter={(e) => e.currentTarget.play()}
                            onMouseLeave={(e) => {
                              e.currentTarget.pause();
                              e.currentTarget.currentTime = 0;
                            }}
                          />
                          <div className="p-2">
                            <p className="font-medium text-sm truncate">{ref.name}</p>
                            <div className="flex flex-wrap gap-1 mt-1">
                              {ref.tags.slice(0, 3).map((tag) => (
                                <Badge key={tag} variant="secondary" className="text-xs">
                                  {tag}
                                </Badge>
                              ))}
                            </div>
                          </div>
                          <button
                            onClick={() => deleteRef(ref.id, 'video')}
                            className="absolute top-2 right-2 p-1.5 rounded-full bg-background/80 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-destructive hover:text-destructive-foreground"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="scraping" className="space-y-4">
            <ScrapingScheduleSection />
          </TabsContent>

          <TabsContent value="voices" className="space-y-4">
            <VoiceManagementSection />
          </TabsContent>

          <TabsContent value="integrations" className="space-y-4">
            <ApifySettings />
          </TabsContent>
          <TabsContent value="ad-styles" className="space-y-4">
            <StyleSettingsView />
          </TabsContent>
          <TabsContent value="api-access" className="space-y-4">
            <ApiKeysSection />
          </TabsContent>
          <TabsContent value="onboarding-templates" className="space-y-4">
            <OnboardingTemplatesSection />
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}
