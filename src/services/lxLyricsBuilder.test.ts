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

  it('原始酷我格式按文件级规则解析后续全正数行', () => {
    const result = buildLxLyricsRaw({
      lxlyric: [
        '[00:01.000]天<1000,1200>外<1600,1800>',
        '[00:02.000]来<-2000,6000>物<-1200,6800>',
      ].join('\n'),
    });

    expect(result).toBe([
      '[00:01.000]<00:01.100>天<00:01.700>外<00:01.800>',
      '[00:02.000]<00:02.000>来<00:02.800>物<00:06.800>',
    ].join('\n'));
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
