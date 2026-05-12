import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, Copy, ExternalLink, FileText, Table as TableIcon, Image as ImageIcon, AlertCircle, Wand2 } from "lucide-react";
import { toast } from "sonner";

export type CanvasPlaceholder = {
  __placeholder: true;
  placeholder_id: string;
  kind: "image";
  prompt: string;
  aspect_ratio: string;
  quality: string;
  failed?: string;
};
export type CanvasItem = {
  id: string;
  kind: "image" | "doc_edit" | "sheet_edit";
  payload: any;
  created_at: string;
};
export type CanvasEntry = CanvasItem | CanvasPlaceholder;

export function AIStudioCanvas({ entries, onEditImage }: { entries: CanvasEntry[]; onEditImage?: (imageUrl: string, aspectRatio: string) => void }) {
  if (entries.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-muted-foreground p-8 text-center">
        The AI builds here. Ask it to generate an ad creative or edit your doc/sheet — results appear as cards on this canvas.
      </div>
    );
  }
  return (
    <div className="p-4 space-y-3 overflow-auto h-full">
      {entries.map((e, i) => {
        if ("__placeholder" in e) {
          return (
            <Card key={`ph-${e.placeholder_id}`} className="p-4 border-dashed">
              <div className="flex items-start gap-3">
                <div className="h-10 w-10 rounded bg-muted flex items-center justify-center">
                  {e.failed ? <AlertCircle className="h-5 w-5 text-destructive" /> : <Loader2 className="h-5 w-5 animate-spin text-primary" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <Badge variant="outline" className="text-[10px]">{e.aspect_ratio}</Badge>
                    <Badge variant="secondary" className="text-[10px]">{e.quality === "fast" ? "fast" : "pro"}</Badge>
                    <span className="text-xs text-muted-foreground">{e.failed ? "failed" : "building on canvas…"}</span>
                  </div>
                  <p className="text-sm line-clamp-2">{e.prompt}</p>
                  {e.failed && <p className="text-xs text-destructive mt-1">{e.failed}</p>}
                </div>
              </div>
            </Card>
          );
        }
        if (e.kind === "image") {
          const p = e.payload || {};
          return (
            <Card key={e.id} className="p-3 overflow-hidden">
              <div className="flex items-center gap-2 mb-2">
                <ImageIcon className="h-4 w-4 text-primary" />
                <Badge variant="outline" className="text-[10px]">{p.aspect_ratio || "1:1"}</Badge>
                <Badge variant="secondary" className="text-[10px] truncate max-w-[180px]" title={p.model}>
                  {p.model?.includes("pro") ? "Gemini 3 Pro" : p.model?.includes("flash") ? "Nano Banana 2" : (p.model || "image")}
                </Badge>
                <span className="text-xs text-muted-foreground ml-auto">{new Date(e.created_at).toLocaleTimeString()}</span>
              </div>
              {p.image_url && (
                <a href={p.image_url} target="_blank" rel="noopener noreferrer" className="block">
                  <img src={p.image_url} alt={p.prompt || "ad creative"} className="w-full rounded-md border" loading="lazy" />
                </a>
              )}
              <div className="flex items-start gap-2 mt-2">
                <p className="text-xs text-muted-foreground line-clamp-2 flex-1">{p.prompt}</p>
                {p.image_url && (
                  <>
                    {onEditImage && (
                      <Button size="icon" variant="ghost" className="h-7 w-7" title="Edit (offer / hook / colors / disclaimer)"
                        onClick={() => onEditImage(p.image_url, p.aspect_ratio || "1:1")}>
                        <Wand2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    <Button size="icon" variant="ghost" className="h-7 w-7" title="Copy URL"
                      onClick={() => { navigator.clipboard.writeText(p.image_url); toast.success("URL copied"); }}>
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7" title="Open" asChild>
                      <a href={p.image_url} target="_blank" rel="noopener noreferrer">
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    </Button>
                  </>
                )}
                {p.parent_image_url && (
                  <Badge variant="outline" className="text-[10px] mt-1">revision</Badge>
                )}
              </div>
            </Card>
          );
        }
        if (e.kind === "doc_edit") {
          const p = e.payload || {};
          return (
            <Card key={e.id} className="p-3">
              <div className="flex items-center gap-2 mb-1">
                <FileText className="h-4 w-4 text-primary" />
                <span className="text-sm font-medium">Doc {p.action === "replace" ? "find & replace" : "append"}</span>
                <span className="text-xs text-muted-foreground ml-auto">{new Date(e.created_at).toLocaleTimeString()}</span>
              </div>
              {p.action === "append" ? (
                <p className="text-xs text-muted-foreground">{p.chars} chars appended. <span className="italic line-clamp-2">{p.preview}</span></p>
              ) : (
                <p className="text-xs text-muted-foreground">Replaced "{p.find}" → "{p.replace}"</p>
              )}
              {p.doc_url && (
                <a href={p.doc_url} target="_blank" rel="noopener noreferrer" className="text-xs text-primary inline-flex items-center gap-1 mt-1">
                  <ExternalLink className="h-3 w-3" /> Open doc
                </a>
              )}
            </Card>
          );
        }
        if (e.kind === "sheet_edit") {
          const p = e.payload || {};
          return (
            <Card key={e.id} className="p-3">
              <div className="flex items-center gap-2 mb-1">
                <TableIcon className="h-4 w-4 text-primary" />
                <span className="text-sm font-medium">Sheet {p.action === "append" ? "row append" : "range update"}</span>
                <span className="text-xs text-muted-foreground ml-auto">{new Date(e.created_at).toLocaleTimeString()}</span>
              </div>
              <p className="text-xs text-muted-foreground">
                {p.range} — {p.action === "append" ? `${p.rows} rows` : `${p.cells} cells`}
              </p>
              {p.sheet_url && (
                <a href={p.sheet_url} target="_blank" rel="noopener noreferrer" className="text-xs text-primary inline-flex items-center gap-1 mt-1">
                  <ExternalLink className="h-3 w-3" /> Open sheet
                </a>
              )}
            </Card>
          );
        }
        return null;
      })}
    </div>
  );
}
