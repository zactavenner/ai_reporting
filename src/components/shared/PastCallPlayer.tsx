import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Popover, PopoverContent, PopoverTrigger,
} from '@/components/ui/popover';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Play, Pause, Loader2, ChevronDown, ChevronUp, FileAudio, Plus, Check } from 'lucide-react';
import { toast } from 'sonner';
import {
  detectCategory, suggestAssignee, rememberCategoryAssignee,
  CATEGORY_LABEL, type MemberLite, type TaskCategory,
} from '@/lib/callTasks';
import { useTeamMember } from '@/contexts/TeamMemberContext';

interface Props {
  /** Public/signed URL prefix — same bucket, same object path convention */
  recordingUrl: string | null;
  transcript: string | null;
  summary: string | null;
  proposedTasks: Array<{ title: string; priority?: string }> | null;
  storageBucket?: string; // default weekly-call-recordings
  /** Called after a task is created — for parent list refresh */
  onTaskCreated?: (payload: { title: string; assignee_id: string | null; category: TaskCategory }) => Promise<void> | void;
  /** Optional client scope for the created task */
  clientId?: string | null;
  /** Extra fields merged into the tasks insert (e.g. { huddle_id }) */
  taskExtras?: Record<string, any>;
}

export function PastCallPlayer({
  recordingUrl, transcript, summary, proposedTasks,
  storageBucket = 'weekly-call-recordings',
  onTaskCreated, clientId, taskExtras,
}: Props) {
  const { currentMember } = useTeamMember();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [loadingUrl, setLoadingUrl] = useState(false);
  const [duration, setDuration] = useState<number>(0);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [playing, setPlaying] = useState(false);
  const [expandedTranscript, setExpandedTranscript] = useState(false);
  const [members, setMembers] = useState<MemberLite[]>([]);
  const [creating, setCreating] = useState<number | null>(null);
  const [createdIdx, setCreatedIdx] = useState<Set<number>>(new Set());

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('agency_members').select('id,name,role').order('name');
      setMembers((data as MemberLite[]) || []);
    })();
  }, []);

  const ensureSignedUrl = async () => {
    if (signedUrl || !recordingUrl) return signedUrl;
    setLoadingUrl(true);
    try {
      const marker = `/${storageBucket}/`;
      const idx = recordingUrl.indexOf(marker);
      if (idx === -1) { setSignedUrl(recordingUrl); return recordingUrl; }
      const path = recordingUrl.slice(idx + marker.length).split('?')[0];
      const { data, error } = await supabase.storage.from(storageBucket).createSignedUrl(path, 3600);
      if (error || !data?.signedUrl) throw error || new Error('no url');
      setSignedUrl(data.signedUrl);
      return data.signedUrl;
    } catch (e: any) {
      toast.error(e?.message || 'Could not load recording');
      return null;
    } finally {
      setLoadingUrl(false);
    }
  };

  const togglePlay = async () => {
    const url = await ensureSignedUrl();
    if (!url) return;
    setExpandedTranscript(true);
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) { await a.play(); setPlaying(true); }
    else { a.pause(); setPlaying(false); }
  };

  const words = useMemo(() => (transcript || '').split(/(\s+)/), [transcript]);
  const wordIndexes = useMemo(() => words.map((w, i) => (/\S/.test(w) ? i : -1)).filter(i => i >= 0), [words]);
  const activeWordIdx = useMemo(() => {
    if (!duration || !wordIndexes.length) return -1;
    const ratio = Math.min(1, Math.max(0, currentTime / duration));
    const pos = Math.floor(ratio * wordIndexes.length);
    return wordIndexes[Math.min(pos, wordIndexes.length - 1)] ?? -1;
  }, [currentTime, duration, wordIndexes]);

  const seekToWord = (idx: number) => {
    const a = audioRef.current;
    if (!a || !duration || !wordIndexes.length) return;
    const rank = wordIndexes.indexOf(idx);
    if (rank < 0) return;
    const t = (rank / wordIndexes.length) * duration;
    a.currentTime = t;
    setCurrentTime(t);
    if (a.paused) { a.play(); setPlaying(true); }
  };

  const fmt = (s: number) => {
    if (!isFinite(s)) return '0:00';
    const m = Math.floor(s / 60), r = Math.floor(s % 60);
    return `${m}:${r.toString().padStart(2, '0')}`;
  };

  const createTask = async (idx: number, task: { title: string; priority?: string }, override?: MemberLite | null) => {
    setCreating(idx);
    try {
      const cat = detectCategory(task.title);
      const assignee = override ?? suggestAssignee(task.title, members);
      if (assignee) rememberCategoryAssignee(cat, assignee.name);
      const insert: any = {
        title: task.title,
        status: 'todo',
        stage: 'to-do',
        priority: task.priority || 'medium',
        category: CATEGORY_LABEL[cat],
        assigned_to: assignee?.name || null,
        created_by: currentMember?.id ?? null,
        source: 'call-recap',
        ...(clientId ? { client_id: clientId } : {}),
        ...(taskExtras || {}),
      };
      const { error } = await (supabase as any).from('tasks').insert(insert);
      if (error) throw error;
      setCreatedIdx((s) => new Set(s).add(idx));
      toast.success(`Task assigned to ${assignee?.name || 'unassigned'}`);
      await onTaskCreated?.({ title: task.title, assignee_id: assignee?.id || null, category: cat });
    } catch (e: any) {
      toast.error(e?.message || 'Failed to create task');
    } finally {
      setCreating(null);
    }
  };

  return (
    <div className="space-y-3">
      {/* Player */}
      {recordingUrl ? (
        <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
          <div className="flex items-center gap-3">
            <Button size="sm" variant="default" onClick={togglePlay} disabled={loadingUrl} className="gap-1">
              {loadingUrl ? <Loader2 className="w-4 h-4 animate-spin" /> :
                playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
              {playing ? 'Pause' : 'Play recording'}
            </Button>
            <div className="text-xs text-muted-foreground tabular-nums">{fmt(currentTime)} / {fmt(duration)}</div>
            <FileAudio className="w-3.5 h-3.5 text-muted-foreground ml-auto" />
          </div>
          {signedUrl && (
            <audio
              ref={audioRef}
              src={signedUrl}
              onLoadedMetadata={(e) => setDuration((e.currentTarget as HTMLAudioElement).duration || 0)}
              onTimeUpdate={(e) => setCurrentTime((e.currentTarget as HTMLAudioElement).currentTime || 0)}
              onEnded={() => setPlaying(false)}
              onPause={() => setPlaying(false)}
              onPlay={() => setPlaying(true)}
              controls
              className="w-full h-8"
            />
          )}
        </div>
      ) : null}

      {/* Summary */}
      {summary && (
        <div className="space-y-1">
          <div className="text-xs font-semibold">Summary of call</div>
          <div className="text-xs whitespace-pre-wrap bg-muted/40 rounded p-2 border leading-relaxed">{summary}</div>
        </div>
      )}

      {/* Action items with auto-assign */}
      {proposedTasks && proposedTasks.length > 0 && (
        <div className="space-y-1.5 border-t pt-2">
          <div className="text-xs font-semibold">Action items ({proposedTasks.length})</div>
          <ul className="space-y-1.5">
            {proposedTasks.map((t, i) => {
              const cat = detectCategory(t.title);
              const suggested = suggestAssignee(t.title, members);
              const done = createdIdx.has(i);
              return (
                <li key={i} className="text-xs flex items-start gap-2 bg-background rounded border p-2">
                  <span className="mt-0.5 text-muted-foreground">•</span>
                  <div className="flex-1 space-y-1">
                    <div>{t.title}</div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <Badge variant="secondary" className="text-[9px]">{CATEGORY_LABEL[cat]}</Badge>
                      {t.priority && <Badge variant="outline" className="text-[9px]">{t.priority}</Badge>}
                      {suggested && !done && (
                        <span className="text-[10px] text-muted-foreground">→ {suggested.name}</span>
                      )}
                    </div>
                  </div>
                  {done ? (
                    <Badge variant="outline" className="gap-1 text-[10px]"><Check className="w-3 h-3" />added</Badge>
                  ) : (
                    <div className="flex items-center gap-1">
                      <Button
                        size="sm"
                        variant="default"
                        className="h-6 px-2 text-[10px] gap-1"
                        onClick={() => createTask(i, t)}
                        disabled={creating === i}
                      >
                        {creating === i ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                        Add task
                      </Button>
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button size="icon" variant="ghost" className="h-6 w-6" title="Reassign">
                            <ChevronDown className="w-3 h-3" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent align="end" className="w-56 p-2 space-y-2">
                          <div className="text-[11px] font-medium">Assign to</div>
                          <Select
                            defaultValue={suggested?.id || ''}
                            onValueChange={(id) => {
                              const m = members.find((x) => x.id === id) || null;
                              createTask(i, t, m);
                            }}
                          >
                            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Pick member" /></SelectTrigger>
                            <SelectContent>
                              {members.map((m) => (
                                <SelectItem key={m.id} value={m.id} className="text-xs">{m.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </PopoverContent>
                      </Popover>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Transcript with word-level highlight + click-to-seek */}
      {transcript && (
        <div className="border-t pt-2">
          <button
            type="button"
            onClick={() => setExpandedTranscript((v) => !v)}
            className="text-xs flex items-center gap-1 text-muted-foreground hover:text-foreground"
          >
            {expandedTranscript ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            {expandedTranscript ? 'Hide transcript' : 'Show transcript (click a word to jump)'}
          </button>
          {expandedTranscript && (
            <div className="mt-2 text-[12px] leading-relaxed bg-muted/30 rounded p-3 border max-h-96 overflow-y-auto">
              {words.map((w, i) => {
                if (!/\S/.test(w)) return <span key={i}>{w}</span>;
                const isActive = i === activeWordIdx;
                return (
                  <span
                    key={i}
                    onClick={() => seekToWord(i)}
                    className={
                      'cursor-pointer rounded px-0.5 transition-colors ' +
                      (isActive
                        ? 'bg-primary text-primary-foreground font-medium'
                        : 'hover:bg-primary/10')
                    }
                  >
                    {w}
                  </span>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}