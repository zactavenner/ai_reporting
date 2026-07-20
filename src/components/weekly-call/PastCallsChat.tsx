import { useState, useRef, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Sparkles, Send, Loader2, MessageCircle } from 'lucide-react';
import { toast } from 'sonner';

type Msg = { role: 'user' | 'assistant'; content: string };

const SUGGESTIONS = [
  'What were the biggest wins across the last month?',
  'What action items keep coming up?',
  'Summarize creative decisions from the last 4 calls.',
  'What is the client most frustrated about lately?',
];

export function PastCallsChat({ clientId }: { clientId: string }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, loading]);

  const ask = async (q: string) => {
    const question = q.trim();
    if (!question || loading) return;
    const next = [...messages, { role: 'user' as const, content: question }];
    setMessages(next);
    setInput('');
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('weekly-call-chat', {
        body: { client_id: clientId, question, history: messages },
      });
      if (error) throw error;
      const answer = (data as any)?.answer || 'No answer returned.';
      setMessages([...next, { role: 'assistant', content: answer }]);
    } catch (e: any) {
      toast.error(e?.message || 'Chat failed');
      setMessages([...next, { role: 'assistant', content: '⚠️ Failed to reach the AI. Try again.' }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="p-4 md:p-5 space-y-3 border-primary/20">
      <div className="flex items-center gap-2">
        <div className="p-1.5 rounded-md bg-primary/10">
          <Sparkles className="h-4 w-4 text-primary" />
        </div>
        <div>
          <div className="text-sm font-semibold">Ask across all past calls</div>
          <div className="text-[11px] text-muted-foreground">
            Pulls from call summaries first, then transcripts for deeper questions.
          </div>
        </div>
      </div>

      <div
        ref={scrollRef}
        className="max-h-[360px] min-h-[120px] overflow-y-auto rounded-lg border bg-muted/20 p-3 space-y-2"
      >
        {messages.length === 0 && !loading ? (
          <div className="space-y-2">
            <div className="text-xs text-muted-foreground flex items-center gap-1">
              <MessageCircle className="w-3 h-3" /> Try one of these:
            </div>
            <div className="flex flex-wrap gap-1.5">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => ask(s)}
                  className="text-[11px] px-2 py-1 rounded-full border bg-background hover:bg-accent transition"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m, i) => (
            <div
              key={i}
              className={`text-xs rounded-lg px-3 py-2 whitespace-pre-wrap ${
                m.role === 'user'
                  ? 'bg-primary text-primary-foreground ml-8'
                  : 'bg-background border mr-8'
              }`}
            >
              {m.content}
            </div>
          ))
        )}
        {loading && (
          <div className="text-xs text-muted-foreground flex items-center gap-2 mr-8">
            <Loader2 className="w-3 h-3 animate-spin" /> Thinking…
          </div>
        )}
      </div>

      <div className="flex gap-2 items-end">
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              ask(input);
            }
          }}
          placeholder="Ask a question about any past call…"
          className="min-h-[44px] max-h-32 text-xs resize-none"
        />
        <Button size="sm" onClick={() => ask(input)} disabled={loading || !input.trim()}>
          <Send className="w-3.5 h-3.5" />
        </Button>
      </div>
    </Card>
  );
}