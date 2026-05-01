import { useState, lazy, Suspense } from 'react';
import { formatDistanceToNow, format } from 'date-fns';
import { useAllCreatives } from '@/hooks/useAllCreatives';
import { useClients, Client } from '@/hooks/useClients';
import { Creative, useUpdateCreativeStatus, useDeleteCreative, useCreateCreative, uploadCreativeFile, detectAspectRatio } from '@/hooks/useCreatives';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
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
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { CreativeHorizontalPreview } from './CreativeHorizontalPreview';
import { CreativeAIActions } from './CreativeAIActions';
import { CashBagLoader } from '@/components/ui/CashBagLoader';
import {
  Search,
  Image,
  Video,
  FileText,
  Upload,
  Clock,
  Check,
  X,
  Rocket,
  RefreshCw,
  MessageSquare,
  Trash2,
  Eye,
  Sparkles,
  CheckSquare,
  Download,
  Film,
  Wand2,
  User,
  Radar,
  Instagram,
  Scissors,
  History,
  Plus,
  Calendar,
  BarChart3,
  Trophy,
  Palette,
  Headphones,
  Camera,
  Target,
  PenTool,
  LayoutDashboard,
  ChevronRight,
  Zap,
  Globe,
  Share2,
} from 'lucide-react';
import { toast } from 'sonner';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';

// Lazy-load sub-section page components
const CreativeBriefs = lazy(() => import('@/pages/CreativeBriefs'));
const StaticCreativesPage = lazy(() => import('@/pages/StaticCreativesPage'));
const BatchVideoWorkflow = lazy(() => import('@/components/batch-video/BatchVideoWorkflow').then(m => ({ default: m.BatchVideoWorkflow })));
const AdVariationsPage = lazy(() => import('@/pages/AdVariationsPage'));
const AvatarsPage = lazy(() => import('@/pages/AvatarsPage'));
const AdScrapingPage = lazy(() => import('@/pages/AdScrapingPage'));
const InstagramIntelPage = lazy(() => import('@/pages/InstagramIntelPage'));
const VideoEditorPage = lazy(() => import('@/pages/VideoEditorPage'));
const BrollPage = lazy(() => import('@/pages/BrollPage'));
const HistoryPage = lazy(() => import('@/pages/HistoryPage'));
const ExportHubPage = lazy(() => import('@/pages/ExportHubPage'));
const CreativeCalendarLazy = lazy(() => import('@/components/creative/CreativeCalendar').then(m => ({ default: m.CreativeCalendar })));
const CreativeAnalyticsLazy = lazy(() => import('@/components/creative/CreativeAnalytics').then(m => ({ default: m.CreativeAnalytics })));
const WinningAdsGalleryLazy = lazy(() => import('@/components/creative/WinningAdsGallery').then(m => ({ default: m.WinningAdsGallery })));
const ManageStylesTabLazy = lazy(() => import('@/components/creative/ManageStylesTab').then(m => ({ default: m.ManageStylesTab })));

// New AI Tools
const CreativeCommandCenter = lazy(() => import('@/components/creative/CreativeCommandCenter').then(m => ({ default: m.CreativeCommandCenter })));
const AIScriptWriter = lazy(() => import('@/components/creative/AIScriptWriter').then(m => ({ default: m.AIScriptWriter })));
const PodcastAdsGenerator = lazy(() => import('@/components/creative/PodcastAdsGenerator').then(m => ({ default: m.PodcastAdsGenerator })));
const HyperRealisticAds = lazy(() => import('@/components/creative/HyperRealisticAds').then(m => ({ default: m.HyperRealisticAds })));
const DirectResponseToolkit = lazy(() => import('@/components/creative/DirectResponseToolkit').then(m => ({ default: m.DirectResponseToolkit })));
const PlatformIntelligence = lazy(() => import('@/components/creative/PlatformIntelligence').then(m => ({ default: m.PlatformIntelligence })));
const CreativeReviewPortalLazy = lazy(() => import('@/components/creative/CreativeReviewPortal').then(m => ({ default: m.CreativeReviewPortal })));

interface CreativeWithClient extends Creative {
  clientName?: string;
}

