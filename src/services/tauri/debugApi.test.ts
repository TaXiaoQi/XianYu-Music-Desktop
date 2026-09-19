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

  it('exports logs through the save_text_via_dialog command', () => {
    debugApi.writeLogExport('xianyu-all-logs.log', 'log content');

    expect(tauriInvoke).toHaveBeenCalledWith('save_text_via_dialog', {
      defaultFileName: 'xianyu-all-logs.log',
      filter: { name: '日志文件', extensions: ['log', 'txt'] },
      content: 'log content',
    });
  });
});
