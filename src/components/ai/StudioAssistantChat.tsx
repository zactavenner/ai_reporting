import { useEffect, useRef, useState } from 'react';
import { Send, Trash2, Loader2, Sparkles, ChevronDown, ChevronRight, Wrench, MessageSquare, Paperclip, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import ReactMarkdown from 'react-markdown';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

type ToolEvent = { name: string; args: any; result: any };
type Message = {
  role: 'user' | 'assistant';
  content: string;
  tool_events?: ToolEvent[];
  attachments?: Attachment[];
};
type Attachment = { kind: 'image' | 'pdf'; url?: string; data?: string; name?: string };
type Thread = { id: string; title: string; updatedAt: number; messages: Message[] };

const THREADS_KEY = 'studio-assistant-threads-v2';
const ACTIVE_KEY = 'studio-assistant-active-v2';

function loadThreads(): Thread[] {
  try { const raw = localStorage.getItem(THREADS_KEY); if (raw) return JSON.parse(raw); } catch {}
  return [];
}
function saveThreads(t: Thread[]) { localStorage.setItem(THREADS_KEY, JSON.stringify(t)); }

const QUICK = [
  'Top 5 clients by funded $ last 30 days',
  'Which clients have spend but 0 leads today?',
  'Show Sajid\'s in-progress tasks',
  'Text Zac: "Daily report is ready" (find his number)',
];

export function StudioAssistantChat() {
  const [threads, setThreads] = useState<Thread[]>(() => loadThreads());
  const [activeId, setActiveId] = useState<string>(() => localStorage.getItem(ACTIVE_KEY) || '');
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [showThreads, setShowThreads] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // bootstrap default thread
  useEffect(() => {
    if (threads.length === 0) {
      const t: Thread = { id: crypto.randomUUID(), title: 'New conversation', updatedAt: Date.now(), messages: [] };
      setThreads([t]); setActiveId(t.id); saveThreads([t]); localStorage.setItem(ACTIVE_KEY, t.id);
    } else if (!activeId || !threads.find(t => t.id === activeId)) {
      setActiveId(threads[0].id); localStorage.setItem(ACTIVE_KEY, threads[0].id);
    }
  }, []);

  const active = threads.find(t => t.id === activeId);
  const messages = active?.messages || [];

  const updateActive = (fn: (m: Message[]) => Message[]) => {
    setThreads(prev => {
      const next = prev.map(t => t.id === activeId ? { ...t, messages: fn(t.messages), updatedAt: Date.now(), title: t.messages.length === 0 ? (input.slice(0, 40) || t.title) : t.title } : t);
      saveThreads(next);
      return next;
    });
  };

  useEffect(() => {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    });
  }, [messages.length]);
  useEffect(() => { taRef.current?.focus(); }, []);

  const newThread = () => {
    const t: Thread = { id: crypto.randomUUID(), title: 'New conversation', updatedAt: Date.now(), messages: [] };
    const next = [t, ...threads]; setThreads(next); setActiveId(t.id);
    saveThreads(next); localStorage.setItem(ACTIVE_KEY, t.id);
    setShowThreads(false);
    requestAnimationFrame(() => taRef.current?.focus());
  };
  const selectThread = (id: string) => { setActiveId(id); localStorage.setItem(ACTIVE_KEY, id); setShowThreads(false); };
  const deleteThread = (id: string) => {
    const next = threads.filter(t => t.id !== id); setThreads(next); saveThreads(next);
    if (id === activeId) {
      const nid = next[0]?.id || '';
      setActiveId(nid); localStorage.setItem(ACTIVE_KEY, nid);
      if (!nid) newThread();
    }
  };

  const onFile = async (files: FileList | null) => {
    if (!files) return;
    for (const f of Array.from(files)) {
      const isImage = f.type.startsWith('image/');
      const isPdf = f.type === 'application/pdf';
      if (!isImage && !isPdf) { toast({ title: 'Unsupported', description: f.name, variant: 'destructive' }); continue; }
      if (isImage) {
        // upload to assets bucket → public url
        const path = `studio-uploads/${Date.now()}-${f.name.replace(/[^\w.-]/g, '_')}`;
        const { error } = await supabase.storage.from('assets').upload(path, f, { upsert: false });
        if (error) { toast({ title: 'Upload failed', description: error.message, variant: 'destructive' }); continue; }
        const { data } = supabase.storage.from('assets').getPublicUrl(path);
        setAttachments(a => [...a, { kind: 'image', url: data.publicUrl, name: f.name }]);
      } else {
        const b64 = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result as string); r.onerror = rej; r.readAsDataURL(f); });
        setAttachments(a => [...a, { kind: 'pdf', data: b64, name: f.name }]);
      }
    }
  };

  const send = async (text: string) => {
    const t = text.trim();
    if ((!t && attachments.length === 0) || loading) return;
    const userMsg: Message = { role: 'user', content: t, attachments: attachments.length ? attachments : undefined };
    const next: Message[] = [...messages, userMsg];
    updateActive(() => next);
    setInput('');
    const sendAttachments = attachments;
    setAttachments([]);
    setLoading(true);
    try {
      const apiMessages = next.map(m => ({ role: m.role, content: m.content }));
      const { data, error } = await supabase.functions.invoke('studio-assistant', {
        body: { messages: apiMessages, attachments: sendAttachments },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      updateActive(m => [...m, {
        role: 'assistant',
        content: data?.content || '(no response)',
        tool_events: data?.tool_events || [],
      }]);
    } catch (e: any) {
      toast({ title: 'Assistant error', description: e.message, variant: 'destructive' });
      updateActive(m => [...m, { role: 'assistant', content: `⚠️ ${e.message}` }]);
    } finally {
      setLoading(false);
      requestAnimationFrame(() => taRef.current?.focus());
    }
  };

  const clear = () => updateActive(() => []);

  return (
    <Card className="flex h-[calc(100vh-260px)] min-h-[500px] overflow-hidden">
      {showThreads && (
        <div className="w-60 border-r flex flex-col bg-muted/30">
          <div className="p-2 border-b">
            <Button size="sm" className="w-full" onClick={newThread}><Plus className="h-3.5 w-3.5 mr-1"/>New thread</Button>
          </div>
          <ScrollArea className="flex-1">
            <div className="p-1 space-y-0.5">
              {threads.sort((a,b)=>b.updatedAt-a.updatedAt).map(t => (
                <div key={t.id} className={cn('group flex items-center gap-1 rounded px-2 py-1.5 text-xs cursor-pointer', t.id===activeId?'bg-primary/10':'hover:bg-muted')}>
                  <span className="flex-1 truncate" onClick={()=>selectThread(t.id)}>{t.title || 'Untitled'}</span>
                  <button onClick={()=>deleteThread(t.id)} className="opacity-0 group-hover:opacity-100"><X className="h-3 w-3"/></button>
                </div>
              ))}
            </div>
          </ScrollArea>
        </div>
      )}
    <div className="flex-1 flex flex-col">
      <div className="flex items-center justify-between p-3 border-b">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={()=>setShowThreads(s=>!s)} className="px-2">
            <MessageSquare className="h-4 w-4"/>
          </Button>
          <div className="h-8 w-8 rounded-full bg-primary/10 grid place-items-center">
            <Sparkles className="h-4 w-4 text-primary" />
          </div>
          <div>
            <p className="text-sm font-semibold">Studio Assistant</p>
            <p className="text-xs text-muted-foreground">{active?.title || 'New conversation'}</p>
          </div>
        </div>
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" onClick={newThread}><Plus className="h-3.5 w-3.5 mr-1"/>New</Button>
          <Button variant="ghost" size="sm" onClick={clear} disabled={!messages.length}>
            <Trash2 className="h-3.5 w-3.5 mr-1" /> Clear
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1 p-4" ref={scrollRef as any}>
        {messages.length === 0 ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground text-center py-4">
              Ask anything. Drop in screenshots or PDFs, send SMS/WhatsApp via GHL, generate images, manage tasks.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {QUICK.map(q => (
                <Button key={q} variant="outline" size="sm" className="justify-start text-left h-auto py-2 whitespace-normal" onClick={() => send(q)} disabled={loading}>
                  <MessageSquare className="h-3.5 w-3.5 mr-2 shrink-0" />
                  <span className="text-xs">{q}</span>
                </Button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((m, i) => (
              <MessageRow key={i} m={m} />
            ))}
            {loading && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Thinking...
              </div>
            )}
          </div>
        )}
      </ScrollArea>

      <div className="border-t p-3 space-y-2">
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {attachments.map((a, i) => (
              <div key={i} className="flex items-center gap-1 bg-muted rounded px-2 py-1 text-xs">
                {a.kind === 'image' && a.url ? <img src={a.url} className="h-6 w-6 object-cover rounded"/> : <Paperclip className="h-3 w-3"/>}
                <span className="truncate max-w-[140px]">{a.name}</span>
                <button onClick={()=>setAttachments(arr=>arr.filter((_,j)=>j!==i))}><X className="h-3 w-3"/></button>
              </div>
            ))}
          </div>
        )}
        <Textarea
          ref={taRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input); }
          }}
          placeholder="Ask, command, or drop an image/PDF..."
          disabled={loading}
          className="min-h-[60px] resize-none"
        />
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-2">
            <input ref={fileRef} type="file" multiple accept="image/*,application/pdf" className="hidden" onChange={e=>onFile(e.target.files)} />
            <Button variant="ghost" size="sm" onClick={()=>fileRef.current?.click()} disabled={loading}>
              <Paperclip className="h-3.5 w-3.5"/>
            </Button>
            <p className="text-[10px] text-muted-foreground">⏎ send · ⇧⏎ newline</p>
          </div>
          <Button onClick={() => send(input)} disabled={(!input.trim() && !attachments.length) || loading} size="sm">
            {loading ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Send className="h-3.5 w-3.5 mr-1" />}
            Send
          </Button>
        </div>
      </div>
    </div>
    </Card>
  );
}

