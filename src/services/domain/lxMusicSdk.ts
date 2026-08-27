import {
  firstValue,
  formatPlayTime,
  httpFetch,
  httpGetJson,
  httpGetLooseJson,
  httpPostJson,
  toUrlSongInfo,
  zzcSign,
  type LxSearchResult,
  type LxSearchResultItem,
} from './lxMusicSdkBase';
import {
  kgFilterData,
  mgCreateSignature,
  searchKg,
  searchKw,
  searchMg,
  searchTx,
  searchWy,
  txBatchTrackIntervalBuiltin,
  txHandleResult,
  txSearchAlbumsRawBuiltin,
  txSheetSearchDesktopFallback,
} from './lxSearchPlatform';
import { normalizeKuwoCoverUrl } from '../../utils/coverUrl';
import { decodeName, formatSingerName } from '../../utils/musicFormat';
import { pluginApi } from '../tauri/pluginApi';
import { dispatchFallbackModule } from '../fallbackModules/registry';

/**
 * LX 协议 SDK 门面：类型/工具/平台搜索实现在 lxMusicSdkBase 与 lxSearchPlatform，
 * 本模块负责跨模块编排、catlog/专辑/歌单/封面等组合逻辑，并为可兑底能力
 * （search/album/duration）统一包装 dispatchFallbackModule。
 */

// ==================== Re-export from base (backward-compatible entry) ====================
export { toUrlSongInfo } from './lxMusicSdkBase';
export type { LxSearchResult, LxSearchResultItem } from './lxMusicSdkBase';

// ==================== TX (QQ音乐) Album / Duration dispatch wrappers ====================

export async function txSearchAlbumsRaw(
  keyword: string,
  page = 1,
  limit = 30,
): Promise<Array<Record<string, any>>> {
  return dispatchFallbackModule('lx_album', 'searchAlbums', { keyword, page, limit },
    () => txSearchAlbumsRawBuiltin(keyword, page, limit));
}

/**
 * 批量查询 QQ 歌曲时长（UniformRuleCtrl / CgiGetTrackInfo，按 songid）。
 * QQ 系 MusicFree 插件的 formatMusicItem 不输出时长（interval 被丢弃），
 * getMusicInfo 对已带 artwork+qualities 的条目又走早退分支，宿主只能自行批量补。
 * 该端点与插件 getBatchQualities 同源，实测未受搜索类风控影响。
 * 返回 Map<songId, 时长秒>；单批失败跳过，不抛异常。
 */
export async function txBatchTrackInterval(
  songIds: Array<string | number>,
): Promise<Map<string, number>> {
  const result = await dispatchFallbackModule('lx_duration', 'batchTrackInterval', { songIds },
    () => txBatchTrackIntervalBuiltin(songIds));
  // 下发模块返回普通对象（JSON 边界），转换为 Map 保持原契约
  if (result instanceof Map) return result;
  if (result && typeof result === 'object') {
    return new Map(Object.entries(result as Record<string, number>));
  }
  return new Map();
}

// ==================== Catalog Search DTOs ====================

export interface LxArtistSearchResult {
  id: string;
  name: string;
  avatarUrl: string;
  songCount?: number;
  rawData: unknown;
}

export interface LxAlbumSearchResult {
  id: string;
  name: string;
  artist: string;
  coverUrl: string;
  songCount?: number;
  rawData: unknown;
}

export interface LxPlaylistSearchResult {
  id: string;
  title: string;
  coverUrl: string;
  artist?: string;
  trackCount?: number;
  playCount?: number;
  rawData: unknown;
}

function splitLxArtists(value: string): string[] {
  return value
    .split(/[、,/&]/)
    .map(name => name.trim())
    .filter(Boolean);
}

export function deriveLxArtistResults(list: LxSearchResultItem[]): LxArtistSearchResult[] {
  const artists = new Map<string, LxArtistSearchResult>();

  for (const song of list) {
    for (const name of splitLxArtists(song.singer)) {
      const key = name.toLocaleLowerCase();
      // 优先使用歌手头像（singerAvatars），其次回退到歌曲封面（song.img）
      const singerAvatar = song.singerAvatars?.[name];
      const avatarUrl = singerAvatar || song.img || '';
      const existing = artists.get(key);
      if (existing) {
        existing.songCount = (existing.songCount ?? 0) + 1;
        if (!existing.avatarUrl && avatarUrl) existing.avatarUrl = avatarUrl;
        continue;
      }
      artists.set(key, {
        id: `${song.source}:artist:${name}`,
        name,
        avatarUrl,
        songCount: 1,
        // 保存 source/songmid/artistId 供 lxCatalogSearch 异步补充头像
        // （kw 源无图片字段用 songmid；wy 源 img1v1Url 是占位头像，用 artistId 调艺人接口）
        rawData: {
          source: song.source,
          name,
          songmid: song.songmid,
          artistId: song.singerIds?.[name] ?? '',
        },
      });
    }
  }

  return [...artists.values()];
}

