import { describe, it, expect } from 'vitest';
import { isRenderingEnabled, RENDERING_DISABLED_BODY } from '../../supabase/functions/_shared/hyperframesGuard.ts';

describe('HyperFrames rendering kill-switch', () => {
  it('is disabled when the flag is absent or empty', () => {
    expect(isRenderingEnabled(undefined)).toBe(false);
    expect(isRenderingEnabled(null)).toBe(false);
    expect(isRenderingEnabled('')).toBe(false);
  });

  it('is disabled for every non-exact value (no truthy coercion)', () => {
    for (const v of ['1', 'yes', 'TRUE', 'True', ' true', 'true ', 'enabled', 'false', '0'])
      expect(isRenderingEnabled(v)).toBe(false);
  });

  it('is enabled only for the exact string "true"', () => {
    expect(isRenderingEnabled('true')).toBe(true);
  });

  it('exposes a stable machine-readable denial code and leaks no credentials', () => {
    expect(RENDERING_DISABLED_BODY.code).toBe('rendering_disabled');
    expect(JSON.stringify(RENDERING_DISABLED_BODY).toLowerCase()).not.toContain('password');
  });
});
