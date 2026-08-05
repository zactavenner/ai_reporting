import { useEffect, useState } from 'react';
import { CheckCircle2, Circle, Clock3, Users } from 'lucide-react';
import type { AgendaSegment } from '@/lib/huddle/types';
import type { Client } from '@/hooks/useClients';
import { ScrollArea } from '@/components/ui/scroll-area';
import { supabase } from '@/integrations/supabase/client';

interface Props {
  agenda: AgendaSegment[];
  currentSegmentIdx: number;
  clients?: Client[];
  currentClientIdx?: number;
  huddleId?: string;
}

function fmtDur(s: number) {
  const m = Math.floor(s / 60);
  const sec = Math.max(0, s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

export function HuddleAgendaRail({ agenda, currentSegmentIdx, clients, currentClientIdx, huddleId }: Props) {
  const clientIndex = currentClientIdx ?? 0;
  const clientsSeg = agenda.find((s) => s.key === 'clients');
  const targetPerClient = clientsSeg && clients && clients.length > 0
    ? Math.max(30, Math.round(clientsSeg.duration_s / clients.length))
    : 0;

  // Saved durations for reviewed/skipped clients
  const [durations, setDurations] = useState<Record<string, number>>({});
  useEffect(() => {
    if (!huddleId) return;
    let cancelled = false;
    const load = async () => {
      const { data } = await (supabase as any)
        .from('huddle_client_reviews')
        .select('client_id, duration_s')
        .eq('huddle_id', huddleId);
      if (cancelled || !data) return;
      const map: Record<string, number> = {};
      for (const r of data) if (r?.client_id && r.duration_s) map[r.client_id] = r.duration_s;
      setDurations(map);
    };
    load();
    const id = window.setInterval(load, 5000);
    return () => { cancelled = true; window.clearInterval(id); };
  }, [huddleId]);

  // Live tick for current client
  const [liveStart, setLiveStart] = useState<number>(() => Date.now());
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => { setLiveStart(Date.now()); }, [clientIndex, huddleId]);
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, []);
  const liveElapsed = Math.max(0, Math.floor((now - liveStart) / 1000));
  const totalClientTime =
    Object.values(durations).reduce((a, b) => a + (b || 0), 0) + liveElapsed;

  return (
    <div className="flex flex-col h-full">
      <div className="mb-6 px-2">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Agenda</h3>
          <span className="text-[11px] text-muted-foreground">{currentSegmentIdx + 1}/{agenda.length}</span>
        </div>
        <div className="space-y-4">
          {agenda.map((seg, i) => {
            const isCompleted = i < currentSegmentIdx;
            const isCurrent = i === currentSegmentIdx;
            const isUpcoming = i > currentSegmentIdx;

            return (
              <div
                key={seg.key}
                className={`flex items-start gap-3 transition-opacity ${
                  isCompleted ? 'opacity-40' : 'opacity-100'
                }`}
              >
                <div className="mt-0.5">
                  {isCompleted ? (
                    <CheckCircle2 className="w-4 h-4 text-primary" />
                  ) : isCurrent ? (
                    <Circle className="w-4 h-4 text-primary fill-primary animate-pulse" />
                  ) : (
                    <Clock3 className="w-4 h-4 text-muted-foreground/30" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className={`text-sm font-medium ${isCurrent ? 'text-foreground' : 'text-muted-foreground'}`}>
                    {seg.name}
                  </div>
                  <div className="mt-0.5 text-[11px] text-muted-foreground/70">
                    {isCompleted ? 'Completed' : isCurrent ? 'Now' : 'Upcoming'} · {Math.round(seg.duration_s / 60)}m
                  </div>
                  {seg.key === 'clients' && clients && (
                    <div className="mt-3 ml-1 border-l pl-3 space-y-2">
                      <div className="text-[10px] uppercase font-semibold text-muted-foreground flex items-center gap-1 mb-2">
                        <Users className="w-3 h-3" /> Clients ({clients.length})
                      </div>
                      <ScrollArea className={isCurrent ? 'h-[calc(100vh-400px)]' : 'max-h-48'}>
                        <div className="space-y-2 pr-4">
                          {clients.map((c, ci) => {
                            const cCompleted = i < currentSegmentIdx || (isCurrent && ci < clientIndex);
                            const cCurrent = isCurrent && ci === clientIndex;
                            const saved = durations[c.id] ?? 0;
                            const elapsed = cCurrent ? liveElapsed : saved;
                            // Always show timer for current + completed clients so operators
                            // can eyeball where the huddle is spending its minutes.
                            const showTimer = cCurrent || cCompleted;
                            const over = targetPerClient > 0 && elapsed > targetPerClient;
                            const timerColor = cCurrent
                              ? over ? 'text-destructive' : 'text-emerald-600 dark:text-emerald-400'
                              : over ? 'text-destructive/80' : 'text-emerald-700/70 dark:text-emerald-400/70';
                            return (
                              <div
                                key={c.id}
                                className={`text-xs transition-colors flex items-center justify-between gap-2 ${
                                  cCurrent
                                    ? 'text-primary font-medium'
                                    : cCompleted
                                      ? 'text-muted-foreground/60'
                                      : 'text-muted-foreground'
                                }`}
                              >
                                <span className="truncate">{ci + 1}. {c.name}</span>
                                {showTimer && (
                                  <span
                                    className={`font-mono tabular-nums text-[10px] px-1.5 py-0.5 rounded ${timerColor} ${
                                      cCompleted && !cCurrent ? 'bg-muted/50' : ''
                                    }`}
                                  >
                                    {fmtDur(elapsed)}
                                  </span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </ScrollArea>
                      <div className="mt-2 pt-2 border-t text-[10px] text-muted-foreground flex items-center justify-between">
                        <span>Total on clients</span>
                        <span className="font-mono tabular-nums">{fmtDur(totalClientTime)}</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
