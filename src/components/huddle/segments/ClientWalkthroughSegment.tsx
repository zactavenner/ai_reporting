import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ChevronLeft, ChevronRight, SkipForward } from 'lucide-react';
import { useHuddleClients } from '@/hooks/useHuddleClients';
import { supabase } from '@/integrations/supabase/client';
import { ClientReviewCard } from './ClientReviewCard';

interface Props {
  huddleId: string;
  subIndex: number;
  onSubIndexChange: (idx: number) => void;
  onAdvanceSegment: () => void;
}

/**
 * Walks every active client from the Agency Dashboard order. Skipping / advancing
 * writes to `huddle_client_reviews` so the recap + monthly analytics know which
 * clients were actually covered.
 */
export function ClientWalkthroughSegment({ huddleId, subIndex, onSubIndexChange, onAdvanceSegment }: Props) {
  const { clients, isLoading } = useHuddleClients();
  const safeIdx = Math.min(Math.max(0, subIndex), Math.max(0, clients.length - 1));
  const current = clients[safeIdx];

  // Ensure a review row exists for the client we're viewing.
  useEffect(() => {
    if (!huddleId || !current) return;
    (supabase as any)
      .from('huddle_client_reviews')
      .upsert(
        { huddle_id: huddleId, client_id: current.id, position: safeIdx, status: 'pending' },
        { onConflict: 'huddle_id,client_id' },
      )
      .then(() => {});
  }, [huddleId, current?.id, safeIdx]);

  const markAndAdvance = async (status: 'reviewed' | 'skipped') => {
    if (current) {
      await (supabase as any)
        .from('huddle_client_reviews')
        .upsert(
          { huddle_id: huddleId, client_id: current.id, position: safeIdx, status },
          { onConflict: 'huddle_id,client_id' },
        );
    }
    if (safeIdx + 1 >= clients.length) onAdvanceSegment();
    else onSubIndexChange(safeIdx + 1);
  };

  if (isLoading) {
    return <div className="py-10 text-center text-muted-foreground">Loading clients…</div>;
  }
  if (clients.length === 0) {
    return (
      <div className="py-10 text-center text-muted-foreground">
        No active clients to walk through. Add or resume a client in the Agency Dashboard.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Sub-progress */}
      <div className="flex items-center justify-between max-w-[1400px] mx-auto">
        <div className="flex items-center gap-2 text-sm">
          <Badge variant="secondary">
            Client {safeIdx + 1} of {clients.length}
          </Badge>
          <span className="text-muted-foreground">{current?.name}</span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => onSubIndexChange(Math.max(0, safeIdx - 1))}
            disabled={safeIdx === 0}
          >
            <ChevronLeft className="w-4 h-4 mr-1" /> Prev client
          </Button>
          <Button size="sm" variant="outline" onClick={() => markAndAdvance('skipped')}>
            <SkipForward className="w-4 h-4 mr-1" /> Skip
          </Button>
          <Button size="sm" onClick={() => markAndAdvance('reviewed')}>
            {safeIdx + 1 >= clients.length ? 'Finish walkthrough' : 'Next client'}
            <ChevronRight className="w-4 h-4 ml-1" />
          </Button>
        </div>
      </div>

      {/* Sub-progress bar */}
      <div className="max-w-[1400px] mx-auto flex items-center gap-1">
        {clients.map((_, i) => (
          <span
            key={i}
            className={`h-1 flex-1 rounded-full ${
              i < safeIdx ? 'bg-primary' : i === safeIdx ? 'bg-primary/60' : 'bg-muted'
            }`}
          />
        ))}
      </div>

      {current && <ClientReviewCard client={current} />}
    </div>
  );
}