export function deriveLxAlbumResults(list: LxSearchResultItem[]): LxAlbumSearchResult[] {
  const albums = new Map<string, LxAlbumSearchResult>();

  for (const song of list) {
    const name = song.albumName?.trim();
    if (!name) continue;
    const id = String(song.albumId || song.albumMid || name);
    const key = `${song.source}:${id}`;
    const existing = albums.get(key);
    if (existing) {
      existing.songCount = (existing.songCount ?? 0) + 1;
      if (!existing.coverUrl && song.img) existing.coverUrl = song.img;
      continue;
    }
    albums.set(key, {
      id: `${song.source}:album:${id}`,
      name,
      artist: song.singer,
      coverUrl: song.img || '',
      songCount: 1,
      rawData: { source: song.source, id, name, artist: song.singer, songmid: song.songmid },
    });
  }

  return [...albums.values()];
}

export function normalizeLxPlaylistResults(source: LxSourceId, rawItems: any[]): LxPlaylistSearchResult[] {
  const results: LxPlaylistSearchResult[] = [];
  const seen = new Set<string>();

  for (const raw of rawItems.flat(2)) {
    if (!raw || typeof raw !== 'object') continue;
    const idValue = firstValue(raw, ['id', 'ID', 'playlistId', 'playlistid', 'specialid', 'dissid', 'disstid', 'songListId', 'songlistId', 'musicListId', 'rid']);
    const titleValue = firstValue(raw, ['title', 'name', 'playlistName', 'specialname', 'dissname', 'songListName', 'songlistName', 'NAME']);
    if (idValue === undefined || !titleValue) continue;
    const id = String(idValue);
    const dedupeKey = `${source}:${id}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const creator = raw.creator;
    let coverUrl = String(firstValue(raw, ['coverUrl', 'coverImgUrl', 'img', 'imgurl', 'pic', 'picUrl', 'pic_url', 'PIC', 'album_pic_url', 'hts_pic']) || '');
    if (coverUrl.startsWith('//')) coverUrl = `https:${coverUrl}`;
    else if (coverUrl.startsWith('http://')) coverUrl = coverUrl.replace('http://', 'https://');
    results.push({
      id: `${source}:playlist:${id}`,
      title: decodeName(String(titleValue).replace(/<[^>]*>/g, '')),
      coverUrl,
      artist: String(firstValue(raw, ['artist', 'author', 'nickname', 'uname', 'UNAME']) || creator?.name || creator?.nickname || ''),
      trackCount: Number(firstValue(raw, ['trackCount', 'trackcount', 'songCount', 'song_count', 'songnum', 'SONGNUM'])) || undefined,
      playCount: Number(firstValue(raw, ['playCount', 'playcount', 'play_count', 'playcnt', 'listennum', 'LISTENNUM'])) || undefined,
      rawData: raw,
    });
  }

  return results;
}

async function searchLxPlaylists(source: LxSourceId, keyword: string, page: number, limit: number): Promise<LxPlaylistSearchResult[]> {
  if (source === 'kw') {
    // 优先用新 API，回退到旧 API
    try {
      const data = await httpGetJson(`https://www.kuwo.cn/api/www/search/searchPlayListBykeyWord?key=${encodeURIComponent(keyword)}&pn=${page}&rn=${limit}`, {
        csrf: 'ABCDEF',
        Cookie: 'kw_token=ABCDEF',
        Referer: 'https://www.kuwo.cn/',
      });
      const list = data?.data?.list || data?.data || [];
      if (Array.isArray(list) && list.length > 0) {
        return normalizeLxPlaylistResults(source, list);
      }
    } catch { /* 回退到旧 API */ }
    // 旧 r.s 接口返回单引号 JSON（httpGetLooseJson 兼容），字段为
    // playlistid/name/nickname/hts_pic|pic/songnum/playcnt
    const data = await httpGetLooseJson(`https://search.kuwo.cn/r.s?client=kt&all=${encodeURIComponent(keyword)}&pn=${page - 1}&rn=${limit}&ft=playlist&encoding=utf8&rformat=json`, {
      Referer: 'https://www.kuwo.cn/',
    });
    return normalizeLxPlaylistResults(source, data?.abslist || data?.data || []);
  }

  if (source === 'kg') {
    const data = await httpGetJson(`https://songsearch.kugou.com/special_search?keyword=${encodeURIComponent(keyword)}&page=${page}&pagesize=${limit}&userid=-1&clientver=&platform=WebFilter&filter=0&iscorrection=1&privilege_filter=0`);
    return normalizeLxPlaylistResults(source, data?.data?.lists || data?.data?.list || []);
  }

  if (source === 'wy') {
    const offset = limit * (page - 1);
    const data = await httpGetJson(`https://music.163.com/api/search/get/web?s=${encodeURIComponent(keyword)}&type=1000&offset=${offset}&limit=${limit}`, {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      Referer: 'https://music.163.com',
      Cookie: 'MUSIC_A=1',
    });
    return normalizeLxPlaylistResults(source, data?.result?.playlists || []);
  }

  if (source === 'tx') {
    const requestData = {
      comm: { ct: '24', cv: '4747474', v: '4747474', tmeAppID: 'qqmusic', format: 'json', inCharset: 'utf-8', outCharset: 'utf-8', platform: 'yqq.json', needNewCode: 0, uin: '0', guid: '0' },
      req: {
        module: 'music.search.SearchCgiService',
        method: 'DoSearchForQQMusicMobile',
        param: {
          search_type: 3,
          searchid: Math.random().toString().slice(2),
          query: keyword,
          page_num: page,
          num_per_page: limit,
          highlight: 0,
          nqc_flag: 0,
          multi_zhida: 0,
          cat: 2,
          grp: 1,
          sin: 0,
          sem: 0,
        },
      },
    };
    // 该接口与 searchTx 同属新签名(Mobile)风控体系，被风控/降级时 body 为空，
    // 走无签名 Desktop 通道兜底（txSheetSearchDesktopFallback，实测稳定可用）
    let list: any[];
    try {
      const sign = await zzcSign(JSON.stringify(requestData));
      const data = await httpPostJson(
        `https://u.y.qq.com/cgi-bin/musics.fcg?sign=${sign}`,
        JSON.stringify(requestData),
        { 'User-Agent': 'Mozilla/5.0 (Linux; Android 12; EBG-AN10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/107.0.5304.141 Mobile Safari/537.36', 'Content-Type': 'application/json', 'Referer': 'https://y.qq.com/' },
      );
      const body = data?.req?.data?.body;
      list = body?.item_songlist || body?.songlist?.list || [];
    } catch (e: any) {
      console.warn(`[LxMusicSdk] TX 歌单搜索接口异常，尝试 Desktop 兜底: ${e?.message || e}`);
      list = [];
    }
    if (!Array.isArray(list) || list.length === 0) {
      console.warn('[LxMusicSdk] TX 歌单搜索 Mobile 为空，尝试 Desktop 兜底');
      list = await txSheetSearchDesktopFallback(keyword, page, limit);
    }
    return normalizeLxPlaylistResults(source, list);
  }

  const time = Date.now().toString();
  const signData = await mgCreateSignature(time, keyword);
  const searchSwitch = encodeURIComponent(JSON.stringify({
    song: 0,
    album: 0,
    singer: 0,
    tagSong: 0,
    mvSong: 0,
    bestShow: 0,
    songlist: 1,
    lyricSong: 0,
  }));
  const data = await httpGetJson(`https://jadeite.migu.cn/music_search/v3/search/searchAll?isCorrect=0&isCopyright=1&searchSwitch=${searchSwitch}&pageSize=${limit}&text=${encodeURIComponent(keyword)}&pageNo=${page}&sort=0&sid=USS`, {
    uiVersion: 'A_music_3.6.1',
    deviceId: signData.deviceId,
    timestamp: time,
    sign: signData.sign,
    channel: '0146921',
    'User-Agent': 'Mozilla/5.0 (Linux; Android 11)',
  });
  const resultData = data?.songListResultData || data?.songlistResultData || {};
  return normalizeLxPlaylistResults(source, resultData.resultList || resultData.list || []);
}

