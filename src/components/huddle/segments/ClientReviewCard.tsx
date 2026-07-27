import { useEffect, useState, Suspense, lazy } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ExternalLink, ChevronDown, ChevronUp, FileText, Image as ImageIcon, GitBranch, ClipboardList, Megaphone, Facebook, Globe, Users, Briefcase, Link2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { embedSheetUrl } from '@/lib/huddle/sheet';
import { TaskBoardView } from '@/components/tasks/TaskBoardView';
import type { Client } from '@/hooks/useClients';

const CreativesSection = lazy(() =>
  import('@/components/creative/CreativesSection').then((m) => ({ default: m.CreativesSection })),
);
const FunnelPreviewTab = lazy(() =>
  import('@/components/funnel/FunnelPreviewTab').then((m) => ({ default: m.FunnelPreviewTab })),
);
const OnboardingIntake = lazy(() =>
  import('@/components/onboarding/OnboardingIntake').then((m) => ({ default: m.OnboardingIntake })),
);
const ClientOffersSection = lazy(() =>
  import('@/components/offers/ClientOffersSection').then((m) => ({ default: m.ClientOffersSection })),
);
const AdsManagerTab = lazy(() =>
  import('@/components/ads-manager/AdsManagerTab').then((m) => ({ default: m.AdsManagerTab })),
);

// Session-scoped map that remembers which collapsible sections are open per
// client, so navigating back to a client during the same huddle keeps the
// operator's chosen layout instead of resetting to the defaults.
type SectionState = {
  sheet: boolean;
  tasks: boolean;
  ads: boolean;
  creatives: boolean;
  funnel: boolean;
  onboarding: boolean;
};
const DEFAULT_SECTIONS: SectionState = {
  sheet: true,
  tasks: true,
  ads: false,
  creatives: false,
  funnel: false,
  onboarding: false,
};
const sectionStateByClient = new Map<string, SectionState>();

interface PastCall {
  id: string;
  title: string | null;
  summary_text: string | null;
  week_of: string | null;
  ended_at: string | null;
}

