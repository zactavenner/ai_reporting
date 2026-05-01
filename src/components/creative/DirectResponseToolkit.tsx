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
  Target,
  Sparkles,
  Copy,
  Check,
  Loader2,
  RotateCcw,
  Star,
  ArrowRight,
  ChevronRight,
  Zap,
  Megaphone,
  TrendingUp,
  Heart,
  Shield,
  Clock,
  DollarSign,
  AlertTriangle,
  Lightbulb,
  FileText,
  Download,
  Eye,
  Layers,
  Save,
  Play,
  Hash,
  Type,
  MessageSquare,
  ChevronDown,
  PenTool,
} from 'lucide-react';
import { useClients } from '@/hooks/useClients';
import { useClientOffers } from '@/hooks/useClientOffers';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

const DR_MODULES = [
  { id: 'hooks', label: 'Hooks', icon: Zap, description: 'Scroll-stopping opening lines', color: 'text-amber-500', bg: 'bg-amber-500/10' },
  { id: 'headlines', label: 'Headlines', icon: Type, description: 'Primary text & headline variations', color: 'text-blue-500', bg: 'bg-blue-500/10' },
  { id: 'ctas', label: 'CTAs', icon: Megaphone, description: 'Calls to action that convert', color: 'text-emerald-500', bg: 'bg-emerald-500/10' },
  { id: 'full-copy', label: 'Full Ad Copy', icon: FileText, description: 'Complete ad scripts with angles', color: 'text-violet-500', bg: 'bg-violet-500/10' },
  { id: 'angles', label: 'Angle Finder', icon: Target, description: 'Discover winning marketing angles', color: 'text-rose-500', bg: 'bg-rose-500/10' },
  { id: 'email', label: 'Email Sequences', icon: MessageSquare, description: 'Follow-up email copy', color: 'text-cyan-500', bg: 'bg-cyan-500/10' },
];

const MARKETING_ANGLES = [
  { id: 'pain-agitate-solve', label: 'Pain-Agitate-Solve', icon: AlertTriangle, description: 'Identify pain, amplify it, present the solution', iconColor: 'text-red-500', iconBg: 'bg-red-500/10' },
  { id: 'social-proof', label: 'Social Proof', icon: Heart, description: 'Leverage testimonials and results', iconColor: 'text-pink-500', iconBg: 'bg-pink-500/10' },
  { id: 'urgency-scarcity', label: 'Urgency & Scarcity', icon: Clock, description: 'Time-limited and exclusive access', iconColor: 'text-amber-500', iconBg: 'bg-amber-500/10' },
  { id: 'authority', label: 'Authority', icon: Shield, description: 'Expert positioning and trust', iconColor: 'text-blue-500', iconBg: 'bg-blue-500/10' },
  { id: 'roi-logic', label: 'ROI & Logic', icon: DollarSign, description: 'Numbers-driven investment case', iconColor: 'text-emerald-500', iconBg: 'bg-emerald-500/10' },
  { id: 'story-hook', label: 'Story Hook', icon: Megaphone, description: 'Personal narrative that pulls them in', iconColor: 'text-violet-500', iconBg: 'bg-violet-500/10' },
  { id: 'contrarian', label: 'Contrarian Take', icon: TrendingUp, description: 'Challenge conventional wisdom', iconColor: 'text-orange-500', iconBg: 'bg-orange-500/10' },
  { id: 'curiosity-gap', label: 'Curiosity Gap', icon: Zap, description: 'Create irresistible need to know', iconColor: 'text-cyan-500', iconBg: 'bg-cyan-500/10' },
];

const PLATFORMS = [
  { id: 'meta', label: 'Meta (FB/IG)' },
  { id: 'youtube', label: 'YouTube' },
  { id: 'tiktok', label: 'TikTok' },
  { id: 'linkedin', label: 'LinkedIn' },
  { id: 'google', label: 'Google Ads' },
  { id: 'email', label: 'Email' },
];

interface GeneratedContent {
  id: string;
  type: string;
  angle: string;
  platform: string;
  items: { text: string; label?: string }[];
}

