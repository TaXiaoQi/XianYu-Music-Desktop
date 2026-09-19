
import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import type { PluginSource } from '../../types';
import { gunzipSync } from '../pureInflate';
import { preparePluginBackupImport } from './pluginBackupImport';

const LXMC_FILE = 'C:\\Users\\小奇\\Downloads\\lx_backup.lxmc';
const hasFixture = fs.existsSync(LXMC_FILE);

function makeLxPlugin(): PluginSource {
  return {
    id: 'lx-xinghai-test',
    name: '星海音乐源',
    format: 'lx',
    version: '2.3.13',
    author: 'tester',
    description: '',
    filePath: 'C:\\plugins\\1.xinghai-music-sourcev2.3.13.js',
    importedAt: 1,
    enabled: true,
    sources: ['wy', 'tx', 'kw', 'kg', 'mg', '网易云音乐', 'QQ音乐', '酷我音乐', '酷狗音乐', '咪咕音乐'],
  } as unknown as PluginSource;
}

function decodeLxmc(file: string): string {
  const bytes = fs.readFileSync(file);
  return new TextDecoder().decode(gunzipSync(new Uint8Array(bytes)));
}

describe.skipIf(!hasFixture)('preparePluginBackupImport: real LX .lxmc backup', () => {
  const readImport = () => preparePluginBackupImport(decodeLxmc(LXMC_FILE), [makeLxPlugin()]);

  it('decodes gzip and detects the lxmusic backup format', () => {
    const result = readImport();
    expect(result.format).toBe('lxmusic');
    expect(result.sourcePlaylistCount).toBe(2);
  });

  it('imports every track with the LX plugin bound', () => {
    const result = readImport();
    expect(result.totalSongCount).toBe(456);
    expect(result.missingPlugins).toEqual([]);
    expect(result.importedSongCount).toBe(456);
    for (const playlist of result.playlists) {
      expect(playlist.songs.length).toBeGreaterThan(0);
      for (const song of playlist.songs) {
        expect(song.plugin_id).toBe('lx-xinghai-test');
        expect(song.path).toMatch(/^lx:\/\/(wy|tx|kw|kg|mg)\//);
      }
    }
  });

  it('keeps per-platform source keys on songs (wy/tx/kw/kg)', () => {
    const result = readImport();
    const sourceKeys = new Set<string>();
    for (const playlist of result.playlists) {
      for (const song of playlist.songs) {
        const key = (song.rawData as any)?.rawData?.source ?? song.rawData?.source;
        if (typeof key === 'string') sourceKeys.add(key);
      }
    }
    expect(sourceKeys.size).toBeGreaterThan(0);
    for (const key of sourceKeys) {
      expect(['wy', 'tx', 'kw', 'kg', 'mg']).toContain(key);
    }
  });
});
