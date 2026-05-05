import { useState, useEffect, useCallback, useRef } from 'react';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sparkles,
  Upload,
  FileText,
  Image,
  Film,
  Wand2,
  User,
  Radar,
  Instagram,
  Scissors,
  Trophy,
  Palette,
  History,
  Download,
  Calendar,
  BarChart3,
  Headphones,
  Camera,
  Target,
  TrendingUp,
  Clock,
  Rocket,
  ArrowRight,
  Zap,
  PenTool,
  Globe,
  Play,
  Eye,
  ChevronRight,
  Star,
  Layers,
  Monitor,
  ArrowUpRight,
  Lightbulb,
  Users,
  Share2,
  CheckCircle2,
  Search,
  Command,
  Video,
  X,
  MessageSquare,
  Activity,
  Workflow,
} from 'lucide-react';
import { useClients } from '@/hooks/useClients';
import { useAllCreatives } from '@/hooks/useAllCreatives';
import { formatDistanceToNow } from 'date-fns';

interface CommandCenterProps {
  onNavigate: (section: string) => void;
  statusCounts: {
    all: number;
    pending: number;
    approved: number;
    launched: number;
    revisions: number;
    rejected: number;
  };
}

const ALL_SECTIONS = [
  { id: 'ai-scripts', label: 'AI Script Writer', description: 'Generate DR scripts from offers & angles', icon: PenTool, keywords: ['script', 'write', 'copy', 'angle', 'dr', 'direct response'] },
  { id: 'podcast-ads', label: 'Podcast Ads', description: 'Host-read clips & audio-first video ads', icon: Headphones, keywords: ['podcast', 'audio', 'host', 'read', 'clip'] },
  { id: 'hyper-realistic', label: 'Hyper-Realistic Ads', description: 'Photorealistic AI imagery for ads', icon: Camera, keywords: ['realistic', 'photo', 'image', 'visual', 'hyper'] },
  { id: 'direct-response', label: 'DR Toolkit', description: 'Hooks, headlines, CTAs & winning copy', icon: Target, keywords: ['hook', 'headline', 'cta', 'copy', 'direct', 'response'] },
  { id: 'hook-testing', label: 'Hook Testing Lab', description: 'A/B test hook variations against locked body copy', icon: Zap, keywords: ['hook', 'test', 'ab', 'variation', 'split', 'lab'] },
  { id: 'library', label: 'Creative Library', description: 'Organize creatives into folders & boards', icon: Layers, keywords: ['library', 'folder', 'board', 'organize', 'collection', 'swipe'] },
  { id: 'client-share', label: 'Client Portal', description: 'Zero-friction review links for clients', icon: Share2, keywords: ['share', 'client', 'link', 'review', 'portal', 'approve'] },
  { id: 'approvals', label: 'Review & Approve', description: 'Manage creative approvals', icon: CheckCircle2, keywords: ['approve', 'review', 'pending', 'status'] },
  { id: 'briefs', label: 'Briefs & Scripts', description: 'Creative briefs and campaign planning', icon: FileText, keywords: ['brief', 'plan', 'campaign', 'strategy'] },
  { id: 'static-ads', label: 'Static Ads', description: 'AI-generated image ads', icon: Image, keywords: ['static', 'image', 'banner', 'display'] },
  { id: 'batch-video', label: 'Batch Video', description: 'Generate video ads at scale', icon: Film, keywords: ['batch', 'video', 'scale', 'bulk'] },
  { id: 'ad-variations', label: 'Ad Variations', description: 'A/B test creative variations', icon: Wand2, keywords: ['variation', 'ab', 'test', 'split'] },
  { id: 'avatars', label: 'AI Avatars', description: 'Digital presenters & spokespeople', icon: User, keywords: ['avatar', 'presenter', 'spokesperson', 'digital'] },
  { id: 'broll', label: 'B-Roll Library', description: 'AI-generated stock footage', icon: Video, keywords: ['broll', 'stock', 'footage', 'background'] },
  { id: 'video-editor', label: 'Video Editor', description: 'Edit, trim & compose video', icon: Scissors, keywords: ['edit', 'trim', 'cut', 'compose', 'video'] },
  { id: 'ad-scraping', label: 'Ad Spy', description: 'Research competitor creatives', icon: Radar, keywords: ['spy', 'scrape', 'competitor', 'research'] },
  { id: 'instagram-intel', label: 'Instagram Intel', description: 'Analyze trending content', icon: Instagram, keywords: ['instagram', 'ig', 'trend', 'social'] },
  { id: 'winning-ads', label: 'Winning Ads', description: 'Top-performing ad gallery', icon: Trophy, keywords: ['winning', 'top', 'best', 'performer'] },
  { id: 'platform-intel', label: 'Platform Intel', description: 'Best practices by platform', icon: Globe, keywords: ['platform', 'best practice', 'guide'] },
  { id: 'client-review', label: 'Internal Review', description: 'Internal team review workflow', icon: Eye, keywords: ['internal', 'team', 'review', 'workflow'] },
  { id: 'manage-styles', label: 'Brand Styles', description: 'Manage brand kits & styles', icon: Palette, keywords: ['style', 'brand', 'kit', 'color'] },
  { id: 'calendar', label: 'Creative Calendar', description: 'Timeline & scheduling', icon: Calendar, keywords: ['calendar', 'schedule', 'timeline', 'date'] },
  { id: 'history', label: 'History', description: 'View past generations', icon: History, keywords: ['history', 'past', 'previous', 'log'] },
  { id: 'export', label: 'Export Hub', description: 'Batch download & export', icon: Download, keywords: ['export', 'download', 'zip', 'batch'] },
  { id: 'analytics', label: 'Analytics', description: 'Creative performance metrics', icon: BarChart3, keywords: ['analytics', 'metrics', 'performance', 'data'] },
];

