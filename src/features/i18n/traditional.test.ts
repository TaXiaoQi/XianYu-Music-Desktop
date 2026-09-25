import { describe, expect, it } from 'vitest';

import { isTraditionalLanguage, toSimplified, toTraditional } from './traditional';

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

describe('toSimplified', () => {
  it('能把台湾用语换回大陆用语', () => {
    expect(toSimplified('資訊')).toBe('信息');
    expect(toSimplified('程式')).toBe('程序');
  });

  it('它是词汇替换表，不可用于基准简体文案（回归：侧边栏曾显示「文档夹」）', () => {
    // 台湾的「文件」指 document，大陆的「文档」才是 document，
    // 所以反查表会把大陆语境的「文件夹」改写成「文档夹」。
    // useGlobalInterfaceLanguage 在 zh-CN 下已不再调用本函数，理由见该文件注释。
    expect(toSimplified('文件夹')).toBe('文档夹');
    expect(toSimplified('音频文件')).toBe('音频文档');
    expect(toSimplified('文件关联')).toBe('文档关联');
  });
});
