/**
 * QQ 音乐 MusicFree/Baka 插件搜索的宿主兜底。
 *
 * 这类插件的搜索普遍依赖无签名的 u.y.qq.com/musicu.fcg（DoSearchForQQMusicDesktop），
 * 该端点已被腾讯按请求来源累积风控（reqCode 2001，所有列表恒为空），插件侧表现为
 * "搜索容易空结果"，且宿主的短间隔重试对累积风控无效。
 *
 * 兜底复用 LX 侧已验证的搜索链（lxMusicSdk.searchTx：签名 Mobile 接口 →
 * 2001 感知退避 → 经典 Web 接口 client_search_cp），把结果映射回
 * MusicFree 歌曲结构（含 songmid/id/qualities），播放仍走插件自身的
 * getMediaSource 中转，不受影响。
 */
import { lxGetAlbumSongs, lxSearch, txBatchTrackInterval, txSearchAlbumsRaw } from './lxMusicSdk';
import type { LxSearchResult, LxSearchResultItem } from './lxMusicSdk';
import { resetMediaItem, toPluginSearchResult } from './pluginResultMappers';
import type { PluginAlbumResult } from './pluginEngine';
import type { PluginSearchResult, PluginSource } from '../types';

const QQ_PLATFORM_PATTERN = /qq/i;

/** 判断插件是否为 QQ 音乐平台（platform 字段或插件名含 "qq"，兼容 "QQ音乐(赞助版)" 等变体） */
export function isQqMusicPluginSource(source: PluginSource, platform?: string): boolean {
  const haystack = `${source?.name || ''}|${platform || ''}`;
  return QQ_PLATFORM_PATTERN.test(haystack);
}

/** QQ 音乐 MF 插件 getMediaSource 做音质门禁时识别的键（128k/320k/flac/hires） */
const QQ_PLUGIN_QUALITY_KEYS = ['128k', '320k', 'flac', 'hires'] as const;

/**
 * 把 LX 搜索结果条目映射为 QQ 音乐 MF 插件可消费的歌曲对象。
 * 插件 getMediaSource 取 musicItem.songmid || musicItem.id 作为 songId，
 * 门禁读取 qualities[key]；列表展示读取 title/artist/album/artwork/interval。
 */
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

/**
 * 宿主代取 QQ 搜索。任何异常都吞掉返回空数组——兜底失败不应掩盖
 * 插件自身的空结果语义，由调用方决定后续。
 */
export async function qqHostSearchFallback(
  source: PluginSource,
  keyword: string,
  page: number,
  limit = 30,
): Promise<PluginSearchResult[]> {
  try {
    const result: LxSearchResult = await lxSearch('tx', keyword, page, limit);
    if (!result?.list?.length) return [];
    return result.list.map(item => {
      const musicFreeItem = resetMediaItem(lxItemToQqMusicFreeItem(item), source.name);
      return toPluginSearchResult(musicFreeItem, source);
    });
  } catch {
    return [];
  }
}

/**
 * 把腾讯原始专辑条目映射为 QQ 音乐 MF 插件可消费的专辑对象。
 * 插件 getAlbumInfo 读 albumItem.albumMID（大写），字段名必须精确一致。
 */
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

/**
 * 宿主代取 QQ 专辑搜索（签名 Desktop 接口 search_type=2）。
 * 插件自身的专辑搜索走无签名 musicu.fcg，已被间歇风控（2001）；
 * 兜底结果携带插件原生的 albumMID，后续 getAlbumInfo 可正常解析曲目。
 * 异常吞掉返回空数组。
 */
export async function qqHostAlbumSearchFallback(
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

/**
 * 宿主代取 QQ 专辑曲目（签名 AlbumSongList 接口，按 albumMid）。
 * 结果经 lxItemToQqMusicFreeItem 映射回插件歌曲结构（songmid/qualities），
 * 播放仍走插件 getMediaSource。异常吞掉返回空数组。
 */
export async function qqHostAlbumSongsFallback(
  source: PluginSource,
  albumMid: string,
  page = 1,
  limit = 30,
): Promise<PluginSearchResult[]> {
  try {
    const list = await lxGetAlbumSongs('tx', { id: albumMid, name: '' }, page, limit);
    if (!list?.length) return [];
    return list.map(item => {
      const musicFreeItem = resetMediaItem(lxItemToQqMusicFreeItem(item), source.name);
      return toPluginSearchResult(musicFreeItem, source);
    });
  } catch {
    return [];
  }
}

/**
 * 判定是否为 QQ 60 秒试听直链。
 * 腾讯试听文件名以 RS02/RS03 等前缀命名（如 RS02003Qui1q2u1Zho.mp3），
 * 完整版是 M500/M800/F000/C400。走免费公共中转（vkeys.cn 等）的 QQ 插件
 * 游客模式只会拿到这种试听链，且各音质档返回同一文件。
 */
const QQ_TRIAL_URL_RE = /\/RS0\d[A-Za-z0-9]{8,}\.(mp3|m4a|flac)(?:[?#]|$)/i;
export function isQqTrialMediaUrl(url: string | undefined | null): boolean {
  return typeof url === 'string' && QQ_TRIAL_URL_RE.test(url);
}

/**
 * 为 QQ 插件歌曲结果批量补齐时长（原地修改并返回）。
 * QQ formatMusicItem 丢弃 interval、getMusicInfo 早退分支不回填，歌单/歌手/专辑
 * 详情列表会整页无时长。这里按 rawData.id（songid）批量查 UniformRuleCtrl，
 * 顶层 duration 补 ms、rawData.duration 补秒（保证后续重映射不丢）。
 * 非 QQ 插件、或全部条目已有时长时直接原样返回，不发请求。
 */
export async function qqFillSongDurations(
  source: PluginSource,
  platform: string | undefined,
  results: PluginSearchResult[],
): Promise<PluginSearchResult[]> {
  if (!results.length || !isQqMusicPluginSource(source, platform)) return results;
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
