
import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import type { PluginSource } from '../../types';
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

const PLUGINS: PluginSource[] = [
  makePlugin('mf-wy', '网易云音乐', ['网易云音乐']),
  makePlugin('mf-qq', 'QQ音乐', ['QQ音乐']),
  makePlugin('mf-kg', '酷狗音乐', ['酷狗音乐']),
  makePlugin('mf-bili', '哔哩哔哩', ['bilibili']),
];

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

    const numeric = ids.filter(id => typeof id === 'number').length;
    const strings = ids.filter(id => typeof id === 'string').length;

    expect(numeric).toBeGreaterThan(0);
    expect(strings).toBeGreaterThan(0);
    expect(numeric).toBe(1768);
    expect(strings).toBe(5);
    expect(result.migratedTrackIdCount).toBe(0);
  });

  it('restores v2 stringified ids to exactly the types found in v3', () => {
    const v2 = readImport(V2_FILE);
    const v3 = readImport(V3_FILE);

    const v3TypeById = new Map<string, string>();
    for (const id of collectMusicItemIds(v3)) {
      v3TypeById.set(String(id), typeof id);
    }

    const mismatches: Array<{ id: string; got: string; expected: string }> = [];
    let compared = 0;

    for (const id of collectMusicItemIds(v2)) {
      const key = String(id);
      const expected = v3TypeById.get(key);
      if (expected === undefined) continue;
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
