import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { ArrowLeft, ArrowRight, Download, RefreshCw, Loader2, CheckCircle, XCircle, Clock, Video, Sparkles, Pencil, History, ChevronLeft, ChevronRight } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import type { GeneratedAd, AdStyle, AspectRatio } from '@/types';
import { dashboardAuthHeaders } from '@/lib/dashboardAuthHeaders';

interface ResultsGalleryProps {
  generatedAds: GeneratedAd[];
  styles: AdStyle[];
  isGenerating: boolean;
  onBack: () => void;
  onReset: () => void;
  projectId?: string;
  clientId?: string;
  setGeneratedAds?: React.Dispatch<React.SetStateAction<GeneratedAd[]>>;
}

export function ResultsGallery({
  generatedAds,
  styles,
  isGenerating,
  onBack,
  onReset,
  projectId,
  clientId,
  setGeneratedAds,
}: ResultsGalleryProps) {
  const [filterStyle, setFilterStyle] = useState<string>('all');
  const [filterRatio, setFilterRatio] = useState<string>('all');
  const [selectedAd, setSelectedAd] = useState<GeneratedAd | null>(null);
  const [animateDialogAd, setAnimateDialogAd] = useState<GeneratedAd | null>(null);
  const [videoPrompt, setVideoPrompt] = useState('');
  const [isAnimating, setIsAnimating] = useState(false);
  const [animatedVideoUrl, setAnimatedVideoUrl] = useState<string | null>(null);

  // AI Edit state
  const [editDialogAd, setEditDialogAd] = useState<GeneratedAd | null>(null);
  const [editPrompt, setEditPrompt] = useState('');
  const [isEditing, setIsEditing] = useState(false);

  // History state
  const [historyDialogAd, setHistoryDialogAd] = useState<GeneratedAd | null>(null);
  const [historyIndex, setHistoryIndex] = useState(0);

  const completedCount = generatedAds.filter((ad) => ad.status === 'completed').length;
  const failedCount = generatedAds.filter((ad) => ad.status === 'failed').length;
  const pendingCount = generatedAds.filter((ad) => ad.status === 'pending' || ad.status === 'generating').length;
  const progress = generatedAds.length > 0 ? (completedCount / generatedAds.length) * 100 : 0;

  const filteredAds = generatedAds.filter((ad) => {
    if (filterStyle !== 'all' && ad.styleId !== filterStyle) return false;
    if (filterRatio !== 'all' && ad.aspectRatio !== filterRatio) return false;
    return true;
  });

  const uniqueRatios = [...new Set(generatedAds.map((ad) => ad.aspectRatio))];
  const uniqueStyleIds = [...new Set(generatedAds.map((ad) => ad.styleId))];
  const usedStyles = styles.filter((s) => uniqueStyleIds.includes(s.id));

  const getStatusIcon = (status: GeneratedAd['status']) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="h-4 w-4 text-primary" />;
      case 'failed':
        return <XCircle className="h-4 w-4 text-destructive" />;
      case 'generating':
        return <Loader2 className="h-4 w-4 animate-spin text-primary" />;
      default:
        return <Clock className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const handleDownload = (ad: GeneratedAd) => {
    if (ad.imageUrl) {
      window.open(ad.imageUrl, '_blank');
    }
  };

  const handleAIEdit = async () => {
    if (!editDialogAd || !editPrompt.trim() || !setGeneratedAds) return;

    setIsEditing(true);
    try {
      const { data, error } = await supabase.functions.invoke('edit-static-ad', {
        body: {
          imageUrl: editDialogAd.imageUrl,
          editPrompt: editPrompt.trim(),
          projectId,
          clientId,
          styleName: editDialogAd.styleName,
          aspectRatio: editDialogAd.aspectRatio,
        },
      });

      if (error) throw error;

      if (data?.imageUrl) {
        // Update the ad: push old URL to history, set new URL
        setGeneratedAds((prev) =>
          prev.map((a) =>
            a.id === editDialogAd.id
              ? {
                  ...a,
                  imageUrl: data.imageUrl,
                  editHistory: [...(a.editHistory || []), editDialogAd.imageUrl],
                }
              : a
          )
        );
        toast.success('AI edit applied! Old version saved to history.');
        setEditPrompt('');
        // Update the dialog ad reference
        setEditDialogAd((prev) =>
          prev
            ? {
                ...prev,
                imageUrl: data.imageUrl,
                editHistory: [...(prev.editHistory || []), prev.imageUrl],
              }
            : null
        );
      }
    } catch (err) {
      console.error('AI Edit error:', err);
      toast.error('Failed to edit image');
    }
    setIsEditing(false);
  };

  const saveVideoToProject = async (videoUrl: string, sourceAd: GeneratedAd) => {
    if (!projectId || !clientId) return;
    try {
      await supabase.from('assets').insert({
        type: 'video',
        public_url: videoUrl,
        name: `Animated - ${sourceAd.styleName} (${sourceAd.aspectRatio})`,
        project_id: projectId,
        client_id: clientId,
        status: 'completed',
        metadata: {
          source: 'static-ad-animation',
          sourceImageUrl: sourceAd.imageUrl,
          aspectRatio: sourceAd.aspectRatio,
          styleName: sourceAd.styleName,
        },
      });
      toast.success('Video saved to project assets!');
    } catch (err) {
      console.error('Failed to save video to project:', err);
    }
  };

  const handleAnimateWithVeo3 = async () => {
    if (!animateDialogAd?.imageUrl || !videoPrompt.trim()) return;
    
    setIsAnimating(true);
    setAnimatedVideoUrl(null);
    
    try {
      const { data, error } = await supabase.functions.invoke('generate-video-from-image', {
        headers: dashboardAuthHeaders(),
        body: {
          imageUrl: animateDialogAd.imageUrl,
          prompt: videoPrompt.trim(),
          aspectRatio: animateDialogAd.aspectRatio === '9:16' ? '9:16' : '16:9',
          duration: 4,
        },
      });

      if (error) throw error;
      
      if (data?.status === 'completed' && data?.videoUrl) {
        setAnimatedVideoUrl(data.videoUrl);
        setIsAnimating(false);
        toast.success('Static ad animated successfully!');
        await saveVideoToProject(data.videoUrl, animateDialogAd);
        return;
      }
      
      if (data?.operationId) {
        toast.info('Video generation started — this takes 1-3 minutes...');
        const pollInterval = setInterval(async () => {
          try {
            const { data: pollData } = await supabase.functions.invoke('poll-generation-status', {
              body: { operationId: data.operationId, provider: 'veo' },
            });
            if (pollData?.status === 'completed' && pollData?.videoUrl) {
              setAnimatedVideoUrl(pollData.videoUrl);
              setIsAnimating(false);
              toast.success('Video animation complete!');
              clearInterval(pollInterval);
              await saveVideoToProject(pollData.videoUrl, animateDialogAd);
            } else if (pollData?.status === 'failed') {
              toast.error('Animation failed', { description: pollData?.error });
              setIsAnimating(false);
              clearInterval(pollInterval);
            }
          } catch {
            // Keep polling
          }
        }, 5000);
        
        setTimeout(() => {
          clearInterval(pollInterval);
          setIsAnimating(false);
          toast.error('Animation timed out — check history for results');
        }, 300000);
        return;
      }

      toast.error('Unexpected response from video generation');
    } catch (err) {
      console.error('Animation error:', err);
      toast.error('Failed to animate image');
    }
    
    setIsAnimating(false);
  };

  // History helpers
  const getHistoryImages = (ad: GeneratedAd) => {
    const history = ad.editHistory || [];
    return [...history, ad.imageUrl]; // all versions, current last
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Generated Ads</h2>
          <p className="text-sm text-muted-foreground">
            {isGenerating ? 'Generating your ads...' : `${completedCount} ads completed`}
          </p>
        </div>
        <div className="flex gap-2">
          <Badge variant="secondary" className="gap-1">
            <CheckCircle className="h-3 w-3" />
            {completedCount}
          </Badge>
          {failedCount > 0 && (
            <Badge variant="destructive" className="gap-1">
              <XCircle className="h-3 w-3" />
              {failedCount}
            </Badge>
          )}
          {pendingCount > 0 && (
            <Badge variant="outline" className="gap-1">
              <Clock className="h-3 w-3" />
              {pendingCount}
            </Badge>
          )}
        </div>
      </div>

      {/* Progress */}
      {isGenerating && (
        <Card>
          <CardContent className="pt-6">
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>Generating ads...</span>
                <span>{Math.round(progress)}%</span>
              </div>
              <Progress value={progress} className="h-2" />
              <p className="text-xs text-muted-foreground">
                {completedCount} of {generatedAds.length} completed
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <Select value={filterStyle} onValueChange={setFilterStyle}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Filter by style" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Styles</SelectItem>
            {usedStyles.map((style) => (
              <SelectItem key={style.id} value={style.id}>
                {style.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={filterRatio} onValueChange={setFilterRatio}>
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="Filter by ratio" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Ratios</SelectItem>
            {uniqueRatios.map((ratio) => (
              <SelectItem key={ratio} value={ratio}>
                {ratio}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Gallery Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
        {filteredAds.map((ad) => (
          <Card
            key={ad.id}
            className="overflow-hidden cursor-pointer hover:shadow-md transition-shadow"
            onClick={() => ad.status === 'completed' && setSelectedAd(ad)}
          >
            <div className="relative aspect-square bg-muted">
              {ad.status === 'completed' && ad.imageUrl ? (
                <img
                  src={ad.imageUrl}
                  alt={ad.styleName}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  {getStatusIcon(ad.status)}
                </div>
              )}
              <div className="absolute top-2 right-2">
                {getStatusIcon(ad.status)}
              </div>
              {ad.editHistory && ad.editHistory.length > 0 && (
                <Badge className="absolute top-2 left-2 text-[10px] gap-1" variant="secondary">
                  <History className="h-3 w-3" />
                  {ad.editHistory.length}
                </Badge>
              )}
              <Badge className="absolute bottom-2 left-2 text-[10px]" variant="secondary">
                {ad.aspectRatio}
              </Badge>
            </div>
            <CardContent className="p-2">
              <p className="text-xs font-medium truncate">{ad.styleName}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {filteredAds.length === 0 && !isGenerating && (
        <div className="text-center py-12 text-muted-foreground">
          No ads generated yet.
        </div>
      )}

      {/* Navigation */}
      <div className="flex justify-between pt-4">
        <Button variant="outline" onClick={onBack} disabled={isGenerating}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Config
        </Button>
        <Button onClick={onReset} disabled={isGenerating}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Start New Batch
        </Button>
      </div>

      {/* Lightbox with Before/After + AI Edit + Animate options */}
      <Dialog open={!!selectedAd} onOpenChange={() => setSelectedAd(null)}>
        <DialogContent className="max-w-5xl">
          {selectedAd && (
            <div className="space-y-4">
              {/* Before/After comparison header */}
              {selectedAd.referenceImageUrl && (
                <div>
                  <h3 className="text-lg font-semibold mb-3">Original vs Generated</h3>
                  <Separator />
                </div>
              )}

              {selectedAd.referenceImageUrl ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
                  {/* Original / Reference */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium">Original Ad</p>
                      <Badge variant="outline" className="text-[10px]">Source</Badge>
                    </div>
                    <div className="rounded-lg border border-border overflow-hidden bg-muted/20">
                      <img
                        src={selectedAd.referenceImageUrl}
                        alt="Original reference"
                        className="w-full object-contain max-h-[500px]"
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">From: {selectedAd.styleName}</p>
                  </div>

                  {/* Arrow between */}
                  <div className="hidden md:flex absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10">
                    <div className="bg-background border border-border rounded-full p-2">
                      <ArrowRight className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </div>

                  {/* Generated */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium">Your Generated Ad</p>
                      <Badge className="text-[10px]">AI Generated</Badge>
                    </div>
                    <div className="rounded-lg border border-border overflow-hidden bg-muted/20">
                      <img
                        src={selectedAd.imageUrl}
                        alt={selectedAd.styleName}
                        className="w-full object-contain max-h-[500px]"
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Generated: {new Date(selectedAd.createdAt).toLocaleString()}
                    </p>
                  </div>
                </div>
              ) : (
                <img
                  src={selectedAd.imageUrl}
                  alt={selectedAd.styleName}
                  className="w-full rounded-lg"
                />
              )}

              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">{selectedAd.styleName}</p>
                  <p className="text-sm text-muted-foreground">{selectedAd.aspectRatio}</p>
                </div>
                <div className="flex gap-2">
                  {selectedAd.editHistory && selectedAd.editHistory.length > 0 && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setHistoryDialogAd(selectedAd);
                        setHistoryIndex(0);
                        setSelectedAd(null);
                      }}
                    >
                      <History className="h-4 w-4 mr-2" />
                      History ({selectedAd.editHistory.length})
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    onClick={() => {
                      setEditDialogAd(selectedAd);
                      setSelectedAd(null);
                      setEditPrompt('');
                    }}
                  >
                    <Pencil className="h-4 w-4 mr-2" />
                    AI Edit
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setAnimateDialogAd(selectedAd);
                      setSelectedAd(null);
                      setVideoPrompt('Subtle motion, cinematic parallax effect, gentle camera movement');
                      setAnimatedVideoUrl(null);
                    }}
                  >
                    <Video className="h-4 w-4 mr-2" />
                    Animate with Veo3
                  </Button>
                  <Button onClick={() => handleDownload(selectedAd)}>
                    <Download className="h-4 w-4 mr-2" />
                    Download
                  </Button>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* AI Edit Dialog */}
      <Dialog open={!!editDialogAd} onOpenChange={() => setEditDialogAd(null)}>
        <DialogContent className="max-w-2xl">
          {editDialogAd && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Pencil className="h-5 w-5 text-primary" />
                <h3 className="text-lg font-semibold">AI Edit</h3>
              </div>

              <img
                src={editDialogAd.imageUrl}
                alt="Current version"
                className="w-full rounded-lg border border-border max-h-[400px] object-contain"
              />

              {editDialogAd.editHistory && editDialogAd.editHistory.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  {editDialogAd.editHistory.length} previous version{editDialogAd.editHistory.length > 1 ? 's' : ''} in history
                </p>
              )}

              <div>
                <label className="text-sm font-medium mb-1 block">Edit Instructions</label>
                <Textarea
                  value={editPrompt}
                  onChange={(e) => setEditPrompt(e.target.value)}
                  placeholder="Describe what to change (e.g., 'Make the background darker', 'Change CTA to Learn More', 'Add more contrast to the text')..."
                  className="min-h-[80px]"
                />
              </div>

              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setEditDialogAd(null)}>
                  Cancel
                </Button>
                <Button
                  onClick={handleAIEdit}
                  disabled={isEditing || !editPrompt.trim()}
                >
                  {isEditing ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Sparkles className="h-4 w-4 mr-2" />
                  )}
                  {isEditing ? 'Editing...' : 'Apply Edit'}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* History Dialog */}
      <Dialog open={!!historyDialogAd} onOpenChange={() => setHistoryDialogAd(null)}>
        <DialogContent className="max-w-3xl">
          {historyDialogAd && (() => {
            const allVersions = getHistoryImages(historyDialogAd);
            return (
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <History className="h-5 w-5 text-primary" />
                  <h3 className="text-lg font-semibold">Edit History</h3>
                  <Badge variant="secondary" className="ml-auto">
                    {historyIndex + 1} / {allVersions.length}
                  </Badge>
                </div>

                <div className="relative">
                  <img
                    src={allVersions[historyIndex]}
                    alt={`Version ${historyIndex + 1}`}
                    className="w-full rounded-lg border border-border max-h-[500px] object-contain"
                  />
                  {allVersions.length > 1 && (
                    <>
                      <Button
                        variant="secondary"
                        size="icon"
                        className="absolute left-2 top-1/2 -translate-y-1/2"
                        disabled={historyIndex === 0}
                        onClick={() => setHistoryIndex((i) => Math.max(0, i - 1))}
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="secondary"
                        size="icon"
                        className="absolute right-2 top-1/2 -translate-y-1/2"
                        disabled={historyIndex === allVersions.length - 1}
                        onClick={() => setHistoryIndex((i) => Math.min(allVersions.length - 1, i + 1))}
                      >
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </>
                  )}
                </div>

                <div className="flex items-center justify-between">
                  <p className="text-sm text-muted-foreground">
                    {historyIndex === allVersions.length - 1 ? 'Current Version' : `Version ${historyIndex + 1} (Original${historyIndex > 0 ? ` + ${historyIndex} edit${historyIndex > 1 ? 's' : ''}` : ''})`}
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => window.open(allVersions[historyIndex], '_blank')}
                  >
                    <Download className="h-4 w-4 mr-2" />
                    Download This Version
                  </Button>
                </div>

                {/* Thumbnail strip */}
                <div className="flex gap-2 overflow-x-auto pb-2">
                  {allVersions.map((url, idx) => (
                    <button
                      key={idx}
                      onClick={() => setHistoryIndex(idx)}
                      className={`flex-shrink-0 w-16 h-16 rounded border-2 overflow-hidden transition-all ${
                        idx === historyIndex ? 'border-primary ring-2 ring-primary/30' : 'border-border opacity-60 hover:opacity-100'
                      }`}
                    >
                      <img src={url} alt={`v${idx + 1}`} className="w-full h-full object-cover" />
                    </button>
                  ))}
                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* Animate Dialog */}
      <Dialog open={!!animateDialogAd} onOpenChange={() => { setAnimateDialogAd(null); setAnimatedVideoUrl(null); }}>
        <DialogContent className="max-w-2xl">
          {animateDialogAd && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-primary" />
                <h3 className="text-lg font-semibold">Animate with Veo3</h3>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-muted-foreground mb-2">Source Image</p>
                  <img
                    src={animateDialogAd.imageUrl}
                    alt="Source"
                    className="w-full rounded-lg border border-border"
                  />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-2">
                    {animatedVideoUrl ? 'Animated Result' : 'Preview'}
                  </p>
                  {animatedVideoUrl ? (
                    <video
                      src={animatedVideoUrl}
                      className="w-full rounded-lg border border-border"
                      autoPlay
                      loop
                      muted
                      playsInline
                      controls
                    />
                  ) : (
                    <div className="w-full aspect-video rounded-lg border border-border bg-muted flex items-center justify-center">
                      {isAnimating ? (
                        <div className="text-center space-y-2">
                          <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto" />
                          <p className="text-xs text-muted-foreground">Generating video...</p>
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground">Video preview will appear here</p>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <div>
                <label className="text-sm font-medium mb-1 block">Video Prompt</label>
                <Textarea
                  value={videoPrompt}
                  onChange={(e) => setVideoPrompt(e.target.value)}
                  placeholder="Describe the motion you want (e.g., subtle zoom, parallax, text animation)..."
                  className="min-h-[60px]"
                />
              </div>

              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => { setAnimateDialogAd(null); setAnimatedVideoUrl(null); }}>
                  Cancel
                </Button>
                {animatedVideoUrl && (
                  <Button variant="outline" onClick={() => window.open(animatedVideoUrl, '_blank')}>
                    <Download className="h-4 w-4 mr-2" />
                    Download Video
                  </Button>
                )}
                <Button
                  onClick={handleAnimateWithVeo3}
                  disabled={isAnimating || !videoPrompt.trim()}
                >
                  {isAnimating ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Video className="h-4 w-4 mr-2" />
                  )}
                  {isAnimating ? 'Animating...' : 'Generate Video'}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