function MessageRow({ m }: { m: Message }) {
  return (
    <div className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
      <div className={cn(
        'max-w-[88%] rounded-2xl px-4 py-2 text-sm',
        m.role === 'user' ? 'bg-primary text-primary-foreground rounded-br-md' : 'bg-muted rounded-bl-md'
      )}>
        {m.attachments && m.attachments.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-2">
            {m.attachments.map((a, i) => a.kind === 'image' && a.url ? (
              <img key={i} src={a.url} className="h-16 w-16 object-cover rounded border"/>
            ) : (
              <div key={i} className="flex items-center gap-1 bg-background/30 rounded px-2 py-1 text-xs"><Paperclip className="h-3 w-3"/>{a.name}</div>
            ))}
          </div>
        )}
        {m.role === 'assistant' ? (
          <div className="prose prose-sm dark:prose-invert max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
            <ReactMarkdown>{m.content}</ReactMarkdown>
          </div>
        ) : (
          <p className="whitespace-pre-wrap">{m.content}</p>
        )}
        {m.tool_events && m.tool_events.length > 0 && (
          <div className="mt-2 space-y-1">
            {m.tool_events.map((te, i) => <ToolEventRow key={i} te={te} />)}
          </div>
        )}
      </div>
    </div>
  );
}

function ToolEventRow({ te }: { te: ToolEvent }) {
  const [open, setOpen] = useState(false);
  const ok = !te.result?.error;
  const summary =
    te.name === 'query_table' ? `${te.args?.table} · ${te.result?.count ?? 0} rows` :
    te.name === 'send_sms' ? `${te.result?.sent ?? 0}/${te.result?.total ?? 0} sent (${te.args?.channel || 'SMS'})` :
    te.name === 'generate_image' ? (te.result?.url ? 'image generated' : 'failed') :
    te.name;
  return (
    <div className="border border-border/50 rounded-md bg-background/40 text-xs">
      <button className="w-full flex items-center gap-2 px-2 py-1.5 text-left" onClick={() => setOpen(o => !o)}>
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        <Wrench className="h-3 w-3" />
        <span className="font-mono">{te.name}</span>
        <Badge variant={ok ? 'secondary' : 'destructive'} className="text-[10px] ml-auto">{summary}</Badge>
      </button>
      {open && (
        <div className="px-2 pb-2 space-y-1">
          {te.name === 'generate_image' && te.result?.url && (
            <img src={te.result.url} alt="" className="rounded max-h-48 border" />
          )}
          <pre className="bg-muted/50 rounded p-2 overflow-auto max-h-48 text-[10px]">{JSON.stringify(te.args, null, 2)}</pre>
          <pre className="bg-muted/50 rounded p-2 overflow-auto max-h-48 text-[10px]">{JSON.stringify(te.result, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}