// Sidebar navigation structure
const NAV_SECTIONS = [
  {
    title: '',
    items: [
      { id: 'command-center', label: 'Command Center', icon: LayoutDashboard },
    ],
  },
  {
    title: 'AI Tools',
    items: [
      { id: 'ai-scripts', label: 'AI Script Writer', icon: PenTool, isNew: true },
      { id: 'podcast-ads', label: 'Podcast Ads', icon: Headphones, isNew: true },
      { id: 'hyper-realistic', label: 'Hyper-Realistic', icon: Camera, isNew: true },
      { id: 'direct-response', label: 'DR Toolkit', icon: Target, isNew: true },
    ],
  },
  {
    title: 'Create',
    items: [
      { id: 'approvals', label: 'Approvals', icon: Upload, showBadge: true },
      { id: 'briefs', label: 'Briefs & Scripts', icon: FileText },
      { id: 'static-ads', label: 'Static Ads', icon: Image },
      { id: 'batch-video', label: 'Batch Video', icon: Film },
      { id: 'ad-variations', label: 'Ad Variations', icon: Wand2 },
      { id: 'avatars', label: 'Avatars', icon: User },
      { id: 'broll', label: 'B-Roll', icon: Film },
      { id: 'video-editor', label: 'Video Editor', icon: Scissors },
    ],
  },
  {
    title: 'Research',
    items: [
      { id: 'platform-intel', label: 'Platform Intel', icon: Globe, isNew: true },
      { id: 'ad-scraping', label: 'Ad Scraping', icon: Radar },
      { id: 'instagram-intel', label: 'IG Intel', icon: Instagram },
      { id: 'winning-ads', label: 'Winning Ads', icon: Trophy },
    ],
  },
  {
    title: 'Manage',
    items: [
      { id: 'client-review', label: 'Client Review', icon: Share2 },
      { id: 'manage-styles', label: 'Styles', icon: Palette },
      { id: 'calendar', label: 'Calendar', icon: Calendar },
      { id: 'history', label: 'History', icon: History },
      { id: 'export', label: 'Export', icon: Download },
      { id: 'analytics', label: 'Analytics', icon: BarChart3 },
    ],
  },
];

