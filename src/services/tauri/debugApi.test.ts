import { beforeEach, describe, expect, it, vi } from 'vitest';

const { tauriInvoke } = vi.hoisted(() => ({
  tauriInvoke: vi.fn(),
}));

vi.mock('./invoke', () => ({
  tauriInvoke,
}));

import { debugApi } from './debugApi';

describe('debugApi', () => {
  beforeEach(() => {
    tauriInvoke.mockReset();
  });

  it('exports logs through the existing text-file writer command', () => {
    debugApi.writeLogExport('C:\\Logs\\xianyu.log', 'log content');

    expect(tauriInvoke).toHaveBeenCalledWith('save_download_lyrics', {
      content: 'log content',
      destPath: 'C:\\Logs\\xianyu.log',
    });
  });
});
