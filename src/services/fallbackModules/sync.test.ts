import { beforeEach, describe, expect, it, vi } from 'vitest';

// sync.ts 的外部依赖全部 mock：服务端请求 / registry
const { signedRequestMock, registryMock } = vi.hoisted(() => ({
  signedRequestMock: vi.fn(),
  registryMock: {
    applyServerFallbackConfig: vi.fn(async () => {}),
    sanitizeFallbackConfigCache: vi.fn(async () => {}),
    removeLegacyFallbackModuleCache: vi.fn(),
  },
}));

vi.mock('../auth/authService', () => ({
  signedRequest: (...args: unknown[]) => signedRequestMock(...args),
}));

vi.mock('./registry', () => registryMock);

// sync.ts 有模块级状态（_timerId/_syncing），每个用例加载独立实例
const loadSync = async () => {
  vi.resetModules();
  return await import('./sync');
};

beforeEach(() => {
  signedRequestMock.mockReset();
  registryMock.applyServerFallbackConfig.mockClear();
  registryMock.sanitizeFallbackConfigCache.mockClear();
  registryMock.removeLegacyFallbackModuleCache.mockClear();
});

describe('syncFallbackModules 拉取', () => {
  it('服务端返回配置时透传给 registry（签名转小写）', async () => {
    const sync = await loadSync();
    signedRequestMock.mockResolvedValue({ config: '{"version":1,"modules":{}}', signature: 'AB12' });
    await expect(sync.syncFallbackModules()).resolves.toBe(true);
    expect(registryMock.applyServerFallbackConfig).toHaveBeenCalledWith(
      '{"version":1,"modules":{}}',
      'ab12',
    );
  });

  it('未配置（config/signature 空串）时保持现状', async () => {
    const sync = await loadSync();
    signedRequestMock.mockResolvedValue({ config: '', signature: '' });
    await expect(sync.syncFallbackModules()).resolves.toBe(true);
    expect(registryMock.applyServerFallbackConfig).not.toHaveBeenCalled();
  });

  it('响应字段残缺（非对象/null）时保持现状', async () => {
    const sync = await loadSync();
    signedRequestMock.mockResolvedValue(null);
    await expect(sync.syncFallbackModules()).resolves.toBe(true);
    expect(registryMock.applyServerFallbackConfig).not.toHaveBeenCalled();
  });

  it('拉取失败返回 false 且不应用任何配置', async () => {
    const sync = await loadSync();
    signedRequestMock.mockRejectedValue(new Error('network down'));
    await expect(sync.syncFallbackModules()).resolves.toBe(false);
    expect(registryMock.applyServerFallbackConfig).not.toHaveBeenCalled();
  });

  it('并发重入时跳过后续同步', async () => {
    const sync = await loadSync();
    let release!: (v: unknown) => void;
    signedRequestMock.mockReturnValue(
      new Promise(resolve => {
        release = resolve;
      }),
    );
    const first = sync.syncFallbackModules();
    await expect(sync.syncFallbackModules()).resolves.toBe(false);
    release({ config: 'c', signature: 's' });
    await expect(first).resolves.toBe(true);
    expect(registryMock.applyServerFallbackConfig).toHaveBeenCalledTimes(1);
  });
});

describe('initFallbackModuleSync 启动链路', () => {
  it('启动先清旧缓存并验签清理本地缓存，再拉取一次', async () => {
    const sync = await loadSync();
    signedRequestMock.mockResolvedValue({ config: 'c', signature: 's' });
    sync.initFallbackModuleSync();
    // 启动链是异步的：等两拍让 I/O 微任务收敛
    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(registryMock.removeLegacyFallbackModuleCache).toHaveBeenCalled();
    expect(registryMock.sanitizeFallbackConfigCache).toHaveBeenCalled();
    expect(registryMock.applyServerFallbackConfig).toHaveBeenCalledWith('c', 's');
    // 重复初始化不再触发新的拉取
    sync.initFallbackModuleSync();
    expect(signedRequestMock).toHaveBeenCalledTimes(1);
  });
});
