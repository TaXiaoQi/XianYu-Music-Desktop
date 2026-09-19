
import { describe, expect, it } from 'vitest';
import {
  ALL_QUALITY_KEYS,
  BAKA_PLUGIN_QUALITY_KEYS,
  BAKA_TO_LEGACY_QUALITY_MAP,
  QUALITY_META,
  normalizeQualityKey,
  qualityKeyToBakaLegacyQuality,
  qualityKeyToBakaPluginQuality,
  qualityKeyToLxQuality,
  qualityKeyToMfQuality,
} from './index';

describe('QUALITY_META / ALL_QUALITY_KEYS', () => {
  it('覆盖全部 12 档且 rank 为 1..12 唯一递增', () => {
    expect(ALL_QUALITY_KEYS).toHaveLength(12);
    const ranks = ALL_QUALITY_KEYS.map(q => QUALITY_META[q].rank);
    expect(new Set(ranks).size).toBe(12);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(ranks[0]).toBe(1);
    expect(ranks[11]).toBe(12);
  });

  it('无损档位标记稳定（flac 起为无损，有损档位数不变）', () => {
    const lossless = ALL_QUALITY_KEYS.filter(q => QUALITY_META[q].isLossless);
    expect(lossless).toEqual(['flac', 'flac24bit', 'hires', 'vinyl', 'master']);
  });

  it('BAKA_PLUGIN_QUALITY_KEYS 仅 mgg→96k', () => {
    expect(BAKA_PLUGIN_QUALITY_KEYS).toHaveLength(12);
    expect(BAKA_PLUGIN_QUALITY_KEYS).toContain('96k');
    expect(BAKA_PLUGIN_QUALITY_KEYS).not.toContain('mgg');
  });
});

describe('qualityKeyToMfQuality（MF 四级入参键）', () => {
  it('阈值边界锁定：<rank4→low、rank4→standard、rank5→high、>=rank6→super', () => {
    expect(qualityKeyToMfQuality('mgg')).toBe('low');
    expect(qualityKeyToMfQuality('128k')).toBe('low');
    expect(qualityKeyToMfQuality('192k')).toBe('low');
    expect(qualityKeyToMfQuality('320k')).toBe('standard');
    expect(qualityKeyToMfQuality('flac')).toBe('high');
    for (const q of ['flac24bit', 'hires', 'vinyl', 'master', 'dolby', 'atmos', 'atmos_plus']) {
      expect(qualityKeyToMfQuality(q)).toBe('super');
    }
  });
});

describe('BAKA_TO_LEGACY_QUALITY_MAP / qualityKeyToBakaLegacyQuality', () => {
  it('显式锁定整表', () => {
    expect(BAKA_TO_LEGACY_QUALITY_MAP).toEqual({
      mgg: 'low',
      '128k': 'low',
      '192k': 'standard',
      '320k': 'high',
      flac: 'super',
      flac24bit: 'super',
      hires: 'super',
      vinyl: 'super',
      dolby: 'super',
      atmos: 'super',
      atmos_plus: 'super',
      master: 'super',
    });
  });
  it('qualityKeyToBakaLegacyQuality 与表一致', () => {
    for (const [q, legacy] of Object.entries(BAKA_TO_LEGACY_QUALITY_MAP) as [any, any][]) {
      expect(qualityKeyToBakaLegacyQuality(q)).toBe(legacy);
    }
  });
});

describe('qualityKeyToBakaPluginQuality / qualityKeyToLxQuality', () => {
  it('mgg→96k，其余原样', () => {
    expect(qualityKeyToBakaPluginQuality('mgg')).toBe('96k');
    expect(qualityKeyToBakaPluginQuality('320k')).toBe('320k');
    expect(qualityKeyToBakaPluginQuality('flac')).toBe('flac');
  });

  it('lx：mgg→128k，已识别档原样，未知→320k', () => {
    expect(qualityKeyToLxQuality('mgg')).toBe('128k');
    expect(qualityKeyToLxQuality('320k')).toBe('320k');
    expect(qualityKeyToLxQuality('flac')).toBe('flac');
  });
});

describe('normalizeQualityKey 别名', () => {
  it('常见别名稳定映射', () => {
    expect(normalizeQualityKey('96k')).toBe('mgg');
    expect(normalizeQualityKey('hi-res')).toBe('hires');
    expect(normalizeQualityKey('super')).toBe('flac');
    expect(normalizeQualityKey('exhigh')).toBe('320k');
  });
  it('非字符串返回 null', () => {
    expect(normalizeQualityKey(undefined)).toBeNull();
    expect(normalizeQualityKey(123)).toBeNull();
  });
});