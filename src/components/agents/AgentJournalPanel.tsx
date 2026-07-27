import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BookOpen, Copy, Sparkles, Plus, Trash2, ChevronDown, ChevronRight, Loader2, Download } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { toast } from "sonner";
import {
  useAgentJournal,
  useAddJournalNote,
  useDeleteJournalEntry,
  useReflectAgent,
  type JournalEntry,
} from "@/hooks/useAgentJournal";

const TYPE_COLORS: Record<JournalEntry["entry_type"], string> = {
  run: "bg-blue-500/15 text-blue-600 border-blue-500/30",
  reflection: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30",
  lesson: "bg-amber-500/15 text-amber-600 border-amber-500/30",
  note: "bg-muted text-muted-foreground",
};

export function AgentJournalPanel({
  clientId,
  agentId,
  agentName,
  clientName,
}: {
  clientId: string;
  agentId: string;
  agentName: string;
  clientName?: string;
}) {
  const { data: entries = [], isLoading } = useAgentJournal(clientId, agentId);
  const addNote = useAddJournalNote();
  const del = useDeleteJournalEntry();
  const reflect = useReflectAgent();

  const [filter, setFilter] = useState<"all" | "run" | "reflection" | "lesson" | "note">("all");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [addingNote, setAddingNote] = useState(false);
  const [noteTitle, setNoteTitle] = useState("");
  const [noteBody, setNoteBody] = useState("");
  const [window, setWindow] = useState<"1" | "7" | "30">("7");

  const filtered = useMemo(
    () => entries.filter((e) => filter === "all" || e.entry_type === filter),
    [entries, filter],
  );

  const toggle = (id: string) => {
    setExpanded((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };

  const copyEntry = async (e: JournalEntry) => {
    const md = `# ${e.title}\n_${new Date(e.created_at).toLocaleString()} · ${e.entry_type} · ${e.scope}_\n\n${e.body_md}`;
    await navigator.clipboard.writeText(md);
    toast.success("Copied to clipboard");
  };

  const copyAll = async () => {
    const md = filtered
      .map((e) => `# ${e.title}\n_${new Date(e.created_at).toLocaleString()} · ${e.entry_type} · ${e.scope}_\n\n${e.body_md}`)
      .join("\n\n---\n\n");
    await navigator.clipboard.writeText(md);
    toast.success(`Copied ${filtered.length} entries`);
  };

  const downloadAll = () => {
    const md = `# ${agentName} journal — ${clientName || "client"}\n_${filtered.length} entries · exported ${new Date().toLocaleString()}_\n\n` +
      filtered.map((e) => `## ${e.title}\n_${new Date(e.created_at).toLocaleString()} · ${e.entry_type} · ${e.scope}_\n\n${e.body_md}`).join("\n\n---\n\n");
    const blob = new Blob([md], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${agentName.toLowerCase().replace(/\s+/g, "-")}-${clientName?.toLowerCase().replace(/\s+/g, "-") || "client"}-journal.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const counts = useMemo(() => {
    const c = { run: 0, reflection: 0, lesson: 0, note: 0 };
    entries.forEach((e) => (c[e.entry_type] += 1));
    return c;
  }, [entries]);

  return (
    <Card className="p-4 space-y-3 border-primary/30">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-primary" />
          <p className="text-sm font-semibold">Journal & self-improvement</p>
          <Badge variant="secondary" className="text-[10px]">{entries.length} entries</Badge>
        </div>
        <div className="flex items-center gap-1">
          <Select value={window} onValueChange={(v: any) => setWindow(v)}>
            <SelectTrigger className="h-7 text-[11px] w-[110px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="1" className="text-xs">Last 1 day</SelectItem>
              <SelectItem value="7" className="text-xs">Last 7 days</SelectItem>
              <SelectItem value="30" className="text-xs">Last 30 days</SelectItem>
            </SelectContent>
          </Select>
          <Button
            size="sm"
            variant="default"
            className="h-7 text-[11px]"
            disabled={reflect.isPending || entries.length === 0}
            onClick={() => reflect.mutate({ client_id: clientId, agent_id: agentId, window_days: parseInt(window) })}
          >
            {reflect.isPending ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Sparkles className="h-3 w-3 mr-1" />}
            Reflect & improve
          </Button>
        </div>
      </div>

      <p className="text-[11px] text-muted-foreground">
        Every chat and scheduled run for <strong>{agentName}</strong> on <strong>{clientName || "this client"}</strong> is
        appended here as markdown. Reflect distills recent entries into new rules and appends them to this client's memory —
        so the agent gets smarter each cycle.
      </p>

      <div className="flex items-center gap-2 flex-wrap">
        {(["all", "run", "reflection", "lesson", "note"] as const).map((k) => (
          <button
            key={k}
            onClick={() => setFilter(k)}
            className={`text-[10px] px-2 py-0.5 rounded-full border transition ${
              filter === k ? "bg-primary text-primary-foreground border-primary" : "hover:bg-muted"
            }`}
          >
            {k} {k !== "all" && <span className="opacity-70">· {counts[k]}</span>}
          </button>
        ))}
        <div className="flex-1" />
        <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => setAddingNote((v) => !v)}>
          <Plus className="h-3 w-3 mr-1" /> Note
        </Button>
        <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={copyAll} disabled={filtered.length === 0}>
          <Copy className="h-3 w-3 mr-1" /> Copy all
        </Button>
        <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={downloadAll} disabled={filtered.length === 0}>
          <Download className="h-3 w-3 mr-1" /> Export .md
        </Button>
      </div>

      {addingNote && (
        <div className="space-y-1.5 rounded-md border p-2 bg-muted/30">
          <Input value={noteTitle} onChange={(e) => setNoteTitle(e.target.value)} placeholder="Note title…" className="h-7 text-xs" />
          <Textarea value={noteBody} onChange={(e) => setNoteBody(e.target.value)} rows={3} placeholder="Markdown note — this becomes part of the agent's history…" className="text-xs font-mono" />
          <div className="flex items-center justify-end gap-1">
            <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => setAddingNote(false)}>Cancel</Button>
            <Button
              size="sm"
              className="h-6 text-[10px]"
              disabled={!noteTitle.trim() || !noteBody.trim() || addNote.isPending}
              onClick={() =>
                addNote.mutate(
                  { client_id: clientId, agent_id: agentId, title: noteTitle.trim(), body_md: noteBody.trim() },
                  {
                    onSuccess: () => {
                      setNoteTitle("");
                      setNoteBody("");
                      setAddingNote(false);
                    },
                  },
                )
              }
            >
              Save note
            </Button>
          </div>
        </div>
      )}

      <div className="space-y-1.5 max-h-[420px] overflow-y-auto">
        {isLoading && <p className="text-[11px] text-muted-foreground py-2">Loading journal…</p>}
        {!isLoading && filtered.length === 0 && (
          <p className="text-[11px] text-muted-foreground py-4 text-center">
            No entries yet. Chat with the agent, run its schedule, or add a note — history appears here.
          </p>
        )}
        {filtered.map((e) => {
          const open = expanded.has(e.id);
          return (
            <div key={e.id} className="rounded-md border bg-background">
              <div className="flex items-center gap-1.5 px-2 py-1.5">
                <button onClick={() => toggle(e.id)} className="text-muted-foreground shrink-0">
                  {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                </button>
                <Badge variant="outline" className={`text-[9px] shrink-0 ${TYPE_COLORS[e.entry_type]}`}>
                  {e.entry_type}
                </Badge>
                <button onClick={() => toggle(e.id)} className="flex-1 min-w-0 text-left">
                  <p className="text-xs font-medium truncate">{e.title}</p>
                </button>
                <span className="text-[10px] text-muted-foreground shrink-0">
                  {new Date(e.created_at).toLocaleDateString()} {new Date(e.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </span>
                <Button size="icon" variant="ghost" className="h-5 w-5" onClick={() => copyEntry(e)} title="Copy">
                  <Copy className="h-3 w-3" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-5 w-5 text-destructive"
                  onClick={() => del.mutate({ id: e.id, client_id: clientId, agent_id: agentId })}
                  title="Delete"
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
              {open && (
                <div className="border-t px-3 py-2 prose prose-sm dark:prose-invert max-w-none text-xs [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1 [&_h1]:text-sm [&_h2]:text-xs [&_h3]:text-xs">
                  <ReactMarkdown>{e.body_md}</ReactMarkdown>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}