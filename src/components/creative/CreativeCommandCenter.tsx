import { useState } from 'react';
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
  Workflow,
  Lightbulb,
  Users,
  Share2,
  CheckCircle2,
  Send,
  Plus,
  Search,
  Command,
  Mic,
  Video,
} from 'lucide-react';
import { useClients } from '@/hooks/useClients';
import { useAllCreatives } from '@/hooks/useAllCreatives';

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

const AI_TOOLS = [
  { id: 'ai-scripts', label: 'AI Script Writer', description: 'Generate DR scripts from offers & angles', icon: PenTool, gradient: 'from-violet-500 to-purple-600', bgLight: 'bg-violet-500/10', iconColor: 'text-violet-500', tag: 'Most Used' },
  { id: 'podcast-ads', label: 'Podcast Ads', description: 'Host-read clips & audio-first video ads', icon: Headphones, gradient: 'from-orange-500 to-amber-600', bgLight: 'bg-orange-500/10', iconColor: 'text-orange-500', tag: 'New' },
  { id: 'hyper-realistic', label: 'Hyper-Realistic', description: 'Photorealistic AI imagery for ads', icon: Camera, gradient: 'from-cyan-500 to-blue-600', bgLight: 'bg-cyan-500/10', iconColor: 'text-cyan-500', tag: 'Popular' },
  { id: 'direct-response', label: 'DR Toolkit', description: 'Hooks, headlines, CTAs & winning copy', icon: Target, gradient: 'from-rose-500 to-pink-600', bgLight: 'bg-rose-500/10', iconColor: 'text-rose-500', tag: 'Essential' },
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

export function CreativeCommandCenter({ onNavigate, statusCounts }: CommandCenterProps) {
  const { data: clients = [] } = useClients();
  const [selectedClient, setSelectedClient] = useState<string>('all');

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
      {/* Hero — Apple keynote style */}
      <div className="creative-hero-v2 p-10 md:p-14">
        <div className="relative z-10">
          {/* Top bar */}
          <div className="flex items-center justify-between mb-12">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-2xl bg-white/10 backdrop-blur-md flex items-center justify-center border border-white/[0.08]">
                <Sparkles className="h-5 w-5 text-white/90" />
              </div>
              <div>
                <span className="text-sm font-semibold text-white/80 tracking-wide block">Creative Studio</span>
                <span className="text-[11px] text-white/25">AI-Powered Creative Operations</span>
              </div>
            </div>
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

          {/* Headline */}
          <h1 className="text-4xl md:text-[56px] font-bold tracking-[-0.04em] text-white leading-[1.05] mb-4">
            Create. Optimize.
            <br />
            <span className="gradient-text-vibrant">Launch faster.</span>
          </h1>
          <p className="text-[15px] text-white/30 max-w-md leading-relaxed font-normal">
            AI-powered creative tools for agencies and brands. Scripts, visuals, podcasts, and direct response — all in one studio.
          </p>

          {/* Pipeline counters — bento strip */}
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
        <div className="absolute top-[-15%] right-[-8%] w-[500px] h-[500px] rounded-full bg-gradient-to-br from-violet-500/10 via-blue-500/5 to-transparent blur-3xl pointer-events-none" />
        <div className="absolute bottom-[-25%] left-[10%] w-[400px] h-[400px] rounded-full bg-gradient-to-tr from-cyan-500/6 via-blue-500/3 to-transparent blur-3xl pointer-events-none" />
      </div>

      {/* Needs Attention — contextual banner */}
      {(statusCounts.pending > 0 || statusCounts.revisions > 0) && (
        <div className="apple-surface p-5">
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

      {/* AI Creative Tools — bento grid */}
      <div>
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2.5">
            <div className="h-7 w-7 rounded-xl bg-gradient-to-br from-violet-500/15 to-blue-500/15 flex items-center justify-center">
              <Zap className="h-4 w-4 text-violet-500" />
            </div>
            <h2 className="text-lg font-semibold tracking-tight">AI Creative Tools</h2>
          </div>
          <Badge variant="outline" className="text-[11px] font-medium gap-1.5 px-3 py-1 rounded-full border-border/40">
            <Sparkles className="h-3 w-3" /> Powered by AI
          </Badge>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {AI_TOOLS.map(tool => {
            const Icon = tool.icon;
            return (
              <button
                key={tool.id}
                onClick={() => onNavigate(tool.id)}
                className="bento-card group text-left p-5 relative overflow-hidden"
              >
                <div className="flex items-center justify-between mb-5">
                  <div className={`h-11 w-11 rounded-2xl ${tool.bgLight} flex items-center justify-center group-hover:scale-110 transition-transform duration-300`}>
                    <Icon className={`h-5 w-5 ${tool.iconColor}`} />
                  </div>
                  <Badge className="bg-muted/60 text-muted-foreground border-0 text-[9px] font-semibold">
                    {tool.tag}
                  </Badge>
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
            { id: 'new-campaign', label: 'New Campaign', desc: 'Brief → Script → Creative → Review → Launch', icon: Rocket, color: 'text-violet-500', bg: 'bg-violet-500/10', nav: 'briefs', steps: ['Brief', 'Script', 'Creative', 'Review', 'Launch'] },
            { id: 'quick-ad', label: 'Quick Ad', desc: 'Go straight to generating — skip the brief', icon: Zap, color: 'text-amber-500', bg: 'bg-amber-500/10', nav: 'ai-scripts', steps: ['Client', 'Tool', 'Generate', 'Export'] },
            { id: 'batch-refresh', label: 'Batch Refresh', desc: 'Refresh existing campaigns at scale', icon: Wand2, color: 'text-cyan-500', bg: 'bg-cyan-500/10', nav: 'batch-video', steps: ['Campaign', 'Variations', 'Batch', 'Review'] },
          ].map(flow => {
            const Icon = flow.icon;
            return (
              <button key={flow.id} onClick={() => onNavigate(flow.nav)} className="bento-card group p-5 text-left">
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

      {/* Create + Research — Apple two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
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
                    <Icon className="h-4.5 w-4.5 text-muted-foreground/60 group-hover:text-primary transition-colors" />
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

        {/* Research + Manage column */}
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
      </div>

      {/* Tips — streamlined */}
      <div className="apple-surface p-6">
        <div className="flex items-center gap-2 mb-4">
          <Lightbulb className="h-4 w-4 text-amber-500" />
          <span className="text-sm font-semibold">Quick Tips</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {[
            { icon: Target, color: 'text-blue-500', bg: 'bg-blue-500/10', title: 'Hook-First Strategy', tip: 'The hook determines 80% of ad performance. Test 5+ hooks per winning body copy.' },
            { icon: TrendingUp, color: 'text-emerald-500', bg: 'bg-emerald-500/10', title: 'UGC Outperforms 2:1', tip: 'Native UGC-style beats polished ads on Meta and TikTok. Use AI avatars for scale.' },
            { icon: Headphones, color: 'text-violet-500', bg: 'bg-violet-500/10', title: 'Podcast Ads Rising', tip: 'Podcast-style clips are the #1 rising format. Host-read authenticity converts.' },
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
    </div>
  );
}
