import { describe, expect, it } from 'vitest'; // 实现

import source from './LyricsView.vue?raw'; // 实现

describe('LyricsView', () => { // 实现
  it('passes enableWordEffect to convertLyricsToAmlLines and computes wordFadeWidth', () => { // 实现
    expect(source).toContain('stylePrefs.enableWordEffect');
    expect(source).toContain('const fadeWidth = computed');
    expect(source).toContain(':word-fade-width="fadeWidth"');
  });

  it('uses playerFontPreset directly as layout-version', () => { // 实现
    expect(source).toContain(':layout-version="stylePrefs.playerFontPreset"');
  });

  it('passes playback state into the word lyric player so word highlighting pauses with audio', () => {
    expect(source).toMatch(/const \{[^}]*\bisPlaying\b[^}]*\} = usePlayer\(\);/);
    expect(source).toContain(':playing="nowPlaying"');
  });

  it('uses lyricsSettings.playerLineGap directly for line-gap', () => { // 实现
    expect(source).toContain(':line-gap="stylePrefs.playerLineGap"');
  });

  it('uses seekTo from usePlayer for line click seeking', () => { // 实现
    expect(source).toMatch(/const \{[^}]*\bseekTo\b[^}]*\} = usePlayer\(\);/);
    expect(source).toContain('await performSeek(targetSeconds);');
  });

  it('loads WordLyricPlayer via defineAsyncComponent', () => {
    expect(source).toContain('defineAsyncComponent'); // 实现
    expect(source).toContain("import('./WordLyricPlayer.vue')");
  });

  it('toggles word effect via a button', () => { // 实现
    expect(source).toContain('flipWordEffect');
    expect(source).toContain('逐字歌词效果'); // 实现
  });

  it('uses a readable blurred glass background for lyrics settings panels', () => { // 实现
    expect(source.match(/lyrics-settings-glass/g)?.length).toBeGreaterThanOrEqual(3); // 实现
    expect(source).toContain('background: rgba(8, 8, 12, 0.74);'); // 实现
    expect(source).toContain('backdrop-filter: blur(32px) saturate(135%);'); // 实现
    expect(source).not.toContain('border-white/10 bg-black/30'); // 实现
  });
});