export function CreativesTab() {
  const [activeSection, setActiveSection] = useState('command-center');
  const { data: creatives = [], isLoading: creativesLoading } = useAllCreatives();
  const { data: clients = [] } = useClients();
  const updateStatus = useUpdateCreativeStatus();
  const deleteCreative = useDeleteCreative();

  const [searchQuery, setSearchQuery] = useState('');
  const [clientFilter, setClientFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [selectedCreative, setSelectedCreative] = useState<CreativeWithClient | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // Map client names to creatives
  const clientMap = clients.reduce((acc, client) => {
    acc[client.id] = client.name;
    return acc;
  }, {} as Record<string, string>);

  const creativesWithClients: CreativeWithClient[] = creatives.map(c => ({
    ...c,
    clientName: clientMap[c.client_id] || 'Unknown Client',
  }));

  // Filter creatives
  const filteredCreatives = creativesWithClients.filter((creative) => {
    const matchesSearch =
      creative.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      creative.clientName?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesClient = clientFilter === 'all' || creative.client_id === clientFilter;
    const matchesStatus = statusFilter === 'all' || creative.status === statusFilter;
    return matchesSearch && matchesClient && matchesStatus;
  });

  // Group by status for activity feed
  const recentActivity = creativesWithClients
    .slice(0, 20)
    .map(c => ({
      ...c,
      activityType: c.status === 'pending' ? 'uploaded' : c.status,
    }));

  const statusCounts = {
    all: creativesWithClients.length,
    draft: creativesWithClients.filter(c => c.status === 'draft').length,
    pending: creativesWithClients.filter(c => c.status === 'pending').length,
    approved: creativesWithClients.filter(c => c.status === 'approved').length,
    launched: creativesWithClients.filter(c => c.status === 'launched').length,
    revisions: creativesWithClients.filter(c => c.status === 'revisions').length,
    rejected: creativesWithClients.filter(c => c.status === 'rejected').length,
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'draft': return 'bg-slate-100 text-slate-800 dark:bg-slate-900/30 dark:text-slate-400';
      case 'pending': return 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400';
      case 'approved': return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400';
      case 'launched': return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400';
      case 'revisions': return 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400';
      case 'rejected': return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400';
      default: return 'bg-muted text-muted-foreground';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'pending': return <Clock className="h-4 w-4" />;
      case 'approved': return <Check className="h-4 w-4" />;
      case 'launched': return <Rocket className="h-4 w-4" />;
      case 'revisions': return <RefreshCw className="h-4 w-4" />;
      case 'rejected': return <X className="h-4 w-4" />;
      default: return <Clock className="h-4 w-4" />;
    }
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'image': return <Image className="h-4 w-4" />;
      case 'video': return <Video className="h-4 w-4" />;
      case 'copy': return <FileText className="h-4 w-4" />;
      default: return <FileText className="h-4 w-4" />;
    }
  };

  const handleStatusChange = (creative: CreativeWithClient, status: 'approved' | 'revisions' | 'rejected' | 'launched') => {
    updateStatus.mutate({
      id: creative.id,
      status,
      clientId: creative.client_id,
      creativeTitle: creative.title
    });
  };

  const handleDelete = (creative: CreativeWithClient) => {
    if (confirm('Are you sure you want to delete this creative?')) {
      deleteCreative.mutate({ id: creative.id, clientId: creative.client_id });
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredCreatives.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredCreatives.map(c => c.id)));
    }
  };

  const handleBulkAction = (status: 'approved' | 'rejected') => {
    const selected = filteredCreatives.filter(c => selectedIds.has(c.id));
    selected.forEach(creative => {
      updateStatus.mutate({
        id: creative.id,
        status,
        clientId: creative.client_id,
        creativeTitle: creative.title,
      });
    });
    toast.success(`${selected.length} creative(s) ${status}`);
    setSelectedIds(new Set());
  };

  if (creativesLoading) {
    return <CashBagLoader message="Loading creatives..." />;
  }

  const pendingCount = statusCounts.pending;
  const SuspenseFallback = <CashBagLoader message="Loading section..." />;

  const renderContent = () => {
    switch (activeSection) {
      case 'command-center':
        return (
          <Suspense fallback={SuspenseFallback}>
            <CreativeCommandCenter onNavigate={setActiveSection} statusCounts={statusCounts} />
          </Suspense>
        );
      case 'ai-scripts':
        return <Suspense fallback={SuspenseFallback}><AIScriptWriter /></Suspense>;
      case 'podcast-ads':
        return <Suspense fallback={SuspenseFallback}><PodcastAdsGenerator /></Suspense>;
      case 'hyper-realistic':
        return <Suspense fallback={SuspenseFallback}><HyperRealisticAds /></Suspense>;
      case 'direct-response':
        return <Suspense fallback={SuspenseFallback}><DirectResponseToolkit /></Suspense>;
      case 'platform-intel':
        return <Suspense fallback={SuspenseFallback}><PlatformIntelligence onNavigate={setActiveSection} /></Suspense>;
      case 'approvals':
        return renderApprovalsSection();
      case 'briefs':
        return <Suspense fallback={SuspenseFallback}><CreativeBriefs /></Suspense>;
      case 'static-ads':
        return <Suspense fallback={SuspenseFallback}><StaticCreativesPage /></Suspense>;
      case 'batch-video':
        return <Suspense fallback={SuspenseFallback}><BatchVideoWorkflow /></Suspense>;
      case 'ad-variations':
        return <Suspense fallback={SuspenseFallback}><AdVariationsPage /></Suspense>;
      case 'avatars':
        return <Suspense fallback={SuspenseFallback}><AvatarsPage /></Suspense>;
      case 'ad-scraping':
        return <Suspense fallback={SuspenseFallback}><AdScrapingPage /></Suspense>;
      case 'instagram-intel':
        return <Suspense fallback={SuspenseFallback}><InstagramIntelPage /></Suspense>;
      case 'video-editor':
        return <Suspense fallback={SuspenseFallback}><VideoEditorPage /></Suspense>;
      case 'broll':
        return <Suspense fallback={SuspenseFallback}><BrollPage /></Suspense>;
      case 'winning-ads':
        return <Suspense fallback={SuspenseFallback}><WinningAdsGalleryLazy embedded /></Suspense>;
      case 'manage-styles':
        return <Suspense fallback={SuspenseFallback}><ManageStylesTabLazy embedded /></Suspense>;
      case 'history':
        return <Suspense fallback={SuspenseFallback}><HistoryPage /></Suspense>;
      case 'export':
        return <Suspense fallback={SuspenseFallback}><ExportHubPage /></Suspense>;
      case 'calendar':
        return <Suspense fallback={SuspenseFallback}><CreativeCalendarLazy embedded /></Suspense>;
      case 'analytics':
        return <Suspense fallback={SuspenseFallback}><CreativeAnalyticsLazy embedded /></Suspense>;
      case 'client-review':
        return <Suspense fallback={SuspenseFallback}><CreativeReviewPortalLazy embedded /></Suspense>;
      default:
        return null;
    }
  };

  const renderApprovalsSection = () => (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Review & Approve</h2>
          <p className="text-sm text-muted-foreground/40 mt-0.5">Manage creative approvals for your clients</p>
        </div>
        {statusCounts.pending > 0 && (
          <Badge className="bg-amber-500/10 text-amber-600 border-amber-500/20 gap-1.5 px-3 py-1.5 text-sm font-semibold rounded-full">
            <Clock className="h-3.5 w-3.5" />
            {statusCounts.pending} awaiting review
          </Badge>
        )}
      </div>

      {/* Toolbar */}
      <div className="apple-toolbar p-2 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground/40" />
          <input
            placeholder="Search creatives..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 h-9 bg-transparent text-sm placeholder:text-muted-foreground/30 focus:outline-none"
          />
        </div>
        <Select value={clientFilter} onValueChange={setClientFilter}>
          <SelectTrigger className="w-[180px] h-9 rounded-xl bg-transparent border-border/30 text-sm">
            <SelectValue placeholder="All Clients" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Clients</SelectItem>
            {clients.map((client) => (
              <SelectItem key={client.id} value={client.id}>
                {client.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[160px] h-9 rounded-xl bg-transparent border-border/30 text-sm">
            <SelectValue placeholder="All Statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="launched">Launched</SelectItem>
            <SelectItem value="revisions">Revisions</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Bulk Action Bar */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 p-4 bg-primary/5 border border-primary/15 rounded-2xl backdrop-blur-sm">
          <CheckSquare className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">{selectedIds.size} selected</span>
          <div className="flex items-center gap-2 ml-auto">
            <Button size="sm" variant="default" onClick={() => handleBulkAction('approved')} className="rounded-lg gap-1.5 shadow-sm">
              <Check className="h-3 w-3" />
              Approve All
            </Button>
            <Button size="sm" variant="destructive" onClick={() => handleBulkAction('rejected')} className="rounded-lg gap-1.5 shadow-sm">
              <X className="h-3 w-3" />
              Reject All
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())} className="rounded-lg">
              Clear
            </Button>
          </div>
        </div>
      )}

      {/* Status Summary — Compact Apple-style pills */}
      <div className="flex items-center gap-2 flex-wrap">
        {[
          { label: 'All', count: statusCounts.all, filter: 'all', dot: 'bg-foreground/30' },
          { label: 'Pending', count: statusCounts.pending, filter: 'pending', dot: 'bg-amber-500' },
          { label: 'Approved', count: statusCounts.approved, filter: 'approved', dot: 'bg-green-500' },
          { label: 'Launched', count: statusCounts.launched, filter: 'launched', dot: 'bg-blue-500' },
          { label: 'Revisions', count: statusCounts.revisions, filter: 'revisions', dot: 'bg-orange-500' },
          { label: 'Rejected', count: statusCounts.rejected, filter: 'rejected', dot: 'bg-red-500' },
        ].map(item => (
          <button
            key={item.label}
            onClick={() => setStatusFilter(item.filter)}
            className={`flex items-center gap-2 px-4 py-2 rounded-full border text-sm font-medium transition-all duration-200 ${
              statusFilter === item.filter
                ? 'bg-foreground text-background border-foreground shadow-sm'
                : 'bg-background hover:bg-muted/50 border-border/50 text-muted-foreground'
            }`}
          >
            <div className={`h-2 w-2 rounded-full ${statusFilter === item.filter ? 'bg-background/50' : item.dot}`} />
            {item.label}
            <span className={`text-xs font-bold ${statusFilter === item.filter ? 'text-background/70' : 'text-muted-foreground/50'}`}>{item.count}</span>
          </button>
        ))}
      </div>

      {/* Creatives Grid */}
      {filteredCreatives.length > 0 && (
        <div className="flex items-center gap-2 mb-2">
          <Checkbox
            checked={selectedIds.size === filteredCreatives.length && filteredCreatives.length > 0}
            onCheckedChange={toggleSelectAll}
          />
          <span className="text-sm text-muted-foreground">Select all</span>
        </div>
      )}

      {filteredCreatives.length === 0 ? (
        <Card className="rounded-2xl">
          <CardContent className="py-16 text-center">
            <Upload className="h-12 w-12 mx-auto text-muted-foreground/30 mb-4" />
            <p className="text-muted-foreground font-medium">No creatives found</p>
            <p className="text-sm text-muted-foreground/60 mt-1">
              Upload creatives from individual client dashboards
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {filteredCreatives.map((creative) => (
            <Card key={creative.id} className="overflow-hidden rounded-3xl border-border/30 hover:shadow-lg hover:border-primary/15 transition-all duration-300 relative group bg-card">
              {/* Checkbox overlay */}
              <div className="absolute top-3 left-3 z-10" onClick={(e) => e.stopPropagation()}>
                <Checkbox
                  checked={selectedIds.has(creative.id)}
                  onCheckedChange={() => toggleSelect(creative.id)}
                  className="bg-background/80 backdrop-blur-sm"
                />
              </div>
              <div className="aspect-video bg-muted/50 relative overflow-hidden">
                {creative.type === 'image' && creative.file_url ? (
                  <img
                    src={creative.file_url}
                    alt={creative.title}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                  />
                ) : creative.type === 'video' && creative.file_url ? (
                  <video
                    src={creative.file_url}
                    className="w-full h-full object-cover"
                    muted
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-muted/30">
                    {getTypeIcon(creative.type)}
                    <span className="ml-2 text-sm text-muted-foreground/60 capitalize">{creative.type}</span>
                  </div>
                )}
                <Badge className={`absolute top-3 right-3 ${getStatusColor(creative.status)} rounded-lg text-[10px] font-semibold`}>
                  {getStatusIcon(creative.status)}
                  <span className="ml-1 capitalize">{creative.status}</span>
                </Badge>
                {creative.source === 'ai-auto' && (
                  <Badge className="absolute bottom-3 right-3 bg-violet-600/90 text-white text-[9px] gap-1 rounded-lg backdrop-blur-sm">
                    <Sparkles className="h-2.5 w-2.5" />
                    AI
                  </Badge>
                )}
                {/* Quick action overlay for pending creatives */}
                {creative.status === 'pending' && (
                  <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-center justify-center gap-2">
                    <Button
                      size="sm"
                      className="rounded-lg gap-1 bg-green-600 hover:bg-green-700 text-white shadow-lg text-xs"
                      onClick={(e) => { e.stopPropagation(); handleStatusChange(creative, 'approved'); }}
                    >
                      <Check className="h-3 w-3" />
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      className="rounded-lg gap-1 shadow-lg text-xs"
                      onClick={(e) => { e.stopPropagation(); setSelectedCreative(creative); }}
                    >
                      <Eye className="h-3 w-3" />
                      Review
                    </Button>
                  </div>
                )}
              </div>
              <CardContent className="p-3.5">
                <h4 className="font-semibold text-sm truncate">{creative.title}</h4>
                <p className="text-[11px] text-muted-foreground/60 truncate mt-0.5">{creative.clientName}</p>
                <div className="flex items-center justify-between mt-2.5">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Badge variant="outline" className="text-[10px] rounded-md px-1.5 py-0 h-5 font-medium">
                      {creative.platform}
                    </Badge>
                    {creative.comments.length > 0 && (
                      <span className="flex items-center gap-0.5 text-[10px]">
                        <MessageSquare className="h-3 w-3" />
                        {creative.comments.length}
                      </span>
                    )}
                  </div>
                  <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    {creative.file_url && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0 rounded-md"
                        onClick={() => {
                          const link = document.createElement('a');
                          link.href = creative.file_url!;
                          link.download = creative.title || 'creative';
                          link.target = '_blank';
                          link.rel = 'noreferrer';
                          document.body.appendChild(link);
                          link.click();
                          document.body.removeChild(link);
                        }}
                        title="Download"
                      >
                        <Download className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 rounded-md"
                      onClick={() => setSelectedCreative(creative)}
                    >
                      <Eye className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 rounded-md"
                      onClick={() => handleDelete(creative)}
                    >
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </div>
                </div>
                <p className="text-[10px] text-muted-foreground/40 mt-1.5">
                  {formatDistanceToNow(new Date(creative.created_at), { addSuffix: true })}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Creative Detail Modal */}
      <Dialog open={!!selectedCreative} onOpenChange={(open) => !open && setSelectedCreative(null)}>
        <DialogContent className="max-w-[95vw] max-h-[90vh] overflow-auto sm:max-w-[95vw]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {selectedCreative && getTypeIcon(selectedCreative.type)}
              {selectedCreative?.title}
            </DialogTitle>
          </DialogHeader>
          {selectedCreative && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge className={getStatusColor(selectedCreative.status)}>
                  {selectedCreative.status}
                </Badge>
                <Badge variant="outline">{selectedCreative.platform}</Badge>
                <span className="text-sm text-muted-foreground">
                  Client: {selectedCreative.clientName}
                </span>
              </div>

              <CreativeHorizontalPreview
                creative={selectedCreative}
                clientName={selectedCreative.clientName || 'Unknown Client'}
              />

              <div className="flex items-center gap-2 flex-wrap border-t pt-4">
                {selectedCreative.file_url && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-2 rounded-xl"
                    onClick={() => {
                      const link = document.createElement('a');
                      link.href = selectedCreative.file_url!;
                      link.download = selectedCreative.title || 'creative';
                      link.target = '_blank';
                      link.rel = 'noreferrer';
                      document.body.appendChild(link);
                      link.click();
                      document.body.removeChild(link);
                      toast.success('Download started');
                    }}
                  >
                    <Download className="h-4 w-4" />
                    Download
                  </Button>
                )}
                <Sparkles className="h-4 w-4 text-primary ml-2" />
                <span className="text-sm font-medium mr-1">AI Tools:</span>
                <CreativeAIActions creative={selectedCreative} />
              </div>

              <div className="flex gap-2 flex-wrap border-t pt-4">
                {selectedCreative.status === 'pending' && (
                  <>
                    <Button
                      variant="default"
                      className="rounded-xl"
                      onClick={() => handleStatusChange(selectedCreative, 'approved')}
                    >
                      <Check className="h-4 w-4 mr-1" />
                      Approve
                    </Button>
                    <Button
                      variant="outline"
                      className="rounded-xl"
                      onClick={() => handleStatusChange(selectedCreative, 'revisions')}
                    >
                      <RefreshCw className="h-4 w-4 mr-1" />
                      Revisions
                    </Button>
                    <Button
                      variant="destructive"
                      className="rounded-xl"
                      onClick={() => handleStatusChange(selectedCreative, 'rejected')}
                    >
                      <X className="h-4 w-4 mr-1" />
                      Reject
                    </Button>
                  </>
                )}
                {selectedCreative.status === 'approved' && (
                  <Button
                    variant="default"
                    className="rounded-xl"
                    onClick={() => handleStatusChange(selectedCreative, 'launched')}
                  >
                    <Rocket className="h-4 w-4 mr-1" />
                    Launch
                  </Button>
                )}
                <Button
                  variant="ghost"
                  className="rounded-xl"
                  onClick={() => handleDelete(selectedCreative)}
                >
                  <Trash2 className="h-4 w-4 mr-1 text-destructive" />
                  Delete
                </Button>
              </div>

              <div className="border-t pt-4">
                <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
                  <Clock className="h-4 w-4" />
                  History
                </h4>
                <div className="space-y-2 text-xs text-muted-foreground">
                  <div className="flex gap-2">
                    <span className="text-muted-foreground/70">Created:</span>
                    <span>{format(new Date(selectedCreative.created_at), 'MMM d, yyyy h:mm a')}</span>
                  </div>
                  <div className="flex gap-2">
                    <span className="text-muted-foreground/70">Last Updated:</span>
                    <span>{format(new Date(selectedCreative.updated_at), 'MMM d, yyyy h:mm a')}</span>
                  </div>
                  <div className="flex gap-2">
                    <span className="text-muted-foreground/70">Current Status:</span>
                    <Badge className={`${getStatusColor(selectedCreative.status)} text-xs`}>
                      {selectedCreative.status}
                    </Badge>
                  </div>
                </div>
              </div>

              <div className="border-t pt-4">
                <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
                  <MessageSquare className="h-4 w-4" />
                  Comments ({selectedCreative.comments.length})
                </h4>
                {selectedCreative.comments.length > 0 ? (
                  <ScrollArea className="h-[200px] border rounded-xl p-3 mb-2">
                    <div className="space-y-2">
                      {selectedCreative.comments.map((comment) => (
                        <div
                          key={comment.id}
                          className={`p-3 rounded-xl text-sm ${
                            comment.author === 'Client'
                              ? 'bg-primary/10 ml-4'
                              : 'bg-muted mr-4'
                          }`}
                        >
                          <div className="flex justify-between mb-0.5">
                            <span className="text-xs font-medium">{comment.author}</span>
                            <span className="text-xs text-muted-foreground">
                              {format(new Date(comment.createdAt), 'MMM d, h:mm a')}
                            </span>
                          </div>
                          <p>{comment.text}</p>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                ) : (
                  <p className="text-sm text-muted-foreground mb-2">No comments yet</p>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );

  return (
    <div className="flex gap-0 -mx-2 -mt-2">
      {/* Apple-style Sidebar */}
      <div className={`flex-shrink-0 transition-all duration-300 ${sidebarCollapsed ? 'w-16' : 'w-56'}`}>
        <div className="sticky top-0 h-[calc(100vh-120px)]">
          <ScrollArea className="h-full">
            <div className={`py-3 ${sidebarCollapsed ? 'px-2' : 'px-2'} space-y-4`}>
              {NAV_SECTIONS.map((section, sectionIdx) => (
                <div key={sectionIdx}>
                  {section.title && !sidebarCollapsed && (
                    <p className="section-label px-3 mb-1.5">
                      {section.title}
                    </p>
                  )}
                  <div className="space-y-px">
                    {section.items.map(item => {
                      const isActive = activeSection === item.id;
                      const Icon = item.icon;
                      return (
                        <button
                          key={item.id}
                          onClick={() => setActiveSection(item.id)}
                          className={`w-full flex items-center gap-2.5 px-3 py-[7px] rounded-xl text-[13px] transition-all duration-200 ${
                            isActive
                              ? 'bg-primary/10 text-primary font-semibold shadow-sm'
                              : 'text-muted-foreground/70 hover:bg-muted/40 hover:text-foreground'
                          } ${sidebarCollapsed ? 'justify-center px-0' : ''}`}
                          title={sidebarCollapsed ? item.label : undefined}
                        >
                          <Icon className={`h-[15px] w-[15px] flex-shrink-0 transition-colors ${isActive ? 'text-primary' : 'text-muted-foreground/50'}`} />
                          {!sidebarCollapsed && (
                            <>
                              <span className="truncate">{item.label}</span>
                              {'isNew' in item && item.isNew && (
                                <span className="ml-auto inline-flex items-center justify-center text-[8px] font-bold px-1.5 py-0.5 rounded-full bg-gradient-to-r from-violet-500 to-blue-500 text-white leading-none tracking-wide">
                                  NEW
                                </span>
                              )}
                              {'showBadge' in item && item.showBadge && pendingCount > 0 && (
                                <span className="ml-auto inline-flex items-center justify-center text-[10px] font-bold min-w-[20px] h-5 px-1.5 rounded-full bg-amber-500 text-white leading-none tabular-nums">
                                  {pendingCount}
                                </span>
                              )}
                            </>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 min-w-0 border-l border-border/30 pl-6 pr-2">
        {renderContent()}
      </div>
    </div>
  );
}
