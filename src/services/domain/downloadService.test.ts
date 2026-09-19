
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { qualityToLxCandidates, fetchLyricText } from './downloadService';
import { getStoredPlugins, pluginGetLyric } from './pluginEngine';

vi.mock('../tauri/invoke', () => ({
  tauriInvoke: vi.fn(),
}));

vi.mock('./pluginEngine', () => ({
  getStoredPlugins: vi.fn(),
  pluginGetCover: vi.fn(),
  pluginGetLyric: vi.fn(),
  pluginGetMusicInfo: vi.fn(),
  pluginGetBakaMusicInfo: vi.fn(),
  isBakaPlugin: vi.fn(),
}));

vi.mock('./lxPluginEngine', () => ({
  lxPluginGetMusicUrl: vi.fn(),
  lxPluginGetLyric: vi.fn(),
  lxPluginGetPic: vi.fn(),
  ensureLxPluginInstance: vi.fn().mockResolvedValue(null),
}));

vi.mock('./lxSongCache', () => ({
  getCachedLxSong: vi.fn().mockReturnValue(null),
  cacheLxSong: vi.fn(),
}));

const {
  mockFindLxPluginForSource,
  mockResolveLxUrlForSingleQuality,
  mockResolveLxUrl,
} = vi.hoisted(() => ({
  mockFindLxPluginForSource: vi.fn(),
  mockResolveLxUrlForSingleQuality: vi.fn(),
  mockResolveLxUrl: vi.fn(),
}));

vi.mock('./lxUrlResolver', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./lxUrlResolver')>();
  return {
    parseLxPath: actual.parseLxPath,
    resolveLxCachedInfo: vi.fn(() => null),
    findLxPluginForSource: mockFindLxPluginForSource,
    buildLxSongInfo: vi.fn((_song: unknown, songmid: string, lxSource: string) => ({
      songId: songmid,
      source: lxSource,
      songmid,
    })),
    resolveLxUrlForSingleQuality: mockResolveLxUrlForSingleQuality,
    resolveLxUrl: mockResolveLxUrl,
  };
});

vi.mock('../../features/playback/store', () => ({
  usePlaybackStore: vi.fn().mockReturnValue({
    currentPlayingAudioUrl: null,
    currentPlayingQuality: null,
    currentSong: null,
  }),
}));

import { tauriInvoke } from '../tauri/invoke';
import { getStoredPlugins, isBakaPlugin, pluginGetBakaMusicInfo } from './pluginEngine';
import { lxPluginGetMusicUrl } from './lxPluginEngine';
import { cacheLxSong } from './lxSongCache';
import { downloadSong, probeDownloadableQualities, resolveOnlineQualityUrl } from './downloadService';
import type { QualityKey, Song } from '../../types';

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
  downloadCover: false,
  lyricsFormat: 'lrc' as const,
};

function mockResolveDownloadFullPath(args: any): string {
  const { title, artist, url, fileNameStyle } = args;
  const t = title || '未知歌曲';
  let base: string;
  switch (fileNameStyle) {
    case 'title-artist':
      base = [t, artist].filter(Boolean).join(' - ');
      break;
    case 'title-artist-album':
      base = [t, artist, args.album].filter(Boolean).join(' - ');
      break;
    default:
      base = [artist, t].filter(Boolean).join(' - ');
  }
  if (!base) base = t;
  let ext = '.mp3';
  try {
    const u = new URL(url);
    const dot = u.pathname.lastIndexOf('.');
    if (dot !== -1) {
      const e = u.pathname.slice(dot).toLowerCase();
      if (/^\.(mp3|flac|wav|m4a|aac|ape|ogg|wma)$/.test(e)) ext = e;
    }
  } catch { /* ignore */ }
  return `D:\\Music\\${base}${ext}`;
}

