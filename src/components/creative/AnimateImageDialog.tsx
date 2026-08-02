import { useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Loader2, Video, Play, AlertCircle } from 'lucide-react';

export const ANIMATE_DEFAULT_PROMPT =
  'Animate this static ad image with subtle, professional motion in the background and scene elements only (gentle parallax, soft camera push-in, natural ambient motion like light/shadow shifts, equipment, smoke, dust, or environment). CRITICAL: Do NOT modify, animate, warp, redraw, re-render, distort, or change ANY text, headlines, captions, numbers, tables, charts, logos, badges, or typography in any way — keep every word, letter, number and graphic element pixel-identical and perfectly static throughout the entire video. Preserve the exact layout, colors and composition.';

type VideoModelOption = {
  id: string;
  label: string;
  hint: string;
  resolutions: string[];
  durations: number[];
  pricePerSecond: number;
};

export const ANIMATE_MODELS: VideoModelOption[] = [
  { id: 'bytedance/seedance-2.0', label: 'Seedance 2.0 Pro', hint: 'Best at holding text and layout still', resolutions: ['480p', '720p', '1080p'], durations: [5, 10, 15], pricePerSecond: 0.0938 },
  { id: 'x-ai/grok-imagine-video-1.5', label: 'Grok Imagine 1.5', hint: 'Cinematic first-frame motion', resolutions: ['480p', '720p', '1080p'], durations: [5, 10, 15], pricePerSecond: 0.14 },
  { id: 'bytedance/seedance-2.0-fast', label: 'Seedance 2.0 Fast', hint: 'Cheapest, quickest render', resolutions: ['480p', '720p'], durations: [5, 10, 15], pricePerSecond: 0.0538 },
  { id: 'google/veo-3.1-fast', label: 'Veo 3.1 Fast', hint: 'Google Veo via OpenRouter', resolutions: ['720p', '1080p'], durations: [5, 8], pricePerSecond: 0.15 },
  { id: 'veo-3.1', label: 'Veo 3.1 (Google direct)', hint: 'Uses the Gemini key, 4–8s only', resolutions: ['720p', '1080p'], durations: [5, 8], pricePerSecond: 0.4 },
];

type JobRow = {
  id: string;
  status: string;
  model: string;
  progress_label: string | null;
  error: string | null;
  output_url: string | null;
  poll_count: number;
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  creativeId: string;
  clientId: string | null;
  imageUrl: string;
  aspectRatio?: string | null;
  onCompleted?: () => void;
}