const AI_TOOLS = [
  { id: 'ai-scripts', label: 'AI Script Writer', description: 'Generate DR scripts from offers & angles', icon: PenTool, gradient: 'from-blue-500 to-indigo-600', bgLight: 'bg-blue-500/10', iconColor: 'text-blue-500', tag: 'Most Used', score: 92 },
  { id: 'hook-testing', label: 'Hook Testing Lab', description: 'A/B test hooks against locked body copy', icon: Zap, gradient: 'from-violet-500 to-purple-600', bgLight: 'bg-violet-500/10', iconColor: 'text-violet-500', tag: 'New', score: 96 },
  { id: 'podcast-ads', label: 'Podcast Ads', description: 'Host-read clips & audio-first video ads', icon: Headphones, gradient: 'from-orange-500 to-amber-600', bgLight: 'bg-orange-500/10', iconColor: 'text-orange-500', tag: 'Trending', score: 87 },
  { id: 'hyper-realistic', label: 'Hyper-Realistic', description: 'Photorealistic AI imagery for ads', icon: Camera, gradient: 'from-cyan-500 to-blue-600', bgLight: 'bg-cyan-500/10', iconColor: 'text-cyan-500', tag: 'Popular', score: 89 },
  { id: 'direct-response', label: 'DR Toolkit', description: 'Hooks, headlines, CTAs & winning copy', icon: Target, gradient: 'from-rose-500 to-pink-600', bgLight: 'bg-rose-500/10', iconColor: 'text-rose-500', tag: 'Essential', score: 95 },
];

const CREATE_TOOLS = [
  { id: 'briefs', label: 'Briefs', icon: FileText, description: 'Creative briefs & scripts' },
  { id: 'static-ads', label: 'Static Ads', icon: Image, description: 'AI image ads' },
  { id: 'batch-video', label: 'Batch Video', icon: Film, description: 'Video at scale' },
  { id: 'ad-variations', label: 'Variations', icon: Wand2, description: 'A/B test creatives' },
  { id: 'avatars', label: 'AI Avatars', icon: User, description: 'Digital presenters' },
  { id: 'broll', label: 'B-Roll', icon: Video, description: 'AI stock footage' },
  { id: 'video-editor', label: 'Video Editor', icon: Scissors, description: 'Edit & trim' },
];

