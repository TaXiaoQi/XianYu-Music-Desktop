import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';

import { restoreMainWindowFromMiniMode } from './useMiniPlayerWindowBridge';

vi.mock('@tauri-apps/api/dpi', () => ({
  LogicalPosition: class {
    constructor(public x: number, public y: number) {}
  },
}));

vi.mock('@tauri-apps/api/event', () => ({
  emitTo: vi.fn(),
  listen: vi.fn(),
}));

vi.mock('@tauri-apps/api/webviewWindow', () => ({
  WebviewWindow: {
    getByLabel: vi.fn(),
  },
}));

vi.mock('@tauri-apps/api/window', () => ({
  availableMonitors: vi.fn(),
  getCurrentWindow: vi.fn(),
}));

vi.mock('./player', () => ({
  usePlayer: vi.fn(),
}));

vi.mock('./lyrics', () => ({
  useLyrics: vi.fn(),
}));

vi.mock('./useCoverCache', () => ({
  useCoverCache: vi.fn(),
}));

describe('mini player window bridge', () => {
  beforeAll(() => {
    (globalThis as any).window = {
      dispatchEvent: () => false,
    } as any;
  });

  afterAll(() => {
    delete (globalThis as any).window;
  });

  it('restores the main window from mini mode before focusing it', async () => {
    vi.useFakeTimers();
    const dispatchSpy = vi.spyOn((globalThis as any).window, 'dispatchEvent') as any;

    const isMiniMode = ref(true);
    const hideMiniPlayerWindow = vi.fn().mockResolvedValue(undefined);
    const mainWindow = {
      unminimize: vi.fn().mockResolvedValue(undefined),
      show: vi.fn().mockResolvedValue(undefined),
      setFocus: vi.fn().mockResolvedValue(undefined),
    };

    await restoreMainWindowFromMiniMode({
      isMiniMode,
      hideMiniPlayerWindow,
      mainWindow,
    });

    expect(isMiniMode.value).toBe(false);
    expect(hideMiniPlayerWindow).toHaveBeenCalledTimes(1);
    expect(mainWindow.unminimize).toHaveBeenCalledTimes(1);
    expect(mainWindow.show).toHaveBeenCalledTimes(1);
    expect(mainWindow.setFocus).toHaveBeenCalledTimes(1);

    vi.runAllTimers();

    expect(dispatchSpy).toHaveBeenCalledTimes(2);
    expect(dispatchSpy.mock.calls[0][0].type).toBe('resize');
    expect(dispatchSpy.mock.calls[1][0].type).toBe('resize');

    vi.useRealTimers();
    dispatchSpy.mockRestore();
  });

  it('can restore the main window while keeping the mini player visible', async () => {
    vi.useFakeTimers();
    const dispatchSpy = vi.spyOn((globalThis as any).window, 'dispatchEvent') as any;

    const isMiniMode = ref(true);
    const hideMiniPlayerWindow = vi.fn().mockResolvedValue(undefined);
    const mainWindow = {
      unminimize: vi.fn().mockResolvedValue(undefined),
      show: vi.fn().mockResolvedValue(undefined),
      setFocus: vi.fn().mockResolvedValue(undefined),
    };

    await restoreMainWindowFromMiniMode({
      isMiniMode,
      hideMiniPlayerWindow,
      mainWindow,
      keepMiniPlayerVisible: true,
    });

    expect(isMiniMode.value).toBe(false);
    expect(hideMiniPlayerWindow).not.toHaveBeenCalled();
    expect(mainWindow.unminimize).toHaveBeenCalledTimes(1);
    expect(mainWindow.show).toHaveBeenCalledTimes(1);
    expect(mainWindow.setFocus).toHaveBeenCalledTimes(1);

    vi.runAllTimers();

    expect(dispatchSpy).toHaveBeenCalledTimes(2);
    expect(dispatchSpy.mock.calls[0][0].type).toBe('resize');
    expect(dispatchSpy.mock.calls[1][0].type).toBe('resize');

    vi.useRealTimers();
    dispatchSpy.mockRestore();
  });
});
