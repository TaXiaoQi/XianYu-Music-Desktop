import { describe, expect, it } from 'vitest';

import type { PluginSource } from '../types';
import { preparePluginBackupImport } from './pluginBackupImport';

function plugin(overrides: Partial<PluginSource>): PluginSource {
  return {
    id: 'plugin-id',
    name: '网易云音乐',
    format: 'musicfree',
    version: '1.0.0',
    author: 'tester',
    description: '',
    filePath: 'C:\\plugins\\source.js',
    importedAt: 1,
    enabled: true,
    sources: ['网易云音乐'],
    ...overrides,
  };
}

describe('preparePluginBackupImport', () => {
  it('matches each platform to an installed plugin and reports missing platforms', () => {
    const backup = JSON.stringify({
      schema: 'bakamusic.music-sheet-backup',
      version: 2,
      data: {
        musicSheets: [{
          title: '收藏',
          musicList: [
            { id: 'wy-1', title: '云歌曲', artist: '歌手甲', album: '专辑甲', duration: 210, platform: '网易云音乐', qualities: { flac: { size: '20MB' } } },
            { id: 'qq-1', songmid: 'qq-mid', title: 'QQ歌曲', artist: '歌手乙', album: '专辑乙', duration: 180, platform: 'QQ音乐' },
            { id: 'bv-1', title: '视频歌曲', artist: '歌手丙', platform: 'bilibili' },
            { id: '', title: '', platform: '' },
          ],
        }],
      },
    });
    const result = preparePluginBackupImport(backup, [
      plugin({ id: 'mf-wy' }),
      plugin({ id: 'lx-wy', name: '备用落雪音源', format: 'lx', sources: ['wy'] }),
      plugin({ id: 'lx-tx', name: '落雪音源', format: 'lx', sources: ['tx'], enabled: false }),
    ]);

    expect(result.format).toBe('bakamusic');
    expect(result.totalSongCount).toBe(4);
    expect(result.importedSongCount).toBe(2);
    expect(result.playlists).toHaveLength(1);
    expect(result.playlists[0].songs).toHaveLength(2);
    expect(result.playlists[0].songs[0]).toMatchObject({
      path: 'plugin://%E7%BD%91%E6%98%93%E4%BA%91%E9%9F%B3%E4%B9%90/wy-1',
      plugin_id: 'mf-wy',
      duration: 210,
    });
    expect(result.playlists[0].songs[0].rawData).toMatchObject({
      pluginId: 'mf-wy',
      rawData: { id: 'wy-1' },
    });
    expect(result.playlists[0].songs[1]).toMatchObject({
      path: 'lx://tx/qq-mid',
      plugin_id: 'lx-tx',
      rawData: { source: 'tx', songmid: 'qq-mid' },
    });
    expect(result.associations).toEqual(expect.arrayContaining([
      expect.objectContaining({ pluginId: 'mf-wy', songCount: 1, enabled: true }),
      expect.objectContaining({ pluginId: 'lx-tx', songCount: 1, enabled: false }),
    ]));
    expect(result.missingPlugins).toEqual([{ platform: 'bilibili', songCount: 1 }]);
    expect(result.failures).toHaveLength(2);
  });

  it('supports the MusicFree top-level musicSheets layout', () => {
    const backup = JSON.stringify({
      version: 1,
      createdAt: Date.now(),
      musicSheets: [{
        name: 'MusicFree 歌单',
        musicList: [{
          musicId: 'kg-1',
          name: '酷狗歌曲',
          singer: '歌手',
          albumName: '专辑',
          duration: 203000,
          platform: '酷狗',
        }],
      }],
    });
    const result = preparePluginBackupImport(backup, [
      plugin({ id: 'mf-kg', name: '酷狗音乐', sources: ['酷狗音乐'] }),
    ]);

    expect(result.format).toBe('musicfree');
    expect(result.importedSongCount).toBe(1);
    expect(result.playlists[0]).toMatchObject({ name: 'MusicFree 歌单', originalSongCount: 1 });
    expect(result.playlists[0].songs[0]).toMatchObject({
      name: '酷狗歌曲',
      artist: '歌手',
      album: '专辑',
      duration: 203,
      plugin_id: 'mf-kg',
    });
  });

  it('rejects unrelated JSON files', () => {
    expect(() => preparePluginBackupImport('{"data":[]}', []))
      .toThrow('无法识别备份格式');
  });
});
