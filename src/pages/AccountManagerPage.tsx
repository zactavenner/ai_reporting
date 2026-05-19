import { useState, useMemo } from 'react';
import { useClients } from '@/hooks/useClients';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ConstraintDiagnostics } from '@/components/diagnostics/ConstraintDiagnostics';
import { WeeklyReportBuilder } from '@/components/reports/WeeklyReportBuilder';
import { KickOffMeetingPanel } from '@/components/onboarding/KickOffMeetingPanel';
import { WelcomeMessageDialog } from '@/components/onboarding/WelcomeMessageDialog';
import { DecisionLog } from '@/components/clients/DecisionLog';
import { VEO3_TEMPLATES, PLACEHOLDER_GUIDE, renderTemplate, type Veo3Placeholders } from '@/lib/veo3PromptTemplates';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Copy, MessageCircle } from 'lucide-react';
import { toast } from 'sonner';

export function AccountManagerPage() {
  const { data: clients = [] } = useClients();
  const visible = useMemo(
    () => clients.filter((c: any) => ['active', 'onboarding', 'paused'].includes(c.status)),
    [clients],
  );
  const [selectedId, setSelectedId] = useState<string | undefined>(visible[0]?.id);
  const selected = visible.find((c: any) => c.id === selectedId);
  const [welcomeOpen, setWelcomeOpen] = useState(false);

  const [veoId, setVeoId] = useState(VEO3_TEMPLATES[0].id);
  const [values, setValues] = useState<Veo3Placeholders>({});
  const template = VEO3_TEMPLATES.find((t) => t.id === veoId)!;
  const rendered = renderTemplate(template, values);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold">Account Manager Workspace</h2>
        <p className="text-sm text-muted-foreground">
          Run the full Capital Raising fulfillment playbook — diagnostics, weekly reports, kick-off, Veo3 templates.
        </p>
      </div>

      <Card>
        <CardContent className="pt-6 flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[240px]">
            <Label>Client</Label>
            <Select value={selectedId} onValueChange={setSelectedId}>
              <SelectTrigger><SelectValue placeholder="Select a client" /></SelectTrigger>
              <SelectContent>
                {visible.map((c: any) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name} <Badge variant="outline" className="ml-2">{c.status}</Badge>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button variant="outline" onClick={() => setWelcomeOpen(true)} disabled={!selected}>
            <MessageCircle className="h-4 w-4 mr-2" />
            Send Welcome Message
          </Button>
        </CardContent>
      </Card>

      {!selected ? (
        <Card><CardContent className="pt-6 text-sm text-muted-foreground">Select a client to begin.</CardContent></Card>
      ) : (
        <Tabs defaultValue="diagnostics">
          <TabsList>
            <TabsTrigger value="diagnostics">Diagnostics</TabsTrigger>
            <TabsTrigger value="report">Weekly Report</TabsTrigger>
            <TabsTrigger value="kickoff">Kick-Off</TabsTrigger>
            <TabsTrigger value="decisions">Decisions</TabsTrigger>
            <TabsTrigger value="veo3">Veo3 Templates</TabsTrigger>
          </TabsList>

          <TabsContent value="diagnostics" className="mt-4">
            <ConstraintDiagnostics clientId={selected.id} clientName={selected.name} />
          </TabsContent>

          <TabsContent value="report" className="mt-4">
            <WeeklyReportBuilder clientId={selected.id} clientName={selected.name} />
          </TabsContent>

          <TabsContent value="kickoff" className="mt-4">
            <KickOffMeetingPanel clientName={selected.name} />
          </TabsContent>

          <TabsContent value="decisions" className="mt-4">
            <DecisionLog clientId={selected.id} />
          </TabsContent>

          <TabsContent value="veo3" className="mt-4">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Veo3 Capital Raise Templates</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Select value={veoId} onValueChange={setVeoId}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {VEO3_TEMPLATES.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">{template.description}</p>
                  {(Object.keys(PLACEHOLDER_GUIDE) as (keyof Veo3Placeholders)[]).map((k) => (
                    <div key={k}>
                      <Label className="text-xs">{k}</Label>
                      <Input
                        value={values[k] ?? ''}
                        placeholder={PLACEHOLDER_GUIDE[k]}
                        onChange={(e) => setValues((p) => ({ ...p, [k]: e.target.value }))}
                      />
                    </div>
                  ))}
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center justify-between text-base">
                    <span>Filled Prompt</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        const text = rendered.map((s) => `${s.title}\n\nScene:\n${s.scene}\n\nSpoken:\n${s.spokenLine}`).join('\n\n---\n\n');
                        navigator.clipboard.writeText(text);
                        toast.success('Prompt copied');
                      }}
                    >
                      <Copy className="h-4 w-4 mr-1" /> Copy
                    </Button>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {rendered.map((seg, i) => (
                    <div key={i} className="space-y-1">
                      <div className="text-sm font-medium">{seg.title}</div>
                      <div className="text-xs text-muted-foreground whitespace-pre-wrap">{seg.scene}</div>
                      <div className="text-sm italic">"{seg.spokenLine}"</div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      )}

      <WelcomeMessageDialog
        open={welcomeOpen}
        onOpenChange={setWelcomeOpen}
        defaultFirstName={selected?.name?.split(' ')[0]}
      />
    </div>
  );
}