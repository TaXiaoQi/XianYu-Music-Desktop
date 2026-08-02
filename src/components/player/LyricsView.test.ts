import { describe, expect, it } from 'vitest';

import source from './LyricsView.vue?raw';

describe('LyricsView', () => {
  it('passes enableWordEffect to convertLyricsToAmlLines and computes wordFadeWidth', () => {
    expect(source).toContain('lyricsSettings.enableWordEffect');
    expect(source).toContain('const wordFadeWidth = computed');
    expect(source).toContain(':word-fade-width="wordFadeWidth"');
  });

  it('uses playerFontPreset directly as layout-version', () => {
    expect(source).toContain(':layout-version="lyricsSettings.playerFontPreset"');
  });

  it('passes playback state into AMLL so word highlighting pauses with audio', () => {
    expect(source).toContain('isPlaying } = usePlayer();');
    expect(source).toContain(':playing="isPlaying"');
  });

  it('uses lyricsSettings.playerLineGap directly for line-gap', () => {
    expect(source).toContain(':line-gap="lyricsSettings.playerLineGap"');
  });

  it('uses seekTo from usePlayer for line click seeking', () => {
    expect(source).toContain('const { seekTo, currentTime, isPlaying } = usePlayer();');
    expect(source).toContain('await seekTo(targetSeconds);');
  });

  it('loads AmlLyricPlayer via defineAsyncComponent', () => {
    expect(source).toContain('defineAsyncComponent');
    expect(source).toContain("import('./AmlLyricPlayer.vue')");
  });

  it('toggles word effect via a button', () => {
    expect(source).toContain('toggleWordEffect');
    expect(source).toContain('逐字歌词效果');
  });

  it('uses a readable blurred glass background for lyrics settings panels', () => {
    expect(source.match(/lyrics-settings-glass/g)?.length).toBeGreaterThanOrEqual(3);
    expect(source).toContain('background: rgba(10, 10, 14, 0.68);');
    expect(source).toContain('backdrop-filter: blur(32px) saturate(135%);');
    expect(source).not.toContain('border-white/10 bg-black/30');
  });
});