export async function lxCatalogSearch(
  source: LxSourceId,
  keyword: string,
  type: 'artist' | 'album' | 'playlist',
  page = 1,
  limit = 30,
): Promise<LxArtistSearchResult[] | LxAlbumSearchResult[] | LxPlaylistSearchResult[]> {
  if (type === 'playlist') return searchLxPlaylists(source, keyword, page, limit);
  const result = await lxSearch(source, keyword, page, limit);
  if (type !== 'artist') {
    const albums = deriveLxAlbumResults(result.list);
    // kw/wy 源搜索结果无可靠封面对应字段（kw 无图片字段、wy 只有超大整数 picId），异步补专辑封面
    if (source === 'kw') {
      await fillKwAlbumCovers(albums as LxAlbumSearchResult[]);
    } else if (source === 'wy') {
      await fillWyAlbumCovers(albums as LxAlbumSearchResult[]);
    }
    return albums;
  }
  const artists = deriveLxArtistResults(result.list);
  // kw 源搜索结果无图片字段，用 songmid 调 artistpicserver 异步获取封面作为歌手头像；
  // wy 源搜索接口的 img1v1Url 是全局占位头像，需用 artistId 调艺人接口补真实头像
  if (source === 'kw') {
    await fillKwArtistAvatars(artists);
  } else if (source === 'wy') {
    await fillWyArtistAvatars(artists);
  }
  return artists;
}

