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
});
