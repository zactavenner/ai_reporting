import { usePendingActions, useClientActions, useApproveAction, useRejectAction, AgentAction } from '@/hooks/useAgentActions';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Bot, Check, X, RotateCcw, Shield, AlertTriangle,
  Zap, Clock, ChevronDown,
} from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useState } from 'react';

interface AgentActionsPanelProps {
  clientId?: string;
  showPendingOnly?: boolean;
}

const ACTION_ICONS: Record<string, string> = {
  pause_ad: '⏸️',
  enable_ad: '▶️',
  adjust_budget: '💰',
  create_creative: '🎨',
  send_slack: '💬',
  create_task: '📋',
  update_ghl_contact: '👤',
  fire_capi_event: '📡',
  escalate: '🚨',
  generate_report: '📊',
  custom: '⚡',
};

const STATUS_CONFIG: Record<string, { color: string; label: string }> = {
  pending: { color: 'bg-yellow-500/10 text-yellow-600', label: 'Awaiting Approval' },
  approved: { color: 'bg-blue-500/10 text-blue-600', label: 'Approved' },
  executed: { color: 'bg-green-500/10 text-green-600', label: 'Executed' },
  rejected: { color: 'bg-red-500/10 text-red-600', label: 'Rejected' },
  failed: { color: 'bg-red-500/10 text-red-600', label: 'Failed' },
  rolled_back: { color: 'bg-gray-500/10 text-gray-600', label: 'Rolled Back' },
};

function ActionRow({ action, showActions }: { action: AgentAction; showActions: boolean }) {
  const approveAction = useApproveAction();
  const rejectAction = useRejectAction();
  const [expanded, setExpanded] = useState(false);
  const statusConfig = STATUS_CONFIG[action.status] || STATUS_CONFIG.pending;

  return (
    <div className="border rounded-lg p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2 min-w-0">
          <span className="text-lg mt-0.5">{ACTION_ICONS[action.action_type] || '⚡'}</span>
          <div className="min-w-0">
            <p className="text-sm font-medium leading-tight">{action.action_label}</p>
            {action.reasoning && (
              <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{action.reasoning}</p>
            )}
          </div>
        </div>
        <Badge className={`${statusConfig.color} text-[10px] shrink-0`}>
          {statusConfig.label}
        </Badge>
      </div>

      <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
        <Clock className="w-3 h-3" />
        {new Date(action.created_at).toLocaleString()}
        {action.confidence !== null && (
          <span className="ml-2">Confidence: {Math.round(action.confidence * 100)}%</span>
        )}
        {action.client_name && (
          <span className="ml-2">{action.client_name}</span>
        )}
      </div>

      {showActions && action.status === 'pending' && (
        <div className="flex gap-2 pt-1">
          <Button
            size="sm"
            className="h-7 text-xs gap-1"
            onClick={() => approveAction.mutate({ actionId: action.id, approvedBy: 'admin' })}
            disabled={approveAction.isPending}
          >
            <Check className="w-3 h-3" /> Approve
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs gap-1"
            onClick={() => rejectAction.mutate({ actionId: action.id, rejectedBy: 'admin' })}
            disabled={rejectAction.isPending}
          >
            <X className="w-3 h-3" /> Reject
          </Button>
        </div>
      )}

      {(action.before_state && Object.keys(action.before_state).length > 0) && (
        <Collapsible open={expanded} onOpenChange={setExpanded}>
          <CollapsibleTrigger className="text-[10px] text-muted-foreground flex items-center gap-1 hover:text-foreground">
            <ChevronDown className={`w-3 h-3 transition-transform ${expanded ? 'rotate-180' : ''}`} />
            Details
          </CollapsibleTrigger>
          <CollapsibleContent>
            <pre className="text-[10px] bg-muted p-2 rounded mt-1 overflow-auto max-h-32">
              {JSON.stringify({ before: action.before_state, after: action.after_state }, null, 2)}
            </pre>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}

export function AgentActionsPanel({ clientId, showPendingOnly = false }: AgentActionsPanelProps) {
  const { data: pendingActions } = usePendingActions();
  const { data: clientActions } = useClientActions(clientId);

  const actions = clientId ? clientActions : pendingActions;
  const filtered = showPendingOnly
    ? (actions || []).filter(a => a.status === 'pending')
    : actions;

  const pendingCount = (actions || []).filter(a => a.status === 'pending').length;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bot className="h-5 w-5 text-muted-foreground" />
            <CardTitle className="text-base">AI Agent Actions</CardTitle>
          </div>
          {pendingCount > 0 && (
            <Badge variant="destructive" className="text-[10px]">
              <AlertTriangle className="w-3 h-3 mr-1" />
              {pendingCount} pending approval
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {!filtered || filtered.length === 0 ? (
          <div className="text-center py-6 text-sm text-muted-foreground">
            <Shield className="h-8 w-8 mx-auto mb-2 opacity-30" />
            <p>No agent actions to review.</p>
            <p className="text-xs mt-1">Actions appear here when AI agents take or propose actions.</p>
          </div>
        ) : (
          <ScrollArea className="max-h-96">
            <div className="space-y-2">
              {filtered.map((action) => (
                <ActionRow key={action.id} action={action} showActions={!clientId || true} />
              ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
