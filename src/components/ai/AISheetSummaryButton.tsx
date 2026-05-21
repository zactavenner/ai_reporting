import { useState } from 'react';
import { Sparkles, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { useDateFilter } from '@/contexts/DateFilterContext';
import { toast } from 'sonner';

interface Props {
  clientId?: string;          // omit for "all clients" mode
  clientName?: string;
  variant?: 'default' | 'outline' | 'secondary';
  size?: 'sm' | 'default';
  label?: string;
}

// Minimal markdown → HTML for headings, bold, lists, paragraphs.
function renderMarkdown(md: string): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  let html = esc(md);
  html = html.replace(/^### (.*)$/gm, '<h3 class="text-base font-semibold mt-4 mb-2">$1</h3>');
  html = html.replace(/^## (.*)$/gm, '<h2 class="text-lg font-bold mt-5 mb-2 text-primary">$1</h2>');
  html = html.replace(/^# (.*)$/gm, '<h1 class="text-xl font-bold mt-5 mb-3">$1</h1>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/^- (.*)$/gm, '<li class="ml-5 list-disc">$1</li>');
  html = html.replace(/(<li[\s\S]*?<\/li>)(?!\s*<li)/g, '<ul class="my-2 space-y-1">$1</ul>');
  html = html.replace(/\n{2,}/g, '</p><p class="my-2">');
  return `<p class="my-2">${html}</p>`;
}

export function AISheetSummaryButton({ clientId, clientName, variant = 'outline', size = 'sm', label }: Props) {
  const { startDate, endDate } = useDateFilter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<string>('');
  const [meta, setMeta] = useState<{ clients_analyzed?: number } | null>(null);

  const run = async () => {
    setLoading(true);
    setSummary('');
    setMeta(null);
    try {
      const { data, error } = await supabase.functions.invoke('ai-sheet-summary', {
        body: {
          client_id: clientId,
          start_date: startDate,
          end_date: endDate,
          include_audit: !!clientId,
        },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      setSummary((data as any).summary || 'No summary returned.');
      setMeta({ clients_analyzed: (data as any).clients_analyzed });
    } catch (e: any) {
      const msg = e?.message || 'Failed to generate summary';
      toast.error(msg);
      setSummary(`**Error:** ${msg}`);
    } finally {
      setLoading(false);
    }
  };

  const handleOpen = () => {
    setOpen(true);
    if (!summary) run();
  };

  const title = clientId
    ? `AI Performance Summary — ${clientName || 'Client'}`
    : 'AI Performance Summary — All Clients';

  return (
    <>
      <Button variant={variant} size={size} onClick={handleOpen} className="gap-1.5">
        <Sparkles className="h-4 w-4" />
        {label || (clientId ? 'AI Summary' : 'AI Summary (All)')}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <div className="flex items-center justify-between gap-3">
              <div>
                <DialogTitle className="flex items-center gap-2">
                  <Sparkles className="h-5 w-5 text-primary" />
                  {title}
                </DialogTitle>
                <DialogDescription className="mt-1">
                  Reads the KPI Google Sheet{clientId ? '' : 's'} and produces trends, data-quality flags, and recommendations.
                </DialogDescription>
              </div>
              <Button variant="ghost" size="sm" onClick={run} disabled={loading} className="gap-1.5">
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                Regenerate
              </Button>
            </div>
            {meta?.clients_analyzed ? (
              <div className="flex gap-2 mt-2">
                <Badge variant="secondary">{meta.clients_analyzed} client{meta.clients_analyzed === 1 ? '' : 's'} analyzed</Badge>
                {startDate && endDate && <Badge variant="outline">{startDate} → {endDate}</Badge>}
              </div>
            ) : null}
          </DialogHeader>

          <ScrollArea className="flex-1 pr-4">
            {loading && !summary ? (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <Loader2 className="h-8 w-8 animate-spin mb-3" />
                <p className="text-sm">Reading sheet data and analyzing performance…</p>
              </div>
            ) : (
              <div
                className="prose prose-sm dark:prose-invert max-w-none"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(summary) }}
              />
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default AISheetSummaryButton;