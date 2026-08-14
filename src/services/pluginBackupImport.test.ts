import { describe, expect, it } from 'vitest';

import type { PluginSource } from '../types';
import { describeBackupVersion, preparePluginBackupImport } from './pluginBackupImport';

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

/**
 * 歌曲 ID 的 JSON 标量类型是插件契约的一部分：部分歌词 API 只在收到
 * number 时才返回逐字歌词。BakaMusic v2 把所有 ID 字符串化，v3 起保留原型。
 *
 * 我们导入侧原先一律 String()，即使拿到完好的 v3 备份也会把数字 ID 变成字符串，
 * 导致导入的歌曲丢失逐字歌词。以下用例锁定修复后的行为。
 */
describe('preparePluginBackupImport: track id scalar types', () => {
  const wyPlugin = plugin({ id: 'mf-wy', name: '网易云音乐', sources: ['网易云音乐'] });

  /** 取出最终传给插件的 musicItem.id */
  const musicItemId = (result: ReturnType<typeof preparePluginBackupImport>) =>
    (result.playlists[0].songs[0].rawData as any).rawData.id;

  function makeBackup(version: number | undefined, id: unknown) {
    return JSON.stringify({
      schema: 'bakamusic.music-sheet-backup',
      ...(version === undefined ? {} : { version }),
      data: {
        musicSheets: [{
          title: '收藏',
          musicList: [{ id, title: '歌', artist: '手', platform: '网易云音乐' }],
        }],
      },
    });
  }

  it('preserves numeric ids from v3 backups', () => {
    const result = preparePluginBackupImport(makeBackup(3, 2748510187), [wyPlugin]);

    expect(result.backupVersion).toBe(3);
    expect(result.migratedTrackIds).toBe(false);
    expect(musicItemId(result)).toBe(2748510187);
    expect(typeof musicItemId(result)).toBe('number');
    // 路径始终是字符串形式
    expect(result.playlists[0].songs[0].path).toContain('2748510187');
  });

  it('keeps genuine string ids from v3 backups as strings', () => {
    // 酷狗的 hex hash：v3 中本就是字符串，不能被误转
    const result = preparePluginBackupImport(
      makeBackup(3, '572C3807BF90891332ED77A72DB74272'),
      [wyPlugin],
    );

    expect(musicItemId(result)).toBe('572C3807BF90891332ED77A72DB74272');
    expect(result.migratedTrackIdCount).toBe(0);
  });

  it('restores stringified numeric ids from v2 backups', () => {
    const result = preparePluginBackupImport(makeBackup(2, '2748510187'), [wyPlugin]);

    expect(result.backupVersion).toBe(2);
    expect(result.migratedTrackIds).toBe(true);
    expect(result.migratedTrackIdCount).toBe(1);
    expect(musicItemId(result)).toBe(2748510187);
    expect(typeof musicItemId(result)).toBe('number');
  });

  it.each([
    ['酷狗 hex hash', '572C3807BF90891332ED77A72DB74272'],
    ['bilibili BV 号', 'BV1px411F7UF'],
    ['前导零', '007'],
    ['带正号', '+42'],
    ['小数', '1.5'],
    ['科学计数法', '1e5'],
    ['超出安全整数范围', '9007199254740993'],
  ])('never converts %s to a number when migrating v2', (_label, id) => {
    const result = preparePluginBackupImport(makeBackup(2, id), [wyPlugin]);

    expect(musicItemId(result)).toBe(id);
    expect(typeof musicItemId(result)).toBe('string');
    expect(result.migratedTrackIdCount).toBe(0);
  });

  it('does not migrate when the version is absent or unknown', () => {
    // 未标注版本：不做有罪推定，保持原样导入
    const noVersion = preparePluginBackupImport(makeBackup(undefined, '2748510187'), [wyPlugin]);
    expect(noVersion.backupVersion).toBeNull();
    expect(noVersion.migratedTrackIds).toBe(false);
    expect(musicItemId(noVersion)).toBe('2748510187');

    // 未来的未知版本：仍照常解析，只是不迁移
    const future = preparePluginBackupImport(makeBackup(99, '2748510187'), [wyPlugin]);
    expect(future.backupVersion).toBe(99);
    expect(future.migratedTrackIds).toBe(false);
    expect(future.importedSongCount).toBe(1);
  });
});

