import { useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Plus, Trash2, Sparkles, Save, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  useVideoStyles,
  VideoStyleEditor,
  type VideoStyle,
} from "@/components/ai/VideoStylesManager";

export default function AIStudioStylesPage() {
  const { styles, setStyles, selectedId, setSelectedId, transcribeReference, trainStyle, loading } = useVideoStyles();
  const [activeId, setActiveId] = useState<string>(selectedId !== "none" ? selectedId : (styles[1]?.id ?? "ugc"));
  const [search, setSearch] = useState("");

  const filtered = useMemo(
    () => styles.filter((s) => s.name.toLowerCase().includes(search.toLowerCase())),
    [styles, search],
  );
  const active = styles.find((s) => s.id === activeId) || styles[0];

  function updateActive(next: VideoStyle) {
    const updated = styles.map((s) => (s.id === active.id ? next : s));
    setStyles(updated);
  }

  function createNew() {
    const id = `style-${Date.now()}`;
    const draft: VideoStyle = { id, name: "New Style", prompt: "", references: [] };
    setStyles([...styles, draft]);
    setActiveId(id);
  }

  function deleteActive() {
    if (!active) return;
    if (active.builtIn) { toast.error("Built-in styles can't be deleted (edit instead)."); return; }
    setStyles(styles.filter((s) => s.id !== active.id));
    if (selectedId === active.id) setSelectedId("none");
    setActiveId(styles[1]?.id ?? "ugc");
    toast.success(`Deleted "${active.name}"`);
  }

  async function handleTranscribe(idx: number) {
    if (!active) return;
    await transcribeReference(active, idx);
  }

  async function handleTrain() {
    if (!active) return;
    await trainStyle(active);
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border/60 bg-card/50 backdrop-blur sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-3">
          <Link to="/" className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
            <ArrowLeft className="h-4 w-4" /> Back
          </Link>
          <div className="flex-1">
            <h1 className="text-base font-semibold tracking-tight">Video Style Trainer</h1>
            <p className="text-[11px] text-muted-foreground">
              Upload example clips, auto-transcribe, then let the AI rewrite each style's prompt to match.
            </p>
          </div>
          {loading && <span className="text-[10px] text-muted-foreground">syncing…</span>}
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 py-4 grid grid-cols-12 gap-4">
        {/* Sidebar */}
        <aside className="col-span-12 md:col-span-3 space-y-2">
          <div className="relative">
            <Search className="h-3 w-3 absolute left-2 top-2.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search styles…"
              className="h-8 pl-7 text-xs"
            />
          </div>
          <Button variant="outline" size="sm" className="w-full h-8 text-xs" onClick={createNew}>
            <Plus className="h-3 w-3 mr-1" /> New Style
          </Button>
          <div className="flex flex-col gap-1">
            {filtered.map((s) => {
              const isActive = s.id === active?.id;
              const refCount = (s.references || []).length;
              const trainedCount = (s.references || []).filter((r) => r.transcript).length;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setActiveId(s.id)}
                  className={`text-left rounded-lg border px-2.5 py-2 transition ${
                    isActive
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-card hover:bg-muted/50 border-border/60"
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-medium truncate">{s.name}</span>
                    {s.builtIn && (
                      <Badge variant="secondary" className="text-[9px] h-4">built-in</Badge>
                    )}
                    {s.aiTrainedPrompt && (
                      <Sparkles className={`h-3 w-3 ${isActive ? "text-primary-foreground" : "text-primary"}`} />
                    )}
                  </div>
                  <div className={`text-[10px] mt-0.5 ${isActive ? "text-primary-foreground/80" : "text-muted-foreground"}`}>
                    {refCount} ref{refCount === 1 ? "" : "s"} · {trainedCount} trained
                  </div>
                </button>
              );
            })}
          </div>
        </aside>

        {/* Editor */}
        <main className="col-span-12 md:col-span-9">
          {active ? (
            <div className="rounded-xl border border-border/60 bg-card p-4 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold tracking-tight">{active.name}</h2>
                  <p className="text-[11px] text-muted-foreground">
                    Style ID: <code className="text-[10px]">{active.id}</code>
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant={selectedId === active.id ? "default" : "outline"}
                    size="sm"
                    className="h-8 text-xs"
                    onClick={() => setSelectedId(active.id)}
                  >
                    {selectedId === active.id ? "Active in composer" : "Use in composer"}
                  </Button>
                  {!active.builtIn && (
                    <Button variant="ghost" size="sm" className="h-8 text-xs text-destructive" onClick={deleteActive}>
                      <Trash2 className="h-3 w-3 mr-1" /> Delete
                    </Button>
                  )}
                </div>
              </div>

              <VideoStyleEditor
                style={active}
                onChange={updateActive}
                onTranscribeReference={handleTranscribe}
                onTrain={handleTrain}
              />

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-border/60">
                <Button size="sm" className="h-8 text-xs" onClick={() => toast.success("Saved")}>
                  <Save className="h-3 w-3 mr-1" /> Saved (auto)
                </Button>
              </div>
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">No style selected.</div>
          )}
        </main>
      </div>
    </div>
  );
}