describe('downloadService: quality candidates', () => {
  it('maps UI quality to ordered lx candidates with fallback (12档从高到低)', () => {
    expect(qualityToLxCandidates('master')).toEqual([
      'master', 'atmos_plus', 'atmos', 'dolby', 'vinyl', 'hires',
      'flac24bit', 'flac', '320k', '192k', '128k', 'mgg',
    ]);
    expect(qualityToLxCandidates('320k')).toEqual(['320k', '192k', '128k', 'mgg']);
    expect(qualityToLxCandidates('flac')).toEqual([
      'flac', '320k', '192k', '128k', 'mgg',
    ]);
    expect(qualityToLxCandidates('128k')).toEqual(['128k', 'mgg']);
  });
});

describe('downloadService: QQ 插件原生适配（无 LX 兜底）', () => {
  const qqPlugin = { id: 'qq1', enabled: true, format: 'musicfree', sources: ['QQ音乐'], name: 'QQ音乐', filePath: 'x.js' };

  const makeQqPluginSong = (): Song => ({
    path: 'plugin://0039MnYb0qxYhV',
    name: '晴天',
    title: '晴天',
    artist: '周杰伦',
    album: '叶惠美',
    source_type: 'remote',
    rawData: {
      pluginId: 'qq1',
      id: '97773',
      platform: 'QQ音乐',
      rawData: {
        id: '97773',
        songmid: '0039MnYb0qxYhV',
        qualities: { '320k': {}, '128k': {} },
      },
    },
  } as unknown as Song);

  beforeEach(() => {
    vi.clearAllMocks();
    (getStoredPlugins as any).mockReturnValue([qqPlugin]);
    (isBakaPlugin as any).mockResolvedValue(true);
    (pluginGetBakaMusicInfo as any).mockResolvedValue(null);
  });

  it('插件全档失败后如实返回 null，不再借 LX tx 音源兜底', async () => {
    const result = await resolveOnlineQualityUrl(makeQqPluginSong(), '320k', 'lower', null);

    expect(mockResolveLxUrl).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  it('非 QQ 插件同样不走 LX 兜底', async () => {
    const kgPlugin = { ...qqPlugin, id: 'kg1', name: '酷狗音乐', sources: ['酷狗音乐'] };
    (getStoredPlugins as any).mockReturnValue([kgPlugin]);
    const song = { ...makeQqPluginSong(), rawData: { ...makeQqPluginSong().rawData, pluginId: 'kg1', platform: '酷狗音乐' } } as unknown as Song;

    await resolveOnlineQualityUrl(song, '320k', 'lower', null);

    expect(mockResolveLxUrl).not.toHaveBeenCalled();
  });

  it('下载时插件全档失败后抛出聚合错误，不落 LX 兜底文件', async () => {
    (tauriInvoke as any).mockImplementation(async (cmd: string, args: any) => {
      if (cmd === 'download_online_song') return args.fileName;
      if (cmd === 'resolve_download_full_path') return mockResolveDownloadFullPath(args);
      if (cmd === 'file_exists') return false;
      return null;
    });

    await expect(downloadSong(makeQqPluginSong(), { ...baseOptions, quality: '320k' }))
      .rejects.toThrow('下载失败');
    expect(mockResolveLxUrl).not.toHaveBeenCalled();
  });

  it('探测时插件全档失败后返回空结果，不借 LX 音源补齐', async () => {
    const result = await probeDownloadableQualities(makeQqPluginSong(), ['320k', '128k']);

    expect(mockResolveLxUrl).not.toHaveBeenCalled();
    expect(result.available).toEqual([]);
    expect(result.resolvedUrls).toEqual({});
  });
});

describe('downloadService: 网易云插件原生适配（无 LX 兜底）', () => {
  const wyPlugin = { id: 'wy1', enabled: true, format: 'musicfree', sources: ['网易云音乐'], name: '网易云音乐', filePath: 'x.js' };

  const makeWyPluginSong = (): Song => ({
    path: 'plugin://186016',
    name: '晴天',
    title: '晴天',
    artist: '周杰伦',
    album: '叶惠美',
    source_type: 'remote',
    rawData: {
      pluginId: 'wy1',
      id: '186016',
      platform: '网易云音乐',
      rawData: {
        id: '186016',
        platform: '网易云音乐',
        qualities: { '320k': {}, '128k': {} },
      },
    },
  } as unknown as Song);

  beforeEach(() => {
    vi.clearAllMocks();
    (getStoredPlugins as any).mockReturnValue([wyPlugin]);
    (isBakaPlugin as any).mockResolvedValue(true);
    (pluginGetBakaMusicInfo as any).mockResolvedValue(null);
  });

  it('插件全档失败后如实返回 null，不再借 LX wy 音源兜底', async () => {
    const result = await resolveOnlineQualityUrl(makeWyPluginSong(), '320k', 'lower', null);

    expect(mockResolveLxUrl).not.toHaveBeenCalled();
    expect(result).toBeNull();
    expect(cacheLxSong).not.toHaveBeenCalled();
  });

  it('fallback to existing song.lyrics when network lyrics fetch yields no result', async () => {
    const song = {
      path: 'plugin://test/song1',
      plugin_id: 'p1',
      title: '测试歌曲',
      artist: '测试歌手',
      lyrics: '[00:01.00]预置歌词文本',
    } as unknown as Song;

    (getStoredPlugins as any).mockReturnValue([{ id: 'p1', enabled: true }]);
    (pluginGetLyric as any).mockResolvedValue(null);

    const lrc = await fetchLyricText(song, 'lrc', 'line-by-line');
    expect(lrc).toBe('[00:01.00]预置歌词文本');
  });

  it('非网易云插件同样不走 LX 兜底', async () => {
    const kgPlugin = { ...wyPlugin, id: 'kg1', name: '酷狗音乐', sources: ['酷狗音乐'] };
    (getStoredPlugins as any).mockReturnValue([kgPlugin]);
    const song = { ...makeWyPluginSong(), rawData: { ...makeWyPluginSong().rawData, pluginId: 'kg1', platform: '酷狗音乐' } } as unknown as Song;

    await resolveOnlineQualityUrl(song, '320k', 'lower', null);

    expect(mockResolveLxUrl).not.toHaveBeenCalled();
  });
});

describe('downloadService: download fallback across qualities', () => {
  const mockPlugin = { id: 'p1', enabled: true, format: 'lx', sources: ['kg'], name: 'plugin', filePath: 'x.js' };

  beforeEach(() => {
    vi.clearAllMocks();
    (getStoredPlugins as any).mockReturnValue([mockPlugin]);
    mockFindLxPluginForSource.mockReturnValue(mockPlugin);
    mockResolveLxUrlForSingleQuality.mockImplementation(
      async (_plugin: any, _lxSource: string, _songInfo: any, quality: string) => {
        const result = await (lxPluginGetMusicUrl as any)(_plugin, _lxSource, _songInfo, quality);
        const url = result?.url;
        if (!url || !/^https?:/.test(url)) return null;
        return { url, quality };
      },
    );
  });

  it('falls back to lower quality when the higher one fails to download (502)', async () => {
    (lxPluginGetMusicUrl as any).mockImplementation(
      async (_p: unknown, _s: unknown, _info: unknown, q: string) => ({
        type: q,
        url: `https://cdn.example.com/${q}.mp3`,
      }),
    );

    (tauriInvoke as any).mockImplementation(async (cmd: string, args: any) => {
      if (cmd === 'download_online_song') {
        if (String(args.url).includes('320k')) {
          throw new Error('下载服务器返回错误状态: 502 Bad Gateway');
        }
        return args.fileName;
      }
      if (cmd === 'resolve_download_full_path') return mockResolveDownloadFullPath(args);
      if (cmd === 'file_exists') return false;
      return null;
    });

    const result = await downloadSong(makeOnlineSong(), {
      ...baseOptions,
      quality: '320k',
    });

    expect(result.hitQuality).toBe('192k');
    expect(result.filePath).toContain('测试歌手 - 测试歌曲');

    const attemptedQualities = (mockResolveLxUrlForSingleQuality as any).mock.calls.map((c: any[]) => c[3]);
    expect(attemptedQualities).toEqual(['320k', '192k']);
  });

  it('throws an aggregated error when every quality fails to download', async () => {
    (lxPluginGetMusicUrl as any).mockImplementation(
      async (_p: unknown, _s: unknown, _info: unknown, q: string) => ({
        type: q,
        url: `https://cdn.example.com/${q}.mp3`,
      }),
    );

    (tauriInvoke as any).mockImplementation(async (cmd: string) => {
      if (cmd === 'download_online_song') {
        throw new Error('下载服务器返回错误状态: 502 Bad Gateway');
      }
      if (cmd === 'resolve_download_full_path') return 'D:\\Music\\test.mp3';
      if (cmd === 'file_exists') return false;
      return null;
    });

    await expect(
      downloadSong(makeOnlineSong(), { ...baseOptions, quality: '320k' }),
    ).rejects.toThrow(/502/);
  });

  it('skips a quality whose url resolution returns empty and downloads the next one', async () => {
    (lxPluginGetMusicUrl as any).mockImplementation(
      async (_p: unknown, _s: unknown, _info: unknown, q: string) =>
        q === '320k' ? { type: q, url: '' } : { type: q, url: `https://cdn.example.com/${q}.mp3` },
    );

    (tauriInvoke as any).mockImplementation(async (cmd: string, args: any) => {
      if (cmd === 'download_online_song') return args.fileName;
      if (cmd === 'resolve_download_full_path') return mockResolveDownloadFullPath(args);
      if (cmd === 'file_exists') return false;
      return null;
    });

    const result = await downloadSong(makeOnlineSong(), { ...baseOptions, quality: '320k' });
    expect(result.hitQuality).toBe('192k');
  });

  it('reuses preResolvedUrls and skips redundant url resolution', async () => {
    (tauriInvoke as any).mockImplementation(async (cmd: string, args: any) => {
      if (cmd === 'download_online_song') return args.fileName;
      if (cmd === 'resolve_download_full_path') return mockResolveDownloadFullPath(args);
      if (cmd === 'file_exists') return false;
      return null;
    });

    const result = await downloadSong(makeOnlineSong(), {
      ...baseOptions,
      quality: '320k',
      preResolvedUrls: { '320k': 'https://cdn.example.com/pre-320k.mp3' },
    });

    expect(result.hitQuality).toBe('320k');
    expect(mockResolveLxUrlForSingleQuality).not.toHaveBeenCalled();
  });
});

describe('downloadService: probeDownloadableQualities', () => {
  const mockPlugin = { id: 'p1', enabled: true, format: 'lx', sources: ['kg'], name: 'plugin', filePath: 'x.js' };
  const declared: QualityKey[] = ['128k', '320k', 'flac', 'flac24bit'];

  beforeEach(() => {
    vi.clearAllMocks();
    (getStoredPlugins as any).mockReturnValue([mockPlugin]);
    mockFindLxPluginForSource.mockReturnValue(mockPlugin);
    mockResolveLxUrlForSingleQuality.mockImplementation(
      async (_plugin: any, _lxSource: string, _songInfo: any, quality: string) => {
        const result = await (lxPluginGetMusicUrl as any)(_plugin, _lxSource, _songInfo, quality);
        const url = result?.url;
        if (!url || !/^https?:/.test(url)) return null;
        return { url, quality };
      },
    );
  });

  it('only reports qualities that actually resolve to a url', async () => {
    (lxPluginGetMusicUrl as any).mockImplementation(
      async (_p: unknown, _s: unknown, _info: unknown, q: string) =>
        (q === '320k' || q === '128k')
          ? { type: q, url: `https://cdn.example.com/${q}.mp3` }
          : { type: q, url: '' },
    );

    const result = await probeDownloadableQualities(makeOnlineSong(), declared);

    expect(result.available).toEqual(['128k', '320k']);
    expect(result.resolvedUrls['320k']).toBe('https://cdn.example.com/320k.mp3');
    expect(result.resolvedUrls.flac).toBeUndefined();
    expect(result.resolvedUrls.flac24bit).toBeUndefined();
  });

  it('treats a lossless quality silently degraded to mp3 as unavailable', async () => {
    (lxPluginGetMusicUrl as any).mockImplementation(
      async (_p: unknown, _s: unknown, _info: unknown, q: string) =>
        q === 'flac'
          ? { type: q, url: 'https://cdn.example.com/degraded.mp3' }
          : { type: q, url: `https://cdn.example.com/${q}.mp3` },
    );

    const result = await probeDownloadableQualities(makeOnlineSong(), ['320k', 'flac']);

    expect(result.available).toEqual(['320k']);
    expect(result.resolvedUrls.flac).toBeUndefined();
  });

  it('never probes qualities outside the declared list', async () => {
    (lxPluginGetMusicUrl as any).mockImplementation(
      async (_p: unknown, _s: unknown, _info: unknown, q: string) =>
        ({ type: q, url: `https://cdn.example.com/${q}.mp3` }),
    );

    await probeDownloadableQualities(makeOnlineSong(), ['320k', '128k']);

    const probed = (mockResolveLxUrlForSingleQuality as any).mock.calls.map((c: any[]) => c[3]);
    expect(probed.sort()).toEqual(['128k', '320k']);
  });

  it('does not fallback to probing every quality when declared list is missing', async () => {
    const result = await probeDownloadableQualities(makeOnlineSong(), null);

    expect(result.available).toEqual([]);
    expect(result.resolvedUrls).toEqual({});
    expect(mockResolveLxUrlForSingleQuality).not.toHaveBeenCalled();
  });

  it('returns an empty result without probing when already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    const result = await probeDownloadableQualities(makeOnlineSong(), declared, {
      signal: controller.signal,
    });

    expect(result.available).toEqual([]);
    expect(result.resolvedUrls).toEqual({});
    expect(mockResolveLxUrlForSingleQuality).not.toHaveBeenCalled();
  });

  it('keeps probing remaining qualities when one throws', async () => {
    (lxPluginGetMusicUrl as any).mockImplementation(
      async (_p: unknown, _s: unknown, _info: unknown, q: string) => {
        if (q === 'flac') throw new Error('音源网关异常');
        return { type: q, url: `https://cdn.example.com/${q}.mp3` };
      },
    );

    const result = await probeDownloadableQualities(makeOnlineSong(), ['320k', 'flac']);

    expect(result.available).toEqual(['320k']);
  });

  it('returns an empty result for non-online songs', async () => {
    const localSong = { path: 'D:\\Music\\local.flac', name: 'local' } as unknown as Song;

    const result = await probeDownloadableQualities(localSong, declared);

    expect(result.available).toEqual([]);
    expect(mockResolveLxUrlForSingleQuality).not.toHaveBeenCalled();
  });
});

