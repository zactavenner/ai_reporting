import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface SetterLead {
  id: string;
  client_id: string;
  client_name: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  source: string;
  campaign_name: string | null;
  utm_source: string | null;
  created_at: string;
  updated_at: string;
  status: string | null;
  assigned_user: string | null;
  is_spam: boolean | null;
  questions: any;
  ghl_contact_id?: string | null;
  external_id?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  utm_content?: string | null;
  ad_id?: string | null;
  ad_set_name?: string | null;
  custom_fields?: any;
  ghl_notes?: string | null;
  opportunity_status?: string | null;
  opportunity_stage?: string | null;
  opportunity_value?: number | null;
  current_disposition?: string | null;
  quality_score?: number | null;
  pipeline_value?: number | null;
  // enrichment (subset)
  enrichment?: {
    first_name?: string | null;
    last_name?: string | null;
    city?: string | null;
    state?: string | null;
    zip?: string | null;
    age?: number | null;
    gender?: string | null;
    household_income?: string | null;
    net_worth?: string | null;
    home_value?: number | null;
    home_ownership?: string | null;
    occupation?: string | null;
    company_name?: string | null;
    company_title?: string | null;
    linkedin_url?: string | null;
    is_investor?: boolean | null;
    investor_score?: number | null;
    accredited_probability?: number | null;
    business_owner?: boolean | null;
    confidence_score?: number | null;
    enriched_at?: string | null;
    enriched_phones?: any;
    enriched_emails?: any;
  } | null;
  // computed
  first_touch_at: string | null;
  last_touch_at: string | null;
  touch_count: number;
  time_to_first_touch_s: number | null; // null = never contacted
  prior_calls: number;
}

function since(iso: string) {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
}

