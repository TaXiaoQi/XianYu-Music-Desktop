import { lxGetAlbumSongs, lxSearch, txBatchTrackInterval, txSearchAlbumsRaw } from './lxMusicSdk';
import { httpPostJson, zzcSign } from './lxMusicSdkBase';
import { fallbackMethodDisabled } from '../fallbackModules/registry';
import { kFallbackModulePluginFallback } from '../fallbackModules/types';
import type { LxSearchResult, LxSearchResultItem } from './lxMusicSdk';
import { resetMediaItem, toPluginSearchResults } from './pluginResultMappers';
import type { PluginAlbumResult } from './pluginEngine';
import type { PluginSearchResult, PluginSource } from '../../types';

const QQ_PLATFORM_PATTERN = /qq/i;

export function isQqMusicPluginSource(source: PluginSource, platform?: string): boolean {
  const haystack = `${source?.name || ''}|${platform || ''}`;
  return QQ_PLATFORM_PATTERN.test(haystack);
}

const QQ_PLUGIN_QUALITY_KEYS = ['128k', '320k', 'flac', 'hires'] as const;

export function lxItemToQqMusicFreeItem(item: LxSearchResultItem): Record<string, any> {
  const qualities: Record<string, { size?: string }> = {};
  for (const key of QQ_PLUGIN_QUALITY_KEYS) {
    const type = item._types?.[key];
    if (type) qualities[key] = { size: type.size ?? undefined };
  }
  return {
    id: String(item.songId ?? item.songmid ?? ''),
    songmid: item.songmid,
    title: item.name,
    artist: item.singer,
    album: item.albumName,
    albumid: item.albumId,
    albummid: item.albumMid || item.albumId,
    artwork: item.img || undefined,
    interval: item.interval,
    qualities,
    _hostQqFallback: true,
  };
}

export async function qqHostSearchFallback(
  source: PluginSource,
  keyword: string,
  page: number,
  limit = 30,
): Promise<PluginSearchResult[]> {
  // 服务端配置可整体关闭该链路（配置化下发，无可执行代码）
  if (fallbackMethodDisabled(kFallbackModulePluginFallback, 'hostSearchFallback')) return [];
  return qqHostSearchFallbackBuiltin(source, keyword, page, limit);
}

async function qqHostSearchFallbackBuiltin(
  source: PluginSource,
  keyword: string,
  page: number,
  limit = 30,
): Promise<PluginSearchResult[]> {
  try {
    const result: LxSearchResult = await lxSearch('tx', keyword, page, limit);
    if (!result?.list?.length) return [];
    return await toPluginSearchResults(
      result.list.map(item => resetMediaItem(lxItemToQqMusicFreeItem(item), source.name)),
      source,
    );
  } catch {
    return [];
  }
}

export function qqRawAlbumToMusicFreeItem(album: Record<string, any>): Record<string, any> {
  const albumMid = album.albumMID || album.album_mid || '';
  return {
    id: album.albumID || album.albumid,
    albumMID: albumMid,
    title: album.albumName || album.album_name,
    artwork: album.albumPic || (albumMid ? `https://y.gtimg.cn/music/photo_new/T002R800x800M000${albumMid}.jpg` : undefined),
    date: album.publicTime || album.pub_time,
    singerID: album.singerID || album.singer_id,
    artist: album.singerName || album.singer_name,
    singerMID: album.singerMID || album.singer_mid,
    description: album.desc,
  };
}

export async function qqHostAlbumSearchFallback(
  source: PluginSource,
  keyword: string,
  page = 1,
  limit = 30,
): Promise<PluginAlbumResult[]> {
  if (fallbackMethodDisabled(kFallbackModulePluginFallback, 'hostAlbumSearchFallback')) return [];
  return qqHostAlbumSearchFallbackBuiltin(source, keyword, page, limit);
}

