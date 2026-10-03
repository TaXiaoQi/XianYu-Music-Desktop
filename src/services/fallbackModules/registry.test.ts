import { beforeEach, describe, expect, it, vi } from 'vitest';

// localStore / tauriInvoke 均为 hoisted mock，避免 vitest 提升顺序问题
const { store, invokeMock } = vi.hoisted(() => ({
  store: new Map<string, unknown>(),
  invokeMock: vi.fn(),
}));

vi.mock('../storage/localStore', () => ({
  localStore: {
    getJson: (key: string) => (store.has(key) ? store.get(key) : null),
    setJson: (key: string, value: unknown) => {
      store.set(key, value);
    },
    remove: (key: string) => {
      store.delete(key);
    },
  },
}));

vi.mock('../tauri/invoke', () => ({
  tauriInvoke: (...args: unknown[]) => invokeMock(...args),
}));

import {
  clearFallbackModules,
  dispatchFallbackModule,
  dispatchFallbackModuleMany,
  prewarmFallbackModules,
} from './registry';

const CACHE_KEY = 'xianyu_fallback_modules_v1';

const seedModule = (key: string, version = 1): void => {
  store.set(CACHE_KEY, {
    fetchedAt: Date.now(),
    modules: {
      [key]: {
        version,
        digest: `digest-${version}`,
        code: `module.exports = {}; // ${key}`,
        signature: 'sig',
        name: key,
      },
    },
  });
};

// load 返回 ok、call/call_many 按 handler 定制
const mockHostLoadOk = (): void => {
  invokeMock.mockImplementation(async (command: string) => {
    if (command === 'fallback_module_load') {
      return { ok: true, version: 1, logs: null };
    }
    throw new Error(`unexpected command: ${command}`);
  });
};

beforeEach(() => {
  store.clear();
  invokeMock.mockReset();
  clearFallbackModules();
});

