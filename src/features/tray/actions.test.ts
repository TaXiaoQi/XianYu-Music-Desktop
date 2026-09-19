import { ref } from 'vue';
import { describe, expect, it, vi } from 'vitest';

import { handleTrayMenuAction, type TrayMenuActionDeps } from './actions';

const createDeps = (overrides: Partial<TrayMenuActionDeps> = {}): TrayMenuActionDeps => {
  const playMode = ref(0);
  const isMiniMode = ref(false);
  const showDesktopLyrics = ref(false);
  return {
    prevSong: vi.fn(),
    togglePlay: vi.fn().mockResolvedValue(undefined),
    nextSong: vi.fn(),
    playMode,
    cyclePlayMode: vi.fn(() => { playMode.value = 2; }),
    isMiniMode,
    showDesktopLyrics,
    revealMainWindow: vi.fn().mockResolvedValue(undefined),
    openSettings: vi.fn().mockResolvedValue(undefined),
    quitApp: vi.fn().mockResolvedValue(undefined),
    toggleFavorite: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
};

describe('tray menu actions', () => {
  it('maps playback control actions to playback handlers', async () => {
    const deps = createDeps();

    await handleTrayMenuAction('prev-song', deps);
    await handleTrayMenuAction('toggle-play', deps);
    await handleTrayMenuAction('next-song', deps);

    expect(deps.prevSong).toHaveBeenCalledTimes(1);
    expect(deps.togglePlay).toHaveBeenCalledTimes(1);
    expect(deps.nextSong).toHaveBeenCalledTimes(1);
  });

  it('applies tray-only state actions', async () => {
    const deps = createDeps();

    await handleTrayMenuAction('cycle-play-mode', deps);
    await handleTrayMenuAction('show-mini-player', deps);
    await handleTrayMenuAction('open-desktop-lyrics', deps);
    await handleTrayMenuAction('open-settings', deps);

    expect(deps.playMode.value).toBe(2);
    expect(deps.isMiniMode.value).toBe(false);
    expect(deps.showDesktopLyrics.value).toBe(true);
    expect(deps.revealMainWindow).toHaveBeenCalledTimes(1);
    expect(deps.openSettings).toHaveBeenCalledTimes(1);
  });

  it('toggles mini player mode on repeated show-mini-player actions', async () => {
    const deps = createDeps();

    expect(deps.isMiniMode.value).toBe(false);

    await handleTrayMenuAction('show-mini-player', deps);
    expect(deps.isMiniMode.value).toBe(true);
    expect(deps.revealMainWindow).not.toHaveBeenCalled();

    await handleTrayMenuAction('show-mini-player', deps);
    expect(deps.isMiniMode.value).toBe(false);
    expect(deps.revealMainWindow).toHaveBeenCalledTimes(1);
  });
});
