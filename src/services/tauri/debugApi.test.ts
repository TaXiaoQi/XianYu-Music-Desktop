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

  it('exports logs through the write_text_file command', () => {
    debugApi.writeLogExport('C:\\Logs\\xianyu.log', 'log content');

    expect(tauriInvoke).toHaveBeenCalledWith('write_text_file', {
      content: 'log content',
      destPath: 'C:\\Logs\\xianyu.log',
    });
  });
});
