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
