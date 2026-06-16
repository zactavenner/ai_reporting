import { useState } from 'react';
import { Inbox, Sparkles, BarChart3, Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { EmailInboxView } from './EmailInboxView';
import { EmailBriefingView } from './EmailBriefingView';
import { EmailAnalyticsView } from './EmailAnalyticsView';
import { EmailInboxesSettings } from './EmailInboxesSettings';

type EmailSubTab = 'inbox' | 'briefing' | 'analytics' | 'inboxes';

const tabs: { id: EmailSubTab; label: string; icon: any }[] = [
  { id: 'inbox', label: 'Inbox', icon: Inbox },
  { id: 'briefing', label: 'Daily Briefing', icon: Sparkles },
  { id: 'analytics', label: 'Analytics', icon: BarChart3 },
  { id: 'inboxes', label: 'Inboxes', icon: Settings2 },
];

export function EmailManagementTab() {
  const [sub, setSub] = useState<EmailSubTab>('inbox');
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Email Management</h1>
          <p className="text-sm text-muted-foreground">AI-powered executive inbox across all team Gmail accounts.</p>
        </div>
      </div>

      <div className="flex items-center gap-1 border-b border-border">
        {tabs.map((t) => (
          <Button
            key={t.id}
            variant="ghost"
            onClick={() => setSub(t.id)}
            className={cn(
              'rounded-none border-b-2 border-transparent px-4 -mb-px gap-2 text-sm',
              sub === t.id && 'border-primary text-foreground',
            )}
          >
            <t.icon className="h-4 w-4" />
            {t.label}
          </Button>
        ))}
      </div>

      {sub === 'inbox' && <EmailInboxView />}
      {sub === 'briefing' && <EmailBriefingView />}
      {sub === 'analytics' && <EmailAnalyticsView />}
      {sub === 'inboxes' && <EmailInboxesSettings />}
    </div>
  );
}