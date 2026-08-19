import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  downloadVideoToCacheMock,
  getStoredPluginsMock,
  pluginHttpRequestMock,
  pluginGetVideoSourceMock,
  removeCachedBackgroundVideoMock,
} = vi.hoisted(() => ({
  downloadVideoToCacheMock: vi.fn(),
  getStoredPluginsMock: vi.fn(),
  pluginHttpRequestMock: vi.fn(),
  pluginGetVideoSourceMock: vi.fn(),
  removeCachedBackgroundVideoMock: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: (path: string) => `asset://${path}`,
}));

vi.mock('../services/pluginEngine', () => ({
  getStoredPlugins: getStoredPluginsMock,
  pluginGetVideoSource: pluginGetVideoSourceMock,
}));

vi.mock('../services/tauri/pluginApi', () => ({
  pluginApi: {
    downloadVideoToCache: downloadVideoToCacheMock,
    pluginHttpRequest: pluginHttpRequestMock,
    removeCachedBackgroundVideo: removeCachedBackgroundVideoMock,
  },
}));

import type { Song } from '../types';
import { isBilibiliPluginSong, useBilibiliVideoBackground } from './useBilibiliVideoBackground';

const makeSong = (overrides: Partial<Song> = {}): Song => ({
  path: 'plugin://bilibili/BV1j3411D7pu',
  name: '测试视频',
  title: '测试视频',
  artist: 'UP 主',
  artist_names: ['UP 主'],
  effective_artist_names: ['UP 主'],
  album: 'Bilibili',
  album_artist: 'UP 主',
  album_key: 'bilibili::up',
  is_various_artists_album: false,
  collapse_artist_credits: false,
  duration: 180,
  source_type: 'plugin',
  plugin_id: 'bili-plugin',
  rawData: {
    id: 'BV1j3411D7pu',
    title: '测试视频',
    platform: 'bilibili',
    pluginId: 'bili-plugin',
    rawData: { bvid: 'BV1j3411D7pu', platform: 'bilibili' },
  },
  ...overrides,
});

describe('Bilibili player-detail video background', () => {
  const background = useBilibiliVideoBackground();

  beforeEach(async () => {
    await background.stop();
    vi.clearAllMocks();
    getStoredPluginsMock.mockReturnValue([{ id: 'bili-plugin', name: '哔哩哔哩' }]);
    pluginGetVideoSourceMock.mockResolvedValue({
      url: 'https://upos-sz-mirror.example.bilivideo.com/video.m4s',
      headers: { Range: 'bytes=0-' },
    });
    downloadVideoToCacheMock.mockResolvedValue('C:\\cache\\video-background\\xy_music_video_test.mp4');
    removeCachedBackgroundVideoMock.mockResolvedValue(undefined);
  });

  it('only exposes the feature for Bilibili plugin tracks', () => {
    expect(isBilibiliPluginSong(makeSong())).toBe(true);
    expect(isBilibiliPluginSong(makeSong({
      path: 'plugin://netease/123',
      plugin_id: 'netease-plugin',
      rawData: { platform: 'netease' },
    }))).toBe(false);
  });

  it('parses, caches and exposes a muted background-video asset', async () => {
    const song = makeSong();
    await expect(background.start(song)).resolves.toBe(true);

    expect(pluginGetVideoSourceMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'bili-plugin' }),
      expect.objectContaining({ id: 'BV1j3411D7pu' }),
      '720P',
    );
    expect(downloadVideoToCacheMock).toHaveBeenCalledWith(
      expect.stringContaining('bilivideo.com'),
      expect.objectContaining({
        Referer: 'https://www.bilibili.com/',
        Origin: 'https://www.bilibili.com',
      }),
    );
    expect(background.active.value).toBe(true);
    expect(background.videoUrl.value).toContain('xy_music_video_test.mp4');

    await background.stop();
    expect(background.active.value).toBe(false);
    expect(removeCachedBackgroundVideoMock).toHaveBeenCalledWith(
      expect.stringContaining('xy_music_video_test.mp4'),
    );
  });

  it('falls back to Bilibili parsing when the installed plugin has no video extension', async () => {
    pluginGetVideoSourceMock.mockResolvedValueOnce(null);
    pluginHttpRequestMock
      .mockResolvedValueOnce({
        status: 200,
        body: JSON.stringify({ code: 0, data: { cid: 12345 } }),
      })
      .mockResolvedValueOnce({
        status: 200,
        body: JSON.stringify({
          code: 0,
          data: {
            dash: {
              video: [{
                id: 80,
                baseUrl: 'https://upos-sz-mirror.example.bilivideo.com/fallback-1080p.m4s',
                codecs: 'avc1.640028',
              }, {
                id: 64,
                baseUrl: 'https://upos-sz-mirror.example.bilivideo.com/fallback-720p.m4s',
                backupUrl: ['https://upos-backup.example.bilivideo.com/fallback-720p.m4s'],
                codecs: 'avc1.64001F',
              }],
            },
          },
        }),
      });

    await expect(background.start(makeSong())).resolves.toBe(true);

    expect(pluginHttpRequestMock).toHaveBeenNthCalledWith(
      1,
      'GET',
      expect.stringContaining('/x/web-interface/view?bvid=BV1j3411D7pu'),
      expect.any(Object),
    );
    expect(pluginHttpRequestMock).toHaveBeenNthCalledWith(
      2,
      'GET',
      expect.stringContaining('/x/player/playurl?bvid=BV1j3411D7pu&cid=12345'),
      expect.any(Object),
    );
    expect(downloadVideoToCacheMock).toHaveBeenCalledWith(
      expect.stringContaining('fallback-720p.m4s'),
      expect.objectContaining({ Referer: 'https://www.bilibili.com/' }),
    );
  });

  it('clears the pending state when both plugin and compatibility parsing fail', async () => {
    pluginGetVideoSourceMock.mockResolvedValueOnce(null);
    pluginHttpRequestMock.mockResolvedValueOnce({
      status: 200,
      body: JSON.stringify({ code: -400, message: '请求错误' }),
    });

    await expect(background.start(makeSong())).rejects.toThrow('视频信息解析失败');
    expect(background.requested.value).toBe(false);
    expect(background.loading.value).toBe(false);
  });
});
