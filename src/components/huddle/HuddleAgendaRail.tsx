import { CheckCircle2, Circle, Clock3, Users } from 'lucide-react';
import type { AgendaSegment } from '@/lib/huddle/types';
import type { Client } from '@/hooks/useClients';
import { ScrollArea } from '@/components/ui/scroll-area';

interface Props {
  agenda: AgendaSegment[];
  currentSegmentIdx: number;
  clients?: Client[];
  currentClientIdx?: number;
}

export function HuddleAgendaRail({ agenda, currentSegmentIdx, clients, currentClientIdx }: Props) {
  const clientIndex = currentClientIdx ?? 0;

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
                            return (
                              <div
                                key={c.id}
                                className={`text-xs transition-colors ${
                                  cCurrent 
                                    ? 'text-primary font-medium' 
                                    : cCompleted 
                                      ? 'text-muted-foreground/40' 
                                      : 'text-muted-foreground'
                                }`}
                              >
                                {ci + 1}. {c.name}
                              </div>
                            );
                          })}
                        </div>
                      </ScrollArea>
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
