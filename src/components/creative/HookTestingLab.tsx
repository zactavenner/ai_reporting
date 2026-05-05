import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Zap,
  Copy,
  Star,
  TrendingUp,
  Sparkles,
  ArrowRight,
  RotateCw,
  Target,
  Lightbulb,
  CheckCircle2,
  ChevronRight,
  Play,
  Pause,
  FileText,
  BarChart3,
  Shuffle,
  Lock,
  Unlock,
  FlaskConical,
} from 'lucide-react';
import { useClients } from '@/hooks/useClients';
import { toast } from 'sonner';

interface HookVariation {
  id: string;
  text: string;
  type: string;
  score: number;
  reasoning: string;
}

const HOOK_TYPES = [
  { id: 'question', label: 'Question Hook', desc: 'Opens with a provocative question', icon: '?' },
  { id: 'bold-claim', label: 'Bold Claim', desc: 'Starts with a surprising statement', icon: '!' },
  { id: 'story', label: 'Story Opener', desc: 'Begins with a micro-narrative', icon: '~' },
  { id: 'stat-shock', label: 'Stat / Shock', desc: 'Leads with a surprising data point', icon: '#' },
  { id: 'contrarian', label: 'Contrarian', desc: 'Challenges conventional wisdom', icon: 'X' },
  { id: 'personal', label: 'Personal Reveal', desc: 'Starts with an intimate confession', icon: '@' },
  { id: 'pattern-interrupt', label: 'Pattern Interrupt', desc: 'Breaks expected scroll behavior', icon: '/' },
  { id: 'fear-based', label: 'Fear / FOMO', desc: 'Creates urgency or fear of missing out', icon: '!' },
];

const PLATFORMS = [
  { id: 'meta', label: 'Meta Ads' },
  { id: 'tiktok', label: 'TikTok' },
  { id: 'youtube', label: 'YouTube' },
  { id: 'google', label: 'Google Ads' },
];

const SAMPLE_HOOKS: HookVariation[] = [
  { id: '1', text: "I spent $2.3M on ads last year and this one change doubled my ROAS overnight...", type: 'personal', score: 94, reasoning: 'Specific dollar amount creates credibility. "One change" implies simplicity. Strong curiosity gap.' },
  { id: '2', text: "Stop scrolling if you've ever felt like your ads are burning money for no reason.", type: 'pattern-interrupt', score: 91, reasoning: 'Direct address stops the scroll. Pain point identification creates instant relevance.' },
  { id: '3', text: "97% of advertisers make this mistake in the first 3 seconds of their ad.", type: 'stat-shock', score: 88, reasoning: 'Statistical authority combined with implied exclusivity. "First 3 seconds" shows expertise.' },
  { id: '4', text: "What if everything you knew about ad creative was wrong?", type: 'contrarian', score: 85, reasoning: 'Challenges identity/expertise. Creates cognitive dissonance that demands resolution.' },
  { id: '5', text: "My client went from $50/day to $5,000/day with this creative framework.", type: 'story', score: 92, reasoning: 'Concrete before/after creates aspirational vision. "Framework" implies learnable system.' },
];

