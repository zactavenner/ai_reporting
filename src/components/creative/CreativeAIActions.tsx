import { useEffect, useRef, useState } from 'react';
import { Creative, CreativeVariation } from '@/hooks/useCreatives';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import ReactMarkdown from 'react-markdown';
import { 
  FileText, 
  Sparkles, 
  Loader2, 
  Video,
  CheckCircle,
  AlertCircle,
  Star,
  Paintbrush,
  Copy,
  Download,
  Wand2,
  Trash2,
  Eraser,
  Layers
} from 'lucide-react';

interface CreativeAIActionsProps {
  creative: Creative;
}

const EDIT_MODELS = [
  { id: 'google/gemini-3.1-flash-image-preview', label: 'Gemini 3.1 Flash Image (fast)' },
  { id: 'google/gemini-3-pro-image-preview', label: 'Gemini 3 Pro Image (high quality)' },
  { id: 'google/gemini-2.5-flash-image', label: 'Nano Banana (Gemini 2.5)' },
  { id: 'openai/gpt-5.4', label: 'ChatGPT (GPT-5.4)' },
];

export function CreativeAIActions({ creative }: CreativeAIActionsProps) {
  const queryClient = useQueryClient();
  const [transcribing, setTranscribing] = useState(false);
  const [auditing, setAuditing] = useState(false);
  const [transcript, setTranscript] = useState<string | null>(null);
  const [audit, setAudit] = useState<string | null>(null);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [auditOpen, setAuditOpen] = useState(false);

  // AI Edit state
  const [editOpen, setEditOpen] = useState(false);
  const [editPrompt, setEditPrompt] = useState('');
  const [editing, setEditing] = useState(false);
  const [editModel, setEditModel] = useState<string>(EDIT_MODELS[0].id);
  const [latestEdit, setLatestEdit] = useState<CreativeVariation | null>(null);

  // AI Variations state
  const [variationsOpen, setVariationsOpen] = useState(false);
  const [generatingVariations, setGeneratingVariations] = useState(false);

  // Saved variations live on the creative row
  const variations: CreativeVariation[] = creative.ai_variations || [];

  // To-video state
  const [videoBusy, setVideoBusy] = useState(false);

  // Markup canvas refs
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const drawingRef = useRef(false);
  const [hasMarkup, setHasMarkup] = useState(false);

  const setupCanvas = () => {
    const img = imgRef.current;
    const canvas = canvasRef.current;
    if (!img || !canvas) return;
    const rect = img.getBoundingClientRect();
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
  };

  useEffect(() => {
    if (!editOpen) return;
    const id = setTimeout(setupCanvas, 80);
    return () => clearTimeout(id);
  }, [editOpen, latestEdit]);

  const pointToCanvas = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const pt = 'touches' in e ? e.touches[0] : (e as React.MouseEvent);
    const x = ((pt.clientX - rect.left) / rect.width) * canvas.width;
    const y = ((pt.clientY - rect.top) / rect.height) * canvas.height;
    return { x, y };
  };

  const startDraw = (e: React.MouseEvent | React.TouchEvent) => {
    drawingRef.current = true;
    const ctx = canvasRef.current!.getContext('2d')!;
    const { x, y } = pointToCanvas(e);
    ctx.strokeStyle = 'rgba(255, 30, 30, 0.9)';
    ctx.lineWidth = Math.max(8, canvasRef.current!.width / 120);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(x, y);
  };
  const moveDraw = (e: React.MouseEvent | React.TouchEvent) => {
    if (!drawingRef.current) return;
    e.preventDefault();
    const ctx = canvasRef.current!.getContext('2d')!;
    const { x, y } = pointToCanvas(e);
    ctx.lineTo(x, y);
    ctx.stroke();
    setHasMarkup(true);
  };
  const endDraw = () => { drawingRef.current = false; };
  const clearMarkup = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.getContext('2d')!.clearRect(0, 0, canvas.width, canvas.height);
    setHasMarkup(false);
  };

  const buildAnnotatedImage = async (): Promise<string | null> => {
    if (!hasMarkup) return null;
    const img = imgRef.current!;
    const canvas = canvasRef.current!;
    const out = document.createElement('canvas');
    out.width = img.naturalWidth;
    out.height = img.naturalHeight;
    const ctx = out.getContext('2d')!;
    // Draw original via crossOrigin fetch to avoid taint
    const resp = await fetch(creative.file_url!, { mode: 'cors' });
    const blob = await resp.blob();
    const bmp = await createImageBitmap(blob);
    ctx.drawImage(bmp, 0, 0, out.width, out.height);
    ctx.drawImage(canvas, 0, 0);
    const dataUrl = out.toDataURL('image/png');
    // Upload so the edge function (and the model) can fetch it
    const base64 = dataUrl.split(',')[1];
    const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    const path = `${creative.client_id}/ai-markup-${Date.now()}.png`;
    const { error } = await supabase.storage.from('creatives').upload(path, bytes, {
      contentType: 'image/png', upsert: true,
    });
    if (error) throw error;
    return supabase.storage.from('creatives').getPublicUrl(path).data.publicUrl;
  };

  const persistVariation = async (v: CreativeVariation) => {
    const next = [...variations, v];
    const { error } = await supabase
      .from('creatives')
      .update({ ai_variations: next as any })
      .eq('id', creative.id);
    if (error) throw error;
    queryClient.invalidateQueries({ queryKey: ['creatives'] });
  };

  const deleteVariation = async (id: string) => {
    const next = variations.filter(v => v.id !== id);
    const { error } = await supabase
      .from('creatives')
      .update({ ai_variations: next as any })
      .eq('id', creative.id);
    if (error) { toast.error('Delete failed'); return; }
    queryClient.invalidateQueries({ queryKey: ['creatives'] });
    toast.success('Variation deleted');
  };

  const promoteToMain = async (v: CreativeVariation) => {
    const { error } = await supabase
      .from('creatives')
      .update({ file_url: v.url, type: v.type === 'video' ? 'video' : 'image' })
      .eq('id', creative.id);
    if (error) { toast.error('Could not set as main'); return; }
    queryClient.invalidateQueries({ queryKey: ['creatives'] });
    toast.success('Set as main creative');
  };

  const handleTranscribe = async () => {
    if (!creative.file_url) {
      toast.error('No video file to transcribe');
      return;
    }

    setTranscribing(true);
    try {
      const { data, error } = await supabase.functions.invoke('creative-ai-audit', {
        body: { 
          action: 'transcribe',
          videoUrl: creative.file_url 
        }
      });

      if (error) throw error;

      if (data?.transcript) {
        setTranscript(data.transcript);
        setTranscriptOpen(true);
        toast.success('Video transcribed successfully');
      } else {
        throw new Error('No transcript returned');
      }
    } catch (error) {
      console.error('Transcription error:', error);
      toast.error('Failed to transcribe video');
    } finally {
      setTranscribing(false);
    }
  };

  const handleAudit = async () => {
    setAuditing(true);
    try {
      const { data, error } = await supabase.functions.invoke('creative-ai-audit', {
        body: { 
          action: 'audit',
          creative: {
            title: creative.title,
            type: creative.type,
            platform: creative.platform,
            headline: creative.headline,
            body_copy: creative.body_copy,
            cta_text: creative.cta_text,
            file_url: creative.file_url
          },
          transcript: transcript
        }
      });

      if (error) throw error;

      if (data?.audit) {
        setAudit(data.audit);
        setAuditOpen(true);
        toast.success('AI audit complete');
      } else {
        throw new Error('No audit returned');
      }
    } catch (error) {
      console.error('Audit error:', error);
      toast.error('Failed to run AI audit');
    } finally {
      setAuditing(false);
    }
  };

  const handleAIEdit = async () => {
    if (!editPrompt.trim()) {
      toast.error('Describe the edit (or mark up the image)');
      return;
    }

    setEditing(true);
    setLatestEdit(null);
    try {
      const annotatedImageUrl = await buildAnnotatedImage();
      const { data, error } = await supabase.functions.invoke('creative-ai-audit', {
        body: { 
          action: 'ai_edit',
          creative: {
            client_id: creative.client_id,
            file_url: creative.file_url,
          },
          imageUrl: creative.file_url,
          editPrompt: editPrompt,
          model: editModel,
          annotatedImageUrl,
        }
      });

      if (error) throw error;

      if (data?.editedImageUrl) {
        const v: CreativeVariation = {
          id: crypto.randomUUID(),
          url: data.editedImageUrl,
          type: 'image',
          prompt: editPrompt,
          model: data.model || editModel,
          description: data.description || undefined,
          created_at: new Date().toISOString(),
        };
        await persistVariation(v);
        setLatestEdit(v);
        clearMarkup();
        setEditPrompt('');
        toast.success('Variation saved');
      } else if (data?.error) {
        toast.error(data.error);
      } else {
        throw new Error('No edited image returned');
      }
    } catch (error) {
      console.error('AI Edit error:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to apply AI edits');
    } finally {
      setEditing(false);
    }
  };

  const handleAIVariations = async () => {
    setGeneratingVariations(true);
    try {
      const { data, error } = await supabase.functions.invoke('creative-ai-audit', {
        body: {
          action: 'ai_variations',
          creative: { client_id: creative.client_id, file_url: creative.file_url },
          imageUrl: creative.file_url,
        }
      });
      if (error) throw error;
      if (data?.variations?.length) {
        const newVars: CreativeVariation[] = data.variations.map((v: any) => ({
          id: crypto.randomUUID(),
          url: v.url,
          type: 'image',
          description: v.description,
          model: 'google/gemini-3.1-flash-image-preview',
          created_at: new Date().toISOString(),
        }));
        const next = [...variations, ...newVars];
        await supabase.from('creatives').update({ ai_variations: next as any }).eq('id', creative.id);
        queryClient.invalidateQueries({ queryKey: ['creatives'] });
        toast.success(`Saved ${newVars.length} variations`);
      } else if (data?.error) toast.error(data.error);
    } catch (error) {
      console.error('AI Variations error:', error);
      toast.error('Failed to generate variations');
    } finally {
      setGeneratingVariations(false);
    }
  };

  const handleToVideo = async () => {
    if (!creative.file_url) return;
    setVideoBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke('creative-ai-audit', {
        body: {
          action: 'to_video',
          creative: { client_id: creative.client_id, file_url: creative.file_url },
          imageUrl: creative.file_url,
          editPrompt,
          aspectRatio: creative.aspect_ratio === '1:1' ? '1:1' : creative.aspect_ratio === '16:9' ? '16:9' : '9:16',
          duration: 5,
        },
      });
      if (error) throw error;
      const opId: string | undefined = data?.operationId;
      if (!opId) {
        if (data?.error) throw new Error(data.error);
        throw new Error('Video kickoff failed');
      }
      toast.message('Veo 3.1 rendering — this takes 1–3 minutes…');

      // Poll up to ~6 minutes
      let videoUrl: string | null = null;
      for (let i = 0; i < 60; i++) {
        await new Promise(r => setTimeout(r, 6000));
        const { data: poll } = await supabase.functions.invoke('poll-video-status', {
          body: { operationId: opId },
        });
        if (poll?.status === 'completed' && poll.videoUrl) {
          videoUrl = poll.videoUrl;
          break;
        }
        if (poll?.status === 'failed') throw new Error(poll.error || 'Video failed');
      }
      if (!videoUrl) throw new Error('Video timed out');

      const v: CreativeVariation = {
        id: crypto.randomUUID(),
        url: videoUrl,
        type: 'video',
        prompt: editPrompt || 'Animate ad image',
        model: 'veo-3.1',
        created_at: new Date().toISOString(),
      };
      await persistVariation(v);
      toast.success('Video variation saved');
      setVariationsOpen(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Video conversion failed');
    } finally {
      setVideoBusy(false);
    }
  };

  // Extract score from audit text
  const extractScore = (auditText: string): number | null => {
    const match = auditText.match(/Overall Score[:\s]*(\d+)/i);
    return match ? parseInt(match[1], 10) : null;
  };

  const score = audit ? extractScore(audit) : null;

  const getScoreColor = (s: number) => {
    if (s >= 8) return 'text-green-500';
    if (s >= 6) return 'text-amber-500';
    return 'text-red-500';
  };

  const isImageCreative = creative.type === 'image' && creative.file_url;

  return (
    <>
      <div className="flex gap-2 flex-wrap">
        {creative.type === 'video' && (
          <Button 
            variant="outline" 
            size="sm" 
            onClick={handleTranscribe}
            disabled={transcribing}
            className="gap-2"
          >
            {transcribing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Video className="h-4 w-4" />
            )}
            {transcribing ? 'Transcribing...' : 'Transcribe Video'}
          </Button>
        )}

        <Button 
          variant="outline" 
          size="sm" 
          onClick={handleAudit}
          disabled={auditing}
          className="gap-2"
        >
          {auditing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="h-4 w-4" />
          )}
          {auditing ? 'Analyzing...' : 'AI Audit'}
        </Button>

        {/* AI Edit - image only */}
        {isImageCreative && (
          <Button 
            variant="outline" 
            size="sm" 
            onClick={() => setEditOpen(true)}
            className="gap-2"
          >
            <Paintbrush className="h-4 w-4" />
            AI Edit + Markup
          </Button>
        )}

        {/* Image -> Video (Veo 3.1) */}
        {isImageCreative && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleToVideo}
            disabled={videoBusy}
            className="gap-2"
          >
            {videoBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Video className="h-4 w-4" />}
            {videoBusy ? 'Rendering Veo 3.1…' : 'Image → Video (Veo 3.1)'}
          </Button>
        )}

        {/* AI Variations - image only */}
        {isImageCreative && (
          <Button 
            variant="outline" 
            size="sm" 
            onClick={handleAIVariations}
            disabled={generatingVariations}
            className="gap-2"
          >
            {generatingVariations ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Wand2 className="h-4 w-4" />
            )}
            {generatingVariations ? 'Generating…' : 'Auto Variations'}
          </Button>
        )}

        {/* Variations gallery */}
        {variations.length > 0 && (
          <Button variant="ghost" size="sm" onClick={() => setVariationsOpen(true)} className="gap-1 text-primary">
            <Layers className="h-4 w-4" />
            {variations.length} Variation{variations.length === 1 ? '' : 's'}
          </Button>
        )}

        {/* Quick indicators */}
        {transcript && (
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={() => setTranscriptOpen(true)}
            className="gap-1 text-green-600"
          >
            <CheckCircle className="h-4 w-4" />
            Transcript Ready
          </Button>
        )}

        {audit && score !== null && (
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={() => setAuditOpen(true)}
            className={`gap-1 ${getScoreColor(score)}`}
          >
            <Star className="h-4 w-4" />
            Score: {score}/10
          </Button>
        )}
      </div>

      {/* Transcript Modal */}
      <Dialog open={transcriptOpen} onOpenChange={setTranscriptOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Video Transcription
            </DialogTitle>
          </DialogHeader>
          <ScrollArea className="max-h-[60vh]">
            <div className="prose prose-sm dark:prose-invert max-w-none pr-4">
              <ReactMarkdown>{transcript || ''}</ReactMarkdown>
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>

      {/* Audit Modal */}
      <Dialog open={auditOpen} onOpenChange={setAuditOpen}>
        <DialogContent className="max-w-3xl max-h-[85vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              AI Creative Audit
              {score !== null && (
                <Badge className={`ml-2 ${score >= 8 ? 'bg-green-100 text-green-800' : score >= 6 ? 'bg-amber-100 text-amber-800' : 'bg-red-100 text-red-800'}`}>
                  Score: {score}/10
                </Badge>
              )}
            </DialogTitle>
          </DialogHeader>
          
          <div className="flex items-center gap-4 py-2">
            <Badge variant="outline">{creative.platform}</Badge>
            <Badge variant="secondary">{creative.type}</Badge>
            <span className="text-sm text-muted-foreground">{creative.title}</span>
          </div>
          
          <Separator />
          
          <ScrollArea className="max-h-[55vh]">
            <div className="prose prose-sm dark:prose-invert max-w-none pr-4">
              <ReactMarkdown>{audit || ''}</ReactMarkdown>
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>

      {/* AI Edit Modal — markup + model picker */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-5xl max-h-[92vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Paintbrush className="h-5 w-5 text-primary" />
              AI Edit — draw on the image to mark what you want to change
            </DialogTitle>
          </DialogHeader>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Image with markup canvas overlay */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-medium">Original {hasMarkup && <Badge variant="outline" className="ml-2">Marked up</Badge>}</p>
                <Button size="sm" variant="ghost" onClick={clearMarkup} disabled={!hasMarkup} className="gap-1">
                  <Eraser className="h-3 w-3" /> Clear
                </Button>
              </div>
              <div className="relative border rounded-lg overflow-hidden bg-muted inline-block">
                <img
                  ref={imgRef}
                  src={creative.file_url!}
                  alt="Original"
                  crossOrigin="anonymous"
                  onLoad={setupCanvas}
                  className="block max-h-[460px] w-auto"
                />
                <canvas
                  ref={canvasRef}
                  className="absolute inset-0 cursor-crosshair touch-none"
                  onMouseDown={startDraw}
                  onMouseMove={moveDraw}
                  onMouseUp={endDraw}
                  onMouseLeave={endDraw}
                  onTouchStart={startDraw}
                  onTouchMove={moveDraw}
                  onTouchEnd={endDraw}
                />
              </div>
            </div>

            {/* Latest result or prompt */}
            <div className="space-y-3">
              <div>
                <p className="text-xs font-medium mb-1">Model</p>
                <Select value={editModel} onValueChange={setEditModel}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {EDIT_MODELS.map(m => <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <p className="text-xs font-medium mb-1">What should change?</p>
                <Textarea
                  value={editPrompt}
                  onChange={(e) => setEditPrompt(e.target.value)}
                  placeholder="e.g., Replace the marked area with a sunset sky. Keep all text identical."
                  rows={4}
                />
              </div>
              {latestEdit && (
                <div className="border rounded-lg overflow-hidden bg-muted">
                  <p className="text-xs font-medium p-2 border-b">Latest variation (saved)</p>
                  <img src={latestEdit.url} alt="Edit" className="w-full h-auto object-contain max-h-[280px]" />
                </div>
              )}
              <div className="flex justify-end gap-2">
                <Button onClick={handleAIEdit} disabled={editing || !editPrompt.trim()}>
                  {editing ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Generating…</> : <><Paintbrush className="h-4 w-4 mr-2" />Apply Edit</>}
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Variations gallery — saved per-creative */}
      <Dialog open={variationsOpen} onOpenChange={setVariationsOpen}>
        <DialogContent className="max-w-5xl max-h-[90vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Layers className="h-5 w-5 text-primary" />
              Variations
              <Badge variant="outline" className="ml-2">{variations.length}</Badge>
              <Button size="sm" variant="outline" className="ml-auto gap-1" onClick={() => { setEditOpen(true); setVariationsOpen(false); }}>
                <Paintbrush className="h-3 w-3" /> New AI Edit
              </Button>
            </DialogTitle>
          </DialogHeader>

          {variations.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <p>No variations yet. Use “AI Edit + Markup” or “Image → Video” to create one.</p>
            </div>
          ) : (
            <ScrollArea className="max-h-[70vh]">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pr-4">
                {variations.map((v, i) => (
                  <div key={v.id} className="border rounded-lg overflow-hidden bg-muted/40">
                    {v.type === 'video' ? (
                      <video src={v.url} controls className="w-full h-auto bg-black" />
                    ) : (
                      <img src={v.url} alt={`Variation ${i + 1}`} className="w-full h-auto object-contain bg-muted" />
                    )}
                    <div className="p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-medium">Variation {i + 1}</p>
                        <Badge variant="outline" className="text-[10px]">{v.model || v.type}</Badge>
                      </div>
                      {v.prompt && <p className="text-xs text-muted-foreground line-clamp-2">{v.prompt}</p>}
                      <div className="flex gap-1">
                        <Button size="sm" variant="outline" className="flex-1 gap-1" onClick={() => promoteToMain(v)}>
                          <CheckCircle className="h-3 w-3" /> Set as main
                        </Button>
                        <Button size="sm" variant="outline" asChild>
                          <a href={v.url} download target="_blank" rel="noreferrer"><Download className="h-3 w-3" /></a>
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => deleteVariation(v.id)}>
                          <Trash2 className="h-3 w-3 text-destructive" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}

          <div className="border-t pt-4">
            <p className="text-sm font-medium mb-2">Original</p>
            <img src={creative.file_url!} alt="Original" className="h-24 rounded border object-contain bg-muted" />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}