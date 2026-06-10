import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface ClientVideo {
  id: string;
  client_id: string;
  title: string | null;
  prompt: string | null;
  storage_url: string;
  storage_path: string | null;
  poster_url: string | null;
  source_url: string | null;
  source: string;
  conversation_id: string | null;
  canvas_item_id: string | null;
  parent_video_id: string | null;
  model: string | null;
  aspect_ratio: string | null;
  duration_seconds: number | null;
  resolution: string | null;
  status: string;
  edit_instructions: string | null;
  metadata: Record<string, any>;
  created_at: string;
  updated_at: string;
}

export function useClientVideos(clientId: string | undefined) {
  return useQuery({
    queryKey: ["client-videos", clientId],
    enabled: !!clientId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("client_videos" as any)
        .select("*")
        .eq("client_id", clientId)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as unknown as ClientVideo[];
    },
  });
}

export function useFindClientVideoByUrl(clientId: string | undefined, url: string | null | undefined) {
  return useQuery({
    queryKey: ["client-video-by-url", clientId, url],
    enabled: !!clientId && !!url,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("client_videos" as any)
        .select("*")
        .eq("client_id", clientId)
        .eq("storage_url", url)
        .maybeSingle();
      if (error) throw error;
      return data as unknown as ClientVideo | null;
    },
  });
}

export function useVideoEditMessages(videoId: string | undefined) {
  return useQuery({
    queryKey: ["video-edit-messages", videoId],
    enabled: !!videoId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("video_edit_messages" as any)
        .select("*")
        .eq("source_video_id", videoId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });
}

export function useSendVideoEdit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { sourceVideoId: string; clientId: string; instruction: string }) => {
      const { data, error } = await supabase.functions.invoke("video-edit-chat", { body: input });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      return data as { reply: string; video?: ClientVideo };
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["video-edit-messages", vars.sourceVideoId] });
      qc.invalidateQueries({ queryKey: ["client-videos", vars.clientId] });
      toast.success("New version ready");
    },
    onError: (e: any) => toast.error(e.message || "Edit failed"),
  });
}