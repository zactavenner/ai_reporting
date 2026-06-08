import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Globe, Sparkles, Plus, X } from 'lucide-react';
import { getOnboardingTemplate, type OnboardingTemplateKey } from '@/lib/onboardingTaskTemplates';
import { seedOnboardingTasksIntoPM } from '@/lib/onboardingTaskSeeder';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';

const addClientSchema = z.object({
  name: z.string().min(1, 'Client name is required').max(100, 'Name must be less than 100 characters'),
  client_type: z.enum(['standard', 'capital']).default('standard'),
  website_url: z.string().url('Must be a valid URL').optional().or(z.literal('')),
  description: z.string().max(1000).optional().or(z.literal('')),
  logo_url: z.string().url('Must be a valid URL').optional().or(z.literal('')),
  kpi_cost_per_lead: z.coerce.number().min(0).optional(),
  kpi_cost_per_call: z.coerce.number().min(0).optional(),
  kpi_cost_per_investor: z.coerce.number().min(0).optional(),
  kpi_cost_of_capital: z.coerce.number().min(0).max(100).optional(),
  slack_webhook_url: z.string().url('Must be a valid URL').optional().or(z.literal('')),
});

type AddClientFormValues = z.infer<typeof addClientSchema>;

interface AddClientModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AddClientModal({ open, onOpenChange }: AddClientModalProps) {
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [websiteInput, setWebsiteInput] = useState('');
  const [brandColors, setBrandColors] = useState<string[]>([]);
  const [brandFonts, setBrandFonts] = useState<string[]>([]);
  const [newColor, setNewColor] = useState('#6366f1');

  const form = useForm<AddClientFormValues>({
    resolver: zodResolver(addClientSchema),
    defaultValues: {
      name: '',
      client_type: 'standard',
      website_url: '',
      description: '',
      logo_url: '',
      kpi_cost_per_lead: undefined,
      kpi_cost_per_call: undefined,
      kpi_cost_per_investor: undefined,
      kpi_cost_of_capital: undefined,
      slack_webhook_url: '',
    },
  });

  const handleAnalyze = async () => {
    if (!websiteInput.trim()) {
      toast.error('Enter a website URL first');
      return;
    }
    setAnalyzing(true);
    try {
      const { data, error } = await supabase.functions.invoke('scrape-brand-info', {
        body: { url: websiteInput.trim() },
      });

      if (error) throw error;

      if (data.company_name) form.setValue('name', data.company_name);
      if (data.description) {
        form.setValue('description', data.description);
        setScrapedDescription(data.description);
      }
      if (data.logo_url) form.setValue('logo_url', data.logo_url);

      // Normalize URL
      let normalizedUrl = websiteInput.trim();
      if (!normalizedUrl.startsWith('http://') && !normalizedUrl.startsWith('https://')) {
        normalizedUrl = `https://${normalizedUrl}`;
      }
      form.setValue('website_url', normalizedUrl);

      if (data.brand_colors?.length) setBrandColors(data.brand_colors);
      if (data.brand_fonts?.length) setBrandFonts(data.brand_fonts);

      toast.success('Website analyzed successfully');
    } catch (err) {
      console.error('Analyze error:', err);
      toast.error('Failed to analyze website');
    } finally {
      setAnalyzing(false);
    }
  };

  // Store scraped description for auto-offer
  const [scrapedDescription, setScrapedDescription] = useState('');

