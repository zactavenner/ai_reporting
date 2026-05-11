import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Sparkles, FileText, Table as TableIcon, Image as ImageIcon, Send, Loader2, ExternalLink, Copy, Wand2, Square } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAgencySettings } from '@/hooks/useAgencySettings';
import { toast } from 'sonner';

interface Props {
  clientId: string;
  clientName: string;
}

type Msg = { role: 'user' | 'assistant'; content: string; tools?: any[] };

const SUGGESTIONS = [
  { icon: <FileText className="h-4 w-4" />, label: 'Summarize the master doc' },
  { icon: <TableIcon className="h-4 w-4" />, label: 'Read the first 20 rows of the sheet' },
  { icon: <Wand2 className="h-4 w-4" />, label: 'Append a weekly recap section to the doc' },
  { icon: <ImageIcon className="h-4 w-4" />, label: 'Generate a 1:1 ad creative for our offer' },
];

export function AIStudioTab({ clientId, clientName }: Props) {
  const { data: agencySettings } = useAgencySettings();
  const [docUrl, setDocUrl] = useState<string>('');
  const [sheetUrl, setSheetUrl] = useState<string>('');
  const [imageModel, setImageModel] = useState<'nano-banana-2' | 'gpt-image'>('nano-banana-2');
  const storageKey = `ai-studio:${clientId}`;
  const [hydrated, setHydrated] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [generatedImages, setGeneratedImages] = useState<{ url: string; prompt: string }[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Hydrate from localStorage per client
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        setMessages(parsed.messages || []);
        setGeneratedImages(parsed.generatedImages || []);
        if (parsed.docUrl) setDocUrl(parsed.docUrl);
        if (parsed.sheetUrl) setSheetUrl(parsed.sheetUrl);
        if (parsed.imageModel) setImageModel(parsed.imageModel);
      } else {
        setMessages([]);
        setGeneratedImages([]);
      }
    } catch {}
    setHydrated(true);
  }, [storageKey]);

  // Persist on change
  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(
        storageKey,
        JSON.stringify({ messages, generatedImages, docUrl, sheetUrl, imageModel }),
      );
    } catch {}
  }, [hydrated, storageKey, messages, generatedImages, docUrl, sheetUrl, imageModel]);

  // Default URLs from agency settings
  useEffect(() => {
    if (!docUrl && agencySettings?.kpi_google_doc_url) setDocUrl(agencySettings.kpi_google_doc_url);
    if (!sheetUrl && agencySettings?.kpi_google_sheet_url) setSheetUrl(agencySettings.kpi_google_sheet_url);
  }, [agencySettings]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, loading]);

  async function send(text: string) {
    if (!text.trim() || loading) return;
    const baseHistory = messages.map(m => ({ role: m.role, content: m.content }));
    const next: Msg[] = [
      ...messages,
      { role: 'user', content: text },
      { role: 'assistant', content: '', tools: [] },
    ];
    setMessages(next);
    const assistantIdx = next.length - 1;
    setInput('');
    setLoading(true);
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    const updateAssistant = (mut: (m: Msg) => Msg) => {
      setMessages(curr => {
        const copy = curr.slice();
        if (copy[assistantIdx]) copy[assistantIdx] = mut(copy[assistantIdx]);
        return copy;
      });
    };

    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      const url = `https://${import.meta.env.VITE_SUPABASE_PROJECT_ID}.supabase.co/functions/v1/ai-studio`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string,
        },
        body: JSON.stringify({
          messages: [...baseHistory, { role: 'user', content: text }],
          docUrl: docUrl || undefined,
          sheetUrl: sheetUrl || undefined,
          defaultImageModel: imageModel,
          clientId,
        }),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) throw new Error(`Stream failed: ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() || '';
        for (const part of parts) {
          const line = part.split('\n').find(l => l.startsWith('data:'));
          if (!line) continue;
          let evt: any; try { evt = JSON.parse(line.slice(5).trim()); } catch { continue; }
          if (evt.type === 'text') {
            updateAssistant(m => ({ ...m, content: (m.content || '') + evt.delta }));
          } else if (evt.type === 'tool_start') {
            updateAssistant(m => ({
              ...m,
              tools: [...(m.tools || []), { id: evt.id, name: evt.name, args: evt.args, status: 'running' }],
            }));
          } else if (evt.type === 'tool_end') {
            updateAssistant(m => ({
              ...m,
              tools: (m.tools || []).map(t =>
                t.id === evt.id ? { ...t, result: evt.result, status: evt.result?.error ? 'error' : 'done' } : t,
              ),
            }));
            if (evt.name === 'generate_ad_image' && evt.result?.url) {
              setGeneratedImages(g => [{ url: evt.result.url, prompt: evt.args?.prompt || '' }, ...g]);
            }
          } else if (evt.type === 'error') {
            updateAssistant(m => ({ ...m, content: (m.content || '') + `\n\n⚠️ ${evt.message}` }));
            toast.error(evt.message);
          }
        }
      }
    } catch (e: any) {
      if (e?.name === 'AbortError') {
        updateAssistant(m => ({ ...m, content: (m.content || '') + '\n\n_(stopped)_' }));
      } else {
        toast.error(e?.message || 'AI Studio failed');
        updateAssistant(m => ({ ...m, content: (m.content || '') + `\n\nError: ${e?.message || e}` }));
      }
    } finally {
      abortRef.current = null;
      setLoading(false);
    }
  }

  function stop() {
    abortRef.current?.abort();
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr,1.1fr] gap-4 h-[calc(100vh-220px)] min-h-[600px]">
      {/* LEFT — Chat */}
      <Card className="flex flex-col overflow-hidden">
        <div className="p-4 border-b space-y-2">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <h3 className="font-semibold">AI Studio · {clientName}</h3>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <Input
              placeholder="Google Doc URL"
              value={docUrl}
              onChange={e => setDocUrl(e.target.value)}
              className="h-8 text-xs"
            />
            <Input
              placeholder="Google Sheet URL"
              value={sheetUrl}
              onChange={e => setSheetUrl(e.target.value)}
              className="h-8 text-xs"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Image model:</span>
            <Select value={imageModel} onValueChange={(v: any) => setImageModel(v)}>
              <SelectTrigger className="h-7 w-[200px] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="nano-banana-2">Nano Banana 2 (Gemini 3.1)</SelectItem>
                <SelectItem value="gpt-image">GPT Image (best for text)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <ScrollArea className="flex-1" ref={scrollRef as any}>
          <div className="p-4 space-y-4">
            {messages.length === 0 && (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">Ask anything about this client's doc, sheet, or generate an ad.</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {SUGGESTIONS.map(s => (
                    <Button key={s.label} variant="outline" size="sm" className="justify-start h-auto py-2" onClick={() => send(s.label)}>
                      {s.icon}<span className="ml-2 text-xs text-left">{s.label}</span>
                    </Button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((m, i) => {
              const isLast = i === messages.length - 1;
              const isEmptyAssistant = m.role === 'assistant' && !m.content && (!m.tools || m.tools.length === 0);
              if (isEmptyAssistant && !(loading && isLast)) return null;
              return (
                <div key={i} className={m.role === 'user' ? 'flex justify-end' : ''}>
                  <div className={`max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${m.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}>
                    {m.tools && m.tools.length > 0 && (
                      <div className="mb-2 space-y-1">
                        {m.tools.map((t: any, j: number) => (
                          <div key={j} className="text-xs flex items-center gap-2 opacity-80">
                            <Badge variant="secondary" className="text-[10px]">{t.name}</Badge>
                            {t.status === 'running' ? (
                              <span className="flex items-center gap-1 text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> running…</span>
                            ) : t.status === 'error' || t.result?.error ? (
                              <span className="text-destructive truncate max-w-[260px]">{t.result?.error || 'failed'}</span>
                            ) : (
                              <span>✓</span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                    {m.content || (loading && isLast && m.role === 'assistant' ? (
                      <span className="inline-flex items-center gap-1 text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> thinking…</span>
                    ) : null)}
                  </div>
                </div>
              );
            })}
          </div>
        </ScrollArea>

        <div className="p-3 border-t flex gap-2">
          <Textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input); } }}
            placeholder="Edit the doc, query the sheet, or generate an ad…"
            className="resize-none min-h-[44px] max-h-32"
            rows={1}
          />
          {loading ? (
            <Button onClick={stop} size="icon" variant="destructive" title="Stop">
              <Square className="h-4 w-4" />
            </Button>
          ) : (
            <Button onClick={() => send(input)} disabled={!input.trim()} size="icon">
              <Send className="h-4 w-4" />
            </Button>
          )}
        </div>
      </Card>

      {/* RIGHT — Canvas */}
      <Card className="flex flex-col overflow-hidden">
        <Tabs defaultValue="creatives" className="flex-1 flex flex-col">
          <TabsList className="m-2 self-start">
            <TabsTrigger value="creatives"><ImageIcon className="h-4 w-4 mr-1" /> Generated</TabsTrigger>
            <TabsTrigger value="doc"><FileText className="h-4 w-4 mr-1" /> Doc</TabsTrigger>
            <TabsTrigger value="sheet"><TableIcon className="h-4 w-4 mr-1" /> Sheet</TabsTrigger>
          </TabsList>

          <TabsContent value="creatives" className="flex-1 m-0 overflow-auto p-4">
            {generatedImages.length === 0 ? (
              <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
                Generated ad creatives will appear here.
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {generatedImages.map((img, i) => (
                  <div key={i} className="space-y-2 group">
                    <a href={img.url} target="_blank" rel="noopener noreferrer">
                      <img src={img.url} alt={img.prompt} className="w-full rounded-lg border" />
                    </a>
                    <div className="flex items-center gap-2">
                      <p className="text-xs text-muted-foreground line-clamp-2 flex-1">{img.prompt}</p>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { navigator.clipboard.writeText(img.url); toast.success('URL copied'); }}>
                        <Copy className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="doc" className="flex-1 m-0 overflow-hidden">
            {docUrl ? (
              <div className="h-full flex flex-col">
                <div className="px-4 py-2 border-b flex items-center justify-between">
                  <span className="text-xs text-muted-foreground truncate">{docUrl}</span>
                  <a href={docUrl} target="_blank" rel="noopener noreferrer" className="text-xs flex items-center gap-1 text-primary"><ExternalLink className="h-3 w-3" /> Open</a>
                </div>
                <iframe src={docUrl.replace(/\/edit.*$/, '/preview')} className="flex-1 w-full" title="Doc preview" />
              </div>
            ) : (
              <div className="h-full flex items-center justify-center text-sm text-muted-foreground">Add a Google Doc URL above.</div>
            )}
          </TabsContent>

          <TabsContent value="sheet" className="flex-1 m-0 overflow-hidden">
            {sheetUrl ? (
              <div className="h-full flex flex-col">
                <div className="px-4 py-2 border-b flex items-center justify-between">
                  <span className="text-xs text-muted-foreground truncate">{sheetUrl}</span>
                  <a href={sheetUrl} target="_blank" rel="noopener noreferrer" className="text-xs flex items-center gap-1 text-primary"><ExternalLink className="h-3 w-3" /> Open</a>
                </div>
                <iframe src={sheetUrl.replace(/\/edit.*$/, '/preview')} className="flex-1 w-full" title="Sheet preview" />
              </div>
            ) : (
              <div className="h-full flex items-center justify-center text-sm text-muted-foreground">Add a Google Sheet URL above.</div>
            )}
          </TabsContent>
        </Tabs>
      </Card>
    </div>
  );
}