describe('downloadService: probe collapse to actual quality (咪咕降级场景)', () => {
  const mgPlugin = { id: 'mg1', enabled: true, format: 'musicfree', sources: ['咪咕音乐'], name: '咪咕音乐', filePath: 'x.js' };

  const makeMiguSong = (): Song => ({
    path: 'plugin://migu0001',
    name: '测试曲',
    title: '测试曲',
    artist: '歌手',
    album: '专辑',
    source_type: 'remote',
    rawData: { pluginId: 'mg1', id: '1', platform: '咪咕音乐', rawData: { qualities: {} } },
  } as unknown as Song);

  beforeEach(() => {
    vi.clearAllMocks();
    (getStoredPlugins as any).mockReturnValue([mgPlugin]);
    (isBakaPlugin as any).mockResolvedValue(true);
    (pluginGetBakaMusicInfo as any).mockImplementation(
      async () => ({
        url: 'https://cdn.migu.cn/audio.flac',
        actualQuality: 'flac24bit',
      }),
    );
  });

  it('高请求档降级到同一实际档时塌缩登记，音质菜单只显示真实可得的档位', async () => {
    const declared: QualityKey[] = ['flac', 'flac24bit', 'hires', 'atmos', 'atmos_plus'];
    const result = await probeDownloadableQualities(makeMiguSong(), declared);

    expect(result.available).toEqual(['flac24bit']);
    expect(result.resolvedUrls).toEqual({ flac24bit: 'https://cdn.migu.cn/audio.flac' });
  });
});
