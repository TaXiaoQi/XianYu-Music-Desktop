import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { LxSearchResult, LxSearchResultItem } from './lxMusicSdk';
import type { PluginSource } from '../../types';

vi.mock('./lxMusicSdk', () => ({
  lxSearch: vi.fn(),
  txSearchAlbumsRaw: vi.fn(),
  lxGetAlbumSongs: vi.fn(),
  txBatchTrackInterval: vi.fn(),
}));

import { lxSearch, lxGetAlbumSongs, txBatchTrackInterval, txSearchAlbumsRaw } from './lxMusicSdk';
import {
  isQqMusicPluginSource,
  isQqTrialMediaUrl,
  lxItemToQqMusicFreeItem,
  qqFillSongDurations,
  qqHostAlbumSearchFallback,
  qqHostAlbumSongsFallback,
  qqHostSearchFallback,
  qqRawAlbumToMusicFreeItem,
} from './qqHostSearchFallback';

const makeSource = (name: string): PluginSource => ({
  id: 'src-1',
  name,
  format: 'musicfree',
  enabled: true,
  filePath: 'http://example.com/tx.js',
} as unknown as PluginSource);

const makeLxItem = (overrides: Partial<LxSearchResultItem> = {}): LxSearchResultItem => ({
  name: '晴天',
  singer: '周杰伦',
  albumName: '叶惠美',
  albumId: '002Neh8l0RxIVZ',
  songmid: '0039MnYb0qxYhV',
  source: 'tx',
  interval: '04:17',
  img: 'https://y.gtimg.cn/music/photo_new/T002R500x500M000002Neh8l0RxIVZ.jpg',
  types: [
    { type: '128k', size: '4.1MB' },
    { type: '320k', size: '10.2MB' },
    { type: 'flac', size: '38.6MB' },
    { type: 'flac24bit', size: '61.5MB' },
    { type: 'hires', size: '76.8MB' },
    { type: 'atmos', size: '20.3MB' },
    { type: 'master', size: '84.9MB' },
  ],
  _types: {
    '128k': { size: '4.1MB' },
    '320k': { size: '10.2MB' },
    flac: { size: '38.6MB' },
    flac24bit: { size: '61.5MB' },
    hires: { size: '76.8MB' },
    atmos: { size: '20.3MB' },
    master: { size: '84.9MB' },
  },
  songId: 97773,
  albumMid: '002Neh8l0RxIVZ',
  strMediaMid: '0039MnYb0qxYhV',
  ...overrides,
});

describe('isQqMusicPluginSource', () => {
  it('matches QQ platform variants by name', () => {
    expect(isQqMusicPluginSource(makeSource('QQ音乐'))).toBe(true);
    expect(isQqMusicPluginSource(makeSource('QQ音乐(赞助版)[永久]'))).toBe(true);
    expect(isQqMusicPluginSource(makeSource('qq音乐'))).toBe(true);
    expect(isQqMusicPluginSource(makeSource('酷狗音乐'))).toBe(false);
    expect(isQqMusicPluginSource(makeSource('网易云'))).toBe(false);
  });

  it('falls back to the instance platform field', () => {
    expect(isQqMusicPluginSource(makeSource('自定义源'), 'QQ音乐')).toBe(true);
    expect(isQqMusicPluginSource(makeSource('自定义源'), '酷我音乐')).toBe(false);
  });
});

describe('lxItemToQqMusicFreeItem', () => {
  it('maps LX fields to the MusicFree item shape the QQ plugin consumes', () => {
    const item = lxItemToQqMusicFreeItem(makeLxItem());

    expect(item.id).toBe('97773');
    expect(item.songmid).toBe('0039MnYb0qxYhV');
    expect(item.title).toBe('晴天');
    expect(item.artist).toBe('周杰伦');
    expect(item.album).toBe('叶惠美');
    expect(item.albummid).toBe('002Neh8l0RxIVZ');
    expect(item.artwork).toContain('T002R500x500');
    expect(item.interval).toBe('04:17');
  });

  it('keeps only qualities the QQ plugin gates on (drops flac24bit/atmos/master)', () => {
    const item = lxItemToQqMusicFreeItem(makeLxItem());
    expect(Object.keys(item.qualities).sort()).toEqual(['128k', '320k', 'flac', 'hires']);
    expect(item.qualities['320k'].size).toBe('10.2MB');
  });

  it('produces empty qualities when LX provides none', () => {
    const item = lxItemToQqMusicFreeItem(makeLxItem({ types: [], _types: {} }));
    expect(item.qualities).toEqual({});
  });
});

