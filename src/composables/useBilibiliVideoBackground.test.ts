import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  downloadVideoToCacheMock,
  getStoredPluginsMock,
  pluginHttpRequestMock,
  pluginGetVideoSourceMock,
  removeCachedBackgroundVideoMock,
  analyzeMvAudioSyncMock,
} = vi.hoisted(() => ({
  downloadVideoToCacheMock: vi.fn(),
  getStoredPluginsMock: vi.fn(),
  pluginHttpRequestMock: vi.fn(),
  pluginGetVideoSourceMock: vi.fn(),
  removeCachedBackgroundVideoMock: vi.fn(),
  analyzeMvAudioSyncMock: vi.fn(),
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

vi.mock('../services/mvAutoSync', () => ({
  analyzeMvAudioSync: analyzeMvAudioSyncMock,
}));

const playbackUrlMock = vi.hoisted(() => ({ value: null as string | null }));
vi.mock('../features/playback/store', () => ({
  usePlaybackStore: () => ({ currentPlayingAudioUrl: playbackUrlMock.value }),
}));

import type { Song } from '../types';
import { isBilibiliPluginSong, supportsMusicVideo, useBilibiliVideoBackground } from './useBilibiliVideoBackground';

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

const makeKugouSong = (overrides: Partial<Song> = {}): Song => ({
  path: 'plugin://kg-plugin/abc123',
  name: '晴天',
  title: '晴天',
  artist: '周杰伦',
  artist_names: ['周杰伦'],
  effective_artist_names: ['周杰伦'],
  album: '叶惠美',
  album_artist: '周杰伦',
  album_key: 'kugou::jay',
  is_various_artists_album: false,
  collapse_artist_credits: false,
  duration: 269,
  source_type: 'plugin',
  plugin_id: 'kg-plugin',
  rawData: {
    id: 'abc123',
    title: '晴天',
    platform: '酷狗音乐',
    pluginId: 'kg-plugin',
    mvHash: '92b86da2e11c3c84de3a944ed12d97f1',
    rawData: { id: 'abc123', platform: '酷狗音乐', mvHash: '92b86da2e11c3c84de3a944ed12d97f1' },
  },
  ...overrides,
});

describe('Bilibili player-detail video background', () => {
  const background = useBilibiliVideoBackground();

  beforeEach(async () => {
    await background.stop();
    vi.clearAllMocks();
    playbackUrlMock.value = null;
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

  it('非 B 站 MV 加载后自动分析音画偏移并应用', async () => {
    getStoredPluginsMock.mockReturnValue([{ id: 'kg-plugin', name: '酷狗音乐' }]);
    playbackUrlMock.value = 'https://isure.stream.qqmusic.qq.com/M800.mp3?vkey=abc';
    analyzeMvAudioSyncMock.mockResolvedValue({ offsetSec: 2.5, confidence: 0.81 });
    const song = makeKugouSong({ path: 'plugin://kg-plugin/mv-sync-a' });

    await expect(background.start(song)).resolves.toBe(true);

    expect(analyzeMvAudioSyncMock).toHaveBeenCalledWith(
      expect.stringContaining('asset://'),
      playbackUrlMock.value,
      undefined,
    );
    await vi.waitFor(() => expect(background.syncOffsetSec.value).toBe(2.5));

    await background.stop();
    expect(background.syncOffsetSec.value).toBe(0);
  });

  it('B 站歌曲跳过自动对齐（音画同源）', async () => {
    playbackUrlMock.value = 'https://upos-sz-mirror.example.bilivideo.com/audio.m4s';
    analyzeMvAudioSyncMock.mockResolvedValue({ offsetSec: 3, confidence: 0.9 });

    await expect(background.start(makeSong())).resolves.toBe(true);

    expect(analyzeMvAudioSyncMock).not.toHaveBeenCalled();
    expect(background.syncOffsetSec.value).toBe(0);
    await background.stop();
  });

  it('分析不可信时保持 0 偏移并缓存结果，切画质不重复分析', async () => {
    getStoredPluginsMock.mockReturnValue([{ id: 'kg-plugin', name: '酷狗音乐' }]);
    playbackUrlMock.value = 'https://track.example.com/song.flac';
    analyzeMvAudioSyncMock.mockResolvedValue(null);
    const song = makeKugouSong({ path: 'plugin://kg-plugin/mv-sync-b' });

    await expect(background.start(song)).resolves.toBe(true);
    await vi.waitFor(() => expect(analyzeMvAudioSyncMock).toHaveBeenCalledTimes(1));
    expect(background.syncOffsetSec.value).toBe(0);

    // 切换画质重新加载同曲视频：命中会话缓存，不再触发分析
    pluginGetVideoSourceMock.mockResolvedValue({ url: 'https://mv.example.com/1080p.mp4' });
    downloadVideoToCacheMock.mockResolvedValue('C:\\cache\\video-background\\xy_music_video_1080p.mp4');
    await expect(background.setQuality('1080P')).resolves.toBe(true);
    await vi.waitFor(() => expect(background.videoUrl.value).toContain('1080p'));
    expect(analyzeMvAudioSyncMock).toHaveBeenCalledTimes(1);

    await background.stop();
  });

  it('无播放直链时不触发分析', async () => {
    getStoredPluginsMock.mockReturnValue([{ id: 'kg-plugin', name: '酷狗音乐' }]);
    playbackUrlMock.value = null;
    const song = makeKugouSong({ path: 'plugin://kg-plugin/mv-sync-c' });

    await expect(background.start(song)).resolves.toBe(true);

    expect(analyzeMvAudioSyncMock).not.toHaveBeenCalled();
    await background.stop();
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

  it('supports songs without plugin_id by falling back to rawData.pluginId', async () => {
    const song = makeSong({
      plugin_id: undefined,
      rawData: {
        id: 'BV1j3411D7pu',
        platform: 'bilibili',
        pluginId: 'bili-plugin',
        rawData: { bvid: 'BV1j3411D7pu', platform: 'bilibili' },
      },
    });

    await expect(background.start(song)).resolves.toBe(true);
    expect(background.active.value).toBe(true);

    await background.stop();
  });

  it('treats Kugou plugin songs (with or without mvHash) as MV-capable', () => {
    getStoredPluginsMock.mockReturnValue([{ id: 'kg-plugin', name: '酷狗音乐' }]);
    expect(supportsMusicVideo(makeKugouSong())).toBe(true);
    expect(supportsMusicVideo(makeKugouSong({
      rawData: { id: 'abc123', platform: '酷狗音乐', pluginId: 'kg-plugin' },
    }))).toBe(true);
  });

  it('resolves Kugou MV via the host fallback when the plugin route yields nothing', async () => {
    getStoredPluginsMock.mockReturnValue([{ id: 'kg-plugin', name: '酷狗音乐' }]);
    pluginGetVideoSourceMock.mockResolvedValueOnce(null);
    pluginHttpRequestMock.mockResolvedValueOnce({
      status: 200,
      body: JSON.stringify({
        status: 1,
        timelength: 317400,
        mvdata: {
          le: { downurl: 'http://fsmvpc.kugou.com/le-480p.mp4', filesize: 21336568, bitrate: 537783, timelength: 317400 },
          sq: { downurl: 'http://fsmvpc.kugou.com/sq-1080p.mp4', filesize: 84999924, bitrate: 2142405, timelength: 317400 },
          rq: { downurl: 'http://fsmvpc.kugou.com/rq-4k.mp4', filesize: 163993391, bitrate: 4133418, timelength: 317400 },
        },
      }),
    });

    await expect(background.start(makeKugouSong())).resolves.toBe(true);

    expect(pluginHttpRequestMock).toHaveBeenCalledWith(
      'GET',
      'https://m.kugou.com/app/i/mv.php?cmd=100&ext=mp4&hash=92b86da2e11c3c84de3a944ed12d97f1',
      expect.objectContaining({ Referer: 'https://www.kugou.com/' }),
      undefined,
      20000,
    );
    // 默认档 720P：无 720P 码流时取不超标的最高档（480P）
    expect(downloadVideoToCacheMock).toHaveBeenCalledWith(
      'http://fsmvpc.kugou.com/le-480p.mp4',
      expect.objectContaining({ Referer: 'https://www.kugou.com/' }),
    );
    expect(background.availableQualities.value.map(q => q.key)).toEqual(['480P', '1080P', '4K']);
    expect(background.activeQuality.value).toBe('480P');
    expect(background.active.value).toBe(true);

    await background.stop();
  });

  it('falls back to an exact Kugou quality match when requested', async () => {
    getStoredPluginsMock.mockReturnValue([{ id: 'kg-plugin', name: '酷狗音乐' }]);
    pluginGetVideoSourceMock.mockResolvedValueOnce(null);
    pluginHttpRequestMock.mockResolvedValueOnce({
      status: 200,
      body: JSON.stringify({
        status: 1,
        mvdata: {
          sd: { downurl: 'http://fsmvpc.kugou.com/sd-720p.mp4', filesize: 41000000 },
          hd: { downurl: 'http://fsmvpc.kugou.com/hd-1080p.mp4', filesize: 82000000 },
        },
      }),
    });

    await expect(background.start(makeKugouSong(), '1080P')).resolves.toBe(true);
    expect(downloadVideoToCacheMock).toHaveBeenCalledWith(
      'http://fsmvpc.kugou.com/hd-1080p.mp4',
      expect.any(Object),
    );
    expect(background.activeQuality.value).toBe('1080P');

    await background.stop();
  });

  it('rejects with a cleared state when both plugin and Kugou host fallback fail', async () => {
    getStoredPluginsMock.mockReturnValue([{ id: 'kg-plugin', name: '酷狗音乐' }]);
    pluginGetVideoSourceMock.mockResolvedValueOnce(null);
    pluginHttpRequestMock.mockResolvedValueOnce({
      status: 200,
      body: JSON.stringify({ status: 0 }),
    });

    await expect(background.start(makeKugouSong())).rejects.toThrow('未能解析当前歌曲的 MV');
    expect(background.requested.value).toBe(false);
    expect(background.loading.value).toBe(false);
  });

  it('skips the Kugou host request when the song carries no usable mvHash', async () => {
    getStoredPluginsMock.mockReturnValue([{ id: 'kg-plugin', name: '酷狗音乐' }]);
    pluginGetVideoSourceMock.mockResolvedValueOnce(null);
    const song = makeKugouSong({
      rawData: {
        id: 'abc123',
        platform: '酷狗音乐',
        pluginId: 'kg-plugin',
        mvHash: 'not-a-valid-hash',
      },
    });

    await expect(background.start(song)).rejects.toThrow('未能解析当前歌曲的 MV');
    expect(pluginHttpRequestMock).not.toHaveBeenCalled();
  });
});
