import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRenderSpec, canonicalSpec } from '../supabase/functions/_shared/hyperframes-spec.mjs';
import { buildComposition } from './composition.mjs';
const origin = 'https://example.supabase.co';
const client = '123';
const fixture = () => ({
  aspectRatio: '9:16',
  clips: [{ sourceUrl: `${origin}/storage/v1/object/public/creatives/${client}/source.mp4`, trimStart: 2, trimEnd: 6, speed: 2, volume: 1, transition: 'none' }],
  captions: [{ text: 'Safe caption', startTime: 0, endTime: 2 }],
  textOverlays: [], captionSettings: { style: 'boxed', fontSize: 32, color: '#ffffff', position: 'bottom' }, voiceoverVolume: 0.8,
});
test('duration accounts for trims and speed', () => assert.equal(validateRenderSpec(fixture(), origin, client), 2));
test('rejects cross-client, external, traversal and signed-query media URLs', () => {
  for (const sourceUrl of ['http://localhost:8080/private', `${origin}/storage/v1/object/public/creatives/other/a.mp4`, `${origin}/storage/v1/object/public/creatives/123/../other/a.mp4`, `${origin}/storage/v1/object/public/creatives/123/a.mp4?token=secret`]) {
    const spec = fixture(); spec.clips[0].sourceUrl = sourceUrl;
    assert.throws(() => validateRenderSpec(spec, origin, client));
  }
});
test('rejects invalid durations and non-finite values', () => {
  for (const updates of [{speed:0}, {trimEnd:1}, {trimStart:NaN}, {volume:Infinity}]) {
    const spec = fixture(); Object.assign(spec.clips[0], updates);
    assert.throws(() => validateRenderSpec(spec, origin, client));
  }
});
test('unsupported effects are rejected rather than silently omitted', () => {
  const spec = fixture(); spec.clips[0].transition = 'crossfade';
  assert.throws(() => validateRenderSpec(spec, origin, client), /transitions/);
  spec.clips[0].transition = 'none'; spec.captionSettings.style = 'karaoke';
  assert.throws(() => validateRenderSpec(spec, origin, client), /captions/);
});
test('compiler preserves picture/audio source range, speed and duration', () => {
  const html = buildComposition(fixture(), [{hasAudio:true}]);
  assert.match(html, /data-width="1080" data-height="1920" data-duration="2"/);
  assert.equal((html.match(/data-media-start="2" data-playback-rate="2"/g) || []).length, 2);
  assert.match(html, /<audio id="audio-0"/);
  assert.doesNotMatch(html, /crossorigin/);
});
test('silent media produces no nonexistent audio track', () => assert.doesNotMatch(buildComposition(fixture(), [{hasAudio:false}]), /<audio/));
test('caption text and overlay styles cannot inject scripts', () => {
  const spec = fixture(); spec.captions[0].text = '<script>alert("x")</script>';
  spec.textOverlays = [{text:'<img src=x>', startTime:0, endTime:1, fontFamily:'Arial; background:url(https://attacker)', color:'red;}</style><script>x</script>'}];
  const html = buildComposition(spec,[{hasAudio:false}]);
  assert.match(html, /&lt;script&gt;/); assert.doesNotMatch(html, /attacker|<img src=x>|<script>x/);
});
test('idempotency treats JSONB key reordering as identical', () => assert.equal(canonicalSpec({b:2,a:1}), canonicalSpec({a:1,b:2})));
