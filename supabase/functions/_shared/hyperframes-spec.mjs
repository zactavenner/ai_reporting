export function canonicalSpec(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalSpec).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonicalSpec(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}

export function validateRenderSpec(spec, storageUrl, clientId) {
  if (!spec || !['9:16', '16:9', '1:1'].includes(spec.aspectRatio)) throw new Error('Choose a supported aspect ratio');
  if (!Array.isArray(spec.clips) || !spec.clips.length || spec.clips.length > 50) throw new Error('A render needs 1–50 clips');
  const prefix = `/storage/v1/object/public/creatives/${clientId}/`;
  const checkSource = source => {
    const url = new URL(source);
    if (url.origin !== new URL(storageUrl).origin || !url.pathname.startsWith(prefix) || url.search || url.hash || /%2f|%2e|%5c/i.test(url.pathname)) {
      throw new Error('Render media must be uploaded to this client’s Creative Assets storage');
    }
  };
  const finite = (v, min, max) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
  let duration = 0;
  for (const clip of spec.clips) {
    checkSource(clip.sourceUrl);
    if (!finite(clip.trimStart, 0, 3600) || !finite(clip.trimEnd, 0, 3600) || clip.trimEnd <= clip.trimStart ||
        !finite(clip.speed, 0.25, 4) || !finite(clip.volume, 0, 2)) throw new Error('Invalid clip trim, speed, or volume');
    if (clip.transition && clip.transition !== 'none') throw new Error('HyperFrames transitions are not enabled yet. Set FX to None before rendering');
    duration += (clip.trimEnd - clip.trimStart) / clip.speed;
  }
  if (duration > 600) throw new Error('Render duration exceeds the 10-minute limit');
  if (spec.voiceoverUrl) checkSource(spec.voiceoverUrl);
  if (!finite(spec.voiceoverVolume ?? 0.8, 0, 2)) throw new Error('Invalid voiceover volume');
  for (const field of ['captions', 'textOverlays']) {
    if (!Array.isArray(spec[field]) || spec[field].length > 1000) throw new Error(`Invalid ${field}`);
    for (const item of spec[field]) {
      if (typeof item.text !== 'string' || item.text.length > 2000 || !finite(item.startTime, 0, duration) ||
          !finite(item.endTime, 0, duration + 0.05) || item.endTime <= item.startTime) throw new Error(`Invalid ${field} timing or text`);
    }
  }
  if (!['none', 'classic', 'minimal', 'boxed'].includes(spec.captionSettings?.style)) throw new Error('Use Classic, Minimal, Boxed, or no captions for HyperFrames rendering');
  if (spec.textOverlays.some(t => t.animation && t.animation !== 'none')) throw new Error('Animated text is not enabled yet. Set text animation to None');
  return duration;
}