export function ClientReviewCard({ client }: { client: Client }) {
  const [sheetUrl, setSheetUrl] = useState<string>('');
  const [pastCalls, setPastCalls] = useState<PastCall[]>([]);
  const [expandedCallId, setExpandedCallId] = useState<string | null>(null);
  const [sections, setSections] = useState<SectionState>(
    () => sectionStateByClient.get(client.id) ?? { ...DEFAULT_SECTIONS },
  );
  useEffect(() => {
    setSections(sectionStateByClient.get(client.id) ?? { ...DEFAULT_SECTIONS });
  }, [client.id]);
  const toggle = (key: keyof SectionState) => {
    setSections((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      sectionStateByClient.set(client.id, next);
      return next;
    });
  };
  const { sheet: showSheet, tasks: showTasks, ads: showAds, creatives: showCreatives, funnel: showFunnel, onboarding: showOnboarding } = sections;

  // Quick links derived from client integration ids — only render buttons for
  // fields that are actually configured, so operators aren't clicking dead links.
  const quickLinks: { label: string; href: string; icon: React.ComponentType<{ className?: string }> }[] = [];
  const c: any = client;
  if (c.meta_ad_account_id) {
    const acct = String(c.meta_ad_account_id).replace(/^act_/, '');
    quickLinks.push({
      label: 'Meta Ads',
      href: `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${acct}`,
      icon: Facebook,
    });
  }
  if (c.ghl_location_id) {
    quickLinks.push({
      label: 'GHL',
      href: `https://app.gohighlevel.com/v2/location/${c.ghl_location_id}/dashboard`,
      icon: Users,
    });
  }
  if (c.hubspot_portal_id) {
    quickLinks.push({
      label: 'HubSpot',
      href: `https://app.hubspot.com/contacts/${c.hubspot_portal_id}`,
      icon: Briefcase,
    });
  }
  if (c.website_url) {
    quickLinks.push({ label: 'Website', href: c.website_url, icon: Globe });
  }
  if (c.slack_channel_url) {
    quickLinks.push({ label: 'Slack', href: c.slack_channel_url, icon: Link2 });
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [{ data: cs }, { data: ws }] = await Promise.all([
        (supabase as any).from('client_settings').select('kpi_google_sheet_url').eq('client_id', client.id).maybeSingle(),
        (supabase as any).from('client_weekly_call_settings').select('scorecard_sheet_url').eq('client_id', client.id).maybeSingle(),
      ]);
      if (cancelled) return;
      setSheetUrl((cs?.kpi_google_sheet_url as string) || (ws?.scorecard_sheet_url as string) || '');

      const { data: calls } = await (supabase as any)
        .from('client_weekly_calls')
        .select('id, title, summary_text, week_of, ended_at')
        .eq('client_id', client.id)
        .eq('status', 'completed')
        .order('ended_at', { ascending: false })
        .limit(3);
      if (!cancelled) setPastCalls((calls || []) as PastCall[]);
    })();
    return () => { cancelled = true; };
  }, [client.id]);

  return (
    <div className="w-full max-w-[1400px] mx-auto space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-2xl font-semibold">{client.name}</h2>
        <Badge variant={client.status === 'active' ? 'default' : 'outline'} className="capitalize">
          {client.status}
        </Badge>
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" variant="outline" asChild>
            <a href={`/client/${client.id}`} target="_blank" rel="noreferrer">
              <ExternalLink className="w-3.5 h-3.5 mr-1" /> Dashboard
            </a>
          </Button>
          {sheetUrl && (
            <Button size="sm" variant="outline" asChild>
              <a href={sheetUrl} target="_blank" rel="noreferrer">
                <ExternalLink className="w-3.5 h-3.5 mr-1" /> Scorecard
              </a>
            </Button>
          )}
        </div>
      </div>

      {/* Quick links — one-click hops to the external tools we reference during huddle */}
      {quickLinks.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground mr-1">Quick links:</span>
          {quickLinks.map((q) => {
            const Icon = q.icon;
            return (
              <Button key={q.label} size="sm" variant="secondary" asChild>
                <a href={q.href} target="_blank" rel="noreferrer">
                  <Icon className="w-3.5 h-3.5 mr-1" /> {q.label}
                  <ExternalLink className="w-3 h-3 ml-1 opacity-60" />
                </a>
              </Button>
            );
          })}
        </div>
      )}

      {/* Scorecard iframe — zoomed out so more of the sheet is visible at once */}
      <Card className="p-0 overflow-hidden">
        <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/40">
          <div className="text-sm font-medium">Scorecard</div>
          <Button size="sm" variant="ghost" onClick={() => toggle('sheet')}>
            {showSheet ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </Button>
        </div>
        {showSheet && (
          sheetUrl ? (
            <div className="w-full overflow-hidden" style={{ height: 420 }}>
              <iframe
                src={embedSheetUrl(sheetUrl)}
                title={`${client.name} scorecard`}
                className="w-full"
                style={{ height: 560, border: 0, transform: 'scale(0.75)', transformOrigin: 'top left', width: '133.33%' }}
                loading="lazy"
              />
            </div>
          ) : (
            <div className="p-6 text-sm text-muted-foreground">
              No scorecard sheet configured for this client. Add one in Client Settings.
            </div>
          )
        )}
      </Card>

      {/* Tasks — reuses the exact same TaskBoardView the tasks section renders */}
      <Card className="p-0 overflow-hidden">
        <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/40">
          <div className="text-sm font-medium">Tasks</div>
          <Button size="sm" variant="ghost" onClick={() => toggle('tasks')}>
            {showTasks ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </Button>
        </div>
        {showTasks && (
          <div className="p-3 overflow-hidden">
            <div
              style={{
                transform: 'scale(0.75)',
                transformOrigin: 'top left',
                width: '133.33%',
              }}
            >
              <TaskBoardView clientId={client.id} />
            </div>
          </div>
        )}
      </Card>

      {/* Past 3 AI summaries */}
      <Card className="p-4 space-y-3">
        <div className="flex items-center gap-2">
          <FileText className="w-4 h-4 text-muted-foreground" />
          <div className="text-sm font-medium">Last 3 meeting summaries</div>
        </div>
        {pastCalls.length === 0 ? (
          <div className="text-sm text-muted-foreground">No past weekly calls yet.</div>
        ) : (
          <ul className="space-y-2">
            {pastCalls.map((c) => {
              const open = expandedCallId === c.id;
              return (
                <li key={c.id} className="rounded-md border">
                  <button
                    type="button"
                    onClick={() => setExpandedCallId(open ? null : c.id)}
                    className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-muted/40"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{c.title || 'Weekly Call'}</div>
                      <div className="text-xs text-muted-foreground">
                        {c.ended_at ? new Date(c.ended_at).toLocaleDateString() : c.week_of || ''}
                      </div>
                    </div>
                    {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>
                  {open && (
                    <div className="px-3 pb-3 text-sm whitespace-pre-wrap text-muted-foreground">
                      {c.summary_text || 'No summary generated.'}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {/* Ads Manager — live campaigns, ad sets, ads, top performers scoped to this client */}
      <Card className="p-0 overflow-hidden">
        <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/40">
          <div className="text-sm font-medium flex items-center gap-2">
            <Megaphone className="w-4 h-4 text-muted-foreground" /> Ads Manager
          </div>
          <Button size="sm" variant="ghost" onClick={() => toggle('ads')}>
            {showAds ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </Button>
        </div>
        {showAds && (
          <div className="p-3 overflow-hidden">
            <div style={{ transform: 'scale(0.8)', transformOrigin: 'top left', width: '125%' }}>
              <Suspense fallback={<div className="text-sm text-muted-foreground p-3">Loading ads manager…</div>}>
                <AdsManagerTab clientId={client.id} clientName={client.name} />
              </Suspense>
            </div>
          </div>
        )}
      </Card>

      {/* Creatives board */}
      <Card className="p-0 overflow-hidden">
        <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/40">
          <div className="text-sm font-medium flex items-center gap-2">
            <ImageIcon className="w-4 h-4 text-muted-foreground" /> Creatives
          </div>
          <Button size="sm" variant="ghost" onClick={() => toggle('creatives')}>
            {showCreatives ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </Button>
        </div>
        {showCreatives && (
          <div className="p-3 overflow-hidden">
            <div style={{ transform: 'scale(0.8)', transformOrigin: 'top left', width: '125%' }}>
              <Suspense fallback={<div className="text-sm text-muted-foreground p-3">Loading creatives…</div>}>
                <CreativesSection clientId={client.id} clientName={client.name} isPublicView={false} />
              </Suspense>
            </div>
          </div>
        )}
      </Card>

      {/* Funnel */}
      <Card className="p-0 overflow-hidden">
        <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/40">
          <div className="text-sm font-medium flex items-center gap-2">
            <GitBranch className="w-4 h-4 text-muted-foreground" /> Funnel
          </div>
          <Button size="sm" variant="ghost" onClick={() => toggle('funnel')}>
            {showFunnel ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </Button>
        </div>
        {showFunnel && (
          <div className="p-3 overflow-hidden">
            <div style={{ transform: 'scale(0.8)', transformOrigin: 'top left', width: '125%' }}>
              <Suspense fallback={<div className="text-sm text-muted-foreground p-3">Loading funnel…</div>}>
                <FunnelPreviewTab clientId={client.id} isPublicView={false} />
              </Suspense>
            </div>
          </div>
        )}
      </Card>

      {/* Offer / onboarding intake */}
      <Card className="p-0 overflow-hidden">
        <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/40">
          <div className="text-sm font-medium flex items-center gap-2">
            <ClipboardList className="w-4 h-4 text-muted-foreground" /> Offers
          </div>
          <Button size="sm" variant="ghost" onClick={() => toggle('onboarding')}>
            {showOnboarding ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </Button>
        </div>
        {showOnboarding && (
          <div className="p-3 overflow-hidden">
            <div style={{ transform: 'scale(0.85)', transformOrigin: 'top left', width: '117.65%' }}>
              <Suspense fallback={<div className="text-sm text-muted-foreground p-3">Loading offers…</div>}>
                <ClientOffersSection
                  clientId={client.id}
                  clientName={client.name}
                  isPublicView={false}
                  clientDescription={(client as any).description ?? null}
                  websiteUrl={(client as any).website_url ?? null}
                  industry={(client as any).industry ?? null}
                  clientType={(client as any).client_type ?? null}
                />
              </Suspense>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}