/**
 * Robust audio capture for a <video> element so MediaRecorder can mix sound
 * into the exported file. Falls back through three strategies:
 *
 *  1. video.captureStream()'s audio tracks (Chrome/Edge — works when the
 *     source is same-origin or sent with proper CORS headers).
 *  2. WebAudio MediaElementAudioSourceNode → MediaStreamDestination (works
 *     in all evergreen browsers as long as crossOrigin is set + CORS ok).
 *
 * MediaElementAudioSourceNode can only be created ONCE per element, so the
 * resulting destination is cached on the element via a WeakMap.
 */
const cache = new WeakMap<HTMLMediaElement, {
  ctx: AudioContext;
  dest: MediaStreamAudioDestinationNode;
}>();

export function captureVideoAudioTracks(video: HTMLVideoElement): MediaStreamTrack[] {
  // Try native captureStream first.
  try {
    const v: any = video;
    const native: MediaStream | undefined =
      v.captureStream?.() || v.mozCaptureStream?.();
    const tracks = native?.getAudioTracks() ?? [];
    if (tracks.length) return tracks;
  } catch {
    // fall through to WebAudio path
  }

  // WebAudio fallback.
  try {
    let entry = cache.get(video);
    if (!entry) {
      const Ctor: typeof AudioContext =
        (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!Ctor) return [];
      const ctx = new Ctor();
      const source = ctx.createMediaElementSource(video);
      const dest = ctx.createMediaStreamDestination();
      // Route audio to BOTH the recorder AND the speakers so the user still hears it.
      source.connect(dest);
      source.connect(ctx.destination);
      entry = { ctx, dest };
      cache.set(video, entry);
    }
    // Resume context if it was suspended (autoplay policy).
    if (entry.ctx.state === "suspended") {
      entry.ctx.resume().catch(() => {});
    }
    return entry.dest.stream.getAudioTracks();
  } catch (err) {
    console.warn("captureVideoAudioTracks: WebAudio fallback failed", err);
    return [];
  }
}