async function qqHostAlbumSearchFallbackBuiltin(
  source: PluginSource,
  keyword: string,
  page = 1,
  limit = 30,
): Promise<PluginAlbumResult[]> {
  try {
    const rawAlbums = await txSearchAlbumsRaw(keyword, page, limit);
    if (!rawAlbums.length) return [];
    return rawAlbums.map(album => {
      const item = qqRawAlbumToMusicFreeItem(album);
      resetMediaItem(item, source.name);
      return {
        id: String(item.id ?? ''),
        name: String(item.title ?? ''),
        artist: String(item.artist ?? ''),
        coverUrl: String(item.artwork ?? ''),
        description: item.description ? String(item.description) : '',
        year: item.date ? String(item.date) : undefined,
        platform: source.name,
        platformId: String(item.id ?? ''),
        pluginId: source.id,
        rawData: item,
      };
    });
  } catch {
    return [];
  }
}

export async function qqHostAlbumSongsFallback(
  source: PluginSource,
  albumMid: string,
  page = 1,
  limit = 30,
): Promise<PluginSearchResult[]> {
  if (fallbackMethodDisabled(kFallbackModulePluginFallback, 'hostAlbumSongsFallback')) return [];
  return qqHostAlbumSongsFallbackBuiltin(source, albumMid, page, limit);
}

async function qqHostAlbumSongsFallbackBuiltin(
  source: PluginSource,
  albumMid: string,
  page = 1,
  limit = 30,
): Promise<PluginSearchResult[]> {
  try {
    const list = await lxGetAlbumSongs('tx', { id: albumMid, name: '' }, page, limit);
    if (!list?.length) return [];
    return await toPluginSearchResults(
      list.map(item => resetMediaItem(lxItemToQqMusicFreeItem(item), source.name)),
      source,
    );
  } catch {
    return [];
  }
}

