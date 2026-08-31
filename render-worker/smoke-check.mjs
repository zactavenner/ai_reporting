// Synthetic runtime check only. This does not submit a job or create a client creative.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { buildComposition } from './composition.mjs';
const root = path.dirname(fileURLToPath(import.meta.url));
await fs.mkdir(path.join(root, 'jobs'), { recursive:true });
const dir = await fs.mkdtemp(path.join(root, 'jobs', 'smoke-'));
await fs.mkdir(path.join(dir, 'assets'));
const run = (cmd, args) => {
  const result = spawnSync(cmd, args, { cwd:root, encoding:'utf8', timeout:120000 });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || String(result.error));
  return result.stdout;
};
run('ffmpeg', ['-v','error','-f','lavfi','-i','testsrc2=size=320x568:rate=30:duration=2','-f','lavfi','-i','sine=frequency=440:duration=2','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-shortest',path.join(dir,'assets/clip-0.mp4')]);
await fs.copyFile(path.join(root,'node_modules/gsap/dist/gsap.min.js'),path.join(dir,'assets/gsap.min.js'));
const spec = { aspectRatio:'9:16', clips:[{ trimStart:0,trimEnd:2,speed:1,volume:1 }], captions:[{text:'HyperFrames integration test',startTime:0.1,endTime:1.9}], textOverlays:[], captionSettings:{style:'boxed',fontSize:28,color:'#ffffff',position:'bottom',stroke:false,background:true} };
await fs.writeFile(path.join(dir,'index.html'),buildComposition(spec,[{hasAudio:true}]));
console.log(`Synthetic fixture: ${dir}`);
console.log(run(path.join(root,'node_modules/.bin/hyperframes'), ['check',dir,'--json','--snapshots']));
