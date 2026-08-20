import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PluginSource } from '../types';

const sandboxState = vi.hoisted(() => ({
  ready: false,
  instance: null as any,
}));

const pluginHttpRequestMock = vi.hoisted(() => vi.fn());

vi.mock('./pluginSandboxManager', () => ({
  callSandboxMethod: vi.fn(),
  isSandboxReady: () => sandboxState.ready,
  getSandboxInstance: () => sandboxState.instance,
  clearLastSandboxError: vi.fn(),
  getLastSandboxError: vi.fn(() => ''),
}));

vi.mock('./tauri/pluginApi', () => ({
  pluginHttpRequest: pluginHttpRequestMock,
  pluginApi: {},
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

describe('BakaPluginManager.getMediaSource QQ 试听链拒绝', () => {
  beforeEach(() => {
    BakaPluginManager.clearCache();
    sandboxState.ready = false;
    sandboxState.instance = null;
    delete (globalThis as any).__pluginInstances;
  });

  const trialUrl = 'http://ws.stream.qqmusic.qq.com/RS02003Qui1q2u1Zho.mp3?guid=api.vkeys.cn&vkey=abc';

  const makeItem = () => ({
    id: '97773',
    title: '晴天',
    artist: '周杰伦',
    platform: 'QQ音乐',
    pluginId: 'plugin-id',
    rawData: {
      id: '97773',
      songmid: '0039MnYb0qxYhV',
      platform: 'QQ音乐',
      qualities: { '128k': {}, '320k': {}, 'flac': {} },
    },
  }) as any;

  it('拒绝 RS02 试听链并整体返回 null', async () => {
    const getMediaSource = vi.fn(async () => ({ url: trialUrl }));
    (globalThis as any).__pluginInstances = new Map([
      ['plugin-id', {
        source: plugin({ name: 'QQ音乐' }),
        instance: { platform: 'QQ音乐', supportedQualities: ['128k', '320k', 'flac'], getMediaSource },
      }],
    ]);

    const result = await BakaPluginManager.getMediaSource(plugin({ name: 'QQ音乐' }), makeItem(), '320k', 'lower');

    expect(getMediaSource).toHaveBeenCalled();
    expect(result).toBeNull();
  });

  it('完整版直链不受影响', async () => {
    const fullUrl = 'http://isure.stream.qqmusic.qq.com/M800003Qui1q2u1Zho.mp3?vkey=abc';
    const getMediaSource = vi.fn(async () => ({ url: fullUrl }));
    (globalThis as any).__pluginInstances = new Map([
      ['plugin-id', {
        source: plugin({ name: 'QQ音乐' }),
        instance: { platform: 'QQ音乐', supportedQualities: ['128k', '320k', 'flac'], getMediaSource },
      }],
    ]);

    const result = await BakaPluginManager.getMediaSource(plugin({ name: 'QQ音乐' }), makeItem(), '320k', 'lower');

    expect(result?.url).toContain('M800');
  });
});

describe('BakaPluginManager.getMediaSource 网易云官方外链预检', () => {
  beforeEach(() => {
    BakaPluginManager.clearCache();
    sandboxState.ready = false;
    sandboxState.instance = null;
    delete (globalThis as any).__pluginInstances;
    pluginHttpRequestMock.mockReset();
  });

  const outerUrl = 'https://music.163.com/song/media/outer/url?id=186016.mp3';

  const makeWyItem = () => ({
    id: '186016',
    title: '晴天',
    artist: '周杰伦',
    platform: '网易云音乐',
    pluginId: 'plugin-id',
    rawData: {
      id: '186016',
      platform: '网易云音乐',
      qualities: { '128k': {}, '320k': {} },
    },
  }) as any;

  const headResponse = (overrides: Record<string, unknown> = {}) => ({
    status: 200,
    url: 'https://music.163.com/404',
    headers: { 'content-type': 'text/html;charset=utf8' },
    body: '',
    ...overrides,
  });

  it('版权受限外链（302 落到 404 HTML 页）被预检拒绝，全档位失败返回 null', async () => {
    pluginHttpRequestMock.mockResolvedValue(headResponse());
    const getMediaSource = vi.fn(async () => ({ url: outerUrl }));
    (globalThis as any).__pluginInstances = new Map([
      ['plugin-id', {
        source: plugin({ name: '网易云音乐' }),
        instance: { platform: '网易云音乐', supportedQualities: ['128k', '320k'], getMediaSource },
      }],
    ]);

    const result = await BakaPluginManager.getMediaSource(plugin({ name: '网易云音乐' }), makeWyItem(), '320k', 'lower');

    expect(result).toBeNull();
    // 同一 outer/url 只探测一次（各档位结果记忆）
    expect(pluginHttpRequestMock).toHaveBeenCalledTimes(1);
  });

  it('可用外链（302 落到 CDN 音频）正常返回', async () => {
    pluginHttpRequestMock.mockResolvedValue(headResponse({
      url: 'http://m701.music.126.net/obj/xxx.mp3',
      headers: { 'content-type': 'audio/mpeg' },
    }));
    const getMediaSource = vi.fn(async () => ({ url: outerUrl }));
    (globalThis as any).__pluginInstances = new Map([
      ['plugin-id', {
        source: plugin({ name: '网易云音乐' }),
        instance: { platform: '网易云音乐', supportedQualities: ['128k', '320k'], getMediaSource },
      }],
    ]);

    const result = await BakaPluginManager.getMediaSource(plugin({ name: '网易云音乐' }), makeWyItem(), '320k', 'lower');

    expect(result?.url).toBe(outerUrl);
  });

  it('HEAD 被拒（405）时用 Range GET 复核', async () => {
    pluginHttpRequestMock
      .mockResolvedValueOnce(headResponse({ status: 405 }))
      .mockResolvedValueOnce(headResponse({
        url: 'http://m701.music.126.net/obj/xxx.mp3',
        headers: { 'content-type': 'audio/mpeg' },
      }));
    const getMediaSource = vi.fn(async () => ({ url: outerUrl }));
    (globalThis as any).__pluginInstances = new Map([
      ['plugin-id', {
        source: plugin({ name: '网易云音乐' }),
        instance: { platform: '网易云音乐', supportedQualities: ['128k', '320k'], getMediaSource },
      }],
    ]);

    const result = await BakaPluginManager.getMediaSource(plugin({ name: '网易云音乐' }), makeWyItem(), '320k', 'lower');

    expect(result?.url).toBe(outerUrl);
    expect(pluginHttpRequestMock).toHaveBeenCalledTimes(2);
    expect(pluginHttpRequestMock.mock.calls[1][0]).toBe('GET');
  });

  it('探测网络异常不判死，外链照常返回', async () => {
    pluginHttpRequestMock.mockRejectedValue(new Error('network down'));
    const getMediaSource = vi.fn(async () => ({ url: outerUrl }));
    (globalThis as any).__pluginInstances = new Map([
      ['plugin-id', {
        source: plugin({ name: '网易云音乐' }),
        instance: { platform: '网易云音乐', supportedQualities: ['128k', '320k'], getMediaSource },
      }],
    ]);

    const result = await BakaPluginManager.getMediaSource(plugin({ name: '网易云音乐' }), makeWyItem(), '320k', 'lower');

    expect(result?.url).toBe(outerUrl);
  });
});
