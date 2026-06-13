import { describe, it, expect } from 'vitest';
import {
  createImageGeneratorData,
  createVideoGeneratorData,
  createPromptGeneratorData,
  createImageToVideoData,
  createAvatarSceneData,
  createSceneCombinerData,
  createImageCombinerData,
  createHooksData,
  NODE_CREDITS,
} from '@/types/flowboard';

describe('Flowboard node data factories', () => {
  it('createImageGeneratorData returns correct defaults', () => {
    const data = createImageGeneratorData();
    expect(data.label).toBe('Image Generator');
    expect(data.status).toBe('idle');
    expect(data.prompt).toBe('');
    expect(data.aspectRatio).toBe('1:1');
    expect(data.outputFormat).toBe('png');
    expect(data.variationCount).toBe(1);
    expect(data.generatedImageUrl).toBeUndefined();
  });

  it('createVideoGeneratorData returns correct defaults', () => {
    const data = createVideoGeneratorData();
    expect(data.label).toBe('Video Generator');
    expect(data.status).toBe('idle');
    expect(data.duration).toBe(8);
    expect(data.aspectRatio).toBe('16:9');
  });

  it('createPromptGeneratorData returns correct defaults', () => {
    const data = createPromptGeneratorData();
    expect(data.model).toBe('openrouter/owl-alpha');
    expect(data.context).toBe('');
    expect(data.inputPrompt).toBe('');
    expect(data.outputPrompt).toBeUndefined();
  });

  it('createImageToVideoData returns correct defaults', () => {
    const data = createImageToVideoData();
    expect(data.cameraMotion).toBe('none');
    expect(data.videoModel).toBe('veo3');
    expect(data.duration).toBe(8);
  });

  it('createAvatarSceneData returns 4 default scenes', () => {
    const data = createAvatarSceneData();
    expect(data.scenes).toHaveLength(4);
    expect(data.scenes.map(s => s.angle)).toEqual([
      'close-up', 'medium', 'wide', 'side-profile',
    ]);
    data.scenes.forEach(scene => {
      expect(scene.status).toBe('idle');
      expect(scene.duration).toBe(8);
    });
  });

  it('createSceneCombinerData returns empty inputs', () => {
    const data = createSceneCombinerData();
    expect(data.inputVideos).toEqual([]);
    expect(data.transitionType).toBe('cut');
    expect(data.captionStyle).toBe('none');
  });

  it('createImageCombinerData returns correct defaults', () => {
    const data = createImageCombinerData();
    expect(data.combineMode).toBe('blend');
    expect(data.backgroundOption).toBe('keep');
    expect(data.variationCount).toBe(1);
  });

  it('createHooksData returns empty tracks and avatars', () => {
    const data = createHooksData();
    expect(data.label).toBe('Hooks A/B');
    expect(data.script).toBe('');
    expect(data.aspectRatio).toBe('9:16');
    expect(data.avatars).toEqual([]);
    expect(data.tracks).toEqual([]);
  });

  it('every factory returns idle status', () => {
    const factories = [
      createImageGeneratorData,
      createVideoGeneratorData,
      createPromptGeneratorData,
      createImageToVideoData,
      createAvatarSceneData,
      createSceneCombinerData,
      createImageCombinerData,
      createHooksData,
    ];
    factories.forEach(fn => {
      expect(fn().status).toBe('idle');
    });
  });

  it('NODE_CREDITS has entries for all node types', () => {
    const expectedTypes = [
      'image-generator', 'video-generator', 'prompt-generator',
      'image-to-video', 'avatar-scene', 'scene-combiner',
      'image-combiner', 'hooks',
    ];
    expectedTypes.forEach(type => {
      expect(NODE_CREDITS[type as keyof typeof NODE_CREDITS]).toBeGreaterThan(0);
    });
  });
});
