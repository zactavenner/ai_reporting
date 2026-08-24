import { useEffect, useRef } from 'react';
import { useAvatarAd } from '@/context/AvatarAdContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { ArrowLeft, ArrowRight, Video, Loader2, CheckCircle2, XCircle, RefreshCw, Play } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { buildVideoPrompt } from '@/lib/avatar-ad-prompts';
import type { DealInput, VideoSegment } from '@/types/avatar-ad';
import { dashboardAuthHeaders } from '@/lib/dashboardAuthHeaders';

export function VideoStep() {
  const { state, setStep, setVideoSegments, updateVideoSegment } = useAvatarAd();
  const pollRefs = useRef<Record<number, NodeJS.Timeout>>({});
  const deal = state.deal as DealInput;
  const segments = state.script?.segments || [];

  // Initialize video segments on mount
  useEffect(() => {
    if (state.videoSegments.length === 0 && segments.length > 0) {
      setVideoSegments(segments.map(s => ({
        segmentId: s.id,
        status: 'queued',
      })));
    }
  }, []);

  // Cleanup polls on unmount
  useEffect(() => {
    return () => {
      Object.values(pollRefs.current).forEach(clearInterval);
    };
  }, []);

  const startPolling = (segmentId: number, operationId: string, apiKey?: string) => {
    if (pollRefs.current[segmentId]) clearInterval(pollRefs.current[segmentId]);

    let attempts = 0;
    pollRefs.current[segmentId] = setInterval(async () => {
      attempts++;
      if (attempts > 60) {
        clearInterval(pollRefs.current[segmentId]);
        updateVideoSegment(segmentId, { status: 'failed', error: 'Timed out after 5 minutes' });
        return;
      }

      try {
        const { data, error } = await supabase.functions.invoke('poll-video-status', {
          body: { operationId, apiKey },
        });

        if (error) return;

        if (data.status === 'completed') {
          clearInterval(pollRefs.current[segmentId]);
          updateVideoSegment(segmentId, { status: 'done', videoUrl: data.videoUrl, progress: 100 });
          toast.success(`Segment ${segmentId} video ready!`);
        } else if (data.status === 'failed') {
          clearInterval(pollRefs.current[segmentId]);
          updateVideoSegment(segmentId, { status: 'failed', error: data.error });
        } else {
          updateVideoSegment(segmentId, { progress: Math.min(95, (attempts / 60) * 100) });
        }
      } catch {}
    }, 5000);
  };

  const generateSegmentVideo = async (segmentId: number) => {
    const seg = segments.find(s => s.id === segmentId);
    if (!seg || !state.avatar) return;

    updateVideoSegment(segmentId, { status: 'generating', error: undefined, progress: 0 });

    try {
      const prompt = buildVideoPrompt(seg.text, seg.type, state.avatarConfig.gender, deal);

      const { data, error } = await supabase.functions.invoke('generate-video-from-image', {
        headers: dashboardAuthHeaders(),
        body: {
          prompt,
          imageUrl: state.avatar.imageUrl,
          aspectRatio: '9:16',
          duration: 8,
        },
      });

      if (error || data?.error) {
        updateVideoSegment(segmentId, { status: 'failed', error: error?.message || data?.error });
        return;
      }

      if (data.status === 'completed' && data.videoUrl) {
        updateVideoSegment(segmentId, { status: 'done', videoUrl: data.videoUrl, progress: 100 });
        toast.success(`Segment ${segmentId} complete!`);
      } else if (data.operationId) {
        updateVideoSegment(segmentId, { status: 'polling', operationId: data.operationId, progress: 5 });
        startPolling(segmentId, data.operationId);
      }
    } catch (err: any) {
      updateVideoSegment(segmentId, { status: 'failed', error: err.message });
    }
  };

  const handleGenerateAll = async () => {
    for (const seg of segments) {
      const vs = state.videoSegments.find(v => v.segmentId === seg.id);
      if (!vs || vs.status === 'done') continue;
      await generateSegmentVideo(seg.id);
      // Delay between requests to avoid rate limits
      await new Promise(r => setTimeout(r, 2000));
    }
  };

  const allDone = state.videoSegments.length > 0 && state.videoSegments.every(v => v.status === 'done');
  const anyGenerating = state.videoSegments.some(v => v.status === 'generating' || v.status === 'polling');

  const statusIcon = (status: string) => {
    switch (status) {
      case 'done': return <CheckCircle2 className="h-5 w-5 text-green-500" />;
      case 'failed': return <XCircle className="h-5 w-5 text-destructive" />;
      case 'generating': case 'polling': return <Loader2 className="h-5 w-5 animate-spin text-primary" />;
      default: return <div className="h-5 w-5 rounded-full border-2 border-muted-foreground/30" />;
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Video className="h-5 w-5" />
            Step 4: Video Generation
          </CardTitle>
          <Button onClick={handleGenerateAll} disabled={anyGenerating || allDone} className="gap-2">
            {anyGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            Generate All Segments
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Avatar reference */}
        {state.avatar && (
          <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
            <img src={state.avatar.imageUrl} className="h-16 w-9 rounded object-cover" alt="" />
            <div className="text-sm">
              <p className="font-medium">Reference avatar will be used for all segments</p>
              <p className="text-muted-foreground text-xs">Ensures visual consistency across video clips</p>
            </div>
          </div>
        )}

        {/* Segment cards */}
        <div className="space-y-3">
          {segments.map(seg => {
            const vs = state.videoSegments.find(v => v.segmentId === seg.id);
            return (
              <div key={seg.id} className="border rounded-lg p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {statusIcon(vs?.status || 'queued')}
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">Segment {seg.id}</span>
                        <Badge variant="secondary" className="text-xs">{seg.type}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{seg.text}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {vs?.status === 'failed' && (
                      <Button variant="outline" size="sm" onClick={() => generateSegmentVideo(seg.id)} className="gap-1">
                        <RefreshCw className="h-3 w-3" /> Retry
                      </Button>
                    )}
                    {vs?.status === 'done' && (
                      <Button variant="outline" size="sm" onClick={() => generateSegmentVideo(seg.id)} className="gap-1">
                        <RefreshCw className="h-3 w-3" /> Redo
                      </Button>
                    )}
                    {vs?.status === 'queued' && (
                      <Button variant="outline" size="sm" onClick={() => generateSegmentVideo(seg.id)} className="gap-1">
                        <Play className="h-3 w-3" /> Generate
                      </Button>
                    )}
                  </div>
                </div>

                {(vs?.status === 'generating' || vs?.status === 'polling') && (
                  <Progress value={vs.progress || 0} className="h-1.5" />
                )}

                {vs?.error && (
                  <p className="text-xs text-destructive">{vs.error}</p>
                )}

                {vs?.videoUrl && (
                  <video src={vs.videoUrl} controls className="w-full max-w-xs rounded aspect-[9/16] bg-black" />
                )}
              </div>
            );
          })}
        </div>

        {/* Navigation */}
        <div className="flex justify-between pt-4">
          <Button variant="outline" onClick={() => setStep('avatar')} className="gap-2">
            <ArrowLeft className="h-4 w-4" /> Back
          </Button>
          <Button onClick={() => setStep('composite')} disabled={!allDone} className="gap-2">
            Next: Add Captions <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
