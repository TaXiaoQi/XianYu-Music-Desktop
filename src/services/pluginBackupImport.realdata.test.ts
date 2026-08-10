/**
 * 真实备份数据回归测试。
 *
 * 使用同一份音乐库导出的 BakaMusic v2 / v3 两份备份（1773 首歌、4 个歌单）
 * 作为基准：v2 把所有歌曲 ID 字符串化，v3 保留原始标量类型。
 *
 * 断言导入 v2 后还原出的 ID 类型，与 v3 中该 ID 的真实类型逐一吻合。
 * 这比手编用例更能证明迁移算法在真实平台数据（网易云/QQ 数字 ID、
 * 酷狗 hex hash、bilibili BV 号）上不会误判。
 *
 * 备份文件不在仓库中时自动跳过，避免因缺少本地素材导致 CI 失败。
 */

import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import type { PluginSource } from '../types';
import { preparePluginBackupImport } from './pluginBackupImport';

const FIXTURE_DIR = path.resolve(__dirname, '../../.narrafork/attached');
const V2_FILE = path.join(FIXTURE_DIR, 'BakaMusicBackup-2026-08-04T13-40-35Z.json');
const V3_FILE = path.join(FIXTURE_DIR, '新版.json');

const hasFixtures = fs.existsSync(V2_FILE) && fs.existsSync(V3_FILE);

function makePlugin(id: string, name: string, sources: string[]): PluginSource {
  return {
    id,
    name,
    format: 'musicfree',
    version: '1.0.0',
    author: 'tester',
    description: '',
    filePath: 'C:\\plugins\\source.js',
    importedAt: 1,
    enabled: true,
    sources,
  } as PluginSource;
}

// 覆盖备份中出现的全部平台，确保没有歌曲因缺插件而被跳过
const PLUGINS: PluginSource[] = [
  makePlugin('mf-wy', '网易云音乐', ['网易云音乐']),
  makePlugin('mf-qq', 'QQ音乐', ['QQ音乐']),
  makePlugin('mf-kg', '酷狗音乐', ['酷狗音乐']),
  makePlugin('mf-bili', '哔哩哔哩', ['bilibili']),
];

/** 收集导入结果中每首歌最终传给插件的 musicItem.id */
function collectMusicItemIds(result: ReturnType<typeof preparePluginBackupImport>) {
  const ids: Array<string | number> = [];
  for (const playlist of result.playlists) {
    for (const song of playlist.songs) {
      const raw = (song.rawData as any)?.rawData;
      if (raw && 'id' in raw) ids.push(raw.id);
    }
  }
  return ids;
}

describe.skipIf(!hasFixtures)('preparePluginBackupImport: real BakaMusic backups', () => {
  const readImport = (file: string) =>
    preparePluginBackupImport(fs.readFileSync(file, 'utf8'), PLUGINS);

  it('detects the declared version of each backup', () => {
    expect(readImport(V2_FILE).backupVersion).toBe(2);
    expect(readImport(V3_FILE).backupVersion).toBe(3);
  });

  it('only enables id migration for the v2 backup', () => {
    expect(readImport(V2_FILE).migratedTrackIds).toBe(true);
    expect(readImport(V3_FILE).migratedTrackIds).toBe(false);
  });

  it('preserves the numeric ids already present in the v3 backup', () => {
    const result = readImport(V3_FILE);
    const ids = collectMusicItemIds(result);

    // v3 中网易云(1765)+QQ(3) 为 number，酷狗(3)+bilibili(2) 为 string
    const numeric = ids.filter(id => typeof id === 'number').length;
    const strings = ids.filter(id => typeof id === 'string').length;

    expect(numeric).toBeGreaterThan(0);
    expect(strings).toBeGreaterThan(0);
    // 导入不得把任何 v3 数字 ID 退化成字符串
    expect(numeric).toBe(1768);
    expect(strings).toBe(5);
    expect(result.migratedTrackIdCount).toBe(0);
  });

  it('restores v2 stringified ids to exactly the types found in v3', () => {
    const v2 = readImport(V2_FILE);
    const v3 = readImport(V3_FILE);

    // 以 ID 的字符串形式为键建立 v3 类型索引。
    // 用 ID 值而非标题配对：两份备份相隔数日，少量同名歌曲被换成了
    // 不同的音源 ID，按标题配对会把「歌曲被替换」误判为「迁移出错」。
    const v3TypeById = new Map<string, string>();
    for (const id of collectMusicItemIds(v3)) {
      v3TypeById.set(String(id), typeof id);
    }

    const mismatches: Array<{ id: string; got: string; expected: string }> = [];
    let compared = 0;

    for (const id of collectMusicItemIds(v2)) {
      const key = String(id);
      const expected = v3TypeById.get(key);
      if (expected === undefined) continue; // 该 ID 在 v3 中不存在（歌曲被替换）
      compared += 1;
      const got = typeof id;
      if (got !== expected) mismatches.push({ id: key, got, expected });
    }

    expect(compared).toBeGreaterThan(1700);
    expect(mismatches).toEqual([]);
  });

  it('imports every track in both backups without loss', () => {
    for (const file of [V2_FILE, V3_FILE]) {
      const result = readImport(file);
      expect(result.sourcePlaylistCount).toBe(4);
      expect(result.totalSongCount).toBe(1773);
      // 四个平台的插件都已提供，不应有歌曲因缺插件被丢弃
      expect(result.missingPlugins).toEqual([]);
      expect(result.importedSongCount).toBe(1773);
    }
  });

  it('keeps every generated path a string regardless of id type', () => {
    for (const file of [V2_FILE, V3_FILE]) {
      const result = readImport(file);
      for (const playlist of result.playlists) {
        for (const song of playlist.songs) {
          expect(typeof song.path).toBe('string');
          expect(song.path.length).toBeGreaterThan(0);
        }
      }
    }
  });
});
