import { useMemo, useState } from "react";
import { Plus, Trash2, Loader2, Play, AlertCircle, CheckCircle2, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useVideoBatch, MODEL_OPTIONS } from "@/hooks/useVideoBatch";

type ScriptDraft = { id: string; title: string; content: string };

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string; Icon: any }> = {
    queued:     { label: "Queued",     cls: "bg-muted text-muted-foreground", Icon: Clock },
    processing: { label: "Generating", cls: "bg-blue-500/15 text-blue-500",   Icon: Loader2 },
    done:       { label: "Done",       cls: "bg-emerald-500/15 text-emerald-500", Icon: CheckCircle2 },
    failed:     { label: "Failed",     cls: "bg-destructive/15 text-destructive", Icon: AlertCircle },
  };
  const { label, cls, Icon } = map[status] || map.queued;
  return (
    <Badge variant="outline" className={`gap-1 ${cls} border-0`}>
      <Icon className={`h-3 w-3 ${status === "processing" ? "animate-spin" : ""}`} /> {label}
    </Badge>
  );
}

export function MultiScriptBatchPanel({ clientId }: { clientId?: string }) {
  const [scripts, setScripts] = useState<ScriptDraft[]>([
    { id: crypto.randomUUID(), title: "Script 1", content: "" },
  ]);
  const [modelId, setModelId] = useState(MODEL_OPTIONS[0].id);
  const model = useMemo(() => MODEL_OPTIONS.find(m => m.id === modelId)!, [modelId]);
  const [duration, setDuration] = useState<number>(model.defaultDuration);
  const [aspect, setAspect] = useState<"9:16" | "1:1" | "16:9">("9:16");
  const [character, setCharacter] = useState("");
  const [offer, setOffer] = useState("");
  const [activeBatchId, setActiveBatchId] = useState<string | null>(null);

  const { job, scripts: batchScripts, scenes, loading, dispatch } = useVideoBatch(activeBatchId);

  const onModelChange = (id: string) => {
    setModelId(id);
    const m = MODEL_OPTIONS.find(x => x.id === id)!;
    setDuration(m.defaultDuration);
  };

  const addScript = () => {
    if (scripts.length >= 10) return;
    setScripts(prev => [...prev, { id: crypto.randomUUID(), title: `Script ${prev.length + 1}`, content: "" }]);
  };
  const removeScript = (id: string) => setScripts(prev => prev.filter(s => s.id !== id));
  const updateScript = (id: string, patch: Partial<ScriptDraft>) =>
    setScripts(prev => prev.map(s => s.id === id ? { ...s, ...patch } : s));

  const handleDispatch = async () => {
    const filled = scripts.filter(s => s.content.trim().length > 5);
    if (!filled.length) return;
    const id = await dispatch({
      scripts: filled.map(s => ({ title: s.title || "Untitled", content: s.content })),
      model: modelId,
      aspectRatio: aspect,
      duration,
      resolution: model.maxRes,
      clientId,
      characterDescription: character || undefined,
      offerDescription: offer || undefined,
    });
    if (id) setActiveBatchId(id);
  };

  const scenesByScript = useMemo(() => {
    const map = new Map<string, typeof scenes>();
    for (const s of scenes) {
      const list = map.get(s.script_id) || [];
      list.push(s);
      map.set(s.script_id, list);
    }
    return map;
  }, [scenes]);

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Multi-Script Video Batch</h2>
          <p className="text-sm text-muted-foreground">Drop up to 10 scripts — each is auto-split into model-sized scenes and rendered in parallel.</p>
        </div>
      </div>

      <Card className="p-4 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Model</label>
            <Select value={modelId} onValueChange={onModelChange}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {MODEL_OPTIONS.map(m => <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Scene duration</label>
            <Select value={String(duration)} onValueChange={(v) => setDuration(Number(v))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {model.durations.map(d => <SelectItem key={d} value={String(d)}>{d}s</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Aspect</label>
            <Select value={aspect} onValueChange={(v) => setAspect(v as any)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="9:16">9:16 (vertical)</SelectItem>
                <SelectItem value="1:1">1:1 (square)</SelectItem>
                <SelectItem value="16:9">16:9 (wide)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Resolution</label>
            <div className="h-9 flex items-center px-3 text-sm text-muted-foreground border rounded-md bg-muted/30">{model.maxRes}</div>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Input placeholder="Character description (optional, applied to every scene)" value={character} onChange={(e) => setCharacter(e.target.value)} />
          <Input placeholder="Offer description (optional)" value={offer} onChange={(e) => setOffer(e.target.value)} />
        </div>
      </Card>

      <div className="space-y-3">
        {scripts.map((s, idx) => (
          <Card key={s.id} className="p-3 space-y-2">
            <div className="flex items-center gap-2">
              <Input
                className="max-w-xs"
                placeholder={`Script ${idx + 1} title`}
                value={s.title}
                onChange={(e) => updateScript(s.id, { title: e.target.value })}
              />
              <Badge variant="secondary">
                ~{Math.max(1, Math.ceil((s.content.trim().split(/\s+/).filter(Boolean).length / 2.5) / duration))} scenes
              </Badge>
              <div className="flex-1" />
              {scripts.length > 1 && (
                <Button variant="ghost" size="icon" onClick={() => removeScript(s.id)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
            <Textarea
              placeholder="Paste the full script. Include explicit duration (e.g. '30 seconds') for best auto-segmentation."
              rows={4}
              value={s.content}
              onChange={(e) => updateScript(s.id, { content: e.target.value })}
            />
          </Card>
        ))}
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={addScript} disabled={scripts.length >= 10}>
            <Plus className="h-4 w-4 mr-1" /> Add script ({scripts.length}/10)
          </Button>
          <div className="flex-1" />
          <Button onClick={handleDispatch} disabled={loading || !scripts.some(s => s.content.trim())}>
            {loading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Play className="h-4 w-4 mr-1" />}
            Generate all
          </Button>
        </div>
      </div>

      {job && (
        <Card className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">Batch {job.id.slice(0, 8)} — {MODEL_OPTIONS.find(m => m.id === job.model)?.label}</div>
              <div className="text-xs text-muted-foreground">
                {job.completed_scenes}/{job.total_scenes} done · {job.failed_scenes} failed · status: {job.status}
              </div>
            </div>
          </div>
          {batchScripts.map(scr => (
            <div key={scr.id} className="space-y-2">
              <div className="text-sm font-medium">{scr.title || `Script ${scr.script_order}`}</div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {(scenesByScript.get(scr.id) || []).map(sc => (
                  <Card key={sc.id} className="p-2 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium">Scene {sc.scene_order}</span>
                      <StatusPill status={sc.status} />
                    </div>
                    {sc.stored_video_url ? (
                      <video src={sc.stored_video_url} controls className="w-full rounded aspect-[9/16] object-cover bg-black" />
                    ) : (
                      <div className="w-full aspect-[9/16] bg-muted rounded flex items-center justify-center text-xs text-muted-foreground">
                        {sc.status === "failed" ? (sc.error || "failed").slice(0, 80) : `${sc.duration}s`}
                      </div>
                    )}
                  </Card>
                ))}
              </div>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}