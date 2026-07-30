/**
 * Tests for downloadService quality fallback.
 *
 * 关键回归点：高品（320k）直链解析成功但下载失败（如音源网关 502）时，
 * 必须自动回退到更低音质候选（128k）继续尝试，而不是整体下载失败。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { qualityToLxCandidates, sanitizeFileName } from './downloadService';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

vi.mock('./pluginEngine', () => ({
  getStoredPlugins: vi.fn(),
}));

vi.mock('./lxPluginEngine', () => ({
  lxPluginGetMusicUrl: vi.fn(),
  lxPluginGetLyric: vi.fn(),
  ensureLxPluginInstance: vi.fn().mockResolvedValue(null),
}));

vi.mock('./lxSongCache', () => ({
  getCachedLxSong: vi.fn().mockReturnValue(null),
}));

import { invoke } from '@tauri-apps/api/core';
import { getStoredPlugins } from './pluginEngine';
import { lxPluginGetMusicUrl } from './lxPluginEngine';
import { downloadSong } from './downloadService';
import type { Song } from '../types';

const makeOnlineSong = (): Song => ({
  path: 'lx://kg/song123',
  name: '测试歌曲',
  title: '测试歌曲',
  artist: '测试歌手',
  album: '测试专辑',
  duration: 200,
  source_type: 'remote',
} as unknown as Song);

const baseOptions = {
  downloadDir: 'D:\\Music',
  keepSourceFilename: false,
  overwriteExisting: true,
  downloadLyrics: false,
  lyricsFormat: 'lrc' as const,
};

describe('downloadService: quality candidates', () => {
  it('maps UI quality to ordered lx candidates with fallback (12档从高到低)', () => {
    // 'master'（最高）→ 全部12档
    expect(qualityToLxCandidates('master')).toEqual([
      'master', 'atmos_plus', 'atmos', 'dolby', 'vinyl', 'hires',
      'flac24bit', 'flac', '320k', '192k', '128k', 'mgg',
    ]);
    // '320k' → 320k及以下
    expect(qualityToLxCandidates('320k')).toEqual(['320k', '192k', '128k', 'mgg']);
    // 'flac' → flac及以下
    expect(qualityToLxCandidates('flac')).toEqual([
      'flac', '320k', '192k', '128k', 'mgg',
    ]);
    // '128k' → 128k及以下
    expect(qualityToLxCandidates('128k')).toEqual(['128k', 'mgg']);
  });

  it('sanitizes illegal filename characters', () => {
    expect(sanitizeFileName('a/b:c*d?')).toBe('a b c d');
  });
});

describe('downloadService: download fallback across qualities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getStoredPlugins as any).mockReturnValue([
      { id: 'p1', enabled: true, format: 'lx', sources: ['kg'], name: 'plugin', filePath: 'x.js' },
    ]);
    // Worker 在测试环境不可用，fetchViaWorker 会失败并回退到 Rust invoke
    vi.stubGlobal('Worker', undefined);
  });

  it('falls back to lower quality when the higher one fails to download (502)', async () => {
    // 320k 解析出链接但下载报 502；192k 解析并下载成功
    (lxPluginGetMusicUrl as any).mockImplementation(
      async (_p: unknown, _s: unknown, _info: unknown, q: string) => ({
        type: q,
        url: `https://cdn.example.com/${q}.mp3`,
      }),
    );

    (invoke as any).mockImplementation(async (cmd: string, args: any) => {
      if (cmd === 'download_online_song') {
        if (String(args.url).includes('320k')) {
          throw new Error('下载服务器返回错误状态: 502 Bad Gateway');
        }
        return args.destPath;
      }
      if (cmd === 'file_exists') return false;
      if (cmd === 'save_download_bytes') throw new Error('worker unavailable');
      return null;
    });

    const result = await downloadSong(makeOnlineSong(), {
      ...baseOptions,
      quality: '320k',
    });

    // 最终命中 192k 并成功落盘（320k → 192k）
    expect(result.hitQuality).toBe('192k');
    expect(result.filePath).toContain('测试歌手 - 测试歌曲');

    // 确认确实先尝试了 320k 再回退 192k
    const attemptedQualities = (lxPluginGetMusicUrl as any).mock.calls.map((c: any[]) => c[3]);
    expect(attemptedQualities).toEqual(['320k', '192k']);
  });

  it('throws an aggregated error when every quality fails to download', async () => {
    (lxPluginGetMusicUrl as any).mockImplementation(
      async (_p: unknown, _s: unknown, _info: unknown, q: string) => ({
        type: q,
        url: `https://cdn.example.com/${q}.mp3`,
      }),
    );

    (invoke as any).mockImplementation(async (cmd: string) => {
      if (cmd === 'download_online_song') {
        throw new Error('下载服务器返回错误状态: 502 Bad Gateway');
      }
      if (cmd === 'file_exists') return false;
      if (cmd === 'save_download_bytes') throw new Error('worker unavailable');
      return null;
    });

    await expect(
      downloadSong(makeOnlineSong(), { ...baseOptions, quality: '320k' }),
    ).rejects.toThrow(/502/);
  });

  it('skips a quality whose url resolution returns empty and downloads the next one', async () => {
    // 320k 返回空URL（解析失败），自动跳过并尝试 192k
    (lxPluginGetMusicUrl as any).mockImplementation(
      async (_p: unknown, _s: unknown, _info: unknown, q: string) =>
        q === '320k' ? { type: q, url: '' } : { type: q, url: `https://cdn.example.com/${q}.mp3` },
    );

    (invoke as any).mockImplementation(async (cmd: string, args: any) => {
      if (cmd === 'download_online_song') return args.destPath;
      if (cmd === 'file_exists') return false;
      if (cmd === 'save_download_bytes') throw new Error('worker unavailable');
      return null;
    });

    const result = await downloadSong(makeOnlineSong(), { ...baseOptions, quality: '320k' });
    // 320k 解析失败 → 跳过 → 命中 192k
    expect(result.hitQuality).toBe('192k');
  });
});
