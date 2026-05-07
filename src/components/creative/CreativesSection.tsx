import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CreativeApproval } from './CreativeApproval';
import { Upload, Image, Video, Target, ExternalLink } from 'lucide-react';
import { useAgencySettings } from '@/hooks/useAgencySettings';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

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
  const canvaUrl = (agencySettings as any)?.canva_url || 'https://www.canva.com';

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
            <p className="text-sm text-muted-foreground">Open Canva to design and edit creative assets.</p>
            <Button onClick={() => window.open(canvaUrl, '_blank')} className="gap-2">
              <ExternalLink className="h-4 w-4" />
              Open Canva
            </Button>
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
