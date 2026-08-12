import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Play, RefreshCw, Sparkles, Quote } from 'lucide-react';
import { CallTranscriptRecord, useReprocessCall } from '@/hooks/useCallTranscripts';
import { intentLabel, sentimentTone, formatDuration } from './callTranscriptUtils';

interface Props {
  record: CallTranscriptRecord | null;
  timeline: CallTranscriptRecord[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CallTranscriptDetail({ record, timeline, open, onOpenChange }: Props) {
  const reprocess = useReprocessCall();
  if (!record) return null;

  const segments = record.speaker_segments?.length
    ? record.speaker_segments
    : (record.transcript || '')
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          const match = line.match(/^(User|Contact)\s*:\s*(.*)$/i);
          return match
            ? { speaker: match[1].toLowerCase() === 'contact' ? 'Contact' : 'User', text: match[2] }
            : { speaker: 'User', text: line };
        });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="text-left">
            {record.contact_name || record.contact_phone || 'Unknown contact'}
          </SheetTitle>
        </SheetHeader>

        <div className="mt-4 space-y-6">
          {/* Header stats */}
          <div className="flex flex-wrap items-center gap-2">
            {record.intent_score !== null && (
              <Badge variant="outline" className="font-semibold">
                Intent {record.intent_score}/100 — {intentLabel(record.intent_score)}
              </Badge>
            )}
            {record.outcome && <Badge>{record.outcome}</Badge>}
            {record.sentiment && <Badge variant={sentimentTone(record.sentiment)}>{record.sentiment}</Badge>}
            <Badge variant="secondary">{formatDuration(record.duration_seconds)}</Badge>
            <Badge variant="outline">{record.direction || 'outbound'}</Badge>
            <Badge variant="outline">{record.transcription_status}</Badge>
          </div>

          <div className="grid grid-cols-2 gap-3 text-sm">
            <Field label="Assigned user" value={record.assigned_user} />
            <Field label="Phone" value={record.contact_phone} />
            <Field label="Started" value={record.started_at ? new Date(record.started_at).toLocaleString() : null} />
            <Field label="Ended" value={record.ended_at ? new Date(record.ended_at).toLocaleString() : null} />
            <Field label="Investment" value={record.investment_range || (record.investment_amount ? `$${record.investment_amount.toLocaleString()}` : null)} />
            <Field label="Timeline" value={record.investment_timeline} />
            <Field label="Accredited" value={record.accredited} />
            <Field label="Commitment" value={record.commitment_level} />
            <Field label="Follow-up date" value={record.follow_up_date} />
            <Field label="Campaign" value={record.campaign} />
          </div>

          <div className="flex flex-wrap gap-2">
            {record.recording_url && (
              <Button size="sm" variant="outline" onClick={() => window.open(record.recording_url!, '_blank')}>
                <Play className="h-4 w-4 mr-2" /> Recording
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              disabled={reprocess.isPending}
              onClick={() => reprocess.mutate({ recordId: record.id })}
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${reprocess.isPending ? 'animate-spin' : ''}`} /> Re-transcribe
            </Button>
            {record.transcript && (
              <Button
                size="sm"
                variant="outline"
                disabled={reprocess.isPending}
                onClick={() => reprocess.mutate({ recordId: record.id, analyzeOnly: true })}
              >
                <Sparkles className="h-4 w-4 mr-2" /> Re-analyze
              </Button>
            )}
          </div>

          {record.transcription_error && (
            <p className="text-sm text-destructive">{record.transcription_error}</p>
          )}

          {record.summary && (
            <Section title="AI Summary">
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">{record.summary}</p>
            </Section>
          )}

          {record.next_step && (
            <Section title="Next Step">
              <p className="text-sm">{record.next_step}</p>
            </Section>
          )}

          {!!record.objections?.length && (
            <Section title="Objections">
              <div className="flex flex-wrap gap-2">
                {record.objections.map((o) => (
                  <Badge key={o} variant="destructive" className="font-normal">{o}</Badge>
                ))}
              </div>
            </Section>
          )}

          {!!record.important_quotes?.length && (
            <Section title="Important Quotes">
              <div className="space-y-2">
                {record.important_quotes.map((q, i) => (
                  <div key={i} className="flex gap-2 rounded-md border border-border p-3">
                    <Quote className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
                    <p className="text-sm italic">{q}</p>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {!!record.tags?.length && (
            <Section title="Tags">
              <div className="flex flex-wrap gap-2">
                {record.tags.map((t) => <Badge key={t} variant="secondary" className="font-normal">{t}</Badge>)}
              </div>
            </Section>
          )}

          <Section title="Transcript">
            {segments.length ? (
              <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
                {segments.map((s, i) => (
                  <div key={i} className={s.speaker === 'Contact' ? 'text-left' : 'text-left'}>
                    <p className="text-xs font-semibold text-muted-foreground">{s.speaker}:</p>
                    <p className={`text-sm rounded-md p-2 ${s.speaker === 'Contact' ? 'bg-muted' : 'bg-primary/5'}`}>{s.text}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground italic">No transcript stored yet.</p>
            )}
          </Section>

          {timeline.length > 1 && (
            <Section title="Contact Timeline">
              <div className="space-y-2">
                {timeline.map((c) => (
                  <div
                    key={c.id}
                    className={`rounded-md border p-3 text-sm ${c.id === record.id ? 'border-primary' : 'border-border'}`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium">
                        {c.started_at ? new Date(c.started_at).toLocaleDateString() : '—'}
                      </span>
                      <span className="text-muted-foreground">{formatDuration(c.duration_seconds)}</span>
                    </div>
                    <p className="text-muted-foreground">
                      Intent: {c.intent_score ?? '—'} · Outcome: {c.outcome || '—'}
                    </p>
                  </div>
                ))}
              </div>
            </Section>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="font-medium">{value || '—'}</p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Separator />
      <h4 className="text-sm font-bold">{title}</h4>
      {children}
    </div>
  );
}
