import { useState, useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Share2,
  Users,
  Eye,
  Check,
  X,
  RefreshCw,
  MessageSquare,
  Clock,
  Rocket,
  Image,
  Video,
  FileText,
  Search,
  ChevronRight,
  Star,
  Copy,
  ExternalLink,
  Shield,
  Link2,
  CheckCircle2,
  AlertCircle,
  Send,
  Download,
  Filter,
  LayoutGrid,
  List,
  ArrowUpDown,
  ThumbsUp,
  ThumbsDown,
  Sparkles,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { useAllCreatives } from '@/hooks/useAllCreatives';
import { useClients } from '@/hooks/useClients';
import { useUpdateCreativeStatus } from '@/hooks/useCreatives';
import { toast } from 'sonner';

interface ReviewBatch {
  clientId: string;
  clientName: string;
  pending: number;
  approved: number;
  revisions: number;
  total: number;
  lastActivity: string;
}

export function CreativeReviewPortal({ embedded = false }: { embedded?: boolean }) {
  const { data: creatives = [] } = useAllCreatives();
  const { data: clients = [] } = useClients();
  const updateStatus = useUpdateCreativeStatus();
  const [selectedClientId, setSelectedClientId] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [feedbackText, setFeedbackText] = useState('');
  const [activeFeedbackId, setActiveFeedbackId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'review' | 'approved' | 'all'>('review');

  const clientMap = useMemo(() =>
    clients.reduce((acc, c) => { acc[c.id] = c.name; return acc; }, {} as Record<string, string>),
    [clients]
  );

  const reviewBatches: ReviewBatch[] = useMemo(() => {
    const grouped = creatives.reduce((acc, c) => {
      if (!acc[c.client_id]) {
        acc[c.client_id] = {
          clientId: c.client_id,
          clientName: clientMap[c.client_id] || 'Unknown',
          pending: 0,
          approved: 0,
          revisions: 0,
          total: 0,
          lastActivity: c.updated_at,
        };
      }
      acc[c.client_id].total++;
      if (c.status === 'pending') acc[c.client_id].pending++;
      if (c.status === 'approved') acc[c.client_id].approved++;
      if (c.status === 'revisions') acc[c.client_id].revisions++;
      if (c.updated_at > acc[c.client_id].lastActivity) acc[c.client_id].lastActivity = c.updated_at;
      return acc;
    }, {} as Record<string, ReviewBatch>);
    return Object.values(grouped).sort((a, b) => b.pending - a.pending);
  }, [creatives, clientMap]);

  const filteredCreatives = useMemo(() => {
    return creatives.filter(c => {
      const matchClient = selectedClientId === 'all' || c.client_id === selectedClientId;
      const matchSearch = !searchQuery || c.title.toLowerCase().includes(searchQuery.toLowerCase());
      const matchStatus = statusFilter === 'all'
        || (statusFilter === 'review' && (c.status === 'pending' || c.status === 'revisions'))
        || (statusFilter === 'approved' && (c.status === 'approved' || c.status === 'launched'));
      return matchClient && matchSearch && matchStatus;
    });
  }, [creatives, selectedClientId, searchQuery, statusFilter]);

  const totalPending = creatives.filter(c => c.status === 'pending').length;
  const totalRevisions = creatives.filter(c => c.status === 'revisions').length;
  const totalApproved = creatives.filter(c => c.status === 'approved' || c.status === 'launched').length;
  const overallProgress = creatives.length > 0 ? Math.round((totalApproved / creatives.length) * 100) : 0;

  const handleApprove = (id: string, clientId: string, title: string) => {
    updateStatus.mutate({ id, status: 'approved', clientId, creativeTitle: title });
    toast.success('Creative approved');
  };

  const handleRequestRevisions = (id: string, clientId: string, title: string) => {
    updateStatus.mutate({ id, status: 'revisions', clientId, creativeTitle: title });
    toast.success('Revision requested');
    setActiveFeedbackId(null);
    setFeedbackText('');
  };

  const handleReject = (id: string, clientId: string, title: string) => {
    updateStatus.mutate({ id, status: 'rejected', clientId, creativeTitle: title });
    toast.success('Creative rejected');
  };

  const handleCopyReviewLink = (clientId: string) => {
    const url = `${window.location.origin}/public/${clientId}/creatives`;
    navigator.clipboard.writeText(url);
    toast.success('Review link copied');
  };

  return (
    <div className="space-y-8">
      {/* Header — clean Apple style */}
      <div>
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-2xl bg-emerald-500/10 flex items-center justify-center">
              <Share2 className="h-5 w-5 text-emerald-500" />
            </div>
            <div>
              <h2 className="text-2xl font-bold tracking-tight">Client Review</h2>
              <p className="text-sm text-muted-foreground/40">Manage approvals and feedback</p>
            </div>
          </div>
        </div>

        {/* Stat cards — bento style */}
        <div className="grid grid-cols-4 gap-3">
          <div className="bento-card p-4 text-center cursor-pointer" onClick={() => setStatusFilter('review')}>
            <p className="text-2xl font-bold text-amber-500 tabular-nums">{totalPending}</p>
            <p className="text-[10px] text-muted-foreground/40 uppercase tracking-wider font-semibold mt-1">Pending</p>
          </div>
          <div className="bento-card p-4 text-center cursor-pointer" onClick={() => setStatusFilter('review')}>
            <p className="text-2xl font-bold text-orange-500 tabular-nums">{totalRevisions}</p>
            <p className="text-[10px] text-muted-foreground/40 uppercase tracking-wider font-semibold mt-1">Revisions</p>
          </div>
          <div className="bento-card p-4 text-center cursor-pointer" onClick={() => setStatusFilter('approved')}>
            <p className="text-2xl font-bold text-emerald-500 tabular-nums">{totalApproved}</p>
            <p className="text-[10px] text-muted-foreground/40 uppercase tracking-wider font-semibold mt-1">Approved</p>
          </div>
          <div className="bento-card p-4 text-center">
            <p className="text-2xl font-bold tabular-nums">{overallProgress}%</p>
            <Progress value={overallProgress} className="h-1 rounded-full mt-2" />
            <p className="text-[10px] text-muted-foreground/40 uppercase tracking-wider font-semibold mt-1">Complete</p>
          </div>
        </div>
      </div>

      {/* Client batches */}
      {reviewBatches.filter(b => b.pending > 0 || b.revisions > 0).length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Users className="h-4 w-4 text-muted-foreground/50" />
            <span className="section-label">By Client</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {reviewBatches.filter(b => b.pending > 0 || b.revisions > 0).map(batch => (
              <button
                key={batch.clientId}
                className={`bento-card p-4 text-left transition-all ${selectedClientId === batch.clientId ? 'ring-2 ring-primary border-primary/20' : ''}`}
                onClick={() => setSelectedClientId(selectedClientId === batch.clientId ? 'all' : batch.clientId)}
              >
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <p className="text-sm font-semibold">{batch.clientName}</p>
                    <p className="text-[10px] text-muted-foreground/40">
                      {formatDistanceToNow(new Date(batch.lastActivity), { addSuffix: true })}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 rounded-lg"
                    onClick={(e) => { e.stopPropagation(); handleCopyReviewLink(batch.clientId); }}
                    title="Copy review link"
                  >
                    <Link2 className="h-3.5 w-3.5" />
                  </Button>
                </div>

                <div className="flex items-center gap-2 mb-3">
                  {batch.pending > 0 && (
                    <Badge className="bg-amber-500/10 text-amber-600 text-[10px] rounded-lg px-2 border-0 gap-1 font-semibold">
                      <Clock className="h-2.5 w-2.5" />{batch.pending}
                    </Badge>
                  )}
                  {batch.revisions > 0 && (
                    <Badge className="bg-orange-500/10 text-orange-600 text-[10px] rounded-lg px-2 border-0 gap-1 font-semibold">
                      <RefreshCw className="h-2.5 w-2.5" />{batch.revisions}
                    </Badge>
                  )}
                  <Badge className="bg-emerald-500/10 text-emerald-600 text-[10px] rounded-lg px-2 border-0 gap-1 font-semibold">
                    <Check className="h-2.5 w-2.5" />{batch.approved}
                  </Badge>
                </div>

                <Progress
                  value={batch.total > 0 ? (batch.approved / batch.total) * 100 : 0}
                  className="h-1 rounded-full"
                />
                <p className="text-[10px] text-muted-foreground/30 mt-1.5 tabular-nums">
                  {batch.approved}/{batch.total} approved
                </p>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Filter toolbar */}
      <div className="apple-toolbar p-2 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/40" />
          <input
            placeholder="Search creatives..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 h-9 bg-transparent text-sm placeholder:text-muted-foreground/30 focus:outline-none"
          />
        </div>
        <div className="flex gap-1 bg-muted/30 rounded-xl p-1">
          {([
            { id: 'review' as const, label: 'Needs Review', count: totalPending + totalRevisions },
            { id: 'approved' as const, label: 'Approved', count: totalApproved },
            { id: 'all' as const, label: 'All', count: creatives.length },
          ]).map(tab => (
            <button
              key={tab.id}
              onClick={() => setStatusFilter(tab.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                statusFilter === tab.id
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground/50 hover:text-muted-foreground'
              }`}
            >
              {tab.label}
              <span className="ml-1 tabular-nums opacity-50">{tab.count}</span>
            </button>
          ))}
        </div>
        <Select value={selectedClientId} onValueChange={setSelectedClientId}>
          <SelectTrigger className="w-[180px] h-9 rounded-xl bg-transparent border-border/30 text-sm">
            <SelectValue placeholder="All Clients" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Clients</SelectItem>
            {clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="flex gap-0.5 bg-muted/30 rounded-lg p-0.5">
          <button
            onClick={() => setViewMode('grid')}
            className={`h-8 w-8 rounded-md flex items-center justify-center transition-all ${viewMode === 'grid' ? 'bg-background shadow-sm' : 'text-muted-foreground/40'}`}
          >
            <LayoutGrid className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => setViewMode('list')}
            className={`h-8 w-8 rounded-md flex items-center justify-center transition-all ${viewMode === 'list' ? 'bg-background shadow-sm' : 'text-muted-foreground/40'}`}
          >
            <List className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Creative review cards */}
      {filteredCreatives.length === 0 ? (
        <div className="text-center py-20">
          <div className="h-16 w-16 rounded-3xl bg-emerald-500/10 flex items-center justify-center mx-auto mb-4">
            <CheckCircle2 className="h-8 w-8 text-emerald-500/30" />
          </div>
          <h3 className="text-lg font-semibold mb-1">All caught up</h3>
          <p className="text-sm text-muted-foreground/40">No creatives match your current filters.</p>
        </div>
      ) : viewMode === 'list' ? (
        <div className="space-y-2">
          {filteredCreatives.map(creative => {
            const isExpanded = activeFeedbackId === creative.id;
            return (
              <div
                key={creative.id}
                className={`apple-surface p-0 overflow-hidden transition-all ${
                  creative.status === 'approved' ? 'review-glow-approved' :
                  creative.status === 'pending' ? 'review-glow-pending' :
                  creative.status === 'revisions' ? 'review-glow-revision' : ''
                }`}
              >
                <div className="flex items-center gap-4 p-4">
                  <div className="h-14 w-14 rounded-xl bg-muted/30 flex-shrink-0 overflow-hidden">
                    {creative.type === 'image' && creative.file_url ? (
                      <img src={creative.file_url} alt="" className="w-full h-full object-cover" />
                    ) : creative.type === 'video' && creative.file_url ? (
                      <video src={creative.file_url} className="w-full h-full object-cover" muted />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <FileText className="h-5 w-5 text-muted-foreground/20" />
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate">{creative.title}</p>
                    <p className="text-[11px] text-muted-foreground/40">
                      {clientMap[creative.client_id] || 'Unknown'} · {creative.platform} · {formatDistanceToNow(new Date(creative.created_at), { addSuffix: true })}
                    </p>
                  </div>
                  <Badge className={`rounded-lg text-[10px] font-semibold ${
                    creative.status === 'pending' ? 'bg-amber-500/10 text-amber-600 border-0' :
                    creative.status === 'revisions' ? 'bg-orange-500/10 text-orange-600 border-0' :
                    creative.status === 'approved' ? 'bg-emerald-500/10 text-emerald-600 border-0' :
                    creative.status === 'launched' ? 'bg-blue-500/10 text-blue-600 border-0' :
                    'bg-muted text-muted-foreground border-0'
                  }`}>
                    {creative.status}
                  </Badge>
                  {(creative.status === 'pending' || creative.status === 'revisions') && (
                    <div className="flex gap-1.5">
                      <Button size="sm" className="rounded-xl gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white h-8 text-xs"
                        onClick={() => handleApprove(creative.id, creative.client_id, creative.title)}>
                        <ThumbsUp className="h-3 w-3" />Approve
                      </Button>
                      <Button size="sm" variant="outline" className="rounded-xl gap-1.5 h-8 text-xs"
                        onClick={() => setActiveFeedbackId(isExpanded ? null : creative.id)}>
                        <MessageSquare className="h-3 w-3" />
                      </Button>
                      <Button size="sm" variant="ghost" className="rounded-xl h-8 w-8 p-0"
                        onClick={() => handleReject(creative.id, creative.client_id, creative.title)}>
                        <ThumbsDown className="h-3 w-3 text-muted-foreground/50" />
                      </Button>
                    </div>
                  )}
                </div>
                {isExpanded && (
                  <div className="px-4 pb-4 border-t border-border/10">
                    <div className="flex gap-2 mt-3">
                      <Textarea
                        placeholder="Add revision notes for the creative team..."
                        value={feedbackText}
                        onChange={(e) => setFeedbackText(e.target.value)}
                        className="min-h-[60px] rounded-xl resize-none bg-muted/20 border-border/30 text-sm"
                        autoFocus
                      />
                      <div className="flex flex-col gap-1.5">
                        <Button
                          size="sm"
                          className="rounded-xl"
                          onClick={() => handleRequestRevisions(creative.id, creative.client_id, creative.title)}
                        >
                          <Send className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="rounded-xl"
                          onClick={() => { setActiveFeedbackId(null); setFeedbackText(''); }}
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {filteredCreatives.map(creative => {
            const isExpanded = activeFeedbackId === creative.id;
            return (
              <div
                key={creative.id}
                className={`bento-card p-0 overflow-hidden group ${
                  creative.status === 'approved' ? 'review-glow-approved' :
                  creative.status === 'pending' ? 'review-glow-pending' :
                  creative.status === 'revisions' ? 'review-glow-revision' : ''
                }`}
              >
                {/* Thumbnail */}
                <div className="aspect-video bg-muted/20 relative overflow-hidden">
                  {creative.type === 'image' && creative.file_url ? (
                    <img src={creative.file_url} alt="" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                  ) : creative.type === 'video' && creative.file_url ? (
                    <video src={creative.file_url} className="w-full h-full object-cover" muted />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <FileText className="h-8 w-8 text-muted-foreground/15" />
                    </div>
                  )}
                  <Badge className={`absolute top-3 right-3 rounded-lg text-[10px] font-semibold backdrop-blur-md ${
                    creative.status === 'pending' ? 'bg-amber-500/80 text-white border-0' :
                    creative.status === 'revisions' ? 'bg-orange-500/80 text-white border-0' :
                    creative.status === 'approved' ? 'bg-emerald-500/80 text-white border-0' :
                    creative.status === 'launched' ? 'bg-blue-500/80 text-white border-0' :
                    'bg-muted text-muted-foreground border-0'
                  }`}>
                    {creative.status}
                  </Badge>

                  {(creative.status === 'pending' || creative.status === 'revisions') && (
                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-end justify-center pb-4 gap-2">
                      <Button size="sm" className="rounded-xl gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white shadow-lg text-xs"
                        onClick={() => handleApprove(creative.id, creative.client_id, creative.title)}>
                        <ThumbsUp className="h-3 w-3" />Approve
                      </Button>
                      <Button size="sm" variant="secondary" className="rounded-xl gap-1.5 shadow-lg text-xs"
                        onClick={() => setActiveFeedbackId(isExpanded ? null : creative.id)}>
                        <MessageSquare className="h-3 w-3" />Feedback
                      </Button>
                    </div>
                  )}
                </div>

                {/* Info */}
                <div className="p-4">
                  <h4 className="text-sm font-semibold truncate">{creative.title}</h4>
                  <div className="flex items-center justify-between mt-1">
                    <p className="text-[11px] text-muted-foreground/40 truncate">
                      {clientMap[creative.client_id] || 'Unknown'}
                    </p>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-[9px] rounded-md px-1.5 py-0 h-5 font-medium border-border/30">
                        {creative.platform}
                      </Badge>
                      {creative.comments.length > 0 && (
                        <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground/30">
                          <MessageSquare className="h-3 w-3" />
                          {creative.comments.length}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Inline feedback */}
                  {isExpanded && (
                    <div className="mt-3 pt-3 border-t border-border/15">
                      <Textarea
                        placeholder="Revision notes..."
                        value={feedbackText}
                        onChange={(e) => setFeedbackText(e.target.value)}
                        className="min-h-[60px] rounded-xl resize-none bg-muted/20 border-border/20 text-xs mb-2"
                        autoFocus
                      />
                      <div className="flex gap-1.5">
                        <Button size="sm" variant="outline" className="rounded-xl gap-1 flex-1 text-xs h-8"
                          onClick={() => handleRequestRevisions(creative.id, creative.client_id, creative.title)}>
                          <RefreshCw className="h-3 w-3" />Revisions
                        </Button>
                        <Button size="sm" variant="ghost" className="rounded-xl text-xs h-8"
                          onClick={() => handleReject(creative.id, creative.client_id, creative.title)}>
                          <X className="h-3 w-3 text-destructive" />
                        </Button>
                        <Button size="sm" variant="ghost" className="rounded-xl text-xs h-8"
                          onClick={() => { setActiveFeedbackId(null); setFeedbackText(''); }}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
