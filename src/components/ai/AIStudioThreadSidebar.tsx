import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Pin, PinOff, Plus, Trash2, MessageSquare, Pencil, Check, X } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

export type Thread = {
  id: string;
  title: string | null;
  pinned: boolean;
  last_active_at: string;
  chat_model?: string | null;
  last_actor_name?: string | null;
};

interface Props {
  threads: Thread[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onRename: (id: string, title: string) => void;
  onPin: (id: string, pinned: boolean) => void;
  onArchive: (id: string) => void;
}

export function AIStudioThreadSidebar({ threads, activeId, onSelect, onNew, onRename, onPin, onArchive }: Props) {
  const [filter, setFilter] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");

  const filtered = threads.filter(t =>
    !filter.trim() ||
    (t.title || "").toLowerCase().includes(filter.trim().toLowerCase()),
  );
  const pinned = filtered.filter(t => t.pinned);
  const recent = filtered.filter(t => !t.pinned);

  function startEdit(t: Thread) {
    setEditingId(t.id);
    setDraftTitle(t.title || "");
  }
  function commitEdit(id: string) {
    onRename(id, draftTitle.trim() || "Untitled");
    setEditingId(null);
  }

  function ThreadRow({ t }: { t: Thread }) {
    const isActive = t.id === activeId;
    const isEditing = editingId === t.id;
    return (
      <div
        className={cn(
          "group flex items-center gap-1 px-2 py-1.5 rounded-md text-xs cursor-pointer transition",
          isActive ? "bg-primary/15 text-foreground" : "hover:bg-muted/60 text-muted-foreground hover:text-foreground",
        )}
        onClick={() => !isEditing && onSelect(t.id)}
      >
        <MessageSquare className="h-3 w-3 shrink-0 opacity-70" />
        {isEditing ? (
          <>
            <Input
              autoFocus
              value={draftTitle}
              onChange={e => setDraftTitle(e.target.value)}
              onClick={e => e.stopPropagation()}
              onKeyDown={e => {
                if (e.key === "Enter") { e.preventDefault(); commitEdit(t.id); }
                if (e.key === "Escape") { e.preventDefault(); setEditingId(null); }
              }}
              className="h-6 text-xs px-1.5"
            />
            <button onClick={(e) => { e.stopPropagation(); commitEdit(t.id); }} className="p-0.5"><Check className="h-3 w-3" /></button>
            <button onClick={(e) => { e.stopPropagation(); setEditingId(null); }} className="p-0.5"><X className="h-3 w-3" /></button>
          </>
        ) : (
          <>
            <div className="flex-1 min-w-0">
              <div className="truncate">{t.title || "Untitled"}</div>
              {t.last_actor_name && (
                <div className="truncate text-[9px] text-muted-foreground/70 leading-tight">
                  last by {t.last_actor_name}
                </div>
              )}
            </div>
            <div className="hidden group-hover:flex items-center gap-0.5">
              <button title="Rename" onClick={(e) => { e.stopPropagation(); startEdit(t); }} className="p-0.5 hover:text-foreground"><Pencil className="h-3 w-3" /></button>
              <button title={t.pinned ? "Unpin" : "Pin"} onClick={(e) => { e.stopPropagation(); onPin(t.id, !t.pinned); }} className="p-0.5 hover:text-foreground">
                {t.pinned ? <PinOff className="h-3 w-3" /> : <Pin className="h-3 w-3" />}
              </button>
              <button title="Archive" onClick={(e) => { e.stopPropagation(); onArchive(t.id); }} className="p-0.5 hover:text-destructive"><Trash2 className="h-3 w-3" /></button>
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-muted/20 border-r border-border/60">
      <div className="px-2 pt-2 pb-1.5 space-y-1.5">
        <Button onClick={onNew} size="sm" className="w-full h-8 text-xs gap-1.5">
          <Plus className="h-3.5 w-3.5" /> New chat
        </Button>
        <Input
          value={filter}
          onChange={e => setFilter(e.target.value)}
          placeholder="Search threads…"
          className="h-7 text-xs"
        />
      </div>
      <ScrollArea className="flex-1 px-1.5">
        {pinned.length > 0 && (
          <div className="mb-2">
            <div className="px-2 pt-1 pb-0.5 text-[9px] uppercase tracking-wide text-muted-foreground/70">Pinned</div>
            {pinned.map(t => <ThreadRow key={t.id} t={t} />)}
          </div>
        )}
        {recent.length > 0 && (
          <div>
            <div className="px-2 pt-1 pb-0.5 text-[9px] uppercase tracking-wide text-muted-foreground/70">Recent</div>
            {recent.map(t => <ThreadRow key={t.id} t={t} />)}
          </div>
        )}
        {filtered.length === 0 && (
          <div className="px-3 py-6 text-center text-[11px] text-muted-foreground">No threads yet</div>
        )}
      </ScrollArea>
    </div>
  );
}