describe('qqHostSearchFallback', () => {
  const mockedLxSearch = vi.mocked(lxSearch);

  beforeEach(() => {
    mockedLxSearch.mockReset();
  });

  it('maps lxSearch results back to PluginSearchResult with plugin identity', async () => {
    mockedLxSearch.mockResolvedValueOnce({
      list: [makeLxItem(), makeLxItem({ name: '七里香', songmid: '001J5QJL1pRjYy', songId: 97774 })],
      allPage: 5,
      limit: 30,
      total: 100,
      source: 'tx',
    } as LxSearchResult);

    const source = makeSource('QQ音乐(赞助版)[永久]');
    const results = await qqHostSearchFallback(source, '周杰伦', 1);

    expect(mockedLxSearch).toHaveBeenCalledWith('tx', '周杰伦', 1, 30);
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({
      id: '97773',
      title: '晴天',
      artist: '周杰伦',
      album: '叶惠美',
      platform: 'QQ音乐(赞助版)[永久]',
      pluginId: 'src-1',
      duration: 257000,
      coverUrl: expect.stringContaining('T002R500x500'),
    });
    expect(results[0].rawData.songmid).toBe('0039MnYb0qxYhV');
    expect(results[0].rawData.qualities['flac']).toBeDefined();
    expect(results[1].id).toBe('97774');
  });

  it('returns empty list when lxSearch yields nothing', async () => {
    mockedLxSearch.mockResolvedValueOnce({
      list: [],
      allPage: 0,
      limit: 30,
      total: 0,
      source: 'tx',
    } as LxSearchResult);

    const results = await qqHostSearchFallback(makeSource('QQ音乐'), '不存在的歌曲', 1);
    expect(results).toEqual([]);
  });

  it('swallows lxSearch failures and returns empty list', async () => {
    mockedLxSearch.mockRejectedValueOnce(new Error('TX web fallback: 无有效歌曲'));
    const results = await qqHostSearchFallback(makeSource('QQ音乐'), '周杰伦', 1);
    expect(results).toEqual([]);
  });
});

describe('isQqTrialMediaUrl', () => {
  it('识别 RS02/RS03 试听链（含查询参数）', () => {
    expect(isQqTrialMediaUrl('http://ws.stream.qqmusic.qq.com/RS02003Qui1q2u1Zho.mp3?guid=x&vkey=y')).toBe(true);
    expect(isQqTrialMediaUrl('https://isure.stream.qqmusic.qq.com/RS0300MAx3b3Y0N3q8.m4a?fromtag=8')).toBe(true);
  });

  it('完整版直链（M500/M800/F000/C400）不误判', () => {
    expect(isQqTrialMediaUrl('http://isure.stream.qqmusic.qq.com/M800003Qui1q2u1Zho.mp3?vkey=abc')).toBe(false);
    expect(isQqTrialMediaUrl('http://dl.stream.qqmusic.qq.com/F000003Qui1q2u1Zho.flac?vkey=abc')).toBe(false);
    expect(isQqTrialMediaUrl('http://ws.stream.qqmusic.qq.com/C400003Qui1q2u1Zho.m4a?vkey=abc')).toBe(false);
  });

  it('空值与非字符串安全返回 false', () => {
    expect(isQqTrialMediaUrl(undefined)).toBe(false);
    expect(isQqTrialMediaUrl(null)).toBe(false);
    expect(isQqTrialMediaUrl('')).toBe(false);
  });
});

describe('qqRawAlbumToMusicFreeItem', () => {
  it('maps raw QQ album fields including uppercase albumMID the plugin reads', () => {
    const item = qqRawAlbumToMusicFreeItem({
      albumID: 8220,
      albumMID: '000MkMni19ClKG',
      albumName: '叶惠美',
      albumPic: 'http://y.gtimg.cn/music/photo_new/T002R180x180M000000MkMni19ClKG_5.jpg',
      publicTime: '2003-07-31',
      singerID: 4558,
      singerName: '周杰伦',
      singerMID: '0025NhlN2yWrP4',
    });

    expect(item.albumMID).toBe('000MkMni19ClKG');
    expect(item.id).toBe(8220);
    expect(item.title).toBe('叶惠美');
    expect(item.artist).toBe('周杰伦');
    expect(item.date).toBe('2003-07-31');
    expect(item.artwork).toContain('000MkMni19ClKG');
  });

  it('builds artwork from albumMID when albumPic is missing', () => {
    const item = qqRawAlbumToMusicFreeItem({ albumMID: '000MkMni19ClKG', albumName: '叶惠美' });
    expect(item.artwork).toBe('https://y.gtimg.cn/music/photo_new/T002R800x800M000000MkMni19ClKG.jpg');
  });
});

