import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ExternalLink, ChevronDown, ChevronUp, FileText } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { embedSheetUrl } from '@/lib/huddle/sheet';
import { TaskBoardView } from '@/components/tasks/TaskBoardView';
import type { Client } from '@/hooks/useClients';

interface PastCall {
  id: string;
  title: string | null;
  summary_text: string | null;
  week_of: string | null;
  ended_at: string | null;
}

export function ClientReviewCard({ client }: { client: Client }) {
  const [sheetUrl, setSheetUrl] = useState<string>('');
  const [pastCalls, setPastCalls] = useState<PastCall[]>([]);
  const [expandedCallId, setExpandedCallId] = useState<string | null>(null);
  const [showSheet, setShowSheet] = useState(true);
  const [showTasks, setShowTasks] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [{ data: cs }, { data: ws }] = await Promise.all([
        (supabase as any).from('client_settings').select('kpi_google_sheet_url').eq('client_id', client.id).maybeSingle(),
        (supabase as any).from('client_weekly_call_settings').select('scorecard_sheet_url').eq('client_id', client.id).maybeSingle(),
      ]);
      if (cancelled) return;
      setSheetUrl((cs?.kpi_google_sheet_url as string) || (ws?.scorecard_sheet_url as string) || '');

      const { data: calls } = await (supabase as any)
        .from('client_weekly_calls')
        .select('id, title, summary_text, week_of, ended_at')
        .eq('client_id', client.id)
        .eq('status', 'completed')
        .order('ended_at', { ascending: false })
        .limit(3);
      if (!cancelled) setPastCalls((calls || []) as PastCall[]);
    })();
    return () => { cancelled = true; };
  }, [client.id]);

  return (
    <div className="w-full max-w-[1400px] mx-auto space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-2xl font-semibold">{client.name}</h2>
        <Badge variant={client.status === 'active' ? 'default' : 'outline'} className="capitalize">
          {client.status}
        </Badge>
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" variant="outline" asChild>
            <a href={`/client/${client.id}`} target="_blank" rel="noreferrer">
              <ExternalLink className="w-3.5 h-3.5 mr-1" /> Dashboard
            </a>
          </Button>
          {sheetUrl && (
            <Button size="sm" variant="outline" asChild>
              <a href={sheetUrl} target="_blank" rel="noreferrer">
                <ExternalLink className="w-3.5 h-3.5 mr-1" /> Scorecard
              </a>
            </Button>
          )}
        </div>
      </div>

      {/* Scorecard iframe */}
      <Card className="p-0 overflow-hidden">
        <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/40">
          <div className="text-sm font-medium">Scorecard</div>
          <Button size="sm" variant="ghost" onClick={() => setShowSheet((s) => !s)}>
            {showSheet ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </Button>
        </div>
        {showSheet && (
          sheetUrl ? (
            <iframe
              src={embedSheetUrl(sheetUrl)}
              title={`${client.name} scorecard`}
              className="w-full"
              style={{ height: 520, border: 0 }}
              loading="lazy"
            />
          ) : (
            <div className="p-6 text-sm text-muted-foreground">
              No scorecard sheet configured for this client. Add one in Client Settings.
            </div>
          )
        )}
      </Card>

      {/* Tasks — reuses the exact same TaskBoardView the tasks section renders */}
      <Card className="p-0 overflow-hidden">
        <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/40">
          <div className="text-sm font-medium">Tasks</div>
          <Button size="sm" variant="ghost" onClick={() => setShowTasks((s) => !s)}>
            {showTasks ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </Button>
        </div>
        {showTasks && (
          <div className="p-3">
            <TaskBoardView clientId={client.id} />
          </div>
        )}
      </Card>

      {/* Past 3 AI summaries */}
      <Card className="p-4 space-y-3">
        <div className="flex items-center gap-2">
          <FileText className="w-4 h-4 text-muted-foreground" />
          <div className="text-sm font-medium">Last 3 meeting summaries</div>
        </div>
        {pastCalls.length === 0 ? (
          <div className="text-sm text-muted-foreground">No past weekly calls yet.</div>
        ) : (
          <ul className="space-y-2">
            {pastCalls.map((c) => {
              const open = expandedCallId === c.id;
              return (
                <li key={c.id} className="rounded-md border">
                  <button
                    type="button"
                    onClick={() => setExpandedCallId(open ? null : c.id)}
                    className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-muted/40"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{c.title || 'Weekly Call'}</div>
                      <div className="text-xs text-muted-foreground">
                        {c.ended_at ? new Date(c.ended_at).toLocaleDateString() : c.week_of || ''}
                      </div>
                    </div>
                    {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>
                  {open && (
                    <div className="px-3 pb-3 text-sm whitespace-pre-wrap text-muted-foreground">
                      {c.summary_text || 'No summary generated.'}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}