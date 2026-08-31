import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { validateRenderSpec } from '../supabase/functions/_shared/hyperframes-spec.mjs';
import { buildComposition } from './composition.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key || key.startsWith('sb_publishable_')) {
  throw new Error('Set SUPABASE_URL and a server-only SUPABASE_SERVICE_ROLE_KEY. Never use a browser publishable key for the worker.');
}
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const workerId = process.env.HYPERFRAMES_WORKER_ID || 'reporting-local';
const cliPackage = JSON.parse(await fs.readFile(path.join(root, 'node_modules/hyperframes/package.json'), 'utf8'));
const cliBin = typeof cliPackage.bin === 'string' ? cliPackage.bin : cliPackage.bin.hyperframes;
const cli = path.join(root, 'node_modules/hyperframes', cliBin);

function run(command, args, cwd, timeout = 30 * 60 * 1000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: { ...process.env, SUPABASE_SERVICE_ROLE_KEY: '', HYPERFRAMES_TELEMETRY_DISABLED: '1' }, stdio: ['ignore','pipe','pipe'] });
    let output = '';
    child.stdout.on('data', data => { output = (output + data).slice(-20000); });
    child.stderr.on('data', data => { output = (output + data).slice(-20000); });
    const timer = setTimeout(() => child.kill('SIGKILL'), timeout);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => { clearTimeout(timer); code === 0 ? resolve(output) : reject(new Error(`${path.basename(command)} exited ${code}: ${output.slice(-3000)}`)); });
  });
}

async function download(source, destination) {
  const response = await fetch(source, { redirect: 'error', signal: AbortSignal.timeout(120000) });
  if (!response.ok || !response.body) throw new Error(`Media download failed (${response.status})`);
  const file = await fs.open(destination, 'wx');
  let size = 0;
  try {
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > 500 * 1024 * 1024) throw new Error('Source exceeds 500 MB');
      await file.write(chunk);
    }
  } finally { await file.close(); }
  if (!size) throw new Error('Source media is empty');
}

async function processJob(job) {
  const duration = validateRenderSpec(job.spec, url, job.client_id);
  await fs.mkdir(path.join(root, 'jobs'), { recursive: true });
  const directory = await fs.mkdtemp(path.join(root, 'jobs', `${job.id}-`));
  await fs.mkdir(path.join(directory, 'assets'));
  const media = [];
  for (let i = 0; i < job.spec.clips.length; i++) {
    const clip = job.spec.clips[i];
    const destination = path.join(directory, 'assets', `clip-${i}.mp4`);
    await download(clip.sourceUrl, destination);
    const info = JSON.parse(await run('ffprobe', ['-v','error','-show_streams','-show_format','-of','json',destination], directory, 30000));
    if (!info.streams.some(s => s.codec_type === 'video') || clip.trimEnd > Number(info.format.duration) + 0.1) throw new Error('Clip is not a valid video or trim exceeds source duration');
    media.push({ hasAudio: info.streams.some(s => s.codec_type === 'audio') });
  }
  if (job.spec.voiceoverUrl) await download(job.spec.voiceoverUrl, path.join(directory, 'assets', 'voiceover'));
  await fs.copyFile(path.join(root,'node_modules/gsap/dist/gsap.min.js'), path.join(directory,'assets/gsap.min.js'));
  await fs.writeFile(path.join(directory, 'index.html'), buildComposition(job.spec, media));
  await fs.writeFile(path.join(directory, 'spec.json'), JSON.stringify(job.spec, null, 2));
  await run(process.execPath, [cli, 'check', directory], directory);
  // Submission requires the operator's explicit final-render approval in the app.
  await run(process.execPath, [cli, 'render', directory, '--quality','high','--fps','30','--workers','2','--strict','--output',path.join(directory,'final.mp4')], directory);
  const output = path.join(directory, 'final.mp4');
  const probe = JSON.parse(await run('ffprobe',['-v','error','-show_streams','-show_format','-of','json',output],directory,30000));
  const video = probe.streams.find(s => s.codec_type === 'video');
  const expectedWidth = job.spec.aspectRatio === '16:9' ? 1920 : 1080;
  const expectedHeight = job.spec.aspectRatio === '9:16' ? 1920 : 1080;
  if (!video || video.width !== expectedWidth || video.height !== expectedHeight || Math.abs(Number(probe.format.duration) - duration) > 0.2) throw new Error('Rendered video failed dimensions/duration QA');
  if ((media.some((m, i) => m.hasAudio && job.spec.clips[i].volume > 0) || job.spec.voiceoverUrl) && !probe.streams.some(s => s.codec_type === 'audio')) throw new Error('Rendered video is missing expected audio');
  const bytes = await fs.readFile(output);
  if (!bytes.length) throw new Error('Empty render');
  const objectPath = `${job.client_id}/hyperframes/${job.id}/final.mp4`;
  const { error: uploadError } = await db.storage.from('creatives').upload(objectPath, bytes, { contentType: 'video/mp4', upsert: false });
  if (uploadError) throw uploadError;
  const { data: { publicUrl } } = db.storage.from('creatives').getPublicUrl(objectPath);
  const check = await fetch(publicUrl, { method:'HEAD', signal:AbortSignal.timeout(30000) });
  if (!check.ok || !check.headers.get('content-type')?.includes('video/mp4')) throw new Error('Uploaded video failed read-back');
  const { error } = await db.rpc('complete_hyperframes_render', { job_id:job.id, lease_token:job.claim_token, media_url:publicUrl });
  if (error) throw error;
  console.log(`Completed render ${job.id}; saved for creative review.`);
}

async function heartbeat() {
  const { error } = await db.from('hyperframes_workers').upsert({ id:workerId, last_seen_at:new Date().toISOString() });
  if (error) throw new Error('Worker cannot authenticate or the HyperFrames migration is not deployed');
}
await heartbeat();
const ticker = setInterval(() => heartbeat().catch(() => console.error('Worker heartbeat failed')), 20000);
try {
  do {
    const { data, error } = await db.rpc('claim_hyperframes_render');
    if (error) throw new Error('Unable to claim jobs; check server credentials and migration');
    for (const job of data || []) {
      try { await processJob(job); }
      catch (error) {
        console.error(`Render ${job.id} failed. Output was not marked complete.`);
        // Detailed logs stay local, never return signed URLs, credentials, or paths to the browser.
        const safeError = 'Render or delivery failed. Inspect the local worker job artifacts before retrying.';
        await db.from('hyperframes_render_jobs').update({ status:'failed', error:safeError, completed_at:new Date().toISOString() }).eq('id',job.id).eq('claim_token',job.claim_token).eq('status','rendering');
      }
    }
    if (!process.argv.includes('--watch')) break;
    await new Promise(resolve => setTimeout(resolve, 10000));
  } while (true);
} finally { clearInterval(ticker); }