describe('describeBackupVersion', () => {
  const wyPlugin = plugin({ id: 'mf-wy', sources: ['网易云音乐'] });

  const prepare = (version: number | undefined, id: unknown = 'wy-1') =>
    preparePluginBackupImport(JSON.stringify({
      schema: 'bakamusic.music-sheet-backup',
      ...(version === undefined ? {} : { version }),
      data: {
        musicSheets: [{ title: '收藏', musicList: [{ id, title: '歌', platform: '网易云音乐' }] }],
      },
    }), [wyPlugin]);

  it('labels a v3 backup as the new format', () => {
    expect(describeBackupVersion(prepare(3))).toBe('BakaMusic v3 新版备份');
  });

  it('reports how many ids were restored for a v2 backup', () => {
    expect(describeBackupVersion(prepare(2, '2748510187')))
      .toBe('BakaMusic v2 旧版备份，已还原 1 首歌曲 ID 以恢复逐字歌词');
  });

  it('omits the restore count when a v2 backup had no numeric ids', () => {
    expect(describeBackupVersion(prepare(2, 'BV1px411F7UF'))).toBe('BakaMusic v2 旧版备份');
  });

  it('states that the version is unlabelled when absent', () => {
    expect(describeBackupVersion(prepare(undefined))).toBe('BakaMusic 备份（未标注版本）');
  });

  it('labels MusicFree backups without claiming a Baka version', () => {
    const result = preparePluginBackupImport(JSON.stringify({
      version: 1,
      musicSheets: [{ name: 'MF', musicList: [{ musicId: 'kg-1', name: '歌', platform: '酷狗' }] }],
    }), [plugin({ id: 'mf-kg', name: '酷狗音乐', sources: ['酷狗音乐'] })]);

    expect(result.format).toBe('musicfree');
    expect(result.migratedTrackIds).toBe(false);
    expect(describeBackupVersion(result)).toBe('MusicFree v1');
  });
});

/**
 * 格式检测增强测试：通过歌曲字段特征区分 BakaMusic 和 MusicFree
 *
 * 两种格式在歌曲字段上有明显差异：
 * - BakaMusic: artist, title, album, id
 * - MusicFree: singer, name, albumName, musicId
 *
 * 当结构特征不明确时，用字段特征来辅助判断。
 */
describe('preparePluginBackupImport: format detection by song fields', () => {
  const kgPlugin = plugin({ id: 'mf-kg', name: '酷狗音乐', sources: ['酷狗音乐'] });

  it('detects MusicFree format by singer/name/albumName fields even with nested data.musicSheets', () => {
    // 模拟一个结构上像 BakaMusic（data.musicSheets），但字段是 MusicFree 风格的备份
    const backup = JSON.stringify({
      version: 1,
      data: {
        musicSheets: [{
          name: '我的歌单',
          musicList: [
            { musicId: 'kg-1', name: '歌曲1', singer: '歌手1', albumName: '专辑1', platform: '酷狗' },
            { musicId: 'kg-2', name: '歌曲2', singer: '歌手2', albumName: '专辑2', platform: '酷狗' },
            { musicId: 'kg-3', name: '歌曲3', singer: '歌手3', albumName: '专辑3', platform: '酷狗' },
          ],
        }],
      },
    });
    const result = preparePluginBackupImport(backup, [kgPlugin]);

    expect(result.format).toBe('musicfree');
    expect(result.importedSongCount).toBe(3);
  });

  it('detects BakaMusic format by artist/title/album fields even with top-level musicSheets', () => {
    // 模拟一个结构上像 MusicFree（顶层 musicSheets），但字段是 BakaMusic 风格的备份
    const backup = JSON.stringify({
      version: 2,
      musicSheets: [{
        title: '我的收藏',
        musicList: [
          { id: 'kg-1', title: '歌曲1', artist: '歌手1', album: '专辑1', platform: '酷狗' },
          { id: 'kg-2', title: '歌曲2', artist: '歌手2', album: '专辑2', platform: '酷狗' },
          { id: 'kg-3', title: '歌曲3', artist: '歌手3', album: '专辑3', platform: '酷狗' },
        ],
      }],
    });
    const result = preparePluginBackupImport(backup, [kgPlugin]);

    expect(result.format).toBe('bakamusic');
    expect(result.importedSongCount).toBe(3);
  });

  it('falls back to structure-based detection when song fields are ambiguous', () => {
    // 歌曲同时有 artist 和 singer 字段，无法从字段区分
    const backup = JSON.stringify({
      version: 1,
      musicSheets: [{
        name: '歌单',
        musicList: [
          { id: 'kg-1', title: '歌', artist: '手', singer: '手', platform: '酷狗' },
        ],
      }],
    });
    const result = preparePluginBackupImport(backup, [kgPlugin]);

    // 结构是顶层 musicSheets，应判定为 MusicFree
    expect(result.format).toBe('musicfree');
  });

  it('schema field always takes precedence over field-based detection', () => {
    // 有 schema 字段时，即使歌曲字段像 MusicFree 也应判定为 BakaMusic
    const backup = JSON.stringify({
      schema: 'bakamusic.music-sheet-backup',
      version: 3,
      data: {
        musicSheets: [{
          name: '歌单',
          musicList: [
            { musicId: 'kg-1', name: '歌曲', singer: '歌手', albumName: '专辑', platform: '酷狗' },
          ],
        }],
      },
    });
    const result = preparePluginBackupImport(backup, [kgPlugin]);

    expect(result.format).toBe('bakamusic');
  });

  it('detects BakaMusic format by Toskysun signature in author field', () => {
    // Toskysun 是 BakaMusic 的开发者，有此标识则必为 BakaMusic
    const backup = JSON.stringify({
      version: 1,
      author: 'Toskysun',
      musicSheets: [{
        name: '歌单',
        musicList: [
          { musicId: 'kg-1', name: '歌曲', singer: '歌手', platform: '酷狗' },
        ],
      }],
    });
    const result = preparePluginBackupImport(backup, [kgPlugin]);

    expect(result.format).toBe('bakamusic');
  });

  it('detects BakaMusic format by Toskysun signature in creator field', () => {
    const backup = JSON.stringify({
      version: 1,
      creator: 'BakaMusic by Toskysun',
      musicSheets: [{
        name: '歌单',
        musicList: [
          { musicId: 'kg-1', name: '歌曲', singer: '歌手', platform: '酷狗' },
        ],
      }],
    });
    const result = preparePluginBackupImport(backup, [kgPlugin]);

    expect(result.format).toBe('bakamusic');
  });

  it('treats backups authored by 时迁酱 as MusicFree before structure and field inference', () => {
    // 即使使用 data.musicSheets 和 Baka 风格歌曲字段，作者身份仍应优先判定为 MusicFree。
    const backup = JSON.stringify({
      version: 2,
      author: '时迁酱',
      data: {
        musicSheets: [{
          title: '歌单',
          musicList: [
            { id: '2748510187', title: '歌曲', artist: '歌手', album: '专辑', platform: '酷狗' },
          ],
        }],
      },
    });
    const result = preparePluginBackupImport(backup, [kgPlugin]);

    expect(result.format).toBe('musicfree');
    expect(result.migratedTrackIds).toBe(false);
    expect(result.importedSongCount).toBe(1);
  });
});

