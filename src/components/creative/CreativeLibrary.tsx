import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
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
  FolderOpen,
  Plus,
  Search,
  LayoutGrid,
  List,
  Star,
  Copy,
  ExternalLink,
  MoreHorizontal,
  Tag,
  TrendingUp,
  Sparkles,
  ChevronRight,
  FolderPlus,
  Image,
  Video,
  FileText,
  Filter,
  ArrowUpDown,
  Eye,
  Download,
  Trash2,
  Layers,
  Bookmark,
} from 'lucide-react';
import { useAllCreatives } from '@/hooks/useAllCreatives';
import { useClients } from '@/hooks/useClients';
import { formatDistanceToNow } from 'date-fns';

interface Board {
  id: string;
  name: string;
  folder: string;
  color: string;
  count: number;
  thumbnail?: string;
}

interface Folder {
  id: string;
  name: string;
  boards: Board[];
  color: string;
}

const SAMPLE_FOLDERS: Folder[] = [
  {
    id: 'f1',
    name: 'Active Campaigns',
    color: 'from-blue-500 to-indigo-500',
    boards: [
      { id: 'b1', name: 'Q2 Meta Ads', folder: 'f1', color: 'bg-blue-500/10', count: 24 },
      { id: 'b2', name: 'TikTok Launch', folder: 'f1', color: 'bg-pink-500/10', count: 18 },
      { id: 'b3', name: 'YouTube Pre-Roll', folder: 'f1', color: 'bg-red-500/10', count: 12 },
    ],
  },
  {
    id: 'f2',
    name: 'Swipe File',
    color: 'from-amber-500 to-orange-500',
    boards: [
      { id: 'b4', name: 'Winning Hooks', folder: 'f2', color: 'bg-amber-500/10', count: 56 },
      { id: 'b5', name: 'Competitor Ads', folder: 'f2', color: 'bg-purple-500/10', count: 89 },
      { id: 'b6', name: 'UGC Templates', folder: 'f2', color: 'bg-emerald-500/10', count: 34 },
    ],
  },
  {
    id: 'f3',
    name: 'Templates',
    color: 'from-violet-500 to-purple-500',
    boards: [
      { id: 'b7', name: 'DR Scripts', folder: 'f3', color: 'bg-violet-500/10', count: 15 },
      { id: 'b8', name: 'Podcast Formats', folder: 'f3', color: 'bg-orange-500/10', count: 8 },
      { id: 'b9', name: 'Static Templates', folder: 'f3', color: 'bg-cyan-500/10', count: 22 },
    ],
  },
];

const TAGS = ['Hook', 'Social Proof', 'Urgency', 'Authority', 'Story', 'UGC', 'Testimonial', 'Offer'];

