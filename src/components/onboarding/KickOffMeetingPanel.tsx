import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ExternalLink, Clock } from 'lucide-react';
import { KICKOFF_AGENDA, KICKOFF_LINKS } from '@/lib/constraintRules';

export function KickOffMeetingPanel({ clientName }: { clientName?: string }) {
  const [done, setDone] = useState<Record<number, boolean>>({});
  const total = KICKOFF_AGENDA.reduce((s, a) => s + a.minutes, 0);
  const completed = Object.values(done).filter(Boolean).length;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="flex items-center justify-between text-base">
            <span>Kick-Off Agenda{clientName ? ` — ${clientName}` : ''}</span>
            <Badge variant="outline">
              <Clock className="h-3 w-3 mr-1" />
              {total} min · {completed}/{KICKOFF_AGENDA.length} done
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {KICKOFF_AGENDA.map((step, i) => (
            <label
              key={i}
              className="flex items-start gap-3 p-2 rounded-md hover:bg-muted/40 cursor-pointer"
            >
              <Checkbox checked={!!done[i]} onCheckedChange={(v) => setDone((p) => ({ ...p, [i]: !!v }))} />
              <div className="flex-1">
                <div className="flex items-center gap-2 text-sm font-medium">
                  {step.title}
                  <Badge variant="secondary">{step.minutes}m</Badge>
                </div>
                <div className="text-xs text-muted-foreground">{step.note}</div>
              </div>
            </label>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Quick Links</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {KICKOFF_LINKS.map((link) => (
            <Button
              key={link.url}
              variant="outline"
              className="w-full justify-between"
              asChild
            >
              <a href={link.url} target="_blank" rel="noopener noreferrer">
                {link.label}
                <ExternalLink className="h-3 w-3" />
              </a>
            </Button>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}