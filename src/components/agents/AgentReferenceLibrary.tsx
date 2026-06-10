import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, Upload, ExternalLink, Library } from "lucide-react";
import { toast } from "sonner";

type Kind = "image" | "video" | "pdf" | "doc" | "brand" | "product" | "avatar";
const KINDS: { value: Kind; label: string }[] = [
  { value: "image", label: "Image" },
  { value: "video", label: "Video" },
  { value: "brand", label: "Brand asset" },
  { value: "product", label: "Product shot" },
  { value: "avatar", label: "Avatar" },
  { value: "pdf", label: "PDF" },
  { value: "doc", label: "Doc" },
];

interface Ref {
  id: string;
  kind: string;
  name: string;
  url: string;
  tags: string[] | null;
  notes: string | null;
}

/**
 * Per-agent reference library. Stored in agency_references with a tag of
 * `agent:<agentTag>` so each agent has its own knowledge base of visual
 * references (winning ads, brand assets, proven edit templates, etc.).
 */
export function AgentReferenceLibrary({
  agentTag,
  agentName,
}: {
  agentTag: string;
  agentName: string;
}) {
  const qc = useQueryClient();
  const tagKey = `agent:${agentTag}`;
  const [kind, setKind] = useState<Kind>("image");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [uploading, setUploading] = useState(false);

  const { data: refs = [], isLoading } = useQuery({
    queryKey: ["agent-references", tagKey],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("agency_references" as any)
        .select("id, kind, name, url, tags, notes")
        .contains("tags", [tagKey] as any)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as Ref[];
    },
  });

  const addRef = useMutation({
    mutationFn: async (r: { kind: string; name: string; url: string }) => {
      const { error } = await supabase
        .from("agency_references" as any)
        .insert({ ...r, tags: [tagKey] } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["agent-references", tagKey] });
      setName(""); setUrl("");
      toast.success("Reference added");
    },
    onError: (e: any) => toast.error(e.message || "Failed to add"),
  });

  const deleteRef = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("agency_references" as any).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["agent-references", tagKey] }),
  });

  const handleFileUpload = async (file: File) => {
    setUploading(true);
    try {
      const ext = file.name.split(".").pop();
      const path = `agent-refs/${agentTag}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const { error: upErr } = await supabase.storage.from("assets").upload(path, file, {
        cacheControl: "3600",
        upsert: false,
      });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from("assets").getPublicUrl(path);
      const guessedKind: Kind = file.type.startsWith("video/")
        ? "video"
        : file.type === "application/pdf"
        ? "pdf"
        : "image";
      await addRef.mutateAsync({ kind: guessedKind, name: file.name, url: pub.publicUrl });
    } catch (e: any) {
      toast.error(e.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Library className="h-4 w-4 text-primary" />
        <h4 className="text-sm font-semibold">{agentName} reference library</h4>
        <Badge variant="outline" className="text-[10px] ml-auto">{refs.length} items</Badge>
      </div>
      <p className="text-xs text-muted-foreground">
        Drop in winning ads, brand assets, proven edit templates, or PDFs. This agent will use them as
        visual / contextual inspiration on every run.
      </p>

      {/* Upload row */}
      <div className="grid grid-cols-[110px_1fr_1.5fr_auto] gap-2">
        <Select value={kind} onValueChange={(v) => setKind(v as Kind)}>
          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            {KINDS.map(k => <SelectItem key={k.value} value={k.value} className="text-xs">{k.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input className="h-8 text-xs" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <Input className="h-8 text-xs" placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} />
        <Button
          size="sm"
          className="h-8"
          disabled={!name.trim() || !url.trim() || addRef.isPending}
          onClick={() => addRef.mutate({ kind, name: name.trim(), url: url.trim() })}
        >
          <Plus className="h-3.5 w-3.5 mr-1" /> Add
        </Button>
      </div>

      <div>
        <label className="inline-flex items-center gap-2 text-xs cursor-pointer border border-dashed rounded-md px-3 py-2 hover:border-primary">
          <Upload className="h-3.5 w-3.5" />
          {uploading ? "Uploading…" : "or upload a file"}
          <input
            type="file"
            className="hidden"
            accept="image/*,video/*,.pdf"
            disabled={uploading}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFileUpload(f);
              e.target.value = "";
            }}
          />
        </label>
      </div>

      <ul className="space-y-2 max-h-[420px] overflow-y-auto">
        {isLoading && <li className="text-xs text-muted-foreground">Loading…</li>}
        {!isLoading && refs.length === 0 && (
          <li className="text-xs text-muted-foreground">No references yet for this agent.</li>
        )}
        {refs.map((r) => {
          const isImg = ["image", "avatar", "product", "brand"].includes(r.kind);
          const isVid = r.kind === "video";
          return (
            <li key={r.id} className="flex items-center gap-2 rounded-md border border-border/60 p-2">
              <div className="h-12 w-12 rounded bg-muted overflow-hidden grid place-items-center shrink-0">
                {isImg ? (
                  <img src={r.url} alt={r.name} className="h-full w-full object-cover" />
                ) : isVid ? (
                  <video src={r.url} className="h-full w-full object-cover" muted />
                ) : (
                  <span className="text-[9px] uppercase">{r.kind}</span>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium truncate">{r.name}</div>
                <a href={r.url} target="_blank" rel="noreferrer" className="text-[10px] text-muted-foreground truncate flex items-center gap-1 hover:underline">
                  <ExternalLink className="h-2.5 w-2.5" /> {r.url.slice(0, 70)}
                </a>
              </div>
              <Badge variant="outline" className="text-[9px]">{r.kind}</Badge>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7 text-destructive"
                onClick={() => deleteRef.mutate(r.id)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}