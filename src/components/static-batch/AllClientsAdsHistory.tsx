import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useClients } from '@/hooks/useClients';
import { HistoryGrid } from '@/components/history/HistoryGrid';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { Loader2, History } from 'lucide-react';
import { toast } from 'sonner';
import type { Asset } from '@/types';
import { fetchAllRows } from '@/lib/fetchAllRows';

export function AllClientsAdsHistory() {
  const { data: clients = [] } = useClients();
  const [clientFilter, setClientFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<'all' | 'image' | 'video'>('all');
  const queryClient = useQueryClient();

  const { data: assets = [], isLoading } = useQuery({
    queryKey: ['ads-generator-history-all'],
    queryFn: async () => {
      // Pull assets generated via static_batch projects across all clients
      const projects = await fetchAllRows<any>((sb) =>
        sb.from('projects').select('id, client_id, name').eq('type', 'static_batch')
      );
      const projectIds = projects.map((p) => p.id);
      if (!projectIds.length) return [] as Asset[];
      const clientById = new Map(clients.map((c) => [c.id, c.name]));
      const projectClientMap = new Map(projects.map((p) => [p.id, p.client_id]));

      const rows = await fetchAllRows<any>((sb) =>
        sb.from('assets')
          .select('*')
          .in('project_id', projectIds)
          .in('type', ['image', 'video'])
          .order('created_at', { ascending: false })
      );
      return rows.map((a) => {
        const cid = projectClientMap.get(a.project_id);
        return {
          ...a,
          metadata: {
            ...(a.metadata || {}),
            clientId: cid,
            clientName: cid ? clientById.get(cid) : undefined,
          },
        } as Asset;
      });
    },
    enabled: clients.length >= 0,
  });

  const deleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const { error } = await supabase.from('assets').delete().in('id', ids);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ads-generator-history-all'] });
      toast.success('Assets deleted');
    },
    onError: () => toast.error('Failed to delete assets'),
  });

  const filtered = useMemo(() => {
    return assets.filter((a) => {
      if (typeFilter !== 'all' && a.type !== typeFilter) return false;
      if (clientFilter !== 'all' && (a.metadata as any)?.clientId !== clientFilter) return false;
      return true;
    });
  }, [assets, typeFilter, clientFilter]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <History className="h-5 w-5" />
          <h2 className="text-xl font-semibold">History — All Clients</h2>
        </div>
      </div>

      <Card className="p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-xs">Client</Label>
            <Select value={clientFilter} onValueChange={setClientFilter}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Clients</SelectItem>
                {clients.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Type</Label>
            <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as any)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Images & Videos</SelectItem>
                <SelectItem value="image">Images only</SelectItem>
                <SelectItem value="video">Videos only</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </Card>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <HistoryGrid
          assets={filtered}
          showClientName
          onDelete={(ids) => deleteMutation.mutate(ids)}
          isDeleting={deleteMutation.isPending}
        />
      )}
    </div>
  );
}