  const onSubmit = async (values: AddClientFormValues) => {
    setSaving(true);
    try {
      const { data: client, error: clientError } = await supabase
        .from('clients')
        .insert({
          name: values.name,
          status: 'active',
          industry: values.client_type === 'capital' ? 'Capital Raising' : null,
          website_url: values.website_url || null,
          description: values.description || null,
          logo_url: values.logo_url || null,
          brand_colors: brandColors.length ? brandColors : [],
          brand_fonts: brandFonts.length ? brandFonts : [],
        } as any)
        .select()
        .single();

      if (clientError) throw clientError;

      // Auto-seed onboarding tasks based on selected client type
      try {
        const templateTasks = getOnboardingTemplate(values.client_type as OnboardingTemplateKey);
        // Seeds into the regular PM tasks system:
        // creates an "Onboarding" project, one parent task per category,
        // and a subtask under each parent for every template item.
        await seedOnboardingTasksIntoPM(client.id, templateTasks);
      } catch (seedErr) {
        console.error('Error seeding onboarding tasks:', seedErr);
      }

      // Create alert configs if KPI thresholds are set
      const alertConfigs = [];
      const webhookUrl = values.slack_webhook_url || null;

      if (values.kpi_cost_per_lead !== undefined && values.kpi_cost_per_lead > 0) {
        alertConfigs.push({
          client_id: client.id, metric: 'cost_per_lead',
          threshold: values.kpi_cost_per_lead, operator: 'above',
          slack_webhook_url: webhookUrl, enabled: true,
        });
      }
      if (values.kpi_cost_per_call !== undefined && values.kpi_cost_per_call > 0) {
        alertConfigs.push({
          client_id: client.id, metric: 'cost_per_call',
          threshold: values.kpi_cost_per_call, operator: 'above',
          slack_webhook_url: webhookUrl, enabled: true,
        });
      }
      if (values.kpi_cost_per_investor !== undefined && values.kpi_cost_per_investor > 0) {
        alertConfigs.push({
          client_id: client.id, metric: 'cost_per_investor',
          threshold: values.kpi_cost_per_investor, operator: 'above',
          slack_webhook_url: webhookUrl, enabled: true,
        });
      }
      if (values.kpi_cost_of_capital !== undefined && values.kpi_cost_of_capital > 0) {
        alertConfigs.push({
          client_id: client.id, metric: 'cost_of_capital',
          threshold: values.kpi_cost_of_capital, operator: 'above',
          slack_webhook_url: webhookUrl, enabled: true,
        });
      }

      if (alertConfigs.length > 0) {
        const { error: alertError } = await supabase.from('alert_configs').insert(alertConfigs);
        if (alertError) console.error('Error creating alert configs:', alertError);
      }

      // Auto-create an offer from scraped website data
      if (scrapedDescription || values.description) {
        try {
          await supabase
            .from('client_offers' as any)
            .insert({
              client_id: client.id,
              title: `${values.name} — Primary Offer`,
              description: scrapedDescription || values.description || null,
              offer_type: 'offer',
              uploaded_by: 'AI Auto-fill',
            } as any);
        } catch (offerErr) {
          console.error('Error auto-creating offer:', offerErr);
        }
      }

      queryClient.invalidateQueries({ queryKey: ['clients'] });
      toast.success(`Client "${values.name}" created successfully`);
      form.reset();
      setBrandColors([]);
      setBrandFonts([]);
      setWebsiteInput('');
      setScrapedDescription('');
      onOpenChange(false);
    } catch (error) {
      console.error('Error creating client:', error);
      toast.error('Failed to create client');
    } finally {
      setSaving(false);
    }
  };

  const handleClose = (open: boolean) => {
    if (!open) {
      form.reset();
      setBrandColors([]);
      setBrandFonts([]);
      setWebsiteInput('');
      setScrapedDescription('');
    }
    onOpenChange(open);
  };

  const addColor = () => {
    if (newColor && !brandColors.includes(newColor)) {
      setBrandColors([...brandColors, newColor]);
    }
  };

