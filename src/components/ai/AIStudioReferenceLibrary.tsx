import { useMemo, useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Upload, Trash2, Check, ImagePlus, Sparkles, Trophy, Tags } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
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
  const [importingTop, setImportingTop] = useState(false);
  const [industryFilter, setIndustryFilter] = useState<string>("all");
  const [tagInput, setTagInput] = useState<string>("");

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

  // Surface all `industry:*` tags found across the library.
  const industries = useMemo(() => {
    const set = new Set<string>();
    refs.forEach((r) => (r.tags || []).forEach((t) => {
      if (t.toLowerCase().startsWith("industry:")) set.add(t.slice("industry:".length));
    }));
    return Array.from(set).sort();
  }, [refs]);

  const matchesIndustry = (r: RefImage) => {
    if (industryFilter === "all") return true;
    return (r.tags || []).some((t) => t.toLowerCase() === `industry:${industryFilter.toLowerCase()}`);
  };

  const upload = async (files: FileList | null) => {
    if (!files || !files.length) return;
    setUploading(true);
    try {
      const { data: sess } = await supabase.auth.getUser();
      const userId = sess.user?.id || null;
      const extraTags = tagInput
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      for (const file of Array.from(files)) {
        const ext = file.name.split(".").pop() || "png";
        const path = `ai-studio/references/${userId || "anon"}/${crypto.randomUUID()}.${ext}`;
        const { error: upErr } = await supabase.storage.from("creatives").upload(path, file, { contentType: file.type, upsert: false });
        if (upErr) throw upErr;
        const { data: pub } = supabase.storage.from("creatives").getPublicUrl(path);
        const { error: insErr } = await supabase.from("ai_studio_reference_images" as any).insert({
          name: file.name.replace(/\.[^.]+$/, "").slice(0, 80),
          tags: extraTags,
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
      setTagInput("");
    } catch (e: any) {
      toast.error(e?.message || "Upload failed");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  /**
   * Pull top-performing creatives across all clients into the global
   * reference library, tagged with each client's industry so the agent
   * can use them as cross-client inspiration (e.g. capital raising).
   */
  const importTopPerformers = async () => {
    setImportingTop(true);
    try {
      const { data: sess } = await supabase.auth.getUser();
      const userId = sess.user?.id || null;

      const { data: top, error } = await supabase
        .from("creatives")
        .select("id, title, file_url, ai_performance_score, client_id, clients(industry, name)")
        .not("file_url", "is", null)
        .not("ai_performance_score", "is", null)
        .order("ai_performance_score", { ascending: false })
        .limit(24);
      if (error) throw error;

      const existing = new Set(
        refs.filter((r) => r.source_creative_id).map((r) => r.source_creative_id as string)
      );
      const rows = (top || [])
        .filter((c: any) => !existing.has(c.id) && /\.(png|jpe?g|webp|gif)(\?|$)/i.test(c.file_url || ""))
        .map((c: any) => {
          const industry = c.clients?.industry || "unknown";
          const tags = [`industry:${String(industry).toLowerCase().replace(/\s+/g, "-")}`, "top-performer"];
          return {
            name: (c.title || c.clients?.name || "Top performer").slice(0, 80),
            tags,
            image_url: c.file_url,
            storage_path: null,
            created_by: userId,
            client_id: null,
            source: "top_performer",
            source_creative_id: c.id,
          };
        });
      if (!rows.length) { toast.info("No new top performers to import"); return; }
      const { error: insErr } = await supabase.from("ai_studio_reference_images" as any).insert(rows);
      if (insErr) throw insErr;
      toast.success(`Imported ${rows.length} top performer${rows.length > 1 ? "s" : ""}`);
      qc.invalidateQueries({ queryKey: ["ai_studio_reference_images", clientId] });
    } catch (e: any) {
      toast.error(e?.message || "Import failed");
    } finally {
      setImportingTop(false);
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

  const filtered = refs.filter(matchesIndustry);
  const approved = filtered.filter(r => r.source === 'approved_creative' && r.client_id === clientId);
  const topPerf  = filtered.filter(r => r.source === 'top_performer');
  const library  = filtered.filter(r => !(r.source === 'approved_creative' && r.client_id === clientId) && r.source !== 'top_performer');

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
            {(r.tags || []).length > 0 && (
              <div className="flex flex-wrap gap-0.5 px-1 pb-1">
                {(r.tags || []).slice(0, 4).map((t) => (
                  <Badge key={t} variant="secondary" className="text-[8px] px-1 py-0">{t}</Badge>
                ))}
              </div>
            )}
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
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-medium text-muted-foreground flex-1">
          Reference library {activeIds.length > 0 && <Badge variant="secondary" className="ml-1 text-[9px]">{activeIds.length} active</Badge>}
        </span>
        <Select value={industryFilter} onValueChange={setIndustryFilter}>
          <SelectTrigger className="h-7 w-[160px] text-[11px] rounded-md">
            <SelectValue placeholder="Industry" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All industries</SelectItem>
            {industries.map((i) => (
              <SelectItem key={i} value={i}>{i}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="sm" variant="outline" className="h-7 text-[10px]" disabled={importingTop} onClick={importTopPerformers} title="Pull top scoring creatives across all clients">
          {importingTop ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Trophy className="h-3 w-3 mr-1" />}
          Top performers
        </Button>
        <Button size="sm" variant="outline" className="h-7 text-[10px]" disabled={uploading} onClick={() => fileRef.current?.click()}>
          {uploading ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Upload className="h-3 w-3 mr-1" />}
          Upload
        </Button>
        <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => upload(e.target.files)} />
      </div>
      <div className="flex items-center gap-1.5">
        <Tags className="h-3 w-3 text-muted-foreground" />
        <Input
          value={tagInput}
          onChange={(e) => setTagInput(e.target.value)}
          placeholder="Tags for next upload — e.g. industry:capital-raising, hook:scarcity"
          className="h-7 text-[11px]"
        />
      </div>
      {isLoading ? (
        <div className="text-xs text-muted-foreground flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> loading…</div>
      ) : filtered.length === 0 ? (
        <div className="text-xs text-muted-foreground flex items-center gap-1.5 py-3 px-2 rounded border border-dashed">
          <ImagePlus className="h-3.5 w-3.5" /> No references match this filter — upload images, approve creatives, or pull top performers.
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
          {topPerf.length > 0 && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-amber-600 dark:text-amber-400 font-medium">
                <Trophy className="h-3 w-3" /> Top performers across clients
                <Badge variant="secondary" className="text-[9px]">{topPerf.length}</Badge>
                <span className="text-muted-foreground normal-case font-normal">— ranked by AI performance score, tagged by industry</span>
              </div>
              <div className="grid grid-cols-4 sm:grid-cols-6 gap-1.5 max-h-44 overflow-auto">
                {topPerf.map(renderThumb)}
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
