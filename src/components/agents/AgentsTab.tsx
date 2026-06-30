import type { Client } from '@/hooks/useClients';
import { AgentWorkforceV3 } from './AgentWorkforceV3';
import { AllChannelsInbox } from './AllChannelsInbox';
import { JarvisCommandCenter } from './JarvisCommandCenter';

interface Props { clients: Client[]; }

export function AgentsTab({ clients }: Props) {
  return (
    <div className="space-y-6">
      {/* Jarvis — top-level COO chat that coordinates with Hermes & all agents */}
      <JarvisCommandCenter />

      {/* Agent Workforce v3 — Claude-style profiles with Memory / Instructions / Files / Connectors / Models */}
      <AgentWorkforceV3 />

      {/* Agency-wide unified inbox across all agent channels (agency + client) */}
      <AllChannelsInbox clients={clients} />
    </div>
  );
}
