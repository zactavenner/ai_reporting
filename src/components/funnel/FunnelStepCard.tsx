import { useState } from 'react';
import { Edit2, ExternalLink, Trash2, Gauge, Loader2, Radio, TestTube2, CheckCircle2, AlertCircle, XCircle, Images } from 'lucide-react';
import { PageMetadataPreview } from './PageMetadataPreview';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { IPhoneMockup } from './IPhoneMockup';
import { TabletMockup } from './TabletMockup';
import { DesktopMockup } from './DesktopMockup';
import { PageSpeedModal } from './PageSpeedModal';
import { PixelVerificationModal } from './PixelVerificationModal';
import { SplitTestModal } from './SplitTestModal';
import { supabase } from '@/integrations/supabase/client';
import { FacebookLeadFormMockup } from './FacebookLeadFormMockup';
import { AdRotatorMockup, type AdPlatform } from './AdRotatorMockup';
import { SmsMockup } from './SmsMockup';
import { EmailMockup } from './EmailMockup';
import { AdSelectorModal } from './AdSelectorModal';
import { useCreatives } from '@/hooks/useCreatives';
import { useFunnelStepAds, useSetFunnelStepAds } from '@/hooks/useFunnelStepAds';
import { useLatestPixelVerification, getVerificationStatusInfo } from '@/hooks/usePixelVerification';
import type { FunnelStep } from '@/hooks/useFunnelSteps';
import type { FunnelStepVariant } from '@/hooks/useFunnelStepVariants';
import type { DeviceType } from './DeviceSwitcher';
import { formatDistanceToNow } from 'date-fns';

interface FunnelStepCardProps {
  step: FunnelStep;
  stepNumber: number;
  deviceType: DeviceType;
  isPublicView: boolean;
  variants?: FunnelStepVariant[];
  clientId?: string;
  brandName?: string;
  onEdit: () => void;
  onDelete: () => void;
}

interface PageSpeedResults {
  performanceScore: number;
  metrics: {
    firstContentfulPaint: string;
    speedIndex: string;
    largestContentfulPaint: string;
    timeToInteractive: string;
    totalBlockingTime: string;
    cumulativeLayoutShift: string;
  };
}

