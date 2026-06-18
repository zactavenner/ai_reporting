import { useState, useEffect } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { useClients } from '@/hooks/useClients';
import { useClientOffers } from '@/hooks/useClientOffers';
import { useProjects, useCreateProject } from '@/hooks/useProjects';
import { StaticBatchCreator } from '@/components/static-batch/StaticBatchCreator';
import { StyleSettingsView } from '@/components/project/StyleSettingsView';
import { AllClientsAdsHistory } from '@/components/static-batch/AllClientsAdsHistory';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Users, FileText, Palette, ArrowLeft, Sparkles } from 'lucide-react';

export default function StaticCreativesPage() {
  const { data: clients = [] } = useClients();
  const [selectedClientId, setSelectedClientId] = useState('');
  const [selectedOfferId, setSelectedOfferId] = useState('');
  const [showStyles, setShowStyles] = useState(false);

  const { data: offers = [] } = useClientOffers(selectedClientId || undefined);
  const { data: projects = [] } = useProjects(selectedClientId || undefined);
  const createProject = useCreateProject();

  const selectedClient = clients.find(c => c.id === selectedClientId);
  const selectedOffer = offers.find((o: any) => o.id === selectedOfferId);

  // Auto-select first offer when client changes
  useEffect(() => {
    if (offers.length > 0 && !selectedOfferId) {
      setSelectedOfferId(offers[0].id);
    }
  }, [offers, selectedOfferId]);

  // Get or create a default static_batch project for this client (needed for asset storage)
  const staticProject = projects.find(p => p.type === 'static_batch');
  const [autoProjectId, setAutoProjectId] = useState<string | null>(null);

  useEffect(() => {
    if (selectedClientId && !staticProject && !autoProjectId && !createProject.isPending) {
      createProject.mutate(
        { client_id: selectedClientId, name: 'Static Ads', type: 'static_batch' },
        { onSuccess: (p) => setAutoProjectId(p.id) }
      );
    }
  }, [selectedClientId, staticProject, autoProjectId]);

  const projectId = staticProject?.id || autoProjectId || '';

  const handleClientChange = (clientId: string) => {
    setSelectedClientId(clientId);
    setSelectedOfferId('');
    setAutoProjectId(null);
  };

  // Build offer description for the generator
  const offerDescription = selectedOffer
    ? [
        selectedOffer.title,
        (selectedOffer as any).description,
        (selectedOffer as any).fund_type && `Fund Type: ${(selectedOffer as any).fund_type}`,
        (selectedOffer as any).raise_amount && `Raise: ${(selectedOffer as any).raise_amount}`,
        (selectedOffer as any).targeted_returns && `Returns: ${(selectedOffer as any).targeted_returns}`,
        (selectedOffer as any).min_investment && `Min Investment: ${(selectedOffer as any).min_investment}`,
        (selectedOffer as any).tax_advantages && `Tax Advantages: ${(selectedOffer as any).tax_advantages}`,
        (selectedOffer as any).credibility && `Credibility: ${(selectedOffer as any).credibility}`,
      ].filter(Boolean).join('\n')
    : selectedClient?.offer_description || '';

  // Get brand colors/fonts from offer first, then client fallback
  const brandColors: string[] = (selectedOffer as any)?.brand_colors || selectedClient?.brand_colors || [];
  const brandFonts: string[] = (selectedOffer as any)?.brand_fonts || selectedClient?.brand_fonts || [];

  if (showStyles) {
    return (
      <AppLayout breadcrumbs={[{ label: 'Static Creatives', href: '/static-ads' }, { label: 'Manage Styles' }]}>
        <div className="max-w-7xl mx-auto space-y-4">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => setShowStyles(false)}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold">Manage Styles</h1>
              <p className="text-sm text-muted-foreground">Add reference images, customize prompts, and create new styles</p>
            </div>
          </div>
          <StyleSettingsView clientId={selectedClientId || undefined} />
        </div>
      </AppLayout>
    );
  }

  const isReady = selectedClientId && selectedOfferId && projectId;

  return (
    <AppLayout breadcrumbs={[{ label: 'Static Creatives' }]}>
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold">Static Creatives</h1>
            <p className="text-sm text-muted-foreground">Select a client and offer to generate static ad creatives with brand styles.</p>
          </div>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setShowStyles(true)}>
            <Palette className="h-4 w-4" />
            Manage Styles
          </Button>
        </div>

        {/* Client & Offer Selector */}
        <Card className="p-4">
          <div className="grid gap-4 sm:grid-cols-2">
            {/* Client */}
            <div className="space-y-1.5">
              <Label className="text-sm flex items-center gap-1.5">
                <Users className="h-3.5 w-3.5" />
                Client
              </Label>
              <Select value={selectedClientId} onValueChange={handleClientChange}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a client..." />
                </SelectTrigger>
                <SelectContent>
                  {clients.map(c => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Offer */}
            {selectedClientId && (
              <div className="space-y-1.5">
                <Label className="text-sm flex items-center gap-1.5">
                  <FileText className="h-3.5 w-3.5" />
                  Offer
                </Label>
                <Select value={selectedOfferId} onValueChange={setSelectedOfferId}>
                  <SelectTrigger>
                    <SelectValue placeholder={offers.length ? 'Select an offer...' : 'No offers found'} />
                  </SelectTrigger>
                  <SelectContent>
                    {offers.map((o: any) => (
                      <SelectItem key={o.id} value={o.id}>
                        {o.title}
                        {o.offer_type && ` · ${o.offer_type}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          {/* Quick brand info */}
          {selectedClientId && selectedOfferId && (
            <div className="mt-4 flex flex-wrap items-center gap-3 pt-3 border-t">
              {brandColors.length > 0 && (
                <div className="flex items-center gap-1.5">
                  <Palette className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">Colors:</span>
                  {brandColors.slice(0, 6).map((color: string, i: number) => (
                    <div
                      key={i}
                      className="w-5 h-5 rounded-full border"
                      style={{ backgroundColor: color }}
                      title={color}
                    />
                  ))}
                </div>
              )}
              {brandFonts.length > 0 && (
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-muted-foreground">Fonts:</span>
                  {brandFonts.map((font: string, i: number) => (
                    <Badge key={i} variant="secondary" className="text-[10px]">{font}</Badge>
                  ))}
                </div>
              )}
              {!brandColors.length && !brandFonts.length && (
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <Sparkles className="h-3 w-3" />
                  No brand colors or fonts set — AI will auto-generate a premium palette.
                </p>
              )}
            </div>
          )}
        </Card>

        {/* Generator */}
        {isReady ? (
          <StaticBatchCreator
            projectId={projectId}
            clientId={selectedClientId}
            projectOfferDescription={offerDescription}
          />
        ) : (
          <div className="text-center py-16 text-muted-foreground">
            <p className="text-lg font-medium">Select a client and offer to start generating</p>
            <p className="text-sm mt-1">Choose a client above, then pick an offer to use.</p>
          </div>
        )}

        {/* Global history across all clients */}
        <div className="pt-8 border-t">
          <AllClientsAdsHistory />
        </div>
      </div>
    </AppLayout>
  );
}
