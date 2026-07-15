import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useTeamMember } from '@/contexts/TeamMemberContext';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { toast } from 'sonner';
import {
  Mail, Phone, Send, Sparkles, ExternalLink, User, Tag as TagIcon,
  Clock, MessageSquare, Calendar, StickyNote, ArrowRight, Copy, PhoneCall,
  MapPin, Briefcase, DollarSign, TrendingUp, Award, Linkedin, Hash, RefreshCw, CalendarClock, X,
} from 'lucide-react';
import { formatDistanceToNowStrict, format } from 'date-fns';
import { fmtDuration, timeSinceISO, type SetterLead } from '@/hooks/useSetterLeads';
import { SmsThread } from './SmsThread';
import { markViewed } from '@/lib/setterViewState';

interface TimelineEvent {
  id: string;
  event_type: string;
  event_subtype: string | null;
  title: string | null;
  body: string | null;
  event_at: string;
  metadata: any;
}

function eventIcon(t: string) {
  const s = (t || '').toLowerCase();
  if (s.includes('sms') || s.includes('text') || s.includes('message')) return MessageSquare;
  if (s.includes('email') || s.includes('mail')) return Mail;
  if (s.includes('call') || s.includes('phone') || s.includes('voice')) return Phone;
  if (s.includes('appointment') || s.includes('booking') || s.includes('meeting')) return Calendar;
  if (s.includes('note')) return StickyNote;
  if (s.includes('task')) return ArrowRight;
  return Clock;
}

