import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  assertExactModelAllowed,
  assertReceiptModelMatches,
  buildExactImageRequest,
  buildExactVideoRequest,
} from '../../supabase/functions/_shared/exactModel';
import { makeGenerationExecutors } from '../../supabase/functions/_shared/jeremyExecutors';

// The approved model string must reach the provider byte-for-byte. These tests
// inspect the OUTGOING request bodies and never touch a real provider.

const IMAGE_MODEL = 'google/gemini-3-pro-image-preview';
const VIDEO_MODEL = 'minimax/hailuo-3-standard';

describe('exact model allowlist', () => {
  it('returns the requested model unchanged when it is active', () => {
    expect(assertExactModelAllowed('video', VIDEO_MODEL, [VIDEO_MODEL])).toBe(VIDEO_MODEL);
  });

  it('refuses an unlisted model, an empty allowlist and a missing model', () => {
    expect(() => assertExactModelAllowed('video', 'bytedance/seedance-2.5', [VIDEO_MODEL])).toThrow(/not an active configured/i);
    expect(() => assertExactModelAllowed('video', VIDEO_MODEL, [])).toThrow(/No active video model is configured/i);
    expect(() => assertExactModelAllowed('static_image', '', [IMAGE_MODEL])).toThrow(/refusing to choose one implicitly/i);
  });

  it('never aliases a seedance model to a legacy alias', () => {
    expect(() => assertExactModelAllowed('video', 'seedance-pro', ['bytedance/seedance-2.5'])).toThrow();
  });
});

describe('provider request bodies carry the exact model', () => {
  it('image request contains only the exact model and no fallback chain', () => {
    const body = buildExactImageRequest({ exactModel: IMAGE_MODEL, contentParts: [{ type: 'text', text: 'hi' }] });
    expect(body.model).toBe(IMAGE_MODEL);
    expect(body.models).toEqual([IMAGE_MODEL]);
  });

  it('video request contains the exact model and pins the first frame', () => {
    const body = buildExactVideoRequest({
      exactModel: VIDEO_MODEL,
      prompt: 'A believable capital-raising hook',
      aspectRatio: '9:16',
      durationSeconds: 6,
      resolution: '1080p',
      firstFrameUrl: 'https://project.example/storage/v1/object/public/creatives/a.png',
    });
    expect(body.model).toBe(VIDEO_MODEL);
    expect(body.duration).toBe(6);
    expect((body.frame_images as unknown[]).length).toBe(1);
    expect(body.reference_images).toBeUndefined();
  });

  it('refuses frame images and reference images in the same request', () => {
    expect(() =>
      buildExactVideoRequest({
        exactModel: VIDEO_MODEL,
        prompt: 'x',
        firstFrameUrl: 'https://a/first.png',
        referenceImageUrls: ['https://a/ref.png'],
      }),
    ).toThrow(/cannot accept pinned frame images and subject reference images/i);
  });
});

describe('receipt model verification', () => {
  it('accepts an exact match and refuses a substitution or a silent receipt', () => {
    expect(() => assertReceiptModelMatches(VIDEO_MODEL, { model: VIDEO_MODEL })).not.toThrow();
    expect(() => assertReceiptModelMatches(VIDEO_MODEL, { model: 'minimax/hailuo-3-pro' })).toThrow(/refusing to accept/i);
    expect(() => assertReceiptModelMatches(VIDEO_MODEL, {})).toThrow(/did not report which model/i);
  });
});

describe('executors send the exact model to the generator endpoints', () => {
  const original = globalThis.fetch;
  let bodies: Array<{ url: string; body: Record<string, unknown> }>;

  beforeEach(() => {
    bodies = [];
    vi.stubEnv('SUPABASE_URL', 'https://project.example');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role');
    globalThis.fetch = vi.fn(async (url: any, init: any) => {
      const parsed = JSON.parse(String(init?.body ?? '{}'));
      bodies.push({ url: String(url), body: parsed });
      const isVideo = String(url).includes('generate-video-from-image');
      return {
        ok: true,
        status: 200,
        json: async () =>
          isVideo
            ? { videoUrl: 'https://provider.example/out.mp4', model: parsed.exactModel }
            : { imageUrl: 'https://provider.example/out.png', assetId: 'asset-1', model: parsed.exactModel },
      } as any;
    }) as any;
  });

  afterEach(() => {
    globalThis.fetch = original;
    vi.unstubAllEnvs();
  });

  it('image generation sends exactModel with byte-exact equality', async () => {
    const ex = makeGenerationExecutors({} as any);
    const res = await ex.generateImage({
      clientId: 'client-1', candidateId: 'cand-1', model: IMAGE_MODEL,
      prompt: 'A believable angle', aspectRatio: '1:1',
    } as any);
    expect(bodies[0].url).toContain('generate-static-ad');
    expect(bodies[0].body.exactModel).toBe(IMAGE_MODEL);
    expect(res.receipt.model).toBe(IMAGE_MODEL);
  });

  it('video generation sends exactModel with no seedance aliasing', async () => {
    const ex = makeGenerationExecutors({} as any);
    const res = await ex.generateVideo({
      clientId: 'client-1', candidateId: 'cand-1', model: 'bytedance/seedance-2.5',
      prompt: 'A believable angle', aspectRatio: '9:16', durationSeconds: 6,
      sourceFrameUrl: 'https://project.example/storage/v1/object/public/creatives/a.png',
    } as any);
    expect(bodies[0].url).toContain('generate-video-from-image');
    expect(bodies[0].body.exactModel).toBe('bytedance/seedance-2.5');
    expect(res.receipt.model).toBe('bytedance/seedance-2.5');
  });

  it('executors contain no legacy model aliasing', () => {
    const src = readFileSync('supabase/functions/_shared/jeremyExecutors.ts', 'utf8');
    expect(src).not.toMatch(/seedance-pro/);
    expect(src).toMatch(/exactModel: input\.model/);
  });
});
