import { useState, useMemo, useRef } from 'react';
import { Plus, FolderPlus, FileText, Globe, Images, MessageSquare, Mail, Trash2, Paperclip, Loader2, X } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useSearchParams } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { DeviceSwitcher, DeviceType } from './DeviceSwitcher';
import { CampaignFlowSection } from './CampaignFlowSection';

import { IPhoneMockup } from './IPhoneMockup';
import { TabletMockup } from './TabletMockup';
import { DesktopMockup } from './DesktopMockup';
import { useFunnelSteps, useCreateFunnelStep, useUpdateFunnelStep, useDeleteFunnelStep, useReorderFunnelSteps, FunnelStep } from '@/hooks/useFunnelSteps';
import { useFunnelCampaigns, useCreateFunnelCampaign, useUpdateFunnelCampaign, useDeleteFunnelCampaign, FunnelCampaign } from '@/hooks/useFunnelCampaigns';
import { useClient } from '@/hooks/useClients';

interface FunnelPreviewTabProps {
  clientId: string;
  isPublicView?: boolean;
}

const CAMPAIGN_COLORS = [
  { label: 'Light Gray', value: '#f3f4f6' },
  { label: 'White', value: '#ffffff' },
  { label: 'Light Blue', value: '#eff6ff' },
  { label: 'Light Green', value: '#f0fdf4' },
  { label: 'Light Purple', value: '#faf5ff' },
  { label: 'Light Yellow', value: '#fefce8' },
];

type StepKind = 'page' | 'fb_lead_form' | 'ads' | 'sms' | 'email';

interface SmsMsg { delay_days: number; body: string; media_url?: string | null; media_type?: string | null }
interface EmailMsg { delay_days: number; subject: string; from_name: string; body: string }

