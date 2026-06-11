import { supabase } from "@/integrations/supabase/client";
import type { HyperframesComposition, Layer, VideoLayer } from "./timeline";

/**
 * Hyperframes templates are stored in `client_assets` with
 * asset_type='hyperframes_template'. The composition has its base VIDEO layer
 * stripped of `src` so it can be re-bound to any video later.
 */
const ASSET_TYPE = "hyperframes_template";

export interface HyperframesTemplate {
  id: string;
  title: string;
  composition: HyperframesComposition; // base video layer has src=""
  created_at: string;
}

export function stripVideoSrc(comp: HyperframesComposition): HyperframesComposition {
  return {
    ...comp,
    layers: comp.layers.map((l) =>
      l.type === "video" ? ({ ...l, src: "" } as VideoLayer) : l,
    ) as Layer[],
  };
}

export function bindVideoSrc(
  comp: HyperframesComposition,
  videoSrc: string,
  duration: number,
): HyperframesComposition {
  return {
    ...comp,
    duration,
    layers: comp.layers.map((l) =>
      l.type === "video"
        ? ({ ...l, src: videoSrc, end: duration } as VideoLayer)
        : l,
    ) as Layer[],
  };
}

export async function listTemplates(clientId: string): Promise<HyperframesTemplate[]> {
  const { data, error } = await supabase
    .from("client_assets")
    .select("id, title, content, created_at")
    .eq("client_id", clientId)
    .eq("asset_type", ASSET_TYPE)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  return (data || []).map((r: any) => ({
    id: r.id,
    title: r.title,
    composition: r.content as HyperframesComposition,
    created_at: r.created_at,
  }));
}

export async function saveTemplate(
  clientId: string,
  title: string,
  comp: HyperframesComposition,
): Promise<HyperframesTemplate> {
  const stripped = stripVideoSrc(comp);
  const { data, error } = await supabase
    .from("client_assets")
    .insert({
      client_id: clientId,
      asset_type: ASSET_TYPE,
      title,
      content: stripped as any,
      status: "ready",
    })
    .select("id, title, content, created_at")
    .single();
  if (error) throw error;
  return {
    id: data.id,
    title: data.title,
    composition: data.content as HyperframesComposition,
    created_at: data.created_at,
  };
}

export async function deleteTemplate(id: string): Promise<void> {
  const { error } = await supabase.from("client_assets").delete().eq("id", id);
  if (error) throw error;
}