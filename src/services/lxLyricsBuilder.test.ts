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

    // 酷我 <a,b> 解码结果为相对行首时间，必须加上行首时间得到绝对时间
    expect(result).toBe([
      '[00:01.000]<00:02.100>天<00:02.700>外<00:02.800>',
      '[00:02.000]<00:04.000>来<00:04.800>物<00:08.800>',
    ].join('\n'));
  });

  it('带 [kuwo:] 标签时全文统一按酷我公式解析', () => {
    const result = buildLxLyricsRaw({
      lxlyric: [
        '[kuwo:0]',
        '[00:01.000]天<1000,1200>外<1600,1800>',
      ].join('\n'),
    });

    expect(result).toBe('[00:01.000]<00:02.100>天<00:02.700>外<00:02.800>');
  });

  it('真实酷我数据：后续行首字 offset 归零，逐字落在行首绝对时间', () => {
    const result = buildLxLyricsRaw({
      lxlyric: [
        '[kuwo:044]',
        '[00:03.875]<1146,-1146>词：<1659,-513>米<2130,102>果',
      ].join('\n'),
    });

    // [kuwo:044] → 八进制 36 → offset=3, offset2=6
    // 词：相对0 → 绝对 3875；米：相对191 → 4066；果：相对372 → 4247
    expect(result).toBe('[00:03.875]<00:03.875>词：<00:04.066>米<00:04.247>果<00:04.416>');
  });

  it('混合标准相对偏移时后续行仍保持逐字解析', () => {
    const result = buildLxLyricsRaw({
      lxlyric: [
        '[00:10.000]前<-100,300>奏<200,300>',
        '[00:12.000]<0,400>天<400,400>龙<800,400>八<1200,400>部',
      ].join('\n'),
    });

    expect(result).toBe([
      '[00:10.000]<00:09.900>前<00:10.200>奏<00:10.500>',
      '[00:12.000]<00:12.000>天<00:12.400>龙<00:12.800>八<00:13.200>部<00:13.600>',
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

  it('插件把逐字放在 lyric 字段（LX 原生标记）时转为 Enhanced LRC', () => {
    const result = buildLxLyricsRaw({
      lyric: '[00:10.000]<0,500>天<500,500>外',
    });

    expect(result).toBe('[00:10.000]<00:10.000>天<00:10.500>外<00:11.000>');
  });

  it('插件把逐字放在 lyric 字段（yrc 风格）时原样保留', () => {
    const result = buildLxLyricsRaw({
      lyric: '[10000,1000](10000,500,0)天(10500,500,0)外',
    });

    expect(result).toBe('[10000,1000](10000,500,0)天(10500,500,0)外');
  });

  it('插件 lyric 字段无逐字标记时原样保留普通 LRC', () => {
    const result = buildLxLyricsRaw({
      lyric: '[00:10.00]天外',
    });

    expect(result).toBe('[00:10.00]天外');
  });
});
