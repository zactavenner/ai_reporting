import { useState, useEffect, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Loader2, Send, Wand2 } from "lucide-react";
import { VideoPlayerCard } from "./VideoPlayerCard";
import {
  useFindClientVideoByUrl,
  useVideoEditMessages,
  useSendVideoEdit,
  type ClientVideo,
} from "@/hooks/useClientVideos";

const QUICK = [
  "Trim the first 2 seconds",
  "Make the hook punchier",
  "Swap accent color to gold",
  "Add a softer outro with the logo",
  "Slower pacing, more cinematic",
];

export function VideoEditDialog({
  open, onOpenChange, clientId, videoUrl, fallbackVideo,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  clientId: string;
  videoUrl: string | null;
  fallbackVideo?: { prompt?: string; aspect_ratio?: string };
}) {
  const { data: found, isLoading: findLoading } = useFindClientVideoByUrl(clientId, videoUrl);
  const video: ClientVideo | null = found ?? null;
  const { data: msgs = [] } = useVideoEditMessages(video?.id);
  const send = useSendVideoEdit();
  const [input, setInput] = useState("");
  const [active, setActive] = useState<ClientVideo | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setActive(null); }, [videoUrl]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs.length, send.isPending]);

  const current = active ?? video;
  const aspect = (current?.aspect_ratio || fallbackVideo?.aspect_ratio || "9:16") as any;
  const aspectClass = aspect === "16:9" ? "16/9" : aspect === "1:1" ? "1/1" : "9/16";

  const submit = async () => {
    if (!input.trim() || !video?.id) return;
    const inst = input.trim();
    setInput("");
    const res = await send.mutateAsync({ sourceVideoId: video.id, clientId, instruction: inst }).catch(() => null);
    if (res?.video) setActive(res.video);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl h-[85vh] p-0 flex flex-col">
        <DialogHeader className="px-5 py-3 border-b">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Wand2 className="h-4 w-4 text-primary" />
            Hyperframes editor
            {video?.id && <Badge variant="outline" className="text-[10px]">v{(msgs.filter((m: any) => m.result_video_id).length) + 1}</Badge>}
          </DialogTitle>
        </DialogHeader>
        {!videoUrl ? (
          <div className="flex-1 grid place-items-center text-sm text-muted-foreground">No video selected.</div>
        ) : findLoading ? (
          <div className="flex-1 grid place-items-center"><Loader2 className="h-5 w-5 animate-spin" /></div>
        ) : !video ? (
          <div className="flex-1 grid place-items-center text-sm text-muted-foreground text-center px-6">
            This video isn't saved to this client's library yet. Generate it through AI Studio so it's persisted, then edit it here.
          </div>
        ) : (
          <div className="flex-1 grid grid-cols-2 gap-0 min-h-0">
            {/* Player */}
            <div className="border-r p-4 flex flex-col gap-3 min-h-0 overflow-y-auto">
              <VideoPlayerCard src={current?.storage_url} aspect={aspectClass} />
              <div className="text-[11px] text-muted-foreground">
                <div className="font-medium text-foreground">Prompt</div>
                <p className="line-clamp-4">{current?.prompt || fallbackVideo?.prompt}</p>
              </div>
            </div>
            {/* Chat */}
            <div className="flex flex-col min-h-0">
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {msgs.length === 0 && (
                  <div className="text-xs text-muted-foreground">
                    Tell me how to edit this clip — try one of these:
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {QUICK.map((q) => (
                        <button
                          key={q}
                          className="text-[10px] px-2 py-1 rounded-full border border-border/60 hover:bg-muted"
                          onClick={() => setInput(q)}
                        >{q}</button>
                      ))}
                    </div>
                  </div>
                )}
                {msgs.map((m: any) => (
                  <div key={m.id} className={`text-xs rounded-md px-3 py-2 ${m.role === "user" ? "bg-primary/10 ml-6" : "bg-muted mr-6"}`}>
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-0.5">{m.role}</div>
                    <div className="whitespace-pre-wrap">{m.content}</div>
                    {m.result_video_id && (
                      <Button size="sm" variant="link" className="h-6 px-0 mt-1 text-[10px]"
                        onClick={async () => {
                          // already child; click to show in player
                          const { data } = await (await import("@/integrations/supabase/client")).supabase
                            .from("client_videos" as any).select("*").eq("id", m.result_video_id).single();
                          if (data) setActive(data as any);
                        }}>
                        View this version
                      </Button>
                    )}
                  </div>
                ))}
                {send.isPending && (
                  <div className="text-xs text-muted-foreground flex items-center gap-2">
                    <Loader2 className="h-3 w-3 animate-spin" /> Re-rendering edited clip… (~30–60s)
                  </div>
                )}
                <div ref={endRef} />
              </div>
              <div className="border-t p-3 space-y-2">
                <Textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  rows={2}
                  placeholder="What should I change?"
                  className="text-xs"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
                  }}
                />
                <div className="flex justify-end">
                  <Button size="sm" onClick={submit} disabled={send.isPending || !input.trim()}>
                    <Send className="h-3.5 w-3.5 mr-1" />
                    {send.isPending ? "Editing…" : "Send"}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}