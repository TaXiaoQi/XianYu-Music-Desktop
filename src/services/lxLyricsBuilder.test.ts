import { describe, expect, it } from 'vitest';

import { buildLxLyricsRaw } from './lxLyricsBuilder';

describe('buildLxLyricsRaw', () => {
  it('将字前逐字标签转换为 Enhanced LRC', () => {
    const result = buildLxLyricsRaw({
      lxlyric: '[00:10.000]<0,500>天<500,500>外',
    });

    expect(result).toBe('[00:10.000]<00:10.000>天<00:10.500>外<00:11.000>');
  });

  it('将字后逐字标签转换为 Enhanced LRC', () => {
    const result = buildLxLyricsRaw({
      lxlyric: '[00:10.000]天<0,500>外<500,500>',
    });

    expect(result).toBe('[00:10.000]<00:10.000>天<00:10.500>外<00:11.000>');
  });

  it('插件同时返回 yrc 和 lxlyric 时优先保留 yrc', () => {
    const result = buildLxLyricsRaw({
      yrc: '[10000,1000](10000,500,0)天(10500,500,0)外',
      lxlyric: '[00:10.000]<0,500>天<500,500>外',
    });

    expect(result).toBe('[10000,1000](10000,500,0)天(10500,500,0)外');
  });

  it('插件同时返回 qrc 和 lxlyric 时优先保留 qrc', () => {
    const result = buildLxLyricsRaw({
      qrc: '[10000,1000]天(0,500)外(500,500)',
      lxlyric: '[00:10.000]<0,500>天<500,500>外',
    });

    expect(result).toBe('[10000,1000]天(0,500)外(500,500)');
  });
});
