import { describe, it, expect } from 'vitest';
import {
  DEFAULT_META_VERSION,
  META_VERSION,
  buildTargeting,
  isRestrictedCategory,
  stagesToRun,
  validateLaunch,
} from '../../supabase/functions/_shared/metaLaunchValidation';

const baseLaunch = {
  name: 'Q3 Capital Raise',
  objective: 'leads',
  daily_budget_cents: 5000,
  cta: 'LEARN_MORE',
  destination_url: 'https://example.com/apply',
  primary_text: 'Targeted returns for accredited investors.',
  headline: 'Invest with us',
  page_id: '123456789',
  pixel_id: '987654321',
  countries: ['US'],
  age_min: 30,
  age_max: 65,
  special_ad_category: 'NONE',
  creative_url: 'https://cdn.example.com/ad.mp4',
  creative_type: 'video',
};

describe('Meta Graph version', () => {
  it('defaults to v24.0', () => {
    expect(DEFAULT_META_VERSION).toBe('v24.0');
    expect(META_VERSION).toBe('v24.0');
  });
});

describe('validateLaunch', () => {
  it('accepts a complete launch', () => {
    expect(validateLaunch(baseLaunch)).toEqual([]);
  });

  it('flags budget, page, pixel, url and creative problems', () => {
    const errors = validateLaunch({
      ...baseLaunch,
      daily_budget_cents: 100,
      page_id: 'abc',
      pixel_id: 'xyz',
      destination_url: 'not-a-url',
      creative_url: '',
      creative_type: 'gif',
    });
    expect(errors.length).toBeGreaterThanOrEqual(5);
    expect(errors.join(' ')).toMatch(/Daily budget/);
    expect(errors.join(' ')).toMatch(/Page ID/);
  });

  it('ignores age validation for restricted categories', () => {
    const errors = validateLaunch({
      ...baseLaunch,
      special_ad_category: 'CREDIT',
      age_min: undefined as unknown as number,
      age_max: undefined as unknown as number,
    });
    expect(errors).toEqual([]);
  });
});

describe('restricted special ad categories', () => {
  it('classifies categories', () => {
    expect(isRestrictedCategory('NONE')).toBe(false);
    expect(isRestrictedCategory('HOUSING')).toBe(true);
    expect(isRestrictedCategory('FINANCIAL_PRODUCTS_SERVICES')).toBe(true);
  });

  it('never sends operator age targeting for restricted categories', () => {
    const targeting = buildTargeting({ ...baseLaunch, special_ad_category: 'EMPLOYMENT' });
    expect(targeting).toEqual({ geo_locations: { countries: ['US'] } });
    expect('age_min' in targeting).toBe(false);
    expect('age_max' in targeting).toBe(false);
  });

  it('keeps age targeting for unrestricted campaigns', () => {
    expect(buildTargeting(baseLaunch)).toEqual({
      geo_locations: { countries: ['US'] },
      age_min: 30,
      age_max: 65,
    });
  });
});

describe('stagesToRun (retry skipping)', () => {
  it('runs every stage for a fresh launch', () => {
    expect(stagesToRun({})).toEqual(['campaign', 'adset', 'media', 'creative', 'ad']);
  });

  it('skips stages whose Meta objects already exist', () => {
    expect(stagesToRun({ meta_campaign_id: '1', meta_adset_id: '2', meta_video_id: '3' }))
      .toEqual(['creative', 'ad']);
  });

  it('treats an image hash as satisfied media', () => {
    expect(stagesToRun({ meta_campaign_id: '1', meta_adset_id: '2', meta_image_hash: 'h' }))
      .toEqual(['creative', 'ad']);
  });

  it('returns nothing when the ad already exists', () => {
    expect(stagesToRun({
      meta_campaign_id: '1', meta_adset_id: '2', meta_image_hash: 'h',
      meta_creative_id: '4', meta_ad_id: '5',
    })).toEqual([]);
  });
});