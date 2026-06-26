import { useClientAssignedAds, useRemoveAdAssignment } from '@/hooks/useAdScraping';
import { AdCard } from './AdCard';
import { Badge } from '@/components/ui/badge';
import { Sparkles, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

interface InspirationLibraryProps {
  clientId: string;
}

export function InspirationLibrary({ clientId }: InspirationLibraryProps) {
  const { data: assignments, isLoading } = useClientAssignedAds(clientId);
  const removeAssignment = useRemoveAdAssignment();

  if (isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!assignments || assignments.length === 0) {
    return (
      <div className="text-center py-16 text-muted-foreground">
        <Sparkles className="h-8 w-8 mx-auto mb-3 opacity-50" />
        <p className="text-lg font-medium">No inspiration ads yet</p>
        <p className="text-sm mt-1">
          Go to the Ad Scraping Engine and assign ads to this client
        </p>
      </div>
    );
  }

  const handleRemove = async (assignmentId: string) => {
    try {
      await removeAssignment.mutateAsync(assignmentId);
      toast.success('Assignment removed');
    } catch {
      toast.error('Failed to remove assignment');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Inspiration Library</h3>
          <p className="text-sm text-muted-foreground">
            Competitor ads assigned for creative reference
          </p>
        </div>
        <Badge variant="secondary">{assignments.length} ads</Badge>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {assignments.map((assignment) => (
          <AdCard
            key={assignment.id}
            ad={(assignment as any).creatives || (assignment as any).scraped_ads || assignment}
            onRemove={() => handleRemove(assignment.id)}
          />
        ))}
      </div>
    </div>
  );
}
