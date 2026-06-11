/**
 * Lazy-loaded ffmpeg.wasm transcoder.
 * Converts an in-browser WebM blob (captured via MediaRecorder) into a real MP4
 * (H.264 + AAC) suitable for IG / TikTok / YouTube upload.
 *
 * Loaded on demand only — the wasm core is ~30MB.
 */
// Cache the PROMISE (not the resolved instance) so concurrent export calls
// share a single 30MB wasm download instead of racing two parallel loads.
let ffmpegPromise: Promise<any> | null = null;

function getFfmpeg() {
  if (ffmpegPromise) return ffmpegPromise;
  ffmpegPromise = (async () => {
    const { FFmpeg } = await import("@ffmpeg/ffmpeg");
    const { toBlobURL } = await import("@ffmpeg/util");
    const ff = new FFmpeg();
    const base = "https://unpkg.com/@ffmpeg/[email protected]/dist/umd";
    await ff.load({
      coreURL: await toBlobURL(`${base}/ffmpeg-core.js`, "text/javascript"),
      wasmURL: await toBlobURL(`${base}/ffmpeg-core.wasm`, "application/wasm"),
    });
    return ff;
  })().catch((e) => { ffmpegPromise = null; throw e; });
  return ffmpegPromise;
}

export async function transcodeWebmToMp4(
  webm: Blob,
  onProgress?: (ratio: number) => void,
): Promise<Blob> {
  const ff = await getFfmpeg();
  if (onProgress) {
    ff.on("progress", ({ progress }: { progress: number }) => {
      onProgress(Math.max(0, Math.min(1, progress)));
    });
  }
  const inputName = "in.webm";
  const outputName = "out.mp4";
  const buf = new Uint8Array(await webm.arrayBuffer());
  await ff.writeFile(inputName, buf);
  await ff.exec([
    "-i", inputName,
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "20",
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    "-c:a", "aac",
    "-b:a", "192k",
    outputName,
  ]);
  const data = (await ff.readFile(outputName)) as Uint8Array;
  try { await ff.deleteFile(inputName); } catch {}
  try { await ff.deleteFile(outputName); } catch {}
  return new Blob([data as BlobPart], { type: "video/mp4" });
}