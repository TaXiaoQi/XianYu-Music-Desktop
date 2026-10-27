import { beforeEach, describe, expect, it, vi } from 'vitest';

// registry.ts 的外部依赖全部 mock：IPC / 本地存储 / 上报
const { invokeMock, reportErrorMock, storeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  reportErrorMock: vi.fn(),
  storeMock: { map: new Map<string, unknown>() },
}));

vi.mock('../tauri/invoke', () => ({
  tauriInvoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock('../domain/usageStats', () => ({
  reportError: (...args: unknown[]) => reportErrorMock(...args),
}));

vi.mock('../storage/localStore', () => ({
  localStore: {
    getJson: (key: string) => storeMock.map.get(key),
    setJson: (key: string, value: unknown) => {
      storeMock.map.set(key, value);
    },
    remove: (key: string) => {
      storeMock.map.delete(key);
    },
  },
}));

const VALID_CONFIG = JSON.stringify({
  version: 3,
  modules: {
    lx_lyric: { version: 1, disabledMethods: ['fetchLyric'] },
    lx_toplist: { version: 1, disabledMethods: [], params: { sources: ['wy', 'kg'] } },
    lx_recommend_sheets: { version: 1, disabledMethods: ['nope'] },
    plugin_fallback: { version: 1, disabledMethods: ['fillSongDurations'] },
    playlist_import: { version: 1, disabledMethods: ['getListDetailMg'] },
    unknown_module: { version: 1, disabledMethods: ['whatever'] },
  },
});

const CONFIG_STORAGE_KEY = 'xianyu_fallback_config_v2';
const SIG = 'a'.repeat(128);

// registry.ts 有模块级内存态（_config），每个用例加载独立实例
const loadRegistry = async () => {
  vi.resetModules();
  return await import('./registry');
};

beforeEach(() => {
  storeMock.map.clear();
  invokeMock.mockReset();
  reportErrorMock.mockClear();
});

describe('默认行为（未同步）', () => {
  it('未同步时全部放行且不调整来源', async () => {
    const registry = await loadRegistry();
    expect(registry.fallbackMethodDisabled('lx_lyric', 'fetchLyric')).toBe(false);
    expect(registry.fallbackModuleSourceOrder('lx_toplist', ['wy', 'kg', 'kw'])).toBeNull();
  });
});

describe('applyServerFallbackConfig', () => {
  it('验签通过后应用：禁用方法与来源顺序生效，未知 key/方法忽略', async () => {
    const registry = await loadRegistry();
    invokeMock.mockResolvedValue(true);
    await registry.applyServerFallbackConfig(VALID_CONFIG, SIG);

    expect(registry.fallbackMethodDisabled('lx_lyric', 'fetchLyric')).toBe(true);
    expect(registry.fallbackMethodDisabled('plugin_fallback', 'fillSongDurations')).toBe(true);
    expect(registry.fallbackMethodDisabled('playlist_import', 'getListDetailMg')).toBe(true);
    // 白名单之外的方法名忽略
    expect(registry.fallbackMethodDisabled('lx_recommend_sheets', 'getRecommendSheetTags')).toBe(false);
    // 未知模块 key 忽略
    expect(registry.fallbackMethodDisabled('unknown_module', 'whatever')).toBe(false);
    // 来源顺序：按配置顺序保留 wanted 交集
    expect(registry.fallbackModuleSourceOrder('lx_toplist', ['kw', 'wy'])).toEqual(['wy']);
    // 非 sources 模块不调整来源
    expect(registry.fallbackModuleSourceOrder('lx_lyric', ['wy'])).toBeNull();
    // 与配置无交集时回 null（不把页面打空）
    expect(registry.fallbackModuleSourceOrder('lx_toplist', ['kw', 'tx'])).toBeNull();
    // 已写入本地缓存
    expect(storeMock.map.get(CONFIG_STORAGE_KEY)).toEqual({ config: VALID_CONFIG, signature: SIG });
  });

  it('验签失败丢弃并清缓存、上报事件', async () => {
    const registry = await loadRegistry();
    invokeMock.mockResolvedValue(false);
    await registry.applyServerFallbackConfig(VALID_CONFIG, SIG);
    expect(registry.fallbackMethodDisabled('lx_lyric', 'fetchLyric')).toBe(false);
    expect(storeMock.map.has(CONFIG_STORAGE_KEY)).toBe(false);
    expect(reportErrorMock).toHaveBeenCalledWith('FallbackConfigVerifyFail', expect.any(String));
  });

  it('验签命令不可用时按未通过处理', async () => {
    const registry = await loadRegistry();
    invokeMock.mockRejectedValue(new Error('cmd missing'));
    await registry.applyServerFallbackConfig(VALID_CONFIG, SIG);
    expect(registry.fallbackMethodDisabled('lx_lyric', 'fetchLyric')).toBe(false);
    expect(storeMock.map.has(CONFIG_STORAGE_KEY)).toBe(false);
  });

  it('空参数直接忽略，不走验签', async () => {
    const registry = await loadRegistry();
    await registry.applyServerFallbackConfig('', SIG);
    await registry.applyServerFallbackConfig(VALID_CONFIG, '');
    expect(invokeMock).not.toHaveBeenCalled();
  });
});

describe('sanitizeFallbackConfigCache', () => {
  it('有效缓存验签后应用到内存', async () => {
    storeMock.map.set(CONFIG_STORAGE_KEY, { config: VALID_CONFIG, signature: SIG });
    invokeMock.mockResolvedValue(true);
    const registry = await loadRegistry();
    await registry.sanitizeFallbackConfigCache();
    expect(registry.fallbackMethodDisabled('lx_lyric', 'fetchLyric')).toBe(true);
  });

  it('验签失败清缓存并回退默认', async () => {
    storeMock.map.set(CONFIG_STORAGE_KEY, { config: VALID_CONFIG, signature: SIG });
    invokeMock.mockResolvedValue(false);
    const registry = await loadRegistry();
    await registry.sanitizeFallbackConfigCache();
    expect(registry.fallbackMethodDisabled('lx_lyric', 'fetchLyric')).toBe(false);
    expect(storeMock.map.has(CONFIG_STORAGE_KEY)).toBe(false);
  });

  it('缓存配置损坏时清除', async () => {
    storeMock.map.set(CONFIG_STORAGE_KEY, { config: '{broken', signature: SIG });
    invokeMock.mockResolvedValue(true);
    const registry = await loadRegistry();
    await registry.sanitizeFallbackConfigCache();
    expect(registry.fallbackMethodDisabled('lx_lyric', 'fetchLyric')).toBe(false);
    expect(storeMock.map.has(CONFIG_STORAGE_KEY)).toBe(false);
  });

  it('缓存残缺（缺签名）时跳过', async () => {
    storeMock.map.set(CONFIG_STORAGE_KEY, { config: VALID_CONFIG });
    const registry = await loadRegistry();
    await registry.sanitizeFallbackConfigCache();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('无缓存时不走验签', async () => {
    const registry = await loadRegistry();
    await registry.sanitizeFallbackConfigCache();
    expect(invokeMock).not.toHaveBeenCalled();
  });
});

describe('removeLegacyFallbackModuleCache', () => {
  it('清理旧版热修模块缓存键', async () => {
    const registry = await loadRegistry();
    storeMock.map.set('xianyu_fallback_modules_v1', { fetchedAt: 1, modules: {} });
    registry.removeLegacyFallbackModuleCache();
    expect(storeMock.map.has('xianyu_fallback_modules_v1')).toBe(false);
  });
});
