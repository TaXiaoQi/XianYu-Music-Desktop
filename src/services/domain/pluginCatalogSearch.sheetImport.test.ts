import { describe, it, expect, vi, beforeEach } from 'vitest';

// 被测：pluginPlaylistSearch 的 importMusicSheet 精确导入分支。
// 背景：BakaMusic QQ[T] 插件 URL 正则有缺陷（playlist.html?id=... 解析不出 ID），
// 应用须先用 parseLink 规范化成纯 ID 再传插件，且兼容对象返回（带真实歌单名）。
const mocks = vi.hoisted(() => ({
  ensurePluginInstance: vi.fn(),
  hostPlaylistDetailOrNull: vi.fn(),
}));

vi.mock('./pluginEngineInstance', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ensurePluginInstance: mocks.ensurePluginInstance,
}));

import { pluginPlaylistSearch } from './pluginCatalogSearch';
import type { PluginSource } from '../../types';

function makeSource(name = 'QQ音乐[T]'): PluginSource {
  return {
    id: `plugin-${name}`,
    name,
    format: 'musicfree',
    enabled: true,
    sources: ['QQ音乐'],
    path: '/tmp/fake.js',
    filePath: '/tmp/fake.js',
    platform: name,
    builtIn: false,
  } as unknown as PluginSource;
}

const QQ_URL = 'https://i2.y.qq.com/n3/other/pages/details/playlist.html?id=2301168231&hosteuin=';

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('pluginPlaylistSearch importMusicSheet 精确导入（URL → 纯 ID 规范化）', () => {
  it('URL 先规范化为纯 ID 再传给插件，兼容对象返回并用其真实歌单名', async () => {
    const importMusicSheet = vi.fn(async (kw: string) => {
      expect(kw).toBe('2301168231'); // 纯 ID，不是 URL
      return {
        id: '2301168231',
        title: '我喜欢',
        artwork: 'https://y.gtimg.cn/cover.jpg',
        artist: '某人',
        worksNum: 325,
        musicList: [{ id: 's1', title: '晴天', artist: '周杰伦' }],
      };
    });
    mocks.ensurePluginInstance.mockResolvedValue({ instance: { importMusicSheet, search: vi.fn() } });

    const results = await pluginPlaylistSearch(makeSource(), QQ_URL, 1);

    expect(results).toHaveLength(1);
    expect(results[0].title).toBe('我喜欢');
    expect(results[0].trackCount).toBe(325);
    expect(results[0].artist).toBe('某人');
    expect(results[0].coverUrl).toBe('https://y.gtimg.cn/cover.jpg');
    expect(results[0].rawData.id).toBe('2301168231');
    expect(results[0].rawData._importedTracks).toHaveLength(1);
  });

  it('数组返回（musicfree 标准）仍走收藏夹命名兜底', async () => {
    const importMusicSheet = vi.fn(async (kw: string) => {
      expect(kw).toBe('2301168231');
      return [{ id: 's1', title: '晴天', artist: '周杰伦' }];
    });
    mocks.ensurePluginInstance.mockResolvedValue({ instance: { importMusicSheet, search: vi.fn() } });

    const results = await pluginPlaylistSearch(makeSource(), QQ_URL, 1);

    expect(results).toHaveLength(1);
    expect(results[0].title).toBe('QQ音乐[T]歌单');
    expect(results[0].trackCount).toBe(1);
  });

  it('插件解析失败（返回空）时回落公开搜索链路', async () => {
    const importMusicSheet = vi.fn(async () => ({ title: '', musicList: [] }));
    const search = vi.fn(async () => ({ isEnd: true, data: [] }));
    mocks.ensurePluginInstance.mockResolvedValue({ instance: { importMusicSheet, search } });

    const results = await pluginPlaylistSearch(makeSource(), QQ_URL, 1);
    expect(results).toHaveLength(0);
    expect(search).toHaveBeenCalled();
  });
});
