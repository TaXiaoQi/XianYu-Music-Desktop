import { describe, expect, it, vi, beforeEach } from 'vitest';

// importPlaylist 的内置直连导入需对应平台有启用 lx 插件：无插件时必须报错且不发起请求
const state = vi.hoisted(() => ({ plugins: [] as any[] }));
vi.mock('./pluginEngine', () => ({
  getStoredPlugins: vi.fn(() => state.plugins),
  pluginGetPlaylistDetailWithEnd: vi.fn(),
  pluginImportMusicSheet: vi.fn(),
  pluginPlaylistSearch: vi.fn(),
}));
vi.mock('../tauri/playlistImportApi', () => ({
  playlistImportApi: {
    fetchPlaylistFromSource: vi.fn(),
  },
}));
vi.mock('../fallbackModules/registry', () => ({
  fallbackMethodDisabled: vi.fn(() => false),
}));
vi.mock('./pluginCatalogSearch', () => ({
  looksLikeSheetLinkOrId: vi.fn(() => false),
  sourceMatchesHostPlatform: vi.fn(() => false),
}));

import { playlistImportApi } from '../tauri/playlistImportApi';
import { importPlaylist } from './playlistImport';

beforeEach(() => {
  state.plugins = [];
  (playlistImportApi.fetchPlaylistFromSource as ReturnType<typeof vi.fn>).mockReset();
});

describe('importPlaylist 内置直连的插件启用 gate', () => {
  it('无启用插件 → 报错且不请求内置接口', async () => {
    await expect(
      importPlaylist('tx', 'https://i2.y.qq.com/n3/other/pages/details/playlist.html?id=2301168231'),
    ).rejects.toThrow('QQ音乐未启用对应音源插件');
    expect(playlistImportApi.fetchPlaylistFromSource).not.toHaveBeenCalled();
  });

  it('纯数字 ID + auto 音源同样被 gate 拦截', async () => {
    await expect(importPlaylist('auto', '2301168231')).rejects.toThrow();
    expect(playlistImportApi.fetchPlaylistFromSource).not.toHaveBeenCalled();
  });

  it('有启用的对应 lx 插件 → 正常走内置直连', async () => {
    state.plugins = [
      { id: 'lx-tx', name: 'QQ音乐', format: 'lx', enabled: true, sources: ['tx'] },
    ];
    (playlistImportApi.fetchPlaylistFromSource as ReturnType<typeof vi.fn>).mockResolvedValue({
      source: 'tx',
      songs: [{ id: '003MUv3q2XfUvE', title: '晴天' }],
      total: 1,
      info: { name: '测试歌单', img: '', desc: '', author: '', playCount: '0' },
    });

    const result = await importPlaylist('tx', '8012590246');
    expect(result.songs).toHaveLength(1);
    expect(playlistImportApi.fetchPlaylistFromSource).toHaveBeenCalledWith('tx', '8012590246');
  });

  it('启用的是其他平台插件（wy）→ tx 导入仍被拦截', async () => {
    state.plugins = [
      { id: 'lx-wy', name: '网易云', format: 'lx', enabled: true, sources: ['wy'] },
    ];
    await expect(importPlaylist('tx', '8012590246')).rejects.toThrow('QQ音乐未启用对应音源插件');
    expect(playlistImportApi.fetchPlaylistFromSource).not.toHaveBeenCalled();
  });
});
