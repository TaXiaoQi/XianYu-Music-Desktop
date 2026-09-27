import { describe, expect, it } from 'vitest';

import source from './LyricsView.vue?raw';

describe('LyricsView', () => {
  it('passes enableWordEffect to convertLyricsToAmlLines and computes wordFadeWidth', () => {
    expect(source).toContain('stylePrefs.enableWordEffect');
    expect(source).toContain('const fadeWidth = computed');
    expect(source).toContain(':word-fade-width="fadeWidth"');
  });

  it('uses playerFontPreset directly as layout-version', () => {
    expect(source).toContain(':layout-version="stylePrefs.playerFontPreset"');
  });

  it('passes playback state into the word lyric player so word highlighting pauses with audio', () => {
    expect(source).toMatch(/const \{[^}]*\bisPlaying\b[^}]*\} = usePlayer\(\);/);
    expect(source).toContain(':playing="nowPlaying"');
  });

  it('uses lyricsSettings.playerLineGap directly for line-gap', () => {
    expect(source).toContain(':line-gap="stylePrefs.playerLineGap"');
  });

  it('uses seekTo from usePlayer for line click seeking', () => {
    expect(source).toMatch(/const \{[^}]*\bseekTo\b[^}]*\} = usePlayer\(\);/);
    expect(source).toContain('await performSeek(targetSeconds);');
  });

  it('loads WordLyricPlayer via defineAsyncComponent', () => {
    expect(source).toContain('defineAsyncComponent');
    expect(source).toContain("import('./WordLyricPlayer.vue')");
  });

  it('toggles word effect via a button', () => {
    expect(source).toContain('flipWordEffect');
    expect(source).toContain('逐字歌词效果');
  });

  it('uses a readable blurred glass background for lyrics settings panels', () => {
    expect(source.match(/lyrics-settings-glass/g)?.length).toBeGreaterThanOrEqual(3);
    expect(source).toContain('background: rgba(8, 8, 12, 0.74);');
    expect(source).toContain('backdrop-filter: blur(32px) saturate(135%);');
    expect(source).not.toContain('border-white/10 bg-black/30');
  });
});
