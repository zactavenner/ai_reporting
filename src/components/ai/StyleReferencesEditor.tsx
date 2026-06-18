import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Upload, Trash2, Plus, Image as ImageIcon, Film } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export type StyleReference = {
  url: string;
  name?: string;
  kind: "image" | "video";
};

type Props = {
  kind: "image" | "video";
  value: StyleReference[];
  onChange: (refs: StyleReference[]) => void;
};

/** Per-style reference uploader. Files land in the public `assets` bucket under `style-references/`. */
export function StyleReferencesEditor({ kind, value, onChange }: Props) {
  const refs = value ?? [];
  const [uploading, setUploading] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const accept = kind === "image" ? "image/*" : "video/*";

  async function handleFiles(files: FileList | null) {
    if (!files || !files.length) return;
    setUploading(true);
    try {
      const added: StyleReference[] = [];
      for (const file of Array.from(files)) {
        const ext = file.name.split(".").pop() || (kind === "image" ? "png" : "mp4");
        const path = `style-references/${kind}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const { error } = await supabase.storage.from("assets").upload(path, file, {
          cacheControl: "31536000",
          upsert: false,
          contentType: file.type || undefined,
        });
        if (error) { toast.error(`Upload failed: ${error.message}`); continue; }
        const { data: pub } = supabase.storage.from("assets").getPublicUrl(path);
        added.push({ url: pub.publicUrl, name: file.name, kind });
      }
      if (added.length) {
        onChange([...refs, ...added]);
        toast.success(`Added ${added.length} reference${added.length > 1 ? "s" : ""}`);
      }
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function addUrl() {
    const u = urlInput.trim();
    if (!u) return;
    onChange([...refs, { url: u, kind }]);
    setUrlInput("");
  }

  function remove(idx: number) {
    onChange(refs.filter((_, i) => i !== idx));
  }

  const Icon = kind === "image" ? ImageIcon : Film;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-xs text-muted-foreground inline-flex items-center gap-1">
          <Icon className="h-3 w-3" />
          Reference {kind === "image" ? "images" : "videos"} ({refs.length})
        </label>
        <div className="flex gap-1">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 px-2 text-[10px]"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
          >
            <Upload className="h-3 w-3 mr-1" />
            {uploading ? "Uploading…" : "Upload"}
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept={accept}
            multiple
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
          />
        </div>
      </div>
      <div className="flex gap-1">
        <Input
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          placeholder={`Paste ${kind} URL…`}
          className="h-7 text-xs"
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addUrl(); } }}
        />
        <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-[10px]" onClick={addUrl}>
          <Plus className="h-3 w-3" />
        </Button>
      </div>
      {refs.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {refs.map((r, i) => (
            <div key={`${r.url}-${i}`} className="relative group rounded border border-border/60 overflow-hidden bg-muted/30">
              {kind === "image" ? (
                <img src={r.url} alt={r.name || `ref-${i}`} className="w-full h-20 object-cover" />
              ) : (
                <video src={r.url} className="w-full h-20 object-cover" muted />
              )}
              <button
                type="button"
                onClick={() => remove(i)}
                className="absolute top-1 right-1 p-1 rounded bg-background/80 opacity-0 group-hover:opacity-100 transition"
                title="Remove"
              >
                <Trash2 className="h-3 w-3 text-destructive" />
              </button>
              {r.name && (
                <div className="px-1 py-0.5 text-[9px] truncate text-muted-foreground" title={r.name}>{r.name}</div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function buildReferencesPromptLines(refs: StyleReference[] | undefined, kind: "image" | "video"): string {
  const list = (refs || []).filter((r) => r && r.url);
  if (!list.length) return "";
  const label = kind === "image" ? "REFERENCE IMAGES" : "REFERENCE VIDEOS";
  return `\n${label} (use as visual style guide, match composition/lighting/tone):\n${list.map((r) => `- ${r.url}${r.name ? ` (${r.name})` : ""}`).join("\n")}\n`;
}