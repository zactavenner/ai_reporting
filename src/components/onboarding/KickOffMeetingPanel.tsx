import { useEffect, useRef, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ExternalLink, Clock, Play, Pause, SkipForward, RotateCcw, CalendarPlus } from 'lucide-react';
import { KICKOFF_AGENDA, KICKOFF_LINKS } from '@/lib/constraintRules';

function fmt(s: number) {
  const sign = s < 0 ? '-' : '';
  const a = Math.abs(s);
  return `${sign}${Math.floor(a / 60)}:${String(a % 60).padStart(2, '0')}`;
}

export function KickOffMeetingPanel({ clientName }: { clientName?: string }) {
  const [done, setDone] = useState<Record<number, boolean>>({});
  const [active, setActive] = useState(0);
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [total, setTotalElapsed] = useState(0);
  const timer = useRef<number | null>(null);
  const total = KICKOFF_AGENDA.reduce((s, a) => s + a.minutes, 0);
  const completed = Object.values(done).filter(Boolean).length;

  useEffect(() => {
    if (!running) return;
    timer.current = window.setInterval(() => {
      setElapsed((e) => e + 1);
      setTotalElapsed((t) => t + 1);
    }, 1000);
    return () => { if (timer.current) window.clearInterval(timer.current); };
  }, [running]);

  const segment = KICKOFF_AGENDA[active];
  const remaining = segment ? segment.minutes * 60 - elapsed : 0;

  const next = () => {
    setDone((p) => ({ ...p, [active]: true }));
    setElapsed(0);
    setActive((i) => Math.min(i + 1, KICKOFF_AGENDA.length - 1));
  };
  const reset = () => {
    setRunning(false);
    setElapsed(0);
    setTotalElapsed(0);
    setActive(0);
    setDone({});
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="flex items-center justify-between text-base">
            <span>Kick-Off Agenda{clientName ? ` — ${clientName}` : ''}</span>
            <Badge variant="outline">
              <Clock className="h-3 w-3 mr-1" />
              {totalMinutes} min · {completed}/{KICKOFF_AGENDA.length} done
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 p-3">
            <div className="flex-1 min-w-[160px]">
              <div className="text-xs text-muted-foreground">Current segment</div>
              <div className="text-sm font-semibold">{segment?.title}</div>
            </div>
            <div className={`font-mono text-xl tabular-nums ${remaining < 0 ? 'text-destructive' : ''}`}>{fmt(remaining)}</div>
            <div className="text-[11px] text-muted-foreground w-full sm:w-auto">total {fmt(total)}</div>
            <div className="flex gap-1">
              <Button size="sm" variant={running ? 'secondary' : 'default'} onClick={() => setRunning((r) => !r)}>
                {running ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
              </Button>
              <Button size="sm" variant="outline" onClick={next}>
                <SkipForward className="h-3.5 w-3.5 mr-1" />Next
              </Button>
              <Button size="sm" variant="ghost" onClick={reset}>
                <RotateCcw className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
          {KICKOFF_AGENDA.map((step, i) => (
            <label
              key={i}
              className={`flex items-start gap-3 p-2 rounded-md hover:bg-muted/40 cursor-pointer ${i === active ? 'bg-primary/5 ring-1 ring-primary/30' : ''}`}
              onClick={() => { setActive(i); setElapsed(0); }}
            >
              <Checkbox checked={!!done[i]} onCheckedChange={(v) => setDone((p) => ({ ...p, [i]: !!v }))} />
              <div className="flex-1">
                <div className="flex items-center gap-2 text-sm font-medium">
                  {step.title}
                  <Badge variant="secondary">{step.minutes}m</Badge>
                  {step.link && (
                    <a
                      href={step.link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-primary inline-flex items-center gap-1"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {step.link.label}<ExternalLink className="h-3 w-3" />
                    </a>
                  )}
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
          <Button variant="default" className="w-full justify-between" asChild>
            <a href="https://aicapitalraising.com/review" target="_blank" rel="noopener noreferrer">
              Schedule Weekly Call
              <CalendarPlus className="h-3 w-3" />
            </a>
          </Button>
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