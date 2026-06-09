import { useEffect, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, User, Package, FileText, Plus, Check } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export type VideoReference =
  | { kind: "avatar"; id: string; name: string; url: string }
  | { kind: "product"; id: string; name: string; url: string }
  | { kind: "pdf"; id: string; name: string; url: string };

export function AIStudioReferencePicker({
  clientId,
  selected,
  onChange,
}: {
  clientId: string;
  selected: VideoReference[];
  onChange: (refs: VideoReference[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [avatars, setAvatars] = useState<VideoReference[]>([]);
  const [products, setProducts] = useState<VideoReference[]>([]);
  const [pdfs, setPdfs] = useState<VideoReference[]>([]);

  useEffect(() => {
    if (!open || !clientId) return;
    setLoading(true);
    (async () => {
      try {
        const [avRes, prRes, ofRes] = await Promise.all([
          supabase
            .from("avatars")
            .select("id, name, image_url, base_image_url, is_stock")
            .or(`client_id.eq.${clientId},is_stock.eq.true`)
            .eq("is_active", true)
            .limit(60),
          supabase
            .from("client_assets")
            .select("id, title, content, asset_type")
            .eq("client_id", clientId)
            .in("asset_type", ["static_ad", "product", "scene_image", "image"])
            .order("created_at", { ascending: false })
            .limit(60),
          supabase
            .from("client_offer_files")
            .select("id, file_url, file_name, file_type")
            .eq("client_id", clientId)
            .order("created_at", { ascending: false })
            .limit(60),
        ]);

        setAvatars(
          ((avRes.data ?? []) as any[])
            .map((a) => ({
              kind: "avatar" as const,
              id: a.id,
              name: a.name || (a.is_stock ? "Stock avatar" : "Avatar"),
              url: (a.image_url || a.base_image_url) as string,
            }))
            .filter((r) => !!r.url),
        );

        setProducts(
          ((prRes.data ?? []) as any[])
            .map((a) => {
              const url = (a.content?.image_url || a.content?.url || a.content?.file_url) as string | undefined;
              return url ? ({ kind: "product", id: a.id, name: a.title || "Asset", url } as VideoReference) : null;
            })
            .filter((x): x is VideoReference => x !== null),
        );

        setPdfs(
          ((ofRes.data ?? []) as any[])
            .filter((f) => /pdf/i.test(f.file_type || "") || /\.pdf($|\?)/i.test(f.file_url || ""))
            .map((f) => ({
              kind: "pdf" as const,
              id: f.id,
              name: f.file_name || "PDF",
              url: f.file_url,
            })),
        );
      } finally {
        setLoading(false);
      }
    })();
  }, [open, clientId]);

  const isSelected = (r: VideoReference) => selected.some((s) => s.kind === r.kind && s.id === r.id);
  const toggle = (r: VideoReference) => {
    if (isSelected(r)) onChange(selected.filter((s) => !(s.kind === r.kind && s.id === r.id)));
    else onChange([...selected, r]);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-[10px] gap-1 rounded-lg hover:bg-muted"
          title="Attach an avatar, product, or PDF for the next message / video"
        >
          <Plus className="h-3 w-3" /> Refs
          {selected.length > 0 && <Badge variant="secondary" className="text-[9px] h-4 px-1">{selected.length}</Badge>}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[380px] p-0">
        <Tabs defaultValue="avatars">
          <div className="px-2 pt-2">
            <TabsList className="grid grid-cols-3 h-8">
              <TabsTrigger value="avatars" className="text-xs gap-1"><User className="h-3 w-3" /> Avatars</TabsTrigger>
              <TabsTrigger value="products" className="text-xs gap-1"><Package className="h-3 w-3" /> Products</TabsTrigger>
              <TabsTrigger value="pdfs" className="text-xs gap-1"><FileText className="h-3 w-3" /> PDFs</TabsTrigger>
            </TabsList>
          </div>
          {loading && (
            <div className="p-4 text-center text-xs text-muted-foreground flex items-center justify-center gap-2">
              <Loader2 className="h-3 w-3 animate-spin" /> Loading…
            </div>
          )}
          <TabsContent value="avatars" className="m-0 p-2">
            <ImageGrid items={avatars} selectedFn={isSelected} onToggle={toggle} empty="No avatars yet. Add them in the Avatars page." />
          </TabsContent>
          <TabsContent value="products" className="m-0 p-2">
            <ImageGrid items={products} selectedFn={isSelected} onToggle={toggle} empty="No products / image assets saved for this client yet." />
          </TabsContent>
          <TabsContent value="pdfs" className="m-0 p-2">
            <PdfList items={pdfs} selectedFn={isSelected} onToggle={toggle} />
          </TabsContent>
        </Tabs>
      </PopoverContent>
    </Popover>
  );
}

function ImageGrid({
  items, selectedFn, onToggle, empty,
}: {
  items: VideoReference[];
  selectedFn: (r: VideoReference) => boolean;
  onToggle: (r: VideoReference) => void;
  empty: string;
}) {
  if (!items.length) return <p className="text-xs text-muted-foreground text-center p-4">{empty}</p>;
  return (
    <ScrollArea className="h-64">
      <div className="grid grid-cols-3 gap-1.5">
        {items.map((r) => {
          const sel = selectedFn(r);
          return (
            <button
              key={r.id}
              type="button"
              onClick={() => onToggle(r)}
              className={`relative aspect-square rounded-md overflow-hidden border-2 transition ${sel ? "border-primary" : "border-transparent hover:border-muted-foreground/40"}`}
              title={r.name}
            >
              <img src={r.url} alt={r.name} className="w-full h-full object-cover" loading="lazy" />
              {sel && (
                <div className="absolute top-1 right-1 rounded-full p-0.5 bg-primary text-primary-foreground">
                  <Check className="h-3 w-3" />
                </div>
              )}
              <div className="absolute bottom-0 inset-x-0 text-[9px] text-white bg-black/60 px-1 py-0.5 truncate">{r.name}</div>
            </button>
          );
        })}
      </div>
    </ScrollArea>
  );
}

function PdfList({
  items, selectedFn, onToggle,
}: {
  items: VideoReference[];
  selectedFn: (r: VideoReference) => boolean;
  onToggle: (r: VideoReference) => void;
}) {
  if (!items.length) return <p className="text-xs text-muted-foreground text-center p-4">No PDFs uploaded to any offer for this client yet.</p>;
  return (
    <ScrollArea className="h-64">
      <div className="space-y-1">
        {items.map((r) => {
          const sel = selectedFn(r);
          return (
            <button
              key={r.id}
              type="button"
              onClick={() => onToggle(r)}
              className={`w-full flex items-center gap-2 text-left rounded-md px-2 py-1.5 text-xs border ${sel ? "border-primary bg-primary/5" : "border-border/60 hover:bg-muted"}`}
            >
              <FileText className="h-3.5 w-3.5 text-primary shrink-0" />
              <span className="flex-1 truncate">{r.name}</span>
              {sel && <Check className="h-3.5 w-3.5 text-primary" />}
            </button>
          );
        })}
      </div>
    </ScrollArea>
  );
}

/** Build a short structured block to inject into the AI Studio user message. */
export function buildReferenceContextBlock(refs: VideoReference[]): string {
  if (!refs.length) return "";
  const lines: string[] = ["ATTACHED REFERENCES FOR THIS REQUEST (use when generating images or videos):"];
  for (const r of refs) {
    if (r.kind === "avatar") lines.push(`- AVATAR (use this person's face/identity as the source frame): ${r.name} — ${r.url}`);
    if (r.kind === "product") lines.push(`- PRODUCT IMAGE (feature this product in the scene): ${r.name} — ${r.url}`);
    if (r.kind === "pdf") lines.push(`- PDF CONTEXT (read for offer details, compliance, value props): ${r.name} — ${r.url}`);
  }
  lines.push("If the user is asking for a VIDEO, prefer image-to-video and pass the avatar/product URL as `image_url` to the Seedance tool.");
  return lines.join("\n") + "\n\n";
}