/**
 * 酷我搜索结果无任何图片字段，用 songmid 调 artistpicserver 获取歌曲封面作为歌手头像。
 * 并行请求所有缺失头像的歌手，最多等待 3 秒避免阻塞搜索过久。
 */
async function fillKwArtistAvatars(artists: LxArtistSearchResult[]): Promise<void> {
  const tasks = artists
    .filter(a => !a.avatarUrl && (a.rawData as any)?.songmid)
    .map(async a => {
      try {
        const songmid = (a.rawData as any).songmid as string;
        const resp = await httpFetch(
          `http://artistpicserver.kuwo.cn/pic.web?corp=kuwo&type=rid_pic&pictype=500&size=500&rid=${songmid}`,
          { method: 'GET' },
        );
        if (resp.status === 200 && /^http/.test(resp.body?.trim())) {
          const url = normalizeKuwoCoverUrl(resp.body.trim());
          if (url) a.avatarUrl = url;
        }
      } catch { /* 单个歌手获取失败不影响整体 */ }
    });
  await Promise.race([
    Promise.allSettled(tasks),
    new Promise(resolve => setTimeout(resolve, 3000)),
  ]);
}

/**
 * 网易云搜索接口 artists[].img1v1Url 实为全局统一的默认占位头像
 * （所有歌手返回同一个 6y-UleORITEDbvrOLV0Q8A== URL），不是真实头像。
 * 用 artistId 调艺人详情接口（/api/artist/{id}）拿真实 artist.picUrl。
 * 小并发（3）打接口，只阻塞 2.5 秒，其余后台继续补获
 * （Search.vue 的封面轮询会把迟到的头像刷进视图）。
 */
const WY_PLACEHOLDER_AVATAR = '6y-UleORITEDbvrOLV0Q8A==';