const RESEARCH_TOOLS = [
  { id: 'ad-scraping', label: 'Ad Spy', icon: Radar, description: 'Competitor creatives' },
  { id: 'instagram-intel', label: 'IG Intel', icon: Instagram, description: 'Content analysis' },
  { id: 'winning-ads', label: 'Winners', icon: Trophy, description: 'Top performers' },
  { id: 'platform-intel', label: 'Platform Intel', icon: Globe, description: 'Best practices' },
];

function SpotlightSearch({ open, onClose, onNavigate }: { open: boolean; onClose: () => void; onNavigate: (id: string) => void }) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = query.trim()
    ? ALL_SECTIONS.filter(s =>
        s.label.toLowerCase().includes(query.toLowerCase()) ||
        s.description.toLowerCase().includes(query.toLowerCase()) ||
        s.keywords.some(k => k.includes(query.toLowerCase()))
      )
    : ALL_SECTIONS.slice(0, 8);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  useEffect(() => { setActiveIndex(0); }, [query]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIndex(i => Math.min(i + 1, results.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIndex(i => Math.max(i - 1, 0)); }
    if (e.key === 'Enter' && results[activeIndex]) { onNavigate(results[activeIndex].id); onClose(); }
    if (e.key === 'Escape') onClose();
  };

  if (!open) return null;

  return (
    <>
      <div className="spotlight-overlay" onClick={onClose} />
      <div className="spotlight-dialog">
        <div className="liquid-glass-floating overflow-hidden">
          <div className="flex items-center gap-3 px-5 border-b border-border/30">
            <Search className="h-5 w-5 text-muted-foreground/40 flex-shrink-0" />
            <input
              ref={inputRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              className="spotlight-input"
              placeholder="Search tools, actions, clients..."
            />
            <div className="flex items-center gap-1">
              <kbd className="kbd-badge">esc</kbd>
            </div>
          </div>
          <div className="max-h-[400px] overflow-y-auto p-2">
            {results.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground/50">No results found</div>
            ) : (
              <>
                {!query && <p className="px-4 py-2 text-[10px] font-semibold text-muted-foreground/40 uppercase tracking-[0.1em]">Suggested</p>}
                {results.map((item, idx) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      data-active={idx === activeIndex}
                      onClick={() => { onNavigate(item.id); onClose(); }}
                      onMouseEnter={() => setActiveIndex(idx)}
                      className="spotlight-result w-full text-left"
                    >
                      <div className="h-9 w-9 rounded-xl bg-muted/60 flex items-center justify-center flex-shrink-0">
                        <Icon className="h-4 w-4 text-muted-foreground/60" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{item.label}</p>
                        <p className="text-[11px] text-muted-foreground/40 truncate">{item.description}</p>
                      </div>
                      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/20" />
                    </button>
                  );
                })}
              </>
            )}
          </div>
          <div className="flex items-center justify-between px-5 py-2.5 border-t border-border/20 text-[10px] text-muted-foreground/30">
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1"><kbd className="kbd-badge">↑↓</kbd> navigate</span>
              <span className="flex items-center gap-1"><kbd className="kbd-badge">↵</kbd> open</span>
            </div>
            <span>Spotlight Search</span>
          </div>
        </div>
      </div>
    </>
  );
}