export function FunnelPreviewTab({ clientId, isPublicView = false }: FunnelPreviewTabProps) {
  const [searchParams] = useSearchParams();
  const campaignFilter = searchParams.get('campaign');
  const { data: client } = useClient(clientId);
  const { data: campaigns = [], isLoading: campaignsLoading } = useFunnelCampaigns(clientId);
  const { data: steps = [], isLoading: stepsLoading } = useFunnelSteps(clientId);
  const createCampaign = useCreateFunnelCampaign();
  const updateCampaign = useUpdateFunnelCampaign();
  const deleteCampaign = useDeleteFunnelCampaign();
  const createStep = useCreateFunnelStep();
  const updateStep = useUpdateFunnelStep();
  const deleteStep = useDeleteFunnelStep();
  const reorderSteps = useReorderFunnelSteps();
  
  const [addCampaignOpen, setAddCampaignOpen] = useState(false);
  const [newCampaignName, setNewCampaignName] = useState('');
  const [newCampaignColor, setNewCampaignColor] = useState('#f3f4f6');
  
  const [addStepOpen, setAddStepOpen] = useState(false);
  const [addStepCampaignId, setAddStepCampaignId] = useState<string | null>(null);
  const [addStepParentId, setAddStepParentId] = useState<string | null>(null);
  const [newStepName, setNewStepName] = useState('');
  const [newStepUrl, setNewStepUrl] = useState('');
  const [newStepKind, setNewStepKind] = useState<StepKind>('page');
  const [newAdPlatform, setNewAdPlatform] = useState<'facebook' | 'instagram'>('facebook');
  const [newSmsBody, setNewSmsBody] = useState('');
  const [newEmailSubject, setNewEmailSubject] = useState('');
  const [newEmailFromName, setNewEmailFromName] = useState('');
  const [newEmailBody, setNewEmailBody] = useState('');
  const [newSmsMessages, setNewSmsMessages] = useState<SmsMsg[]>([{ delay_days: 0, body: '' }]);
  const [newEmailMessages, setNewEmailMessages] = useState<EmailMsg[]>([{ delay_days: 0, subject: '', from_name: '', body: '' }]);
  
  const [editStepOpen, setEditStepOpen] = useState(false);
  const [editingStep, setEditingStep] = useState<FunnelStep | null>(null);
  const [editStepName, setEditStepName] = useState('');
  const [editStepUrl, setEditStepUrl] = useState('');
  const [editSmsBody, setEditSmsBody] = useState('');
  const [editEmailSubject, setEditEmailSubject] = useState('');
  const [editEmailFromName, setEditEmailFromName] = useState('');
  const [editEmailBody, setEditEmailBody] = useState('');
  const [editAdPlatform, setEditAdPlatform] = useState<'facebook' | 'instagram'>('facebook');
  const [editSmsMessages, setEditSmsMessages] = useState<SmsMsg[]>([]);
  const [editEmailMessages, setEditEmailMessages] = useState<EmailMsg[]>([]);
  
  const [deviceType, setDeviceType] = useState<DeviceType>('phone');
  const [previewStep, setPreviewStep] = useState<FunnelStep | null>(null);

  // Group steps by campaign
  const stepsByCampaign = useMemo(() => {
    const filtered = campaignFilter ? campaigns.filter(c => c.id === campaignFilter) : campaigns;
    return filtered.map(campaign => ({
      campaign,
      steps: steps.filter(s => s.campaign_id === campaign.id)
        .sort((a, b) => a.sort_order - b.sort_order)
    }));
  }, [campaigns, steps, campaignFilter]);

  // Steps without a campaign (legacy or uncategorized)
  const uncategorizedSteps = useMemo(() => {
    if (campaignFilter) return [];
    return steps.filter(s => !s.campaign_id).sort((a, b) => a.sort_order - b.sort_order);
  }, [steps, campaignFilter]);

  const handleAddCampaign = async () => {
    if (!newCampaignName.trim()) return;
    
    await createCampaign.mutateAsync({
      client_id: clientId,
      name: newCampaignName.trim(),
      color: newCampaignColor,
      sort_order: campaigns.length,
    });
    
    setNewCampaignName('');
    setNewCampaignColor('#f3f4f6');
    setAddCampaignOpen(false);
  };

  const handleAddStep = async () => {
    if (!newStepName.trim() || !addStepCampaignId) return;
    if (newStepKind === 'page' && !newStepUrl.trim()) return;

    let validUrl = '';
    if (newStepKind === 'page') {
      validUrl = newStepUrl.startsWith('http://') || newStepUrl.startsWith('https://')
        ? newStepUrl
        : 'https://' + newStepUrl;
    } else if (newStepKind === 'fb_lead_form') {
      validUrl = 'fb://lead-form';
    } else {
      validUrl = `internal://${newStepKind}`;
    }
    
    const siblingSteps = steps.filter(s =>
      s.campaign_id === addStepCampaignId &&
      (s.parent_step_id ?? null) === (addStepParentId ?? null)
    );
    
    const cleanSms = newSmsMessages
      .map(m => ({
        delay_days: Number(m.delay_days) || 0,
        body: (m.body || '').trim(),
        media_url: m.media_url || null,
        media_type: m.media_type || null,
      }))
      .filter(m => m.body.length > 0 || m.media_url);
    const cleanEmails = newEmailMessages
      .map(m => ({
        delay_days: Number(m.delay_days) || 0,
        subject: (m.subject || '').trim(),
        from_name: (m.from_name || '').trim(),
        body: (m.body || '').trim(),
      }))
      .filter(m => m.subject || m.body);

    await createStep.mutateAsync({
      client_id: clientId,
      campaign_id: addStepCampaignId,
      parent_step_id: addStepParentId,
      name: newStepName.trim(),
      url: validUrl,
      sort_order: siblingSteps.length,
      step_kind: newStepKind,
      ad_platform: newStepKind === 'ads' ? newAdPlatform : null,
      sms_body: newStepKind === 'sms' ? (cleanSms[0]?.body || newSmsBody || null) : null,
      email_subject: newStepKind === 'email' ? (cleanEmails[0]?.subject || newEmailSubject || null) : null,
      email_from_name: newStepKind === 'email' ? (cleanEmails[0]?.from_name || newEmailFromName || null) : null,
      email_body: newStepKind === 'email' ? (cleanEmails[0]?.body || newEmailBody || null) : null,
      messages:
        newStepKind === 'sms' ? cleanSms :
        newStepKind === 'email' ? cleanEmails :
        [],
    });
    
    setNewStepName('');
    setNewStepUrl('');
    setNewStepKind('page');
    setNewSmsBody('');
    setNewEmailSubject('');
    setNewEmailFromName('');
    setNewEmailBody('');
    setNewSmsMessages([{ delay_days: 0, body: '' }]);
    setNewEmailMessages([{ delay_days: 0, subject: '', from_name: '', body: '' }]);
    setAddStepOpen(false);
    setAddStepCampaignId(null);
    setAddStepParentId(null);
  };

  const openAddStep = (campaignId: string, parentStepId: string | null = null) => {
    setAddStepCampaignId(campaignId);
    setAddStepParentId(parentStepId);
    // Nurture defaults to SMS since that's the most common use case
    if (parentStepId) setNewStepKind('sms');
    setAddStepOpen(true);
  };

  const openEditStep = (step: FunnelStep) => {
    setEditingStep(step);
    setEditStepName(step.name);
    setEditStepUrl(step.url);
    setEditSmsBody(step.sms_body || '');
    setEditEmailSubject(step.email_subject || '');
    setEditEmailFromName(step.email_from_name || '');
    setEditEmailBody(step.email_body || '');
    setEditAdPlatform((step.ad_platform as 'facebook' | 'instagram') || 'facebook');
    const existingMsgs = (step.messages as any[]) || [];
    if (step.step_kind === 'sms') {
      setEditSmsMessages(
        existingMsgs.length > 0
          ? existingMsgs.map((m: any) => ({
              delay_days: Number(m.delay_days) || 0,
              body: m.body || '',
              media_url: m.media_url || null,
              media_type: m.media_type || null,
            }))
          : [{ delay_days: 0, body: step.sms_body || '' }]
      );
    } else if (step.step_kind === 'email') {
      setEditEmailMessages(
        existingMsgs.length > 0
          ? existingMsgs.map(m => ({
              delay_days: Number(m.delay_days) || 0,
              subject: m.subject || '',
              from_name: m.from_name || '',
              body: m.body || '',
            }))
          : [{
              delay_days: 0,
              subject: step.email_subject || '',
              from_name: step.email_from_name || '',
              body: step.email_body || '',
            }]
      );
    }
    setEditStepOpen(true);
  };

  const handleEditStep = async () => {
    if (!editingStep || !editStepName.trim()) return;
    const kind = (editingStep.step_kind || 'page') as StepKind;

    const updates: Partial<FunnelStep> = { name: editStepName.trim() };

    if (kind === 'page') {
      if (!editStepUrl.trim()) return;
      updates.url = editStepUrl.startsWith('http://') || editStepUrl.startsWith('https://')
        ? editStepUrl
        : 'https://' + editStepUrl;
    } else if (kind === 'sms') {
      const clean = editSmsMessages
        .map(m => ({
          delay_days: Number(m.delay_days) || 0,
          body: (m.body || '').trim(),
          media_url: m.media_url || null,
          media_type: m.media_type || null,
        }))
        .filter(m => m.body.length > 0 || m.media_url);
      (updates as any).messages = clean;
      updates.sms_body = clean[0]?.body || editSmsBody || null;
    } else if (kind === 'email') {
      const clean = editEmailMessages
        .map(m => ({
          delay_days: Number(m.delay_days) || 0,
          subject: (m.subject || '').trim(),
          from_name: (m.from_name || '').trim(),
          body: (m.body || '').trim(),
        }))
        .filter(m => m.subject || m.body);
      (updates as any).messages = clean;
      updates.email_subject = clean[0]?.subject || editEmailSubject || null;
      updates.email_from_name = clean[0]?.from_name || editEmailFromName || null;
      updates.email_body = clean[0]?.body || editEmailBody || null;
    } else if (kind === 'ads') {
      updates.ad_platform = editAdPlatform;
    }

    await updateStep.mutateAsync({ id: editingStep.id, clientId, updates });
    
    setEditStepOpen(false);
    setEditingStep(null);
  };

  const handleDeleteStep = (stepId: string) => {
    deleteStep.mutate({ id: stepId, clientId });
  };

  const handleReorderSteps = (orderedIds: string[]) => {
    reorderSteps.mutate({ clientId, orderedIds });
  };

  const handleEditCampaign = (campaign: FunnelCampaign) => {
    updateCampaign.mutate({
      id: campaign.id,
      clientId,
      updates: { name: campaign.name, color: campaign.color },
    });
  };

  const handleDeleteCampaign = (campaignId: string) => {
    deleteCampaign.mutate({ id: campaignId, clientId });
  };

  const isLoading = campaignsLoading || stepsLoading;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-muted-foreground">Loading funnel...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold">
            Funnel Preview
            {campaignFilter && stepsByCampaign[0] && (
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                · {stepsByCampaign[0].campaign.name}
              </span>
            )}
          </h2>
          <p className="text-sm text-muted-foreground">
            Organize your funnels into campaigns and preview across devices
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <DeviceSwitcher value={deviceType} onChange={setDeviceType} />
          {!isPublicView && (
            <Button onClick={() => setAddCampaignOpen(true)}>
              <FolderPlus className="h-4 w-4 mr-2" />
              Add Campaign
            </Button>
          )}
        </div>
      </div>


      {/* Campaign Sections */}
      {campaigns.length === 0 && uncategorizedSteps.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <FolderPlus className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground mb-2">No campaigns created yet</p>
            <p className="text-sm text-muted-foreground mb-4">
              Create a campaign to organize your funnel steps
            </p>
            {!isPublicView && (
              <Button variant="outline" onClick={() => setAddCampaignOpen(true)}>
                <FolderPlus className="h-4 w-4 mr-2" />
                Create Your First Campaign
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {stepsByCampaign.map(({ campaign, steps: campaignSteps }) => (
            <CampaignFlowSection
              key={campaign.id}
              campaign={campaign}
              steps={campaignSteps}
              deviceType={deviceType}
              isPublicView={isPublicView}
              clientId={clientId}
              brandName={client?.name}
              publicShareToken={client?.slug || client?.public_token || null}
              onAddStep={openAddStep}
              onEditStep={openEditStep}
              onDeleteStep={handleDeleteStep}
              onReorderSteps={handleReorderSteps}
              onEditCampaign={handleEditCampaign}
              onDeleteCampaign={handleDeleteCampaign}
            />
            ))}
        </div>
      )}

      {/* Full Preview Modal */}
      <Dialog open={!!previewStep} onOpenChange={() => setPreviewStep(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-auto">
          <DialogHeader>
            <DialogTitle>{previewStep?.name}</DialogTitle>
          </DialogHeader>
          {previewStep && (
            <div className="flex justify-center py-4">
              {deviceType === 'phone' && <IPhoneMockup url={previewStep.url} />}
              {deviceType === 'tablet' && <TabletMockup url={previewStep.url} />}
              {deviceType === 'desktop' && <DesktopMockup url={previewStep.url} />}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Add Campaign Modal */}
      <Dialog open={addCampaignOpen} onOpenChange={setAddCampaignOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Create Campaign</DialogTitle>
            <DialogDescription>
              Create a new campaign to organize your funnel steps
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 pt-4">
            <div className="space-y-2">
              <Label htmlFor="campaign-name">Campaign Name</Label>
              <Input
                id="campaign-name"
                value={newCampaignName}
                onChange={(e) => setNewCampaignName(e.target.value)}
                placeholder="e.g., 1031 Exchange, RV Park Fund"
              />
            </div>
            
            <div className="space-y-2">
              <Label>Background Color</Label>
              <div className="flex flex-wrap gap-2">
                {CAMPAIGN_COLORS.map((color) => (
                  <button
                    key={color.value}
                    onClick={() => setNewCampaignColor(color.value)}
                    className={`w-8 h-8 rounded-full border-2 transition-all ${
                      newCampaignColor === color.value 
                        ? 'border-primary ring-2 ring-primary/20' 
                        : 'border-border hover:border-muted-foreground'
                    }`}
                    style={{ backgroundColor: color.value }}
                    title={color.label}
                  />
                ))}
              </div>
            </div>
            
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setAddCampaignOpen(false)}>
                Cancel
              </Button>
              <Button 
                onClick={handleAddCampaign}
                disabled={!newCampaignName.trim() || createCampaign.isPending}
              >
                <FolderPlus className="h-4 w-4 mr-2" />
                Create Campaign
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Add Step Modal */}
      <Dialog open={addStepOpen} onOpenChange={setAddStepOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{addStepParentId ? 'Add Nurture Step' : 'Add Funnel Step'}</DialogTitle>
            <DialogDescription>
              {addStepParentId
                ? `Attach an SMS or email follow-up under "${steps.find(s => s.id === addStepParentId)?.name || 'this step'}"`
                : 'Add a landing page, lead form, ad, SMS, or email to this campaign'}
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 pt-4">
            {/* Step Type Selector */}
            <div className="space-y-2">
              <Label>Step Type</Label>
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                {([
                  { k: 'ads', label: 'Ads (FB/IG)', Icon: Images, hint: '1-3 rotating creatives', color: 'primary' },
                  { k: 'page', label: 'Web Page', Icon: Globe, hint: 'Landing page URL', color: 'primary' },
                  { k: 'fb_lead_form', label: 'FB Lead Form', Icon: FileText, hint: 'Native form', color: '#1877F2' },
                  { k: 'sms', label: 'SMS', Icon: MessageSquare, hint: 'Text message', color: 'primary' },
                  { k: 'email', label: 'Email', Icon: Mail, hint: 'Email preview', color: 'primary' },
                ] as const).map(({ k, label, Icon, hint }) => (
                  <button
                    key={k}
                    onClick={() => setNewStepKind(k)}
                    className={cn(
                      'flex flex-col items-center gap-1 p-2 rounded-lg border-2 transition-all text-xs',
                      newStepKind === k
                        ? 'border-primary bg-primary/5'
                        : 'border-border hover:border-muted-foreground'
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    <span className="font-medium text-[11px] text-center leading-tight">{label}</span>
                    <span className="text-[9px] text-muted-foreground text-center leading-tight">{hint}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="step-name">Step Name</Label>
              <Input
                id="step-name"
                value={newStepName}
                onChange={(e) => setNewStepName(e.target.value)}
                placeholder="e.g., Landing Page, Nurture SMS, Follow-up Email"
              />
            </div>
            
            {newStepKind === 'page' && (
              <div className="space-y-2">
                <Label htmlFor="step-url">Page URL</Label>
                <Input
                  id="step-url"
                  value={newStepUrl}
                  onChange={(e) => setNewStepUrl(e.target.value)}
                  placeholder="https://example.com/landing-page"
                />
                <p className="text-xs text-muted-foreground">
                  Make sure the URL allows embedding (some sites block iframes)
                </p>
              </div>
            )}

            {newStepKind === 'fb_lead_form' && (
              <div className="rounded-lg bg-[#1877F2]/5 border border-[#1877F2]/20 p-3">
                <p className="text-xs text-muted-foreground">
                  This will add a native Facebook Lead Form mockup to your funnel flow, showing accredited investor qualification, liquidity range, and contact fields.
                </p>
              </div>
            )}

            {newStepKind === 'ads' && (
              <div className="space-y-2">
                <Label>Ad Platform</Label>
                <ToggleGroup type="single" value={newAdPlatform} onValueChange={v => v && setNewAdPlatform(v as any)}>
                  <ToggleGroupItem value="facebook">Facebook</ToggleGroupItem>
                  <ToggleGroupItem value="instagram">Instagram</ToggleGroupItem>
                </ToggleGroup>
                <p className="text-xs text-muted-foreground">
                  After creating the step, click <strong>Select Ads</strong> to pick 1–3 approved or launched creatives that will rotate.
                </p>
              </div>
            )}

            {newStepKind === 'sms' && (
              <SmsCadenceEditor messages={newSmsMessages} onChange={setNewSmsMessages} />
            )}

            {newStepKind === 'email' && (
              <EmailCadenceEditor messages={newEmailMessages} onChange={setNewEmailMessages} />
            )}
            
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setAddStepOpen(false)}>
                Cancel
              </Button>
              <Button 
                onClick={handleAddStep}
                disabled={!newStepName.trim() || (newStepKind === 'page' && !newStepUrl.trim()) || createStep.isPending}
              >
                <Plus className="h-4 w-4 mr-2" />
                Add Step
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Step Modal */}
      <Dialog open={editStepOpen} onOpenChange={setEditStepOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Funnel Step</DialogTitle>
          </DialogHeader>
          
          <div className="space-y-4 pt-4">
            <div className="space-y-2">
              <Label htmlFor="edit-step-name">Step Name</Label>
              <Input
                id="edit-step-name"
                value={editStepName}
                onChange={(e) => setEditStepName(e.target.value)}
                placeholder="Step name"
              />
            </div>

            {(editingStep?.step_kind || 'page') === 'page' && (
              <div className="space-y-2">
                <Label htmlFor="edit-step-url">Page URL</Label>
                <Input
                  id="edit-step-url"
                  value={editStepUrl}
                  onChange={(e) => setEditStepUrl(e.target.value)}
                  placeholder="https://example.com/page"
                />
              </div>
            )}

            {editingStep?.step_kind === 'ads' && (
              <div className="space-y-2">
                <Label>Ad Platform</Label>
                <ToggleGroup type="single" value={editAdPlatform} onValueChange={v => v && setEditAdPlatform(v as any)}>
                  <ToggleGroupItem value="facebook">Facebook</ToggleGroupItem>
                  <ToggleGroupItem value="instagram">Instagram</ToggleGroupItem>
                </ToggleGroup>
                <p className="text-xs text-muted-foreground">
                  Use the <strong>Select Ads</strong> button on the step card to change which creatives rotate.
                </p>
              </div>
            )}

            {editingStep?.step_kind === 'sms' && (
              <SmsCadenceEditor messages={editSmsMessages} onChange={setEditSmsMessages} />
            )}

            {editingStep?.step_kind === 'email' && (
              <EmailCadenceEditor messages={editEmailMessages} onChange={setEditEmailMessages} />
            )}
            
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setEditStepOpen(false)}>
                Cancel
              </Button>
              <Button 
                onClick={handleEditStep}
                disabled={
                  !editStepName.trim() ||
                  ((editingStep?.step_kind || 'page') === 'page' && !editStepUrl.trim()) ||
                  updateStep.isPending
                }
              >
                Save Changes
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Cadence editors ──────────────────────────────────────────────

function SmsCadenceEditor({
  messages,
  onChange,
}: {
  messages: SmsMsg[];
  onChange: (m: SmsMsg[]) => void;
}) {
  const update = (i: number, patch: Partial<SmsMsg>) => {
    onChange(messages.map((m, idx) => (idx === i ? { ...m, ...patch } : m)));
  };
  const remove = (i: number) => onChange(messages.filter((_, idx) => idx !== i));
  const add = () => {
    const lastDelay = messages[messages.length - 1]?.delay_days ?? 0;
    onChange([...messages, { delay_days: lastDelay + 2, body: '' }]);
  };
  const [uploadingIdx, setUploadingIdx] = useState<number | null>(null);
  const inputsRef = useRef<Record<number, HTMLInputElement | null>>({});

  const handleFile = async (i: number, file: File | null) => {
    if (!file) return;
    setUploadingIdx(i);
    try {
      const ext = (file.name.split('.').pop() || 'bin').toLowerCase();
      const path = `funnel-sms/${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage
        .from('client-uploads')
        .upload(path, file, { contentType: file.type, upsert: false });
      if (error) throw error;
      const { data: { publicUrl } } = supabase.storage.from('client-uploads').getPublicUrl(path);
      update(i, { media_url: publicUrl, media_type: file.type });
    } catch (e: any) {
      console.error(e);
      alert('Upload failed: ' + (e?.message || 'unknown'));
    } finally {
      setUploadingIdx(null);
    }
  };
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label>SMS cadence</Label>
        <span className="text-[11px] text-muted-foreground">
          {messages.length} message{messages.length === 1 ? '' : 's'} · shown stacked in preview
        </span>
      </div>
      {messages.map((m, i) => (
        <div key={i} className="rounded-lg border border-border p-3 space-y-2 bg-muted/30">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-muted-foreground">#{i + 1}</span>
              <Label className="text-xs">Send on day</Label>
              <Input
                type="number"
                min={0}
                value={m.delay_days}
                onChange={e => update(i, { delay_days: parseInt(e.target.value) || 0 })}
                className="h-7 w-16 text-xs"
              />
              <span className="text-[11px] text-muted-foreground">
                {m.delay_days === 0 ? '(sent immediately)' : `(+${m.delay_days} day${m.delay_days === 1 ? '' : 's'} after step start)`}
              </span>
            </div>
            {messages.length > 1 && (
              <Button variant="ghost" size="sm" onClick={() => remove(i)} className="h-7 w-7 p-0">
                <Trash2 className="h-3 w-3 text-destructive" />
              </Button>
            )}
          </div>
          <Textarea
            value={m.body}
            onChange={e => update(i, { body: e.target.value })}
            placeholder="Hey {firstName}, quick follow-up..."
            rows={3}
          />
          <div className="flex items-center gap-2">
            <input
              ref={el => { inputsRef.current[i] = el; }}
              type="file"
              accept="video/*,image/*"
              className="hidden"
              onChange={e => handleFile(i, e.target.files?.[0] || null)}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              disabled={uploadingIdx === i}
              onClick={() => inputsRef.current[i]?.click()}
            >
              {uploadingIdx === i ? (
                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
              ) : (
                <Paperclip className="h-3 w-3 mr-1" />
              )}
              {m.media_url ? 'Replace attachment' : 'Attach video / image'}
            </Button>
            {m.media_url && (
              <>
                <span className="text-[10px] text-muted-foreground truncate max-w-[140px]">
                  {(m.media_type || '').startsWith('video') ? 'Video attached' : 'Image attached'}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0"
                  onClick={() => update(i, { media_url: null, media_type: null })}
                >
                  <X className="h-3 w-3" />
                </Button>
              </>
            )}
          </div>
          {m.media_url && (m.media_type || '').startsWith('video') && (
            <video src={m.media_url} className="rounded-md max-h-32 bg-black" controls muted playsInline />
          )}
          {m.media_url && (m.media_type || '').startsWith('image') && (
            <img src={m.media_url} alt="attachment" className="rounded-md max-h-32" />
          )}
        </div>
      ))}
      <Button variant="outline" size="sm" onClick={add} className="w-full">
        <Plus className="h-3 w-3 mr-1" /> Add follow-up SMS
      </Button>
    </div>
  );
}

function EmailCadenceEditor({
  messages,
  onChange,
}: {
  messages: EmailMsg[];
  onChange: (m: EmailMsg[]) => void;
}) {
  const update = (i: number, patch: Partial<EmailMsg>) => {
    onChange(messages.map((m, idx) => (idx === i ? { ...m, ...patch } : m)));
  };
  const remove = (i: number) => onChange(messages.filter((_, idx) => idx !== i));
  const add = () => {
    const lastDelay = messages[messages.length - 1]?.delay_days ?? 0;
    const lastFrom = messages[messages.length - 1]?.from_name ?? '';
    onChange([...messages, { delay_days: lastDelay + 3, subject: '', from_name: lastFrom, body: '' }]);
  };
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label>Email cadence</Label>
        <span className="text-[11px] text-muted-foreground">
          {messages.length} email{messages.length === 1 ? '' : 's'} · stacked in preview
        </span>
      </div>
      {messages.map((m, i) => (
        <div key={i} className="rounded-lg border border-border p-3 space-y-2 bg-muted/30">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-muted-foreground">#{i + 1}</span>
              <Label className="text-xs">Send on day</Label>
              <Input
                type="number"
                min={0}
                value={m.delay_days}
                onChange={e => update(i, { delay_days: parseInt(e.target.value) || 0 })}
                className="h-7 w-16 text-xs"
              />
              <span className="text-[11px] text-muted-foreground">
                {m.delay_days === 0 ? '(sent immediately)' : `(+${m.delay_days} day${m.delay_days === 1 ? '' : 's'})`}
              </span>
            </div>
            {messages.length > 1 && (
              <Button variant="ghost" size="sm" onClick={() => remove(i)} className="h-7 w-7 p-0">
                <Trash2 className="h-3 w-3 text-destructive" />
              </Button>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Input
              value={m.from_name}
              onChange={e => update(i, { from_name: e.target.value })}
              placeholder="From name"
              className="h-8 text-xs"
            />
            <Input
              value={m.subject}
              onChange={e => update(i, { subject: e.target.value })}
              placeholder="Subject"
              className="h-8 text-xs"
            />
          </div>
          <Textarea
            value={m.body}
            onChange={e => update(i, { body: e.target.value })}
            placeholder={"Hi {firstName},\n\n..."}
            rows={4}
          />
        </div>
      ))}
      <Button variant="outline" size="sm" onClick={add} className="w-full">
        <Plus className="h-3 w-3 mr-1" /> Add follow-up email
      </Button>
    </div>
  );
}