export function AnimateImageDialog({ open, onOpenChange, creativeId, clientId, imageUrl, aspectRatio, onCompleted }: Props) {
  const [model, setModel] = useState(ANIMATE_MODELS[0].id);
  const [duration, setDuration] = useState(5);
  const [resolution, setResolution] = useState('720p');
  const [aspect, setAspect] = useState(
    aspectRatio === '1:1' ? '1:1' : aspectRatio === '16:9' ? '16:9' : '9:16',
  );
  const [prompt, setPrompt] = useState(ANIMATE_DEFAULT_PROMPT);
  const [submitting, setSubmitting] = useState(false);
  const [job, setJob] = useState<JobRow | null>(null);
  const timer = useRef<number | null>(null);

  const selected = ANIMATE_MODELS.find(m => m.id === model) || ANIMATE_MODELS[0];
  const estimate = (selected.pricePerSecond * duration).toFixed(2);
  const running = !!job && ['queued', 'rendering', 'saving'].includes(job.status);

  // Clamp resolution/duration to what the selected model supports.
  useEffect(() => {
    if (!selected.resolutions.includes(resolution)) setResolution(selected.resolutions[selected.resolutions.length - 1]);
    if (!selected.durations.includes(duration)) setDuration(selected.durations[0]);
  }, [model]); // eslint-disable-line react-hooks/exhaustive-deps

  const stopPolling = () => {
    if (timer.current) { window.clearTimeout(timer.current); timer.current = null; }
  };

  useEffect(() => stopPolling, []);

  const pollJob = (jobId: string) => {
    stopPolling();
    timer.current = window.setTimeout(async () => {
      const { data, error } = await supabase.functions.invoke('animate-creative', {
        body: { action: 'status', jobId, retry: retriedSave.current },
      });
      retriedSave.current = false;
      if (error) { pollJob(jobId); return; }
      const next = (data as { job?: JobRow })?.job;
      if (next) {
        setJob(next);
        if (next.status === 'completed') {
          toast.success('Animated video saved to variations');
          onCompleted?.();
          return;
        }
        if (next.status === 'failed') {
          // The clip rendered but the save hiccuped — retry the save once automatically.
          if (!next.output_url && next.error?.toLowerCase().includes('download') && !savedRetryUsed.current) {
            savedRetryUsed.current = true;
            retriedSave.current = true;
            pollJob(jobId);
            return;
          }
          toast.error(next.error || 'Animation failed');
          return;
        }
      }
      pollJob(jobId);
    }, 6000);
  };

  const start = async () => {
    setSubmitting(true);
    setJob(null);
    try {
      const { data, error } = await supabase.functions.invoke('animate-creative', {
        body: {
          action: 'start',
          creativeId,
          clientId,
          imageUrl,
          prompt: prompt.trim() || ANIMATE_DEFAULT_PROMPT,
          model,
          duration,
          resolution,
          aspectRatio: aspect,
        },
      });
      const payload = data as { jobId?: string; error?: string; modelLabel?: string; fallbackNotes?: string[] } | null;
      if (payload?.error) throw new Error(payload.error);
      if (error) throw error;
      if (!payload?.jobId) throw new Error('No job was created');
      if (payload.fallbackNotes?.length) {
        toast.warning(`Fell back to ${payload.modelLabel}: ${payload.fallbackNotes[0].slice(0, 160)}`);
      } else {
        toast.message(`${payload.modelLabel || selected.label} is rendering — usually 1–4 minutes`);
      }
      setJob({ id: payload.jobId, status: 'rendering', model, progress_label: 'Rendering…', error: null, output_url: null, poll_count: 0 });
      pollJob(payload.jobId);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not start the animation');
    } finally {
      setSubmitting(false);
    }
  };

  const percent = job
    ? job.status === 'completed' ? 100
      : job.status === 'saving' ? 92
      : Math.min(88, 8 + (job.poll_count || 0) * 3)
    : 0;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) stopPolling(); onOpenChange(o); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Video className="h-4 w-4" /> Animate Image
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="col-span-2 space-y-1.5">
              <Label className="text-xs">Model</Label>
              <Select value={model} onValueChange={setModel} disabled={running}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ANIMATE_MODELS.map(m => (
                    <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">{selected.hint}</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Length</Label>
              <Select value={String(duration)} onValueChange={(v) => setDuration(Number(v))} disabled={running}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {selected.durations.map(d => <SelectItem key={d} value={String(d)}>{d}s</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Resolution</Label>
              <Select value={resolution} onValueChange={setResolution} disabled={running}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {selected.resolutions.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Aspect ratio</Label>
              <Select value={aspect} onValueChange={setAspect} disabled={running}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="9:16">9:16 (Reels / Stories)</SelectItem>
                  <SelectItem value="1:1">1:1 (Feed)</SelectItem>
                  <SelectItem value="16:9">16:9 (Landscape)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <Badge variant="secondary" className="font-mono text-xs">Est. ${estimate}</Badge>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Motion prompt</Label>
            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={5}
              disabled={running}
              className="text-xs"
            />
          </div>

          {job && (
            <div className="space-y-2 rounded-lg border border-border/60 bg-muted/30 p-3">
              <div className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-2">
                  {running && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {job.status === 'failed' && <AlertCircle className="h-3.5 w-3.5 text-destructive" />}
                  {job.progress_label || job.status}
                </span>
                <span className="text-muted-foreground">{job.status}</span>
              </div>
              <Progress value={percent} className="h-1.5" />
              {job.error && <p className="text-[11px] text-destructive break-words">{job.error}</p>}
              {job.output_url && (
                <video src={job.output_url} controls className="w-full rounded-md" />
              )}
              {running && (
                <p className="text-[11px] text-muted-foreground">
                  You can close this dialog — rendering continues in the background and the clip lands in Variations.
                </p>
              )}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Close</Button>
            <Button size="sm" onClick={start} disabled={submitting || running} className="gap-2">
              {submitting || running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              {running ? 'Rendering…' : 'Animate'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}