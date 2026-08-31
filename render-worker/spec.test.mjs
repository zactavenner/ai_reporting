import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalSpec, validateRenderSpec } from '../supabase/functions/_shared/hyperframes-spec.mjs';

const STORAGE = 'https://jgwwmtuvjlmzapwqiabu.supabase.co';
const CLIENT = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const source = (client = CLIENT, file = 'hyperframes/a/sources/clip-0.mp4') =>
  `${STORAGE}/storage/v1/object/public/creatives/${client}/${file}`;

const baseSpec = (overrides = {}) => ({
  aspectRatio: '9:16',
  clips: [{ sourceUrl: source(), trimStart: 0, trimEnd: 4, speed: 1, volume: 1, transition: 'none' }],
  captions: [],
  textOverlays: [],
  captionSettings: { style: 'classic', fontSize: 32, color: '#ffffff', fontFamily: 'Arial', position: 'bottom', stroke: true, background: false },
  voiceoverUrl: null,
  voiceoverVolume: 0.8,
  ...overrides,
});

test('accepts a supported spec and returns its duration', () => {
  assert.equal(validateRenderSpec(baseSpec(), STORAGE, CLIENT), 4);
});

test('denies media belonging to another client', () => {
  const spec = baseSpec();
  spec.clips[0].sourceUrl = source(OTHER);
  assert.throws(() => validateRenderSpec(spec, STORAGE, CLIENT), /Creative Assets storage/);
});

test('denies off-origin, query-string and traversal media URLs', () => {
  for (const url of [
    'https://evil.example.com/storage/v1/object/public/creatives/' + CLIENT + '/a.mp4',
    source() + '?token=abc',
    `${STORAGE}/storage/v1/object/public/creatives/${CLIENT}/..%2f..%2fsecret.mp4`,
  ]) {
    const spec = baseSpec();
    spec.clips[0].sourceUrl = url;
    assert.throws(() => validateRenderSpec(spec, STORAGE, CLIENT));
  }
});

test('rejects unsupported effects instead of dropping them', () => {
  const transitions = baseSpec();
  transitions.clips[0].transition = 'fade';
  assert.throws(() => validateRenderSpec(transitions, STORAGE, CLIENT), /transitions are not enabled/);

  const animated = baseSpec({ textOverlays: [{ text: 'Hi', startTime: 0, endTime: 1, animation: 'slide' }] });
  assert.throws(() => validateRenderSpec(animated, STORAGE, CLIENT), /Animated text is not enabled/);

  const style = baseSpec();
  style.captionSettings.style = 'karaoke';
  assert.throws(() => validateRenderSpec(style, STORAGE, CLIENT), /Classic, Minimal, Boxed/);
});

test('rejects invalid trims, aspect ratios, clip counts and durations', () => {
  assert.throws(() => validateRenderSpec(baseSpec({ aspectRatio: '4:5' }), STORAGE, CLIENT), /aspect ratio/);
  assert.throws(() => validateRenderSpec(baseSpec({ clips: [] }), STORAGE, CLIENT), /1–50 clips/);
  const bad = baseSpec();
  bad.clips[0].trimEnd = 0;
  assert.throws(() => validateRenderSpec(bad, STORAGE, CLIENT), /trim, speed, or volume/);
  const long = baseSpec({
    clips: Array.from({ length: 40 }, () => ({ sourceUrl: source(), trimStart: 0, trimEnd: 60, speed: 1, volume: 1, transition: 'none' })),
  });
  assert.throws(() => validateRenderSpec(long, STORAGE, CLIENT), /10-minute limit/);
});

test('canonicalSpec is order-independent so re-submits are idempotent', () => {
  const a = { aspectRatio: '9:16', clips: [{ speed: 1, trimEnd: 4, trimStart: 0 }] };
  const b = { clips: [{ trimStart: 0, trimEnd: 4, speed: 1 }], aspectRatio: '9:16' };
  assert.equal(canonicalSpec(a), canonicalSpec(b));
});

test('canonicalSpec detects any real spec change', () => {
  const changed = baseSpec({ voiceoverVolume: 0.5 });
  assert.notEqual(canonicalSpec(baseSpec()), canonicalSpec(changed));
});
