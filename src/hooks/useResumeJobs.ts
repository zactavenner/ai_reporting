/**
 * Queries video_batch_jobs for single-scene / broll / image-to-video jobs
 * that are still processing or queued so they can be surfaced after a reload.
 */
import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { SingleJobKind } from './useSingleJobPersistence';

export interface ResumedJob {
  id: string;
  kind: SingleJobKind;
  status: string;
  model: string;
  aspect_ratio: string;
  created_at: string;
  /** First scene's prompt (may be undefined if join didn't return it) */
  prompt?: string;
  /** First scene's stored video URL once done */
  videoUrl?: string;
}

export function useResumeJobs(kinds: SingleJobKind[] = ['broll', 'single-scene', 'image-to-video']) {
  const [jobs, setJobs] = useState<ResumedJob[]>([]);
  const [loading, setLoading] = useState(true);

  const refetch = async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }

    const { data, error } = await supabase
      .from('video_batch_jobs')
      .select(`
        id,
        kind,
        status,
        model,
        aspect_ratio,
        created_at,
        video_batch_scenes ( prompt, stored_video_url, scene_order )
      `)
      .eq('user_id', user.id)
      .in('kind', kinds as string[])
      .order('created_at', { ascending: false })
      .limit(20) as any;

    if (error) { console.error('useResumeJobs', error); setLoading(false); return; }

    const mapped: ResumedJob[] = (data ?? []).map((row: any) => {
      const scene = (row.video_batch_scenes ?? []).sort((a: any, b: any) => a.scene_order - b.scene_order)[0];
      return {
        id: row.id,
        kind: row.kind as SingleJobKind,
        status: row.status,
        model: row.model,
        aspect_ratio: row.aspect_ratio,
        created_at: row.created_at,
        prompt: scene?.prompt,
        videoUrl: scene?.stored_video_url,
      };
    });

    setJobs(mapped);
    setLoading(false);
  };

  useEffect(() => { refetch(); }, []);

  return { jobs, loading, refetch };
}
