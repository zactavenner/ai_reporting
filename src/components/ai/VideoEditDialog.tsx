import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Wand2 } from "lucide-react";
import { useFindClientVideoByUrl } from "@/hooks/useClientVideos";
import { HyperframesEditor } from "./hyperframes/HyperframesEditor";

export function VideoEditDialog({
  open,
  onOpenChange,
  clientId,
  videoUrl,
  fallbackVideo,
  autoCaptions,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  clientId: string;
  videoUrl: string | null;
  fallbackVideo?: { prompt?: string; aspect_ratio?: string };
  autoCaptions?: boolean;
}) {
  const { data: found } = useFindClientVideoByUrl(clientId, videoUrl);
  const aspect = (found?.aspect_ratio ||
    fallbackVideo?.aspect_ratio ||
    "9:16") as "9:16" | "16:9" | "1:1";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[1200px] w-[95vw] h-[88vh] p-0 flex flex-col">
        <DialogHeader className="px-5 py-3 border-b">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Wand2 className="h-4 w-4 text-primary" />
            Hyperframes editor
            <Badge variant="outline" className="text-[10px]">
              in-browser runtime
            </Badge>
          </DialogTitle>
        </DialogHeader>
        {!videoUrl ? (
          <div className="flex-1 grid place-items-center text-sm text-muted-foreground">
            No video selected.
          </div>
        ) : (
          <HyperframesEditor
            clientId={clientId}
            videoUrl={videoUrl}
            aspectRatio={aspect}
            initialPrompt={found?.prompt || fallbackVideo?.prompt}
            sourceVideoId={found?.id || null}
            autoCaptions={autoCaptions}
            onSaved={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}