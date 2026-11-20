import { describe, expect, it, vi, beforeEach } from 'vitest';

// getStoredPlugins 用可变数组模拟，用例直接改写内容
const state = vi.hoisted(() => ({ plugins: [] as any[] }));
vi.mock('./pluginEngine', () => ({
  getStoredPlugins: vi.fn(() => state.plugins),
}));

import { hasEnabledLxPluginFor } from './lxPluginGate';

const lxPlugin = (overrides: Record<string, unknown>) => ({
  id: 'p',
  name: '测试插件',
  format: 'lx',
  enabled: true,
  sources: [],
  ...overrides,
});

beforeEach(() => {
  state.plugins = [];
});

describe('hasEnabledLxPluginFor：内置 lx 兜底平台开关', () => {
  it('无任何插件 → 全平台不可用', () => {
    for (const p of ['kg', 'qishui', 'wy', 'tx', 'kw', 'mg'] as const) {
      expect(hasEnabledLxPluginFor(p)).toBe(false);
    }
  });

  it('启用的 lx 插件声明对应音源 → 命中；未声明平台不命中', () => {
    state.plugins = [lxPlugin({ sources: ['tx'] })];
    expect(hasEnabledLxPluginFor('tx')).toBe(true);
    expect(hasEnabledLxPluginFor('wy')).toBe(false);
  });

  it('插件已停用 → 不可用', () => {
    state.plugins = [lxPlugin({ sources: ['kg'], enabled: false })];
    expect(hasEnabledLxPluginFor('kg')).toBe(false);
  });

  it('musicfree/anime 插件不算 lx 音源声明（qishui 除外）', () => {
    state.plugins = [lxPlugin({ format: 'musicfree', name: '网易云插件', sources: ['wy'] })];
    expect(hasEnabledLxPluginFor('wy')).toBe(false);
    // 名字含「汽水」的 anime 插件命中汽水兜底开关
    state.plugins = [{ ...lxPlugin({ format: 'anime', name: '汽水音乐-xm', sources: [] }) }];
    expect(hasEnabledLxPluginFor('qishui')).toBe(true);
    expect(hasEnabledLxPluginFor('wy')).toBe(false);
  });

  it('qishui：lx 插件声明 qs 音源 → 命中', () => {
    state.plugins = [lxPlugin({ name: '某汽水源', sources: ['qs'] })];
    expect(hasEnabledLxPluginFor('qishui')).toBe(true);
  });

  it('qishui：仅普通 lx 插件（无 qs/汽水特征）→ 不命中', () => {
    state.plugins = [lxPlugin({ name: 'QQ音乐', sources: ['tx'] })];
    expect(hasEnabledLxPluginFor('qishui')).toBe(false);
  });

  it('多平台声明逐个判定', () => {
    state.plugins = [
      lxPlugin({ sources: ['kg', 'kw'] }),
      lxPlugin({ sources: ['mg'] }),
    ];
    expect(hasEnabledLxPluginFor('kg')).toBe(true);
    expect(hasEnabledLxPluginFor('kw')).toBe(true);
    expect(hasEnabledLxPluginFor('mg')).toBe(true);
    expect(hasEnabledLxPluginFor('tx')).toBe(false);
  });
});
