import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Upload, Rocket, Loader2, X, Image as ImageIcon, Film, CheckCircle2, Play, ExternalLink } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useCreateTask } from '@/hooks/useTasks';
import { toast } from 'sonner';
import { LeadFormEditor, DEFAULT_LEAD_FORM_QUESTIONS, LeadFormQuestion } from '@/components/funnel/LeadFormEditor';

interface NewCampaignWizardProps {
  open: boolean;
  onClose: () => void;
  clientId: string;
  clientName: string;
}

type Step = 1 | 2 | 3 | 4 | 5 | 6;

type Asset = { id: string; name?: string; username?: string };
type LaunchResult = {
  campaignId: string;
  adSetId: string;
  leadFormId?: string;
  ads: { adId: string; creativeId: string }[];
};

export function NewCampaignWizard({ open, onClose, clientId, clientName }: NewCampaignWizardProps) {
  const [step, setStep] = useState<Step>(1);
  const [name, setName] = useState('');
  const [objective, setObjective] = useState('leads');
  const [budget, setBudget] = useState('100');
  const [notes, setNotes] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [activating, setActivating] = useState(false);
  const [result, setResult] = useState<LaunchResult | null>(null);
  // Meta assets
  const [pages, setPages] = useState<Asset[]>([]);
  const [pixels, setPixels] = useState<Asset[]>([]);
  const [igActors, setIgActors] = useState<Asset[]>([]);
  const [leadForms, setLeadForms] = useState<Asset[]>([]);
  const [assetsLoading, setAssetsLoading] = useState(false);
  const [pageId, setPageId] = useState('');
  const [instagramActorId, setInstagramActorId] = useState('');
  const [pixelId, setPixelId] = useState('');
  const [customEventType, setCustomEventType] = useState('LEAD');
  const [leadFormMode, setLeadFormMode] = useState<'existing' | 'new'>('new');
  const [leadFormId, setLeadFormId] = useState('');
  const [ctaType, setCtaType] = useState('SIGN_UP');
  const [linkUrl, setLinkUrl] = useState('');
  const [primaryText, setPrimaryText] = useState('');
  const [headline, setHeadline] = useState('');
  // Targeting
  const [ageMin, setAgeMin] = useState('30');
  const [ageMax, setAgeMax] = useState('65');
  const [gender, setGender] = useState('all');
  const [locations, setLocations] = useState('United States');
  const [interests, setInterests] = useState('');
  const [behaviors, setBehaviors] = useState('');
  const [customAudiences, setCustomAudiences] = useState('');
  const [placements, setPlacements] = useState('automatic');
  // Lead form
  const [leadFormName, setLeadFormName] = useState('');
  const [leadFormIntro, setLeadFormIntro] = useState('');
  const [privacyUrl, setPrivacyUrl] = useState('');
  const [thankYouUrl, setThankYouUrl] = useState('');
  const [questions, setQuestions] = useState<LeadFormQuestion[]>(DEFAULT_LEAD_FORM_QUESTIONS);
  const [smsVerify, setSmsVerify] = useState(false);
  const [smsVerifyMessage, setSmsVerifyMessage] = useState('Your verification code is {{code}}. Reply STOP to opt out.');
  const createTask = useCreateTask();

  const reset = () => {
    setStep(1); setName(''); setObjective('leads'); setBudget('100'); setResult(null);
    setNotes(''); setFiles([]);
    setPageId(''); setInstagramActorId(''); setPixelId(''); setLeadFormId(''); setLeadFormMode('new');
    setCtaType('SIGN_UP'); setLinkUrl(''); setPrimaryText(''); setHeadline('');
    setAgeMin('30'); setAgeMax('65'); setGender('all'); setLocations('United States');
    setInterests(''); setBehaviors(''); setCustomAudiences(''); setPlacements('automatic');
    setLeadFormName(''); setLeadFormIntro(''); setPrivacyUrl(''); setThankYouUrl('');
    setQuestions(DEFAULT_LEAD_FORM_QUESTIONS); setSmsVerify(false);
  };
  const close = () => { reset(); onClose(); };

  // Load Meta assets when dialog opens
  useEffect(() => {
    if (!open || !clientId) return;
    (async () => {
      setAssetsLoading(true);
      try {
        // Kick a refresh (cached in meta_ad_accounts)
        await supabase.functions.invoke('fetch-meta-account-assets', { body: { clientId } });
        const { data: client } = await supabase
          .from('clients').select('meta_ad_account_id').eq('id', clientId).single();
        const acctId = String(client?.meta_ad_account_id || '').replace(/^act_/, '');
        if (acctId) {
          const { data: acct } = await supabase
            .from('meta_ad_accounts')
            .select('pages, pixels, instagram_actors')
            .eq('ad_account_id', acctId).maybeSingle();
          setPages((acct?.pages || []) as Asset[]);
          setPixels((acct?.pixels || []) as Asset[]);
          setIgActors((acct?.instagram_actors || []) as Asset[]);
          const firstPage = (acct?.pages || [])[0]?.id;
          if (firstPage) setPageId(firstPage);
          const firstPixel = (acct?.pixels || [])[0]?.id;
          if (firstPixel) setPixelId(firstPixel);
        }
        // Sync + load existing lead forms
        await supabase.functions.invoke('meta-leadforms-sync', { body: { client_id: clientId } });
        const { data: forms } = await supabase
          .from('meta_lead_forms').select('meta_form_id, name')
          .eq('client_id', clientId).order('name');
        setLeadForms((forms || []).map((f: any) => ({ id: f.meta_form_id, name: f.name })));
      } catch (e) {
        console.error('load meta assets', e);
      } finally {
        setAssetsLoading(false);
      }
    })();
  }, [open, clientId]);

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    setFiles((prev) => [...prev, ...Array.from(list)]);
  };

  const buildTargeting = () => {
    const t: any = {
      age_min: Number(ageMin) || 18,
      age_max: Number(ageMax) || 65,
      geo_locations: { countries: (locations || 'US').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 25).map((s) => {
        // Best-effort: 2-letter codes stay, everything else falls to US
        return s.length === 2 ? s.toUpperCase() : 'US';
      }) },
    };
    if (gender === 'male') t.genders = [1];
    else if (gender === 'female') t.genders = [2];
    if (placements === 'feed-only') { t.publisher_platforms = ['facebook', 'instagram']; t.facebook_positions = ['feed']; t.instagram_positions = ['stream']; }
    else if (placements === 'stories-reels') { t.publisher_platforms = ['facebook', 'instagram']; t.facebook_positions = ['story']; t.instagram_positions = ['story', 'reels']; }
    return t;
  };

  const uploadFilesToStorage = async (): Promise<{ url: string; type: 'image' | 'video'; name: string }[]> => {
    const uploaded: { url: string; type: 'image' | 'video'; name: string }[] = [];
    const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
    const stamp = Date.now();
    for (const file of files) {
      const path = `campaigns/${clientId}/${stamp}-${slug}/${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      const { error } = await supabase.storage.from('assets').upload(path, file, { contentType: file.type, upsert: false });
      if (error) throw error;
      const { data: pub } = supabase.storage.from('assets').getPublicUrl(path);
      uploaded.push({ url: pub.publicUrl, type: file.type.startsWith('video/') ? 'video' : 'image', name: file.name });
    }
    return uploaded;
  };

  const launchToMeta = async () => {
    if (!name.trim()) { toast.error('Campaign name required'); return; }
    if (!pageId) { toast.error('Pick a Facebook Page'); return; }
    if (files.length === 0) { toast.error('Add at least one creative'); return; }
    if (objective === 'conversions' && !pixelId) { toast.error('Pick a Pixel for conversions'); return; }

    setLaunching(true);
    try {
      toast.info('Uploading creatives…');
      const uploaded = await uploadFilesToStorage();
      toast.info('Creating campaign on Meta…');
      const payload: any = {
        clientId,
        campaignName: name,
        objective,
        dailyBudgetDollars: Number(budget),
        adSetName: `${name} — Ad Set 1`,
        pageId,
        instagramActorId: instagramActorId || undefined,
        pixelId: objective === 'conversions' ? pixelId : undefined,
        customEventType: objective === 'conversions' ? customEventType : undefined,
        targeting: buildTargeting(),
        creatives: uploaded.map((u, i) => ({
          fileUrl: u.url,
          fileType: u.type,
          fileName: u.name,
          name: `${name} — ${i + 1}`,
          message: primaryText || undefined,
          headline: headline || undefined,
          linkUrl: linkUrl || thankYouUrl || undefined,
          callToActionType: ctaType,
        })),
      };
      if (objective === 'leads') {
        if (leadFormMode === 'existing' && leadFormId) {
          payload.leadFormId = leadFormId;
        } else {
          payload.newLeadForm = {
            name: leadFormName || name,
            intro: leadFormIntro || undefined,
            privacy_policy_url: privacyUrl || undefined,
            thank_you_url: thankYouUrl || undefined,
            // Map wizard questions to Meta prefill types where possible
            questions: questions.map((q: any) => {
              const label = String(q.label || '').toLowerCase();
              if (label.includes('name')) return { type: 'FULL_NAME' };
              if (label.includes('email')) return { type: 'EMAIL' };
              if (label.includes('phone')) return { type: 'PHONE' };
              return { type: 'CUSTOM', key: label.replace(/[^a-z0-9]+/g, '_').slice(0, 30) || 'q', label: q.label };
            }),
          };
        }
      }

      const { data, error } = await supabase.functions.invoke('meta-launch-campaign', { body: payload });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Launch failed');
      setResult({ campaignId: data.campaignId, adSetId: data.adSetId, leadFormId: data.leadFormId, ads: data.ads || [] });
      setStep(6);
      toast.success('Campaign created on Meta (PAUSED)');
    } catch (e: any) {
      toast.error(e?.message || 'Launch failed');
    } finally {
      setLaunching(false);
    }
  };

  const activateNow = async () => {
    if (!result?.campaignId) return;
    setActivating(true);
    try {
      // Activate campaign + adset + all ads
      const targets = [
        { objectId: result.campaignId },
        { objectId: result.adSetId },
        ...result.ads.map((a) => ({ objectId: a.adId })),
      ];
      for (const t of targets) {
        const { error } = await supabase.functions.invoke('toggle-meta-status', {
          body: { clientId, objectId: t.objectId, status: 'ACTIVE' },
        });
        if (error) throw error;
      }
      toast.success('Campaign is now ACTIVE 🎉');
      close();
    } catch (e: any) {
      toast.error(e?.message || 'Activation failed — flip on in Meta Ads Manager');
    } finally {
      setActivating(false);
    }
  };

  const saveAsBrief = async () => {
    if (!name.trim()) { toast.error('Campaign name required'); return; }
    setUploading(true);
    try {
      const uploaded: { name: string; url: string; type: string }[] = [];
      const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
      const stamp = Date.now();
      for (const file of files) {
        const path = `campaigns/${clientId}/${stamp}-${slug}/${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
        const { error } = await supabase.storage.from('assets').upload(path, file, {
          contentType: file.type, upsert: false,
        });
        if (error) throw error;
        const { data: pub } = supabase.storage.from('assets').getPublicUrl(path);
        uploaded.push({ name: file.name, url: pub.publicUrl, type: file.type });
      }

      const description = [
        `**Launch Brief — ${name}**`,
        `Client: ${clientName}`,
        `Objective: ${objective}`,
        `Daily budget: $${budget}`,
        `\n**Targeting**`,
        `Age: ${ageMin}–${ageMax}`,
        `Gender: ${gender}`,
        `Locations: ${locations || '—'}`,
        `Placements: ${placements}`,
        interests ? `Interests: ${interests}` : null,
        behaviors ? `Behaviors: ${behaviors}` : null,
        customAudiences ? `Custom audiences: ${customAudiences}` : null,
        `\n**Lead Form**`,
        `Name: ${leadFormName || name}`,
        leadFormIntro ? `Intro: ${leadFormIntro}` : null,
        privacyUrl ? `Privacy policy: ${privacyUrl}` : null,
        thankYouUrl ? `Thank-you URL: ${thankYouUrl}` : null,
        `Questions (${questions.length}):`,
        ...questions.map((q, i) => {
          const opts = (q as any).options ? ` [${(q as any).options.join(' | ')}]` : '';
          return `  ${i + 1}. (${q.type}${q.required ? ', required' : ''}) ${q.label}${opts}`;
        }),
        smsVerify ? `\n**SMS Verify:** ENABLED\nMessage template: ${smsVerifyMessage}` : `\n**SMS Verify:** disabled`,
        notes ? `\nNotes:\n${notes}` : null,
        uploaded.length ? `\nCreatives (${uploaded.length}):\n${uploaded.map(u => `- [${u.name}](${u.url})`).join('\n')}` : '\n_No creatives attached — request from creative team._',
      ].filter(Boolean).join('\n');

      const due = new Date(); due.setDate(due.getDate() + 2);
      await createTask.mutateAsync({
        title: `🚀 Launch campaign: ${name}`,
        description,
        client_id: clientId,
        priority: 'high',
        stage: 'todo',
        status: 'todo',
        due_date: due.toISOString().split('T')[0],
      });
      toast.success('Campaign launch brief created for media buyer');
      close();
    } catch (e: any) {
      toast.error(e?.message || 'Failed to create campaign');
    } finally {
      setUploading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) close(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogTitle className="flex items-center gap-2 text-sm font-semibold">
          <Rocket className="h-4 w-4" /> New Campaign
          <Badge variant="outline" className="ml-auto text-[10px]">
            {step === 6 ? 'Review & Activate' : `Step ${step} of 5`}
          </Badge>
        </DialogTitle>

        {step === 1 && (
          <div className="space-y-3">
            <p className="text-[11px] text-muted-foreground">Basics — objective, budget, and name.</p>
            <div>
              <Label className="text-xs">Campaign name</Label>
              <Input value={name} onChange={e => setName(e.target.value)} placeholder="TOF | Offer | Lead Form | CBO" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Objective</Label>
                <Select value={objective} onValueChange={setObjective}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="leads">Leads</SelectItem>
                    <SelectItem value="conversions">Conversions</SelectItem>
                    <SelectItem value="traffic">Traffic</SelectItem>
                    <SelectItem value="awareness">Awareness</SelectItem>
                    <SelectItem value="engagement">Engagement</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Daily budget ($)</Label>
                <Input type="number" value={budget} onChange={e => setBudget(e.target.value)} />
              </div>
            </div>
            <div className="rounded-md border p-3 space-y-2 bg-muted/20">
              <div className="text-[11px] font-medium text-muted-foreground flex items-center gap-2">
                Meta assets {assetsLoading && <Loader2 className="h-3 w-3 animate-spin" />}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-[11px]">Facebook Page</Label>
                  <Select value={pageId} onValueChange={setPageId}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Pick page…" /></SelectTrigger>
                    <SelectContent>
                      {pages.map((p) => <SelectItem key={p.id} value={p.id} className="text-xs">{p.name || p.id}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-[11px]">Instagram (optional)</Label>
                  <Select value={instagramActorId} onValueChange={setInstagramActorId}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="None" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="" className="text-xs">None</SelectItem>
                      {igActors.map((p) => <SelectItem key={p.id} value={p.id} className="text-xs">@{p.username || p.id}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                {objective === 'conversions' && (
                  <>
                    <div>
                      <Label className="text-[11px]">Pixel</Label>
                      <Select value={pixelId} onValueChange={setPixelId}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Pick pixel…" /></SelectTrigger>
                        <SelectContent>
                          {pixels.map((p) => <SelectItem key={p.id} value={p.id} className="text-xs">{p.name || p.id}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-[11px]">Conversion event</Label>
                      <Select value={customEventType} onValueChange={setCustomEventType}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="LEAD" className="text-xs">Lead</SelectItem>
                          <SelectItem value="COMPLETE_REGISTRATION" className="text-xs">Complete Registration</SelectItem>
                          <SelectItem value="PURCHASE" className="text-xs">Purchase</SelectItem>
                          <SelectItem value="SUBSCRIBE" className="text-xs">Subscribe</SelectItem>
                          <SelectItem value="SCHEDULE" className="text-xs">Schedule</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-3">
            <p className="text-[11px] text-muted-foreground">Targeting — age, gender, geo, interests, custom audiences.</p>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label className="text-xs">Age min</Label>
                <Input type="number" min={18} max={65} value={ageMin} onChange={e => setAgeMin(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Age max</Label>
                <Input type="number" min={18} max={65} value={ageMax} onChange={e => setAgeMax(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Gender</Label>
                <Select value={gender} onValueChange={setGender}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="male">Male</SelectItem>
                    <SelectItem value="female">Female</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label className="text-xs">Locations (comma-separated)</Label>
              <Input value={locations} onChange={e => setLocations(e.target.value)} placeholder="United States, Canada" />
            </div>
            <div>
              <Label className="text-xs">Interests (comma-separated)</Label>
              <Textarea value={interests} onChange={e => setInterests(e.target.value)} rows={2}
                placeholder="Real estate investing, Robert Kiyosaki, Grant Cardone, Accredited investor" />
            </div>
            <div>
              <Label className="text-xs">Behaviors (optional)</Label>
              <Input value={behaviors} onChange={e => setBehaviors(e.target.value)} placeholder="Business travelers, Small business owners" />
            </div>
            <div>
              <Label className="text-xs">Custom / Lookalike audiences (optional)</Label>
              <Input value={customAudiences} onChange={e => setCustomAudiences(e.target.value)} placeholder="LAL 1% funded investors, Website visitors 180d" />
            </div>
            <div>
              <Label className="text-xs">Placements</Label>
              <Select value={placements} onValueChange={setPlacements}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="automatic">Automatic (recommended)</SelectItem>
                  <SelectItem value="feed-only">Feed only (FB + IG)</SelectItem>
                  <SelectItem value="stories-reels">Stories + Reels</SelectItem>
                  <SelectItem value="manual">Manual — see notes</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-3">
            <p className="text-[11px] text-muted-foreground">
              {objective === 'leads' ? 'Lead form — use an existing one or build a new one.' : 'Ad copy & destination.'}
            </p>
            {objective === 'leads' && (
              <div className="flex gap-2 text-xs">
                <Button size="sm" variant={leadFormMode === 'existing' ? 'default' : 'outline'} onClick={() => setLeadFormMode('existing')}>
                  Use existing form
                </Button>
                <Button size="sm" variant={leadFormMode === 'new' ? 'default' : 'outline'} onClick={() => setLeadFormMode('new')}>
                  Create new form
                </Button>
              </div>
            )}
            {objective === 'leads' && leadFormMode === 'existing' && (
              <div>
                <Label className="text-xs">Lead form</Label>
                <Select value={leadFormId} onValueChange={setLeadFormId}>
                  <SelectTrigger className="h-9"><SelectValue placeholder={leadForms.length ? 'Pick a form…' : 'No forms — create new instead'} /></SelectTrigger>
                  <SelectContent>
                    {leadForms.map((f) => <SelectItem key={f.id} value={f.id} className="text-xs">{f.name || f.id}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            {objective === 'leads' && leadFormMode === 'new' && (
              <>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Lead form name</Label>
                <Input value={leadFormName} onChange={e => setLeadFormName(e.target.value)} placeholder="Defaults to campaign name" />
              </div>
              <div>
                <Label className="text-xs">Privacy policy URL</Label>
                <Input value={privacyUrl} onChange={e => setPrivacyUrl(e.target.value)} placeholder="https://…/privacy" />
              </div>
            </div>
            <div>
              <Label className="text-xs">Intro / greeting</Label>
              <Textarea value={leadFormIntro} onChange={e => setLeadFormIntro(e.target.value)} rows={2}
                placeholder="Quick 30-second application to see if you qualify." />
            </div>
            <div>
              <Label className="text-xs">Thank-you URL</Label>
              <Input value={thankYouUrl} onChange={e => setThankYouUrl(e.target.value)} placeholder="https://…/thank-you" />
            </div>
            <div className="rounded-md border p-3 bg-muted/30">
              <LeadFormEditor questions={questions} onChange={setQuestions} />
            </div>
            <div className="rounded-md border p-3 flex items-start gap-3">
              <Switch checked={smsVerify} onCheckedChange={setSmsVerify} />
              <div className="flex-1 space-y-2">
                <div>
                  <div className="text-xs font-medium">SMS phone verification</div>
                  <div className="text-[11px] text-muted-foreground">
                    Sends a 6-digit code via SMS after submit. Filters bot/typo leads and improves list quality.
                  </div>
                </div>
                {smsVerify && (
                  <div>
                    <Label className="text-[11px]">Verification SMS template</Label>
                    <Input value={smsVerifyMessage} onChange={e => setSmsVerifyMessage(e.target.value)} className="h-8 text-xs" />
                  </div>
                )}
              </div>
            </div>
              </>
            )}
            {objective !== 'leads' && (
              <div className="space-y-3">
                <div>
                  <Label className="text-xs">Destination URL</Label>
                  <Input value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="https://your-landing-page.com" />
                </div>
                <div>
                  <Label className="text-xs">Call to action</Label>
                  <Select value={ctaType} onValueChange={setCtaType}>
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="LEARN_MORE">Learn More</SelectItem>
                      <SelectItem value="SIGN_UP">Sign Up</SelectItem>
                      <SelectItem value="APPLY_NOW">Apply Now</SelectItem>
                      <SelectItem value="GET_QUOTE">Get Quote</SelectItem>
                      <SelectItem value="CONTACT_US">Contact Us</SelectItem>
                      <SelectItem value="SHOP_NOW">Shop Now</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}
          </div>
        )}

        {step === 4 && (
          <div className="space-y-3">
            <Label className="text-xs">Upload creatives (images / videos)</Label>
            <label className="flex flex-col items-center justify-center gap-2 border-2 border-dashed rounded-lg py-8 cursor-pointer hover:bg-muted/40 transition-colors">
              <Upload className="h-6 w-6 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Click to select files or drag & drop</span>
              <input type="file" multiple hidden accept="image/*,video/*" onChange={e => addFiles(e.target.files)} />
            </label>
            {files.length > 0 && (
              <div className="space-y-1.5 max-h-40 overflow-y-auto">
                {files.map((f, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs p-2 rounded-md bg-muted">
                    {f.type.startsWith('video/') ? <Film className="h-3.5 w-3.5" /> : <ImageIcon className="h-3.5 w-3.5" />}
                    <span className="truncate flex-1">{f.name}</span>
                    <span className="text-muted-foreground">{(f.size / 1024 / 1024).toFixed(1)}MB</span>
                    <button onClick={() => setFiles(prev => prev.filter((_, j) => j !== i))} className="text-muted-foreground hover:text-destructive">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="grid grid-cols-1 gap-2 pt-2">
              <div>
                <Label className="text-xs">Primary text (ad copy)</Label>
                <Textarea value={primaryText} onChange={(e) => setPrimaryText(e.target.value)} rows={3}
                  placeholder="Written for the feed. Hook, promise, CTA." />
              </div>
              <div>
                <Label className="text-xs">Headline</Label>
                <Input value={headline} onChange={(e) => setHeadline(e.target.value)} placeholder="Short, benefit-driven headline" />
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground">One ad per creative will be created inside the ad set.</p>
          </div>
        )}

        {step === 5 && (
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Launch notes / instructions for media buyer</Label>
              <Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={5}
                placeholder="Placements, exclusions, tracking notes, offer URL, etc." />
            </div>
            <div className="rounded-md border p-3 bg-muted/40 text-xs space-y-1">
              <div><span className="text-muted-foreground">Name:</span> <span className="font-medium">{name || '—'}</span></div>
              <div><span className="text-muted-foreground">Objective:</span> {objective} · <span className="text-muted-foreground">Budget:</span> ${budget}/day</div>
              <div><span className="text-muted-foreground">Page:</span> {pages.find((p) => p.id === pageId)?.name || pageId || '—'}
                {objective === 'conversions' && <> · <span className="text-muted-foreground">Pixel:</span> {pixels.find((p) => p.id === pixelId)?.name || pixelId || '—'} ({customEventType})</>}</div>
              <div><span className="text-muted-foreground">Age:</span> {ageMin}–{ageMax} · <span className="text-muted-foreground">Gender:</span> {gender}</div>
              <div><span className="text-muted-foreground">Locations:</span> {locations || '—'}</div>
              {interests && <div><span className="text-muted-foreground">Interests:</span> {interests}</div>}
              {objective === 'leads' && (
                <div><span className="text-muted-foreground">Lead form:</span> {leadFormMode === 'existing' ? (leadForms.find((f) => f.id === leadFormId)?.name || 'existing') : `new — ${questions.length} question${questions.length === 1 ? '' : 's'}`}</div>
              )}
              <div><span className="text-muted-foreground">Creatives:</span> {files.length} file{files.length === 1 ? '' : 's'}</div>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Everything will be created <b>PAUSED</b> on Meta. You'll have a chance to activate it in one click on the next screen.
            </p>
          </div>
        )}

        {step === 6 && result && (
          <div className="space-y-4">
            <div className="rounded-lg border p-4 bg-emerald-50 dark:bg-emerald-950/20 text-sm space-y-2">
              <div className="flex items-center gap-2 font-semibold text-emerald-700 dark:text-emerald-400">
                <CheckCircle2 className="h-4 w-4" /> Created on Meta (PAUSED)
              </div>
              <div className="text-xs space-y-1 text-muted-foreground">
                <div>Campaign: <code className="text-foreground">{result.campaignId}</code></div>
                <div>Ad Set: <code className="text-foreground">{result.adSetId}</code></div>
                <div>Ads: <code className="text-foreground">{result.ads.length}</code></div>
                {result.leadFormId && <div>Lead form: <code className="text-foreground">{result.leadFormId}</code></div>}
              </div>
              <a
                href={`https://adsmanager.facebook.com/adsmanager/manage/campaigns?selected_campaign_ids=${result.campaignId}`}
                target="_blank" rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400 hover:underline"
              >
                Open in Meta Ads Manager <ExternalLink className="h-3 w-3" />
              </a>
            </div>
            <p className="text-xs text-muted-foreground">
              Review it once, then flip the whole thing on with one click. Or leave it paused and activate later from the ads table.
            </p>
          </div>
        )}

        <DialogFooter className="flex-row justify-between sm:justify-between">
          <Button variant="ghost" size="sm" onClick={close}>Cancel</Button>
          <div className="flex gap-2">
            {step > 1 && step < 6 && <Button variant="outline" size="sm" onClick={() => setStep((step - 1) as Step)}>Back</Button>}
            {step < 5 && (
              <Button size="sm" onClick={() => setStep((step + 1) as Step)} disabled={step === 1 && (!name.trim() || !pageId)}>
                Next
              </Button>
            )}
            {step === 5 && (
              <>
                <Button size="sm" variant="outline" onClick={saveAsBrief} disabled={uploading || launching}>
                  {uploading ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : null}
                  Save as brief
                </Button>
                <Button size="sm" onClick={launchToMeta} disabled={launching || uploading}>
                  {launching ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Rocket className="h-3.5 w-3.5 mr-1" />}
                  Launch to Meta (paused)
                </Button>
              </>
            )}
            {step === 6 && (
              <>
                <Button size="sm" variant="outline" onClick={close}>Keep paused</Button>
                <Button size="sm" onClick={activateNow} disabled={activating}>
                  {activating ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Play className="h-3.5 w-3.5 mr-1" />}
                  Activate now
                </Button>
              </>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}