  const removeColor = (idx: number) => {
    setBrandColors(brandColors.filter((_, i) => i !== idx));
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl border-2 border-border max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold">New Client</DialogTitle>
          <DialogDescription>
            Create a new client to track their capital raising performance
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6 mt-4">
            {/* Auto-fill with AI */}
            <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Sparkles className="h-4 w-4" />
                Auto-fill with AI
              </div>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Globe className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Enter website URL..."
                    value={websiteInput}
                    onChange={(e) => setWebsiteInput(e.target.value)}
                    className="pl-9"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAnalyze();
                      }
                    }}
                  />
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={handleAnalyze}
                  disabled={analyzing}
                  className="gap-2"
                >
                  <Sparkles className="h-4 w-4" />
                  {analyzing ? 'Analyzing...' : 'Analyze'}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Enter the company website to auto-extract brand info
              </p>
            </div>

            {/* Company Name */}
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="font-semibold">Company Name *</FormLabel>
                  <FormControl>
                    <Input placeholder="Acme Inc." {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Client Type */}
            <FormField
              control={form.control}
              name="client_type"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="font-semibold">Client Type *</FormLabel>
                  <FormControl>
                    <RadioGroup
                      value={field.value}
                      onValueChange={field.onChange}
                      className="grid grid-cols-1 md:grid-cols-2 gap-3"
                    >
                      <label
                        htmlFor="client-type-standard"
                        className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-colors ${
                          field.value === 'standard' ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/40'
                        }`}
                      >
                        <RadioGroupItem value="standard" id="client-type-standard" className="mt-0.5" />
                        <div>
                          <div className="text-sm font-medium">Standard Client</div>
                          <div className="text-xs text-muted-foreground">
                            General agency onboarding (intake → ads → funnel → launch)
                          </div>
                        </div>
                      </label>
                      <label
                        htmlFor="client-type-capital"
                        className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-colors ${
                          field.value === 'capital' ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/40'
                        }`}
                      >
                        <RadioGroupItem value="capital" id="client-type-capital" className="mt-0.5" />
                        <div>
                          <div className="text-sm font-medium">Capital Raising</div>
                          <div className="text-xs text-muted-foreground">
                            Accredited capital SOP — compliance, PPM, investor pipeline
                          </div>
                        </div>
                      </label>
                    </RadioGroup>
                  </FormControl>
                  <FormDescription>
                    Onboarding checklist will auto-populate based on this choice.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Description */}
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="font-semibold">Description</FormLabel>
                  <FormControl>
                    <Textarea placeholder="Brief description of the client..." rows={3} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Logo URL */}
            <FormField
              control={form.control}
              name="logo_url"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="font-semibold">Logo URL</FormLabel>
                  <FormControl>
                    <Input placeholder="https://..." {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Brand Colors */}
            <div className="space-y-2">
              <label className="text-sm font-semibold">Brand Colors</label>
              <div className="flex flex-wrap gap-2 items-center">
                {brandColors.map((color, idx) => (
                  <div key={idx} className="flex items-center gap-1 rounded-md border border-border px-2 py-1">
                    <div
                      className="h-6 w-6 rounded"
                      style={{ backgroundColor: color }}
                    />
                    <span className="text-xs font-mono">{color}</span>
                    <button type="button" onClick={() => removeColor(idx)} className="ml-1 text-muted-foreground hover:text-foreground">
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
                <div className="flex items-center gap-1 rounded-md border border-border px-2 py-1">
                  <input
                    type="color"
                    value={newColor}
                    onChange={(e) => setNewColor(e.target.value)}
                    className="h-6 w-6 rounded cursor-pointer border-0 p-0"
                  />
                  <Input
                    value={newColor}
                    onChange={(e) => setNewColor(e.target.value)}
                    className="h-6 w-24 text-xs font-mono border-0 p-0 shadow-none"
                  />
                  <button type="button" onClick={addColor} className="text-muted-foreground hover:text-foreground">
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>

            {/* Brand Fonts */}
            <div className="space-y-2">
              <label className="text-sm font-semibold">Brand Fonts</label>
              {brandFonts.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {brandFonts.map((font, idx) => (
                    <div key={idx} className="flex items-center gap-1 rounded-md border border-border px-3 py-1">
                      <span className="text-sm">{font}</span>
                      <button
                        type="button"
                        onClick={() => setBrandFonts(brandFonts.filter((_, i) => i !== idx))}
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No fonts set</p>
              )}
            </div>

            <Separator />

            {/* KPI Thresholds */}
            <div className="space-y-4">
              <div>
                <h3 className="font-semibold">KPI Thresholds (Optional)</h3>
                <p className="text-sm text-muted-foreground">
                  Set alert thresholds for key performance indicators
                </p>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <FormField
                  control={form.control}
                  name="kpi_cost_per_lead"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Cost Per Lead</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                          <Input type="number" placeholder="150" className="pl-7" {...field} value={field.value ?? ''} />
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="kpi_cost_per_call"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Cost Per Call</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                          <Input type="number" placeholder="400" className="pl-7" {...field} value={field.value ?? ''} />
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="kpi_cost_per_investor"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Cost Per Investor</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                          <Input type="number" placeholder="5000" className="pl-7" {...field} value={field.value ?? ''} />
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="kpi_cost_of_capital"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Cost of Capital %</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <Input type="number" placeholder="15" className="pr-7" {...field} value={field.value ?? ''} />
                          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">%</span>
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="slack_webhook_url"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Slack Webhook URL (for alerts)</FormLabel>
                    <FormControl>
                      <Input placeholder="https://hooks.slack.com/services/..." {...field} />
                    </FormControl>
                    <FormDescription>
                      Optional: Receive Slack notifications when KPIs exceed thresholds
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="flex justify-end gap-2 pt-4">
              <Button type="button" variant="outline" onClick={() => handleClose(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? 'Creating...' : 'Create'}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