export function FunnelStepCard({
  step,
  stepNumber,
  deviceType,
  isPublicView,
  variants = [],
  clientId,
  brandName,
  onEdit,
  onDelete,
}: FunnelStepCardProps) {
  const [speedTestLoading, setSpeedTestLoading] = useState(false);
  const [speedResults, setSpeedResults] = useState<PageSpeedResults | null>(null);
  const [speedModalOpen, setSpeedModalOpen] = useState(false);
  const [pixelModalOpen, setPixelModalOpen] = useState(false);
  const [splitTestModalOpen, setSplitTestModalOpen] = useState(false);
  const [adSelectorOpen, setAdSelectorOpen] = useState(false);

  const { data: latestVerification } = useLatestPixelVerification(step.id);
  const verificationStatus = getVerificationStatusInfo(latestVerification?.status);
  const kind = step.step_kind || (step.url === 'fb://lead-form' ? 'fb_lead_form' : 'page');
  const isFbLeadForm = kind === 'fb_lead_form';
  const isPage = kind === 'page';
  const isAds = kind === 'ads';
  const isSms = kind === 'sms';
  const isEmail = kind === 'email';

  // Ad-rotator specific data
  const { data: stepAds = [] } = useFunnelStepAds(isAds ? [step.id] : []);
  const { data: allCreatives = [] } = useCreatives(isAds ? clientId : undefined);
  const setAds = useSetFunnelStepAds();
  const selectedAdCreatives = stepAds
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order)
    .map(a => allCreatives.find(c => c.id === a.creative_id))
    .filter(Boolean) as typeof allCreatives;

  const hasVariants = variants.length > 0;

  const runSpeedTest = async () => {
    setSpeedTestLoading(true);
    try {
      const strategy = deviceType === 'desktop' ? 'desktop' : 'mobile';
      const { data, error } = await supabase.functions.invoke('pagespeed-test', {
        body: { url: step.url, strategy }
      });
      
      if (error) throw error;
      setSpeedResults(data);
      setSpeedModalOpen(true);
    } catch (err: any) {
      console.error('PageSpeed test failed:', err);
    } finally {
      setSpeedTestLoading(false);
    }
  };

  const renderDeviceMockup = (url: string, title: string, variantLabel?: string) => {
    if (isFbLeadForm || url === 'fb://lead-form') {
      return <FacebookLeadFormMockup stepName={title} deviceType={deviceType} />;
    }
    if (isAds) {
      return (
        <AdRotatorMockup
          creatives={selectedAdCreatives}
          platform={(step.ad_platform as AdPlatform) || 'facebook'}
          deviceType={deviceType}
          brandName={brandName}
        />
      );
    }
    if (isSms) {
      return <SmsMockup body={step.sms_body || ''} fromName={brandName} deviceType={deviceType} />;
    }
    if (isEmail) {
      return (
        <EmailMockup
          subject={step.email_subject || ''}
          body={step.email_body || ''}
          fromName={step.email_from_name || brandName}
          deviceType={deviceType}
        />
      );
    }
    switch (deviceType) {
      case 'desktop':
        return <DesktopMockup url={url} title={title} />;
      case 'tablet':
        return <TabletMockup url={url} title={title} />;
      default:
        return <IPhoneMockup url={url} title={title} />;
    }
  };

  // All URLs including variants
  const allUrls = [
    { url: step.url, label: 'A', isOriginal: true },
    ...variants.map((v, i) => ({ 
      url: v.url, 
      label: ['B', 'C', 'D', 'E', 'F', 'G', 'H'][i] || `${i + 2}`, 
      isOriginal: false 
    }))
  ];

  const renderVerificationBadge = () => {
    if (!latestVerification) return null;
    
    const StatusIcon = latestVerification.status === 'pass' ? CheckCircle2 :
                       latestVerification.status === 'warning' ? AlertCircle : XCircle;
    
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <div className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${verificationStatus.bgColor} ${verificationStatus.color}`}>
            <StatusIcon className="h-3 w-3" />
            <span>{latestVerification.events_detected?.length || 0} events</span>
          </div>
        </TooltipTrigger>
        <TooltipContent>
          <div className="text-xs">
            <div className="font-medium">{verificationStatus.label}</div>
            <div className="text-muted-foreground">
              {formatDistanceToNow(new Date(latestVerification.scanned_at), { addSuffix: true })}
            </div>
          </div>
        </TooltipContent>
      </Tooltip>
    );
  };

  const renderActionButtons = () => (
    <div className="flex flex-col items-center gap-2 mt-3">
      {/* Verification Status Badge */}
      {isPage && renderVerificationBadge()}
      
      <div className="flex items-center gap-1">
        {isAds && !isPublicView && (
          <Button
            variant={selectedAdCreatives.length > 0 ? 'default' : 'outline'}
            size="sm"
            onClick={() => setAdSelectorOpen(true)}
            className="h-7 px-2 text-xs"
          >
            <Images className="h-3 w-3 mr-1" />
            {selectedAdCreatives.length > 0 ? `${selectedAdCreatives.length} ad${selectedAdCreatives.length > 1 ? 's' : ''}` : 'Select Ads'}
          </Button>
        )}
        {isPage && (
          <>
            <Button
              variant={hasVariants ? "default" : "ghost"}
              size="sm"
              onClick={() => setSplitTestModalOpen(true)}
              className="h-7 px-2 text-xs"
              title="A/B Split Test"
            >
              <TestTube2 className="h-3 w-3 mr-1" />
              {hasVariants ? `${allUrls.length} Tests` : 'A/B'}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={runSpeedTest}
              disabled={speedTestLoading}
              className="h-7 px-2 text-xs"
              title="Speed Test"
            >
              {speedTestLoading ? (
                <Loader2 className="h-3 w-3 animate-spin mr-1" />
              ) : (
                <Gauge className="h-3 w-3 mr-1" />
              )}
              Speed
            </Button>
            <Button
              variant={latestVerification ? "outline" : "ghost"}
              size="sm"
              onClick={() => setPixelModalOpen(true)}
              className="h-7 px-2 text-xs"
              title="Verify Pixels"
            >
              <Radio className="h-3 w-3 mr-1" />
              Pixels
            </Button>
          </>
        )}
        {!isPublicView && (
        <>
          <Button variant="ghost" size="sm" onClick={onEdit} className="h-7 w-7 p-0">
            <Edit2 className="h-3 w-3" />
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                <Trash2 className="h-3 w-3 text-destructive" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete Step?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will remove "{step.name}" from the funnel. This action cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={onDelete}>Delete</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      )}
        {isPage && (
          <a
            href={step.url}
            target="_blank"
            rel="noopener noreferrer"
            className="h-7 w-7 inline-flex items-center justify-center hover:bg-accent rounded"
          >
            <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>
    </div>
  );

  return (
    <>
      <div className="flex items-start gap-2">
        {/* Show variants side-by-side if they exist */}
        {hasVariants && isPage ? (
          allUrls.map(({ url, label, isOriginal }, index) => (
            <div key={label} className="flex flex-col items-start">
              <Badge 
                variant={isOriginal ? "default" : "secondary"} 
                className="mb-1 text-xs self-center"
              >
                {label}
              </Badge>
              {renderDeviceMockup(url, `${stepNumber}. ${step.name}`)}
              {/* Only show action buttons under first variant (A) */}
              {index === 0 && renderActionButtons()}
              {index === 0 && isPage && <PageMetadataPreview url={url} stepId={step.id} />}
            </div>
          ))
        ) : (
          <div className="flex flex-col items-center">
            {renderDeviceMockup(step.url, `${stepNumber}. ${step.name}`)}
            {renderActionButtons()}
            {isPage && <PageMetadataPreview url={step.url} stepId={step.id} />}
          </div>
        )}
      </div>

      <PageSpeedModal
        open={speedModalOpen}
        onOpenChange={setSpeedModalOpen}
        results={speedResults}
        url={step.url}
        strategy={deviceType === 'desktop' ? 'desktop' : 'mobile'}
      />

      <PixelVerificationModal
        open={pixelModalOpen}
        onOpenChange={setPixelModalOpen}
        stepUrl={step.url}
        stepName={step.name}
        stepId={step.id}
        clientId={clientId}
        isPublicView={isPublicView}
      />

      <SplitTestModal
        open={splitTestModalOpen}
        onOpenChange={setSplitTestModalOpen}
        step={step}
        isPublicView={isPublicView}
      />

      {isAds && clientId && (
        <AdSelectorModal
          open={adSelectorOpen}
          onOpenChange={setAdSelectorOpen}
          clientId={clientId}
          initialSelected={stepAds.map(a => a.creative_id)}
          initialPlatform={(step.ad_platform as AdPlatform) || 'facebook'}
          onSave={async (creativeIds, platform) => {
            await setAds.mutateAsync({ stepId: step.id, creativeIds });
            // Persist platform choice on the step
            const { supabase } = await import('@/integrations/supabase/client');
            await supabase.from('client_funnel_steps').update({ ad_platform: platform }).eq('id', step.id);
          }}
        />
      )}
    </>
  );
}