export function SetterDetailPanel({ lead, onChanged, onAdvance }: { lead: SetterLead | null; onChanged?: () => void; onAdvance?: () => void }) {
  const { currentMember } = useTeamMember();
  const [tab, setTab] = useState<'sms' | 'email'>('sms');
  const [text, setText] = useState('');
  const [subject, setSubject] = useState('');
  const [sending, setSending] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [tagInput, setTagInput] = useState('');
  const [assignee, setAssignee] = useState<string>('');
  const [members, setMembers] = useState<{ id: string; name: string }[]>([]);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [tlLoading, setTlLoading] = useState(false);
  const [syncingTimeline, setSyncingTimeline] = useState(false);
  const [disposition, setDisposition] = useState<string>('');
  const [savingDispo, setSavingDispo] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const [, setNowTick] = useState(0);
  const activeLeadIdRef = useRef<string | null>(null);
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const [callbackAt, setCallbackAt] = useState<string>('');
  const [callbackNote, setCallbackNote] = useState('');

  // Tick every 30s so the "last synced" label stays fresh.
  useEffect(() => {
    const t = setInterval(() => setNowTick((x) => x + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  const loadTimeline = async (l: SetterLead) => {
    // 1) contact_timeline_events by lead_id OR (client_id + ghl_contact_id)
    //    OR-across-columns is a bit ugly, so run two queries and merge.
    const [byLead, byContact, callsRes] = await Promise.all([
      supabase
        .from('contact_timeline_events')
        .select('id, event_type, event_subtype, title, body, event_at, metadata')
        .eq('lead_id', l.id)
        .order('event_at', { ascending: false })
        .limit(200),
      l.ghl_contact_id
        ? supabase
            .from('contact_timeline_events')
            .select('id, event_type, event_subtype, title, body, event_at, metadata')
            .eq('client_id', l.client_id)
            .eq('ghl_contact_id', l.ghl_contact_id)
            .order('event_at', { ascending: false })
            .limit(200)
        : Promise.resolve({ data: [] as any[] } as any),
      supabase
        .from('calls')
        .select('id, direction, outcome, summary, transcript, recording_url, booked_at, scheduled_at, showed_at, showed, call_duration_seconds, appointment_status, created_at')
        .eq('lead_id', l.id)
        .order('created_at', { ascending: false })
        .limit(50),
    ]);

    const merged = new Map<string, TimelineEvent>();
    for (const row of [...((byLead.data as any) || []), ...((byContact.data as any) || [])]) {
      merged.set(row.id, row);
    }
    // Map calls rows into synthetic timeline events (dedup vs GHL events by external_id in metadata)
    for (const c of (callsRes.data as any[]) || []) {
      const at = c.booked_at || c.scheduled_at || c.created_at;
      const dur = c.call_duration_seconds ? ` · ${Math.round(c.call_duration_seconds / 60)}m` : '';
      const status = c.appointment_status || (c.showed === true ? 'showed' : c.showed === false ? 'no-show' : null);
      merged.set(`call:${c.id}`, {
        id: `call:${c.id}`,
        event_type: c.recording_url || c.transcript ? 'call' : 'appointment',
        event_subtype: c.direction || null,
        title: [c.outcome, status].filter(Boolean).join(' · ') || null,
        body: c.summary || null,
        event_at: at,
        metadata: { source: 'calls_table', recording_url: c.recording_url, duration: dur.trim() },
      });
    }
    return Array.from(merged.values()).sort(
      (a, b) => new Date(b.event_at).getTime() - new Date(a.event_at).getTime(),
    );
  };

  useEffect(() => {
    supabase.from('agency_members').select('id, name').then(({ data }) => setMembers((data as any) || []));
  }, []);

  useEffect(() => {
    if (!lead) { setTimeline([]); return; }
    setText(''); setSubject('');
    setAssignee(lead.assigned_user || '');
    setDisposition(lead.current_disposition || '');
    setTlLoading(true);
    activeLeadIdRef.current = lead.id;
    // Mark lead as viewed so any new inbound after this moment lights the unread badge.
    markViewed(lead.id);
    const myLeadId = lead.id;
    (async () => {
      const rows = await loadTimeline(lead);
      if (activeLeadIdRef.current !== myLeadId) return; // stale — user switched leads
      setTimeline(rows);
      setTlLoading(false);
      setLastSyncedAt(new Date());
    })();
    // Realtime — refresh on any change touching this lead or contact
    const refresh = async () => {
      const rows = await loadTimeline(lead);
      if (activeLeadIdRef.current !== myLeadId) return;
      setTimeline(rows);
      setLastSyncedAt(new Date());
      // Any refresh implies user is looking at the thread — clear unread.
      markViewed(lead.id);
    };
    const ch = supabase
      .channel(`setter-lead-${lead.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'contact_timeline_events', filter: `lead_id=eq.${lead.id}` }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'calls', filter: `lead_id=eq.${lead.id}` }, refresh)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [lead?.id, lead?.ghl_contact_id]);

  const syncTimelineFromGHL = async () => {
    if (!lead?.ghl_contact_id) { toast.error('No GHL contact linked'); return; }
    setSyncingTimeline(true);
    try {
      const { data, error } = await supabase.functions.invoke('sync-ghl-contacts', {
        body: {
          client_id: lead.client_id,
          mode: 'deep_sync',
          contactId: lead.ghl_contact_id,
          contact_id: lead.ghl_contact_id,
          syncTimeline: true,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      const rows = await loadTimeline(lead);
      setTimeline(rows);
      setLastSyncedAt(new Date());
      toast.success(`Pulled ${data?.events_count ?? rows.length} events from GHL`);
    } catch (e: any) {
      toast.error(`Sync failed: ${e?.message || e}`);
    } finally {
      setSyncingTimeline(false);
    }
  };

  const draftAI = async () => {
    if (!lead) return;
    setDrafting(true);
    try {
      const { data, error } = await supabase.functions.invoke('setter-ai-opener', {
        body: { password: 'HPA1234$', lead_id: lead.id, channel: tab },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setText(data.text || '');
      if (tab === 'email' && data.subject) setSubject(data.subject);
      toast.success('Draft ready');
    } catch (e: any) {
      toast.error(`Draft failed: ${e?.message || e}`);
    } finally { setDrafting(false); }
  };

  const send = async () => {
    if (!lead) return;
    if (!text.trim()) { toast.warning('Message empty'); return; }
    if (tab === 'sms' && !lead.phone) { toast.error('Lead has no phone'); return; }
    if (tab === 'email' && !lead.email) { toast.error('Lead has no email'); return; }
    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke('setter-send-message', {
        body: {
          password: 'HPA1234$',
          client_id: lead.client_id,
          lead_id: lead.id,
          channel: tab,
          to_email: lead.email,
          to_phone: lead.phone,
          name: lead.name,
          subject: subject || undefined,
          text,
          sender_name: currentMember?.name || null,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success(`Sent ${tab.toUpperCase()}`);
      setText(''); setSubject('');
      onChanged?.();
    } catch (e: any) {
      toast.error(`Send failed: ${e?.message || e}`);
    } finally { setSending(false); }
  };

  const assign = async (memberName: string) => {
    if (!lead) return;
    setAssignee(memberName);
    await supabase.from('leads').update({ assigned_user: memberName || null }).eq('id', lead.id);
    toast.success(memberName ? `Assigned to ${memberName}` : 'Unassigned');
    onChanged?.();
  };

  const DISPOSITIONS: { value: string; label: string }[] = [
    { value: 'new', label: 'New' },
    { value: 'contacted', label: 'Contacted' },
    { value: 'callback', label: 'Callback scheduled' },
    { value: 'nurture', label: 'Nurture' },
    { value: 'qualified', label: 'Qualified' },
    { value: 'booked', label: 'Booked' },
    { value: 'showed', label: 'Showed' },
    { value: 'no_show', label: 'No-show' },
    { value: 'opportunity', label: 'Opportunity' },
    { value: 'funded', label: 'Funded' },
    { value: 'unqualified', label: 'Unqualified' },
    { value: 'not_accredited', label: 'Not accredited' },
    { value: 'not_interested', label: 'Not interested' },
    { value: 'bad_contact_info', label: 'Bad contact info' },
    { value: 'bad_lead', label: 'Bad lead' },
  ];

  const setDispo = async (value: string) => {
    if (!lead || !value) return;
    // For "callback" the user must schedule via the Snooze popover — open it and stop.
    if (value === 'callback') { setSnoozeOpen(true); return; }
    const prev = disposition;
    setDisposition(value);
    setSavingDispo(true);
    try {
      const now = new Date().toISOString();
      const { error: upErr } = await supabase
        .from('leads')
        .update({ current_disposition: value, disposition_updated_at: now })
        .eq('id', lead.id);
      if (upErr) throw upErr;
      const { error: insErr } = await supabase.from('lead_dispositions').insert({
        lead_id: lead.id,
        client_id: lead.client_id,
        disposition: value,
        disposition_reason: 'Manual — Setter',
        disposed_by: currentMember?.name || 'setter',
        source: 'setter_manual',
        disposed_at: now,
      });
      if (insErr) throw insErr;
      // Log to timeline for visibility
      await supabase.from('contact_timeline_events').insert({
        client_id: lead.client_id,
        lead_id: lead.id,
        ghl_contact_id: lead.ghl_contact_id || 'unknown',
        event_type: 'note',
        event_subtype: 'disposition',
        title: `Disposition: ${value}`,
        body: `Set by ${currentMember?.name || 'setter'}`,
        event_at: now,
        metadata: { via: 'setter', disposition: value, prev },
      });
      toast.success(`Disposition set: ${value}`);
      onChanged?.();
      // Advance to next uncontacted lead once a terminal-ish disposition is set
      const advance = new Set(['contacted','nurture','booked','showed','no_show','opportunity','funded','unqualified','not_accredited','not_interested','bad_contact_info','bad_lead']);
      if (advance.has(value)) onAdvance?.();
    } catch (e: any) {
      setDisposition(prev);
      toast.error(`Failed: ${e?.message || e}`);
    } finally { setSavingDispo(false); }
  };

  const scheduleCallback = async (isoDue: string, note: string) => {
    if (!lead || !isoDue) return;
    setSavingDispo(true);
    try {
      const now = new Date().toISOString();
      // Timeline event as the source of truth for the due time (queryable by useSetterLeads)
      await supabase.from('contact_timeline_events').insert({
        client_id: lead.client_id,
        lead_id: lead.id,
        ghl_contact_id: lead.ghl_contact_id || 'unknown',
        event_type: 'callback',
        event_subtype: 'scheduled',
        title: `Callback scheduled for ${format(new Date(isoDue), 'MMM d, h:mm a')}`,
        body: note || null,
        event_at: isoDue,
        metadata: { via: 'setter', note, scheduled_at: now, scheduled_by: currentMember?.name || 'setter' },
      });
      // Also flip disposition to 'callback' so it renders in the intel bar
      await supabase.from('leads').update({ current_disposition: 'callback', disposition_updated_at: now }).eq('id', lead.id);
      await supabase.from('lead_dispositions').insert({
        lead_id: lead.id, client_id: lead.client_id, disposition: 'callback',
        disposition_reason: `Callback scheduled ${format(new Date(isoDue), 'MMM d, h:mm a')}`,
        disposed_by: currentMember?.name || 'setter', source: 'setter_manual', disposed_at: now,
      });
      setDisposition('callback');
      setSnoozeOpen(false);
      setCallbackAt('');
      setCallbackNote('');
      toast.success(`Callback set for ${format(new Date(isoDue), 'MMM d · h:mm a')}`);
      onChanged?.();
      onAdvance?.();
    } catch (e: any) {
      toast.error(`Callback failed: ${e?.message || e}`);
    } finally { setSavingDispo(false); }
  };

  const clearCallback = async () => {
    if (!lead) return;
    try {
      // Neutralize: log a cancellation event dated in the past so it drops out of "upcoming"
      await supabase.from('contact_timeline_events').insert({
        client_id: lead.client_id,
        lead_id: lead.id,
        ghl_contact_id: lead.ghl_contact_id || 'unknown',
        event_type: 'note',
        event_subtype: 'callback_cancelled',
        title: 'Callback cancelled',
        event_at: new Date().toISOString(),
        metadata: { via: 'setter' },
      });
      // Delete future callback events for this lead
      await supabase.from('contact_timeline_events')
        .delete()
        .eq('lead_id', lead.id)
        .eq('event_type', 'callback')
        .gte('event_at', new Date().toISOString());
      toast.success('Callback cleared');
      onChanged?.();
    } catch (e: any) {
      toast.error(`Failed: ${e?.message || e}`);
    }
  };

  // Presets for the snooze popover (relative to now)
  const snoozePresets = useMemo(() => {
    const now = new Date();
    const later = (h: number, m = 0) => { const d = new Date(now); d.setHours(d.getHours() + h, m, 0, 0); return d; };
    const tomorrow9 = () => { const d = new Date(now); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); return d; };
    const nextMon9 = () => {
      const d = new Date(now); const dow = d.getDay(); const add = (8 - dow) % 7 || 7;
      d.setDate(d.getDate() + add); d.setHours(9, 0, 0, 0); return d;
    };
    return [
      { label: 'In 1 hour', date: later(1) },
      { label: 'In 3 hours', date: later(3) },
      { label: 'Tomorrow 9am', date: tomorrow9() },
      { label: 'Next Mon 9am', date: nextMon9() },
    ];
  }, []);

  const localDatetimeValue = (d: Date) => {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const addTag = async () => {
    if (!lead || !tagInput.trim()) return;
    const tag = tagInput.trim();
    await supabase.from('contact_timeline_events').insert({
      client_id: lead.client_id,
      lead_id: lead.id,
      ghl_contact_id: lead.ghl_contact_id || 'unknown',
      event_type: 'note',
      event_subtype: 'tag',
      title: `Tag: ${tag}`,
      body: tag,
      event_at: new Date().toISOString(),
      metadata: { via: 'setter', tag },
    });
    setTagInput('');
    toast.success(`Tagged: ${tag}`);
  };

  const untouchedFor = lead && lead.touch_count === 0 ? timeSinceISO(lead.created_at) : 0;

  const questions = useMemo(() => {
    if (!lead || !Array.isArray(lead.questions)) return [];
    return lead.questions.map((q: any) => ({
      q: q.question || q.q || '',
      a: q.answer || q.a || '',
    })).filter((x: any) => x.q || x.a).slice(0, 8);
  }, [lead]);

  const copyText = (v: string) => {
    navigator.clipboard.writeText(v).then(() => toast.success('Copied'));
  };
  const e = lead?.enrichment || null;
  const fmtMoney = (n?: number | null) => (n && n > 0 ? `$${Math.round(n).toLocaleString()}` : null);
  const scorePct = (n?: number | null) => (n == null ? null : (n <= 1 ? Math.round(n * 100) : Math.round(n)));

  if (!lead) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-muted-foreground text-sm gap-2">
        <Zap className="w-8 h-8 opacity-30" />
        <div>Pick a lead to work</div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="border-b p-4 flex items-start gap-4">
        <div className="w-11 h-11 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
          <User className="w-5 h-5 text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold truncate">{lead.name || 'Unnamed lead'}</h2>
            <Badge variant="outline" className="text-[10px]">{lead.client_name}</Badge>
            {lead.status && <Badge variant="secondary" className="text-[10px]">{lead.status}</Badge>}
          </div>
          <div className="flex items-center gap-4 mt-1 text-xs text-muted-foreground flex-wrap">
            {lead.email && (
              <span className="inline-flex items-center gap-1 group">
                <Mail className="w-3 h-3" />
                <a href={`mailto:${lead.email}`} className="hover:text-foreground hover:underline">{lead.email}</a>
                <button onClick={() => copyText(lead.email!)} className="opacity-0 group-hover:opacity-100 transition" title="Copy"><Copy className="w-3 h-3" /></button>
              </span>
            )}
            {lead.phone && (
              <span className="inline-flex items-center gap-1 group">
                <Phone className="w-3 h-3" />
                <a href={`tel:${lead.phone}`} className="hover:text-foreground hover:underline">{lead.phone}</a>
                <button onClick={() => copyText(lead.phone!)} className="opacity-0 group-hover:opacity-100 transition" title="Copy"><Copy className="w-3 h-3" /></button>
              </span>
            )}
            <span>Created {formatDistanceToNowStrict(new Date(lead.created_at))} ago</span>
            {lead.prior_calls > 0 && <span className="inline-flex items-center gap-1 text-primary"><PhoneCall className="w-3 h-3" />{lead.prior_calls} prior call{lead.prior_calls === 1 ? '' : 's'}</span>}
          </div>
        </div>
        {/* Speed to lead card */}
        <div className="text-right flex-shrink-0">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Speed to lead</div>
          {lead.touch_count === 0 ? (
            <div className={`font-mono tabular-nums text-2xl font-bold ${
              untouchedFor < 300 ? 'text-emerald-500' : untouchedFor < 900 ? 'text-amber-500' : 'text-destructive'
            }`}>
              {fmtDuration(untouchedFor)}
            </div>
          ) : (
            <div className="text-emerald-500 font-mono tabular-nums text-lg font-bold">
              {fmtDuration(lead.time_to_first_touch_s || 0)}
            </div>
          )}
          <div className="text-[10px] text-muted-foreground">
            {lead.touch_count === 0 ? 'no touches yet' : `${lead.touch_count} touch${lead.touch_count === 1 ? '' : 'es'}`}
          </div>
        </div>
      </div>

      {/* Quick actions bar */}
      <div className="border-b p-3 flex items-center gap-2 flex-wrap bg-muted/20">
        {lead.phone && (
          <Button size="sm" variant="default" asChild>
            <a href={`tel:${lead.phone}`}><PhoneCall className="w-3.5 h-3.5 mr-1" />Call</a>
          </Button>
        )}
        {lead.email && (
          <Button size="sm" variant="outline" asChild>
            <a href={`mailto:${lead.email}`}><Mail className="w-3.5 h-3.5 mr-1" />Mail</a>
          </Button>
        )}
        <select
          value={assignee}
          onChange={(e) => assign(e.target.value)}
          className="h-8 rounded-md border bg-background px-2 text-sm"
        >
          <option value="">Unassigned</option>
          {members.map(m => <option key={m.id} value={m.name}>{m.name}</option>)}
        </select>
        <select
          value={disposition}
          onChange={(e) => setDispo(e.target.value)}
          disabled={savingDispo}
          className={`h-8 rounded-md border px-2 text-sm ${disposition ? 'bg-primary/10 border-primary/40 text-primary font-medium' : 'bg-background'}`}
          title="Lead disposition (GHL custom field)"
        >
          <option value="">Set disposition…</option>
          {DISPOSITIONS.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
        </select>
        <Popover open={snoozeOpen} onOpenChange={setSnoozeOpen}>
          <PopoverTrigger asChild>
            <Button size="sm" variant={lead.next_callback_at ? 'default' : 'outline'} className="gap-1">
              <CalendarClock className="w-3.5 h-3.5" />
              {lead.next_callback_at
                ? `Callback ${formatDistanceToNowStrict(new Date(lead.next_callback_at), { addSuffix: true })}`
                : 'Snooze / Callback'}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-80 p-3 space-y-2" align="start">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Schedule a callback</div>
            <div className="grid grid-cols-2 gap-1.5">
              {snoozePresets.map((p) => (
                <Button
                  key={p.label}
                  size="sm"
                  variant="outline"
                  className="text-xs justify-start"
                  onClick={() => scheduleCallback(p.date.toISOString(), callbackNote)}
                >
                  <CalendarClock className="w-3 h-3 mr-1" />{p.label}
                </Button>
              ))}
            </div>
            <div className="border-t pt-2 space-y-2">
              <Input
                type="datetime-local"
                value={callbackAt}
                onChange={(e) => setCallbackAt(e.target.value)}
                min={localDatetimeValue(new Date())}
                className="h-8 text-sm"
              />
              <Textarea
                rows={2}
                placeholder="Note (optional) — what to say/ask on callback"
                value={callbackNote}
                onChange={(e) => setCallbackNote(e.target.value)}
                className="text-sm"
              />
              <div className="flex items-center justify-between gap-2">
                {lead.next_callback_at && (
                  <Button size="sm" variant="ghost" onClick={clearCallback} className="text-destructive gap-1">
                    <X className="w-3.5 h-3.5" />Clear
                  </Button>
                )}
                <Button
                  size="sm"
                  className="ml-auto"
                  disabled={!callbackAt || savingDispo}
                  onClick={() => callbackAt && scheduleCallback(new Date(callbackAt).toISOString(), callbackNote)}
                >
                  Schedule
                </Button>
              </div>
              {lead.next_callback_at && (
                <div className="text-[10px] text-muted-foreground">
                  Current: {format(new Date(lead.next_callback_at), 'EEE, MMM d · h:mm a')}
                  {lead.callback_note && <div className="italic mt-0.5">"{lead.callback_note}"</div>}
                </div>
              )}
            </div>
          </PopoverContent>
        </Popover>
        <div className="flex items-center gap-1">
          <Input
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addTag()}
            placeholder="Add tag / note"
            className="h-8 w-40 text-sm"
          />
          <Button size="sm" variant="ghost" onClick={addTag}><TagIcon className="w-3.5 h-3.5" /></Button>
        </div>
        {lead.ghl_contact_id && (
          <Button size="sm" variant="outline" asChild className="ml-auto">
            <a
              href={`https://app.gohighlevel.com/v2/location/${lead.client_id}/contacts/detail/${lead.ghl_contact_id}`}
              target="_blank" rel="noreferrer"
            >
              <ExternalLink className="w-3.5 h-3.5 mr-1" />GHL
            </a>
          </Button>
        )}
      </div>

      {/* Enrichment / intel */}
      {(e || lead.opportunity_stage || lead.quality_score != null) && (
        <div className="border-b p-3 bg-gradient-to-r from-primary/5 to-transparent">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Contact intel</div>
            {e?.enriched_at && <div className="text-[10px] text-muted-foreground">Enriched {formatDistanceToNowStrict(new Date(e.enriched_at))} ago</div>}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
            {e?.investor_score != null && (
              <IntelCell icon={TrendingUp} label="Investor score" value={`${scorePct(e.investor_score)}/100`} tone="primary" />
            )}
            {e?.accredited_probability != null && (
              <IntelCell icon={Award} label="Accredited" value={`${scorePct(e.accredited_probability)}%`} tone={scorePct(e.accredited_probability)! >= 70 ? 'good' : 'default'} />
            )}
            {e?.household_income && <IntelCell icon={DollarSign} label="HH income" value={e.household_income} />}
            {e?.net_worth && <IntelCell icon={DollarSign} label="Net worth" value={e.net_worth} />}
            {e?.home_value && <IntelCell icon={MapPin} label="Home value" value={fmtMoney(e.home_value)!} />}
            {e?.home_ownership && <IntelCell icon={MapPin} label="Home" value={e.home_ownership} />}
            {(e?.city || e?.state) && <IntelCell icon={MapPin} label="Location" value={[e?.city, e?.state, e?.zip].filter(Boolean).join(', ')} />}
            {(e?.age || e?.gender) && <IntelCell icon={User} label="Demo" value={[e?.age ? `${e.age}yo` : null, e?.gender].filter(Boolean).join(' · ')} />}
            {(e?.company_title || e?.company_name) && <IntelCell icon={Briefcase} label="Work" value={[e?.company_title, e?.company_name].filter(Boolean).join(' @ ')} />}
            {e?.occupation && !e?.company_title && <IntelCell icon={Briefcase} label="Occupation" value={e.occupation} />}
            {e?.is_investor && <IntelCell icon={TrendingUp} label="Flag" value="Known investor" tone="good" />}
            {e?.business_owner && <IntelCell icon={Briefcase} label="Flag" value="Business owner" tone="good" />}
            {lead.quality_score != null && <IntelCell icon={Award} label="Quality" value={String(lead.quality_score)} />}
            {lead.opportunity_stage && <IntelCell icon={Hash} label="Stage" value={lead.opportunity_stage} tone="primary" />}
            {lead.opportunity_value != null && lead.opportunity_value > 0 && <IntelCell icon={DollarSign} label="Opp value" value={fmtMoney(lead.opportunity_value)!} tone="good" />}
            {lead.current_disposition && <IntelCell icon={Hash} label="Disposition" value={lead.current_disposition} />}
          </div>
          {e?.linkedin_url && (
            <a href={e.linkedin_url} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs text-primary hover:underline">
              <Linkedin className="w-3 h-3" />LinkedIn profile
            </a>
          )}
          {(lead.utm_source || lead.campaign_name || lead.ad_set_name || lead.ad_id) && (
            <div className="mt-2 pt-2 border-t border-border/50 flex flex-wrap gap-1.5 text-[10px]">
              {lead.utm_source && <Badge variant="secondary">src:{lead.utm_source}</Badge>}
              {lead.utm_medium && <Badge variant="secondary">med:{lead.utm_medium}</Badge>}
              {lead.campaign_name && <Badge variant="outline">📣 {lead.campaign_name}</Badge>}
              {lead.ad_set_name && <Badge variant="outline">🎯 {lead.ad_set_name}</Badge>}
              {lead.ad_id && <Badge variant="outline" className="font-mono">ad:{lead.ad_id.slice(-8)}</Badge>}
            </div>
          )}
        </div>
      )}

      {/* Form answers if any */}
      {questions.length > 0 && (
        <div className="border-b p-3 bg-muted/10">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Form answers</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1 text-xs">
            {questions.map((q, i) => (
              <div key={i}><span className="text-muted-foreground">{q.q}:</span> <span className="font-medium">{q.a}</span></div>
            ))}
          </div>
        </div>
      )}

      {lead.ghl_notes && (
        <div className="border-b p-3 bg-amber-500/5">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">GHL notes</div>
          <div className="text-xs whitespace-pre-wrap">{lead.ghl_notes}</div>
        </div>
      )}

      {/* Timeline */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Timeline {timeline.length > 0 && <span className="normal-case text-muted-foreground/70">· {timeline.length} events</span>}
          </div>
          {lead.ghl_contact_id && (
            <Button size="sm" variant="ghost" onClick={syncTimelineFromGHL} disabled={syncingTimeline} className="h-6 text-[10px]">
              <RefreshCw className={`w-3 h-3 mr-1 ${syncingTimeline ? 'animate-spin' : ''}`} />
              {syncingTimeline ? 'Syncing…' : 'Sync from GHL'}
            </Button>
          )}
        </div>
        {tlLoading && <div className="text-sm text-muted-foreground">Loading…</div>}
        {!tlLoading && timeline.length === 0 && (
          <div className="text-sm text-muted-foreground py-8 text-center border border-dashed rounded-lg">
            No activity yet. Be first to touch — or click "Sync from GHL" to pull existing history.
          </div>
        )}
        <div className="space-y-2">
          {timeline.map((e) => {
            const Icon = eventIcon(e.event_type);
            const sub = (e.event_subtype || '').toLowerCase();
            const outbound = sub === 'outbound' || sub.startsWith('out');
            const inbound = sub === 'inbound' || sub.startsWith('in') || sub === 'received';
            const recording = e.metadata?.recording_url as string | undefined;
            return (
              <div key={e.id} className={`flex gap-3 text-sm p-2 rounded-lg border ${outbound ? 'bg-primary/5 border-primary/20' : inbound ? 'bg-emerald-500/5 border-emerald-500/20' : 'bg-muted/30'}`}>
                <Icon className={`w-4 h-4 flex-shrink-0 mt-0.5 ${outbound ? 'text-primary' : inbound ? 'text-emerald-500' : 'text-muted-foreground'}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium capitalize">{e.event_type}</span>
                    {e.event_subtype && <Badge variant="outline" className="text-[10px]">{e.event_subtype}</Badge>}
                    {outbound && <Badge variant="secondary" className="text-[10px]">out</Badge>}
                    {inbound && <Badge className="text-[10px] bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 border-emerald-500/30">in</Badge>}
                    <span className="text-xs text-muted-foreground ml-auto">{format(new Date(e.event_at), 'MMM d · h:mm a')}</span>
                  </div>
                  {e.title && <div className="text-xs text-muted-foreground mt-0.5">{e.title}</div>}
                  {e.body && <div className="text-sm mt-1 whitespace-pre-wrap">{e.body}</div>}
                  {recording && (
                    <a href={recording} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-[10px] text-primary hover:underline">
                      <Phone className="w-3 h-3" />Recording
                    </a>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Composer */}
      <div className="border-t p-3 bg-card">
        <Tabs value={tab} onValueChange={(v) => setTab(v as 'sms' | 'email')}>
          {/* Chat-bubble thread scoped to the active channel */}
          <SmsThread
            events={timeline}
            leadName={lead.name}
            channel={tab}
            lastSyncedAt={lastSyncedAt}
            syncing={syncingTimeline}
            onRefresh={lead.ghl_contact_id ? syncTimelineFromGHL : undefined}
          />
          <div className="flex items-center gap-2 mb-2">
            <TabsList className="h-8">
              <TabsTrigger value="sms" disabled={!lead.phone} className="text-xs">SMS</TabsTrigger>
              <TabsTrigger value="email" disabled={!lead.email} className="text-xs">Email</TabsTrigger>
            </TabsList>
            <Button size="sm" variant="ghost" onClick={draftAI} disabled={drafting} className="ml-auto text-xs">
              <Sparkles className="w-3.5 h-3.5 mr-1" />{drafting ? 'Drafting…' : 'AI opener'}
            </Button>
          </div>
          <TabsContent value="sms" className="mt-0 space-y-2">
            <Textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder={`Text ${lead.name?.split(' ')[0] || 'lead'}…`} />
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{text.length}/320 chars · Sends via client's GHL</span>
              <Button size="sm" onClick={send} disabled={sending || !text.trim()}>
                <Send className="w-3.5 h-3.5 mr-1" />{sending ? 'Sending…' : 'Send SMS'}
              </Button>
            </div>
          </TabsContent>
          <TabsContent value="email" className="mt-0 space-y-2">
            <Input placeholder="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} className="text-sm" />
            <Textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder="Write email…" />
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Sends via client's GHL</span>
              <Button size="sm" onClick={send} disabled={sending || !text.trim() || !subject.trim()}>
                <Send className="w-3.5 h-3.5 mr-1" />{sending ? 'Sending…' : 'Send Email'}
              </Button>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function Zap({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
    </svg>
  );
}

function IntelCell({ icon: Icon, label, value, tone = 'default' }: { icon: any; label: string; value: string; tone?: 'default' | 'primary' | 'good' }) {
  const color =
    tone === 'primary' ? 'text-primary' :
    tone === 'good' ? 'text-emerald-500' : 'text-foreground';
  return (
    <div className="flex items-start gap-1.5 min-w-0">
      <Icon className={`w-3.5 h-3.5 mt-0.5 flex-shrink-0 ${tone === 'default' ? 'text-muted-foreground' : color}`} />
      <div className="min-w-0 flex-1">
        <div className="text-[9px] uppercase tracking-wider text-muted-foreground leading-tight">{label}</div>
        <div className={`text-xs font-medium truncate ${color}`} title={value}>{value}</div>
      </div>
    </div>
  );
}

function ConversationThread({
  events,
  leadName,
  lastSyncedAt,
  syncing,
  onRefresh,
}: {
  events: TimelineEvent[];
  leadName: string | null;
  lastSyncedAt?: Date | null;
  syncing?: boolean;
  onRefresh?: () => void;
}) {
  // Filter to conversational channels only; sort oldest -> newest so chat reads top-down like GHL.
  const convo = events
    .filter((e) => {
      const t = (e.event_type || '').toLowerCase();
      return t.includes('sms') || t.includes('text') || t.includes('message') || t.includes('email') || t.includes('mail');
    })
    .slice()
    .sort((a, b) => new Date(a.event_at).getTime() - new Date(b.event_at).getTime());

  const syncedLabel = lastSyncedAt
    ? `Last messages synced ${formatDistanceToNowStrict(lastSyncedAt)} ago`
    : 'Messages not synced yet';

  const Header = (
    <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/30 rounded-t-lg text-[10px] uppercase tracking-wider text-muted-foreground">
      <span>Conversation {convo.length > 0 && <span className="normal-case text-muted-foreground/70">· {convo.length}</span>}</span>
      <div className="flex items-center gap-2 normal-case">
        <span className="text-[10px]">{syncedLabel}</span>
        {onRefresh && (
          <button
            onClick={onRefresh}
            disabled={syncing}
            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-background disabled:opacity-50"
            title="Refresh conversation from GHL"
          >
            <RefreshCw className={`w-3 h-3 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? 'Syncing…' : 'Refresh'}
          </button>
        )}
      </div>
    </div>
  );

  if (convo.length === 0) {
    return (
      <div className="mb-3 rounded-lg border border-dashed bg-muted/10">
        {Header}
        <div className="flex items-center justify-center text-xs text-muted-foreground py-12">
          No SMS or email history yet with {leadName?.split(' ')[0] || 'this lead'}.
        </div>
      </div>
    );
  }

  return (
    <div className="mb-3 rounded-lg border bg-muted/10 flex flex-col">
      {Header}
      <div className="h-[420px] overflow-y-auto p-4 space-y-3">
      {convo.map((e) => {
        const sub = (e.event_subtype || '').toLowerCase();
        const outbound = sub === 'outbound' || sub.startsWith('out') || sub === 'sent';
        const t = (e.event_type || '').toLowerCase();
        const isEmail = t.includes('email') || t.includes('mail');
        const channel = isEmail ? 'Email' : 'SMS';
        return (
          <div key={e.id} className={`flex ${outbound ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[78%] rounded-2xl px-4 py-2.5 text-sm shadow-sm ${
              outbound
                ? 'bg-blue-500 text-white rounded-br-sm'
                : 'bg-background border rounded-bl-sm'
            }`}>
              {isEmail && e.title && (
                <div className={`text-[10px] font-semibold mb-1 truncate ${outbound ? 'text-blue-50' : 'text-muted-foreground'}`}>
                  {e.title}
                </div>
              )}
              <div className="whitespace-pre-wrap break-words">{e.body || e.title || '(no content)'}</div>
              <div className={`text-[10px] mt-1 ${outbound ? 'text-blue-100' : 'text-muted-foreground'}`}>
                {channel} · {format(new Date(e.event_at), 'MMM d · h:mm a')}
              </div>
            </div>
          </div>
        );
      })}
      </div>
    </div>
  );
}