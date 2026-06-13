import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Loader2, Copy, X, Plus, GitCompare, Check } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const MODEL_PRESETS: { id: string; label: string }[] = [
  { id: "openai/gpt-5", label: "OpenAI GPT-5" },
  { id: "openai/gpt-5-mini", label: "OpenAI GPT-5 Mini" },
  { id: "anthropic/claude-opus-4.1", label: "Claude Opus 4.1" },
  { id: "anthropic/claude-sonnet-4.5", label: "Claude Sonnet 4.5" },
  { id: "x-ai/grok-4", label: "Grok 4" },
  { id: "google/gemini-2.5-pro", label: "Gemini 2.5 Pro" },
  { id: "google/gemini-2.5-flash", label: "Gemini 2.5 Flash" },
  { id: "deepseek/deepseek-chat-v3.1", label: "DeepSeek v3.1" },
  { id: "deepseek/deepseek-chat-v4", label: "DeepSeek v4" },
  { id: "openrouter/owl-alpha", label: "Owl Alpha" },
  { id: "nvidia/nemotron-3-ultra-550b-a55b:free", label: "Nemotron 3 Ultra 550B (free)" },
  { id: "meta-llama/llama-3.3-70b-instruct", label: "Llama 3.3 70B" },
  { id: "mistralai/mistral-large-2411", label: "Mistral Large" },
];

type Result = { model: string; output?: string; error?: string; ms: number; usage?: any };

export function ModelCompareTab() {
  const [prompt, setPrompt] = useState("");
  const [system, setSystem] = useState("");
  const [selected, setSelected] = useState<string[]>(["openai/gpt-5", "anthropic/claude-opus-4.1"]);
  const [custom, setCustom] = useState("");
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<Result[]>([]);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  const toggle = (id: string) => {
    setSelected(s => s.includes(id) ? s.filter(x => x !== id) : (s.length >= 4 ? s : [...s, id]));
  };

  const addCustom = () => {
    const v = custom.trim();
    if (!v) return;
    if (!selected.includes(v) && selected.length < 4) setSelected([...selected, v]);
    setCustom("");
  };

  const run = async () => {
    if (!prompt.trim()) { toast.error("Enter a prompt"); return; }
    if (selected.length < 2) { toast.error("Pick at least 2 models"); return; }
    setRunning(true);
    setResults([]);
    try {
      const { data, error } = await supabase.functions.invoke("compare-models", {
        body: { prompt, system: system || undefined, models: selected },
      });
      if (error) throw error;
      setResults((data as any)?.results || []);
    } catch (e: any) {
      toast.error(e?.message || "Failed to run comparison");
    } finally {
      setRunning(false);
    }
  };

  const copy = async (text: string, idx: number) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedIdx(idx);
      setTimeout(() => setCopiedIdx(null), 1500);
    } catch { toast.error("Copy failed"); }
  };

  return (
    <div className="h-full overflow-auto p-4">
      <div className="max-w-6xl mx-auto space-y-4">
        <div>
          <h3 className="text-base font-semibold flex items-center gap-2"><GitCompare className="h-4 w-4" /> Model Compare</h3>
          <p className="text-xs text-muted-foreground">Run the same prompt across 2–4 models side by side.</p>
        </div>

        <Card className="p-3 space-y-3">
          <div>
            <label className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">System (optional)</label>
            <Input value={system} onChange={e => setSystem(e.target.value)} placeholder="You are a helpful assistant…" className="mt-1" />
          </div>
          <div>
            <label className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">Prompt</label>
            <Textarea value={prompt} onChange={e => setPrompt(e.target.value)} placeholder="Ask anything…" rows={5} className="mt-1 resize-y" />
          </div>
          <div>
            <label className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">Models ({selected.length}/4)</label>
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              {MODEL_PRESETS.map(m => {
                const active = selected.includes(m.id);
                return (
                  <button key={m.id} onClick={() => toggle(m.id)} type="button"
                    className={`text-xs px-2.5 py-1 rounded-full border transition ${active ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-muted border-border"}`}>
                    {m.label}
                  </button>
                );
              })}
            </div>
            {selected.some(s => !MODEL_PRESETS.find(p => p.id === s)) && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {selected.filter(s => !MODEL_PRESETS.find(p => p.id === s)).map(s => (
                  <Badge key={s} variant="secondary" className="gap-1">{s}<button onClick={() => toggle(s)}><X className="h-3 w-3" /></button></Badge>
                ))}
              </div>
            )}
            <div className="flex items-center gap-2 mt-2">
              <Input value={custom} onChange={e => setCustom(e.target.value)} placeholder="custom OpenRouter id (e.g. anthropic/claude-3.7-sonnet)" className="h-8 text-xs" onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCustom(); } }} />
              <Button size="sm" variant="outline" onClick={addCustom}><Plus className="h-3.5 w-3.5 mr-1" /> Add</Button>
            </div>
          </div>
          <div className="flex justify-end">
            <Button onClick={run} disabled={running}>
              {running ? <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Running…</> : <>Run comparison</>}
            </Button>
          </div>
        </Card>

        {results.length > 0 && (
          <div className={`grid gap-3 ${results.length === 2 ? "md:grid-cols-2" : results.length === 3 ? "lg:grid-cols-3" : "md:grid-cols-2 xl:grid-cols-4"}`}>
            {results.map((r, idx) => {
              const label = MODEL_PRESETS.find(p => p.id === r.model)?.label || r.model;
              return (
                <Card key={idx} className="flex flex-col overflow-hidden">
                  <div className="px-3 py-2 border-b flex items-center justify-between gap-2 bg-muted/30">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold truncate">{label}</div>
                      <div className="text-[10px] text-muted-foreground truncate">{r.model} · {(r.ms / 1000).toFixed(1)}s{r.usage?.total_tokens ? ` · ${r.usage.total_tokens} tok` : ""}</div>
                    </div>
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0 shrink-0" onClick={() => copy(r.output || r.error || "", idx)} title="Copy">
                      {copiedIdx === idx ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
                    </Button>
                  </div>
                  <div className="p-3 text-sm whitespace-pre-wrap leading-relaxed max-h-[60vh] overflow-auto">
                    {r.error ? <span className="text-destructive">{r.error}</span> : (r.output || <span className="text-muted-foreground italic">(empty)</span>)}
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default ModelCompareTab;