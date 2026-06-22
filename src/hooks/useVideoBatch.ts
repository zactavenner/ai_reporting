import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { VIDEO_MODELS, type VideoModelSpec } from "@/lib/modelRegistry";

export type BatchScene = {
  id: string;
  batch_id: string;
  script_id: string;
  scene_order: number;
  prompt: string;
  duration: number;
  status: "queued" | "processing" | "done" | "failed";
  stored_video_url: string | null;
  error: string | null;
};
export type BatchScript = {
  id: string;
  script_order: number;
  title: string | null;
  content: string;
};
export type BatchJob = {
  id: string;
  model: string;
  aspect_ratio: string;
  default_duration: number;
  status: string;
  total_scenes: number;
  completed_scenes: number;
  failed_scenes: number;
  created_at: string;
};

export type DispatchInput = {
  scripts: { title: string; content: string }[];
  model: string;
  aspectRatio: "9:16" | "1:1" | "16:9";
  duration: number;
  resolution?: "720p" | "1080p";
  clientId?: string;
  characterDescription?: string;
  offerDescription?: string;
};

export function useVideoBatch(batchId?: string | null) {
  const [job, setJob] = useState<BatchJob | null>(null);
  const [scripts, setScripts] = useState<BatchScript[]>([]);
  const [scenes, setScenes] = useState<BatchScene[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!batchId) return;
    const [{ data: j }, { data: sc }, { data: scn }] = await Promise.all([
      supabase.from("video_batch_jobs").select("*").eq("id", batchId).maybeSingle(),
      supabase.from("video_batch_scripts").select("*").eq("batch_id", batchId).order("script_order"),
      supabase.from("video_batch_scenes").select("*").eq("batch_id", batchId).order("scene_order"),
    ]);
    if (j) setJob(j as any);
    if (sc) setScripts(sc as any);
    if (scn) setScenes(scn as any);
  }, [batchId]);

  useEffect(() => { refresh(); }, [refresh]);

  // Realtime subscription on this batch's scenes
  useEffect(() => {
    if (!batchId) return;
    const channel = supabase
      .channel(`video-batch-${batchId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "video_batch_scenes", filter: `batch_id=eq.${batchId}` }, () => refresh())
      .on("postgres_changes", { event: "*", schema: "public", table: "video_batch_jobs", filter: `id=eq.${batchId}` }, () => refresh())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [batchId, refresh]);

  const dispatch = useCallback(async (input: DispatchInput): Promise<string | null> => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("video-batch-dispatch", { body: input });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success(`Batch started — ${data.totalScenes} scenes queued`);
      return data.batchId as string;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error("Failed to start batch", { description: msg });
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  return { job, scripts, scenes, loading, dispatch, refresh };
}

// Re-export from the shared registry so all UIs stay in lockstep with the
// server-side `MODEL_CAPS` in supabase/functions/video-batch-dispatch.
export const MODEL_OPTIONS: VideoModelSpec[] = VIDEO_MODELS;