describe('dispatchFallbackModuleMany', () => {
  it('空列表直接返回 []，不发起任何 IPC', async () => {
    const out = await dispatchFallbackModuleMany(
      'lx_cover',
      'extractCoverUrl',
      [],
      () => 'builtin',
    );
    expect(out).toEqual([]);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('模块未加载（无缓存）时全部走内置实现，不发起 call_many', async () => {
    const out = await dispatchFallbackModuleMany(
      'lx_cover',
      'extractCoverUrl',
      [{ item: { coverImg: 'a' } }, { item: { coverImg: 'b' } }],
      args => `builtin:${(args.item as { coverImg: string }).coverImg}`,
    );
    expect(out).toEqual(['builtin:a', 'builtin:b']);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('逐项处理：成功项用模块返回值，失败项回退内置并累计错误', async () => {
    seedModule('lx_cover');
    mockHostLoadOk();
    invokeMock.mockImplementation(async (command: string, payload: any) => {
      if (command === 'fallback_module_load') return { ok: true, version: 1, logs: null };
      if (command === 'fallback_module_call_many') {
        const n = (payload.argsJsonList as string[]).length;
        return {
          results: [
            { ok: true, data: 'cover-0', error: null },
            { ok: false, data: null, error: 'boom' },
            ...Array.from({ length: Math.max(0, n - 2) }, () => ({ ok: true, data: 'cover-x', error: null })),
          ],
          logs: null,
        };
      }
      throw new Error(`unexpected command: ${command}`);
    });

    const builtinCalls: number[] = [];
    const out = await dispatchFallbackModuleMany(
      'lx_cover',
      'extractCoverUrl',
      [{ item: 1 }, { item: 2 }, { item: 3 }],
      (_args, i) => {
        builtinCalls.push(i);
        return `builtin-${i}`;
      },
    );

    expect(out).toEqual(['cover-0', 'builtin-1', 'cover-x']);
    expect(builtinCalls).toEqual([1]);
    // 失败 1 次，模块未被熔断：后续调用仍会发起 call_many
    invokeMock.mockClear();
    mockHostLoadOk();
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'fallback_module_load') return { ok: true, version: 1, logs: null };
      if (command === 'fallback_module_call_many') {
        return { results: [{ ok: true, data: 'ok', error: null }], logs: null };
      }
      throw new Error(`unexpected command: ${command}`);
    });
    await dispatchFallbackModuleMany('lx_cover', 'extractCoverUrl', [{ item: 1 }], () => 'b');
    expect(invokeMock).toHaveBeenCalledWith(
      'fallback_module_call_many',
      expect.objectContaining({ moduleKey: 'lx_cover' }),
    );
  });

  it('连续 3 次整体失败后熔断：本会话后续调用直接走内置，不再发 IPC', async () => {
    seedModule('lx_cover');
    mockHostLoadOk();
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'fallback_module_load') return { ok: true, version: 1, logs: null };
      if (command === 'fallback_module_call_many') throw new Error('ipc down');
      throw new Error(`unexpected command: ${command}`);
    });

    const run = () =>
      dispatchFallbackModuleMany(
        'lx_cover',
        'extractCoverUrl',
        [{ item: 1 }],
        args => `builtin:${(args.item as number)}`,
      );

    expect(await run()).toEqual(['builtin:1']);
    expect(await run()).toEqual(['builtin:1']);
    expect(await run()).toEqual(['builtin:1']);

    invokeMock.mockClear();
    mockHostLoadOk();
    expect(await run()).toEqual(['builtin:1']);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('成功会重置连续错误计数：2 失败 → 1 成功 → 2 失败后仍未熔断', async () => {
    seedModule('lx_cover');
    mockHostLoadOk();
    let fail = true;
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'fallback_module_load') return { ok: true, version: 1, logs: null };
      if (command === 'fallback_module_call_many') {
        if (fail) throw new Error('ipc down');
        return { results: [{ ok: true, data: 'module-ok', error: null }], logs: null };
      }
      throw new Error(`unexpected command: ${command}`);
    });

    const run = () =>
      dispatchFallbackModuleMany('lx_cover', 'extractCoverUrl', [{ item: 1 }], () => 'builtin');

    await run();
    await run();
    fail = false;
    expect(await run()).toEqual(['module-ok']);
    fail = true;
    await run();
    await run();

    // 计数被成功重置过，此刻仅连续失败 2 次，模块仍可用
    invokeMock.mockClear();
    mockHostLoadOk();
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'fallback_module_load') return { ok: true, version: 1, logs: null };
      if (command === 'fallback_module_call_many') {
        return { results: [{ ok: true, data: 'still-alive', error: null }], logs: null };
      }
      throw new Error(`unexpected command: ${command}`);
    });
    expect(await run()).toEqual(['still-alive']);
  });
});

