import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';

// sync.ts 的外部依赖全部 mock：IPC / 服务端请求 / settings store / registry
const { invokeMock, signedRequestMock, settingsState, registryMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  signedRequestMock: vi.fn(),
  settingsState: { settings: { volume: 50 } as Record<string, unknown> },
  registryMock: {
    applyServerFallbackModules: vi.fn(() => ({ added: 0, removed: 0 })),
    prewarmFallbackModules: vi.fn(),
    sanitizeFallbackModuleCache: vi.fn(async () => ({ removed: 0 })),
  },
}));

vi.mock('../tauri/invoke', () => ({
  tauriInvoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock('../auth/authService', () => ({
  signedRequest: (...args: unknown[]) => signedRequestMock(...args),
}));

vi.mock('../../features/settings/store', () => ({
  useSettingsStore: () => settingsState,
}));

vi.mock('./registry', () => registryMock);

// 与前端 crypto.subtle 独立的 sha256 实现，交叉验证两侧哈希口径一致
const sha256Hex = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex');

// sync.ts 有模块级状态（_configWatchInstalled 等），每个用例加载独立实例
const loadSync = async () => {
  vi.resetModules();
  return await import('./sync');
};

afterEach(() => {
  vi.useRealTimers();
});

describe('配置推送启动对账', () => {
  it('hash 一致时不重推 update_config', async () => {
    const sync = await loadSync();
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'fallback_module_config_hash') {
        return sha256Hex(JSON.stringify(settingsState.settings));
      }
      throw new Error(`unexpected command: ${command}`);
    });

    sync.installFallbackModuleConfigWatch();
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(
      invokeMock.mock.calls.filter(([c]) => c === 'fallback_module_update_config'),
    ).toHaveLength(0);
  });

  it('hash 不一致（Rust 侧配置漂移/丢失）时重推', async () => {
    const sync = await loadSync();
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'fallback_module_config_hash') return 'stale-hash';
      if (command === 'fallback_module_update_config') return sha256Hex('x');
      throw new Error(`unexpected command: ${command}`);
    });

    sync.installFallbackModuleConfigWatch();
    await new Promise(resolve => setTimeout(resolve, 0));

    const pushes = invokeMock.mock.calls.filter(([c]) => c === 'fallback_module_update_config');
    expect(pushes).toHaveLength(1);
    expect(pushes[0][1]).toEqual({
      configJson: JSON.stringify(settingsState.settings),
    });
  });

  it('对账查询失败（命令不可用）时直接推送兜底', async () => {
    const sync = await loadSync();
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'fallback_module_config_hash') throw new Error('cmd missing');
      if (command === 'fallback_module_update_config') return sha256Hex('x');
      throw new Error(`unexpected command: ${command}`);
    });

    sync.installFallbackModuleConfigWatch();
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(
      invokeMock.mock.calls.filter(([c]) => c === 'fallback_module_update_config'),
    ).toHaveLength(1);
  });
});

describe('配置推送失败重试', () => {
  it('按 1s/2s 退避重试，第 3 次成功', async () => {
    // 模块加载须在真实定时器下完成：fake timers 会卡住 vitest 动态 import
    const sync = await loadSync();
    vi.useFakeTimers();
    let attempts = 0;
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'fallback_module_config_hash') return 'stale-hash';
      if (command === 'fallback_module_update_config') {
        attempts += 1;
        if (attempts < 3) throw new Error('ipc down');
        return sha256Hex('x');
      }
      throw new Error(`unexpected command: ${command}`);
    });

    sync.installFallbackModuleConfigWatch();
    await vi.advanceTimersByTimeAsync(1); // 首次尝试失败
    await vi.advanceTimersByTimeAsync(1000); // 第 2 次失败
    await vi.advanceTimersByTimeAsync(2000); // 第 3 次成功
    expect(attempts).toBe(3);
  });

  it('连续失败 3 次后放弃，不再无限重试', async () => {
    const sync = await loadSync();
    vi.useFakeTimers();
    let attempts = 0;
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'fallback_module_config_hash') return 'stale-hash';
      if (command === 'fallback_module_update_config') {
        attempts += 1;
        throw new Error('ipc down');
      }
      throw new Error(`unexpected command: ${command}`);
    });

    sync.installFallbackModuleConfigWatch();
    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(8000); // 远超剩余退避时间
    expect(attempts).toBe(3);
  });
});
