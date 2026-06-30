import { useState } from 'react';
import { useAvatarAd } from '@/context/AvatarAdContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, ArrowRight, Loader2, RefreshCw, Wand2, GripVertical, Trash2, Plus } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { buildScriptPrompt } from '@/lib/avatar-ad-prompts';
import type { DealInput, ScriptSegment, SegmentType } from '@/types/avatar-ad';

const SEGMENT_COLORS: Record<SegmentType, string> = {
  hook: 'bg-red-500/10 text-red-500 border-red-500/30',
  credibility: 'bg-blue-500/10 text-blue-500 border-blue-500/30',
  context: 'bg-green-500/10 text-green-500 border-green-500/30',
  cta: 'bg-amber-500/10 text-amber-500 border-amber-500/30',
};

export function ScriptStep() {
  const { state, setStep, setScript } = useAvatarAd();
  const [isGenerating, setIsGenerating] = useState(false);
  const [segments, setSegments] = useState<ScriptSegment[]>(() => {
    if (state.script?.segments?.length) return state.script.segments;
    // Auto-segment custom script on init
    const deal = state.deal as DealInput;
    if (deal.customScript) return segmentCustomScript(deal.customScript);
    return [];
  });
  const [headline, setHeadline] = useState(() => {
    if (state.script?.headline) return state.script.headline;
    return (state.deal as DealInput).projectName || 'Investment Opportunity';
  });

  const deal = state.deal as DealInput;

  const handleGenerate = async () => {
    setIsGenerating(true);
    try {
      const prompt = buildScriptPrompt(deal);

      const { data, error } = await supabase.functions.invoke('generate-ad-script', {
        body: { prompt, model: 'nvidia/nemotron-3-ultra:free' },
      });

      if (error) throw error;

      let parsed = data;
      if (typeof data === 'string') {
        parsed = JSON.parse(data);
      }

      if (parsed.segments && Array.isArray(parsed.segments)) {
        setSegments(parsed.segments);
        setHeadline(parsed.headline || deal.projectName || '');
        toast.success('Script generated!');
      } else {
        throw new Error('Invalid script format returned');
      }
    } catch (err) {
      console.error('Script generation error:', err);
      toast.error('Failed to generate script. Try again.');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleUpdateSegment = (id: number, text: string) => {
    setSegments(prev => prev.map(s => s.id === id ? { ...s, text } : s));
  };

  const handleDeleteSegment = (id: number) => {
    setSegments(prev => prev.filter(s => s.id !== id));
  };

  const handleAddSegment = () => {
    const maxId = segments.length > 0 ? Math.max(...segments.map(s => s.id)) : 0;
    setSegments(prev => [...prev, { id: maxId + 1, text: '', type: 'context' as SegmentType }]);
  };

  const handleContinue = () => {
    if (segments.length === 0) {
      toast.error('Add at least one script segment');
      return;
    }
    setScript({ segments, headline });
    setStep('avatar');
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Wand2 className="h-5 w-5" />
          Step 2: Script
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex items-center gap-3">
          <Button onClick={handleGenerate} disabled={isGenerating} variant="outline" className="gap-2">
            {isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {segments.length > 0 ? 'Regenerate Script' : 'Auto-Generate Script'}
          </Button>
          {!deal.customScript && segments.length === 0 && (
            <span className="text-xs text-muted-foreground">Click to generate based on your deal info</span>
          )}
        </div>

        <div className="space-y-2">
          <Label>Headline (pinned banner text)</Label>
          <Input value={headline} onChange={e => setHeadline(e.target.value)} placeholder="e.g. Barn Caves — Lake Havasu" />
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label>Script Segments</Label>
            <Button variant="ghost" size="sm" onClick={handleAddSegment} className="gap-1 text-xs">
              <Plus className="h-3 w-3" /> Add Segment
            </Button>
          </div>

          {segments.map((seg) => (
            <div key={seg.id} className="flex gap-3 items-start group">
              <div className="pt-2 cursor-grab text-muted-foreground/40">
                <GripVertical className="h-4 w-4" />
              </div>
              <div className="flex-1 space-y-1.5">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className={SEGMENT_COLORS[seg.type]}>
                    {seg.type.toUpperCase()}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {seg.text.split(' ').filter(Boolean).length} words
                  </span>
                </div>
                <Textarea
                  value={seg.text}
                  onChange={e => handleUpdateSegment(seg.id, e.target.value)}
                  rows={2}
                  className="text-sm"
                />
              </div>
              <Button
                variant="ghost" size="icon"
                onClick={() => handleDeleteSegment(seg.id)}
                className="opacity-0 group-hover:opacity-100 mt-6"
              >
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </div>
          ))}

          {segments.length === 0 && (
            <div className="text-center py-8 text-muted-foreground border border-dashed rounded-lg">
              {deal.customScript ? 'Custom script will be auto-segmented' : 'Generate a script or add segments manually'}
            </div>
          )}
        </div>

        <div className="flex justify-between pt-2">
          <Button variant="outline" onClick={() => setStep('deal')} className="gap-2">
            <ArrowLeft className="h-4 w-4" /> Back
          </Button>
          <Button onClick={handleContinue} disabled={segments.length === 0} className="gap-2">
            Next: Generate Avatar <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function segmentCustomScript(text: string): ScriptSegment[] {
  const lines = text.split('\n').filter(l => l.trim());
  const types: SegmentType[] = ['hook', 'credibility', 'context', 'cta'];
  if (lines.length >= 4) {
    return lines.slice(0, 4).map((line, i) => ({
      id: i + 1,
      text: line.trim(),
      type: types[i] || 'context',
    }));
  }
  const words = text.split(/\s+/);
  const chunkSize = Math.ceil(words.length / 4);
  return types.map((type, i) => ({
    id: i + 1,
    text: words.slice(i * chunkSize, (i + 1) * chunkSize).join(' '),
    type,
  }));
}
