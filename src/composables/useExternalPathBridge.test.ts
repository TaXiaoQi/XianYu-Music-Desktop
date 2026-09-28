import { describe, expect, it, vi } from 'vitest';

import { showMainWindowAfterStartup } from './useExternalPathBridge';

describe('startup window reveal 启动窗口揭示', () => {
  it('reveals the window after material sync and refreshes material on focus', async () => {
    const callOrder: string[] = [];
    const markStep = (step: string) => {
      callOrder.push(step);
    };
    const windowStub = {
      show: vi.fn(async () => markStep('show')),
      setFocus: vi.fn(async () => markStep('focus')),
    };

    await showMainWindowAfterStartup(windowStub, {
      beforeShow: async () => markStep('before'),
      afterShow: async () => markStep('after'),
    });

    expect(callOrder).toEqual(['before', 'show', 'focus', 'after']);
  });
});
