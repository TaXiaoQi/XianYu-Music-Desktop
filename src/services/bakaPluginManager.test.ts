import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PluginSource } from '../types';

const sandboxState = vi.hoisted(() => ({
  ready: false,
  instance: null as any,
}));

vi.mock('./pluginSandboxManager', () => ({
  callSandboxMethod: vi.fn(),
  isSandboxReady: () => sandboxState.ready,
  getSandboxInstance: () => sandboxState.instance,
}));

import { BakaPluginManager } from './bakaPluginManager';

function plugin(overrides: Partial<PluginSource> = {}): PluginSource {
  return {
    id: 'plugin-id',
    name: '测试插件',
    format: 'musicfree',
    version: '1.0.0',
    author: '',
    description: '',
    filePath: 'C:\\plugins\\source.js',
    importedAt: 1,
    enabled: true,
    sources: ['测试音源'],
    ...overrides,
  };
}

describe('BakaPluginManager.isBakaPlugin', () => {
  beforeEach(() => {
    BakaPluginManager.clearCache();
    sandboxState.ready = false;
    sandboxState.instance = null;
    delete (globalThis as any).__pluginInstances;
  });

  it('将 Toskysun 的插件强制识别为 BakaMusic', async () => {
    const result = await BakaPluginManager.isBakaPlugin(plugin({ author: 'Toskysun' }));

    expect(result).toBe(true);
  });

  it('将时迁酱的插件强制识别为 MusicFree，即使声明了 Baka 风格音质', async () => {
    sandboxState.ready = true;
    sandboxState.instance = {
      supportedQualities: ['128k', '320k', 'flac'],
    };

    const result = await BakaPluginManager.isBakaPlugin(plugin({ author: '时迁酱' }));

    expect(result).toBe(false);
  });

  it('通过沙箱元数据中的评论区 API 识别 BakaMusic', async () => {
    sandboxState.ready = true;
    sandboxState.instance = {
      _availableMethods: ['search', 'getMediaSource', 'getMusicComments'],
    };

    const result = await BakaPluginManager.isBakaPlugin(plugin({ author: '第三方作者' }));

    expect(result).toBe(true);
  });

  it('通过全局插件实例中的评论区 API 识别 BakaMusic', async () => {
    (globalThis as any).__pluginInstances = new Map([
      ['plugin-id', { instance: { getMusicComments: vi.fn() } }],
    ]);

    const result = await BakaPluginManager.isBakaPlugin(plugin({ author: '第三方作者' }));

    expect(result).toBe(true);
  });

  it('无明确作者或 Baka 特有能力时保持 MusicFree', async () => {
    const result = await BakaPluginManager.isBakaPlugin(plugin({ author: '普通作者' }));

    expect(result).toBe(false);
  });
});
