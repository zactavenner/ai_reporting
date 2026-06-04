import { Button } from '@/components/ui/button';
import { ExternalLink, Globe, Megaphone, MessageSquare, FileText, ShoppingBag, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { useClientOffers } from '@/hooks/useClientOffers';

interface ClientQuickLinksBarProps {
  client: any;
}

export function ClientQuickLinksBar({ client }: ClientQuickLinksBarProps) {
  const { data: offers = [] } = useClientOffers(client?.id);

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