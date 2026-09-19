import { describe, expect, it } from 'vitest';

import { isTraditionalLanguage, toTraditional } from './traditional';

describe('toTraditional', () => {
  it('converts simplified Chinese to traditional (Taiwan)', () => {
    expect(toTraditional('设置')).toBe('設定');
    expect(toTraditional('音乐库')).toBe('音樂庫');
    expect(toTraditional('播放队列')).toBe('播放佇列');
  });

  it('uses Taiwan-specific vocabulary', () => {
    expect(toTraditional('程序')).toBe('程式');
    expect(toTraditional('信息')).toBe('資訊');
  });

  it('returns empty and non-Han text unchanged', () => {
    expect(toTraditional('')).toBe('');
    expect(toTraditional('English text 123')).toBe('English text 123');
    expect(toTraditional('!@#$%')).toBe('!@#$%');
  });

  it('returns identical result on repeated calls (cache hit)', () => {
    const first = toTraditional('设置');
    const second = toTraditional('设置');
    expect(first).toBe(second);
    expect(second).toBe('設定');
  });

  it('detects the traditional language flag', () => {
    expect(isTraditionalLanguage('zh-TW')).toBe(true);
    expect(isTraditionalLanguage('zh-CN')).toBe(false);
    expect(isTraditionalLanguage('en-US')).toBe(false);
  });
});