const QQ_TRIAL_URL_RE = /\/RS0\d[A-Za-z0-9]{8,}\.(mp3|m4a|flac)(?:[?#]|$)/i;
export function isQqTrialMediaUrl(url: string | undefined | null): boolean {
  return typeof url === 'string' && QQ_TRIAL_URL_RE.test(url);
}

// ==================== QQ 宿主取链兜底 ====================
// 部分 QQ 系插件的取链后端不可用时，宿主直接用 song_id 走签名 vkey 接口拿直链，
// 保证「能播」。签名接口只给免费档（128k mp3 / m4a）；320k/flac 需登录态，
// 上游返回 result=104003 时自动降到下一档。

const TX_HOST_REQUEST_HEADERS: Record<string, string> = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Content-Type': 'application/json',
  'Referer': 'https://y.qq.com/',
  'Origin': 'https://y.qq.com',
  'Cookie': 'uin=',
};

interface TxPlayFileCandidate {
  prefix: string;
  ext: string;
  quality: string;
}

function txPlayFileCandidates(quality?: string): TxPlayFileCandidate[] {
  const q = String(quality || '').toLowerCase();
  const lossless = q === 'master' || q === 'atmos_pro' || q === 'atmos_plus' || q === 'atmos' || q === 'dolby'
    || q === 'dts' || q === 'spatial' || q === 'vinyl' || q === 'hires' || q === 'flac24bit'
    || q === 'flac' || q === 'super' || q === 'lossless';
  if (lossless) {
    return [
      { prefix: 'F000', ext: '.flac', quality: 'flac' },
      { prefix: 'M800', ext: '.mp3', quality: '320k' },
      { prefix: 'M500', ext: '.mp3', quality: '128k' },
    ];
  }
  if (q === '320k' || q === '192k' || q === 'high') {
    return [
      { prefix: 'M800', ext: '.mp3', quality: '320k' },
      { prefix: 'M500', ext: '.mp3', quality: '128k' },
    ];
  }
  return [
    { prefix: 'M500', ext: '.mp3', quality: '128k' },
    { prefix: 'C400', ext: '.m4a', quality: '128k' },
  ];
}

async function txSignedPost(body: unknown): Promise<any> {
  const text = JSON.stringify(body);
  const sign = await zzcSign(text);
  return httpPostJson(`https://u.y.qq.com/cgi-bin/musics.fcg?sign=${sign}`, text, TX_HOST_REQUEST_HEADERS);
}

async function txFetchTrackFileInfo(songId: number): Promise<{ songmid: string; mediaMid: string } | null> {
  try {
    const res = await txSignedPost({
      comm: { ct: 24, cv: 0, uin: '0' },
      req: { module: 'music.pf_song_detail_svr', method: 'get_song_detail', param: { song_id: songId } },
    });
    const info = res?.req?.data?.track_info;
    if (!info?.mid) return null;
    return { songmid: String(info.mid), mediaMid: String(info?.file?.media_mid || info.mid) };
  } catch {
    return null;
  }
}

async function txRequestVkey(songmid: string, mediaMid: string, file: TxPlayFileCandidate): Promise<string | null> {
  try {
    const res = await txSignedPost({
      req_0: {
        module: 'vkey.GetVkeyServer',
        method: 'CgiGetVkey',
        param: {
          filename: [`${file.prefix}${mediaMid}${file.ext}`],
          guid: '10000',
          songmid: [songmid],
          songtype: [0],
          uin: '0',
          loginflag: 1,
          platform: '20',
        },
      },
      comm: { uin: '0', format: 'json', ct: 24, cv: 0 },
    });
    const data = res?.req_0?.data;
    const purl = String(data?.midurlinfo?.[0]?.purl || '');
    if (!purl) return null;
    const host = String(data?.sip?.[0] || 'https://aqqmusic.tc.qq.com/');
    return `${host.replace(/^http:\/\//i, 'https://')}${purl}`;
  } catch {
    return null;
  }
}

export interface QqHostMediaTarget {
  id?: string | number | null;
  songmid?: string | null;
  mediaMid?: string | null;
  quality?: string;
}

/**
 * 插件取链失败时的宿主兜底：song_id → mid/media_mid → 签名 vkey 直链。
 * 仅用于 QQ 系音源；无数字 song_id 时放弃，避免误判其他平台。
 */
export async function qqHostResolveMediaUrl(
  target: QqHostMediaTarget,
): Promise<{ url: string; quality: string } | null> {
  const numericId = Number(target.id);
  const hasSongId = Number.isFinite(numericId) && numericId > 0 && /^\d+$/.test(String(target.id ?? ''));
  let songmid = String(target.songmid || '').trim();
  let mediaMid = String(target.mediaMid || '').trim();
  if (hasSongId) {
    const info = await txFetchTrackFileInfo(numericId);
    if (info) {
      songmid = songmid || info.songmid;
      mediaMid = mediaMid || info.mediaMid;
    }
  }
  if (!songmid) return null;
  if (!mediaMid) mediaMid = songmid;
  for (const file of txPlayFileCandidates(target.quality)) {
    const url = await txRequestVkey(songmid, mediaMid, file);
    if (url) return { url, quality: file.quality };
  }
  return null;
}

export async function qqFillSongDurations(
  source: PluginSource,
  platform: string | undefined,
  results: PluginSearchResult[],
): Promise<PluginSearchResult[]> {
  if (fallbackMethodDisabled(kFallbackModulePluginFallback, 'fillSongDurations')) return results;
  return qqFillSongDurationsBuiltin(source, platform, results);
}

async function qqFillSongDurationsBuiltin(
  source: PluginSource,
  platform: string | undefined,
  results: PluginSearchResult[],
): Promise<PluginSearchResult[]> {
  if (!results.length || !(await isQqMusicPluginSource(source, platform))) return results;
  const missing = results.filter(r =>
    !r.duration
    && r.rawData
    && typeof r.rawData === 'object'
    && r.rawData.id !== undefined
    && r.rawData.id !== null
    && r.rawData.id !== '',
  );
  if (!missing.length) return results;
  try {
    const durationMap = await txBatchTrackInterval(missing.map(r => String(r.rawData.id)));
    if (!durationMap.size) return results;
    for (const result of missing) {
      const seconds = durationMap.get(String(result.rawData.id));
      if (seconds && seconds > 0) {
        result.duration = seconds * 1000;
        result.rawData.duration = seconds;
      }
    }
  } catch { /* 补时长失败不影响列表展示 */ }
  return results;
}
