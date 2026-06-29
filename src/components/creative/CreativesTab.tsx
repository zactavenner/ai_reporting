import { useState, useRef, lazy, Suspense } from 'react';
import { formatDistanceToNow, format } from 'date-fns';
import { useAllCreatives } from '@/hooks/useAllCreatives';
import { useClients, Client } from '@/hooks/useClients';
import { Creative, useUpdateCreativeStatus, useDeleteCreative, useCreateCreative, uploadCreativeFile, detectAspectRatio } from '@/hooks/useCreatives';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
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
  DialogTrigger,
} from '@/components/ui/dialog';
import { CreativeHorizontalPreview } from './CreativeHorizontalPreview';
import { CreativeAIActions } from './CreativeAIActions';
import { CashBagLoader } from '@/components/ui/CashBagLoader';
import { SimpleDisclaimerDialog } from '@/components/ai/SimpleDisclaimerDialog';
const MetaOpsTabLazy = lazy(() => import('@/components/meta-ops/MetaOpsTab'));
import { formatFileSize } from '@/lib/uploadWithProgress';
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
  Inbox,
  Plus,
  Calendar,
  BarChart3,
  FolderArchive,
  Trophy,
  Palette,
  FileWarning,
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

interface CreativeWithClient extends Creative {
  clientName?: string;
}