export function CreativeLibrary() {
  const { data: creatives = [] } = useAllCreatives();
  const { data: clients = [] } = useClients();
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [selectedBoard, setSelectedBoard] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('newest');
  const [filterTag, setFilterTag] = useState<string>('all');
  const [showNewBoard, setShowNewBoard] = useState(false);
  const [newBoardName, setNewBoardName] = useState('');
  const [newBoardFolder, setNewBoardFolder] = useState('');

  const clientMap = clients.reduce((acc, c) => {
    acc[c.id] = c.name;
    return acc;
  }, {} as Record<string, string>);

  const filteredCreatives = creatives.filter(c => {
    if (searchQuery) {
      return c.title.toLowerCase().includes(searchQuery.toLowerCase());
    }
    return true;
  });

  const getScoreColor = (score: number) => {
    if (score >= 90) return 'perf-score-high';
    if (score >= 75) return 'perf-score-mid';
    return 'perf-score-low';
  };

  const renderBreadcrumb = () => {
    const parts = ['Library'];
    if (selectedFolder) {
      const folder = SAMPLE_FOLDERS.find(f => f.id === selectedFolder);
      if (folder) parts.push(folder.name);
    }
    if (selectedBoard) {
      const folder = SAMPLE_FOLDERS.find(f => f.id === selectedFolder);
      const board = folder?.boards.find(b => b.id === selectedBoard);
      if (board) parts.push(board.name);
    }

    return (
      <div className="flex items-center gap-1.5 text-sm">
        {parts.map((part, idx) => (
          <div key={part} className="flex items-center gap-1.5">
            {idx > 0 && <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/30" />}
            <button
              onClick={() => {
                if (idx === 0) { setSelectedFolder(null); setSelectedBoard(null); }
                if (idx === 1) { setSelectedBoard(null); }
              }}
              className={`font-medium transition-colors ${
                idx === parts.length - 1
                  ? 'text-foreground'
                  : 'text-muted-foreground/60 hover:text-foreground'
              }`}
            >
              {part}
            </button>
          </div>
        ))}
      </div>
    );
  };

  const renderFolderView = () => (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {SAMPLE_FOLDERS.map(folder => (
          <button
            key={folder.id}
            onClick={() => setSelectedFolder(folder.id)}
            className="group bento-card-v2 p-6 text-left"
          >
            <div className="flex items-start justify-between mb-4">
              <div className={`h-12 w-12 rounded-2xl bg-gradient-to-br ${folder.color} flex items-center justify-center`}>
                <FolderOpen className="h-6 w-6 text-white" />
              </div>
              <Badge variant="outline" className="text-[11px] rounded-full px-2.5 border-border/40">
                {folder.boards.length} boards
              </Badge>
            </div>
            <h3 className="text-base font-semibold mb-1">{folder.name}</h3>
            <p className="text-xs text-muted-foreground/50">
              {folder.boards.reduce((acc, b) => acc + b.count, 0)} creatives
            </p>
            <div className="mt-4 flex items-center gap-2">
              {folder.boards.slice(0, 3).map(board => (
                <div key={board.id} className={`h-8 w-8 rounded-lg ${board.color} flex items-center justify-center`}>
                  <Layers className="h-3.5 w-3.5 text-muted-foreground/60" />
                </div>
              ))}
              <ChevronRight className="h-4 w-4 text-muted-foreground/20 ml-auto group-hover:text-primary group-hover:translate-x-0.5 transition-all" />
            </div>
          </button>
        ))}

        <button
          onClick={() => setShowNewBoard(true)}
          className="bento-card-v2 p-6 text-left border-dashed border-border/50 hover:border-primary/30 flex flex-col items-center justify-center gap-3 min-h-[180px]"
        >
          <div className="h-12 w-12 rounded-2xl bg-muted/50 flex items-center justify-center">
            <FolderPlus className="h-6 w-6 text-muted-foreground/40" />
          </div>
          <span className="text-sm font-medium text-muted-foreground/60">New Folder</span>
        </button>
      </div>
    </div>
  );

  const renderBoardView = () => {
    const folder = SAMPLE_FOLDERS.find(f => f.id === selectedFolder);
    if (!folder) return null;

    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {folder.boards.map(board => (
            <button
              key={board.id}
              onClick={() => setSelectedBoard(board.id)}
              className="group apple-card p-5 text-left"
            >
              <div className={`h-24 rounded-xl ${board.color} mb-4 flex items-center justify-center relative overflow-hidden`}>
                <Layers className="h-8 w-8 text-muted-foreground/30" />
                <div className="absolute top-2 right-2">
                  <Badge className="text-[9px] bg-black/40 text-white backdrop-blur-sm border-0 rounded-md">
                    {board.count}
                  </Badge>
                </div>
              </div>
              <h4 className="text-sm font-semibold truncate">{board.name}</h4>
              <p className="text-[11px] text-muted-foreground/50 mt-0.5">{board.count} items</p>
            </button>
          ))}

          <button
            onClick={() => setShowNewBoard(true)}
            className="apple-card p-5 text-left border-dashed flex flex-col items-center justify-center gap-2 min-h-[160px]"
          >
            <Plus className="h-5 w-5 text-muted-foreground/40" />
            <span className="text-xs text-muted-foreground/50">New Board</span>
          </button>
        </div>
      </div>
    );
  };

  const renderCreativeCards = () => (
    <div className={viewMode === 'grid' ? 'grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3' : 'space-y-2'}>
      {filteredCreatives.map(creative => {
        const score = Math.floor(Math.random() * 30) + 70;
        const tags = TAGS.slice(0, Math.floor(Math.random() * 3) + 1);

        if (viewMode === 'list') {
          return (
            <div key={creative.id} className="group flex items-center gap-4 p-3 rounded-2xl border border-border/20 hover:bg-muted/30 hover:border-primary/10 transition-all">
              <div className="h-14 w-14 rounded-xl bg-muted/50 flex-shrink-0 overflow-hidden">
                {creative.file_url ? (
                  <img src={creative.file_url} className="h-full w-full object-cover" alt="" />
                ) : (
                  <div className="h-full w-full flex items-center justify-center">
                    {creative.type === 'video' ? <Video className="h-5 w-5 text-muted-foreground/40" /> : <Image className="h-5 w-5 text-muted-foreground/40" />}
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <h4 className="text-sm font-medium truncate">{creative.title}</h4>
                <p className="text-[11px] text-muted-foreground/50">{clientMap[creative.client_id] || 'Unknown'} · {creative.platform}</p>
              </div>
              <div className="flex items-center gap-3">
                {tags.slice(0, 2).map(tag => (
                  <Badge key={tag} variant="outline" className="text-[9px] rounded-full px-2 py-0.5 border-border/30">{tag}</Badge>
                ))}
                <div className={`perf-score ${getScoreColor(score)}`}>
                  <TrendingUp className="h-3 w-3" />
                  {score}
                </div>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0 rounded-lg"><Eye className="h-3.5 w-3.5" /></Button>
                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0 rounded-lg"><Copy className="h-3.5 w-3.5" /></Button>
                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0 rounded-lg"><Star className="h-3.5 w-3.5" /></Button>
                </div>
              </div>
            </div>
          );
        }

        return (
          <div key={creative.id} className="group relative rounded-[20px] border border-border/25 bg-card overflow-hidden hover:shadow-lg hover:border-primary/15 transition-all duration-300">
            <div className="aspect-[4/5] bg-muted/30 relative overflow-hidden">
              {creative.file_url ? (
                <img src={creative.file_url} className="h-full w-full object-cover group-hover:scale-105 transition-transform duration-500" alt="" />
              ) : (
                <div className="h-full w-full flex items-center justify-center">
                  {creative.type === 'video' ? <Video className="h-8 w-8 text-muted-foreground/20" /> : <Image className="h-8 w-8 text-muted-foreground/20" />}
                </div>
              )}

              {/* Score badge */}
              <div className={`absolute top-3 right-3 perf-score ${getScoreColor(score)} backdrop-blur-sm`}>
                <TrendingUp className="h-3 w-3" />
                {score}
              </div>

              {/* AI badge */}
              {creative.source === 'ai-auto' && (
                <Badge className="absolute top-3 left-3 bg-violet-600/90 text-white text-[9px] gap-1 rounded-lg backdrop-blur-sm border-0">
                  <Sparkles className="h-2.5 w-2.5" />
                  AI
                </Badge>
              )}

              {/* Hover overlay */}
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between">
                  <div className="flex gap-1.5">
                    <Button size="sm" className="h-8 rounded-lg bg-white/20 backdrop-blur-md border border-white/20 text-white text-xs hover:bg-white/30">
                      <Eye className="h-3 w-3 mr-1" />
                      View
                    </Button>
                    <Button size="sm" className="h-8 rounded-lg bg-white/20 backdrop-blur-md border border-white/20 text-white text-xs hover:bg-white/30">
                      <Copy className="h-3 w-3 mr-1" />
                      Iterate
                    </Button>
                  </div>
                  <Button size="sm" className="h-8 w-8 p-0 rounded-lg bg-white/20 backdrop-blur-md border border-white/20 text-white hover:bg-white/30">
                    <Bookmark className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </div>

            <div className="p-3.5">
              <h4 className="text-[13px] font-semibold truncate">{creative.title}</h4>
              <p className="text-[11px] text-muted-foreground/50 mt-0.5 truncate">
                {clientMap[creative.client_id] || 'Unknown'} · {creative.platform}
              </p>
              <div className="flex items-center gap-1.5 mt-2.5 flex-wrap">
                {tags.slice(0, 2).map(tag => (
                  <span key={tag} className="text-[9px] font-medium px-2 py-0.5 rounded-full bg-muted/60 text-muted-foreground/70">{tag}</span>
                ))}
              </div>
              <p className="text-[10px] text-muted-foreground/30 mt-2">
                {formatDistanceToNow(new Date(creative.created_at), { addSuffix: true })}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
              <Layers className="h-4.5 w-4.5 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Creative Library</h1>
              <p className="text-sm text-muted-foreground/50">Organize, score, and iterate on your best creatives</p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="rounded-xl gap-2 text-xs" onClick={() => setShowNewBoard(true)}>
            <FolderPlus className="h-3.5 w-3.5" />
            New Board
          </Button>
          <Button size="sm" className="rounded-xl gap-2 text-xs bg-primary">
            <Plus className="h-3.5 w-3.5" />
            Add Creative
          </Button>
        </div>
      </div>

      {/* Breadcrumb */}
      {renderBreadcrumb()}

      {/* Toolbar */}
      {(selectedFolder || selectedBoard) && (
        <div className="apple-toolbar p-2 flex items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/40" />
            <input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search creatives..."
              className="w-full pl-10 pr-4 h-9 bg-transparent text-sm placeholder:text-muted-foreground/30 focus:outline-none"
            />
          </div>
          <div className="flex items-center gap-1 border-l border-border/30 pl-2">
            <button
              onClick={() => setViewMode('grid')}
              className={`h-8 w-8 rounded-lg flex items-center justify-center transition-colors ${viewMode === 'grid' ? 'bg-primary/10 text-primary' : 'text-muted-foreground/50 hover:bg-muted/50'}`}
            >
              <LayoutGrid className="h-4 w-4" />
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`h-8 w-8 rounded-lg flex items-center justify-center transition-colors ${viewMode === 'list' ? 'bg-primary/10 text-primary' : 'text-muted-foreground/50 hover:bg-muted/50'}`}
            >
              <List className="h-4 w-4" />
            </button>
          </div>
          <Select value={filterTag} onValueChange={setFilterTag}>
            <SelectTrigger className="w-[130px] h-8 rounded-xl bg-transparent border-border/30 text-xs">
              <Filter className="h-3 w-3 mr-1.5 text-muted-foreground/50" />
              <SelectValue placeholder="All Tags" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Tags</SelectItem>
              {TAGS.map(tag => <SelectItem key={tag} value={tag}>{tag}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={sortBy} onValueChange={setSortBy}>
            <SelectTrigger className="w-[130px] h-8 rounded-xl bg-transparent border-border/30 text-xs">
              <ArrowUpDown className="h-3 w-3 mr-1.5 text-muted-foreground/50" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="newest">Newest</SelectItem>
              <SelectItem value="score">Top Score</SelectItem>
              <SelectItem value="name">Name A-Z</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Content */}
      {!selectedFolder && renderFolderView()}
      {selectedFolder && !selectedBoard && renderBoardView()}
      {selectedBoard && renderCreativeCards()}

      {/* Stats bar */}
      <div className="flex items-center justify-center gap-6 py-3 text-[11px] text-muted-foreground/30">
        <span>{creatives.length} creatives</span>
        <span>·</span>
        <span>{SAMPLE_FOLDERS.length} folders</span>
        <span>·</span>
        <span>{SAMPLE_FOLDERS.reduce((acc, f) => acc + f.boards.length, 0)} boards</span>
      </div>

      {/* New Board Dialog */}
      <Dialog open={showNewBoard} onOpenChange={setShowNewBoard}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FolderPlus className="h-5 w-5 text-primary" />
              Create New Board
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div>
              <label className="text-xs font-medium text-muted-foreground/70 mb-1.5 block">Board Name</label>
              <Input
                value={newBoardName}
                onChange={e => setNewBoardName(e.target.value)}
                placeholder="e.g., Q2 Meta Hooks"
                className="rounded-xl"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground/70 mb-1.5 block">Folder</label>
              <Select value={newBoardFolder} onValueChange={setNewBoardFolder}>
                <SelectTrigger className="rounded-xl">
                  <SelectValue placeholder="Choose folder..." />
                </SelectTrigger>
                <SelectContent>
                  {SAMPLE_FOLDERS.map(f => (
                    <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button className="w-full rounded-xl" onClick={() => setShowNewBoard(false)}>
              Create Board
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
