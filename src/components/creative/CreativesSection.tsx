import { useState, useEffect } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CreativeApproval } from './CreativeApproval';
import { Upload, Image, Video, Target, ExternalLink, Pencil, Save, X } from 'lucide-react';
import { useAgencySettings } from '@/hooks/useAgencySettings';
import { useClientSettings, useUpdateClientSettings } from '@/hooks/useClientSettings';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';

const ADS_GENERATOR_URL = 'https://id-preview--b57a79c0-3e59-4a78-be94-340c58fe824e.lovable.app';

interface CreativesSectionProps {
  clientId: string;
  clientName: string;
  isPublicView?: boolean;
}

const generatorLinks = [
  {
    title: 'Static Ads Generator',
    description: 'Generate branded static ad creatives with AI styles',
    icon: Image,
    path: '/static-ads',
  },
  {
    title: 'Video Ads Generator',
    description: 'Create AI avatar video ads with scripts and compositing',
    icon: Video,
    path: '/batch-video',
  },
  {
    title: 'AI Briefs & Flowboard',
    description: 'Generate creative briefs and plan ad workflows',
    icon: Target,
    path: '/briefs',
  },
];

export function CreativesSection({ clientId, clientName, isPublicView = false }: CreativesSectionProps) {
  const [activeSubTab, setActiveSubTab] = useState('approval');
  const { data: agencySettings } = useAgencySettings();
  const { data: clientSettings } = useClientSettings(clientId);
  const updateClient = useUpdateClientSettings();
  const clientCanvaUrl = (clientSettings as any)?.canva_url as string | null | undefined;
  const agencyCanvaUrl = (agencySettings as any)?.canva_url as string | null | undefined;
  const canvaUrl = clientCanvaUrl || agencyCanvaUrl || '';

  const [editingCanva, setEditingCanva] = useState(false);
  const [canvaInput, setCanvaInput] = useState(clientCanvaUrl || '');
  useEffect(() => { setCanvaInput(clientCanvaUrl || ''); }, [clientCanvaUrl]);

  const saveCanva = async () => {
    try {
      await updateClient.mutateAsync({ client_id: clientId, canva_url: canvaInput.trim() || null } as any);
      toast.success('Canva URL saved for this client');
      setEditingCanva(false);
    } catch (e: any) {
      toast.error('Failed to save: ' + (e?.message || 'Unknown error'));
    }
  };

  if (isPublicView) {
    return (
      <CreativeApproval 
        clientId={clientId} 
        clientName={clientName} 
        isPublicView={true}
      />
    );
  }

  return (
    <div className="space-y-4">
      <Tabs value={activeSubTab} onValueChange={setActiveSubTab}>
        <TabsList className="bg-muted/50">
          <TabsTrigger value="approval" className="gap-2">
            <Upload className="h-4 w-4" />
            Creative Approval
          </TabsTrigger>
          <TabsTrigger value="canva" className="gap-2">
            <ExternalLink className="h-4 w-4" />
            Canva
          </TabsTrigger>
          <TabsTrigger value="generators" className="gap-2">
            <Image className="h-4 w-4" />
            Generators
          </TabsTrigger>
        </TabsList>

        <TabsContent value="approval" className="mt-4">
          <CreativeApproval 
            clientId={clientId} 
            clientName={clientName} 
            isPublicView={false}
          />
        </TabsContent>

        <TabsContent value="canva" className="mt-4">
          <Card className="p-6 flex flex-col items-start gap-3">
            <h3 className="font-semibold">Canva Workspace</h3>
            <p className="text-sm text-muted-foreground">
              Open this client's Canva design to create and edit creative assets.
            </p>

            {editingCanva || !canvaUrl ? (
              <div className="flex gap-2 w-full max-w-2xl">
                <Input
                  placeholder="https://www.canva.com/design/..."
                  value={canvaInput}
                  onChange={(e) => setCanvaInput(e.target.value)}
                />
                <Button onClick={saveCanva} disabled={updateClient.isPending} className="gap-2">
                  <Save className="h-4 w-4" /> Save
                </Button>
                {canvaUrl && (
                  <Button variant="ghost" onClick={() => { setCanvaInput(clientCanvaUrl || ''); setEditingCanva(false); }} className="gap-2">
                    <X className="h-4 w-4" /> Cancel
                  </Button>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <Button onClick={() => window.open(canvaUrl, '_blank')} className="gap-2">
                  <ExternalLink className="h-4 w-4" />
                  Open Canva
                </Button>
                <Button variant="outline" size="sm" onClick={() => setEditingCanva(true)} className="gap-2">
                  <Pencil className="h-4 w-4" /> Edit URL
                </Button>
                {!clientCanvaUrl && agencyCanvaUrl && (
                  <span className="text-xs text-muted-foreground">Using agency default</span>
                )}
              </div>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="generators" className="mt-4">
          <div className="grid gap-3 sm:grid-cols-3">
            {generatorLinks.map((link) => (
              <Card key={link.path} className="p-4 flex flex-col gap-3">
                <div className="flex items-center gap-2">
                  <link.icon className="h-5 w-5 text-primary" />
                  <h3 className="font-medium text-sm">{link.title}</h3>
                </div>
                <p className="text-xs text-muted-foreground flex-1">{link.description}</p>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 w-full"
                  onClick={() => window.open(`${ADS_GENERATOR_URL}${link.path}`, '_blank')}
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Open in Ads Generator
                </Button>
              </Card>
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
