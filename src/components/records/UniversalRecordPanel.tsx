import { User, Mail, Phone, DollarSign, Calendar, Tag, ExternalLink, Hash, Globe, FileText, ChevronDown, Link2, StickyNote, Clock, Target, RefreshCw, Loader2 } from 'lucide-react';
import { useLeadEnrichment, useEnrichLead } from '@/hooks/useLeadEnrichment';
import { EnrichmentSection } from '@/components/records/EnrichmentSection';
import { MeetingContextPanel } from '@/components/records/MeetingContextPanel';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { PipelineOpportunity } from '@/hooks/usePipelines';
import { Lead, GHLNote } from '@/hooks/useLeadsAndCalls';
import { useContactTimeline } from '@/hooks/useContactTimeline';
import { useLeadByContactId } from '@/hooks/useLeadByContactId';
import { ContactTimelineSection } from '@/components/pipeline/ContactTimelineSection';
import { useClient } from '@/hooks/useClients';
import { useSingleContactSync } from '@/hooks/useSingleContactSync';
import { useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

// Helper to format currency
function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

// GHL field ID to human-readable label mapping (fallback for legacy data)
const ghlFieldLabels: Record<string, string> = {
  'DHkLtULj05sgxm3H8RET': 'Investment Range',
  'UKtZxKiQgUDUa2wpb7SS': 'Accredited Investor?',
  'YMWNzc2t8VxnkQdt7xkq': 'Timeline to Deploy',
  'KuGBAp7FfYwkyKDxqhI6': 'LinkedIn Profile',
  'UMvhwPXbDAzEgkEfutux': '1031 Exchange Amount',
  'mHvcHd1wvwyvoJHim3Eb': 'Property Status',
  'nwXgYLXyibMPgTlUFzbp': 'Call Disposition',
  'ZHjm3krQalEyLCltxthZ': 'Call Sentiment',
  '6zEzvZabX0i0mOnVlSfT': 'Interest Level',
  'PsZ0FxJYrBk7FJftONUS': 'Follow-Up Action',
  'aCCb99z3kv7KENtzlGqI': 'Call Summary',
  'MQ1DUMtIXwVKWPkHJyJi': 'Call Date/Time',
  'CN54sE9RqSmrgu9ZbwQK': 'Call Duration Notes',
  'Z73Jrsio3H1hf5BddjXl': 'Callback Requested',
  '6CCCac16UtSHUyHNJ2CF': 'Timeline to Deploy',
  'PlG2j9mBMdrLN2yIIeKY': 'Investment Range',
  'XhF3j7VTL0MN2vpVHNUC': 'Accredited Investor?',
  'if4VztLatnVf1w3BqEG8': 'Lead Source',
  'slkmKStufr2NoRwuJimk': 'Date Submitted',
  'QO69za0Xie2pyaYPWFlb': 'Appointment Status',
};

// Detect if a string looks like a GHL field ID (alphanumeric, 20+ chars, no spaces)
function isGHLFieldId(str: string): boolean {
  return /^[A-Za-z0-9]{15,}$/.test(str);
}

// Try to make a GHL fieldKey more readable (e.g. "contact.timeline_to_deploy" → "Timeline To Deploy")
function humanizeFieldKey(key: string): string {
  // If it's in the known labels map, use that
  if (ghlFieldLabels[key]) return ghlFieldLabels[key];
  
  // If it looks like a raw GHL field ID with no mapping, show "Custom Field"
  if (isGHLFieldId(key)) return `Custom Field`;
  
  // If it's a fieldKey like "contact.some_field_name", clean it up
  const cleaned = key
    .replace(/^contact\./, '')
    .replace(/[._]/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
    .trim();
  
  return cleaned || key;
}

// UTM-related field IDs to filter out
const utmFieldIds = new Set([
  'IiyHAHVhIgVfyv1BSCGx',
  'FnE2fd8OS6GvBhR2oTEy',
  '3IjNRlnUaWgtuvpA2fNu',
  '3aeuIxb7cGBiBfMp3ujP',
]);

const isUtmRelated = (question: string) => {
  const lower = question.toLowerCase();
  return lower.includes('utm_') || lower.includes('utm ') ||
         lower.includes('campaign tracker') || lower.includes('ad set') ||
         lower.includes('adset') || lower.includes('ad_set') ||
         lower === 'ad campaign' || lower === 'source';
};

// Filter and format questions
function getFilteredQuestions(questions: any[] | null | undefined) {
  if (!questions || !Array.isArray(questions) || questions.length === 0) return [];
  
  return questions.filter((q: any) => {
    const questionKey = String(q.question || '');
    if (utmFieldIds.has(questionKey)) return false;
    if (isUtmRelated(questionKey)) return false;
    if (typeof q.answer === 'number' && q.answer > 1000000000000) return false;
    return true;
  });
}

export interface UniversalRecordPanelProps {
  // Record data - can be opportunity, lead, call, etc.
  record: PipelineOpportunity | Lead | any;
  recordType: 'opportunity' | 'lead' | 'call' | 'funded';
  clientId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isPublicView?: boolean;
  // Optional: pre-fetched linked lead (for optimization)
  linkedLead?: Lead | null;
}

export function UniversalRecordPanel({ 
  record, 
  recordType,
  clientId,
  open, 
  onOpenChange,
  isPublicView,
  linkedLead: preLinkedLead,
}: UniversalRecordPanelProps) {
  const [sectionsOpen, setSectionsOpen] = useState({
    contact: true,
    opportunity: true,
    attribution: true,
    questions: true,
    enrichment: true,
    ghl: false,
    timeline: true,
    meetings: true,
  });

  // Get client info for GHL location
  const { data: client } = useClient(clientId);
  
  // Sync hook for manual sync
  const { syncContact, isSyncing, syncAllPipelines, isSyncingPipelines } = useSingleContactSync();
  
  // Get GHL Contact ID based on record type
  const ghlContactId = recordType === 'opportunity' 
    ? (record as PipelineOpportunity).ghl_contact_id
    : record?.external_id;
  
  // Fetch linked lead by GHL Contact ID (only if not pre-fetched)
  const { data: fetchedLead } = useLeadByContactId(
    clientId, 
    preLinkedLead ? null : ghlContactId
  );
  
  // Use pre-fetched or fetched lead
  const linkedLead = preLinkedLead || fetchedLead;
  
  // Get timeline events
  const { data: timelineEvents = [], isLoading: timelineLoading } = useContactTimeline(
    clientId,
    ghlContactId || undefined
  );
  
  // Can sync from GHL?
  const canSync = !isPublicView && 
    ghlContactId && 
    client?.ghl_location_id && 
    !ghlContactId.startsWith('wh_') && 
    !ghlContactId.startsWith('manual-');
  
  // Format last synced time
  const ghlSyncedAt = linkedLead?.ghl_synced_at;
  const lastSyncedText = ghlSyncedAt 
    ? formatDistanceToNow(new Date(ghlSyncedAt), { addSuffix: true })
    : 'Never synced';
  
  // Determine staleness color
  const getSyncColor = () => {
    if (!ghlSyncedAt) return 'text-muted-foreground';
    const hoursSinceSync = (Date.now() - new Date(ghlSyncedAt).getTime()) / (1000 * 60 * 60);
    if (hoursSinceSync < 24) return 'text-chart-4';
    return 'text-amber-500';
  };
  
  // Handle sync button click - syncs contact AND all pipelines
  const handleSync = async () => {
    if (!canSync || !ghlContactId) return;
    
    // Run both syncs in parallel
    await Promise.all([
      syncContact(clientId, ghlContactId, 'lead'),
      syncAllPipelines(clientId),
    ]);
  };
  
  const isSyncInProgress = isSyncing(ghlContactId || '') || isSyncingPipelines;

  // Extract common data — MUST be before handleEnrich so phone/email are defined
  const contactName = record.contact_name || record.name || linkedLead?.name || 'Unknown Contact';
  const contactEmail = record.contact_email || record.email || linkedLead?.email;
  const contactPhone = record.contact_phone || record.phone || linkedLead?.phone;

  // Lead enrichment
  const { data: enrichment, isLoading: enrichmentLoading } = useLeadEnrichment(clientId, ghlContactId);
  const enrichMutation = useEnrichLead();
  
  const handleEnrich = () => {
    if (!ghlContactId) return;
    // Parse name for accuracy matching
    const nameParts = (contactName || '').trim().split(/\s+/);
    const firstName = nameParts[0] || undefined;
    const lastName = nameParts.slice(1).join(' ') || undefined;
    enrichMutation.mutate({
      client_id: clientId,
      lead_id: linkedLead?.id,
      external_id: ghlContactId,
      phone: contactPhone || undefined,
      email: contactEmail || undefined,
      first_name: firstName,
      last_name: lastName,
    });
  };
  
  // Get questions from linked lead
  const questions = linkedLead?.questions;
  const filteredQuestions = getFilteredQuestions(questions);
  
  // Get UTM data from linked lead or record
  const utmData = {
    source: linkedLead?.utm_source || record?.utm_source,
    medium: linkedLead?.utm_medium || record?.utm_medium,
    campaign: linkedLead?.campaign_name || linkedLead?.utm_campaign || record?.campaign_name || record?.utm_campaign,
    content: linkedLead?.utm_content || record?.utm_content,
    term: linkedLead?.utm_term || record?.utm_term,
    adSet: linkedLead?.ad_set_name || record?.ad_set_name,
    adId: linkedLead?.ad_id || record?.ad_id,
  };
  
  const hasUtmData = Object.values(utmData).some(v => !!v);
  
  // Get GHL notes
  const ghlNotes = linkedLead?.ghl_notes as GHLNote[] | null | undefined;

  // Status colors for opportunities
  const statusColors: Record<string, string> = {
    open: 'bg-blue-500/10 text-blue-600 border-blue-500/20',
    won: 'bg-green-500/10 text-green-600 border-green-500/20',
    lost: 'bg-red-500/10 text-red-600 border-red-500/20',
    abandoned: 'bg-muted text-muted-foreground border-border',
  };

  const toggleSection = (section: keyof typeof sectionsOpen) => {
    setSectionsOpen(prev => ({ ...prev, [section]: !prev[section] }));
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-lg overflow-y-auto">
        <SheetHeader className="flex flex-row items-center justify-between pr-8">
          <SheetTitle className="flex items-center gap-2">
            <User className="h-5 w-5" />
            {contactName}
          </SheetTitle>
          
          {/* Sync status and button */}
          {!isPublicView && (
            <div className="flex items-center gap-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className={`text-xs ${getSyncColor()}`}>
                    {lastSyncedText}
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="text-xs">
                    {ghlSyncedAt 
                      ? `Last synced: ${new Date(ghlSyncedAt).toLocaleString()}`
                      : 'Never synced from GHL'}
                  </p>
                </TooltipContent>
              </Tooltip>
              
              {canSync && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      disabled={isSyncInProgress}
                      onClick={handleSync}
                    >
                      {isSyncInProgress ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <RefreshCw className="h-4 w-4" />
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="text-xs">Sync contact & all pipelines</p>
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
          )}
        </SheetHeader>

        <div className="mt-6 space-y-4">
          {/* Contact Information */}
          <Collapsible open={sectionsOpen.contact} onOpenChange={() => toggleSection('contact')}>
            <CollapsibleTrigger className="flex items-center justify-between w-full py-2 text-sm font-semibold text-muted-foreground uppercase tracking-wide hover:text-foreground transition-colors">
              <span className="flex items-center gap-2">
                <User className="h-4 w-4" />
                Contact Information
              </span>
              <ChevronDown className={`h-4 w-4 transition-transform ${sectionsOpen.contact ? 'rotate-180' : ''}`} />
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-3 pt-2">
              {contactEmail && (
                <div className="flex items-center gap-2 text-sm">
                  <Mail className="h-4 w-4 text-muted-foreground" />
                  <a href={`mailto:${contactEmail}`} className="text-primary hover:underline">
                    {contactEmail}
                  </a>
                </div>
              )}
              
              {contactPhone && (
                <div className="flex items-center gap-2 text-sm">
                  <Phone className="h-4 w-4 text-muted-foreground" />
                  <a href={`tel:${contactPhone}`} className="text-primary hover:underline">
                    {contactPhone}
                  </a>
                </div>
              )}

              {/* GHL Contact ID and View in GHL link */}
              {ghlContactId && (
                <div className="flex items-center gap-2 mt-2 pt-2 border-t border-border/50 text-sm">
                  <Hash className="h-4 w-4 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground font-mono truncate max-w-[150px]">
                    {ghlContactId}
                  </span>
                  {client?.ghl_location_id && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-xs ml-auto"
                      onClick={() => {
                        window.open(
                          `https://app.gohighlevel.com/v2/location/${client.ghl_location_id}/contacts/detail/${ghlContactId}`,
                          '_blank'
                        );
                      }}
                    >
                      <ExternalLink className="h-3 w-3 mr-1" />
                      View in GHL
                    </Button>
                  )}
                </div>
              )}
            </CollapsibleContent>
          </Collapsible>

          <Separator />

          {/* Opportunity/Value Details (for opportunities) */}
          {recordType === 'opportunity' && (
            <>
              <Collapsible open={sectionsOpen.opportunity} onOpenChange={() => toggleSection('opportunity')}>
                <CollapsibleTrigger className="flex items-center justify-between w-full py-2 text-sm font-semibold text-muted-foreground uppercase tracking-wide hover:text-foreground transition-colors">
                  <span className="flex items-center gap-2">
                    <Target className="h-4 w-4" />
                    Opportunity Details
                  </span>
                  <ChevronDown className={`h-4 w-4 transition-transform ${sectionsOpen.opportunity ? 'rotate-180' : ''}`} />
                </CollapsibleTrigger>
                <CollapsibleContent className="pt-2">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="flex items-center gap-2">
                      <DollarSign className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <div className="text-xs text-muted-foreground">Value</div>
                        <div className="font-semibold text-chart-2">
                          {formatCurrency((record as PipelineOpportunity).monetary_value)}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <Tag className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <div className="text-xs text-muted-foreground">Status</div>
                        <Badge 
                          variant="outline" 
                          className={statusColors[(record as PipelineOpportunity).status] || ''}
                        >
                          {(record as PipelineOpportunity).status}
                        </Badge>
                      </div>
                    </div>

                    {record.source && (
                      <div className="flex items-center gap-2">
                        <ExternalLink className="h-4 w-4 text-muted-foreground" />
                        <div>
                          <div className="text-xs text-muted-foreground">Source</div>
                          <div className="text-sm">{record.source}</div>
                        </div>
                      </div>
                    )}

                    {(record as PipelineOpportunity).last_stage_change_at && (
                      <div className="flex items-center gap-2">
                        <Calendar className="h-4 w-4 text-muted-foreground" />
                        <div>
                          <div className="text-xs text-muted-foreground">Last Updated</div>
                          <div className="text-sm">
                            {new Date((record as PipelineOpportunity).last_stage_change_at!).toLocaleDateString()}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </CollapsibleContent>
              </Collapsible>
              <Separator />
            </>
          )}

          {/* Lead Opportunity Info (for lead records that have opportunity data) */}
          {recordType === 'lead' && (linkedLead?.opportunity_status || record?.opportunity_status) && (
            <>
              <Collapsible open={sectionsOpen.opportunity} onOpenChange={() => toggleSection('opportunity')}>
                <CollapsibleTrigger className="flex items-center justify-between w-full py-2 text-sm font-semibold text-muted-foreground uppercase tracking-wide hover:text-foreground transition-colors">
                  <span className="flex items-center gap-2">
                    <Target className="h-4 w-4" />
                    Pipeline Status
                  </span>
                  <ChevronDown className={`h-4 w-4 transition-transform ${sectionsOpen.opportunity ? 'rotate-180' : ''}`} />
                </CollapsibleTrigger>
                <CollapsibleContent className="pt-2">
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    {(linkedLead?.opportunity_stage || record?.opportunity_stage) && (
                      <div>
                        <span className="text-muted-foreground">Stage:</span>{' '}
                        <Badge variant="outline">{linkedLead?.opportunity_stage || record?.opportunity_stage}</Badge>
                      </div>
                    )}
                    {(linkedLead?.opportunity_status || record?.opportunity_status) && (
                      <div>
                        <span className="text-muted-foreground">Status:</span>{' '}
                        {linkedLead?.opportunity_status || record?.opportunity_status}
                      </div>
                    )}
                    {((linkedLead?.opportunity_value || record?.opportunity_value) ?? 0) > 0 && (
                      <div className="col-span-2">
                        <span className="text-muted-foreground">Value:</span>{' '}
                        <span className="font-semibold text-chart-2">
                          {formatCurrency(linkedLead?.opportunity_value || record?.opportunity_value || 0)}
                        </span>
                      </div>
                    )}
                  </div>
                </CollapsibleContent>
              </Collapsible>
              <Separator />
            </>
          )}

          {/* Attribution / UTM Parameters */}
          {hasUtmData && (
            <>
              <Collapsible open={sectionsOpen.attribution} onOpenChange={() => toggleSection('attribution')}>
                <CollapsibleTrigger className="flex items-center justify-between w-full py-2 text-sm font-semibold text-muted-foreground uppercase tracking-wide hover:text-foreground transition-colors">
                  <span className="flex items-center gap-2">
                    <Globe className="h-4 w-4" />
                    Attribution
                  </span>
                  <ChevronDown className={`h-4 w-4 transition-transform ${sectionsOpen.attribution ? 'rotate-180' : ''}`} />
                </CollapsibleTrigger>
                <CollapsibleContent className="pt-2 space-y-1.5 text-sm">
                  {utmData.campaign && (
                    <p><span className="text-muted-foreground">Campaign:</span> {utmData.campaign}</p>
                  )}
                  {utmData.adSet && (
                    <p><span className="text-muted-foreground">Ad Set:</span> {utmData.adSet}</p>
                  )}
                  {utmData.source && (
                    <p><span className="text-muted-foreground">Source:</span> {utmData.source}</p>
                  )}
                  {utmData.medium && (
                    <p><span className="text-muted-foreground">Medium:</span> {utmData.medium}</p>
                  )}
                  {utmData.content && (
                    <p><span className="text-muted-foreground">Content:</span> {utmData.content}</p>
                  )}
                  {utmData.term && (
                    <p><span className="text-muted-foreground">Term:</span> {utmData.term}</p>
                  )}
                  {utmData.adId && (
                    <p><span className="text-muted-foreground">Ad ID:</span> <span className="font-mono text-xs">{utmData.adId}</span></p>
                  )}
                </CollapsibleContent>
              </Collapsible>
              <Separator />
            </>
          )}

          {/* Form Questions / Survey Responses */}
          {filteredQuestions.length > 0 && (
            <>
              <Collapsible open={sectionsOpen.questions} onOpenChange={() => toggleSection('questions')}>
                <CollapsibleTrigger className="flex items-center justify-between w-full py-2 text-sm font-semibold text-muted-foreground uppercase tracking-wide hover:text-foreground transition-colors">
                  <span className="flex items-center gap-2">
                    <FileText className="h-4 w-4" />
                    Form Responses
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                      {filteredQuestions.length}
                    </Badge>
                  </span>
                  <ChevronDown className={`h-4 w-4 transition-transform ${sectionsOpen.questions ? 'rotate-180' : ''}`} />
                </CollapsibleTrigger>
                <CollapsibleContent className="pt-2 space-y-2">
                  {filteredQuestions.map((q: any, idx: number) => {
                    const questionKey = String(q.question || '');
                    const displayLabel = humanizeFieldKey(questionKey);
                    const answerStr = String(q.answer);
                    const isUrl = answerStr.startsWith('http://') || answerStr.startsWith('https://');
                    const isLongText = answerStr.length > 100;
                    return (
                      <div key={idx} className="bg-muted/50 p-2 rounded">
                        <p className="text-muted-foreground text-xs">{displayLabel}</p>
                        {isUrl ? (
                          <a href={answerStr} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline text-sm break-all">
                            {answerStr}
                          </a>
                        ) : (
                          <p className={`font-medium text-sm ${isLongText ? 'whitespace-pre-wrap' : ''}`}>{answerStr}</p>
                        )}
                      </div>
                    );
                  })}
                </CollapsibleContent>
              </Collapsible>
              <Separator />
            </>
          )}

          {/* Lead Enrichment */}
          {!isPublicView && (
            <>
              <MeetingContextPanel
                leadId={linkedLead?.id || (recordType === 'lead' ? record?.id : null)}
                isOpen={sectionsOpen.meetings}
                onToggle={() => toggleSection('meetings')}
              />
              <EnrichmentSection
                enrichment={enrichment}
                isLoading={enrichmentLoading}
                isEnriching={enrichMutation.isPending}
                onEnrich={handleEnrich}
                canEnrich={!!(contactPhone || contactEmail)}
                isOpen={sectionsOpen.enrichment}
                onToggle={() => toggleSection('enrichment')}
              />
              <Separator />
            </>
          )}

          {/* GHL Integration Details */}
          {(ghlNotes?.length || ghlSyncedAt) && (
            <>
              <Collapsible open={sectionsOpen.ghl} onOpenChange={() => toggleSection('ghl')}>
                <CollapsibleTrigger className="flex items-center justify-between w-full py-2 text-sm font-semibold text-muted-foreground uppercase tracking-wide hover:text-foreground transition-colors">
                  <span className="flex items-center gap-2">
                    <Link2 className="h-4 w-4" />
                    GHL Details
                    {ghlNotes && ghlNotes.length > 0 && (
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                        {ghlNotes.length} notes
                      </Badge>
                    )}
                  </span>
                  <ChevronDown className={`h-4 w-4 transition-transform ${sectionsOpen.ghl ? 'rotate-180' : ''}`} />
                </CollapsibleTrigger>
                <CollapsibleContent className="pt-2 space-y-3">
                  {/* Last Sync */}
                  {ghlSyncedAt && (
                    <div className="flex items-center gap-2 text-xs">
                      <Clock className="h-3 w-3 text-muted-foreground" />
                      <span className="text-muted-foreground">Last synced:</span>
                      <span>{formatDistanceToNow(new Date(ghlSyncedAt), { addSuffix: true })}</span>
                    </div>
                  )}
                  
                  {/* Notes */}
                  {ghlNotes && ghlNotes.length > 0 && (
                    <div className="space-y-2 max-h-[200px] overflow-y-auto">
                      {ghlNotes.map((note, idx) => (
                        <div 
                          key={note.id || idx} 
                          className="bg-muted/50 p-2 rounded text-sm border-l-2 border-primary/30"
                        >
                          <p className="text-foreground">{note.body}</p>
                          <p className="text-xs text-muted-foreground mt-1">
                            {note.dateAdded ? formatDistanceToNow(new Date(note.dateAdded), { addSuffix: true }) : 'Unknown date'}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </CollapsibleContent>
              </Collapsible>
              <Separator />
            </>
          )}

          {/* Timeline */}
          <Collapsible open={sectionsOpen.timeline} onOpenChange={() => toggleSection('timeline')}>
            <CollapsibleTrigger className="flex items-center justify-between w-full py-2 text-sm font-semibold text-muted-foreground uppercase tracking-wide hover:text-foreground transition-colors">
              <span className="flex items-center gap-2">
                <Clock className="h-4 w-4" />
                Activity Timeline
              </span>
              <ChevronDown className={`h-4 w-4 transition-transform ${sectionsOpen.timeline ? 'rotate-180' : ''}`} />
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-2">
              <ContactTimelineSection 
                events={timelineEvents}
                isLoading={timelineLoading}
                ghlContactId={ghlContactId}
                clientId={clientId}
                isPublicView={isPublicView}
              />
            </CollapsibleContent>
          </Collapsible>
        </div>
      </SheetContent>
    </Sheet>
  );
}
