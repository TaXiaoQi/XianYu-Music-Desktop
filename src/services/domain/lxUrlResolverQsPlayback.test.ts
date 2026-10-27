import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../tauri/invoke', () => ({
  tauriInvoke: vi.fn(),
}));

vi.mock('./lxPluginEngine', () => ({
  lxPluginGetMusicUrl: vi.fn(),
  ensureLxPluginInstance: vi.fn().mockResolvedValue(null),
}));

vi.mock('./lxSongCache', () => ({
  getCachedLxSong: vi.fn().mockReturnValue(null),
  cacheLxSong: vi.fn(),
}));

vi.mock('./pluginEngine', () => ({
  getStoredPlugins: vi.fn().mockReturnValue([]),
}));

import { tauriInvoke } from '../tauri/invoke';
import { resolveLxUrlForSingleQuality } from './lxUrlResolver';

const mockTauriInvoke = vi.mocked(tauriInvoke);

const QS_UA = 'LunaPC/3.5.2(412998333)';

describe('lxUrlResolver 汽水（qs）原生取流拦截', () => {
  beforeEach(() => {
    mockTauriInvoke.mockReset();
  });

  it('走 resolve_qs_play 并透传 url/headers/cek（插件可为空）', async () => {
    mockTauriInvoke.mockResolvedValueOnce({
      url: 'https://sf6-cm1-cdn.muscdn.com/obj/qs-audio/718923.m4a',
      quality: '320k',
      bitrate: 320000,
      size: 4096,
      headers: { 'User-Agent': QS_UA },
      cek: 'a1b2c3d4e5f60718293a4b5c6d7e8f90',
    });

    const result = await resolveLxUrlForSingleQuality(
      null as never,
      'qs',
      { songmid: '718923', name: 'test' },
      '320k',
    );

    expect(mockTauriInvoke).toHaveBeenCalledTimes(1);
    expect(mockTauriInvoke).toHaveBeenCalledWith('resolve_qs_play', {
      trackId: '718923',
      quality: '320k',
    });
    expect(result).toEqual({
      url: 'https://sf6-cm1-cdn.muscdn.com/obj/qs-audio/718923.m4a',
      quality: '320k',
      headers: { 'User-Agent': QS_UA },
      cek: 'a1b2c3d4e5f60718293a4b5c6d7e8f90',
    });
  });

  it('缓存命中：同参二次解析不再 invoke 且保留 headers/cek', async () => {
    mockTauriInvoke.mockResolvedValue({
      url: 'https://sf6-cm1-cdn.muscdn.com/obj/qs-audio/718924.m4a',
      quality: '128k',
      headers: { 'User-Agent': QS_UA },
      cek: '0123456789abcdef0123456789abcdef',
    });

    const first = await resolveLxUrlForSingleQuality(
      null as never,
      'qs',
      { songmid: '718924', name: 'test' },
      '128k',
    );
    const second = await resolveLxUrlForSingleQuality(
      null as never,
      'qs',
      { songmid: '718924', name: 'test' },
      '128k',
    );

    expect(mockTauriInvoke).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
    expect(second?.cek).toBe('0123456789abcdef0123456789abcdef');
  });

  it('缺失 songmid 返回 null 且不 invoke', async () => {
    const result = await resolveLxUrlForSingleQuality(
      null as never,
      'qs',
      { name: 'no-id' },
      '320k',
    );

    expect(result).toBeNull();
    expect(mockTauriInvoke).not.toHaveBeenCalled();
  });

  it('返回非 http 链接时视为失败返回 null', async () => {
    mockTauriInvoke.mockResolvedValueOnce({
      url: 'not-a-valid-url',
      quality: '320k',
    });

    const result = await resolveLxUrlForSingleQuality(
      null as never,
      'qs',
      { songmid: '718925', name: 'test' },
      '320k',
    );

    expect(result).toBeNull();
  });

  it('无 cek（未加密直链）时按普通直链返回', async () => {
    mockTauriInvoke.mockResolvedValueOnce({
      url: 'https://sf6-cm1-cdn.muscdn.com/obj/qs-audio/718926.m4a',
      quality: 'flac',
      headers: { 'User-Agent': QS_UA },
      cek: null,
    });

    const result = await resolveLxUrlForSingleQuality(
      null as never,
      'qs',
      { songmid: '718926', name: 'test' },
      'flac',
    );

    expect(result).toEqual({
      url: 'https://sf6-cm1-cdn.muscdn.com/obj/qs-audio/718926.m4a',
      quality: 'flac',
      headers: { 'User-Agent': QS_UA },
      cek: undefined,
    });
  });
});
