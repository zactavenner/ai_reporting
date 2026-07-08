import { Button } from '@/components/ui/button';
import { ExternalLink, Globe, Megaphone, MessageSquare, FileText, ShoppingBag, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { useClientOffers } from '@/hooks/useClientOffers';
import { useFunnelCampaigns } from '@/hooks/useFunnelCampaigns';
import { useFunnelSteps } from '@/hooks/useFunnelSteps';

interface ClientQuickLinksBarProps {
  client: any;
}

export function ClientQuickLinksBar({ client }: ClientQuickLinksBarProps) {
  const { data: offers = [] } = useClientOffers(client?.id);
  const { data: campaigns = [] } = useFunnelCampaigns(client?.id);
  const { data: steps = [] } = useFunnelSteps(client?.id);

  const links: { label: string; url: string; icon: any }[] = [];
  if (client.website_url) links.push({ label: 'Website', url: client.website_url, icon: Globe });
  if (client.product_url) links.push({ label: 'Funnel', url: client.product_url, icon: ShoppingBag });
  if (client.business_manager_url) links.push({ label: 'Ads', url: client.business_manager_url, icon: Megaphone });
  if (client.ghl_account_url) links.push({ label: 'CRM', url: client.ghl_account_url, icon: MessageSquare });
  if (client.google_doc_url) links.push({ label: 'Doc', url: client.google_doc_url, icon: FileText });

  const handleCopy = async () => {
    const lines: string[] = [];
    lines.push(`# ${client.name}`);
    if (client.industry) lines.push(`Industry: ${client.industry}`);
    if (client.status) lines.push(`Status: ${client.status}`);
    if (client.description) lines.push(`\n${client.description}`);
    if (client.offer_description) lines.push(`\nOffer: ${client.offer_description}`);

    lines.push('\n## Links');
    if (client.website_url) lines.push(`- Website: ${client.website_url}`);
    if (client.product_url) lines.push(`- Funnel / Product: ${client.product_url}`);
    if (client.business_manager_url) lines.push(`- Ads Manager: ${client.business_manager_url}`);
    if (client.ghl_account_url) lines.push(`- CRM (GHL): ${client.ghl_account_url}`);
    if (client.google_doc_url) lines.push(`- Google Doc: ${client.google_doc_url}`);
    if (client.slug || client.public_token) {
      lines.push(`- Public Report: ${window.location.origin}/public/${client.slug || client.public_token}`);
    }

    lines.push('\n## Integrations');
    if (client.meta_ad_account_id) lines.push(`- Meta Ad Account: ${client.meta_ad_account_id}`);
    if (client.ghl_location_id) lines.push(`- GHL Location: ${client.ghl_location_id}`);
    if (client.hubspot_portal_id) lines.push(`- HubSpot Portal: ${client.hubspot_portal_id}`);
    if (client.media_buyer) lines.push(`- Media Buyer: ${client.media_buyer}`);
    if (client.account_manager) lines.push(`- Account Manager: ${client.account_manager}`);

    if (offers.length) {
      lines.push('\n## Offers / Files');
      offers.forEach((o: any) => {
        lines.push(`- ${o.title}${o.offer_type ? ` (${o.offer_type})` : ''}${o.file_url ? ` — ${o.file_url}` : ''}`);
        if (o.description) lines.push(`  ${o.description}`);
        if (o.fund_name) lines.push(`  Fund: ${o.fund_name}`);
        if (o.targeted_returns) lines.push(`  Targeted Returns: ${o.targeted_returns}`);
        if (o.min_investment) lines.push(`  Min: ${o.min_investment}`);
        if (o.raise_amount) lines.push(`  Raise: ${o.raise_amount}`);
        if (o.website_url) lines.push(`  Site: ${o.website_url}`);
      });
    }

    // Funnel Campaigns + Steps (grouped)
    const campaignList = campaigns.length
      ? campaigns
      : [{ id: '__uncategorized__', name: 'Funnel', sort_order: 0 } as any];

    const grouped = campaignList
      .map((c: any) => {
        const inCampaign = steps.filter((s: any) =>
          c.id === '__uncategorized__' ? !s.campaign_id : s.campaign_id === c.id
        );
        return { campaign: c, steps: inCampaign };
      })
      .filter((g) => g.steps.length > 0);

    if (grouped.length) {
      lines.push('\n## Funnels & Campaigns');
      grouped.forEach(({ campaign, steps: cSteps }) => {
        lines.push(`\n### ${campaign.name}`);
        cSteps.forEach((s: any, idx: number) => {
          const kind = s.step_kind || s.step_type || 'step';
          const header = `${idx + 1}. [${kind}] ${s.name}`;
          lines.push(header);
          if (s.url) lines.push(`   URL: ${s.url}`);
          if (s.ad_platform) lines.push(`   Platform: ${s.ad_platform}`);
          if (s.email_subject) lines.push(`   Subject: ${s.email_subject}`);
          if (s.email_from_name) lines.push(`   From: ${s.email_from_name}`);
          if (s.email_body) lines.push(`   Email: ${s.email_body.replace(/\n/g, ' ')}`);
          if (s.sms_body) lines.push(`   SMS: ${s.sms_body.replace(/\n/g, ' ')}`);
          if (Array.isArray(s.messages) && s.messages.length) {
            lines.push(`   Nurture Sequence:`);
            s.messages.forEach((m: any, mi: number) => {
              const delay = m.delay_days != null ? `+${m.delay_days}d` : '';
              const subj = m.subject ? ` "${m.subject}"` : '';
              const from = m.from_name ? ` (from ${m.from_name})` : '';
              lines.push(`     ${mi + 1}. ${delay}${subj}${from}`);
              if (m.body) lines.push(`        ${String(m.body).replace(/\n/g, ' ')}`);
            });
          }
          if (s.form_config?.questions?.length) {
            lines.push(`   Form Questions:`);
            s.form_config.questions.forEach((q: any, qi: number) => {
              lines.push(`     ${qi + 1}. ${q.label}${q.required ? ' *' : ''} [${q.type}]`);
              if (q.options?.length) lines.push(`        Options: ${q.options.join(', ')}`);
            });
          }
        });
      });
    }

    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      toast.success('Client info copied to clipboard');
    } catch {
      toast.error('Failed to copy');
    }
  };

  return (
    <>
      {links.map((l) => {
        const Icon = l.icon;
        return (
          <Button
            key={l.label}
            variant="outline"
            size="sm"
            onClick={() => window.open(l.url, '_blank')}
            title={l.url}
          >
            <Icon className="h-4 w-4 mr-1.5" />
            {l.label}
            <ExternalLink className="h-3 w-3 ml-1 opacity-60" />
          </Button>
        );
      })}
      <Button variant="outline" size="sm" onClick={handleCopy} title="Copy all client info">
        <Copy className="h-4 w-4 mr-1.5" />
        Copy Client Info
      </Button>
    </>
  );
}