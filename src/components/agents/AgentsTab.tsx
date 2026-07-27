import type { Client } from '@/hooks/useClients';
import { AgentWorkforceV3 } from './AgentWorkforceV3';
import { AllChannelsInbox } from './AllChannelsInbox';

interface Props { clients: Client[]; }

export function AgentsTab({ clients }: Props) {
  return (
    <div className="space-y-6">
      {/* Agent Workforce v3 — Claude-style profiles with Memory / Instructions / Files / Connectors / Models */}
      <AgentWorkforceV3 />

      {/* Agency-wide unified inbox across all agent channels (agency + client) */}
      <AllChannelsInbox clients={clients} />
    </div>
  );
}