function ActivityFeed({ creatives }: { creatives: any[] }) {
  const recentItems = creatives
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
    .slice(0, 5);

  if (recentItems.length === 0) return null;

  const getActivityIcon = (status: string) => {
    switch (status) {
      case 'approved': return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />;
      case 'pending': return <Clock className="h-3.5 w-3.5 text-amber-500" />;
      case 'revisions': return <MessageSquare className="h-3.5 w-3.5 text-orange-500" />;
      case 'launched': return <Rocket className="h-3.5 w-3.5 text-blue-500" />;
      default: return <Activity className="h-3.5 w-3.5 text-muted-foreground/50" />;
    }
  };

  return (
    <div className="space-y-1">
      {recentItems.map(item => (
        <div key={item.id} className="flex items-center gap-3 py-2 px-3 rounded-xl hover:bg-muted/30 transition-colors">
          <div className="activity-dot bg-current flex-shrink-0" style={{ color: item.status === 'approved' ? 'rgb(16 185 129)' : item.status === 'pending' ? 'rgb(245 158 11)' : 'rgb(148 163 184)' }} />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium truncate">{item.title}</p>
            <p className="text-[10px] text-muted-foreground/40">
              {formatDistanceToNow(new Date(item.updated_at), { addSuffix: true })}
            </p>
          </div>
          {getActivityIcon(item.status)}
        </div>
      ))}
    </div>
  );
}

