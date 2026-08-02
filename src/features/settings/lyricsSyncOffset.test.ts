import { describe, expect, it } from 'vitest';

import audioOutputSource from '../../components/settings/SettingsAudioOutput.vue?raw';
import desktopLyricsSource from '../../components/settings/SettingsDesktopLyrics.vue?raw';
import {
  LYRICS_SYNC_OFFSET_MAX_MS,
  LYRICS_SYNC_OFFSET_MIN_MS,
  LYRICS_SYNC_OFFSET_STEP_MS,
  normalizeLyricsSyncOffsetMs,
} from './lyricsSyncOffset';

describe('lyrics sync offset settings', () => {
  it('uses a -100ms to 100ms range with 5ms increments', () => {
    expect(LYRICS_SYNC_OFFSET_MIN_MS).toBe(-100);
    expect(LYRICS_SYNC_OFFSET_MAX_MS).toBe(100);
    expect(LYRICS_SYNC_OFFSET_STEP_MS).toBe(5);
    expect(normalizeLyricsSyncOffsetMs(-103)).toBe(-100);
    expect(normalizeLyricsSyncOffsetMs(103)).toBe(100);
    expect(normalizeLyricsSyncOffsetMs(12)).toBe(10);
    expect(normalizeLyricsSyncOffsetMs(13)).toBe(15);
  });

  it.each([audioOutputSource, desktopLyricsSource])('places 5ms decrement and increment controls around the slider', (source) => {
    expect(source).toContain('aria-label="歌词偏移减少 5 毫秒"');
    expect(source).toContain('@click="adjustLyricsSyncOffset(-LYRICS_SYNC_OFFSET_STEP_MS)"');
    expect(source).toContain('aria-label="歌词偏移增加 5 毫秒"');
    expect(source).toContain('@click="adjustLyricsSyncOffset(LYRICS_SYNC_OFFSET_STEP_MS)"');
  });
});
