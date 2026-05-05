import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Share2,
  Link2,
  Copy,
  Check,
  Clock,
  Eye,
  MessageSquare,
  ChevronRight,
  ExternalLink,
  Mail,
  Shield,
  Lock,
  Globe,
  Users,
  CheckCircle2,
  XCircle,
  AlertCircle,
  RotateCw,
  Plus,
  Settings,
  Sparkles,
  Image,
  Video,
  FileText,
} from 'lucide-react';
import { useAllCreatives } from '@/hooks/useAllCreatives';
import { useClients } from '@/hooks/useClients';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';

interface ReviewLink {
  id: string;
  name: string;
  clientId: string;
  clientName: string;
  url: string;
  creativeCount: number;
  status: 'active' | 'expired' | 'completed';
  requiresLogin: boolean;
  allowComments: boolean;
  allowApproval: boolean;
  expiresAt: string;
  createdAt: string;
  viewCount: number;
  approved: number;
  pending: number;
  revisions: number;
}

const SAMPLE_LINKS: ReviewLink[] = [
  {
    id: 'rl1',
    name: 'Q2 Campaign Review',
    clientId: '1',
    clientName: 'Acme Corp',
    url: 'https://review.aicra.io/r/abc123',
    creativeCount: 12,
    status: 'active',
    requiresLogin: false,
    allowComments: true,
    allowApproval: true,
    expiresAt: '2026-05-15T00:00:00Z',
    createdAt: '2026-05-01T10:00:00Z',
    viewCount: 8,
    approved: 5,
    pending: 4,
    revisions: 3,
  },
  {
    id: 'rl2',
    name: 'Social Media Batch',
    clientId: '2',
    clientName: 'TechStart Inc',
    url: 'https://review.aicra.io/r/def456',
    creativeCount: 24,
    status: 'active',
    requiresLogin: false,
    allowComments: true,
    allowApproval: true,
    expiresAt: '2026-05-20T00:00:00Z',
    createdAt: '2026-05-03T14:00:00Z',
    viewCount: 15,
    approved: 18,
    pending: 3,
    revisions: 3,
  },
  {
    id: 'rl3',
    name: 'Brand Refresh Assets',
    clientId: '3',
    clientName: 'Luxury Brands Co',
    url: 'https://review.aicra.io/r/ghi789',
    creativeCount: 8,
    status: 'completed',
    requiresLogin: true,
    allowComments: true,
    allowApproval: true,
    expiresAt: '2026-04-28T00:00:00Z',
    createdAt: '2026-04-15T09:00:00Z',
    viewCount: 22,
    approved: 8,
    pending: 0,
    revisions: 0,
  },
];

