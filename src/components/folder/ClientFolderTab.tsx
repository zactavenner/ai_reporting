import { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { uploadWithProgress, formatFileSize } from '@/lib/uploadWithProgress';
import {
  Folder as FolderIcon, FolderPlus, Upload, Trash2, Download, Play, Pause,
  FileVideo, FileImage, File as FileGenericIcon, CheckCircle2, XCircle,
  ChevronRight, ChevronDown, Edit2, X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { AgentFolderInline } from '@/components/agents/AgentFolderInline';

interface ClientFolderTabProps {
  clientId: string;
  clientName: string;
}

interface FolderRow {
  id: string;
  client_id: string;
  name: string;
  parent_id: string | null;
  color: string | null;
  created_at: string;
}

interface FileRow {
  id: string;
  client_id: string;
  folder_id: string | null;
  file_name: string;
  file_url: string;
  file_type: string | null;
  file_size_bytes: number | null;
  storage_path: string | null;
  created_at: string;
}

interface CreativeRow {
  id: string;
  title: string;
  file_url: string | null;
  type: string;
  status: string;
  created_at: string;
}

interface QueueItem {
  file: File;
  progress: number;
  status: 'pending' | 'uploading' | 'done' | 'error';
  error?: string;
}

const MAX_FILE_BYTES = 20 * 1024 * 1024 * 1024; // 20 GB

const VIRTUAL_FOLDERS = [
  { id: '__approved__', name: 'Approved Ads', color: 'text-emerald-500', virtual: true as const },
  { id: '__declined__', name: 'Declined Ads', color: 'text-rose-500', virtual: true as const },
];

function getFileKind(mime: string | null, name: string): 'image' | 'video' | 'other' {
  const m = (mime || '').toLowerCase();
  if (m.startsWith('image/')) return 'image';
  if (m.startsWith('video/')) return 'video';
  const ext = name.split('.').pop()?.toLowerCase() || '';
  if (['mp4', 'mov', 'webm', 'mkv', 'avi'].includes(ext)) return 'video';
  if (['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'svg'].includes(ext)) return 'image';
  return 'other';
}

export function ClientFolderTab({ clientId, clientName }: ClientFolderTabProps) {
  const qc = useQueryClient();
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null); // null = root
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [renameTarget, setRenameTarget] = useState<FolderRow | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [preview, setPreview] = useState<{ url: string; kind: 'image' | 'video' | 'other'; name: string } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoPlaying, setVideoPlaying] = useState(false);

  // ── Queries ──────────────────────────────────────────────────────────
  const { data: folders = [] } = useQuery({
    queryKey: ['client-folders', clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('client_folders')
        .select('*')
        .eq('client_id', clientId)
        .order('name', { ascending: true });
      if (error) throw error;
      return data as FolderRow[];
    },
  });

  const { data: files = [] } = useQuery({
    queryKey: ['client-files', clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('client_file_uploads')
        .select('*')
        .eq('client_id', clientId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as FileRow[];
    },
  });

  const { data: creatives = [] } = useQuery({
    queryKey: ['client-creatives-folder', clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('creatives')
        .select('id,title,file_url,type,status,created_at')
        .eq('client_id', clientId)
        .in('status', ['approved', 'rejected'])
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as CreativeRow[];
    },
  });

  // ── Mutations ────────────────────────────────────────────────────────
  const createFolder = useMutation({
    mutationFn: async ({ name, parent_id }: { name: string; parent_id: string | null }) => {
      const { error } = await supabase.from('client_folders').insert({
        client_id: clientId, name, parent_id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['client-folders', clientId] });
      toast.success('Folder created');
      setNewFolderOpen(false);
      setNewFolderName('');
    },
    onError: (e: any) => toast.error(e.message || 'Failed'),
  });

  const renameFolder = useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      const { error } = await supabase.from('client_folders').update({ name }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['client-folders', clientId] });
      setRenameTarget(null);
      toast.success('Renamed');
    },
  });

  const deleteFolder = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('client_folders').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['client-folders', clientId] });
      qc.invalidateQueries({ queryKey: ['client-files', clientId] });
      if (folders.find(f => f.id === activeFolderId) == null) setActiveFolderId(null);
      toast.success('Folder deleted');
    },
  });

  const moveFile = useMutation({
    mutationFn: async ({ id, folder_id }: { id: string; folder_id: string | null }) => {
      const { error } = await supabase.from('client_file_uploads').update({ folder_id }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['client-files', clientId] }),
  });

  const deleteFile = useMutation({
    mutationFn: async (row: FileRow) => {
      if (row.storage_path) {
        await supabase.storage.from('client-uploads').remove([row.storage_path]);
      }
      const { error } = await supabase.from('client_file_uploads').delete().eq('id', row.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['client-files', clientId] });
      toast.success('File deleted');
    },
    onError: (e: any) => toast.error(e.message || 'Failed'),
  });

  // ── Upload handling ──────────────────────────────────────────────────
  const handleFiles = useCallback(async (selected: FileList | File[]) => {
    const arr = Array.from(selected);
    const valid: File[] = [];
    for (const f of arr) {
      if (f.size > MAX_FILE_BYTES) {
        toast.error(`${f.name} exceeds 20 GB limit`);
        continue;
      }
      valid.push(f);
    }
    if (!valid.length) return;
    const initial: QueueItem[] = valid.map(f => ({ file: f, progress: 0, status: 'pending' }));
    setQueue(q => [...q, ...initial]);
    const folderForUpload = typeof activeFolderId === 'string' && !activeFolderId.startsWith('__')
      ? activeFolderId : null;

    for (const item of initial) {
      setQueue(q => q.map(x => x.file === item.file ? { ...x, status: 'uploading' } : x));
      try {
        const safe = item.file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        const path = `${clientId}/folder/${Date.now()}_${safe}`;
        const url = await uploadWithProgress('client-uploads', path, item.file, (p) => {
          setQueue(q => q.map(x => x.file === item.file ? { ...x, progress: p } : x));
        });
        const { error } = await supabase.from('client_file_uploads').insert({
          client_id: clientId,
          folder_id: folderForUpload,
          file_name: item.file.name,
          file_url: url,
          file_type: item.file.type || null,
          file_size_bytes: item.file.size,
          storage_path: path,
        });
        if (error) throw error;
        setQueue(q => q.map(x => x.file === item.file ? { ...x, status: 'done', progress: 100 } : x));
      } catch (err: any) {
        setQueue(q => q.map(x => x.file === item.file ? { ...x, status: 'error', error: err.message } : x));
        toast.error(`${item.file.name}: ${err.message}`);
      }
    }
    qc.invalidateQueries({ queryKey: ['client-files', clientId] });
    // Auto-clear completed after delay
    setTimeout(() => setQueue(q => q.filter(x => x.status !== 'done')), 3000);
  }, [activeFolderId, clientId, qc]);

  // ── Drag and drop ────────────────────────────────────────────────────
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false);
    if (e.dataTransfer.files?.length) handleFiles(e.dataTransfer.files);
  };

  // ── Folder tree (root-level + nested) ────────────────────────────────
  const childrenOf = (parent: string | null) =>
    folders.filter(f => f.parent_id === parent);

  const renderFolderNode = (folder: FolderRow, depth: number): JSX.Element => {
    const kids = childrenOf(folder.id);
    const isOpen = expanded[folder.id] ?? true;
    const active = activeFolderId === folder.id;
    return (
      <div key={folder.id}>
        <div
          className={cn(
            'group flex items-center gap-1 rounded px-2 py-1.5 cursor-pointer text-sm',
            active ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-muted/50'
          )}
          style={{ paddingLeft: 8 + depth * 12 }}
          onClick={() => setActiveFolderId(folder.id)}
        >
          {kids.length > 0 ? (
            <button
              onClick={(e) => { e.stopPropagation(); setExpanded(s => ({ ...s, [folder.id]: !isOpen })); }}
              className="p-0.5 hover:bg-muted rounded"
            >
              {isOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            </button>
          ) : <span className="w-4" />}
          <FolderIcon className="h-4 w-4" />
          <span className="flex-1 truncate">{folder.name}</span>
          <button
            className="opacity-0 group-hover:opacity-100 p-1 hover:bg-muted rounded"
            onClick={(e) => { e.stopPropagation(); setRenameTarget(folder); setRenameValue(folder.name); }}
            title="Rename"
          ><Edit2 className="h-3 w-3" /></button>
          <button
            className="opacity-0 group-hover:opacity-100 p-1 hover:bg-destructive/20 rounded"
            onClick={(e) => {
              e.stopPropagation();
              if (confirm(`Delete folder "${folder.name}"? Files inside will move to root.`)) {
                deleteFolder.mutate(folder.id);
              }
            }}
            title="Delete"
          ><Trash2 className="h-3 w-3" /></button>
        </div>
        {isOpen && kids.map(k => renderFolderNode(k, depth + 1))}
      </div>
    );
  };

  // ── Displayed items in active pane ───────────────────────────────────
  const displayedItems = useMemo(() => {
    if (activeFolderId === '__approved__') {
      return creatives.filter(c => c.status === 'approved').map(c => ({
        kind: 'creative' as const, id: c.id, name: c.title, url: c.file_url || '',
        mime: c.type, size: null as number | null, created_at: c.created_at, badge: 'approved' as const,
      }));
    }
    if (activeFolderId === '__declined__') {
      return creatives.filter(c => c.status === 'rejected').map(c => ({
        kind: 'creative' as const, id: c.id, name: c.title, url: c.file_url || '',
        mime: c.type, size: null as number | null, created_at: c.created_at, badge: 'declined' as const,
      }));
    }
    const inFolder = files.filter(f => (f.folder_id || null) === activeFolderId);
    return inFolder.map(f => ({
      kind: 'file' as const, id: f.id, name: f.file_name, url: f.file_url,
      mime: f.file_type, size: f.file_size_bytes, created_at: f.created_at,
      raw: f, badge: null as null,
    }));
  }, [activeFolderId, files, creatives]);

  // ── Preview controls ─────────────────────────────────────────────────
  useEffect(() => { setVideoPlaying(false); }, [preview]);
  const togglePlay = () => {
    const v = videoRef.current; if (!v) return;
    if (v.paused) { v.play(); setVideoPlaying(true); }
    else { v.pause(); setVideoPlaying(false); }
  };

  const activeFolderName = activeFolderId === null
    ? 'All Files'
    : activeFolderId === '__approved__' ? 'Approved Ads'
    : activeFolderId === '__declined__' ? 'Declined Ads'
    : folders.find(f => f.id === activeFolderId)?.name || 'Folder';

  return (
    <div className="space-y-4">
      <AgentFolderInline clientId={clientId} clientName={clientName} />
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold">Folders — {clientName}</h2>
          <p className="text-sm text-muted-foreground">
            Approved & declined ads auto-sort. Upload up to 20 GB per file. Files persist.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setNewFolderOpen(true)}>
            <FolderPlus className="h-4 w-4 mr-1" /> New Folder
          </Button>
          <Button size="sm" onClick={() => fileInputRef.current?.click()}>
            <Upload className="h-4 w-4 mr-1" /> Upload
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => e.target.files && handleFiles(e.target.files)}
          />
        </div>
      </div>

      <div className="grid grid-cols-12 gap-4">
        {/* Sidebar: folder tree */}
        <aside className="col-span-12 md:col-span-3 rounded-lg border bg-card p-2 max-h-[70vh] overflow-auto">
          <div
            className={cn(
              'flex items-center gap-2 rounded px-2 py-1.5 cursor-pointer text-sm',
              activeFolderId === null ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-muted/50'
            )}
            onClick={() => setActiveFolderId(null)}
          >
            <FolderIcon className="h-4 w-4" />
            All Files <span className="ml-auto text-xs text-muted-foreground">{files.length}</span>
          </div>

          <div className="mt-2 mb-1 px-2 text-[10px] font-semibold uppercase text-muted-foreground tracking-wide">
            Auto-Sorted
          </div>
          {VIRTUAL_FOLDERS.map(vf => {
            const count = vf.id === '__approved__'
              ? creatives.filter(c => c.status === 'approved').length
              : creatives.filter(c => c.status === 'rejected').length;
            const Icon = vf.id === '__approved__' ? CheckCircle2 : XCircle;
            return (
              <div
                key={vf.id}
                className={cn(
                  'flex items-center gap-2 rounded px-2 py-1.5 cursor-pointer text-sm',
                  activeFolderId === vf.id ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-muted/50'
                )}
                onClick={() => setActiveFolderId(vf.id)}
              >
                <Icon className={cn('h-4 w-4', vf.color)} />
                <span className="flex-1 truncate">{vf.name}</span>
                <span className="text-xs text-muted-foreground">{count}</span>
              </div>
            );
          })}

          <div className="mt-3 mb-1 px-2 text-[10px] font-semibold uppercase text-muted-foreground tracking-wide">
            My Folders
          </div>
          {childrenOf(null).length === 0 ? (
            <div className="px-2 py-2 text-xs text-muted-foreground">No folders yet.</div>
          ) : childrenOf(null).map(f => renderFolderNode(f, 0))}
        </aside>

        {/* Main panel */}
        <section
          className={cn(
            'col-span-12 md:col-span-9 rounded-lg border bg-card p-4 min-h-[60vh]',
            dragOver && 'ring-2 ring-primary'
          )}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
        >
          <div className="flex items-center justify-between mb-3">
            <div className="font-medium">{activeFolderName} <span className="text-muted-foreground text-sm">({displayedItems.length})</span></div>
            <div className="text-xs text-muted-foreground hidden md:block">Drag & drop files anywhere here to upload</div>
          </div>

          {queue.length > 0 && (
            <div className="mb-4 space-y-2 rounded-md border bg-muted/30 p-3">
              {queue.map((q, i) => (
                <div key={i} className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="truncate">{q.file.name} <span className="text-muted-foreground">({formatFileSize(q.file.size)})</span></span>
                    <span className="text-muted-foreground">{q.status === 'error' ? q.error : `${q.progress}%`}</span>
                  </div>
                  <Progress value={q.progress} className="h-1" />
                </div>
              ))}
            </div>
          )}

          {displayedItems.length === 0 ? (
            <div className="text-center py-16 text-sm text-muted-foreground">
              <Upload className="h-10 w-10 mx-auto mb-3 opacity-40" />
              Empty folder — drop files here or click Upload.
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
              {displayedItems.map(item => {
                const kind = getFileKind(item.mime, item.name);
                return (
                  <div key={item.id} className="group relative rounded-lg border bg-background overflow-hidden">
                    <button
                      className="block w-full aspect-square bg-muted/40 relative"
                      onClick={() => item.url && setPreview({ url: item.url, kind, name: item.name })}
                    >
                      {kind === 'image' && item.url ? (
                        <img src={item.url} alt={item.name} className="w-full h-full object-cover" loading="lazy" />
                      ) : kind === 'video' && item.url ? (
                        <>
                          <video src={item.url} className="w-full h-full object-cover" muted preload="metadata" />
                          <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                            <Play className="h-8 w-8 text-white drop-shadow" />
                          </div>
                        </>
                      ) : (
                        <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                          <FileGenericIcon className="h-10 w-10" />
                        </div>
                      )}
                      {item.badge && (
                        <span className={cn(
                          'absolute top-1 left-1 px-1.5 py-0.5 rounded text-[10px] font-medium',
                          item.badge === 'approved' ? 'bg-emerald-500/90 text-white' : 'bg-rose-500/90 text-white'
                        )}>
                          {item.badge}
                        </span>
                      )}
                    </button>
                    <div className="p-2 space-y-1">
                      <div className="text-xs font-medium truncate" title={item.name}>{item.name}</div>
                      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                        <span>{item.size ? formatFileSize(item.size) : kind}</span>
                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition">
                          {item.url && (
                            <a href={item.url} download={item.name} target="_blank" rel="noopener noreferrer"
                              className="p-1 hover:bg-muted rounded" title="Download">
                              <Download className="h-3 w-3" />
                            </a>
                          )}
                          {item.kind === 'file' && (
                            <button
                              className="p-1 hover:bg-destructive/20 rounded"
                              onClick={() => {
                                if (confirm(`Delete "${item.name}"?`)) deleteFile.mutate(item.raw);
                              }}
                              title="Delete"
                            ><Trash2 className="h-3 w-3" /></button>
                          )}
                        </div>
                      </div>
                      {item.kind === 'file' && folders.length > 0 && (
                        <select
                          className="w-full text-[10px] bg-muted/30 rounded px-1 py-0.5 border-0"
                          value={item.raw.folder_id || ''}
                          onChange={(e) => moveFile.mutate({ id: item.id, folder_id: e.target.value || null })}
                        >
                          <option value="">— Root —</option>
                          {folders.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                        </select>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {/* New folder dialog */}
      <Dialog open={newFolderOpen} onOpenChange={setNewFolderOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>New Folder</DialogTitle></DialogHeader>
          <Input
            placeholder="Folder name"
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewFolderOpen(false)}>Cancel</Button>
            <Button
              onClick={() => newFolderName.trim() && createFolder.mutate({
                name: newFolderName.trim(),
                parent_id: activeFolderId && !activeFolderId.startsWith('__') ? activeFolderId : null,
              })}
              disabled={!newFolderName.trim() || createFolder.isPending}
            >Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename dialog */}
      <Dialog open={!!renameTarget} onOpenChange={(o) => !o && setRenameTarget(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Rename Folder</DialogTitle></DialogHeader>
          <Input value={renameValue} onChange={(e) => setRenameValue(e.target.value)} autoFocus />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameTarget(null)}>Cancel</Button>
            <Button
              onClick={() => renameTarget && renameValue.trim() && renameFolder.mutate({ id: renameTarget.id, name: renameValue.trim() })}
              disabled={!renameValue.trim()}
            >Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Preview dialog */}
      <Dialog open={!!preview} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent className="max-w-4xl">
          <DialogHeader><DialogTitle className="truncate">{preview?.name}</DialogTitle></DialogHeader>
          <div className="bg-black/80 rounded-lg overflow-hidden flex items-center justify-center min-h-[300px]">
            {preview?.kind === 'image' && (
              <img src={preview.url} alt={preview.name} className="max-h-[70vh] w-auto" />
            )}
            {preview?.kind === 'video' && (
              <div className="relative w-full">
                <video
                  ref={videoRef}
                  src={preview.url}
                  className="w-full max-h-[70vh]"
                  controls
                  onPlay={() => setVideoPlaying(true)}
                  onPause={() => setVideoPlaying(false)}
                />
                <button
                  onClick={togglePlay}
                  className="absolute bottom-3 left-3 bg-black/60 text-white rounded-full p-2 hover:bg-black/80"
                >
                  {videoPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                </button>
              </div>
            )}
            {preview?.kind === 'other' && (
              <div className="text-white p-8 text-center">
                <FileGenericIcon className="h-12 w-12 mx-auto mb-3 opacity-60" />
                <p className="mb-3 text-sm">No inline preview for this file type.</p>
                <a href={preview.url} download={preview.name} target="_blank" rel="noopener noreferrer">
                  <Button size="sm" variant="secondary"><Download className="h-4 w-4 mr-1" /> Download</Button>
                </a>
              </div>
            )}
          </div>
          {preview && (
            <DialogFooter>
              <a href={preview.url} download={preview.name} target="_blank" rel="noopener noreferrer">
                <Button variant="outline" size="sm"><Download className="h-4 w-4 mr-1" /> Download</Button>
              </a>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}