import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Headphones,
  Mic,
  Play,
  Pause,
  Copy,
  Check,
  ChevronRight,
  Loader2,
  Sparkles,
  Target,
  Clock,
  Star,
  Download,
  RotateCcw,
  Save,
  Volume2,
  Radio,
  MessageSquare,
  Users,
  TrendingUp,
  Zap,
  Film,
  FileText,
  ArrowRight,
  Lightbulb,
  Eye,
} from 'lucide-react';
import { useClients } from '@/hooks/useClients';
import { useClientOffers } from '@/hooks/useClientOffers';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

const PODCAST_FORMATS = [
  { id: 'host-read', label: 'Host Read', description: 'Single host talking directly to camera/mic', icon: Mic, tip: 'Most authentic — highest trust signal', duration: '30-60s' },
  { id: 'interview-clip', label: 'Interview Clip', description: 'Two-person conversation about the product', icon: Users, tip: 'Great for social proof and storytelling', duration: '45-90s' },
  { id: 'roundtable', label: 'Roundtable', description: 'Multi-host discussion naturally mentioning the offer', icon: Radio, tip: 'Feels organic — like overhearing a rec', duration: '60-120s' },
  { id: 'story-testimonial', label: 'Story Testimonial', description: 'Customer-style narrative told podcast-style', icon: MessageSquare, tip: 'Best for case studies and results', duration: '30-60s' },
  { id: 'hot-take', label: 'Hot Take / Rant', description: 'Passionate opinion that leads to the product', icon: Zap, tip: 'Scroll-stopping — high engagement', duration: '15-45s' },
  { id: 'explainer', label: 'Deep Dive Explainer', description: 'Educational breakdown that positions the offer', icon: Lightbulb, tip: 'Best for complex or high-ticket offers', duration: '60-90s' },
];

const TONE_OPTIONS = [
  { id: 'conversational', label: 'Conversational', desc: 'Like talking to a friend' },
  { id: 'authoritative', label: 'Authoritative', desc: 'Expert positioning' },
  { id: 'excited', label: 'Excited / Energetic', desc: 'High energy, discovery feel' },
  { id: 'conspiratorial', label: 'Conspiratorial', desc: '"Let me tell you something..."' },
  { id: 'empathetic', label: 'Empathetic', desc: 'Understanding their pain' },
  { id: 'no-bs', label: 'No-BS Direct', desc: 'Straight talk, no fluff' },
];

const HOOK_STYLES = [
  { id: 'question', label: 'Question Hook', example: '"Have you ever wondered why..."' },
  { id: 'bold-claim', label: 'Bold Claim', example: '"This is the biggest opportunity in..."' },
  { id: 'story-open', label: 'Story Opener', example: '"So I was talking to a client who..."' },
  { id: 'contrarian', label: 'Contrarian Take', example: '"Everyone says X, but actually..."' },
  { id: 'stat-shock', label: 'Stat / Shock', example: '"Did you know 87% of investors..."' },
  { id: 'personal', label: 'Personal Reveal', example: '"I wasn\'t going to share this, but..."' },
];

interface GeneratedScript {
  id: string;
  format: string;
  tone: string;
  hookStyle: string;
  hook: string;
  body: string;
  cta: string;
  duration: string;
  speakerNotes: string;
}