export function DirectResponseToolkit() {
  const { data: clients = [] } = useClients();
  const [clientId, setClientId] = useState('');
  const { data: offers = [] } = useClientOffers(clientId);
  const [offerId, setOfferId] = useState('');
  const [activeModule, setActiveModule] = useState('hooks');
  const [selectedAngles, setSelectedAngles] = useState<string[]>([]);
  const [selectedPlatform, setSelectedPlatform] = useState('meta');
  const [offerDescription, setOfferDescription] = useState('');
  const [targetAudience, setTargetAudience] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [results, setResults] = useState<GeneratedContent[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [quantity, setQuantity] = useState('5');

  const selectedOffer = offers.find(o => o.id === offerId);

  const toggleAngle = (id: string) => {
    setSelectedAngles(prev =>
      prev.includes(id) ? prev.filter(a => a !== id) : prev.length < 4 ? [...prev, id] : prev
    );
  };

  const handleGenerate = async () => {
    if (!clientId) {
      toast.error('Select a client first');
      return;
    }

    setIsGenerating(true);
    try {
      const client = clients.find(c => c.id === clientId);
      const moduleData = DR_MODULES.find(m => m.id === activeModule);
      const angleLabels = selectedAngles.map(a => MARKETING_ANGLES.find(ma => ma.id === a)?.label).filter(Boolean);
      const platformData = PLATFORMS.find(p => p.id === selectedPlatform);

      let typeInstruction = '';
      switch (activeModule) {
        case 'hooks':
          typeInstruction = `Generate ${quantity} scroll-stopping hooks (opening lines) for ads. Each should be 1-2 sentences max. Mix styles: questions, bold claims, story openers, stat-based, and pattern interrupts.`;
          break;
        case 'headlines':
          typeInstruction = `Generate ${quantity} headline variations for ads. Include primary text (2-3 sentences) and headline (under 40 chars) for each. Optimize for ${platformData?.label}.`;
          break;
        case 'ctas':
          typeInstruction = `Generate ${quantity} call-to-action variations. Each should feel urgent but not pushy. Include both button text (under 25 chars) and supporting copy (1 sentence).`;
          break;
        case 'full-copy':
          typeInstruction = `Generate ${Math.min(parseInt(quantity), 3)} complete ad copy scripts. Each should include: hook, body (3-5 paragraphs), and CTA. Use different marketing angles for each.`;
          break;
        case 'angles':
          typeInstruction = `Analyze the offer and generate ${quantity} unique marketing angles. For each angle, provide: the angle name, why it works for this audience, a sample hook using that angle, and key talking points.`;
          break;
        case 'email':
          typeInstruction = `Generate a ${quantity}-email follow-up sequence. Each email should have: subject line, preview text, body, and CTA. Progress from awareness to urgency.`;
          break;
      }

      const prompt = `${typeInstruction}

Client: ${client?.name}
Offer: ${selectedOffer?.name || offerDescription || 'Not specified'}
${offerDescription ? `Details: ${offerDescription}` : ''}
${targetAudience ? `Audience: ${targetAudience}` : ''}
Platform: ${platformData?.label}
${angleLabels.length > 0 ? `Marketing Angles to use: ${angleLabels.join(', ')}` : ''}

Return a JSON array where each item has:
- text: The main content
- label: A short label describing the variation (e.g. "Question Hook", "Social Proof Angle")

Return ONLY the JSON array.`;

      const { data, error } = await supabase.functions.invoke('generate-ad-scripts', {
        body: { clientId, prompt, type: `dr-${activeModule}` },
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
          parsed = [{ text: data.result, label: 'Generated' }];
        }
      }

      const generated: GeneratedContent = {
        id: `dr-${Date.now()}`,
        type: activeModule,
        angle: selectedAngles.join(','),
        platform: selectedPlatform,
        items: parsed.map((p: any) => ({ text: p.text || p.content || JSON.stringify(p), label: p.label || p.name || '' })),
      };

      setResults(prev => [generated, ...prev]);
      toast.success(`${parsed.length} ${moduleData?.label?.toLowerCase()} generated`);
    } catch (err) {
      console.error(err);
      toast.error('Generation failed');
    } finally {
      setIsGenerating(false);
    }
  };

  const copyText = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
    toast.success('Copied');
  };

  return (
    <div className="space-y-8 max-w-5xl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-2xl bg-rose-500/10 flex items-center justify-center">
          <Target className="h-5 w-5 text-rose-500" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Direct Response Toolkit</h1>
          <p className="text-sm text-muted-foreground/50">Generate hooks, headlines, CTAs, and full ad copy from any offer</p>
        </div>
      </div>

      {/* Module Tabs */}
      <div className="apple-toolbar p-1.5 inline-flex gap-1">
        {DR_MODULES.map(mod => {
          const Icon = mod.icon;
          return (
            <button
              key={mod.id}
              onClick={() => setActiveModule(mod.id)}
              className={`apple-segment ${activeModule === mod.id ? '' : ''}`}
              data-active={activeModule === mod.id}
            >
              <Icon className="h-4 w-4" />
              <span>{mod.label}</span>
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
        {/* Left: Config panel */}
        <div className="lg:col-span-2 space-y-5">
          <div className="apple-surface p-5 space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Client *</label>
              <Select value={clientId} onValueChange={(v) => { setClientId(v); setOfferId(''); }}>
                <SelectTrigger className="h-10 rounded-xl"><SelectValue placeholder="Select client" /></SelectTrigger>
                <SelectContent>
                  {clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {clientId && offers.length > 0 && (
              <div className="space-y-2">
                <label className="text-sm font-medium">Offer</label>
                <Select value={offerId} onValueChange={setOfferId}>
                  <SelectTrigger className="h-10 rounded-xl"><SelectValue placeholder="Select offer" /></SelectTrigger>
                  <SelectContent>
                    {offers.map(o => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-2">
              <label className="text-sm font-medium">Offer Details</label>
              <Textarea
                value={offerDescription}
                onChange={(e) => setOfferDescription(e.target.value)}
                placeholder="Describe the product or offer..."
                className="min-h-[70px] rounded-xl resize-none text-sm"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Target Audience</label>
              <Input
                value={targetAudience}
                onChange={(e) => setTargetAudience(e.target.value)}
                placeholder="Who is this for?"
                className="h-10 rounded-xl"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <label className="text-sm font-medium">Platform</label>
                <Select value={selectedPlatform} onValueChange={setSelectedPlatform}>
                  <SelectTrigger className="h-10 rounded-xl"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PLATFORMS.map(p => <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Quantity</label>
                <Select value={quantity} onValueChange={setQuantity}>
                  <SelectTrigger className="h-10 rounded-xl"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {['3', '5', '8', '10'].map(n => <SelectItem key={n} value={n}>{n} variations</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Marketing Angles */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Marketing Angles <span className="text-muted-foreground/40 font-normal text-xs">optional, up to 4</span></label>
              <div className="grid grid-cols-2 gap-1.5">
                {MARKETING_ANGLES.map(angle => {
                  const Icon = angle.icon;
                  const isSelected = selectedAngles.includes(angle.id);
                  return (
                    <button
                      key={angle.id}
                      onClick={() => toggleAngle(angle.id)}
                      className={`flex items-center gap-2 p-2.5 rounded-xl border text-left text-xs transition-all ${
                        isSelected
                          ? 'bg-primary/5 border-primary/20'
                          : 'bg-card border-border/20 hover:bg-muted/30'
                      }`}
                    >
                      <div className={`h-6 w-6 rounded-md ${angle.iconBg} flex items-center justify-center flex-shrink-0`}>
                        <Icon className={`h-3 w-3 ${angle.iconColor}`} />
                      </div>
                      <span className="font-medium truncate">{angle.label}</span>
                      {isSelected && <Check className="h-3 w-3 text-primary ml-auto flex-shrink-0" />}
                    </button>
                  );
                })}
              </div>
            </div>

            <Button
              onClick={handleGenerate}
              disabled={!clientId || isGenerating}
              className="w-full rounded-xl gap-2 h-11"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" />
                  Generate {DR_MODULES.find(m => m.id === activeModule)?.label}
                </>
              )}
            </Button>
          </div>
        </div>

        {/* Right: Results */}
        <div className="lg:col-span-3 space-y-4">
          {results.length === 0 ? (
            <div className="text-center py-20 apple-surface">
              <Target className="h-12 w-12 mx-auto text-muted-foreground/15 mb-4" />
              <p className="text-muted-foreground/50 font-medium">No content generated yet</p>
              <p className="text-xs text-muted-foreground/30 mt-1">Configure your offer and click Generate</p>
            </div>
          ) : (
            results.map((result) => {
              const moduleData = DR_MODULES.find(m => m.id === result.type);
              const ModIcon = moduleData?.icon || Target;
              return (
                <div key={result.id} className="apple-surface p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Badge className={`${moduleData?.bg} ${moduleData?.color} border-0 rounded-lg text-[10px] font-semibold gap-1`}>
                        <ModIcon className="h-3 w-3" />
                        {moduleData?.label}
                      </Badge>
                      <Badge variant="outline" className="rounded-lg text-[10px]">
                        {PLATFORMS.find(p => p.id === result.platform)?.label}
                      </Badge>
                      <span className="text-[10px] text-muted-foreground/30">{result.items.length} variations</span>
                    </div>
                  </div>

                  <div className="space-y-2">
                    {result.items.map((item, idx) => {
                      const itemId = `${result.id}-${idx}`;
                      return (
                        <div
                          key={idx}
                          className="group p-4 rounded-xl bg-muted/20 border border-border/20 hover:bg-muted/30 transition-colors"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex-1 min-w-0">
                              {item.label && (
                                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/40 mb-1">{item.label}</p>
                              )}
                              <p className="text-sm leading-relaxed whitespace-pre-wrap">{item.text}</p>
                            </div>
                            <div className="flex items-center gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 w-7 p-0 rounded-lg"
                                onClick={() => copyText(item.text, itemId)}
                              >
                                {copiedId === itemId ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className={`h-7 w-7 p-0 rounded-lg ${savedIds.has(itemId) ? 'text-amber-500' : ''}`}
                                onClick={() => {
                                  setSavedIds(prev => { const next = new Set(prev); next.add(itemId); return next; });
                                  toast.success('Saved');
                                }}
                              >
                                <Star className={`h-3.5 w-3.5 ${savedIds.has(itemId) ? 'fill-amber-500' : ''}`} />
                              </Button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
