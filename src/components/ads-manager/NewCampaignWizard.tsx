import { useState } from 'react';
import { Dialog, DialogContent, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Upload, Rocket, Loader2, X, Image as ImageIcon, Film } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useCreateTask } from '@/hooks/useTasks';
import { toast } from 'sonner';

interface NewCampaignWizardProps {
  open: boolean;
  onClose: () => void;
  clientId: string;
  clientName: string;
}

type Step = 1 | 2 | 3;

export function NewCampaignWizard({ open, onClose, clientId, clientName }: NewCampaignWizardProps) {
  const [step, setStep] = useState<Step>(1);
  const [name, setName] = useState('');
  const [objective, setObjective] = useState('leads');
  const [budget, setBudget] = useState('100');
  const [audience, setAudience] = useState('');
  const [notes, setNotes] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const createTask = useCreateTask();

  const reset = () => {
    setStep(1); setName(''); setObjective('leads'); setBudget('100');
    setAudience(''); setNotes(''); setFiles([]);
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
        audience ? `Audience: ${audience}` : null,
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
      toast.success('Campaign launch task created for media buyer');
      close();
    } catch (e: any) {
      toast.error(e?.message || 'Failed to create campaign');
    } finally {
      setUploading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) close(); }}>
      <DialogContent className="max-w-xl">
        <DialogTitle className="flex items-center gap-2 text-sm font-semibold">
          <Rocket className="h-4 w-4" /> New Campaign
          <Badge variant="outline" className="ml-auto text-[10px]">Step {step} of 3</Badge>
        </DialogTitle>

        {step === 1 && (
          <div className="space-y-3">
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
            <div>
              <Label className="text-xs">Audience (optional)</Label>
              <Input value={audience} onChange={e => setAudience(e.target.value)} placeholder="Accredited investors 35-65, US" />
            </div>
          </div>
        )}

        {step === 2 && (
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

        {step === 3 && (
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Launch notes / instructions for media buyer</Label>
              <Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={5}
                placeholder="Placements, exclusions, tracking notes, offer URL, etc." />
            </div>
            <div className="rounded-md border p-3 bg-muted/40 text-xs space-y-1">
              <div><span className="text-muted-foreground">Name:</span> <span className="font-medium">{name || '—'}</span></div>
              <div><span className="text-muted-foreground">Objective:</span> {objective} · <span className="text-muted-foreground">Budget:</span> ${budget}/day</div>
              {audience && <div><span className="text-muted-foreground">Audience:</span> {audience}</div>}
              <div><span className="text-muted-foreground">Creatives:</span> {files.length} file{files.length === 1 ? '' : 's'}</div>
            </div>
          </div>
        )}

        <DialogFooter className="flex-row justify-between sm:justify-between">
          <Button variant="ghost" size="sm" onClick={close}>Cancel</Button>
          <div className="flex gap-2">
            {step > 1 && <Button variant="outline" size="sm" onClick={() => setStep((step - 1) as Step)}>Back</Button>}
            {step < 3 && <Button size="sm" onClick={() => setStep((step + 1) as Step)} disabled={step === 1 && !name.trim()}>Next</Button>}
            {step === 3 && (
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