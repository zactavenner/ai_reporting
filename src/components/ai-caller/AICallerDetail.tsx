import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Play, Sparkles, Quote, CalendarClock, Bot, User } from 'lucide-react';
import {
  AiCallRecord,
  useReanalyzeAiCall,
  useUpdateAiCallAppointment,
} from '@/hooks/useAiCallerCalls';
import {
  APPOINTMENT_STATUSES,
  appointmentTone,
  formatDuration,
  intentLabel,
  intentTone,
  isAnswered,
  isBooked,
  isQualified,
  statusLabel,
  statusTone,
  transcriptSegments,
} from './aiCallerUtils';

interface Props {
  call: AiCallRecord | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AICallerDetail({ call, open, onOpenChange }: Props) {
  const reanalyze = useReanalyzeAiCall();
  const updateAppointment = useUpdateAiCallAppointment();
  if (!call) return null;

  const segments = transcriptSegments(call);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="text-left">
            {call.contact_name || call.contact_phone || 'Unknown contact'}
          </SheetTitle>
        </SheetHeader>

        <div className="mt-4 space-y-6">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={statusTone(call.call_status)}>{statusLabel(call.call_status)}</Badge>
            {call.intent_score !== null && (
              <Badge variant={intentTone(call.intent_score)}>
                Intent {call.intent_score}/100 — {intentLabel(call.intent_score)}
              </Badge>
            )}
            {call.outcome && <Badge variant="outline">{call.outcome}</Badge>}
            <Badge variant="secondary">{formatDuration(call.duration_seconds)}</Badge>
            <Badge variant="outline">{isAnswered(call) ? 'Answered' : 'Not answered'}</Badge>
            {isQualified(call) && <Badge>Qualified</Badge>}
            {isBooked(call) && <Badge>Appointment Booked</Badge>}
            {call.follow_up_required && <Badge variant="destructive">Follow-up required</Badge>}
          </div>

          <Section title="Contact Information">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <Field label="Name" value={call.contact_name} />
              <Field label="Phone" value={call.contact_phone} />
              <Field label="Email" value={call.contact_email} />
              <Field label="Assigned user" value={call.assigned_user} />
            </div>
          </Section>

          <Section title="Call Information">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <Field
                label="Call date"
                value={call.started_at ? new Date(call.started_at).toLocaleString() : null}
              />
              <Field label="Duration" value={formatDuration(call.duration_seconds)} />
              <Field label="Call status" value={statusLabel(call.call_status)} />
              <Field label="AI agent" value={call.ai_agent || call.provider} />
              <Field label="Campaign" value={call.campaign} />
              <Field
                label="Answered at"
                value={call.answered_at ? new Date(call.answered_at).toLocaleString() : null}
              />
            </div>
            <div className="flex flex-wrap gap-2 pt-2">
              {call.recording_url && (
                <Button size="sm" variant="outline" onClick={() => window.open(call.recording_url!, '_blank')}>
                  <Play className="h-4 w-4 mr-2" /> Recording
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                disabled={reanalyze.isPending}
                onClick={() => reanalyze.mutate(call.id)}
              >
                <Sparkles className={`h-4 w-4 mr-2 ${reanalyze.isPending ? 'animate-pulse' : ''}`} />
                Re-analyze
              </Button>
            </div>
          </Section>

          {isBooked(call) && (
            <Section title="Appointment">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <Field
                  label="Appointment date"
                  value={call.appointment_date ? new Date(call.appointment_date).toLocaleDateString() : null}
                />
                <Field
                  label="Appointment time"
                  value={
                    call.appointment_date
                      ? new Date(call.appointment_date).toLocaleTimeString([], {
                          hour: 'numeric',
                          minute: '2-digit',
                        })
                      : null
                  }
                />
                <Field label="Assigned rep" value={call.assigned_user} />
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Status</p>
                  <Select
                    value={call.appointment_status || 'Booked'}
                    onValueChange={(status) => updateAppointment.mutate({ recordId: call.id, status })}
                  >
                    <SelectTrigger className="h-8 mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {APPOINTMENT_STATUSES.map((s) => (
                        <SelectItem key={s} value={s}>{s}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <p className="flex items-center gap-2 text-xs text-muted-foreground pt-1">
                <CalendarClock className="h-3.5 w-3.5" />
                Booked by the AI caller
                <Badge variant={appointmentTone(call.appointment_status)} className="ml-1">
                  {call.appointment_status || 'Booked'}
                </Badge>
              </p>
            </Section>
          )}

          <Section title="AI Analysis">
            {call.summary ? (
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">{call.summary}</p>
            ) : (
              <p className="text-sm italic text-muted-foreground">No summary generated yet.</p>
            )}
            <div className="grid grid-cols-2 gap-3 text-sm pt-2">
              <Field label="Intent score" value={call.intent_score !== null ? `${call.intent_score}/100` : null} />
              <Field label="Outcome" value={call.outcome} />
              <Field
                label="Investment amount"
                value={
                  call.investment_range ||
                  (call.investment_amount ? `$${Number(call.investment_amount).toLocaleString()}` : null)
                }
              />
              <Field label="Accredited" value={call.accredited} />
              <Field label="Timeline" value={call.investment_timeline} />
              <Field label="Next step" value={call.next_step} />
            </div>
            {!!call.objections?.length && (
              <div className="flex flex-wrap gap-2 pt-2">
                {call.objections.map((o) => (
                  <Badge key={o} variant="destructive" className="font-normal">{o}</Badge>
                ))}
              </div>
            )}
            {!!call.important_quotes?.length && (
              <div className="space-y-2 pt-2">
                {call.important_quotes.map((q, i) => (
                  <div key={i} className="flex gap-2 rounded-md border border-border p-3">
                    <Quote className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
                    <p className="text-sm italic">{q}</p>
                  </div>
                ))}
              </div>
            )}
          </Section>

          <Section title="Call Transcript">
            {segments.length ? (
              <div className="space-y-3">
                {segments.map((s, i) => {
                  const isAi = s.speaker === 'AI Caller';
                  return (
                    <div key={i} className={`flex gap-2 ${isAi ? '' : 'flex-row-reverse'}`}>
                      <div className="mt-1 shrink-0 text-muted-foreground">
                        {isAi ? <Bot className="h-4 w-4" /> : <User className="h-4 w-4" />}
                      </div>
                      <div className={`max-w-[85%] ${isAi ? 'text-left' : 'text-right'}`}>
                        <p className="text-xs font-semibold text-muted-foreground">{s.speaker}</p>
                        <p
                          className={`text-sm rounded-lg px-3 py-2 mt-1 ${
                            isAi ? 'bg-muted' : 'bg-primary/10'
                          }`}
                        >
                          {s.text}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm italic text-muted-foreground">No transcript stored yet.</p>
            )}
          </Section>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Field({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="font-medium break-words">{value || '—'}</p>
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
