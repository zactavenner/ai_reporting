import { useEffect, useRef, useState } from 'react';
import { Send, Trash2, Loader2, Sparkles, ChevronDown, ChevronRight, Wrench, MessageSquare } from 'lucide-react';
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
};

const STORAGE_KEY = 'studio-assistant-conversation-v1';

const QUICK = [
  'Top 5 clients by funded $ last 30 days',
  'Which clients have spend but 0 leads today?',
  'Show Sajid\'s in-progress tasks',
  'Text Zac: "Daily report is ready" (find his number)',
];

export function StudioAssistantChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setMessages(JSON.parse(raw));
    } catch {}
  }, []);
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    });
  }, [messages]);
  useEffect(() => { taRef.current?.focus(); }, []);

  const send = async (text: string) => {
    const t = text.trim();
    if (!t || loading) return;
    const next: Message[] = [...messages, { role: 'user', content: t }];
    setMessages(next);
    setInput('');
    setLoading(true);
    try {
      const apiMessages = next.map(m => ({ role: m.role, content: m.content }));
      const { data, error } = await supabase.functions.invoke('studio-assistant', {
        body: { messages: apiMessages },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setMessages(m => [...m, {
        role: 'assistant',
        content: data?.content || '(no response)',
        tool_events: data?.tool_events || [],
      }]);
    } catch (e: any) {
      toast({ title: 'Assistant error', description: e.message, variant: 'destructive' });
      setMessages(m => [...m, { role: 'assistant', content: `⚠️ ${e.message}` }]);
    } finally {
      setLoading(false);
      requestAnimationFrame(() => taRef.current?.focus());
    }
  };

  const clear = () => {
    setMessages([]);
    localStorage.removeItem(STORAGE_KEY);
  };

  return (
    <Card className="flex flex-col h-[calc(100vh-260px)] min-h-[500px]">
      <div className="flex items-center justify-between p-3 border-b">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-full bg-primary/10 grid place-items-center">
            <Sparkles className="h-4 w-4 text-primary" />
          </div>
          <div>
            <p className="text-sm font-semibold">Studio Assistant</p>
            <p className="text-xs text-muted-foreground">Query data · send SMS/WhatsApp · generate media</p>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={clear} disabled={!messages.length}>
          <Trash2 className="h-3.5 w-3.5 mr-1" /> Clear
        </Button>
      </div>

      <ScrollArea className="flex-1 p-4" ref={scrollRef as any}>
        {messages.length === 0 ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground text-center py-4">
              Ask anything about the app. I can query the database, send SMS/WhatsApp via the HPA GHL account, and generate images for MMS.
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
        <Textarea
          ref={taRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input); }
          }}
          placeholder="Ask, command, or 'text Sajid that the report is ready'..."
          disabled={loading}
          className="min-h-[60px] resize-none"
        />
        <div className="flex justify-between items-center">
          <p className="text-[10px] text-muted-foreground">⏎ to send · ⇧⏎ for newline</p>
          <Button onClick={() => send(input)} disabled={!input.trim() || loading} size="sm">
            {loading ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Send className="h-3.5 w-3.5 mr-1" />}
            Send
          </Button>
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