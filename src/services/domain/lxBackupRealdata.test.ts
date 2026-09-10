/**
 * 洛雪 .lxmc 真实备份回归测试（星海 LX 插件导入场景）。
 *
 * 用真实导出的 lx_backup.lxmc（洛雪桌面 v3 全量备份，456 首、2 歌单）
 * 走 preparePluginBackupImport 全链路：gzip 解压 → 格式识别 → LX 平台
 * 归类 → LX 格式插件绑定。
 *
 * 备份文件不在本机时自动跳过，避免 CI 缺素材失败。
 */

import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import type { PluginSource } from '../../types';
import { gunzipSync } from '../pureInflate';
import { preparePluginBackupImport } from './pluginBackupImport';

const LXMC_FILE = 'C:\\Users\\小奇\\Downloads\\lx_backup.lxmc';
const hasFixture = fs.existsSync(LXMC_FILE);

/** 星海插件的 LX 源 key + 中文平台名都给上，覆盖匹配器的两种输入 */
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

/** 解码 .lxmc：gzip 解压 + UTF-8（对齐 readBackupFileContent 的 lxmc 分支） */
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