export function ClientSharePortal() {
  const { data: clients = [] } = useClients();
  const { data: creatives = [] } = useAllCreatives();
  const [reviewLinks, setReviewLinks] = useState<ReviewLink[]>(SAMPLE_LINKS);
  const [showCreateLink, setShowCreateLink] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [selectedLink, setSelectedLink] = useState<ReviewLink | null>(null);

  const [newLink, setNewLink] = useState({
    name: '',
    clientId: '',
    requiresLogin: false,
    allowComments: true,
    allowApproval: true,
    expiresInDays: '7',
    message: '',
  });

  const handleCopyLink = (url: string, id: string) => {
    navigator.clipboard.writeText(url);
    setCopiedId(id);
    toast.success('Review link copied to clipboard');
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleCreateLink = () => {
    if (!newLink.name || !newLink.clientId) {
      toast.error('Please fill in all required fields');
      return;
    }
    toast.success('Review link created! Share it with your client.');
    setShowCreateLink(false);
    setNewLink({ name: '', clientId: '', requiresLogin: false, allowComments: true, allowApproval: true, expiresInDays: '7', message: '' });
  };

  const getStatusConfig = (status: string) => {
    switch (status) {
      case 'active': return { label: 'Active', color: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20', dot: 'bg-emerald-500' };
      case 'expired': return { label: 'Expired', color: 'bg-red-500/10 text-red-600 border-red-500/20', dot: 'bg-red-500' };
      case 'completed': return { label: 'Completed', color: 'bg-blue-500/10 text-blue-600 border-blue-500/20', dot: 'bg-blue-500' };
      default: return { label: status, color: 'bg-muted text-muted-foreground', dot: 'bg-muted-foreground' };
    }
  };

  const activeLinks = reviewLinks.filter(l => l.status === 'active');
  const completedLinks = reviewLinks.filter(l => l.status === 'completed' || l.status === 'expired');

  return (
    <div className="space-y-8">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-[28px] p-8 md:p-10"
        style={{
          background: 'linear-gradient(145deg, #050508 0%, #0a1e28 30%, #0a2818 60%, #050508 100%)'
        }}
      >
        <div className="relative z-10">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-11 w-11 rounded-2xl bg-white/[0.08] backdrop-blur-md flex items-center justify-center border border-white/[0.06]">
                <Share2 className="h-5 w-5 text-white/90" />
              </div>
              <div>
                <h1 className="text-2xl md:text-3xl font-bold text-white tracking-tight">Client Review Portal</h1>
                <p className="text-sm text-white/30">Zero-friction review links — no login required</p>
              </div>
            </div>
            <Button onClick={() => setShowCreateLink(true)} className="rounded-xl gap-2 bg-white/10 hover:bg-white/15 text-white border border-white/10">
              <Plus className="h-4 w-4" />
              New Review Link
            </Button>
          </div>

          <div className="grid grid-cols-4 gap-3 mt-8">
            <div className="glass-panel rounded-2xl p-4 text-center">
              <p className="text-2xl font-bold text-white/90 tabular-nums">{activeLinks.length}</p>
              <p className="text-[10px] font-semibold text-white/25 uppercase tracking-wider mt-1">Active Links</p>
            </div>
            <div className="glass-panel rounded-2xl p-4 text-center">
              <p className="text-2xl font-bold text-emerald-400 tabular-nums">
                {reviewLinks.reduce((acc, l) => acc + l.approved, 0)}
              </p>
              <p className="text-[10px] font-semibold text-white/25 uppercase tracking-wider mt-1">Approved</p>
            </div>
            <div className="glass-panel rounded-2xl p-4 text-center">
              <p className="text-2xl font-bold text-amber-400 tabular-nums">
                {reviewLinks.reduce((acc, l) => acc + l.pending, 0)}
              </p>
              <p className="text-[10px] font-semibold text-white/25 uppercase tracking-wider mt-1">Pending</p>
            </div>
            <div className="glass-panel rounded-2xl p-4 text-center">
              <p className="text-2xl font-bold text-white/90 tabular-nums">
                {reviewLinks.reduce((acc, l) => acc + l.viewCount, 0)}
              </p>
              <p className="text-[10px] font-semibold text-white/25 uppercase tracking-wider mt-1">Total Views</p>
            </div>
          </div>
        </div>
        <div className="absolute top-[-20%] right-[-10%] w-[400px] h-[400px] rounded-full bg-gradient-to-br from-emerald-500/10 via-teal-500/5 to-transparent blur-3xl pointer-events-none" />
      </div>

      {/* Active Review Links */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          <div className="h-2 w-2 rounded-full bg-emerald-500 status-dot-pulse" />
          <h2 className="text-lg font-semibold tracking-tight">Active Review Links</h2>
          <Badge variant="outline" className="text-[10px] rounded-full ml-1">{activeLinks.length}</Badge>
        </div>

        <div className="space-y-3">
          {activeLinks.map(link => {
            const statusConfig = getStatusConfig(link.status);
            const approvalRate = link.creativeCount > 0 ? Math.round((link.approved / link.creativeCount) * 100) : 0;

            return (
              <div key={link.id} className="bento-card-v2 p-5 group">
                <div className="flex items-start gap-4">
                  <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-emerald-500/15 to-teal-500/15 flex items-center justify-center flex-shrink-0">
                    <Link2 className="h-5 w-5 text-emerald-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="text-sm font-semibold truncate">{link.name}</h3>
                      <Badge className={`text-[9px] rounded-full px-2 ${statusConfig.color} border`}>
                        <div className={`h-1.5 w-1.5 rounded-full ${statusConfig.dot} mr-1`} />
                        {statusConfig.label}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground/50">{link.clientName} · {link.creativeCount} creatives</p>

                    {/* Progress bar */}
                    <div className="mt-3 flex items-center gap-3">
                      <div className="flex-1 h-2 rounded-full bg-muted/50 overflow-hidden">
                        <div className="h-full bg-gradient-to-r from-emerald-500 to-teal-500 rounded-full transition-all duration-500" style={{ width: `${approvalRate}%` }} />
                      </div>
                      <span className="text-[11px] font-semibold text-muted-foreground/60 tabular-nums">{approvalRate}%</span>
                    </div>

                    {/* Stats row */}
                    <div className="flex items-center gap-4 mt-3 text-[11px] text-muted-foreground/50">
                      <span className="flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                        {link.approved} approved
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3 text-amber-500" />
                        {link.pending} pending
                      </span>
                      <span className="flex items-center gap-1">
                        <RotateCw className="h-3 w-3 text-orange-500" />
                        {link.revisions} revisions
                      </span>
                      <span className="flex items-center gap-1">
                        <Eye className="h-3 w-3" />
                        {link.viewCount} views
                      </span>
                    </div>

                    {/* Link + Actions */}
                    <div className="flex items-center gap-2 mt-3">
                      <div className="flex-1 flex items-center gap-2 px-3 py-2 rounded-xl bg-muted/30 border border-border/20">
                        <Globe className="h-3 w-3 text-muted-foreground/40 flex-shrink-0" />
                        <span className="text-xs text-muted-foreground/60 truncate font-mono">{link.url}</span>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="rounded-xl h-9 gap-1.5 text-xs flex-shrink-0"
                        onClick={() => handleCopyLink(link.url, link.id)}
                      >
                        {copiedId === link.id ? (
                          <><Check className="h-3 w-3 text-emerald-500" /> Copied</>
                        ) : (
                          <><Copy className="h-3 w-3" /> Copy</>
                        )}
                      </Button>
                      <Button variant="ghost" size="sm" className="h-9 w-9 p-0 rounded-xl" onClick={() => setSelectedLink(link)}>
                        <Settings className="h-3.5 w-3.5 text-muted-foreground/50" />
                      </Button>
                    </div>
                  </div>
                </div>

                {/* Feature badges */}
                <div className="flex items-center gap-2 mt-3 pl-16">
                  {!link.requiresLogin && (
                    <Badge variant="outline" className="text-[9px] rounded-full gap-1 px-2 border-border/30">
                      <Globe className="h-2.5 w-2.5" />
                      No Login Required
                    </Badge>
                  )}
                  {link.allowComments && (
                    <Badge variant="outline" className="text-[9px] rounded-full gap-1 px-2 border-border/30">
                      <MessageSquare className="h-2.5 w-2.5" />
                      Comments
                    </Badge>
                  )}
                  {link.allowApproval && (
                    <Badge variant="outline" className="text-[9px] rounded-full gap-1 px-2 border-border/30">
                      <CheckCircle2 className="h-2.5 w-2.5" />
                      Approve / Reject
                    </Badge>
                  )}
                  <span className="text-[10px] text-muted-foreground/30 ml-auto">
                    Expires {formatDistanceToNow(new Date(link.expiresAt), { addSuffix: true })}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Completed Links */}
      {completedLinks.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-4">
            <CheckCircle2 className="h-4 w-4 text-muted-foreground/40" />
            <h2 className="text-lg font-semibold tracking-tight text-muted-foreground/60">Completed</h2>
          </div>
          <div className="space-y-2">
            {completedLinks.map(link => {
              const statusConfig = getStatusConfig(link.status);
              return (
                <div key={link.id} className="flex items-center gap-4 p-4 rounded-2xl border border-border/20 bg-muted/20">
                  <div className="h-10 w-10 rounded-xl bg-muted/50 flex items-center justify-center flex-shrink-0">
                    <Link2 className="h-4 w-4 text-muted-foreground/40" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="text-sm font-medium text-muted-foreground/70 truncate">{link.name}</h4>
                    <p className="text-[11px] text-muted-foreground/40">{link.clientName} · {link.creativeCount} creatives · {link.viewCount} views</p>
                  </div>
                  <Badge className={`text-[9px] rounded-full px-2 ${statusConfig.color} border`}>
                    {statusConfig.label}
                  </Badge>
                  <span className="text-[11px] text-emerald-500 font-semibold tabular-nums">{link.approved}/{link.creativeCount} approved</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Create Review Link Dialog */}
      <Dialog open={showCreateLink} onOpenChange={setShowCreateLink}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Share2 className="h-5 w-5 text-primary" />
              Create Review Link
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-5 pt-2">
            <div>
              <label className="text-xs font-medium text-muted-foreground/70 mb-1.5 block">Review Name</label>
              <Input
                value={newLink.name}
                onChange={e => setNewLink(prev => ({ ...prev, name: e.target.value }))}
                placeholder="e.g., Q2 Campaign Review"
                className="rounded-xl"
              />
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground/70 mb-1.5 block">Client</label>
              <Select value={newLink.clientId} onValueChange={v => setNewLink(prev => ({ ...prev, clientId: v }))}>
                <SelectTrigger className="rounded-xl">
                  <SelectValue placeholder="Select client..." />
                </SelectTrigger>
                <SelectContent>
                  {clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground/70 mb-1.5 block">Custom Message (optional)</label>
              <Textarea
                value={newLink.message}
                onChange={e => setNewLink(prev => ({ ...prev, message: e.target.value }))}
                placeholder="Add a message for your client..."
                className="rounded-xl resize-none min-h-[80px]"
              />
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground/70 mb-1.5 block">Link Expiry</label>
              <Select value={newLink.expiresInDays} onValueChange={v => setNewLink(prev => ({ ...prev, expiresInDays: v }))}>
                <SelectTrigger className="rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="3">3 days</SelectItem>
                  <SelectItem value="7">7 days</SelectItem>
                  <SelectItem value="14">14 days</SelectItem>
                  <SelectItem value="30">30 days</SelectItem>
                  <SelectItem value="never">Never</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-3 p-4 rounded-2xl bg-muted/20 border border-border/20">
              <p className="text-xs font-semibold text-muted-foreground/60 uppercase tracking-wider">Permissions</p>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Globe className="h-4 w-4 text-muted-foreground/50" />
                  <div>
                    <p className="text-sm font-medium">No Login Required</p>
                    <p className="text-[11px] text-muted-foreground/40">Anyone with the link can review</p>
                  </div>
                </div>
                <Switch
                  checked={!newLink.requiresLogin}
                  onCheckedChange={v => setNewLink(prev => ({ ...prev, requiresLogin: !v }))}
                />
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <MessageSquare className="h-4 w-4 text-muted-foreground/50" />
                  <div>
                    <p className="text-sm font-medium">Allow Comments</p>
                    <p className="text-[11px] text-muted-foreground/40">Reviewers can leave feedback</p>
                  </div>
                </div>
                <Switch
                  checked={newLink.allowComments}
                  onCheckedChange={v => setNewLink(prev => ({ ...prev, allowComments: v }))}
                />
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-muted-foreground/50" />
                  <div>
                    <p className="text-sm font-medium">Allow Approval</p>
                    <p className="text-[11px] text-muted-foreground/40">Reviewers can approve or request changes</p>
                  </div>
                </div>
                <Switch
                  checked={newLink.allowApproval}
                  onCheckedChange={v => setNewLink(prev => ({ ...prev, allowApproval: v }))}
                />
              </div>
            </div>

            <div className="flex gap-2">
              <Button className="flex-1 rounded-xl gap-2" onClick={handleCreateLink}>
                <Link2 className="h-4 w-4" />
                Create Review Link
              </Button>
              <Button variant="outline" className="rounded-xl gap-2" onClick={handleCreateLink}>
                <Mail className="h-4 w-4" />
                Create & Email
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Link Details Dialog */}
      <Dialog open={!!selectedLink} onOpenChange={open => !open && setSelectedLink(null)}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Settings className="h-5 w-5 text-muted-foreground/60" />
              Link Settings
            </DialogTitle>
          </DialogHeader>
          {selectedLink && (
            <div className="space-y-4 pt-2">
              <div className="p-4 rounded-2xl bg-muted/20 border border-border/20 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Status</span>
                  <Badge className={`text-[10px] rounded-full px-2 ${getStatusConfig(selectedLink.status).color} border`}>
                    {getStatusConfig(selectedLink.status).label}
                  </Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Views</span>
                  <span className="text-sm tabular-nums">{selectedLink.viewCount}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Approval Rate</span>
                  <span className="text-sm tabular-nums text-emerald-500 font-semibold">
                    {selectedLink.creativeCount > 0 ? Math.round((selectedLink.approved / selectedLink.creativeCount) * 100) : 0}%
                  </span>
                </div>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1 rounded-xl gap-2 text-sm" onClick={() => { handleCopyLink(selectedLink.url, selectedLink.id); setSelectedLink(null); }}>
                  <Copy className="h-4 w-4" />
                  Copy Link
                </Button>
                <Button variant="destructive" className="rounded-xl gap-2 text-sm" onClick={() => { toast.success('Link deactivated'); setSelectedLink(null); }}>
                  <XCircle className="h-4 w-4" />
                  Deactivate
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
