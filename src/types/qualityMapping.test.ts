/**
 * 音质映射权威源锁定测试。
 *
 * 权威源 = `types/index.ts` 的 QUALITY_META / ALL_QUALITY_KEYS / BAKA_TO_LEGACY_QUALITY_MAP
 * 及 qualityKeyTo* 系列映射函数。本测试把这些映射的**实际行为**逐档锁定，防止：
 *   - 调整 QUALITY_META 的 rank 顺序而让阈值边界静默偏移；
 *   - 增删档位后 qualityKeyToMfQuality 的分档错位（历史上出过 off-by-one：320k 被映成 low、
 *     flac 被映成 standard、flac24bit 被映成 high）。
 *
 * 注意与 Rust 侧测试夹具（src-tauri/src/plugin_host/mod.rs plugin_app_flow_live）对拍：
 * 该夹具注释的"应用侧编排三档键"（320k→high/128k→standard/flac→lossless）是**起播编排选档**
 * 的视角，与这里 qualityKeyToMfQuality（插件 MF 四级入参键 320k→standard）语义不同，勿混用。
 */

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

/**
 * MF（MusicFree / 时迁酱系）插件四级入参键 qualityKeyToMfQuality。
 * rank 边界硬编码于下，改动必须在语义上让本测试通过才算安全。
 */
describe('qualityKeyToMfQuality（MF 四级入参键）', () => {
  it('阈值边界锁定：<rank4→low、rank4→standard、rank5→high、>=rank6→super', () => {
    expect(qualityKeyToMfQuality('mgg')).toBe('low');
    expect(qualityKeyToMfQuality('128k')).toBe('low');
    expect(qualityKeyToMfQuality('192k')).toBe('low');
    // 防 off-by-one：320k 必须是 standard 而非 low/high
    expect(qualityKeyToMfQuality('320k')).toBe('standard');
    expect(qualityKeyToMfQuality('flac')).toBe('high');
    // >= rank 6 全部 super
    for (const q of ['flac24bit', 'hires', 'vinyl', 'master', 'dolby', 'atmos', 'atmos_plus']) {
      expect(qualityKeyToMfQuality(q)).toBe('super');
    }
  });
});

/** BakaMusic 新键 → 旧 MF 兼容键（语义不同于 qualityKeyToMfQuality，勿混用） */
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