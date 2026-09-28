import { describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';

import { applyDesktopLyricsVisibilityPreference, persistDesktopLyricsVisibilityPreference } from './visibilityPreference';

describe('desktop lyrics visibility preference sync', () => {
  it('writes the persisted visibility into the runtime ref', () => {
    const runtimeVisible = ref(false);

    applyDesktopLyricsVisibilityPreference(runtimeVisible, true);

    expect(runtimeVisible.value).toBe(true);
  });

  it('skips the settings patch while runtime visibility already matches', () => {
    const applyPatch = vi.fn();
    const initialSettings = { showDesktopLyrics: false };

    persistDesktopLyricsVisibilityPreference(initialSettings, applyPatch, true);
    persistDesktopLyricsVisibilityPreference({ showDesktopLyrics: true }, applyPatch, true);

    expect(applyPatch).toHaveBeenCalledTimes(1);
    expect(applyPatch).toHaveBeenCalledWith({ showDesktopLyrics: true });
  });
});