export function CreativesTab() {
  const [activeSection, setActiveSection] = useState('approvals');
  const { data: creatives = [], isLoading: creativesLoading } = useAllCreatives();
  const { data: clients = [] } = useClients();
  const updateStatus = useUpdateCreativeStatus();
  const deleteCreative = useDeleteCreative();
  
  const [searchQuery, setSearchQuery] = useState('');
  const [clientFilter, setClientFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [selectedCreative, setSelectedCreative] = useState<CreativeWithClient | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [disclaimerTarget, setDisclaimerTarget] = useState<
    { kind: 'image' | 'video'; url: string; aspect_ratio?: string; clientId: string } | null
  >(null);

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

  // Bulk actions
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

  const pendingCount = creativesWithClients.filter(c => c.status === 'pending').length;
  const SuspenseFallback = <CashBagLoader message="Loading section..." />;

  return (
    <div className="space-y-6">
      {/* Section Tabs */}
      <Tabs value={activeSection} onValueChange={setActiveSection}>
        <TabsList className="bg-muted/50 flex-wrap h-auto gap-1 p-1">
          <TabsTrigger value="approvals" className="gap-2">
            <Upload className="h-4 w-4" />
            Approvals
            {pendingCount > 0 && (
              <Badge variant="default" className="ml-1 h-5 min-w-[20px] flex items-center justify-center text-[10px] px-1.5">
                {pendingCount}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="briefs" className="gap-2"><FileText className="h-4 w-4" />Briefs & Scripts</TabsTrigger>
          <TabsTrigger value="static-ads" className="gap-2"><Image className="h-4 w-4" />Static Ads</TabsTrigger>
          <TabsTrigger value="batch-video" className="gap-2"><Film className="h-4 w-4" />Batch Video</TabsTrigger>
          <TabsTrigger value="ad-variations" className="gap-2"><Wand2 className="h-4 w-4" />Ad Variations</TabsTrigger>
          <TabsTrigger value="avatars" className="gap-2"><User className="h-4 w-4" />Avatars</TabsTrigger>
          <TabsTrigger value="ad-scraping" className="gap-2"><Radar className="h-4 w-4" />Ad Scraping</TabsTrigger>
          <TabsTrigger value="instagram-intel" className="gap-2"><Instagram className="h-4 w-4" />IG Intel</TabsTrigger>
          <TabsTrigger value="video-editor" className="gap-2"><Scissors className="h-4 w-4" />Video Editor</TabsTrigger>
          <TabsTrigger value="broll" className="gap-2"><Film className="h-4 w-4" />B-Roll</TabsTrigger>
          <TabsTrigger value="winning-ads" className="gap-2"><Trophy className="h-4 w-4" />Winning Ads</TabsTrigger>
          <TabsTrigger value="meta-ops" className="gap-2"><Rocket className="h-4 w-4" />Meta Ops</TabsTrigger>
          <TabsTrigger value="manage-styles" className="gap-2"><Palette className="h-4 w-4" />Styles</TabsTrigger>
          <TabsTrigger value="history" className="gap-2"><History className="h-4 w-4" />History</TabsTrigger>
          <TabsTrigger value="export" className="gap-2"><Download className="h-4 w-4" />Export</TabsTrigger>
          <TabsTrigger value="calendar" className="gap-2"><Calendar className="h-4 w-4" />Calendar</TabsTrigger>
          <TabsTrigger value="analytics" className="gap-2"><BarChart3 className="h-4 w-4" />Analytics</TabsTrigger>
        </TabsList>

        <TabsContent value="approvals" className="mt-4 space-y-6">
      {/* Search and Filters */}
      <div className="flex flex-wrap gap-4">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search creatives..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
        <Select value={clientFilter} onValueChange={setClientFilter}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="Filter by client" />
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
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Filter by status" />
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
        <div className="flex items-center gap-3 p-3 bg-primary/10 border border-primary/20 rounded-lg">
          <CheckSquare className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium">{selectedIds.size} selected</span>
          <Button size="sm" variant="default" onClick={() => handleBulkAction('approved')}>
            <Check className="h-3 w-3 mr-1" />
            Approve All
          </Button>
          <Button size="sm" variant="destructive" onClick={() => handleBulkAction('rejected')}>
            <X className="h-3 w-3 mr-1" />
            Reject All
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())}>
            Clear
          </Button>
        </div>
      )}

      {/* Status Summary */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <div className="bg-muted/50 rounded-lg p-3 text-center">
          <p className="text-2xl font-bold">{statusCounts.all}</p>
          <p className="text-xs text-muted-foreground">Total</p>
        </div>
        <div className="bg-amber-50 dark:bg-amber-900/20 rounded-lg p-3 text-center">
          <p className="text-2xl font-bold text-amber-600">{statusCounts.pending}</p>
          <p className="text-xs text-muted-foreground">Pending</p>
        </div>
        <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-3 text-center">
          <p className="text-2xl font-bold text-green-600">{statusCounts.approved}</p>
          <p className="text-xs text-muted-foreground">Approved</p>
        </div>
        <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-3 text-center">
          <p className="text-2xl font-bold text-blue-600">{statusCounts.launched}</p>
          <p className="text-xs text-muted-foreground">Launched</p>
        </div>
        <div className="bg-orange-50 dark:bg-orange-900/20 rounded-lg p-3 text-center">
          <p className="text-2xl font-bold text-orange-600">{statusCounts.revisions}</p>
          <p className="text-xs text-muted-foreground">Revisions</p>
        </div>
        <div className="bg-red-50 dark:bg-red-900/20 rounded-lg p-3 text-center">
          <p className="text-2xl font-bold text-red-600">{statusCounts.rejected}</p>
          <p className="text-xs text-muted-foreground">Rejected</p>
        </div>
      </div>

      <Tabs defaultValue="creatives" className="space-y-4">
        <TabsList>
          <TabsTrigger value="creatives" className="gap-2">
            <Upload className="h-4 w-4" />
            All Creatives ({filteredCreatives.length})
          </TabsTrigger>
          <TabsTrigger value="ai-generated" className="gap-2">
            <Sparkles className="h-4 w-4" />
            AI Generated ({creativesWithClients.filter(c => c.source === 'ai-auto').length})
          </TabsTrigger>
          <TabsTrigger value="activity" className="gap-2">
            <Clock className="h-4 w-4" />
            Recent Activity
          </TabsTrigger>
        </TabsList>

        <TabsContent value="creatives" className="space-y-4">
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
            <Card>
              <CardContent className="py-12 text-center">
                <Upload className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
                <p className="text-muted-foreground">No creatives found</p>
                <p className="text-sm text-muted-foreground">
                  Upload creatives from individual client dashboards
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {filteredCreatives.map((creative) => (
                <Card key={creative.id} className="overflow-hidden hover:border-primary/50 transition-all duration-200 relative">
                  {/* Checkbox overlay */}
                  <div className="absolute top-2 left-2 z-10" onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      checked={selectedIds.has(creative.id)}
                      onCheckedChange={() => toggleSelect(creative.id)}
                    />
                  </div>
                  <div className="aspect-video bg-muted relative overflow-hidden">
                    {creative.type === 'image' && creative.file_url ? (
                      <img
                        src={creative.file_url}
                        alt={creative.title}
                        className="w-full h-full object-cover"
                      />
                    ) : creative.type === 'video' && creative.file_url ? (
                      <video
                        src={creative.file_url}
                        className="w-full h-full object-cover"
                        muted
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        {getTypeIcon(creative.type)}
                        <span className="ml-2 text-sm text-muted-foreground capitalize">{creative.type}</span>
                      </div>
                    )}
                    <Badge className={`absolute top-2 right-2 ${getStatusColor(creative.status)}`}>
                      {getStatusIcon(creative.status)}
                      <span className="ml-1 capitalize">{creative.status}</span>
                    </Badge>
                    {creative.source === 'ai-auto' && (
                      <Badge className="absolute bottom-2 right-2 bg-violet-600 text-white dark:bg-violet-500 text-[10px] gap-1">
                        <Sparkles className="h-3 w-3" />
                        Auto-Generated
                      </Badge>
                    )}
                  </div>
                  <CardContent className="p-3">
                    <h4 className="font-medium truncate">{creative.title}</h4>
                    <p className="text-xs text-muted-foreground truncate">{creative.clientName}</p>
                    <div className="flex items-center justify-between mt-2">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Badge variant="outline" className="text-xs">
                          {creative.platform}
                        </Badge>
                        {creative.comments.length > 0 && (
                          <span className="flex items-center gap-1">
                            <MessageSquare className="h-3 w-3" />
                            {creative.comments.length}
                          </span>
                        )}
                      </div>
                      <div className="flex gap-1">
                        {creative.file_url && (
                          <Button
                            variant="ghost"
                            size="sm"
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
                            <Download className="h-4 w-4" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setSelectedCreative(creative)}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDelete(creative)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground mt-2">
                      {formatDistanceToNow(new Date(creative.created_at), { addSuffix: true })}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* AI Generated Performance Tracking */}
        <TabsContent value="ai-generated" className="space-y-4">
          {(() => {
            const aiCreatives = creativesWithClients.filter(c => c.source === 'ai-auto');
            const aiApproved = aiCreatives.filter(c => c.status === 'approved' || c.status === 'launched').length;
            const aiPending = aiCreatives.filter(c => c.status === 'pending').length;
            const aiRejected = aiCreatives.filter(c => c.status === 'rejected').length;
            
            return (
              <>
                {/* AI Performance Summary */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <Card className="p-4 text-center">
                    <p className="text-2xl font-bold">{aiCreatives.length}</p>
                    <p className="text-xs text-muted-foreground">Total AI Generated</p>
                  </Card>
                  <Card className="p-4 text-center">
                    <p className="text-2xl font-bold text-amber-600">{aiPending}</p>
                    <p className="text-xs text-muted-foreground">Awaiting Approval</p>
                  </Card>
                  <Card className="p-4 text-center">
                    <p className="text-2xl font-bold text-green-600">{aiApproved}</p>
                    <p className="text-xs text-muted-foreground">Approved / Launched</p>
                  </Card>
                  <Card className="p-4 text-center">
                    <p className="text-2xl font-bold text-red-600">{aiRejected}</p>
                    <p className="text-xs text-muted-foreground">Rejected</p>
                  </Card>
                </div>

                {aiCreatives.length === 0 ? (
                  <Card>
                    <CardContent className="py-12 text-center">
                      <Sparkles className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
                      <p className="text-muted-foreground">No AI-generated creatives yet</p>
                      <p className="text-sm text-muted-foreground">
                        Creatives are auto-generated when CPL exceeds thresholds
                      </p>
                    </CardContent>
                  </Card>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {aiCreatives.map((creative) => (
                      <Card key={creative.id} className="overflow-hidden hover:border-primary/50 transition-all duration-200 border-violet-500/30">
                        <div className="aspect-video bg-muted relative overflow-hidden">
                          {creative.file_url ? (
                            <img src={creative.file_url} alt={creative.title} className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">
                              <Sparkles className="h-8 w-8 text-violet-500" />
                            </div>
                          )}
                          <Badge className={`absolute top-2 right-2 ${getStatusColor(creative.status)}`}>
                            {creative.status}
                          </Badge>
                          <Badge className="absolute bottom-2 right-2 bg-violet-600 text-white text-[10px] gap-1">
                            <Sparkles className="h-3 w-3" />
                            Auto-Generated
                          </Badge>
                        </div>
                        <CardContent className="p-3">
                          <h4 className="font-medium truncate">{creative.title}</h4>
                          <p className="text-xs text-muted-foreground">{creative.clientName}</p>
                          {creative.trigger_campaign_id && (
                            <p className="text-xs text-violet-500 mt-1">CPL Triggered</p>
                          )}
                          <div className="flex items-center justify-between mt-2">
                            <Badge variant="outline" className="text-xs">{creative.platform}</Badge>
                            <div className="flex gap-1">
                              <Button variant="ghost" size="sm" onClick={() => setSelectedCreative(creative)}>
                                <Eye className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                          <p className="text-xs text-muted-foreground mt-2">
                            {formatDistanceToNow(new Date(creative.created_at), { addSuffix: true })}
                          </p>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </>
            );
          })()}
        </TabsContent>

        <TabsContent value="activity" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Recent Creative Activity</CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[500px]">
                <div className="space-y-3">
                  {recentActivity.map((creative) => (
                    <div
                      key={creative.id}
                      className="flex items-start gap-4 p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors duration-200 cursor-pointer"
                      onClick={() => setSelectedCreative(creative)}
                    >
                      <div className="w-16 h-16 rounded-md bg-muted overflow-hidden flex-shrink-0">
                        {creative.type === 'image' && creative.file_url ? (
                          <img
                            src={creative.file_url}
                            alt={creative.title}
                            className="w-full h-full object-cover"
                          />
                        ) : creative.type === 'video' && creative.file_url ? (
                          <video
                            src={creative.file_url}
                            className="w-full h-full object-cover"
                            muted
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            {getTypeIcon(creative.type)}
                          </div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <Badge className={getStatusColor(creative.status)}>
                            {getStatusIcon(creative.status)}
                            <span className="ml-1 capitalize">{creative.status}</span>
                          </Badge>
                          <Badge variant="outline">{creative.platform}</Badge>
                        </div>
                        <h4 className="font-medium truncate">{creative.title}</h4>
                        <p className="text-sm text-muted-foreground">{creative.clientName}</p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-xs text-muted-foreground">
                          {format(new Date(creative.updated_at), 'MMM d, yyyy')}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {format(new Date(creative.updated_at), 'h:mm a')}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Creative Detail Modal - Horizontal Layout */}
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

              {/* Horizontal Platform Preview - All platforms side by side */}
              <CreativeHorizontalPreview 
                creative={selectedCreative} 
                clientName={selectedCreative.clientName || 'Unknown Client'}
              />

              {/* Download + AI Actions */}
              <div className="flex items-center gap-2 flex-wrap border-t pt-4">
                {selectedCreative.file_url && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-2"
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

              {/* Action Buttons */}
              <div className="flex gap-2 flex-wrap border-t pt-4">
                {selectedCreative.status === 'pending' && (
                  <>
                    <Button
                      variant="default"
                      onClick={() => handleStatusChange(selectedCreative, 'approved')}
                    >
                      <Check className="h-4 w-4 mr-1" />
                      Approve
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => handleStatusChange(selectedCreative, 'revisions')}
                    >
                      <RefreshCw className="h-4 w-4 mr-1" />
                      Revisions
                    </Button>
                    <Button
                      variant="destructive"
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
                    onClick={() => handleStatusChange(selectedCreative, 'launched')}
                  >
                    <Rocket className="h-4 w-4 mr-1" />
                    Launch
                  </Button>
                )}
                <Button
                  variant="ghost"
                  onClick={() => handleDelete(selectedCreative)}
                >
                  <Trash2 className="h-4 w-4 mr-1 text-destructive" />
                  Delete
                </Button>
              </div>

              {/* Approval History Timeline */}
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

              {/* Comments */}
              <div className="border-t pt-4">
                <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
                  <MessageSquare className="h-4 w-4" />
                  Comments ({selectedCreative.comments.length})
                </h4>
                {selectedCreative.comments.length > 0 ? (
                  <ScrollArea className="h-[200px] border rounded-lg p-3 mb-2">
                    <div className="space-y-2">
                      {selectedCreative.comments.map((comment) => (
                        <div
                          key={comment.id}
                          className={`p-2 rounded-lg text-sm ${
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
        </TabsContent>

        <TabsContent value="briefs" className="mt-4">
          <Suspense fallback={SuspenseFallback}><CreativeBriefs /></Suspense>
        </TabsContent>
        <TabsContent value="static-ads" className="mt-4">
          <Suspense fallback={SuspenseFallback}><StaticCreativesPage /></Suspense>
        </TabsContent>
        <TabsContent value="batch-video" className="mt-4">
          <Suspense fallback={SuspenseFallback}><BatchVideoWorkflow /></Suspense>
        </TabsContent>
        <TabsContent value="ad-variations" className="mt-4">
          <Suspense fallback={SuspenseFallback}><AdVariationsPage /></Suspense>
        </TabsContent>
        <TabsContent value="avatars" className="mt-4">
          <Suspense fallback={SuspenseFallback}><AvatarsPage /></Suspense>
        </TabsContent>
        <TabsContent value="ad-scraping" className="mt-4">
          <Suspense fallback={SuspenseFallback}><AdScrapingPage /></Suspense>
        </TabsContent>
        <TabsContent value="instagram-intel" className="mt-4">
          <Suspense fallback={SuspenseFallback}><InstagramIntelPage /></Suspense>
        </TabsContent>
        <TabsContent value="video-editor" className="mt-4">
          <Suspense fallback={SuspenseFallback}><VideoEditorPage /></Suspense>
        </TabsContent>
        <TabsContent value="broll" className="mt-4">
          <Suspense fallback={SuspenseFallback}><BrollPage /></Suspense>
        </TabsContent>
        <TabsContent value="winning-ads" className="mt-4">
          <Suspense fallback={SuspenseFallback}><WinningAdsGalleryLazy embedded /></Suspense>
        </TabsContent>
        <TabsContent value="meta-ops" className="mt-4">
          <Suspense fallback={SuspenseFallback}><MetaOpsTabLazy /></Suspense>
        </TabsContent>
        <TabsContent value="manage-styles" className="mt-4">
          <Suspense fallback={SuspenseFallback}><ManageStylesTabLazy embedded /></Suspense>
        </TabsContent>
        <TabsContent value="history" className="mt-4">
          <Suspense fallback={SuspenseFallback}><HistoryPage /></Suspense>
        </TabsContent>
        <TabsContent value="export" className="mt-4">
          <Suspense fallback={SuspenseFallback}><ExportHubPage /></Suspense>
        </TabsContent>
        <TabsContent value="calendar" className="mt-4">
          <Suspense fallback={SuspenseFallback}><CreativeCalendarLazy embedded /></Suspense>
        </TabsContent>
        <TabsContent value="analytics" className="mt-4">
          <Suspense fallback={SuspenseFallback}><CreativeAnalyticsLazy embedded /></Suspense>
        </TabsContent>
      </Tabs>
    </div>
  );
}
