import { describe, expect, it, vi } from 'vitest';

import { createDynamicImportRecovery, isDynamicImportFetchError } from './dynamicImportRecovery';

const dynamicImportError = new TypeError(
  'Failed to fetch dynamically imported module: http://localhost:1420/src/views/Recent.vue',
);

describe('dynamic import recovery', () => {
  it('recognizes route chunk fetch failures', () => {
    expect(isDynamicImportFetchError(dynamicImportError)).toBe(true);
    expect(isDynamicImportFetchError(new Error('ordinary runtime error'))).toBe(false);
  });

  it('handles duplicate Vue and promise error channels with one reload', () => {
    const reload = vi.fn();
    const schedule = vi.fn((callback: () => void) => callback());
    let lastReloadAt = 0;
    const recover = createDynamicImportRecovery({
      getLastReloadAt: () => lastReloadAt,
      setLastReloadAt: (value) => { lastReloadAt = value; },
      reload,
      now: () => 20_000,
      schedule,
    });

    expect(recover(dynamicImportError)).toBe(true);
    expect(recover(dynamicImportError)).toBe(true);
    expect(schedule).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('rejects another recovery during the post-reload cooldown', () => {
    const recover = createDynamicImportRecovery({
      getLastReloadAt: () => 15_000,
      setLastReloadAt: vi.fn(),
      reload: vi.fn(),
      now: () => 20_000,
      schedule: vi.fn(),
    });

    expect(recover(dynamicImportError)).toBe(false);
  });
});
