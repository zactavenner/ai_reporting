/**
 * Thin persistence layer for single-scene / broll / image-to-video jobs.
 * Inserts rows into video_batch_jobs + video_batch_scenes so jobs survive
 * a tab reload and show up alongside multi-scene batch cards.
 */
import { useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export type SingleJobKind = 'broll' | 'single-scene' | 'image-to-video';

interface CreateParams {
  kind: SingleJobKind;
  model: string;
  aspectRatio: string;
  duration: number;
  prompt: string;
  clientId?: string;
  imageUrl?: string;
}

export function useSingleJobPersistence() {
  /** Insert a batch job + script + scene row; returns ids needed for updates. */
  const createJobRecord = useCallback(async (params: CreateParams) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    const { data: job, error: jobErr } = await supabase
      .from('video_batch_jobs')
      .insert({
        user_id: user.id,
        client_id: params.clientId ?? null,
        model: params.model,
        aspect_ratio: params.aspectRatio,
        default_duration: params.duration,
        resolution: '1080p',
        status: 'processing',
        total_scenes: 1,
        completed_scenes: 0,
        failed_scenes: 0,
        kind: params.kind,
      } as any)
      .select('id')
      .single();
    if (jobErr || !job) { console.error('useSingleJobPersistence: job insert', jobErr); return null; }

    const { data: script, error: scriptErr } = await supabase
      .from('video_batch_scripts')
      .insert({
        batch_id: job.id,
        user_id: user.id,
        script_order: 1,
        title: params.kind,
        content: params.prompt,
      })
      .select('id')
      .single();
    if (scriptErr || !script) { console.error('useSingleJobPersistence: script insert', scriptErr); return null; }

    const { data: scene, error: sceneErr } = await supabase
      .from('video_batch_scenes')
      .insert({
        batch_id: job.id,
        script_id: script.id,
        user_id: user.id,
        scene_order: 1,
        prompt: params.prompt,
        duration: params.duration,
        status: 'processing',
        image_url: params.imageUrl ?? null,
      } as any)
      .select('id')
      .single();
    if (sceneErr || !scene) { console.error('useSingleJobPersistence: scene insert', sceneErr); return null; }

    return { batchId: job.id as string, sceneId: scene.id as string };
  }, []);

  /** Update a scene row (and roll up to the parent job) after a status change. */
  const updateScene = useCallback(async (
    batchId: string,
    sceneId: string,
    status: 'processing' | 'done' | 'failed',
    extras: { videoUrl?: string; error?: string } = {}
  ) => {
    await supabase
      .from('video_batch_scenes')
      .update({
        status,
        ...(extras.videoUrl ? { stored_video_url: extras.videoUrl } : {}),
        ...(extras.error   ? { error: extras.error }               : {}),
      } as any)
      .eq('id', sceneId);

    if (status === 'done') {
      await supabase.from('video_batch_jobs').update({ status: 'done', completed_scenes: 1 } as any).eq('id', batchId);
    } else if (status === 'failed') {
      await supabase.from('video_batch_jobs').update({ status: 'failed', failed_scenes: 1 } as any).eq('id', batchId);
    }
  }, []);

  return { createJobRecord, updateScene };
}
