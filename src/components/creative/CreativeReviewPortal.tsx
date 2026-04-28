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
      return matchClient && matchSearch && (c.status === 'pending' || c.status === 'revisions');
    });
  }, [creatives, selectedClientId, searchQuery]);

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
    toast.success('Review link copied — share with client');
  };

  return (
    <div className="space-y-8">
      {/* Hero */}
      <div className="creative-hero">
        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-6">
            <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-lg shadow-emerald-500/25">
              <Share2 className="h-6 w-6 text-white" />
            </div>
            <div>
              <h2 className="text-2xl md:text-3xl font-bold tracking-tight text-white">Client Review Portal</h2>
              <p className="text-sm text-white/40">Manage creative approvals and client feedback in one place</p>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-8">
            <div className="glass-panel rounded-2xl p-4 text-center">
              <p className="text-2xl font-bold text-amber-400">{totalPending}</p>
              <p className="text-[10px] text-white/40 uppercase tracking-wider font-medium mt-1">Pending Review</p>
            </div>
            <div className="glass-panel rounded-2xl p-4 text-center">
              <p className="text-2xl font-bold text-orange-400">{totalRevisions}</p>
              <p className="text-[10px] text-white/40 uppercase tracking-wider font-medium mt-1">Need Revisions</p>
            </div>
            <div className="glass-panel rounded-2xl p-4 text-center">
              <p className="text-2xl font-bold text-green-400">{totalApproved}</p>
              <p className="text-[10px] text-white/40 uppercase tracking-wider font-medium mt-1">Approved</p>
            </div>
            <div className="glass-panel rounded-2xl p-4 text-center">
              <div className="flex items-center justify-center gap-2">
                <p className="text-2xl font-bold text-white">{overallProgress}%</p>
              </div>
              <p className="text-[10px] text-white/40 uppercase tracking-wider font-medium mt-1">Completion</p>
            </div>
          </div>
        </div>
        <div className="creative-hero-orb top-[-20%] right-[-5%] w-[500px] h-[500px] bg-emerald-500/12" />
        <div className="creative-hero-orb bottom-[-30%] left-[10%] w-[400px] h-[400px] bg-teal-500/8" />
      </div>

      {/* Client Review Batches */}
      {reviewBatches.filter(b => b.pending > 0 || b.revisions > 0).length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-4">
            <Users className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-base font-semibold text-muted-foreground">By Client</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {reviewBatches.filter(b => b.pending > 0 || b.revisions > 0).map(batch => (
              <Card
                key={batch.clientId}
                className="apple-card cursor-pointer"
                onClick={() => setSelectedClientId(batch.clientId)}
              >
                <CardContent className="p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <p className="text-sm font-semibold">{batch.clientName}</p>
                      <p className="text-[11px] text-muted-foreground/50">
                        {formatDistanceToNow(new Date(batch.lastActivity), { addSuffix: true })}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0 rounded-lg"
                      onClick={(e) => { e.stopPropagation(); handleCopyReviewLink(batch.clientId); }}
                    >
                      <Link2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>

                  <div className="flex items-center gap-3 mb-3">
                    {batch.pending > 0 && (
                      <Badge className="bg-amber-500/10 text-amber-600 text-[10px] rounded-full px-2 border-0 gap-1">
                        <Clock className="h-2.5 w-2.5" />{batch.pending} pending
                      </Badge>
                    )}
                    {batch.revisions > 0 && (
                      <Badge className="bg-orange-500/10 text-orange-600 text-[10px] rounded-full px-2 border-0 gap-1">
                        <RefreshCw className="h-2.5 w-2.5" />{batch.revisions} revisions
                      </Badge>
                    )}
                  </div>

                  <Progress
                    value={batch.total > 0 ? ((batch.approved) / batch.total) * 100 : 0}
                    className="h-1.5 rounded-full"
                  />
                  <p className="text-[10px] text-muted-foreground/40 mt-1.5">
                    {batch.approved} of {batch.total} approved
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Filter Bar */}
      <div className="flex flex-wrap gap-3 p-3 bg-muted/30 rounded-2xl border border-border/30">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/50" />
          <Input
            placeholder="Search creatives..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10 h-10 rounded-xl bg-background border-border/50"
          />
        </div>
        <Select value={selectedClientId} onValueChange={setSelectedClientId}>
          <SelectTrigger className="w-[200px] h-10 rounded-xl bg-background border-border/50">
            <SelectValue placeholder="All Clients" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Clients</SelectItem>
            {clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="flex gap-1 bg-background rounded-xl border border-border/50 p-0.5">
          <Button
            variant={viewMode === 'grid' ? 'default' : 'ghost'}
            size="sm"
            className="h-9 w-9 p-0 rounded-lg"
            onClick={() => setViewMode('grid')}
          >
            <LayoutGrid className="h-4 w-4" />
          </Button>
          <Button
            variant={viewMode === 'list' ? 'default' : 'ghost'}
            size="sm"
            className="h-9 w-9 p-0 rounded-lg"
            onClick={() => setViewMode('list')}
          >
            <List className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Creatives to Review */}
      {filteredCreatives.length === 0 ? (
        <div className="text-center py-16">
          <div className="h-16 w-16 rounded-3xl bg-green-500/10 flex items-center justify-center mx-auto mb-4">
            <CheckCircle2 className="h-8 w-8 text-green-500/40" />
          </div>
          <h3 className="text-lg font-semibold mb-1">All caught up</h3>
          <p className="text-sm text-muted-foreground/60">No creatives pending review right now.</p>
        </div>
      ) : (
        <div className={viewMode === 'grid'
          ? 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4'
          : 'space-y-3'
        }>
          {filteredCreatives.map(creative => {
            const isExpanded = activeFeedbackId === creative.id;

            if (viewMode === 'list') {
              return (
                <Card key={creative.id} className="rounded-2xl border-border/40 overflow-hidden">
                  <CardContent className="p-0">
                    <div className="flex items-center gap-4 p-4">
                      <div className="h-16 w-16 rounded-xl bg-muted/30 flex-shrink-0 overflow-hidden">
                        {creative.type === 'image' && creative.file_url ? (
                          <img src={creative.file_url} alt="" className="w-full h-full object-cover" />
                        ) : creative.type === 'video' && creative.file_url ? (
                          <video src={creative.file_url} className="w-full h-full object-cover" muted />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <FileText className="h-6 w-6 text-muted-foreground/30" />
                          </div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold truncate">{creative.title}</p>
                        <p className="text-[11px] text-muted-foreground/50">
                          {clientMap[creative.client_id] || 'Unknown'} · {creative.platform} · {formatDistanceToNow(new Date(creative.created_at), { addSuffix: true })}
                        </p>
                      </div>
                      <Badge className={creative.status === 'pending' ? 'bg-amber-500/10 text-amber-600 border-0' : 'bg-orange-500/10 text-orange-600 border-0'}>
                        {creative.status}
                      </Badge>
                      <div className="flex gap-1.5">
                        <Button size="sm" className="rounded-xl gap-1 bg-green-600 hover:bg-green-700 text-white"
                          onClick={() => handleApprove(creative.id, creative.client_id, creative.title)}>
                          <Check className="h-3.5 w-3.5" />Approve
                        </Button>
                        <Button size="sm" variant="outline" className="rounded-xl gap-1"
                          onClick={() => setActiveFeedbackId(isExpanded ? null : creative.id)}>
                          <MessageSquare className="h-3.5 w-3.5" />Feedback
                        </Button>
                        <Button size="sm" variant="ghost" className="rounded-xl"
                          onClick={() => handleReject(creative.id, creative.client_id, creative.title)}>
                          <X className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      </div>
                    </div>
                    {isExpanded && (
                      <div className="px-4 pb-4 pt-0 border-t border-border/20 mt-0">
                        <div className="flex gap-2 mt-3">
                          <Textarea
                            placeholder="Add revision notes for the creative team..."
                            value={feedbackText}
                            onChange={(e) => setFeedbackText(e.target.value)}
                            className="min-h-[60px] rounded-xl resize-none bg-muted/30 border-border/50 text-sm"
                          />
                          <Button
                            size="sm"
                            className="rounded-xl self-end"
                            onClick={() => handleRequestRevisions(creative.id, creative.client_id, creative.title)}
                          >
                            <Send className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            }

            return (
              <Card key={creative.id} className="rounded-2xl border-border/40 overflow-hidden group hover:shadow-lg transition-all duration-300">
                <div className="aspect-video bg-muted/30 relative overflow-hidden">
                  {creative.type === 'image' && creative.file_url ? (
                    <img src={creative.file_url} alt="" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                  ) : creative.type === 'video' && creative.file_url ? (
                    <video src={creative.file_url} className="w-full h-full object-cover" muted />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <FileText className="h-8 w-8 text-muted-foreground/20" />
                    </div>
                  )}
                  <Badge className={`absolute top-3 right-3 rounded-lg text-[10px] font-semibold ${
                    creative.status === 'pending' ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400' : 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400'
                  }`}>
                    {creative.status === 'pending' ? <Clock className="h-3 w-3 mr-1" /> : <RefreshCw className="h-3 w-3 mr-1" />}
                    {creative.status}
                  </Badge>

                  {/* Quick approve overlay */}
                  <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-center justify-center gap-2">
                    <Button size="sm" className="rounded-xl gap-1 bg-green-600 hover:bg-green-700 text-white shadow-lg"
                      onClick={() => handleApprove(creative.id, creative.client_id, creative.title)}>
                      <Check className="h-3.5 w-3.5" />Approve
                    </Button>
                    <Button size="sm" variant="secondary" className="rounded-xl gap-1 shadow-lg"
                      onClick={() => setActiveFeedbackId(isExpanded ? null : creative.id)}>
                      <MessageSquare className="h-3.5 w-3.5" />Feedback
                    </Button>
                  </div>
                </div>

                <CardContent className="p-4">
                  <h4 className="text-sm font-semibold truncate">{creative.title}</h4>
                  <p className="text-[11px] text-muted-foreground/50 mt-0.5">
                    {clientMap[creative.client_id] || 'Unknown'} · {creative.platform}
                  </p>

                  {creative.comments.length > 0 && (
                    <div className="flex items-center gap-1 mt-2 text-[10px] text-muted-foreground/40">
                      <MessageSquare className="h-3 w-3" />
                      {creative.comments.length} comment{creative.comments.length !== 1 ? 's' : ''}
                    </div>
                  )}

                  {isExpanded && (
                    <div className="mt-3 pt-3 border-t border-border/20">
                      <div className="flex gap-2">
                        <Textarea
                          placeholder="Revision notes..."
                          value={feedbackText}
                          onChange={(e) => setFeedbackText(e.target.value)}
                          className="min-h-[60px] rounded-xl resize-none bg-muted/30 border-border/50 text-xs"
                        />
                      </div>
                      <div className="flex gap-2 mt-2">
                        <Button size="sm" variant="outline" className="rounded-xl gap-1 flex-1 text-xs"
                          onClick={() => handleRequestRevisions(creative.id, creative.client_id, creative.title)}>
                          <RefreshCw className="h-3 w-3" />Request Revisions
                        </Button>
                        <Button size="sm" variant="ghost" className="rounded-xl text-xs"
                          onClick={() => handleReject(creative.id, creative.client_id, creative.title)}>
                          <X className="h-3 w-3 text-destructive" />
                        </Button>
                      </div>
                    </div>
                  )}

                  <div className="flex items-center gap-1.5 mt-3">
                    <Button size="sm" className="rounded-xl gap-1 flex-1 text-xs h-8 bg-green-600 hover:bg-green-700 text-white"
                      onClick={() => handleApprove(creative.id, creative.client_id, creative.title)}>
                      <Check className="h-3 w-3" />Approve
                    </Button>
                    <Button size="sm" variant="outline" className="rounded-xl gap-1 flex-1 text-xs h-8"
                      onClick={() => setActiveFeedbackId(isExpanded ? null : creative.id)}>
                      <MessageSquare className="h-3 w-3" />Feedback
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