/**
 * 洛雪音乐备份导入测试
 *
 * 洛雪音乐 v2 的"备份与恢复"导出的 .lxmc 文件是 gzip 压缩的 JSON（不加密），
 * 顶层用 type 字段标识：allData_v2（备份全部数据）/ playList_v2（备份列表）/ setting_v2（备份设置）。
 * 歌单在 playList（全部备份）或 data（列表备份）数组中，每项 { id, name, list: [...] }。
 * v1 备份 type 为 allData / playList / setting。
 * 歌曲结构：{ id, name, singer, source, interval, meta: { songId, albumName, picUrl, ... } }。
 */
describe('preparePluginBackupImport: lxmusic backups', () => {
  const lxWy = plugin({ id: 'lx-wy', name: '落雪网易源', format: 'lx', sources: ['wy'] });

  const song = (overrides: Record<string, unknown> = {}) => ({
    id: 'song-unique-1',
    name: '洛雪歌曲',
    singer: '歌手',
    source: 'wy',
    interval: '03:55',
    meta: {
      songId: '2748510187',
      albumName: '专辑',
      picUrl: 'https://example.com/cover.jpg',
      _qualitys: { standard: { size: '3MB' } },
    },
    ...overrides,
  });

  it('detects lxmusic format from an allData_v2 backup', () => {
    const backup = JSON.stringify({
      type: 'allData_v2',
      setting: { common: {} },
      playList: [
        { id: 'default', name: '试听列表', list: [song()] },
        { id: 'love', name: '我的收藏', list: [song({ id: 'song-2' })] },
        { id: 'user-1', name: '我的歌单', list: [song({ id: 'song-3' })] },
      ],
    });
    const result = preparePluginBackupImport(backup, [lxWy]);

    expect(result.format).toBe('lxmusic');
    expect(result.sourcePlaylistCount).toBe(3);
    expect(result.totalSongCount).toBe(3);
    expect(result.importedSongCount).toBe(3);
    expect(result.playlists.map(p => p.name)).toEqual(['试听列表', '我的收藏', '我的歌单']);
    expect(result.playlists[0].songs[0]).toMatchObject({
      name: '洛雪歌曲',
      artist: '歌手',
      album: '专辑',
      plugin_id: 'lx-wy',
    });
  });

  it('detects lxmusic format from a playList_v2 backup', () => {
    const backup = JSON.stringify({
      type: 'playList_v2',
      data: [
        { id: 'love', name: '我的收藏', list: [song()] },
      ],
    });
    const result = preparePluginBackupImport(backup, [lxWy]);

    expect(result.format).toBe('lxmusic');
    expect(result.sourcePlaylistCount).toBe(1);
    expect(result.importedSongCount).toBe(1);
    expect(result.playlists[0].name).toBe('我的收藏');
  });

  it('detects lxmusic format from v1 allData / playList backups', () => {
    const v1All = preparePluginBackupImport(JSON.stringify({
      type: 'allData',
      playList: [{ id: 'love', name: '我的收藏', list: [song()] }],
    }), [lxWy]);
    expect(v1All.format).toBe('lxmusic');
    expect(v1All.importedSongCount).toBe(1);

    const v1List = preparePluginBackupImport(JSON.stringify({
      type: 'playList',
      data: [{ id: 'love', name: '我的收藏', list: [song()] }],
    }), [lxWy]);
    expect(v1List.format).toBe('lxmusic');
    expect(v1List.importedSongCount).toBe(1);
  });

  it('detects lxmusic format from an allData_v3 backup', () => {
    // v3 全量备份：type=allData_v3，歌单嵌套在 data.data.lists 下，
    // 包含 defaultList / loveList / userList / tempList
    const backup = JSON.stringify({
      type: 'allData_v3',
      data: {
        lists: {
          defaultList: [song()],
          loveList: [song({ id: 'song-2' })],
          userList: [{ id: 'user-1', name: '我的歌单', list: [song({ id: 'song-3' })] }],
          tempList: [],
        },
      },
    });
    const result = preparePluginBackupImport(backup, [lxWy]);

    expect(result.format).toBe('lxmusic');
    expect(result.sourcePlaylistCount).toBe(3);
    expect(result.totalSongCount).toBe(3);
    expect(result.importedSongCount).toBe(3);
    // loveList → 我的收藏, userList → 我的歌单, defaultList → 试听列表
    expect(result.playlists.map(p => p.name)).toEqual(['我的收藏', '我的歌单', '试听列表']);
    expect(result.playlists[0].songs[0]).toMatchObject({
      name: '洛雪歌曲',
      artist: '歌手',
      plugin_id: 'lx-wy',
    });
  });

  it('detects lxmusic format from a playList_v3 backup', () => {
    // v3 列表备份：type=playList_v3，歌单在 data 数组中
    const backup = JSON.stringify({
      type: 'playList_v3',
      data: [
        { id: 'love', name: '我的收藏', list: [song()] },
        { id: 'user-1', name: '我的歌单', list: [song({ id: 'song-2' })] },
      ],
    });
    const result = preparePluginBackupImport(backup, [lxWy]);

    expect(result.format).toBe('lxmusic');
    expect(result.sourcePlaylistCount).toBe(2);
    expect(result.importedSongCount).toBe(2);
    expect(result.playlists.map(p => p.name)).toEqual(['我的收藏', '我的歌单']);
  });

  it('detects lxmusic format from the internal defaultList/loveList/userList layout', () => {
    const backup = JSON.stringify({
      loveList: [song()],
      userList: [{ id: 'u1', name: '自建', list: [song({ id: 'song-2' })] }],
    });
    const result = preparePluginBackupImport(backup, [lxWy]);

    expect(result.format).toBe('lxmusic');
    expect(result.playlists.map(p => p.name)).toEqual(['我的收藏', '自建']);
    expect(result.importedSongCount).toBe(2);
  });

  it('skips empty playlists and reports when a backup has no importable playlist', () => {
    const noSheet = preparePluginBackupImport(JSON.stringify({
      type: 'allData_v2',
      playList: [{ id: 'empty', name: '空歌单', list: [] }],
    }), [lxWy]);
    expect(noSheet.format).toBe('lxmusic');
    expect(noSheet.playlists).toHaveLength(0);
    expect(noSheet.importedSongCount).toBe(0);

    // 仅设置备份（setting_v2）不含歌单，应报"未找到可导入的歌单"
    expect(() => preparePluginBackupImport(JSON.stringify({
      type: 'setting_v2',
      data: {},
    }), [lxWy])).toThrow('未找到可导入的歌单');
  });
});
