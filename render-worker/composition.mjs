const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const number = (v, fallback, min, max) => Number.isFinite(Number(v)) ? Math.max(min, Math.min(max, Number(v))) : fallback;
const color = value => /^#[0-9a-f]{3,8}$/i.test(value || '') ? value : '#ffffff';
const font = value => ['Arial', 'Inter', 'Helvetica', 'Georgia', 'Verdana'].includes(value) ? value : 'Arial';

// Trusted template only: no user HTML, JavaScript, CSS, selectors, or remote scripts.
export function buildComposition(spec, media) {
  const width = spec.aspectRatio === '16:9' ? 1920 : 1080;
  const height = spec.aspectRatio === '9:16' ? 1920 : 1080;
  let start = 0;
  const clips = spec.clips.map((clip, i) => {
    const duration = (clip.trimEnd - clip.trimStart) / clip.speed;
    const timing = `data-start="${start}" data-duration="${duration}" data-media-start="${clip.trimStart}" data-playback-rate="${clip.speed}"`;
    const markup = `<video id="video-${i}" src="assets/clip-${i}.mp4" ${timing} data-track-index="0" muted playsinline></video>` +
      (media[i].hasAudio && clip.volume > 0 ? `<audio id="audio-${i}" src="assets/clip-${i}.mp4" ${timing} data-track-index="10" data-volume="${clip.volume}"></audio>` : '');
    start += duration;
    return markup;
  });
  const settings = spec.captionSettings;
  const position = settings.position === 'top' ? 'flex-start' : settings.position === 'center' ? 'center' : 'flex-end';
  const captions = settings.style === 'none' ? [] : spec.captions.map((caption, i) => `<div id="caption-${i}" class="clip caption" data-start="${caption.startTime}" data-duration="${caption.endTime - caption.startTime}" data-track-index="1"><span>${escape(caption.text)}</span></div>`);
  const overlays = spec.textOverlays.map((overlay, i) => `<div id="text-${i}" class="clip overlay" data-start="${overlay.startTime}" data-duration="${overlay.endTime - overlay.startTime}" data-track-index="2"><span style="left:${number(overlay.x, 50, 0, 100)}%;top:${number(overlay.y, 50, 0, 100)}%;font-size:${number(overlay.fontSize, 32, 8, 200) * width / 480}px;font-family:${font(overlay.fontFamily)};color:${color(overlay.color)};font-weight:${overlay.fontWeight === 'bold' ? 'bold' : 'normal'};opacity:${number(overlay.opacity, 1, 0, 1)};${overlay.background ? `background:${color(overlay.background)};` : ''}">${escape(overlay.text)}</span></div>`);
  const vo = spec.voiceoverUrl ? `<audio id="voiceover" src="assets/voiceover" data-start="0" data-duration="${start}" data-track-index="11" data-volume="${spec.voiceoverVolume ?? 0.8}"></audio>` : '';
  return `<!doctype html><html lang="en"><head><meta charset="UTF-8"><title>Reporting video edit</title><script src="assets/gsap.min.js"></script><style>
body{margin:0;background:#000;color:#fff;font-family:Arial,sans-serif}#root{position:relative;width:${width}px;height:${height}px;overflow:hidden;background:#000}
video{position:absolute;inset:0;width:100%;height:100%;object-fit:contain}.clip{position:absolute;inset:0;width:100%;height:100%;box-sizing:border-box}
.caption{z-index:2;display:flex;align-items:${position};justify-content:center;padding:10% 7%;text-align:center;pointer-events:none}
.caption span{max-width:100%;overflow-wrap:anywhere;font-size:${number(settings.fontSize, 32, 8, 200) * width / 480}px;font-family:${font(settings.fontFamily)};font-weight:bold;color:${color(settings.color)};${settings.stroke ? 'text-shadow:0 2px 5px #000,-2px 0 3px #000,2px 0 3px #000;' : ''}${settings.background || settings.style === 'boxed' ? 'background:#000;padding:16px 24px;border-radius:12px;' : ''}}
.overlay{z-index:3;pointer-events:none}.overlay span{position:absolute;transform:translate(-50%,-50%);max-width:90%;overflow-wrap:anywhere;text-align:center}
</style></head><body><div id="root" data-composition-id="main" data-width="${width}" data-height="${height}" data-duration="${start}">${clips.join('')}${captions.join('')}${overlays.join('')}${vo}</div><script>const tl=gsap.timeline({paused:true});window.__timelines["main"]=tl;</script></body></html>`;
}