export function HookTestingLab() {
  const { data: clients = [] } = useClients();
  const [selectedClient, setSelectedClient] = useState('');
  const [bodyCopy, setBodyCopy] = useState('');
  const [offer, setOffer] = useState('');
  const [platform, setPlatform] = useState('meta');
  const [selectedTypes, setSelectedTypes] = useState<string[]>(['question', 'bold-claim', 'story']);
  const [variations, setVariations] = useState<HookVariation[]>(SAMPLE_HOOKS);
  const [generating, setGenerating] = useState(false);
  const [lockedBody, setLockedBody] = useState(true);
  const [selectedVariations, setSelectedVariations] = useState<Set<string>>(new Set());

  const toggleType = (typeId: string) => {
    setSelectedTypes(prev =>
      prev.includes(typeId) ? prev.filter(t => t !== typeId) : [...prev, typeId]
    );
  };

  const toggleVariation = (id: string) => {
    setSelectedVariations(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleGenerate = () => {
    if (!offer.trim()) {
      toast.error('Please enter your offer or product');
      return;
    }
    setGenerating(true);
    setTimeout(() => {
      setGenerating(false);
      toast.success(`Generated ${selectedTypes.length * 2} hook variations`);
    }, 2000);
  };

  const getScoreGrade = (score: number) => {
    if (score >= 90) return { grade: 'A', color: 'text-emerald-500', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20' };
    if (score >= 80) return { grade: 'B', color: 'text-blue-500', bg: 'bg-blue-500/10', border: 'border-blue-500/20' };
    if (score >= 70) return { grade: 'C', color: 'text-amber-500', bg: 'bg-amber-500/10', border: 'border-amber-500/20' };
    return { grade: 'D', color: 'text-red-500', bg: 'bg-red-500/10', border: 'border-red-500/20' };
  };

  return (
    <div className="space-y-8">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-[28px] p-8 md:p-10"
        style={{
          background: 'linear-gradient(145deg, #050508 0%, #1a0a2e 30%, #0a1628 60%, #050508 100%)'
        }}
      >
        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-6">
            <div className="h-11 w-11 rounded-2xl bg-white/[0.08] backdrop-blur-md flex items-center justify-center border border-white/[0.06]">
              <FlaskConical className="h-5 w-5 text-white/90" />
            </div>
            <div>
              <h1 className="text-2xl md:text-3xl font-bold text-white tracking-tight">Hook Testing Lab</h1>
              <p className="text-sm text-white/30">Generate, score, and A/B test hook variations against the same body copy</p>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4 mt-8">
            <div className="glass-panel rounded-2xl p-4 text-center">
              <p className="text-2xl font-bold text-white/90 tabular-nums">{variations.length}</p>
              <p className="text-[10px] font-semibold text-white/25 uppercase tracking-wider mt-1">Variations</p>
            </div>
            <div className="glass-panel rounded-2xl p-4 text-center">
              <p className="text-2xl font-bold text-emerald-400 tabular-nums">
                {variations.length > 0 ? Math.max(...variations.map(v => v.score)) : 0}
              </p>
              <p className="text-[10px] font-semibold text-white/25 uppercase tracking-wider mt-1">Top Score</p>
            </div>
            <div className="glass-panel rounded-2xl p-4 text-center">
              <p className="text-2xl font-bold text-white/90 tabular-nums">{selectedTypes.length}</p>
              <p className="text-[10px] font-semibold text-white/25 uppercase tracking-wider mt-1">Hook Types</p>
            </div>
          </div>
        </div>
        <div className="absolute top-[-20%] right-[-10%] w-[400px] h-[400px] rounded-full bg-gradient-to-br from-violet-500/15 via-purple-500/5 to-transparent blur-3xl pointer-events-none" />
        <div className="absolute bottom-[-30%] left-[5%] w-[300px] h-[300px] rounded-full bg-gradient-to-tr from-blue-500/10 via-cyan-500/5 to-transparent blur-3xl pointer-events-none" />
      </div>

      {/* Configuration + Results */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Configuration */}
        <div className="lg:col-span-4 space-y-5">
          <div className="liquid-glass p-5 space-y-4">
            <div className="flex items-center gap-2 mb-1">
              <Target className="h-4 w-4 text-primary" />
              <span className="text-sm font-semibold">Setup</span>
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground/60 mb-1.5 block">Client</label>
              <Select value={selectedClient} onValueChange={setSelectedClient}>
                <SelectTrigger className="rounded-xl text-sm">
                  <SelectValue placeholder="Select client..." />
                </SelectTrigger>
                <SelectContent>
                  {clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground/60 mb-1.5 block">Offer / Product</label>
              <Textarea
                value={offer}
                onChange={e => setOffer(e.target.value)}
                placeholder="Describe your offer, product, or service..."
                className="rounded-xl resize-none text-sm min-h-[80px]"
              />
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground/60 mb-1.5 block">Platform</label>
              <Select value={platform} onValueChange={setPlatform}>
                <SelectTrigger className="rounded-xl text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PLATFORMS.map(p => <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-medium text-muted-foreground/60">Body Copy (locked)</label>
                <button
                  onClick={() => setLockedBody(!lockedBody)}
                  className="flex items-center gap-1 text-[10px] text-muted-foreground/40 hover:text-foreground transition-colors"
                >
                  {lockedBody ? <Lock className="h-3 w-3" /> : <Unlock className="h-3 w-3" />}
                  {lockedBody ? 'Locked' : 'Unlocked'}
                </button>
              </div>
              <Textarea
                value={bodyCopy}
                onChange={e => setBodyCopy(e.target.value)}
                placeholder="Paste your winning body copy here. All hooks will be tested against this same body..."
                className="rounded-xl resize-none text-sm min-h-[100px]"
                readOnly={lockedBody && bodyCopy.length > 0}
              />
              <p className="text-[10px] text-muted-foreground/30 mt-1.5">
                Lock body copy to test hooks in isolation — the key to finding winners.
              </p>
            </div>
          </div>

          {/* Hook Types */}
          <div className="liquid-glass p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Lightbulb className="h-4 w-4 text-amber-500" />
                <span className="text-sm font-semibold">Hook Types</span>
              </div>
              <Badge variant="outline" className="text-[10px] rounded-full px-2">
                {selectedTypes.length} selected
              </Badge>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {HOOK_TYPES.map(type => (
                <button
                  key={type.id}
                  onClick={() => toggleType(type.id)}
                  className={`text-left p-2.5 rounded-xl border text-xs transition-all duration-200 ${
                    selectedTypes.includes(type.id)
                      ? 'bg-primary/[0.08] border-primary/20 text-foreground'
                      : 'border-border/30 text-muted-foreground/60 hover:bg-muted/30'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className={`h-5 w-5 rounded-md flex items-center justify-center text-[10px] font-bold ${
                      selectedTypes.includes(type.id) ? 'bg-primary/15 text-primary' : 'bg-muted/60 text-muted-foreground/40'
                    }`}>
                      {type.icon}
                    </span>
                    <span className="font-medium truncate">{type.label}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          <Button
            onClick={handleGenerate}
            disabled={generating}
            className="w-full rounded-2xl h-12 text-sm font-semibold gap-2"
          >
            {generating ? (
              <>
                <RotateCw className="h-4 w-4 animate-spin" />
                Generating {selectedTypes.length * 2} variations...
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" />
                Generate Hook Variations
              </>
            )}
          </Button>
        </div>

        {/* Right: Results */}
        <div className="lg:col-span-8 space-y-4">
          {/* Results toolbar */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold">Hook Variations</h3>
              <Badge variant="outline" className="text-[10px] rounded-full">{variations.length} results</Badge>
            </div>
            <div className="flex items-center gap-2">
              {selectedVariations.size > 0 && (
                <Button variant="outline" size="sm" className="rounded-xl gap-1.5 text-xs h-8">
                  <FileText className="h-3 w-3" />
                  Export {selectedVariations.size} to Brief
                </Button>
              )}
              <Button variant="ghost" size="sm" className="rounded-xl gap-1.5 text-xs h-8 text-muted-foreground/60">
                <Shuffle className="h-3 w-3" />
                Shuffle
              </Button>
            </div>
          </div>

          {/* Variation Cards */}
          <div className="space-y-3">
            {variations
              .sort((a, b) => b.score - a.score)
              .map((variation, idx) => {
                const grade = getScoreGrade(variation.score);
                const hookType = HOOK_TYPES.find(t => t.id === variation.type);
                return (
                  <div
                    key={variation.id}
                    className={`group bento-card-v2 p-5 cursor-pointer transition-all duration-200 ${
                      selectedVariations.has(variation.id) ? 'ring-2 ring-primary/30 border-primary/20' : ''
                    }`}
                    onClick={() => toggleVariation(variation.id)}
                  >
                    <div className="flex items-start gap-4">
                      {/* Rank */}
                      <div className="flex flex-col items-center gap-1.5 flex-shrink-0">
                        <span className={`text-lg font-bold tabular-nums ${idx === 0 ? 'text-amber-500' : idx === 1 ? 'text-slate-400' : idx === 2 ? 'text-amber-700' : 'text-muted-foreground/30'}`}>
                          #{idx + 1}
                        </span>
                        <div className={`h-8 w-8 rounded-lg ${grade.bg} ${grade.border} border flex items-center justify-center`}>
                          <span className={`text-sm font-bold ${grade.color}`}>{grade.grade}</span>
                        </div>
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-2">
                          <Badge variant="outline" className="text-[9px] rounded-full px-2 py-0.5">
                            {hookType?.label || variation.type}
                          </Badge>
                          <div className={`perf-score ${variation.score >= 90 ? 'perf-score-high' : variation.score >= 80 ? 'perf-score-mid' : 'perf-score-low'}`}>
                            <TrendingUp className="h-3 w-3" />
                            {variation.score}
                          </div>
                        </div>
                        <p className="text-sm font-medium leading-relaxed mb-2">
                          "{variation.text}"
                        </p>
                        <div className="flex items-start gap-2 p-2.5 rounded-xl bg-muted/30 border border-border/20">
                          <Lightbulb className="h-3.5 w-3.5 text-amber-500 flex-shrink-0 mt-0.5" />
                          <p className="text-[11px] text-muted-foreground/60 leading-relaxed">{variation.reasoning}</p>
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex flex-col gap-1.5 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0 rounded-lg" onClick={e => { e.stopPropagation(); navigator.clipboard.writeText(variation.text); toast.success('Copied!'); }}>
                          <Copy className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0 rounded-lg" onClick={e => e.stopPropagation()}>
                          <Star className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0 rounded-lg" onClick={e => { e.stopPropagation(); toast.success('Iterating...'); }}>
                          <RotateCw className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
          </div>

          {variations.length === 0 && (
            <div className="bento-card-v2 p-12 text-center">
              <FlaskConical className="h-12 w-12 text-muted-foreground/20 mx-auto mb-4" />
              <p className="text-sm font-medium text-muted-foreground/60">No hooks generated yet</p>
              <p className="text-xs text-muted-foreground/40 mt-1">Configure your setup and hit generate to start testing</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
