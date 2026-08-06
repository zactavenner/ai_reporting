import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Download, Play, FileText, RefreshCw, Loader2 } from 'lucide-react';
import { useCallRecordings, CallRecording } from '@/hooks/useCallRecordings';
import { exportToCSV } from '@/lib/exportUtils';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { invokeMeetgeek } from '@/lib/meetgeekInvoke';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';

interface CallRecordingsModalProps {
  clientId?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CallRecordingsModal({ clientId, open, onOpenChange }: CallRecordingsModalProps) {
  const { data: calls = [], isLoading } = useCallRecordings(clientId);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const handleSyncTranscript = async (callId: string) => {
    setSyncingId(callId);
    try {
      const data: any = await invokeMeetgeek({ action: 'sync_call_transcript', call_id: callId });
      if (data?.success) {
        toast.success(data.hasTranscript ? 'Transcript synced!' : 'No matching meeting found');
        queryClient.invalidateQueries({ queryKey: ['call-recordings'] });
      } else {
        toast.error(data?.error || 'No matching meeting found');
      }
    } catch (error) {
      console.error(error);
      toast.error('Failed to sync transcript');
    } finally {
      setSyncingId(null);
    }
  };

  const handleExport = () => {
    const exportData = calls.map(call => ({
      scheduled_at: call.scheduled_at,
      showed: call.showed ? 'Yes' : 'No',
      outcome: call.outcome,
      quality_score: call.quality_score,
      summary: call.summary,
      transcript: call.transcript,
    }));
    exportToCSV(exportData, 'call-recordings');
  };

  const getQualityColor = (score: number | null) => {
    if (!score) return 'secondary';
    if (score >= 8) return 'default';
    if (score >= 5) return 'secondary';
    return 'destructive';
  };

  const toggleExpand = (id: string) => {
    setExpandedId(expandedId === id ? null : id);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle>Call Recordings ({calls.length})</DialogTitle>
            <Button variant="outline" size="sm" onClick={handleExport}>
              <Download className="h-4 w-4 mr-2" />
              Export CSV
            </Button>
          </div>
        </DialogHeader>
        
        <div className="flex-1 overflow-auto">
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">Loading recordings...</div>
          ) : calls.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No call recordings found</p>
              <p className="text-sm mt-2">Call recordings with transcripts will appear here</p>
            </div>
          ) : (
            <div className="space-y-2">
              {calls.map((call: CallRecording) => (
                <Collapsible key={call.id} open={expandedId === call.id}>
                  <div className="border-2 border-border p-3 hover:bg-muted/30 transition-colors">
                    <CollapsibleTrigger asChild>
                      <div 
                        className="flex items-center justify-between cursor-pointer"
                        onClick={() => toggleExpand(call.id)}
                      >
                        <div className="flex items-center gap-4">
                          <div className="flex items-center gap-2">
                            {expandedId === call.id ? (
                              <ChevronDown className="h-4 w-4" />
                            ) : (
                              <ChevronRight className="h-4 w-4" />
                            )}
                            <span className="font-medium">
                              {call.scheduled_at 
                                ? new Date(call.scheduled_at).toLocaleString() 
                                : new Date(call.created_at).toLocaleString()
                              }
                            </span>
                          </div>
                          
                          <Badge variant={call.showed ? 'default' : 'secondary'}>
                            {call.showed ? 'Showed' : 'No Show'}
                          </Badge>
                          
                          {call.outcome && (
                            <span className="text-sm text-muted-foreground">{call.outcome}</span>
                          )}
                        </div>

                        <div className="flex items-center gap-3">
                          {call.quality_score && (
                            <Badge variant={getQualityColor(call.quality_score)}>
                              Quality: {call.quality_score}/10
                            </Badge>
                          )}
                          
                          {call.recording_url && (
                            <Button 
                              variant="ghost" 
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                window.open(call.recording_url!, '_blank');
                              }}
                            >
                              <Play className="h-4 w-4 mr-1" />
                              Play
                            </Button>
                          )}
                          
                          {!call.transcript && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleSyncTranscript(call.id);
                              }}
                              disabled={syncingId === call.id}
                            >
                              {syncingId === call.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <>
                                  <RefreshCw className="h-4 w-4 mr-1" />
                                  Sync
                                </>
                              )}
                            </Button>
                          )}
                          
                          {(call.transcript || call.summary) && (
                            <FileText className="h-4 w-4 text-muted-foreground" />
                          )}
                        </div>
                      </div>
                    </CollapsibleTrigger>
                    
                    <CollapsibleContent>
                      <div className="mt-4 space-y-4 pt-4 border-t border-border">
                        {call.summary && (
                          <div>
                            <h4 className="font-bold text-sm mb-2">Summary</h4>
                            <p className="text-sm text-muted-foreground bg-muted/50 p-3 rounded">
                              {call.summary}
                            </p>
                          </div>
                        )}
                        
                        {call.transcript && (
                          <div>
                            <h4 className="font-bold text-sm mb-2">Transcript</h4>
                            <div className="text-sm text-muted-foreground bg-muted/50 p-3 rounded max-h-60 overflow-auto whitespace-pre-wrap">
                              {call.transcript}
                            </div>
                          </div>
                        )}
                        
                        {!call.summary && !call.transcript && (
                          <p className="text-sm text-muted-foreground italic">
                            No transcript or summary available for this call
                          </p>
                        )}
                      </div>
                    </CollapsibleContent>
                  </div>
                </Collapsible>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}