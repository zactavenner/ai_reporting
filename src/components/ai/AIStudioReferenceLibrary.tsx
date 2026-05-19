import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Upload, Trash2, Check, ImagePlus, Sparkles } from "lucide-react";
import { toast } from "sonner";

interface RefImage {
  id: string;
  name: string;
  tags: string[] | null;
  image_url: string;
  storage_path: string | null;
  created_by: string | null;
  created_at: string;
  client_id: string | null;
  source: string | null;
  source_creative_id: string | null;
}

export function AIStudioReferenceLibrary({
  activeIds, onToggle, clientId,
}: {
  activeIds: string[];
  onToggle: (ids: string[]) => void;
  clientId: string;
}) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const { data: refs = [], isLoading } = useQuery({
    queryKey: ["ai_studio_reference_images", clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ai_studio_reference_images" as any)
        .select("*")
        .or(`client_id.is.null,client_id.eq.${clientId}`)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as RefImage[];
    },
  });

  const upload = async (files: FileList | null) => {
    if (!files || !files.length) return;
    setUploading(true);
    try {
      const { data: sess } = await supabase.auth.getUser();
      const userId = sess.user?.id || null;
      for (const file of Array.from(files)) {
        const ext = file.name.split(".").pop() || "png";
        const path = `ai-studio/references/${userId || "anon"}/${crypto.randomUUID()}.${ext}`;
        const { error: upErr } = await supabase.storage.from("creatives").upload(path, file, { contentType: file.type, upsert: false });
        if (upErr) throw upErr;
        const { data: pub } = supabase.storage.from("creatives").getPublicUrl(path);
        const { error: insErr } = await supabase.from("ai_studio_reference_images" as any).insert({
          name: file.name.replace(/\.[^.]+$/, "").slice(0, 80),
          tags: [],
          image_url: pub.publicUrl,
          storage_path: path,
          created_by: userId,
          client_id: null,
          source: 'library',
        });
        if (insErr) throw insErr;
      }
      toast.success(`Uploaded ${files.length} reference${files.length > 1 ? "s" : ""}`);
      qc.invalidateQueries({ queryKey: ["ai_studio_reference_images", clientId] });
    } catch (e: any) {
      toast.error(e?.message || "Upload failed");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const del = useMutation({
    mutationFn: async (r: RefImage) => {
      if (r.storage_path) await supabase.storage.from("creatives").remove([r.storage_path]);
      const { error } = await supabase.from("ai_studio_reference_images" as any).delete().eq("id", r.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Deleted");
      qc.invalidateQueries({ queryKey: ["ai_studio_reference_images", clientId] });
    },
    onError: (e: any) => toast.error(e?.message || "Delete failed"),
  });

  const toggle = (id: string) => {
    const next = activeIds.includes(id) ? activeIds.filter(x => x !== id) : [...activeIds, id];
    onToggle(next);
  };

  const approved = refs.filter(r => r.source === 'approved_creative' && r.client_id === clientId);
  const library = refs.filter(r => !(r.source === 'approved_creative' && r.client_id === clientId));

  const renderThumb = (r: RefImage) => {
    const active = activeIds.includes(r.id);
    return (
      <div key={r.id} className="relative group">
        <button
          type="button"
          onClick={() => toggle(r.id)}
          className={`block w-full aspect-square rounded overflow-hidden border-2 ${active ? "border-primary" : "border-transparent hover:border-muted-foreground/40"}`}
          title={r.name}
        >
          <img src={r.image_url} alt={r.name} className="w-full h-full object-cover" loading="lazy" />
          {active && (
            <div className="absolute top-1 right-1 bg-primary text-primary-foreground rounded-full p-0.5">
              <Check className="h-2.5 w-2.5" />
            </div>
          )}
        </button>
        {/* Hover preview — large floating image */}
        <div className="pointer-events-none absolute z-50 left-1/2 -translate-x-1/2 bottom-full mb-2 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
          <div className="bg-popover border border-border rounded-lg shadow-2xl p-1.5 w-64">
            <img src={r.image_url} alt={r.name} className="w-full h-auto rounded max-h-72 object-contain" />
            <div className="text-[10px] mt-1 px-1 truncate text-muted-foreground">{r.name}</div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => { if (confirm(`Delete "${r.name}" from references?`)) del.mutate(r); }}
          className="absolute bottom-0.5 left-0.5 opacity-0 group-hover:opacity-100 bg-destructive text-destructive-foreground rounded p-0.5"
          title="Delete reference"
        >
          <Trash2 className="h-2.5 w-2.5" />
        </button>
      </div>
    );
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground flex-1">
          Reference library {activeIds.length > 0 && <Badge variant="secondary" className="ml-1 text-[9px]">{activeIds.length} active</Badge>}
        </span>
        <Button size="sm" variant="outline" className="h-7 text-[10px]" disabled={uploading} onClick={() => fileRef.current?.click()}>
          {uploading ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Upload className="h-3 w-3 mr-1" />}
          Upload
        </Button>
        <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => upload(e.target.files)} />
      </div>
      {isLoading ? (
        <div className="text-xs text-muted-foreground flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> loading…</div>
      ) : refs.length === 0 ? (
        <div className="text-xs text-muted-foreground flex items-center gap-1.5 py-3 px-2 rounded border border-dashed">
          <ImagePlus className="h-3.5 w-3.5" /> No references yet — upload images, or approve creatives to auto-add them here for this client.
        </div>
      ) : (
        <>
          {approved.length > 0 && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-emerald-600 dark:text-emerald-400 font-medium">
                <Sparkles className="h-3 w-3" /> Approved for this client
                <Badge variant="secondary" className="text-[9px]">{approved.length}</Badge>
                <span className="text-muted-foreground normal-case font-normal">— auto-used as references for new ads</span>
              </div>
              <div className="grid grid-cols-4 sm:grid-cols-6 gap-1.5 max-h-44 overflow-auto">
                {approved.map(renderThumb)}
              </div>
            </div>
          )}
          {library.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">
                Global library <span className="normal-case font-normal">— shared across all clients</span>
              </div>
              <div className="grid grid-cols-4 sm:grid-cols-6 gap-1.5 max-h-44 overflow-auto">
                {library.map(renderThumb)}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
