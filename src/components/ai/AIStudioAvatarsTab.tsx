import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Loader2, Plus, Trash2, Sparkles, UserCircle2, Check, Library, Wand2, BookOpen } from "lucide-react";
import {
  useAvatars,
  useCreateAvatar,
  useDeleteAvatar,
  useCloneStockAvatar,
  useAnalyzeAvatarStyle,
} from "@/hooks/useAvatars";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type Model = "openai" | "nano-banana-pro";

export function AIStudioAvatarsTab({
  clientId,
  clientName,
  selectedAvatarId,
  onSelectAvatar,
}: {
  clientId: string;
  clientName: string;
  selectedAvatarId: string | null;
  onSelectAvatar: (id: string | null) => void;
}) {
  const { data: avatars = [], isLoading, refetch } = useAvatars(clientId);
  const createAvatar = useCreateAvatar();
  const deleteAvatar = useDeleteAvatar();
  const cloneStock = useCloneStockAvatar();
  const analyzeStyle = useAnalyzeAvatarStyle();

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [gender, setGender] = useState("female");
  const [ageRange, setAgeRange] = useState("26-35");
  const [ethnicity, setEthnicity] = useState("caucasian");
  const [style, setStyle] = useState<"ugc" | "professional" | "casual">("ugc");
  const [model, setModel] = useState<Model>("openai");
  const [isStock, setIsStock] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [styleRefIds, setStyleRefIds] = useState<string[]>([]);
  const [useGpt5, setUseGpt5] = useState(true);
  const [analyzingId, setAnalyzingId] = useState<string | null>(null);
  const [cloningId, setCloningId] = useState<string | null>(null);

  const stockAvatars = avatars.filter((a) => a.is_stock);
  const clientAvatars = avatars.filter((a) => !a.is_stock);

  const reset = () => {
    setName(""); setDescription(""); setGender("female"); setAgeRange("26-35");
    setEthnicity("caucasian"); setStyle("ugc"); setModel("openai"); setIsStock(false);
    setStyleRefIds([]); setUseGpt5(true);
  };

  const generate = async () => {
    if (!name.trim()) { toast.error("Give the avatar a name"); return; }
    setGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke("generate-avatar", {
        body: {
          gender, ageRange, ethnicity, style,
          customPrompt: description || undefined,
          model,
          isStock,
          clientId: isStock ? null : clientId,
          realism_level: "ultra-realistic",
          aspectRatio: "3:4",
          useGpt5Enhancer: useGpt5,
          styleReferenceAvatarIds: styleRefIds.length > 0 ? styleRefIds : undefined,
        },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || "Generation failed");
      const created = await createAvatar.mutateAsync({
        client_id: isStock ? undefined : clientId,
        name: name.trim(),
        description: description.trim() || undefined,
        gender, age_range: ageRange, ethnicity,
        style: style as any,
        image_url: data.imageUrl,
        is_stock: isStock,
      });
      toast.success(`Avatar "${created.name}" created`);
      onSelectAvatar(created.id);
      setOpen(false);
      reset();
      refetch();
    } catch (e: any) {
      toast.error(e?.message || "Failed to generate avatar");
    } finally {
      setGenerating(false);
    }
  };

  const handleAssignStock = async (a: any) => {
    setCloningId(a.id);
    try {
      const res = await cloneStock.mutateAsync({ stockAvatarId: a.id, clientId });
      if (res.alreadyAssigned) toast.info(`"${a.name}" is already in this client's library`);
      else toast.success(`Added "${a.name}" to ${clientName}${res.looksCopied ? ` (with ${res.looksCopied} looks)` : ""}`);
    } catch (e: any) {
      toast.error(e?.message || "Failed to assign avatar");
    } finally {
      setCloningId(null);
    }
  };

  const handleLearnStyle = async (a: any) => {
    setAnalyzingId(a.id);
    try {
      await analyzeStyle.mutateAsync({ avatarId: a.id });
      toast.success(`Learned style for "${a.name}"`);
    } catch (e: any) {
      toast.error(e?.message || "Failed to analyze style");
    } finally {
      setAnalyzingId(null);
    }
  };

  const renderGrid = (list: typeof avatars, emptyHint: string) => {
    if (!list.length) {
      return <p className="text-xs text-muted-foreground py-4">{emptyHint}</p>;
    }
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
        {list.map((a) => {
          const active = a.id === selectedAvatarId;
          const styleProfile = (a as any).metadata?.style_profile as Record<string, any> | undefined;
          const vibe = styleProfile?.vibe as string | undefined;
          const isStyleRef = styleRefIds.includes(a.id);
          return (
            <button
              key={a.id}
              type="button"
              onClick={() => onSelectAvatar(active ? null : a.id)}
              className={`group relative rounded-xl overflow-hidden border-2 transition text-left ${active ? "border-primary ring-2 ring-primary/30" : "border-border/60 hover:border-primary/40"}`}
            >
              <div className="aspect-[3/4] bg-muted">
                {a.image_url ? (
                  <img src={a.image_url} alt={a.name} className="w-full h-full object-cover" loading="lazy" />
                ) : (
                  <div className="w-full h-full grid place-items-center"><UserCircle2 className="h-12 w-12 text-muted-foreground" /></div>
                )}
              </div>
              {active && (
                <div className="absolute top-1.5 right-1.5 h-6 w-6 rounded-full bg-primary grid place-items-center">
                  <Check className="h-3.5 w-3.5 text-primary-foreground" />
                </div>
              )}
              {isStyleRef && (
                <div className="absolute top-1.5 left-1.5 rounded-md bg-primary/90 text-primary-foreground text-[9px] px-1.5 py-0.5 font-medium">
                  Style ref
                </div>
              )}
              <div className="p-2">
                <div className="text-xs font-medium truncate">{a.name}</div>
                <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                  {a.gender && <Badge variant="secondary" className="text-[9px] h-4 px-1.5">{a.gender}</Badge>}
                  {a.age_range && <Badge variant="outline" className="text-[9px] h-4 px-1.5">{a.age_range}</Badge>}
                  {vibe && <Badge variant="outline" className="text-[9px] h-4 px-1.5 border-primary/40 text-primary">{vibe}</Badge>}
                </div>
              </div>
              <div className="absolute bottom-1.5 right-1.5 flex gap-1 opacity-0 group-hover:opacity-100 transition">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setStyleRefIds((cur) => cur.includes(a.id) ? cur.filter((x) => x !== a.id) : [...cur, a.id].slice(-3));
                  }}
                  className={`h-6 w-6 rounded-md backdrop-blur grid place-items-center hover:bg-primary hover:text-primary-foreground ${isStyleRef ? "bg-primary text-primary-foreground" : "bg-background/80"}`}
                  title={isStyleRef ? "Remove style reference" : "Use as style reference for next generation"}
                >
                  <Library className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); handleLearnStyle(a); }}
                  disabled={analyzingId === a.id}
                  className="h-6 w-6 rounded-md bg-background/80 backdrop-blur grid place-items-center hover:bg-primary hover:text-primary-foreground disabled:opacity-50"
                  title="Learn this avatar's style with GPT-5 (extract reusable prompt)"
                >
                  {analyzingId === a.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <BookOpen className="h-3 w-3" />}
                </button>
                {a.is_stock ? (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); handleAssignStock(a); }}
                    disabled={cloningId === a.id}
                    className="h-6 w-6 rounded-md bg-background/80 backdrop-blur grid place-items-center hover:bg-primary hover:text-primary-foreground disabled:opacity-50"
                    title={`Add to ${clientName}'s avatar library`}
                  >
                    {cloningId === a.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm(`Delete avatar "${a.name}"?`)) {
                        deleteAvatar.mutate(a.id, { onSuccess: () => toast.success("Avatar deleted") });
                        if (active) onSelectAvatar(null);
                      }
                    }}
                    className="h-6 w-6 rounded-md bg-background/80 backdrop-blur grid place-items-center hover:bg-destructive hover:text-destructive-foreground"
                    title="Delete"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                )}
              </div>
            </button>
          );
        })}
      </div>
    );
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-6xl mx-auto p-4 space-y-4">
        <Card className="p-4 bg-gradient-to-br from-primary/5 to-transparent border-primary/20">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-primary/10 grid place-items-center">
              <UserCircle2 className="h-5 w-5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-semibold">Avatars for {clientName}</h3>
              <p className="text-xs text-muted-foreground">
                Hover any stock avatar → <Plus className="inline h-3 w-3" /> to permanently add it to this client. <BookOpen className="inline h-3 w-3" /> teaches GPT-5 the avatar's visual style. <Library className="inline h-3 w-3" /> marks it as a style reference for the next generation.
              </p>
            </div>
            <Button onClick={() => setOpen(true)} size="sm" className="gap-1.5">
              <Plus className="h-4 w-4" /> Generate avatar
            </Button>
          </div>
          {styleRefIds.length > 0 && (
            <div className="mt-3 flex items-center gap-2 text-[11px] text-primary">
              <Wand2 className="h-3 w-3" />
              <span>{styleRefIds.length} style reference{styleRefIds.length > 1 ? "s" : ""} active for next generation.</span>
              <button type="button" onClick={() => setStyleRefIds([])} className="underline hover:no-underline">Clear</button>
            </div>
          )}
        </Card>

        {isLoading ? (
          <div className="grid place-items-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : (
          <>
            <section className="space-y-2">
              <div className="flex items-center gap-2 px-1">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Client avatars</h4>
                <Badge variant="outline" className="text-[10px]">{clientAvatars.length}</Badge>
              </div>
              {renderGrid(clientAvatars, "No client avatars yet — generate one, or add a stock avatar from below.")}
            </section>

            <section className="space-y-2">
              <div className="flex items-center gap-2 px-1">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Stock avatars</h4>
                <Badge variant="outline" className="text-[10px]">{stockAvatars.length}</Badge>
              </div>
              {renderGrid(stockAvatars, "No stock avatars yet.")}
            </section>
          </>
        )}
      </div>

      <Dialog open={open} onOpenChange={(v) => { if (!generating) setOpen(v); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Sparkles className="h-4 w-4" /> Generate new avatar</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Name *</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sarah - UGC creator" className="h-9" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Model</Label>
                <Select value={model} onValueChange={(v) => setModel(v as Model)}>
                  <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="openai">GPT Image 2 (sharpest)</SelectItem>
                    <SelectItem value="nano-banana-pro">Nano Banana Pro (Gemini 3)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Gender</Label>
                <Select value={gender} onValueChange={setGender}>
                  <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="female">Female</SelectItem>
                    <SelectItem value="male">Male</SelectItem>
                    <SelectItem value="non-binary">Non-binary</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Age</Label>
                <Select value={ageRange} onValueChange={setAgeRange}>
                  <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["18-25", "26-35", "36-45", "46-55", "56-70"].map((a) => (
                      <SelectItem key={a} value={a}>{a}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Style</Label>
                <Select value={style} onValueChange={(v) => setStyle(v as any)}>
                  <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ugc">UGC</SelectItem>
                    <SelectItem value="professional">Professional</SelectItem>
                    <SelectItem value="casual">Casual</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Ethnicity</Label>
              <Input value={ethnicity} onChange={(e) => setEthnicity(e.target.value)} className="h-9" placeholder="e.g. caucasian, hispanic, asian, black" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Description / extra prompt</Label>
              <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder="e.g. warm smile, casual blazer, sunlit kitchen background, holding phone vertically" />
            </div>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input type="checkbox" checked={isStock} onChange={(e) => setIsStock(e.target.checked)} className="h-3.5 w-3.5" />
              Save as stock avatar (shared across all clients)
            </label>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input type="checkbox" checked={useGpt5} onChange={(e) => setUseGpt5(e.target.checked)} className="h-3.5 w-3.5" />
              Enhance prompt with GPT-5 before generation (recommended)
            </label>
            {styleRefIds.length > 0 && (
              <p className="text-[11px] text-primary flex items-center gap-1.5">
                <Wand2 className="h-3 w-3" /> Inheriting style from {styleRefIds.length} reference avatar{styleRefIds.length > 1 ? "s" : ""}.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={generating}>Cancel</Button>
            <Button onClick={generate} disabled={generating || !name.trim()} className="gap-1.5">
              {generating ? <><Loader2 className="h-4 w-4 animate-spin" /> Generating…</> : <><Sparkles className="h-4 w-4" /> Generate</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}