import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { FolderOpen, RefreshCw, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';

interface DriveSyncCardProps {
  clientId: string;
}

export function DriveSyncCard({ clientId }: DriveSyncCardProps) {
  const [syncing, setSyncing] = useState(false);

  const { data: folder, refetch: refetchFolder } = useQuery({
    queryKey: ['client-drive-folder', clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('client_drive_folders' as any)
        .select('*')
        .eq('client_id', clientId)
        .eq('enabled', true)
        .maybeSingle();
      if (error) throw error;
      return data as any;
    },
  });

  const { data: uploads, refetch: refetchUploads } = useQuery({
    queryKey: ['creative-drive-uploads', clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('creative_drive_uploads' as any)
        .select('id, status')
        .eq('client_id', clientId);
      if (error) throw error;
      return (data || []) as any[];
    },
    enabled: !!folder,
  });

  if (!folder) return null;

  const uploaded = (uploads || []).filter((u) => u.status === 'uploaded').length;
  const failed = (uploads || []).filter((u) => u.status === 'failed').length;

  const runSync = async () => {
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke('drive-sync-approved-creatives', {
        body: { password: 'HPA1234$', client_id: clientId },
      });
      if (error) throw error;
      const result = (data as any)?.results?.[0];
      toast.success(
        result
          ? `${result.uploaded} new creative(s) uploaded to ${result.folder_name || 'Drive'}`
          : 'Drive sync complete',
      );
      await Promise.all([refetchFolder(), refetchUploads()]);
    } catch (e: any) {
      toast.error('Drive sync failed: ' + (e?.message || 'Unknown error'));
    } finally {
      setSyncing(false);
    }
  };

  return (
    <Card className="p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3">
        <div className="rounded-lg bg-primary/10 p-2">
          <FolderOpen className="h-5 w-5 text-primary" />
        </div>
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <p className="font-medium">Approved creatives → Google Drive</p>
            <Badge variant="secondary">{folder.folder_name || 'Drive folder'}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            Auto-uploads every 15 minutes. {uploaded} delivered
            {failed > 0 ? ` · ${failed} failed` : ''}
            {folder.last_synced_at
              ? ` · last run ${new Date(folder.last_synced_at).toLocaleString()}`
              : ''}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          className="gap-2"
          onClick={() =>
            window.open(`https://drive.google.com/drive/folders/${folder.folder_id}`, '_blank')
          }
        >
          <ExternalLink className="h-4 w-4" />
          Open folder
        </Button>
        <Button size="sm" className="gap-2" onClick={runSync} disabled={syncing}>
          <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
          {syncing ? 'Syncing…' : 'Sync now'}
        </Button>
      </div>
    </Card>
  );
}
