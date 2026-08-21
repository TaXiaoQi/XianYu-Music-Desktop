import { describe, expect, it } from 'vitest';

import { hasEnglishTranslation, toEnglish } from './english';

describe('legacy English interface translations', () => {
  it('translates common settings and playback labels', () => {
    expect(toEnglish('播放时阻止电脑睡眠')).toBe('Prevent sleep while playing');
    expect(toEnglish('选择默认播放音质')).toBe('Choose default playback quality');
    expect(toEnglish('播放队列为空')).toBe('The play queue is empty');
  });

  it('preserves surrounding layout whitespace', () => {
    expect(toEnglish('\n  下载目录  \n')).toBe('\n  Download folder  \n');
  });

  it('translates dynamic notifications', () => {
    expect(toEnglish('已添加 3 首歌曲到播放队列')).toBe('Added 3 songs to the queue');
    expect(toEnglish('发现 2 个插件可更新')).toBe('2 plugin updates available');
    expect(toEnglish('重新发送 (15s)')).toBe('Resend (15s)');
  });

  it('does not alter unknown text or user metadata', () => {
    expect(hasEnglishTranslation('本地音乐')).toBe(true);
    expect(toEnglish('稻香')).toBe('稻香');
  });

  it('translates nested-interpolation runtime strings', () => {
    expect(toEnglish('从 时迁酱 安装 3 个插件')).toBe('Installed 3 plugins from 时迁酱');
    expect(toEnglish('从 时迁酱 安装 3 个插件，1 个失败')).toBe(
      'Installed 3 plugins from 时迁酱, 1 failed',
    );
    expect(toEnglish('同步完成: 共安装 5 个插件')).toBe('Sync complete: installed 5 plugins');
    expect(toEnglish('同步完成: 共安装 5 个插件，1 个订阅失败')).toBe(
      'Sync complete: installed 5 plugins, 1 subscriptions failed',
    );
    expect(toEnglish('2小时')).toBe('2h');
    expect(toEnglish('2小时30分')).toBe('2h 30m');
    expect(toEnglish('Bilibili 视频信息解析失败')).toBe('Bilibili video info parsing failed');
    expect(toEnglish('Bilibili 视频流解析失败：风控')).toBe(
      'Bilibili video stream parsing failed: 风控',
    );
    expect(
      toEnglish('[B站m4s] host=api.bilibili.com Cookie=SESSDATA=abc Referer=x Origin=y'),
    ).toBe('[Bilibili m4s] host=api.bilibili.com Cookie=SESSDATA=abc Referer=x Origin=y');
    expect(toEnglish('请输入 UNC 共享路径，例如 \\\\NAS\\Music')).toBe(
      'Enter a UNC share path, e.g. \\\\NAS\\Music',
    );
  });
});