export function useSetterLeads() {
  const [leads, setLeads] = useState<SetterLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setError(null);
    try {
      const since24 = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      const { data: rawLeads, error: lErr } = await supabase
        .from('leads')
        .select('id, client_id, name, email, phone, source, campaign_name, utm_source, utm_medium, utm_campaign, utm_content, ad_id, ad_set_name, custom_fields, ghl_notes, opportunity_status, opportunity_stage, opportunity_value, current_disposition, quality_score, pipeline_value, created_at, updated_at, status, assigned_user, is_spam, questions, external_id')
        .gte('created_at', since24)
        .order('created_at', { ascending: false })
        .limit(500);
      if (lErr) throw lErr;
      const ls = (rawLeads || []) as any[];

      const clientIds = Array.from(new Set(ls.map(l => l.client_id)));
      const leadIds = ls.map(l => l.id);

      const [{ data: clients }, callsRes, timelineRes, enrichmentRes] = await Promise.all([
        supabase.from('clients').select('id, name').in('id', clientIds),
        leadIds.length ? supabase.from('calls').select('lead_id, created_at, direction').in('lead_id', leadIds) : Promise.resolve({ data: [] as any[] }),
        leadIds.length ? supabase.from('contact_timeline_events').select('lead_id, event_at, event_type, event_subtype, ghl_contact_id').in('lead_id', leadIds) : Promise.resolve({ data: [] as any[] }),
        leadIds.length ? supabase.from('lead_enrichment').select('lead_id, first_name, last_name, city, state, zip, age, gender, household_income, net_worth, home_value, home_ownership, occupation, company_name, company_title, linkedin_url, is_investor, investor_score, accredited_probability, business_owner, confidence_score, last_enriched_at, enriched_at, enriched_phones, enriched_emails').in('lead_id', leadIds) : Promise.resolve({ data: [] as any[] }),
      ]);

      const cMap: Record<string, string> = {};
      (clients || []).forEach((c: any) => { cMap[c.id] = c.name; });
      const enrichMap: Record<string, any> = {};
      ((enrichmentRes as any).data || []).forEach((e: any) => {
        if (!enrichMap[e.lead_id]) enrichMap[e.lead_id] = { ...e, enriched_at: e.last_enriched_at || e.enriched_at };
      });

      // Consider a "touch" as: outbound call, or outbound SMS/email event, or any appointment
      const touchesByLead: Record<string, string[]> = {};
      const callsByLead: Record<string, number> = {};
      const ghlContactByLead: Record<string, string | null> = {};
      ((callsRes as any).data || []).forEach((c: any) => {
        callsByLead[c.lead_id] = (callsByLead[c.lead_id] || 0) + 1;
        if (c.direction === 'outbound') {
          (touchesByLead[c.lead_id] ||= []).push(c.created_at);
        }
      });
      ((timelineRes as any).data || []).forEach((e: any) => {
        if (e.ghl_contact_id && !ghlContactByLead[e.lead_id]) ghlContactByLead[e.lead_id] = e.ghl_contact_id;
        // A "touch" = the team reached out. Only count outbound events + booked appointments.
        // Inbound replies must NOT flip a lead to "contacted" — the setter still needs to work it.
        const isOutbound = e.event_subtype === 'outbound';
        const isAppt = e.event_type === 'appointment';
        if (isOutbound || isAppt) {
          (touchesByLead[e.lead_id] ||= []).push(e.event_at);
        }
      });

      const rows: SetterLead[] = ls.map((l) => {
        const touches = (touchesByLead[l.id] || []).sort();
        const first = touches[0] || null;
        const last = touches[touches.length - 1] || null;
        const ttft = first ? Math.max(0, Math.floor((new Date(first).getTime() - new Date(l.created_at).getTime()) / 1000)) : null;
        return {
          id: l.id,
          client_id: l.client_id,
          client_name: cMap[l.client_id] || 'Unknown',
          name: l.name,
          email: l.email,
          phone: l.phone,
          source: l.source,
          campaign_name: l.campaign_name,
          utm_source: l.utm_source,
          utm_medium: l.utm_medium,
          utm_campaign: l.utm_campaign,
          utm_content: l.utm_content,
          ad_id: l.ad_id,
          ad_set_name: l.ad_set_name,
          custom_fields: l.custom_fields,
          ghl_notes: l.ghl_notes,
          opportunity_status: l.opportunity_status,
          opportunity_stage: l.opportunity_stage,
          opportunity_value: l.opportunity_value,
          current_disposition: l.current_disposition,
          quality_score: l.quality_score,
          pipeline_value: l.pipeline_value,
          external_id: l.external_id,
          created_at: l.created_at,
          updated_at: l.updated_at,
          status: l.status,
          assigned_user: l.assigned_user,
          is_spam: l.is_spam,
          questions: l.questions,
          ghl_contact_id: ghlContactByLead[l.id] || null,
          enrichment: enrichMap[l.id] || null,
          first_touch_at: first,
          last_touch_at: last,
          touch_count: touches.length,
          prior_calls: callsByLead[l.id] || 0,
          time_to_first_touch_s: ttft,
        };
      });

      setLeads(rows);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel('setter-leads-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'leads' }, () => load())
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'calls' }, () => load())
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'contact_timeline_events' }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Tick every second so uncontacted count-up updates live
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick(t => t + 1), 1000);
    return () => window.clearInterval(id);
  }, []);

  const stats = useMemo(() => {
    const uncontacted = leads.filter(l => l.touch_count === 0 && !l.is_spam);
    const contacted = leads.filter(l => l.touch_count > 0);
    const avgTtft = contacted.length
      ? Math.round(contacted.reduce((a, l) => a + (l.time_to_first_touch_s || 0), 0) / contacted.length)
      : 0;
    const oldestUncontactedS = uncontacted.length
      ? Math.max(...uncontacted.map(l => since(l.created_at)))
      : 0;
    return {
      total: leads.length,
      uncontacted: uncontacted.length,
      contacted: contacted.length,
      avgTtftSec: avgTtft,
      oldestUncontactedS,
    };
  }, [leads]);

  return { leads, loading, error, refresh: load, stats };
}

export function fmtDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export function timeSinceISO(iso: string | null): number {
  if (!iso) return 0;
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
}