describe('dispatchFallbackModule', () => {
  it('成功路径返回模块数据并清零错误计数', async () => {
    seedModule('plugin_fallback');
    mockHostLoadOk();
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'fallback_module_load') return { ok: true, version: 1, logs: null };
      if (command === 'fallback_module_call') return { ok: true, data: true, error: null, logs: null };
      throw new Error(`unexpected command: ${command}`);
    });

    const out = await dispatchFallbackModule(
      'plugin_fallback',
      'isQqMusicPluginSource',
      { source: { name: 'QQ音乐' } },
      () => false,
    );
    expect(out).toBe(true);
    expect(invokeMock).toHaveBeenCalledWith(
      'fallback_module_call',
      expect.objectContaining({ moduleKey: 'plugin_fallback', method: 'isQqMusicPluginSource' }),
    );
  });

  it('内置兜底：宿主调用失败时返回 builtin 结果', async () => {
    seedModule('plugin_fallback');
    mockHostLoadOk();
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'fallback_module_load') return { ok: true, version: 1, logs: null };
      if (command === 'fallback_module_call') return { ok: false, data: null, error: '执行失败', logs: null };
      throw new Error(`unexpected command: ${command}`);
    });

    const out = await dispatchFallbackModule('plugin_fallback', 'isQqTrialMediaUrl', { url: 'x' }, () => 'fallback-value');
    expect(out).toBe('fallback-value');
  });

  it('连续 3 次失败后熔断，不再发起 call', async () => {
    seedModule('plugin_fallback');
    mockHostLoadOk();
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'fallback_module_load') return { ok: true, version: 1, logs: null };
      if (command === 'fallback_module_call') return { ok: false, data: null, error: '执行失败', logs: null };
      throw new Error(`unexpected command: ${command}`);
    });

    const call = () =>
      dispatchFallbackModule('plugin_fallback', 'isQqTrialMediaUrl', { url: 'x' }, () => 'builtin');

    await call();
    await call();
    await call();

    invokeMock.mockClear();
    mockHostLoadOk();
    expect(await call()).toBe('builtin');
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('playlist_import 键：模块结果透传，失败回退内置', async () => {
    seedModule('playlist_import');
    mockHostLoadOk();
    const moduleResult = {
      source: 'kg',
      songs: [{ id: '1', title: '歌', rawData: { hash: 'h1' } }],
      total: 1,
      info: { name: '歌单', img: '', desc: '', author: '', playCount: '' },
    };
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'fallback_module_load') return { ok: true, version: 1, logs: null };
      if (command === 'fallback_module_call') return { ok: true, data: moduleResult, error: null, logs: null };
      throw new Error(`unexpected command: ${command}`);
    });

    const out = await dispatchFallbackModule(
      'playlist_import',
      'getListDetailKg',
      { rawId: 'https://example.com/gcid_x' },
      () => {
        throw new Error('builtin should not run');
      },
    );
    expect(out).toEqual(moduleResult);
    expect(invokeMock).toHaveBeenCalledWith(
      'fallback_module_call',
      expect.objectContaining({ moduleKey: 'playlist_import', method: 'getListDetailKg' }),
    );

    // 模块执行失败 → 内置实现接管
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'fallback_module_load') return { ok: true, version: 1, logs: null };
      if (command === 'fallback_module_call') return { ok: false, data: null, error: '上游改版', logs: null };
      throw new Error(`unexpected command: ${command}`);
    });
    const builtinResult = { ...moduleResult, total: 0, songs: [] };
    const out2 = await dispatchFallbackModule(
      'playlist_import',
      'getListDetailKg',
      { rawId: 'x' },
      () => builtinResult,
    );
    expect(out2).toBe(builtinResult);
  });

  it('「模块未加载」错误删除加载标记，下次调用重新 load', async () => {
    seedModule('plugin_fallback');
    mockHostLoadOk();
    let callCount = 0;
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'fallback_module_load') return { ok: true, version: 1, logs: null };
      if (command === 'fallback_module_call') {
        callCount += 1;
        return { ok: false, data: null, error: '模块未加载: plugin_fallback', logs: null };
      }
      throw new Error(`unexpected command: ${command}`);
    });

    await dispatchFallbackModule('plugin_fallback', 'isQqTrialMediaUrl', { url: 'x' }, () => 'builtin');
    expect(callCount).toBe(1);

    // 第二次调用应重新走 fallback_module_load（而不是复用 _loaded 标记）
    const loadCalls = invokeMock.mock.calls.filter(([cmd]) => cmd === 'fallback_module_load').length;
    await dispatchFallbackModule('plugin_fallback', 'isQqTrialMediaUrl', { url: 'x' }, () => 'builtin');
    const loadCallsAfter = invokeMock.mock.calls.filter(([cmd]) => cmd === 'fallback_module_load').length;
    expect(loadCallsAfter).toBe(loadCalls + 1);
    expect(callCount).toBe(2);
  });
});

describe('prewarmFallbackModules', () => {
  it('把缓存中的模块批量 load，且并发去重只发一次', async () => {
    seedModule('lx_cover');
    seedModule('plugin_fallback');
    // store 里两次 seed 会互相覆盖，重新写两个 key
    store.set('xianyu_fallback_modules_v1', {
      fetchedAt: Date.now(),
      modules: {
        lx_cover: { version: 1, digest: 'd', code: 'c', signature: 's' },
        plugin_fallback: { version: 1, digest: 'd', code: 'c', signature: 's' },
      },
    });

    mockHostLoadOk();
    prewarmFallbackModules();
    // 等待所有 load promise 落定
    await Promise.all(
      invokeMock.mock.results.map(r => r.value.catch(() => null)),
    );
    await new Promise(resolve => setTimeout(resolve, 0));

    const loadCmds = invokeMock.mock.calls.filter(([cmd]) => cmd === 'fallback_module_load');
    expect(loadCmds).toHaveLength(2);
  });
});