export function CreativeCommandCenter({ onNavigate, statusCounts }: CommandCenterProps) {
  const { data: clients = [] } = useClients();
  const { data: creatives = [] } = useAllCreatives();
  const [selectedClient, setSelectedClient] = useState<string>('all');
  const [spotlightOpen, setSpotlightOpen] = useState(false);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); setSpotlightOpen(true); }
    if ((e.metaKey || e.ctrlKey) && e.key === 'n') { e.preventDefault(); onNavigate('briefs'); }
    if ((e.metaKey || e.ctrlKey) && e.key === 'a') { e.preventDefault(); onNavigate('approvals'); }
  }, [onNavigate]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const approvalRate = statusCounts.all > 0
    ? Math.round(((statusCounts.approved + statusCounts.launched) / statusCounts.all) * 100)
    : 0;

  const pipelineStages = [
    { label: 'Draft', count: (statusCounts as any).draft || 0, color: 'bg-slate-400', ring: 'ring-slate-400/20' },
    { label: 'Pending', count: statusCounts.pending, color: 'bg-amber-400', ring: 'ring-amber-400/20', pulse: statusCounts.pending > 0 },
    { label: 'Revisions', count: statusCounts.revisions, color: 'bg-orange-400', ring: 'ring-orange-400/20', pulse: statusCounts.revisions > 0 },
    { label: 'Approved', count: statusCounts.approved, color: 'bg-emerald-400', ring: 'ring-emerald-400/20' },
    { label: 'Launched', count: statusCounts.launched, color: 'bg-blue-400', ring: 'ring-blue-400/20' },
  ];

  return (
    <div className="space-y-8">
      <SpotlightSearch open={spotlightOpen} onClose={() => setSpotlightOpen(false)} onNavigate={onNavigate} />

      {/* Hero — Gradient Mesh */}
      <div className="gradient-mesh-hero p-10 md:p-14">
        <div className="relative z-10">
          {/* Top bar */}
          <div className="flex items-center justify-between mb-10">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-2xl bg-white/[0.08] backdrop-blur-md flex items-center justify-center border border-white/[0.06]">
                <Sparkles className="h-5 w-5 text-white/90" />
              </div>
              <div>
                <span className="text-sm font-semibold text-white/80 tracking-wide block">Creative Studio</span>
                <span className="text-[11px] text-white/25">AI-Powered Creative Operations</span>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setSpotlightOpen(true)}
                className="flex items-center gap-2.5 px-4 py-2 rounded-xl glass-panel hover:bg-white/[0.08] transition-all cursor-pointer group"
              >
                <Search className="h-3.5 w-3.5 text-white/40 group-hover:text-white/60 transition-colors" />
                <span className="text-xs text-white/30 group-hover:text-white/50 transition-colors">Search...</span>
                <div className="flex items-center gap-0.5 ml-4">
                  <kbd className="inline-flex items-center justify-center rounded-md bg-white/[0.06] border border-white/[0.08] px-1.5 py-0.5 text-[10px] text-white/30">
                    <Command className="h-2.5 w-2.5 mr-0.5" />K
                  </kbd>
                </div>
              </button>
              <Select value={selectedClient} onValueChange={setSelectedClient}>
                <SelectTrigger className="w-[200px] h-9 rounded-full glass-panel text-white/80 text-sm hover:bg-white/[0.08] transition-colors border-white/[0.06]">
                  <SelectValue placeholder="All Clients" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Clients</SelectItem>
                  {clients.map(client => (
                    <SelectItem key={client.id} value={client.id}>{client.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Headline */}
          <h1 className="text-4xl md:text-[56px] font-bold tracking-[-0.04em] text-white leading-[1.05] mb-4">
            Create. Optimize.
            <br />
            <span className="gradient-text-premium">Launch faster.</span>
          </h1>
          <p className="text-[15px] text-white/30 max-w-lg leading-relaxed font-normal">
            AI-powered creative tools for agencies and brands. Scripts, visuals, podcasts, and direct response — all in one studio.
          </p>

          {/* Pipeline counters */}
          <div className="mt-12 grid grid-cols-5 gap-2">
            {pipelineStages.map((stage) => (
              <button
                key={stage.label}
                onClick={() => onNavigate('approvals')}
                className="group glass-panel rounded-2xl p-4 text-center transition-all duration-300 hover:bg-white/[0.06]"
              >
                <div className="flex items-center justify-center mb-2.5">
                  <div className={`h-2 w-2 rounded-full ${stage.color} ${stage.pulse ? 'status-dot-pulse ring-4 ' + stage.ring : 'opacity-50'}`} />
                </div>
                <p className="text-2xl font-bold text-white/90 group-hover:text-white transition-colors tabular-nums">{stage.count}</p>
                <p className="text-[10px] font-semibold text-white/25 uppercase tracking-[0.1em] mt-1">{stage.label}</p>
              </button>
            ))}
          </div>

          {/* Metric pills */}
          <div className="mt-8 flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2 px-4 py-2 rounded-full glass-panel">
              <TrendingUp className="h-3.5 w-3.5 text-emerald-400" />
              <span className="text-xs font-medium text-white/60">{approvalRate}% approval</span>
            </div>
            <div className="flex items-center gap-2 px-4 py-2 rounded-full glass-panel">
              <BarChart3 className="h-3.5 w-3.5 text-blue-400" />
              <span className="text-xs font-medium text-white/60">{statusCounts.all} creatives</span>
            </div>
            <div className="flex items-center gap-2 px-4 py-2 rounded-full glass-panel">
              <Users className="h-3.5 w-3.5 text-violet-400" />
              <span className="text-xs font-medium text-white/60">{clients.length} clients</span>
            </div>
          </div>
        </div>

        {/* Ambient orbs */}
        <div className="absolute top-[-15%] right-[-8%] w-[500px] h-[500px] rounded-full bg-gradient-to-br from-blue-500/10 via-indigo-500/5 to-transparent blur-3xl pointer-events-none" />
        <div className="absolute bottom-[-25%] left-[10%] w-[400px] h-[400px] rounded-full bg-gradient-to-tr from-cyan-500/6 via-blue-500/3 to-transparent blur-3xl pointer-events-none" />
      </div>

      {/* Needs Attention */}
      {(statusCounts.pending > 0 || statusCounts.revisions > 0) && (
        <div className="liquid-glass p-5">
          <div className="flex items-center gap-2 mb-4">
            <div className="h-6 w-6 rounded-lg bg-amber-500/15 flex items-center justify-center">
              <Clock className="h-3.5 w-3.5 text-amber-500" />
            </div>
            <span className="text-sm font-semibold">Needs Attention</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {statusCounts.pending > 0 && (
              <button onClick={() => onNavigate('approvals')} className="group flex items-center gap-4 p-4 rounded-2xl bg-amber-500/[0.04] border border-amber-500/10 hover:bg-amber-500/[0.06] transition-all">
                <div className="h-10 w-10 rounded-xl bg-amber-500/10 flex items-center justify-center flex-shrink-0">
                  <Upload className="h-5 w-5 text-amber-500" />
                </div>
                <div className="text-left flex-1">
                  <p className="text-sm font-semibold">{statusCounts.pending} Pending Review</p>
                  <p className="text-[11px] text-muted-foreground/50">Creatives awaiting approval</p>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground/20 group-hover:text-amber-500 group-hover:translate-x-0.5 transition-all" />
              </button>
            )}
            {statusCounts.revisions > 0 && (
              <button onClick={() => onNavigate('approvals')} className="group flex items-center gap-4 p-4 rounded-2xl bg-orange-500/[0.04] border border-orange-500/10 hover:bg-orange-500/[0.06] transition-all">
                <div className="h-10 w-10 rounded-xl bg-orange-500/10 flex items-center justify-center flex-shrink-0">
                  <Eye className="h-5 w-5 text-orange-500" />
                </div>
                <div className="text-left flex-1">
                  <p className="text-sm font-semibold">{statusCounts.revisions} Need Revisions</p>
                  <p className="text-[11px] text-muted-foreground/50">Client feedback to address</p>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground/20 group-hover:text-orange-500 group-hover:translate-x-0.5 transition-all" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* AI Creative Tools with Performance Scores */}
      <div>
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2.5">
            <div className="h-7 w-7 rounded-xl gradient-bg-premium flex items-center justify-center">
              <Zap className="h-4 w-4 text-blue-500" />
            </div>
            <h2 className="text-lg font-semibold tracking-tight">AI Creative Tools</h2>
          </div>
          <Badge variant="outline" className="text-[11px] font-medium gap-1.5 px-3 py-1 rounded-full border-border/40">
            <Sparkles className="h-3 w-3" /> Powered by AI
          </Badge>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          {AI_TOOLS.map(tool => {
            const Icon = tool.icon;
            return (
              <button
                key={tool.id}
                onClick={() => onNavigate(tool.id)}
                className="bento-card-v2 group text-left p-5 relative overflow-hidden"
              >
                <div className="flex items-center justify-between mb-5">
                  <div className={`h-11 w-11 rounded-2xl ${tool.bgLight} flex items-center justify-center group-hover:scale-110 transition-transform duration-300`}>
                    <Icon className={`h-5 w-5 ${tool.iconColor}`} />
                  </div>
                  <div className="flex items-center gap-2">
                    <div className={`perf-score ${tool.score >= 90 ? 'perf-score-high' : 'perf-score-mid'}`}>
                      <TrendingUp className="h-3 w-3" />
                      {tool.score}
                    </div>
                  </div>
                </div>
                <h3 className="text-[15px] font-semibold mb-1">{tool.label}</h3>
                <p className="text-xs text-muted-foreground/50 leading-relaxed">{tool.description}</p>
                <div className="mt-4 flex items-center gap-1 text-xs font-medium text-primary/70 group-hover:text-primary transition-colors">
                  <span>Open</span>
                  <ArrowRight className="h-3.5 w-3.5 opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-300" />
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Quick Start Workflows */}
      <div>
        <div className="flex items-center gap-2.5 mb-5">
          <div className="h-7 w-7 rounded-xl bg-gradient-to-br from-amber-500/15 to-orange-500/15 flex items-center justify-center">
            <Workflow className="h-4 w-4 text-amber-500" />
          </div>
          <h2 className="text-lg font-semibold tracking-tight">Quick Start</h2>
          <span className="text-xs text-muted-foreground/40 ml-1">Choose your workflow</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {[
            { id: 'new-campaign', label: 'New Campaign', desc: 'Brief, Script, Creative, Review, Launch', icon: Rocket, color: 'text-blue-500', bg: 'bg-blue-500/10', nav: 'briefs', steps: ['Brief', 'Script', 'Creative', 'Review', 'Launch'] },
            { id: 'hook-test', label: 'Hook A/B Test', desc: 'Generate & score hook variations for split testing', icon: Zap, color: 'text-violet-500', bg: 'bg-violet-500/10', nav: 'hook-testing', steps: ['Offer', 'Types', 'Generate', 'Export'] },
            { id: 'client-review', label: 'Client Review', desc: 'Share creatives via zero-login review link', icon: Share2, color: 'text-emerald-500', bg: 'bg-emerald-500/10', nav: 'client-share', steps: ['Select', 'Configure', 'Share', 'Track'] },
          ].map(flow => {
            const Icon = flow.icon;
            return (
              <button key={flow.id} onClick={() => onNavigate(flow.nav)} className="bento-card-v2 group p-5 text-left">
                <div className="flex items-start justify-between mb-4">
                  <div className={`h-10 w-10 rounded-2xl ${flow.bg} flex items-center justify-center`}>
                    <Icon className={`h-5 w-5 ${flow.color}`} />
                  </div>
                  <ArrowUpRight className="h-4 w-4 text-muted-foreground/15 group-hover:text-primary group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-all duration-300" />
                </div>
                <h3 className="text-sm font-semibold mb-1">{flow.label}</h3>
                <p className="text-xs text-muted-foreground/50 leading-relaxed mb-4">{flow.desc}</p>
                <div className="flex items-center gap-1.5">
                  {flow.steps.map((step, idx) => (
                    <div key={step} className="flex items-center gap-1.5">
                      <span className="text-[9px] font-semibold text-muted-foreground/35 uppercase tracking-wider">{step}</span>
                      {idx < flow.steps.length - 1 && <ChevronRight className="h-2.5 w-2.5 text-muted-foreground/15" />}
                    </div>
                  ))}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Create + Research + Activity — Three-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-7 gap-6">
        {/* Create column */}
        <div className="lg:col-span-3">
          <div className="flex items-center gap-2 mb-4">
            <Layers className="h-4 w-4 text-muted-foreground/50" />
            <span className="section-label">Create</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {CREATE_TOOLS.map(tool => {
              const Icon = tool.icon;
              return (
                <button
                  key={tool.id}
                  onClick={() => onNavigate(tool.id)}
                  className="group flex items-center gap-3 p-3.5 rounded-2xl border border-border/30 bg-card hover:bg-muted/30 hover:border-primary/10 transition-all duration-200 text-left"
                >
                  <div className="h-9 w-9 rounded-xl bg-muted/60 flex items-center justify-center flex-shrink-0 group-hover:bg-primary/10 transition-colors">
                    <Icon className="h-4 w-4 text-muted-foreground/60 group-hover:text-primary transition-colors" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium truncate">{tool.label}</p>
                    <p className="text-[11px] text-muted-foreground/40 truncate">{tool.description}</p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Research column */}
        <div className="lg:col-span-2 space-y-6">
          <div>
            <div className="flex items-center gap-2 mb-4">
              <Eye className="h-4 w-4 text-muted-foreground/50" />
              <span className="section-label">Research</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {RESEARCH_TOOLS.map(tool => {
                const Icon = tool.icon;
                return (
                  <button
                    key={tool.id}
                    onClick={() => onNavigate(tool.id)}
                    className="group flex items-center gap-2.5 p-3 rounded-2xl border border-border/30 bg-card hover:bg-muted/30 hover:border-primary/10 transition-all duration-200 text-left"
                  >
                    <div className="h-8 w-8 rounded-lg bg-muted/60 flex items-center justify-center flex-shrink-0 group-hover:bg-primary/10 transition-colors">
                      <Icon className="h-4 w-4 text-muted-foreground/60 group-hover:text-primary transition-colors" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-[13px] font-medium truncate">{tool.label}</p>
                      <p className="text-[10px] text-muted-foreground/40 truncate">{tool.description}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <div className="flex items-center gap-2 mb-4">
              <Monitor className="h-4 w-4 text-muted-foreground/50" />
              <span className="section-label">Manage</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {[
                { id: 'manage-styles', label: 'Styles', icon: Palette },
                { id: 'calendar', label: 'Calendar', icon: Calendar },
                { id: 'history', label: 'History', icon: History },
                { id: 'export', label: 'Export', icon: Download },
                { id: 'analytics', label: 'Analytics', icon: BarChart3 },
                { id: 'client-review', label: 'Client Review', icon: Share2 },
              ].map(tool => {
                const Icon = tool.icon;
                return (
                  <button
                    key={tool.id}
                    onClick={() => onNavigate(tool.id)}
                    className="apple-pill group"
                  >
                    <Icon className="h-3.5 w-3.5 text-muted-foreground/50 group-hover:text-primary transition-colors" />
                    <span className="text-[12px] font-medium">{tool.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Activity Feed column */}
        <div className="lg:col-span-2">
          <div className="flex items-center gap-2 mb-4">
            <Activity className="h-4 w-4 text-muted-foreground/50" />
            <span className="section-label">Recent Activity</span>
          </div>
          <div className="liquid-glass-subtle border border-border/20 p-3 rounded-2xl">
            <ActivityFeed creatives={creatives} />
            {creatives.length === 0 && (
              <div className="py-8 text-center">
                <Activity className="h-8 w-8 text-muted-foreground/20 mx-auto mb-2" />
                <p className="text-xs text-muted-foreground/40">No activity yet</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Tips */}
      <div className="liquid-glass p-6">
        <div className="flex items-center gap-2 mb-4">
          <Lightbulb className="h-4 w-4 text-amber-500" />
          <span className="text-sm font-semibold">Quick Tips</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {[
            { icon: Target, color: 'text-blue-500', bg: 'bg-blue-500/10', title: 'Hook-First Strategy', tip: 'The hook determines 80% of ad performance. Use Hook Lab to test 5+ variations per winning body copy.' },
            { icon: TrendingUp, color: 'text-emerald-500', bg: 'bg-emerald-500/10', title: 'Score Before You Spend', tip: 'Every creative gets a performance score before launch. Focus budget on A-graded hooks only.' },
            { icon: Headphones, color: 'text-violet-500', bg: 'bg-violet-500/10', title: 'Podcast Ads Rising', tip: 'Podcast-style clips are the #1 rising format. Host-read authenticity converts 3x better.' },
          ].map(tip => {
            const Icon = tip.icon;
            return (
              <div key={tip.title} className="flex items-start gap-3 p-3 rounded-xl bg-muted/20 border border-border/20">
                <div className={`h-8 w-8 rounded-lg ${tip.bg} flex items-center justify-center flex-shrink-0 mt-0.5`}>
                  <Icon className={`h-4 w-4 ${tip.color}`} />
                </div>
                <div>
                  <p className="text-xs font-semibold mb-0.5">{tip.title}</p>
                  <p className="text-[11px] text-muted-foreground/50 leading-relaxed">{tip.tip}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Keyboard shortcuts hint */}
      <div className="flex items-center justify-center gap-6 py-2 text-[10px] text-muted-foreground/25">
        <span className="flex items-center gap-1.5"><kbd className="kbd-badge"><Command className="h-2 w-2 inline" />K</kbd> Search</span>
        <span className="flex items-center gap-1.5"><kbd className="kbd-badge"><Command className="h-2 w-2 inline" />N</kbd> New Brief</span>
        <span className="flex items-center gap-1.5"><kbd className="kbd-badge"><Command className="h-2 w-2 inline" />A</kbd> Approvals</span>
      </div>
    </div>
  );
}
