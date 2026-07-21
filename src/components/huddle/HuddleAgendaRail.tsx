import { CheckCircle2, Circle, Users } from 'lucide-react';
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
  return (
    <div className="flex flex-col h-full">
      <div className="mb-6 px-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-4">Agenda</h3>
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
                    <Circle className="w-4 h-4 text-muted-foreground/30" />
                  )}
                </div>
                <div className="min-w-0">
                  <div className={`text-sm font-medium ${isCurrent ? 'text-foreground' : 'text-muted-foreground'}`}>
                    {seg.name}
                  </div>
                  {isCurrent && seg.key === 'clients' && clients && (
                    <div className="mt-3 ml-1 border-l pl-3 space-y-2">
                      <div className="text-[10px] uppercase font-semibold text-muted-foreground flex items-center gap-1 mb-2">
                        <Users className="w-3 h-3" /> Clients ({clients.length})
                      </div>
                      <ScrollArea className="h-[calc(100vh-400px)]">
                        <div className="space-y-2 pr-4">
                          {clients.map((c, ci) => {
                            const cCompleted = ci < (currentClientIdx || 0);
                            const cCurrent = ci === (currentClientIdx || 0);
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
