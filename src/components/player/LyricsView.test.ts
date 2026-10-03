import { describe, expect, it } from 'vitest';

import { expectSourceContains, expectSourceNotContains } from '../../testing/sourceText';
import source from './LyricsView.vue?raw'; // 实现

describe('LyricsView', () => { // 实现
  it('passes enableWordEffect to convertLyricsToAmlLines and computes wordFadeWidth', () => { // 实现
    expectSourceContains(source, 'stylePrefs.enableWordEffect');
    expectSourceContains(source, 'const fadeWidth = computed');
    expectSourceContains(source, ':word-fade-width="fadeWidth"');
  });

  it('uses playerFontPreset directly as layout-version', () => { // 实现
    expectSourceContains(source, ':layout-version="stylePrefs.playerFontPreset"');
  });

  it('passes playback state into the word lyric player so word highlighting pauses with audio', () => {
    expect(source).toMatch(/const \{[^}]*\bisPlaying\b[^}]*\} = usePlayer\(\);/);
    expectSourceContains(source, ':playing="nowPlaying"');
  });

  it('uses lyricsSettings.playerLineGap directly for line-gap', () => { // 实现
    expectSourceContains(source, ':line-gap="stylePrefs.playerLineGap"');
  });

  it('uses seekTo from usePlayer for line click seeking', () => { // 实现
    expect(source).toMatch(/const \{[^}]*\bseekTo\b[^}]*\} = usePlayer\(\);/);
    expectSourceContains(source, 'await performSeek(targetSeconds);');
  });

  it('loads WordLyricPlayer via defineAsyncComponent', () => {
    expectSourceContains(source, 'defineAsyncComponent');
    expectSourceContains(source, "import('./WordLyricPlayer.vue')");
  });

  it('toggles word effect via a button', () => { // 实现
    expectSourceContains(source, 'flipWordEffect');
    expectSourceContains(source, '逐字歌词效果');
  });

  it('uses a readable blurred glass background for lyrics settings panels', () => { // 实现
    expect(source.match(/lyrics-settings-glass/g)?.length).toBeGreaterThanOrEqual(3); // 实现
    expectSourceContains(source, 'background: rgba(8, 8, 12, 0.74);');
    expectSourceContains(source, 'backdrop-filter: blur(32px) saturate(135%);');
    expectSourceNotContains(source, 'border-white/10 bg-black/30');
  });
});
