import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Loader2, Plus, Star, Trash2, Zap, ShieldCheck } from 'lucide-react';
import {
  useAgencyPersonas,
  useSaveAgencyPersona,
  useSetDefaultPersona,
  useDeleteAgencyPersona,
  useTestAgencyPersona,
  type AgencyPersona,
} from '@/hooks/useAgencyPersonas';

type Draft = {
  id?: string;
  name: string;
  slug: string;
  description: string;
  mcp_url: string;
  is_active: boolean;
  is_default: boolean;
};

const emptyDraft: Draft = {
  name: '',
  slug: '',
  description: '',
  mcp_url: '',
  is_active: true,
  is_default: false,
};

export function AgencyPersonasTab() {
  const { data: personas = [], isLoading, error } = useAgencyPersonas();
  const save = useSaveAgencyPersona();
  const setDefault = useSetDefaultPersona();
  const remove = useDeleteAgencyPersona();
  const test = useTestAgencyPersona();

  const [draft, setDraft] = useState<Draft | null>(null);
  const [testResult, setTestResult] = useState<{ slug: string; reply: string } | null>(null);

  const startEdit = (p: AgencyPersona) =>
    setDraft({
      id: p.id,
      name: p.name,
      slug: p.slug,
      description: p.description || '',
      mcp_url: '',
      is_active: p.is_active,
      is_default: p.is_default,
    });

  const submit = async () => {
    if (!draft) return;
    await save.mutateAsync({
      id: draft.id,
      name: draft.name,
      slug: draft.slug || undefined,
      description: draft.description || null,
      mcp_url: draft.mcp_url.trim() || undefined,
      is_active: draft.is_active,
      is_default: draft.is_default,
    });
    setDraft(null);
  };

  const runTest = async (slug: string) => {
    setTestResult(null);
    const r = await test.mutateAsync(slug);
    setTestResult({ slug, reply: r.reply });
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle className="text-base">Agency personas</CardTitle>
            <CardDescription>
              Persona endpoints power the <strong>Jeremy AI</strong> chat. Each Jeremy AI thread can pick
              any active persona here — no code change needed to add or rotate one.
            </CardDescription>
          </div>
          <Button size="sm" onClick={() => setDraft({ ...emptyDraft })} className="gap-2 shrink-0">
            <Plus className="h-4 w-4" />
            Add persona
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
            <ShieldCheck className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
            <span>
              Endpoint URLs contain an access token and are stored server-side only. This screen shows the
              endpoint host; the token is never sent back to the browser. Leave the endpoint field empty when
              editing to keep the stored one.
            </span>
          </div>

          {isLoading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading personas…
            </div>
          )}
          {error && (
            <p className="text-sm text-destructive">
              {(error as any)?.message || 'Could not load personas — sign in as an agency admin.'}
            </p>
          )}
          {!isLoading && !error && personas.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No personas configured yet. Jeremy AI chat stays disabled until one is added.
            </p>
          )}

          {personas.map((p) => (
            <div key={p.id} className="rounded-lg border border-border p-3 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-sm">{p.name}</span>
                <Badge variant="outline" className="text-[10px] font-mono">@{p.slug}</Badge>
                {p.is_default && (
                  <Badge className="text-[10px] gap-1"><Star className="h-3 w-3" />Default</Badge>
                )}
                {!p.is_active && <Badge variant="secondary" className="text-[10px]">Inactive</Badge>}
                <span className="ml-auto text-xs text-muted-foreground font-mono">
                  {p.mcp_host || 'no endpoint'}{p.has_token ? ' · token set' : ' · no token'}
                </span>
              </div>
              {p.description && <p className="text-xs text-muted-foreground">{p.description}</p>}
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => startEdit(p)}>Edit</Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1"
                  disabled={test.isPending}
                  onClick={() => runTest(p.slug)}
                >
                  {test.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
                  Test
                </Button>
                {!p.is_default && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1"
                    disabled={setDefault.isPending}
                    onClick={() => setDefault.mutate(p.id)}
                  >
                    <Star className="h-3 w-3" />
                    Make default
                  </Button>
                )}
                {!p.is_default && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="gap-1 text-destructive"
                    disabled={remove.isPending}
                    onClick={() => remove.mutate(p.id)}
                  >
                    <Trash2 className="h-3 w-3" />
                    Remove
                  </Button>
                )}
              </div>
              {testResult?.slug === p.slug && (
                <div className="rounded-md bg-muted/60 p-2 text-xs whitespace-pre-wrap">
                  <span className="font-medium">Reply:</span> {testResult.reply}
                </div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      {draft && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{draft.id ? 'Edit persona' : 'New persona'}</CardTitle>
            <CardDescription>
              Paste the persona MCP endpoint (https, including its access key query param).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>Name</Label>
                <Input
                  value={draft.name}
                  placeholder="Jeremy (Utari)"
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label>Slug</Label>
                <Input
                  value={draft.slug}
                  placeholder="jeremy"
                  className="font-mono text-sm"
                  onChange={(e) => setDraft({ ...draft, slug: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Endpoint URL {draft.id && <span className="text-muted-foreground text-xs">(leave blank to keep)</span>}</Label>
              <Input
                type="password"
                value={draft.mcp_url}
                placeholder="https://persona-mcp.example.ai/mcp/?k=…"
                className="font-mono text-sm"
                onChange={(e) => setDraft({ ...draft, mcp_url: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label>Description</Label>
              <Textarea
                rows={2}
                value={draft.description}
                placeholder="Who this persona is and when to use it."
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              />
            </div>
            <div className="flex flex-wrap items-center gap-6">
              <div className="flex items-center gap-2">
                <Switch
                  checked={draft.is_active}
                  onCheckedChange={(v) => setDraft({ ...draft, is_active: v })}
                />
                <Label className="text-sm">Active</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={draft.is_default}
                  onCheckedChange={(v) => setDraft({ ...draft, is_default: v })}
                />
                <Label className="text-sm">Default for Jeremy AI</Label>
              </div>
            </div>
            <div className="flex gap-2">
              <Button onClick={submit} disabled={save.isPending || !draft.name.trim()}>
                {save.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Save persona
              </Button>
              <Button variant="ghost" onClick={() => setDraft(null)}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