async function fillWyArtistAvatars(artists: LxArtistSearchResult[]): Promise<void> {
  const targets = artists.filter(a => {
    const id = String((a.rawData as any)?.artistId ?? '');
    if (!/^\d+$/.test(id)) return false;
    return !a.avatarUrl || a.avatarUrl.includes(WY_PLACEHOLDER_AVATAR);
  });
  if (targets.length === 0) return;

  const CONCURRENCY = 3;
  let nextIdx = 0;

  const worker = async (): Promise<void> => {
    while (nextIdx < targets.length) {
      const a = targets[nextIdx++];
      const artistId = String((a.rawData as any).artistId);
      try {
        const resp = await httpGetJson(`https://music.163.com/api/artist/${encodeURIComponent(artistId)}?ext=true`, {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/69.0.3497.100 Safari/537.36',
          'Referer': 'https://music.163.com',
          'Cookie': 'MUSIC_A=1',
        });
        const avatar = resp?.artist?.picUrl || resp?.artist?.img1v1Url || '';
        if (avatar) {
          a.avatarUrl = String(avatar).replace(/^http:\/\//i, 'https://');
        }
      } catch { /* 单个歌手获取失败不影响整体 */ }
    }
  };

  const workers = Array.from({ length: Math.min(CONCURRENCY, targets.length) }, () => worker());
  await Promise.race([
    Promise.allSettled(workers),
    new Promise(resolve => setTimeout(resolve, 2500)),
  ]);
}

/**
 * 酷我搜索结果无图片字段，用专辑信息接口补专辑封面；
 * 专辑接口失败/为空时用歌曲封面(artistpicserver)兜底。最多等待 3 秒。
 */
async function fillKwAlbumCovers(albums: LxAlbumSearchResult[]): Promise<void> {
  const tasks = albums
    .filter(a => !a.coverUrl && (a.rawData as any)?.id)
    .map(async a => {
      const raw = a.rawData as any;
      try {
        // 1) 酷我专辑信息接口取专辑封面
        try {
          const resp = await httpGetJson(`https://www.kuwo.cn/api/www/album/albumInfo?albumid=${encodeURIComponent(raw.id)}&httpsStatus=1`, {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
            'Referer': 'https://www.kuwo.cn/',
          });
          const pic = resp?.data?.pic || resp?.data?.picS || resp?.data?.data?.pic || resp?.data?.data?.album?.pic;
          if (pic) {
            const url = normalizeKuwoCoverUrl(String(pic));
            if (url) {
              a.coverUrl = url;
              return;
            }
          }
        } catch { /* 专辑接口失败/为空，走歌曲封面兜底 */ }
        // 2) 兜底：用歌曲封面(artistpicserver)作为专辑封面
        if (raw.songmid) {
          const presp = await httpFetch(
            `http://artistpicserver.kuwo.cn/pic.web?corp=kuwo&type=rid_pic&pictype=500&size=500&rid=${raw.songmid}`,
            { method: 'GET' },
          );
          if (presp.status === 200 && /^http/.test(presp.body?.trim())) {
            const url = normalizeKuwoCoverUrl(presp.body.trim());
            if (url) a.coverUrl = url;
          }
        }
      } catch { /* 单个专辑获取失败不影响整体 */ }
    });
  await Promise.race([
    Promise.allSettled(tasks),
    new Promise(resolve => setTimeout(resolve, 3000)),
  ]);
}

/**
 * 网易云搜索结果 album 不返回 picUrl，只返回超大整数 picId（JSON 解析即丢精度，
 * neteasePicIdToUrl 的精度校验会拒绝），导致专辑封面为空。
 *
 * 与歌曲封面补获（triggerCoverLoading → lxGetPic）走同一条链路：Rust get_lx_cover
 * 自带按专辑缓存 + 全局串行锁 + 请求间隔，天然规避网易云风控（code:-462）；
 * 前端并发调用只会在 Rust 侧排队，不会打爆专辑接口。
 *
 * 只阻塞等待 2.5 秒让首批封面随搜索结果一起返回，其余由后台 worker 继续补获
 * （Search.vue 的 albumCoverRefresh 轮询会把迟到的封面刷进视图）。
 */
async function fillWyAlbumCovers(albums: LxAlbumSearchResult[]): Promise<void> {
  const targets = albums.filter(a =>
    !a.coverUrl && /^\d+$/.test(String((a.rawData as any)?.id ?? ''))
  );
  if (targets.length === 0) return;

  const worker = async (a: LxAlbumSearchResult): Promise<void> => {
    const raw = a.rawData as any;
    try {
      const cover = await pluginApi.getLxCover({
        songmid: String(raw.songmid || ''),
        source: 'wy',
        albumId: String(raw.id),
        name: raw.name,
        singer: raw.artist,
        albumName: raw.name,
      });
      if (cover) a.coverUrl = String(cover).replace(/^http:\/\//i, 'https://');
    } catch { /* 单个专辑获取失败不影响整体 */ }
  };

  await Promise.race([
    Promise.allSettled(targets.map(worker)),
    new Promise(resolve => setTimeout(resolve, 2500)),
  ]);
}

export type LxSourceId = 'kw' | 'kg' | 'tx' | 'wy' | 'mg';

/** Source name mapping */
export const LX_SOURCE_NAMES: Record<LxSourceId, string> = {
  kw: '小蜗音乐',
  kg: '小枸音乐',
  tx: '小秋音乐',
  wy: '小芸音乐',
  mg: '小蜜音乐',
};

/**
 * Search music from LX sources
 * @param source Source ID: 'kw'|'kg'|'tx'|'wy'|'mg'
 * @param keyword Search keyword
 * @param page Page number (1-based)
 * @param limit Results per page
 */
export async function lxSearch(source: LxSourceId, keyword: string, page = 1, limit?: number): Promise<LxSearchResult> {
  return dispatchFallbackModule('lx_search', 'search', { source, keyword, page, limit },
    () => lxSearchBuiltin(source, keyword, page, limit));
}

async function lxSearchBuiltin(source: LxSourceId, keyword: string, page = 1, limit?: number): Promise<LxSearchResult> {
  const searchFnMap: Record<string, (str: string, page: number, limit: number) => Promise<LxSearchResult>> = {
    kw: searchKw,
    kg: searchKg,
    tx: searchTx,
    wy: searchWy,
    mg: searchMg,
  };
  const fn = searchFnMap[source];
  if (!fn) throw new Error(`Unknown LX source: ${source}`);
  return fn(keyword, page, limit ?? (source === 'tx' ? 50 : source === 'mg' ? 20 : 30));
}

// ==================== Album Songs & Playlist Tracks ====================

/**
 * 从简化数据构造 LxSearchResultItem（用于专辑/歌单接口返回数据，
 * 这些接口通常不返回音质类型信息，types 留空，播放时由 lxUrlResolver 统一解析）
 */
function buildSimpleLxItem(
  source: LxSourceId,
  songmid: string,
  name: string,
  singer: string,
  albumName: string,
  albumId: string | number,
  interval: string,
  img: string | null,
  extra?: Partial<LxSearchResultItem>,
): LxSearchResultItem {
  return {
    name: decodeName(name),
    singer: decodeName(singer),
    albumName: decodeName(albumName),
    albumId,
    songmid,
    source,
    interval,
    img,
    types: [],
    _types: {},
    ...extra,
  };
}

/**
 * 检测 albumId 是否为有效的专辑 ID（而非回退的专辑名称）。
 * deriveLxAlbumResults 在 albumId/albumMid 均为空时回退到专辑名，
 * 此时直接调 API 会失败，需由调用方走搜索回退。
 */
function isValidAlbumId(source: LxSourceId, albumId: string): boolean {
  if (!albumId) return false;
  // 专辑名通常含中文/空格/标点，且非纯数字/字母
  // TX 的 mid 格式为字母+数字组合（如 "001abc..."），其余源为纯数字
  if (source === 'tx') {
    // TX albumMid: 字母数字组合，通常以 "00" 开头
    return /^[A-Za-z0-9]{6,}$/.test(albumId);
  }
  // kw/kg/wy/mg: 纯数字 ID
  return /^\d+$/.test(albumId);
}

/**
 * 获取落雪音源专辑歌曲列表
 * @param albumRawData 来自 deriveLxAlbumResults 的 rawData: { source, id, name, artist }
 * @returns 歌曲列表；若 albumId 无效或 API 失败则返回空数组（由调用方走搜索回退）
 */
export async function lxGetAlbumSongs(
  source: LxSourceId,
  albumRawData: any,
  page = 1,
  limit = 30,
): Promise<LxSearchResultItem[]> {
  return dispatchFallbackModule('lx_album', 'getAlbumSongs', { source, albumRawData, page, limit },
    () => lxGetAlbumSongsBuiltin(source, albumRawData, page, limit));
}

async function lxGetAlbumSongsBuiltin(
  source: LxSourceId,
  albumRawData: any,
  page = 1,
  limit = 30,
): Promise<LxSearchResultItem[]> {
  const albumId = String(albumRawData?.id ?? '');
  const albumName = String(albumRawData?.name ?? '');

  // albumId 无效（可能是专辑名回退），直接返回空触发搜索回退
  if (!isValidAlbumId(source, albumId)) {
    console.warn(`[LxMusicSdk] lxGetAlbumSongs: invalid albumId "${albumId}" for source ${source}, falling back to search`);
    return [];
  }

  try {
    switch (source) {
      case 'kw': {
        const url = `http://www.kuwo.cn/api/www/album/albumInfo?albumid=${albumId}&pn=${page}&rn=${limit}`;
        const data = await httpGetJson(url, {
          csrf: 'ABCDEF',
          Cookie: 'kw_token=ABCDEF',
          Referer: 'http://www.kuwo.cn/',
        });
        const musicList: any[] = data?.data?.musicList || [];
        if (musicList.length === 0) console.warn(`[LxMusicSdk] KW album ${albumId}: empty musicList`);
        return musicList.map((m: any) => buildSimpleLxItem(
          'kw', String(m.rid || m.id), m.name || '', m.artist || '',
          m.album || albumName, m.albumid || albumId,
          formatPlayTime(parseInt(m.duration) || 0), m.pic || null,
        ));
      }
      case 'kg': {
        const url = `http://mobilecdn.kugou.com/api/v3/album/song?albumid=${albumId}&page=${page}&pagesize=${limit}`;
        const data = await httpGetJson(url);
        const infoList: any[] = data?.data?.info || [];
        if (infoList.length === 0) console.warn(`[LxMusicSdk] KG album ${albumId}: empty info list`);
        return infoList.map((item: any) => kgFilterData(item));
      }
      case 'tx': {
        // 模块必须用 music.musichallAlbum.AlbumSongList（PlaySingerSongs 是歌手歌曲接口，
        // 组合 GetAlbumSongList 会返回 500003）。已实测该签名请求稳定可用。
        const requestData = {
          comm: { ct: '24', cv: '0' },
          req: {
            module: 'music.musichallAlbum.AlbumSongList',
            method: 'GetAlbumSongList',
            param: { albumMid: albumId, albumID: 0, begin: (page - 1) * limit, num: limit, order: 2 },
          },
        };
        const sign = await zzcSign(JSON.stringify(requestData));
        const resp = await httpPostJson(
          `https://u.y.qq.com/cgi-bin/musics.fcg?sign=${sign}`,
          JSON.stringify(requestData),
          { 'User-Agent': 'Mozilla/5.0 (Linux; Android 12; EBG-AN10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/107.0.5304.141 Mobile Safari/537.36', 'Content-Type': 'application/json', 'Referer': 'https://y.qq.com/' },
        );
        const songList: any[] = resp?.req?.data?.songList || [];
        if (songList.length === 0) console.warn(`[LxMusicSdk] TX album ${albumId}: empty songList`);
        // songList 每项可能包在 songInfo 里
        return txHandleResult(songList.map((s: any) => s.songInfo || s));
      }
      case 'wy': {
        const url = `https://music.163.com/api/album/${albumId}`;
        const data = await httpGetJson(url, {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          Referer: 'https://music.163.com', Cookie: 'MUSIC_A=1',
        });
        const songs: any[] = data?.songs || [];
        if (songs.length === 0) console.warn(`[LxMusicSdk] WY album ${albumId}: empty songs`);
        return songs.map((song: any) => {
          const al = song.album || {};
          const ar = song.artists || [];
          return buildSimpleLxItem(
            'wy', String(song.id), song.name || '',
            ar.map((s: any) => s.name).join('、'),
            al.name || albumName, al.id || albumId,
            formatPlayTime((song.duration || 0) / 1000),
            al.picUrl || null,
          );
        });
      }
      case 'mg': {
        const url = `https://m.music.migu.cn/migu/remoting/cms_album_song_list_tag?albumId=${albumId}&pageNo=${page}&pageSize=${limit}`;
        const data = await httpGetJson(url);
        const list: any[] = data?.resultList || data?.list || [];
        if (list.length === 0) console.warn(`[LxMusicSdk] MG album ${albumId}: empty list`);
        return list.map((item: any) => buildSimpleLxItem(
          'mg', String(item.songId || item.id), item.name || item.songName || '',
          formatSingerName(item.singerList || item.singers),
          item.album || item.albumName || albumName, item.albumId || albumId,
          formatPlayTime(item.duration || 0), item.img3 || item.img2 || item.img1 || null,
          { copyrightId: item.copyrightId },
        ));
      }
    }
  } catch (e) {
    console.warn(`[LxMusicSdk] lxGetAlbumSongs failed for source ${source}, albumId ${albumId}:`, e);
    return [];
  }
  return [];
}

// ==================== LX 歌单详情 Web 兜底 ====================

/**
 * 经典 Web 歌单详情兜底：不依赖新签名(musics.fcg)风控体系。
 * Mobile 歌单详情被风控/降级返回空时使用，避免小秋/QQ 歌单页空白。
 */
async function txSheetTracksWebFallback(
  playlistId: string,
  page: number,
  limit: number,
): Promise<LxSearchResultItem[]> {
  const url = `https://c.y.qq.com/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg?type=1&json=1&utf8=1&onlysong=0&new_format=1&disstid=${encodeURIComponent(playlistId)}&format=json&g_tk=5381&loginUin=0&hostUin=0&inCharset=utf8&outCharset=utf-8&notice=0&platform=jq&needNewCode=0`;
  const result = await httpGetJson(url, {
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1',
    'Referer': 'https://y.qq.com/',
  });
  const cdlist: any[] = result?.data?.cdlist || [];
  const first: any = cdlist[0] || {};
  const songAll: any[] = first.songlist || [];
  const start = (page - 1) * limit;
  const songlist = songAll.slice(start, start + limit);
  if (songlist.length === 0) console.warn(`[LxMusicSdk] TX playlist web fallback ${playlistId}: empty songlist`);
  return txHandleResult(songlist);
}

/**
 * 获取落雪音源歌单曲目列表
 * @param playlistRawData 来自 normalizeLxPlaylistResults 的 rawData（原始 API 响应项）
 */
export async function lxGetPlaylistTracks(
  source: LxSourceId,
  playlistRawData: any,
  page = 1,
  limit = 30,
): Promise<LxSearchResultItem[]> {
  const playlistId = String(
    firstValue(playlistRawData, ['id', 'ID', 'playlistId', 'playlistid', 'specialid', 'dissid', 'disstid', 'songListId', 'songlistId', 'musicListId', 'rid']) ?? ''
  );

  if (!playlistId) {
    console.warn(`[LxMusicSdk] lxGetPlaylistTracks: empty playlistId for source ${source}`);
    return [];
  }

  try {
    switch (source) {
      case 'kw': {
        const url = `http://www.kuwo.cn/api/www/playlist/playListInfo?pid=${playlistId}&pn=${page}&rn=${limit}`;
        const data = await httpGetJson(url, {
          csrf: 'ABCDEF',
          Cookie: 'kw_token=ABCDEF',
          Referer: 'http://www.kuwo.cn/',
        });
        const musicList: any[] = data?.data?.musicList || [];
        if (musicList.length === 0) console.warn(`[LxMusicSdk] KW playlist ${playlistId}: empty musicList`);
        return musicList.map((m: any) => buildSimpleLxItem(
          'kw', String(m.rid || m.id), m.name || '', m.artist || '',
          m.album || '', m.albumid || '',
          formatPlayTime(parseInt(m.duration) || 0), m.pic || null,
        ));
      }
      case 'kg': {
        const url = `http://mobilecdn.kugou.com/api/v3/song/special/getSongList?specialid=${playlistId}&page=${page}&pagesize=${limit}`;
        const data = await httpGetJson(url);
        const infoList: any[] = data?.data?.info || [];
        if (infoList.length === 0) console.warn(`[LxMusicSdk] KG playlist ${playlistId}: empty info list`);
        return infoList.map((item: any) => kgFilterData(item));
      }
      case 'tx': {
        const requestData = {
          comm: { ct: '24', cv: '0' },
          req: {
            module: 'music.srfDissInfo.aiDissInfo',
            method: 'uniform_get_Dissinfo',
            param: {
              disstid: playlistId,
              song_num: limit,
              song_begin: (page - 1) * limit,
              userinfo: 0, tag: 1, is_pull_album_info: 1,
            },
          },
        };
        // 该接口与 searchTx 同属新签名(Mobile)风控体系：被风控(reqCode 2001)或降级时返回空 songlist，
        // 无结果时走经典 Web 接口兜底（不依赖这套风控），否则用户在歌单页一直空白。
        const fallback = (reason: string) => {
          console.warn(`[LxMusicSdk] TX playlist ${playlistId}: ${reason}，尝试 Web 兜底`);
          return txSheetTracksWebFallback(playlistId, page, limit);
        };
        let resp: any;
        try {
          const sign = await zzcSign(JSON.stringify(requestData));
          resp = await httpPostJson(
            `https://u.y.qq.com/cgi-bin/musics.fcg?sign=${sign}`,
            JSON.stringify(requestData),
            { 'User-Agent': 'Mozilla/5.0 (Linux; Android 12; EBG-AN10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/107.0.5304.141 Mobile Safari/537.36', 'Content-Type': 'application/json', 'Referer': 'https://y.qq.com/' },
          );
        } catch (e: any) {
          return fallback(`Mobile 接口异常(${e?.message || e})`);
        }
        const songlist: any[] = resp?.req?.data?.songlist || [];
        if (songlist.length === 0) return fallback('empty songlist');
        return txHandleResult(songlist);
      }
      case 'wy': {
        const offset = (page - 1) * limit;
        const url = `https://music.163.com/api/v6/playlist/detail?id=${playlistId}&n=${limit}&offset=${offset}`;
        const data = await httpGetJson(url, {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          Referer: 'https://music.163.com', Cookie: 'MUSIC_A=1',
        });
        const tracks: any[] = data?.playlist?.tracks || [];
        if (tracks.length === 0) console.warn(`[LxMusicSdk] WY playlist ${playlistId}: empty tracks`);
        return tracks.map((song: any) => {
          const al = song.album || song.al || {};
          const ar = song.artists || song.ar || [];
          return buildSimpleLxItem(
            'wy', String(song.id), song.name || '',
            ar.map((s: any) => s.name).join('、'),
            al.name || '', al.id || '',
            formatPlayTime((song.duration || song.dt || 0) / 1000),
            al.picUrl || null,
          );
        });
      }
      case 'mg': {
        const url = `https://m.music.migu.cn/migu/remoting/playlist_callback?playlistId=${playlistId}&pageNo=${page}&pageSize=${limit}`;
        const data = await httpGetJson(url);
        const list: any[] = data?.list || data?.resultList || [];
        if (list.length === 0) console.warn(`[LxMusicSdk] MG playlist ${playlistId}: empty list`);
        return list.map((item: any) => buildSimpleLxItem(
          'mg', String(item.songId || item.id), item.name || item.songName || '',
          formatSingerName(item.singerList || item.singers),
          item.album || item.albumName || '', item.albumId || '',
          formatPlayTime(item.duration || 0), item.img3 || item.img2 || item.img1 || null,
          { copyrightId: item.copyrightId },
        ));
      }
    }
  } catch (e) {
    console.warn(`[LxMusicSdk] lxGetPlaylistTracks failed for source ${source}, playlistId ${playlistId}:`, e);
    return [];
  }
  return [];
}

// ==================== Get Cover Picture ====================

/**
 * 获取落雪 LX 音源的封面图片 URL
 *
 * HTTP 请求+URL 归一化均由 Rust 后端 (url_resolver.rs) 完成。
 * 如果搜索结果已有封面，直接返回（避免不必要的网络请求）。
 */
export async function lxGetPic(songInfo: LxSearchResultItem): Promise<string | null> {
  // 如果搜索结果已有封面，直接返回
  if (songInfo.img) return normalizeKuwoCoverUrl(songInfo.img) || songInfo.img;

  try {
    const result = await pluginApi.getLxCover(toUrlSongInfo(songInfo));
    return (result && String(result).replace(/^http:\/\//i, 'https://')) || null;
  } catch (e: any) {
    console.warn(`[LxMusicSdk] getLxCover failed: ${e?.message || e}`);
    return null;
  }
}

// Note: LX 音乐 URL 解析已统一到 lxUrlResolver.ts（resolveLxUrl），
// 旧函数 lxGetMusicUrl 已删除。如需单次解析请使用 resolveLxUrl / resolveLxUrlViaRust。