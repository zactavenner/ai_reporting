import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { dashboardAuthHeaders } from '@/lib/dashboardAuthHeaders';
import type { VideoClip, Caption, TextOverlay } from '@/hooks/useVideoEditor';
import { validateRenderSpec } from '../../../supabase/functions/_shared/hyperframes-spec.mjs';

export interface HyperframesExportProps {
  projectId: string;
  projectName: string;
  clientId: string | null;
  onClientChange: (clientId: string) => void;
  onSourcesPersisted: (sources: Record<string, string>) => void;
  clips: VideoClip[];
  captions: Caption[];
  textOverlays: TextOverlay[];
  aspectRatio: '9:16' | '16:9' | '1:1';
  captionSettings: { style: string; fontSize: number; color: string; fontFamily: string; position: string; stroke: boolean; background: boolean };
  voiceoverBlobUrl: string | null;
  voiceoverVolume: number;
}
interface RenderJob { id: string; status: string; error?: string; output_url?: string; creative_id?: string }
async function invoke(body: Record<string, unknown>) {
  const headers = dashboardAuthHeaders();
  if (!headers['x-dashboard-token']) throw new Error('Sign in to the dashboard again to enable server rendering');
  const { data, error } = await supabase.functions.invoke('hyperframes-jobs', { body, headers });
  if (error) {
    const response = error.context instanceof Response ? await error.context.json().catch(() => null) : null;
    throw new Error(response?.error || 'HyperFrames server is unavailable or has not been deployed');
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

export function HyperframesExportPanel(props: HyperframesExportProps) {
  const [clients, setClients] = useState<{ id: string; name: string }[]>([]);
  const [online, setOnline] = useState(false);
  const [healthMessage, setHealthMessage] = useState('Checking render worker…');
  const [busy, setBusy] = useState(false);
  const [approved, setApproved] = useState(false);
  const [job, setJob] = useState<RenderJob | null>(null);
  const [disabledByServer, setDisabledByServer] = useState(false);
  const prepared = useRef<{ fingerprint: string; body: Record<string, unknown> } | null>(null);
  const fingerprint = JSON.stringify([props.clientId, props.clips.map(c => ({ ...c, sourceUrl: undefined })), props.captions, props.textOverlays, props.aspectRatio, props.captionSettings, props.voiceoverBlobUrl, props.voiceoverVolume]);
  useEffect(() => { setApproved(false); }, [fingerprint]);

  const refresh = useCallback(async () => {
    try {
      const health = await invoke({ action: 'health' });
      setDisabledByServer(false);
      setOnline(health.online);
      setHealthMessage(health.online ? 'HyperFrames worker online' : 'No render worker online. Start the configured server worker first.');
    } catch (error) {
      setOnline(false);
      const message = (error as Error).message;
      // Server-side rendering is fail-closed until a real render operator exists.
      setDisabledByServer(message.includes('rendering_disabled'));
      setHealthMessage(message);
    }
  }, []);
  useEffect(() => {
    supabase.from('clients').select('id,name').order('name').then(({ data }) => setClients(data || []));
    refresh();
    const interval = setInterval(refresh, 30000);
    return () => clearInterval(interval);
  }, [refresh]);
  useEffect(() => {
    setJob(null);
    prepared.current = null;
    const id = localStorage.getItem(`hyperframes-job:${props.projectId}`);
    if (id) invoke({ action: 'status', jobId: id }).then(setJob).catch(() => undefined);
  }, [props.projectId]);
  useEffect(() => {
    if (!job || !['queued', 'rendering'].includes(job.status)) return;
    const timer = setInterval(() => invoke({ action: 'status', jobId: job.id }).then(setJob).catch(error => setHealthMessage(error.message)), 5000);
    return () => clearInterval(timer);
  }, [job?.id, job?.status]);

  async function enqueue() {
    if (!props.clientId || !approved || !online) return;
    setBusy(true);
    try {
      if (prepared.current?.fingerprint !== fingerprint) {
        const id = crypto.randomUUID();
        const clientId = props.clientId;
        const storageUrl = import.meta.env.VITE_SUPABASE_URL;
        const placeholder = `${storageUrl}/storage/v1/object/public/creatives/${clientId}/source.mp4`;
        const spec = {
          clips: props.clips.map(c => ({ sourceUrl: placeholder, trimStart: c.trimStart, trimEnd: c.trimEnd, speed: c.speed, volume: c.volume, transition: c.transition })),
          captions: props.captions, textOverlays: props.textOverlays, aspectRatio: props.aspectRatio,
          captionSettings: props.captionSettings, voiceoverUrl: props.voiceoverBlobUrl ? placeholder : null,
          voiceoverVolume: props.voiceoverVolume,
        };
        // Reject unsupported edits before uploading anything; never silently discard effects.
        validateRenderSpec(spec, storageUrl, clientId);
        async function upload(source: string, suffix: string) {
          const response = await fetch(source);
          if (!response.ok) throw new Error('Unable to read source media');
          const blob = await response.blob();
          if (!blob.size || blob.size > 500 * 1024 * 1024) throw new Error('Media must be nonempty and under 500 MB');
          const objectPath = `${clientId}/hyperframes/${id}/sources/${suffix}`;
          const { error } = await supabase.storage.from('creatives').upload(objectPath, blob, { contentType: blob.type || 'application/octet-stream', upsert: false });
          if (error) throw error;
          return supabase.storage.from('creatives').getPublicUrl(objectPath).data.publicUrl;
        }
        for (let i = 0; i < props.clips.length; i++) spec.clips[i].sourceUrl = await upload(props.clips[i].blobUrl, `clip-${i}.mp4`);
        props.onSourcesPersisted(Object.fromEntries(props.clips.map((clip, i) => [clip.id, spec.clips[i].sourceUrl])));
        if (props.voiceoverBlobUrl) spec.voiceoverUrl = await upload(props.voiceoverBlobUrl, 'voiceover');
        prepared.current = { fingerprint, body: { action: 'enqueue', jobId: id, projectId: props.projectId, clientId, approved: true, spec } };
      }
      const body = prepared.current!.body;
      const result = await invoke(body);
      localStorage.setItem(`hyperframes-job:${props.projectId}`, result.id);
      setJob({ id: result.id, status: 'queued' });
      toast.success('HyperFrames render queued. The finished MP4 will be saved for creative review.');
    } catch (error) { toast.error((error as Error).message); }
    finally { setBusy(false); }
  }

  const running = job && ['queued', 'rendering'].includes(job.status);
  return <section className="space-y-3 rounded-lg border p-3">
    <p className="text-sm font-medium">HyperFrames MP4 → Creative Assets</p>
    <Select value={props.clientId || ''} onValueChange={props.onClientChange} disabled={busy || !!running}>
      <SelectTrigger aria-label="Creative Assets client"><SelectValue placeholder="Select client" /></SelectTrigger>
      <SelectContent>{clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
    </Select>
    {disabledByServer
      ? <p className="text-xs text-destructive">Server rendering is disabled pending security activation: an independently authenticated render operator and protected membership/authorization are required. Browser export (WebM) still works.</p>
      : <p className="text-xs text-muted-foreground">{healthMessage}</p>}
    <p className="text-xs text-muted-foreground">Supports trims, ordering, speed, source audio, voiceover, static text, and Classic/Minimal/Boxed captions. Unsupported FX are rejected, not dropped.</p>
    <label className="flex gap-2 text-xs"><input type="checkbox" checked={approved} onChange={e => setApproved(e.target.checked)} disabled={busy || !!running} />I reviewed this edit and approve a final MP4 render for this client. Save for review only; do not publish.</label>
    <Button className="w-full" onClick={enqueue} disabled={!online || !props.clientId || !approved || busy || !!running || !props.clips.length}>{busy ? 'Uploading / submitting…' : running ? `Render ${job.status}` : 'Render with HyperFrames'}</Button>
    {!online && !disabledByServer && <Button size="sm" variant="outline" onClick={refresh}>Check connection</Button>}
    {job?.error && <p className="text-xs text-destructive">{job.error}</p>}
    {job?.status === 'completed' && job.output_url && <div className="space-y-2">
      <video controls preload="metadata" src={job.output_url} className="w-full rounded" />
      <a className="text-sm underline" href={job.output_url} target="_blank" rel="noreferrer">Open saved MP4</a>
      <p className="text-xs text-muted-foreground">Saved for review. Creative ID: {job.creative_id}</p>
    </div>}
  </section>;
}