export function PodcastAdsGenerator() {
  const { data: clients = [] } = useClients();
  const [clientId, setClientId] = useState('');
  const { data: offers = [] } = useClientOffers(clientId);
  const [offerId, setOfferId] = useState('');
  const [selectedFormat, setSelectedFormat] = useState('');
  const [selectedTone, setSelectedTone] = useState('');
  const [selectedHooks, setSelectedHooks] = useState<string[]>([]);
  const [offerDetails, setOfferDetails] = useState('');
  const [targetAudience, setTargetAudience] = useState('');
  const [keyBenefits, setKeyBenefits] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [scripts, setScripts] = useState<GeneratedScript[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [step, setStep] = useState(1);

  const selectedOffer = offers.find(o => o.id === offerId);
  const selectedFormatData = PODCAST_FORMATS.find(f => f.id === selectedFormat);

  const toggleHook = (id: string) => {
    setSelectedHooks(prev =>
      prev.includes(id) ? prev.filter(h => h !== id) : prev.length < 3 ? [...prev, id] : prev
    );
  };

  const handleGenerate = async () => {
    if (!clientId || !selectedFormat || !selectedTone || selectedHooks.length === 0) {
      toast.error('Fill in all required fields');
      return;
    }

    setIsGenerating(true);
    try {
      const formatData = PODCAST_FORMATS.find(f => f.id === selectedFormat);
      const toneData = TONE_OPTIONS.find(t => t.id === selectedTone);
      const hookData = selectedHooks.map(h => HOOK_STYLES.find(hs => hs.id === h));
      const client = clients.find(c => c.id === clientId);

      const prompt = `Generate ${selectedHooks.length} podcast-style ad scripts for the following:

Client: ${client?.name || 'Unknown'}
Offer: ${selectedOffer?.name || offerDetails || 'Not specified'}
${offerDetails ? `Offer Details: ${offerDetails}` : ''}
${targetAudience ? `Target Audience: ${targetAudience}` : ''}
${keyBenefits ? `Key Benefits: ${keyBenefits}` : ''}

Format: ${formatData?.label} — ${formatData?.description}
Tone: ${toneData?.label} — ${toneData?.desc}
Target Duration: ${formatData?.duration}

Generate one script for each of these hook styles:
${hookData.map(h => `- ${h?.label}: ${h?.example}`).join('\n')}

For each script, return a JSON array with objects containing:
- hook: The opening line (attention-grabbing)
- body: The main script body (conversational, no stage directions, just the spoken words)
- cta: The call to action (natural, not salesy)
- duration: Estimated read time
- speakerNotes: Brief direction for delivery (tone, pacing, emphasis)

Make it sound like a REAL podcast host naturally mentioning this. Not an ad read. Natural speech patterns, filler words where appropriate, genuine enthusiasm. The audience should feel like they're eavesdropping on a real conversation.

Return ONLY the JSON array, no markdown.`;

      const { data, error } = await supabase.functions.invoke('generate-ad-scripts', {
        body: {
          clientId,
          prompt,
          type: 'podcast-ad',
        },
      });

      if (error) throw error;

      let parsed: any[] = [];
      if (data?.scripts) {
        parsed = data.scripts;
      } else if (data?.result) {
        try {
          const cleaned = data.result.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
          parsed = JSON.parse(cleaned);
        } catch {
          parsed = [{ hook: data.result, body: '', cta: '', duration: '30s', speakerNotes: '' }];
        }
      }

      const generated: GeneratedScript[] = parsed.map((s: any, idx: number) => ({
        id: `podcast-${Date.now()}-${idx}`,
        format: selectedFormat,
        tone: selectedTone,
        hookStyle: selectedHooks[idx] || selectedHooks[0],
        hook: s.hook || '',
        body: s.body || '',
        cta: s.cta || '',
        duration: s.duration || formatData?.duration || '30s',
        speakerNotes: s.speakerNotes || s.speaker_notes || '',
      }));

      setScripts(prev => [...generated, ...prev]);
      setStep(3);
      toast.success(`${generated.length} podcast scripts generated`);
    } catch (err) {
      console.error(err);
      toast.error('Failed to generate scripts');
    } finally {
      setIsGenerating(false);
    }
  };

  const copyScript = (script: GeneratedScript) => {
    const full = `[HOOK]\n${script.hook}\n\n[BODY]\n${script.body}\n\n[CTA]\n${script.cta}\n\n[SPEAKER NOTES]\n${script.speakerNotes}`;
    navigator.clipboard.writeText(full);
    setCopiedId(script.id);
    setTimeout(() => setCopiedId(null), 2000);
    toast.success('Script copied');
  };

  const canGenerate = clientId && selectedFormat && selectedTone && selectedHooks.length > 0;

  return (
    <div className="space-y-8 max-w-5xl">
      {/* Header */}
      <div>
        <div className="flex items-center gap-3 mb-2">
          <div className="h-10 w-10 rounded-2xl bg-orange-500/10 flex items-center justify-center">
            <Headphones className="h-5 w-5 text-orange-500" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Podcast Ads Generator</h1>
            <p className="text-sm text-muted-foreground/50">Create authentic host-read scripts for podcast-style video ads</p>
          </div>
        </div>
      </div>

      {/* Step Indicator */}
      <div className="flex items-center gap-2">
        {[
          { num: 1, label: 'Setup' },
          { num: 2, label: 'Script Style' },
          { num: 3, label: 'Results' },
        ].map((s, idx) => (
          <div key={s.num} className="flex items-center gap-2">
            <button
              onClick={() => setStep(s.num)}
              className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-all ${
                step === s.num
                  ? 'bg-foreground text-background'
                  : step > s.num
                  ? 'bg-primary/10 text-primary'
                  : 'bg-muted/40 text-muted-foreground/50'
              }`}
            >
              {step > s.num ? <Check className="h-3.5 w-3.5" /> : <span className="text-xs font-bold">{s.num}</span>}
              {s.label}
            </button>
            {idx < 2 && <ChevronRight className="h-4 w-4 text-muted-foreground/20" />}
          </div>
        ))}
      </div>

      {/* Step 1: Setup */}
      {step === 1 && (
        <div className="space-y-6 fade-in-up">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Client *</label>
              <Select value={clientId} onValueChange={(v) => { setClientId(v); setOfferId(''); }}>
                <SelectTrigger className="h-11 rounded-xl"><SelectValue placeholder="Select client" /></SelectTrigger>
                <SelectContent>
                  {clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {clientId && offers.length > 0 && (
              <div className="space-y-2">
                <label className="text-sm font-medium">Offer</label>
                <Select value={offerId} onValueChange={setOfferId}>
                  <SelectTrigger className="h-11 rounded-xl"><SelectValue placeholder="Select offer (optional)" /></SelectTrigger>
                  <SelectContent>
                    {offers.map(o => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Offer / Product Details</label>
            <Textarea
              value={offerDetails}
              onChange={(e) => setOfferDetails(e.target.value)}
              placeholder="Describe the product, service, or offer. What does it do? Who is it for? What makes it unique?"
              className="min-h-[80px] rounded-xl resize-none"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Target Audience</label>
              <Input
                value={targetAudience}
                onChange={(e) => setTargetAudience(e.target.value)}
                placeholder="e.g., Accredited investors, 35-60, high net worth"
                className="h-11 rounded-xl"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Key Benefits</label>
              <Input
                value={keyBenefits}
                onChange={(e) => setKeyBenefits(e.target.value)}
                placeholder="e.g., Tax advantages, 15% IRR, passive income"
                className="h-11 rounded-xl"
              />
            </div>
          </div>

          <Button
            onClick={() => setStep(2)}
            disabled={!clientId}
            className="rounded-xl gap-2"
          >
            Continue
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* Step 2: Script Style */}
      {step === 2 && (
        <div className="space-y-8 fade-in-up">
          {/* Format Selection */}
          <div>
            <label className="text-sm font-semibold mb-3 block">Podcast Format *</label>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {PODCAST_FORMATS.map(format => {
                const Icon = format.icon;
                const isSelected = selectedFormat === format.id;
                return (
                  <button
                    key={format.id}
                    onClick={() => setSelectedFormat(format.id)}
                    className={`bento-card p-4 text-left transition-all ${
                      isSelected ? 'ring-2 ring-primary border-primary/30' : ''
                    }`}
                  >
                    <div className="flex items-center gap-3 mb-2">
                      <div className={`h-9 w-9 rounded-xl ${isSelected ? 'bg-primary/15' : 'bg-muted/60'} flex items-center justify-center transition-colors`}>
                        <Icon className={`h-4.5 w-4.5 ${isSelected ? 'text-primary' : 'text-muted-foreground/60'} transition-colors`} />
                      </div>
                      <div>
                        <p className="text-sm font-semibold">{format.label}</p>
                        <p className="text-[10px] text-muted-foreground/40">{format.duration}</p>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground/50 leading-relaxed mb-1.5">{format.description}</p>
                    <p className="text-[10px] text-primary/60 font-medium">{format.tip}</p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Tone Selection */}
          <div>
            <label className="text-sm font-semibold mb-3 block">Voice Tone *</label>
            <div className="flex flex-wrap gap-2">
              {TONE_OPTIONS.map(tone => (
                <button
                  key={tone.id}
                  onClick={() => setSelectedTone(tone.id)}
                  className={`px-4 py-2.5 rounded-xl border text-sm font-medium transition-all ${
                    selectedTone === tone.id
                      ? 'bg-foreground text-background border-foreground'
                      : 'bg-card border-border/40 hover:bg-muted/40 text-muted-foreground'
                  }`}
                >
                  <span>{tone.label}</span>
                  <span className="text-[10px] ml-1.5 opacity-50">{tone.desc}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Hook Style Selection */}
          <div>
            <label className="text-sm font-semibold mb-1 block">Hook Styles * <span className="text-muted-foreground/40 font-normal">Select up to 3</span></label>
            <p className="text-xs text-muted-foreground/40 mb-3">One script will be generated per hook style selected</p>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
              {HOOK_STYLES.map(hook => {
                const isSelected = selectedHooks.includes(hook.id);
                return (
                  <button
                    key={hook.id}
                    onClick={() => toggleHook(hook.id)}
                    className={`p-3.5 rounded-xl border text-left transition-all ${
                      isSelected
                        ? 'bg-primary/5 border-primary/30 ring-1 ring-primary/20'
                        : 'bg-card border-border/30 hover:bg-muted/30'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-sm font-medium">{hook.label}</p>
                      {isSelected && <Check className="h-4 w-4 text-primary" />}
                    </div>
                    <p className="text-[11px] text-muted-foreground/40 italic">{hook.example}</p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Generate button */}
          <div className="flex items-center gap-3">
            <Button variant="outline" onClick={() => setStep(1)} className="rounded-xl">Back</Button>
            <Button
              onClick={handleGenerate}
              disabled={!canGenerate || isGenerating}
              className="rounded-xl gap-2 px-6"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Generating {selectedHooks.length} scripts...
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" />
                  Generate {selectedHooks.length} Podcast Script{selectedHooks.length > 1 ? 's' : ''}
                </>
              )}
            </Button>
          </div>
        </div>
      )}

      {/* Step 3: Results */}
      {step === 3 && (
        <div className="space-y-6 fade-in-up">
          {scripts.length === 0 ? (
            <div className="text-center py-16">
              <Headphones className="h-12 w-12 mx-auto text-muted-foreground/20 mb-4" />
              <p className="text-muted-foreground/60 font-medium">No scripts generated yet</p>
              <Button variant="outline" onClick={() => setStep(2)} className="mt-4 rounded-xl">
                Go to Script Style
              </Button>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold">{scripts.length} Script{scripts.length > 1 ? 's' : ''} Generated</h2>
                  <p className="text-xs text-muted-foreground/40">Click to copy. Each script uses a different hook style.</p>
                </div>
                <Button variant="outline" onClick={() => setStep(2)} className="rounded-xl gap-2">
                  <RotateCcw className="h-3.5 w-3.5" />
                  Generate More
                </Button>
              </div>

              <div className="space-y-4">
                {scripts.map((script) => {
                  const formatData = PODCAST_FORMATS.find(f => f.id === script.format);
                  const hookData = HOOK_STYLES.find(h => h.id === script.hookStyle);
                  const toneData = TONE_OPTIONS.find(t => t.id === script.tone);
                  return (
                    <div key={script.id} className="apple-surface p-6 space-y-4">
                      {/* Script header */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Badge className="bg-orange-500/10 text-orange-600 border-orange-500/20 rounded-lg text-[10px] font-semibold">
                            {formatData?.label}
                          </Badge>
                          <Badge variant="outline" className="rounded-lg text-[10px]">{hookData?.label}</Badge>
                          <Badge variant="outline" className="rounded-lg text-[10px]">{toneData?.label}</Badge>
                          <span className="text-[10px] text-muted-foreground/40 flex items-center gap-1">
                            <Clock className="h-3 w-3" /> {script.duration}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 rounded-lg gap-1.5 text-xs"
                            onClick={() => copyScript(script)}
                          >
                            {copiedId === script.id ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
                            {copiedId === script.id ? 'Copied' : 'Copy'}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className={`h-8 rounded-lg gap-1.5 text-xs ${savedIds.has(script.id) ? 'text-amber-500' : ''}`}
                            onClick={() => {
                              setSavedIds(prev => { const next = new Set(prev); next.add(script.id); return next; });
                              toast.success('Script saved');
                            }}
                          >
                            <Star className={`h-3.5 w-3.5 ${savedIds.has(script.id) ? 'fill-amber-500' : ''}`} />
                            Save
                          </Button>
                        </div>
                      </div>

                      {/* Hook */}
                      <div className="p-4 rounded-xl bg-orange-500/[0.04] border border-orange-500/10">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-orange-500/60 mb-1.5">Hook</p>
                        <p className="text-sm font-medium leading-relaxed">{script.hook}</p>
                      </div>

                      {/* Body */}
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/40 mb-1.5">Body</p>
                        <p className="text-sm text-muted-foreground/80 leading-relaxed whitespace-pre-wrap">{script.body}</p>
                      </div>

                      {/* CTA */}
                      <div className="p-4 rounded-xl bg-primary/[0.04] border border-primary/10">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-primary/60 mb-1.5">Call to Action</p>
                        <p className="text-sm font-medium leading-relaxed">{script.cta}</p>
                      </div>

                      {/* Speaker Notes */}
                      {script.speakerNotes && (
                        <div className="flex items-start gap-2 p-3 rounded-xl bg-muted/30 border border-border/20">
                          <Volume2 className="h-4 w-4 text-muted-foreground/40 mt-0.5 flex-shrink-0" />
                          <div>
                            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/40 mb-0.5">Delivery Notes</p>
                            <p className="text-xs text-muted-foreground/60 leading-relaxed">{script.speakerNotes}</p>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