describe('qqHostAlbumSearchFallback', () => {
  const mockedAlbumSearch = vi.mocked(txSearchAlbumsRaw);

  beforeEach(() => {
    mockedAlbumSearch.mockReset();
  });

  it('returns album results carrying plugin-native albumMID in rawData', async () => {
    mockedAlbumSearch.mockResolvedValueOnce([
      {
        albumID: 8220, albumMID: '000MkMni19ClKG', albumName: '叶惠美',
        singerName: '周杰伦', publicTime: '2003-07-31',
      },
    ]);

    const source = makeSource('QQ音乐(赞助版)[永久]');
    const results = await qqHostAlbumSearchFallback(source, '叶惠美', 1);

    expect(mockedAlbumSearch).toHaveBeenCalledWith('叶惠美', 1, 30);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      id: '8220',
      name: '叶惠美',
      artist: '周杰伦',
      year: '2003-07-31',
      platform: 'QQ音乐(赞助版)[永久]',
      pluginId: 'src-1',
    });
    expect(results[0].rawData.albumMID).toBe('000MkMni19ClKG');
  });

  it('returns empty list when the signed endpoint yields nothing or fails', async () => {
    mockedAlbumSearch.mockResolvedValueOnce([]);
    expect(await qqHostAlbumSearchFallback(makeSource('QQ音乐'), '不存在', 1)).toEqual([]);

    mockedAlbumSearch.mockRejectedValueOnce(new Error('risk controlled'));
    expect(await qqHostAlbumSearchFallback(makeSource('QQ音乐'), '叶惠美', 1)).toEqual([]);
  });
});

describe('qqHostAlbumSongsFallback', () => {
  const mockedAlbumSongs = vi.mocked(lxGetAlbumSongs);

  beforeEach(() => {
    mockedAlbumSongs.mockReset();
  });

  it('maps host album songs back to plugin song structure', async () => {
    mockedAlbumSongs.mockResolvedValueOnce([makeLxItem()]);

    const results = await qqHostAlbumSongsFallback(makeSource('QQ音乐'), '000MkMni19ClKG', 1);

    expect(mockedAlbumSongs).toHaveBeenCalledWith('tx', { id: '000MkMni19ClKG', name: '' }, 1, 30);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ title: '晴天', artist: '周杰伦' });
    expect(results[0].rawData.songmid).toBe('0039MnYb0qxYhV');
  });

  it('swallows failures and returns empty list', async () => {
    mockedAlbumSongs.mockRejectedValueOnce(new Error('sign invalid'));
    expect(await qqHostAlbumSongsFallback(makeSource('QQ音乐'), '000MkMni19ClKG', 1)).toEqual([]);
  });
});

describe('qqFillSongDurations', () => {
  const mockedBatchInterval = vi.mocked(txBatchTrackInterval);

  const makeResult = (id: any, duration = 0) => ({
    id: String(id),
    title: '晴天',
    artist: '周杰伦',
    album: '叶惠美',
    coverUrl: '',
    duration,
    platform: 'QQ音乐',
    platformId: String(id),
    pluginId: 'src-1',
    rawData: { id, songmid: '0039MnYb0qxYhV', title: '晴天' },
  }) as any;

  beforeEach(() => {
    mockedBatchInterval.mockReset();
  });

  it('fills missing durations in place (top-level ms + rawData seconds)', async () => {
    mockedBatchInterval.mockResolvedValueOnce(new Map([['97773', 269], ['97771', 342]]));

    const results = [makeResult(97773), makeResult(97771), makeResult(97775)];
    await qqFillSongDurations(makeSource('QQ音乐'), 'QQ音乐', results);

    expect(mockedBatchInterval).toHaveBeenCalledWith(['97773', '97771', '97775']);
    expect(results[0].duration).toBe(269000);
    expect(results[0].rawData.duration).toBe(269);
    expect(results[1].duration).toBe(342000);
    expect(results[2].duration).toBe(0);
  });

  it('skips request entirely for non-QQ plugins', async () => {
    const results = [makeResult(97773)];
    await qqFillSongDurations(makeSource('网易云'), '网易云', results);
    expect(mockedBatchInterval).not.toHaveBeenCalled();
    expect(results[0].duration).toBe(0);
  });

  it('skips request when all results already have durations', async () => {
    const results = [makeResult(97773, 269000)];
    await qqFillSongDurations(makeSource('QQ音乐'), 'QQ音乐', results);
    expect(mockedBatchInterval).not.toHaveBeenCalled();
  });

  it('leaves results untouched when the batch query fails', async () => {
    mockedBatchInterval.mockRejectedValueOnce(new Error('risk controlled'));
    const results = [makeResult(97773)];
    await expect(qqFillSongDurations(makeSource('QQ音乐'), 'QQ音乐', results)).resolves.toBe(results);
    expect(results[0].duration).toBe(0);
  });
});
