import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const pushCalls = () =>
  invokeMock.mock.calls.filter(([c]) => c === 'fallback_module_update_config');

// 对账链路第一步是 crypto.subtle.digest——真实原生异步任务，不走 vitest 定时器。
// 固定「睡一拍再断言」在全量并发跑时会输给事件循环调度（隔离跑恒过、全量偶发挂），
// 因此改为有界轮询直至条件成立，超时才算失败。
const settle = async (cond: () => boolean, maxTicks = 200) => {
  for (let i = 0; i < maxTicks && !cond(); i += 1) {
    await tick();
  }
  if (!cond()) throw new Error('条件未在限定时间内收敛（settle 超时）');
};

beforeEach(() => {
  // invokeMock 跨用例共享，先清空调用记录：
  // 防止前一用例迟到的异步链把调用算进当前用例的计数
  invokeMock.mockClear();
});

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
    // 等对账链路（含 crypto.subtle 真实异步）完整走完
    await settle(() =>
      invokeMock.mock.calls.some(([c]) => c === 'fallback_module_config_hash'),
    );
    await tick();
    await tick(); // 再静默两拍，确认没有迟到的推送

    expect(pushCalls()).toHaveLength(0);
  });

  it('hash 不一致（Rust 侧配置漂移/丢失）时重推', async () => {
    const sync = await loadSync();
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'fallback_module_config_hash') return 'stale-hash';
      if (command === 'fallback_module_update_config') return sha256Hex('x');
      throw new Error(`unexpected command: ${command}`);
    });

    sync.installFallbackModuleConfigWatch();
    await settle(() => pushCalls().length >= 1);
    await tick();
    await tick(); // 静默两拍：确认只推一次、无重复推送

    const pushes = pushCalls();
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
    await settle(() => pushCalls().length >= 1);
    await tick();
    await tick();

    expect(pushCalls()).toHaveLength(1);
  });
});

describe('配置推送失败重试', () => {
  // 模块加载须在真实定时器下完成：fake timers 会卡住 vitest 动态 import。
  // 对账的 crypto.subtle 是真实异步、不受 fake timers 驱动，固定 advance 步长
  // 在高负载下会与它竞速；只有「首次尝试发生与否」依赖这段真实异步，
  // 之后的退避重试全在 fake timers 掌控内，可精确断言。
  const advanceUntilFirstAttempt = async (
    attempts: () => number,
    maxMs = 5_000,
  ) => {
    for (let elapsed = 0; elapsed < maxMs && attempts() < 1; elapsed += 100) {
      await vi.advanceTimersByTimeAsync(100);
    }
    if (attempts() < 1) throw new Error('首次推送未在限定时间内发生（advance 超时）');
  };

  it('按 1s/2s 退避重试，第 3 次成功', async () => {
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
    await advanceUntilFirstAttempt(() => attempts); // 首次尝试失败
    expect(attempts).toBe(1);
    await vi.advanceTimersByTimeAsync(1000); // 1s 退避后第 2 次失败
    expect(attempts).toBe(2);
    await vi.advanceTimersByTimeAsync(2000); // 2s 退避后第 3 次成功
    expect(attempts).toBe(3);
    await vi.advanceTimersByTimeAsync(8000); // 成功后不再重试
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
    await advanceUntilFirstAttempt(() => attempts);
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(2000);
    expect(attempts).toBe(3);
    await vi.advanceTimersByTimeAsync(8000); // 远超剩余退避时间
    expect(attempts).toBe(3);
  });
});
