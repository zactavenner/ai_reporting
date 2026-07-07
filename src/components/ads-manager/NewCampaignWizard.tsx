import { useState } from 'react';
import { Dialog, DialogContent, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Upload, Rocket, Loader2, X, Image as ImageIcon, Film } from 'lucide-react';
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

type Step = 1 | 2 | 3 | 4 | 5;

export function NewCampaignWizard({ open, onClose, clientId, clientName }: NewCampaignWizardProps) {
  const [step, setStep] = useState<Step>(1);
  const [name, setName] = useState('');
  const [objective, setObjective] = useState('leads');
  const [budget, setBudget] = useState('100');
  const [notes, setNotes] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
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
    setStep(1); setName(''); setObjective('leads'); setBudget('100');
    setNotes(''); setFiles([]);
    setAgeMin('30'); setAgeMax('65'); setGender('all'); setLocations('United States');
    setInterests(''); setBehaviors(''); setCustomAudiences(''); setPlacements('automatic');
    setLeadFormName(''); setLeadFormIntro(''); setPrivacyUrl(''); setThankYouUrl('');
    setQuestions(DEFAULT_LEAD_FORM_QUESTIONS); setSmsVerify(false);
  };
  const close = () => { reset(); onClose(); };

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    setFiles((prev) => [...prev, ...Array.from(list)]);
  };

  const launch = async () => {
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
          <Badge variant="outline" className="ml-auto text-[10px]">Step {step} of 5</Badge>
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
            <p className="text-[11px] text-muted-foreground">Lead form — questions, privacy, and optional SMS verify.</p>
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
            <p className="text-[11px] text-muted-foreground">Files upload to your creative library and get attached to the launch brief.</p>
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
              <div><span className="text-muted-foreground">Age:</span> {ageMin}–{ageMax} · <span className="text-muted-foreground">Gender:</span> {gender}</div>
              <div><span className="text-muted-foreground">Locations:</span> {locations || '—'}</div>
              {interests && <div><span className="text-muted-foreground">Interests:</span> {interests}</div>}
              <div><span className="text-muted-foreground">Lead form:</span> {questions.length} question{questions.length === 1 ? '' : 's'} · SMS verify {smsVerify ? 'ON' : 'off'}</div>
              <div><span className="text-muted-foreground">Creatives:</span> {files.length} file{files.length === 1 ? '' : 's'}</div>
            </div>
          </div>
        )}

        <DialogFooter className="flex-row justify-between sm:justify-between">
          <Button variant="ghost" size="sm" onClick={close}>Cancel</Button>
          <div className="flex gap-2">
            {step > 1 && <Button variant="outline" size="sm" onClick={() => setStep((step - 1) as Step)}>Back</Button>}
            {step < 5 && <Button size="sm" onClick={() => setStep((step + 1) as Step)} disabled={step === 1 && !name.trim()}>Next</Button>}
            {step === 5 && (
              <Button size="sm" onClick={launch} disabled={uploading}>
                {uploading ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Rocket className="h-3.5 w-3.5 mr-1" />}
                Launch
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}