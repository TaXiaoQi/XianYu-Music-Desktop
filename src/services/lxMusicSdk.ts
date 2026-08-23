import {
  buildKuwoAlbumCoverUrl,
  neteasePicIdToUrl,
  normalizeKuwoCoverUrl,
} from '../utils/coverUrl';
import { decodeName, formatSingerName } from '../utils/musicFormat';
import {
  normalizeQualityKey,
  qualityKeyToBakaPluginQuality,
} from '../types';
import { pluginApi } from './tauri/pluginApi';
import { hostMiguSign, hostZzcSign } from './tauri/hostCryptoApi';
import type { LxUrlSongInfoContract } from './tauri/contracts';
import { dispatchFallbackModule } from './fallbackModules/registry';

/**
 * 将 LxSearchResultItem 转换为 Rust URL 解析器所需的合约类型
 */
export function toUrlSongInfo(item: LxSearchResultItem): LxUrlSongInfoContract {
  return {
    songmid: String(item.songmid ?? ''),
    source: item.source,
    hash: item.hash,
    name: item.name,
    singer: item.singer,
    albumName: item.albumName,
    albumId: item.albumId != null ? String(item.albumId) : undefined,
    albumMid: item.albumMid != null ? String(item.albumMid) : undefined,
    copyrightId: item.copyrightId != null ? String(item.copyrightId) : undefined,
    strMediaMid: item.strMediaMid != null ? String(item.strMediaMid) : undefined,
    songId: item.songId != null ? String(item.songId) : undefined,
    _types: normalizeLxTypes(item._types) as Record<string, { size?: string | null; hash?: string }> | undefined,
  };
}

function normalizeLxTypes(
  raw: Record<string, { size?: string | null; hash?: string }> | undefined,
): Record<string, { size?: string | null; hash?: string }> | undefined {
  if (!raw || typeof raw !== 'object') return raw;
  const result: Record<string, { size?: string | null; hash?: string }> = { ...raw };
  for (const [key, value] of Object.entries(raw)) {
    const qualityKey = normalizeQualityKey(key);
    if (!qualityKey) continue;
    result[qualityKey] = value;
    result[qualityKeyToBakaPluginQuality(qualityKey)] = value;
  }
  return result;
}

// ==================== Types ====================
export interface LxSearchResultItem {
  name: string;
  singer: string;
  albumName: string;
  albumId: string | number;
  songmid: string;
  source: 'kw' | 'kg' | 'tx' | 'wy' | 'mg';
  interval: string;
  img: string | null;
  /** 各歌手的头像 URL（key 为歌手名，value 为头像 URL），搜索接口直接返回时填充 */
  singerAvatars?: Record<string, string>;
  /** 各歌手的艺人 ID（key 为歌手名，value 为 ID），供歌手头像/详情接口补获 */
  singerIds?: Record<string, string>;
  types: { type: string; size: string | null; hash?: string }[];
  _types: Record<string, { size: string | null; hash?: string }>;
  // source-specific fields
  hash?: string; // kg
  strMediaMid?: string; // tx
  songId?: string | number; // tx
  albumMid?: string; // tx
  copyrightId?: string; // mg
  lrcUrl?: string; // mg
  mrcUrl?: string; // mg
  trcUrl?: string; // mg
}

export interface LxSearchResult {
  list: LxSearchResultItem[];
  allPage: number;
  limit: number;
  total: number;
  source: string;
}

// ==================== Utility Functions ====================

function formatPlayTime(seconds: number): string {
  if (!seconds || Number.isNaN(seconds)) return '00:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function sizeFormate(bytes: number | undefined | null): string {
  if (!bytes) return '0B';
  if (bytes < 1024) return bytes + 'B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + 'MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(1) + 'GB';
}

// ==================== HTTP Request via Tauri ====================

interface HttpResponse {
  status: number;
  url: string;
  headers: Record<string, string>;
  body: string;
}

async function httpFetch(url: string, options: {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
} = {}): Promise<HttpResponse> {
  return pluginApi.pluginHttpRequest(
    options.method || 'GET',
    url,
    options.headers,
    options.body,
  );
}

async function httpGetJson(url: string, headers?: Record<string, string>): Promise<any> {
  const resp = await httpFetch(url, { method: 'GET', headers });
  if (resp.status !== 200) throw new Error(`HTTP ${resp.status} for ${url}`);
  try {
    return JSON.parse(resp.body);
  } catch {
    throw new Error(`Invalid JSON response from ${url}`);
  }
}

async function httpPostJson(url: string, body: string, headers?: Record<string, string>): Promise<any> {
  const resp = await httpFetch(url, { method: 'POST', headers, body });
  if (resp.status !== 200) throw new Error(`HTTP ${resp.status} for ${url}`);
  try {
    return JSON.parse(resp.body);
  } catch {
    throw new Error(`Invalid JSON response from ${url}`);
  }
}

/**
 * 酷我旧搜索接口（search.kuwo.cn/r.s）返回 Python 风格单引号 JSON
 * （{'ARTISTPIC':'',...}），标准 JSON.parse 必然失败。
 * 状态机转换：字符串定界符 ' → "，字符串内的 " 转义，保留原有反斜杠转义。
 */
function parseLooseJson(text: string): any {
  let out = '';
  let inStr = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (!inStr) {
      if (ch === "'") { inStr = true; out += '"'; }
      else out += ch;
    } else if (ch === '\\') {
      out += ch + (text[i + 1] ?? '');
      i++;
    } else if (ch === "'") {
      inStr = false;
      out += '"';
    } else {
      out += ch === '"' ? '\\"' : ch;
    }
  }
  return JSON.parse(out);
}

async function httpGetLooseJson(url: string, headers?: Record<string, string>): Promise<any> {
  const resp = await httpFetch(url, { method: 'GET', headers });
  if (resp.status !== 200) throw new Error(`HTTP ${resp.status} for ${url}`);
  try {
    return JSON.parse(resp.body);
  } catch {
    return parseLooseJson(resp.body);
  }
}

// ==================== TX (QQ音乐) Signing（Rust host_crypto） ====================

function zzcSign(text: string): Promise<string> {
  return hostZzcSign(text);
}

// ==================== KW (酷我) Search ====================

const KW_MINFO_REGEX = /level:(\w+),bitrate:(\d+),format:(\w+),size:([\w.]+)/;

/**
 * 酷我搜索结果的封面字段在不同响应/版本中位置不一，尝试多个字段拼封面。
 * 完整 URL 直接归一化，相对 short 路径用 buildKuwoAlbumCoverUrl。
 * 全部缺失返回 null，由 catalogSearch 阶段对 artist/album 异步补封面。
 */
function kwSearchCover(info: any): string | null {
  const candidates = ['web_albumpic_short', 'web_album_pic', 'album_pic', 'albumpic_short', 'albumpic', 'pic'];
  for (const key of candidates) {
    const v = info?.[key];
    if (!v) continue;
    const s = String(v).trim();
    if (!s) continue;
    if (/^https?:\/\//i.test(s)) {
      const norm = normalizeKuwoCoverUrl(s);
      if (norm) return norm;
    } else {
      const built = buildKuwoAlbumCoverUrl(s);
      if (built) return built;
    }
  }
  return null;
}

function kwHandleResult(rawData: any[]): LxSearchResultItem[] | null {
  const result: LxSearchResultItem[] = [];
  if (!rawData) return result;
  for (let i = 0; i < rawData.length; i++) {
    const info = rawData[i];
    const songId = info.MUSICRID.replace('MUSIC_', '');
    if (!info.N_MINFO) {
      return null;
    }
    const types: LxSearchResultItem['types'] = [];
    const _types: LxSearchResultItem['_types'] = {};
    const infoArr = info.N_MINFO.split(';');
    for (const item of infoArr) {
      const match = item.match(KW_MINFO_REGEX);
      if (match) {
        switch (match[2]) {
          case '4000':
            types.push({ type: 'flac24bit', size: match[4] });
            _types.flac24bit = { size: match[4].toLocaleUpperCase() };
            break;
          case '2000':
            types.push({ type: 'flac', size: match[4] });
            _types.flac = { size: match[4].toLocaleUpperCase() };
            break;
          case '320':
            types.push({ type: '320k', size: match[4] });
            _types['320k'] = { size: match[4].toLocaleUpperCase() };
            break;
          case '128':
            types.push({ type: '128k', size: match[4] });
            _types['128k'] = { size: match[4].toLocaleUpperCase() };
            break;
        }
      }
    }
    types.reverse();
    const interval = parseInt(info.DURATION);
    // 搜索结果图片字段在同一响应/版本中位置不一，用 kwSearchCover 尝试多个字段；
    // 全部缺失则留空，由 lxCatalogSearch 阶段对 artist/album 异步补封面
    const imgFromSearch = kwSearchCover(info);
    result.push({
      name: decodeName(info.SONGNAME),
      singer: decodeName(info.ARTIST).replace(/&/g, '、'),
      source: 'kw',
      songmid: songId,
      albumId: decodeName(info.ALBUMID || ''),
      interval: Number.isNaN(interval) ? '00:00' : formatPlayTime(interval),
      albumName: info.ALBUM ? decodeName(info.ALBUM) : '',
      img: imgFromSearch,
      types,
      _types,
    });
  }
  return result;
}

async function searchKw(str: string, page = 1, limit = 30, retryNum = 0): Promise<LxSearchResult> {
  if (retryNum > 2) throw new Error('KW search: try max num');
  const url = `http://search.kuwo.cn/r.s?client=kt&all=${encodeURIComponent(str)}&pn=${page - 1}&rn=${limit}&uid=794762570&ver=kwplayer_ar_9.2.2.1&vipver=1&show_copyright_off=1&newver=1&ft=music&cluster=0&strategy=2012&encoding=utf8&rformat=json&vermerge=1&mobi=1&issubtitle=1`;
  const result = await httpGetJson(url);
  if (!result || (result.TOTAL !== '0' && result.SHOW === '0')) return searchKw(str, page, limit, ++retryNum);
  const list = kwHandleResult(result.abslist);
  if (list == null) return searchKw(str, page, limit, ++retryNum);
  const total = parseInt(result.TOTAL);
  return {
    list,
    allPage: Math.ceil(total / limit),
    limit,
    total,
    source: 'kw',
  };
}

// ==================== KG (酷狗) Search ====================

/**
 * 构造酷狗封面 URL：搜索结果 Image 字段含 {size} 占位符，替换为实际尺寸并升级为 HTTPS。
 * 例：`http://imge.kugou.com/stdmusic/{size}/xxx.jpg` → `https://imge.kugou.com/stdmusic/480/xxx.jpg`
 */
function buildKugouCoverUrl(url: string | null | undefined, size = 480): string | null {
  if (!url || typeof url !== 'string') return null;
  let u = url.trim();
  if (!u) return null;
  u = u.replace(/^http:\/\//i, 'https://');
  u = u.replace('{size}', String(size));
  return u;
}

function kgFilterData(rawData: any): LxSearchResultItem {
  const types: LxSearchResultItem['types'] = [];
  const _types: LxSearchResultItem['_types'] = {};
  if (rawData.FileSize !== 0) {
    const size = sizeFormate(rawData.FileSize);
    types.push({ type: '128k', size, hash: rawData.FileHash });
    _types['128k'] = { size, hash: rawData.FileHash };
  }
  if (rawData.HQFileSize !== 0) {
    const size = sizeFormate(rawData.HQFileSize);
    types.push({ type: '320k', size, hash: rawData.HQFileHash });
    _types['320k'] = { size, hash: rawData.HQFileHash };
  }
  if (rawData.SQFileSize !== 0) {
    const size = sizeFormate(rawData.SQFileSize);
    types.push({ type: 'flac', size, hash: rawData.SQFileHash });
    _types.flac = { size, hash: rawData.SQFileHash };
  }
  if (rawData.ResFileSize !== 0) {
    const size = sizeFormate(rawData.ResFileSize);
    types.push({ type: 'flac24bit', size, hash: rawData.ResFileHash });
    _types.flac24bit = { size, hash: rawData.ResFileHash };
  }
  // 酷狗搜索结果 Image 字段含专辑封面 URL（带 {size} 占位符），直接提取避免 img=null
  const imgUrl = buildKugouCoverUrl(rawData.Image || rawData.trans_param?.union_cover);
  return {
    singer: decodeName(formatSingerName(rawData.Singers, 'name')),
    name: decodeName(rawData.SongName),
    albumName: decodeName(rawData.AlbumName),
    albumId: rawData.AlbumID,
    songmid: rawData.Audioid,
    source: 'kg',
    interval: formatPlayTime(rawData.Duration),
    img: imgUrl,
    hash: rawData.FileHash,
    types,
    _types,
  };
}

function kgHandleResult(rawData: any[]): LxSearchResultItem[] {
  const ids = new Set<string>();
  const list: LxSearchResultItem[] = [];
  rawData.forEach(item => {
    const key = item.Audioid + item.FileHash;
    if (ids.has(key)) return;
    ids.add(key);
    list.push(kgFilterData(item));
    if (item.Grp) {
      for (const childItem of item.Grp) {
        const childKey = childItem.Audioid + childItem.FileHash;
        if (ids.has(childKey)) continue;
        ids.add(childKey);
        list.push(kgFilterData(childItem));
      }
    }
  });
  return list;
}

async function searchKg(str: string, page = 1, limit = 30, retryNum = 0): Promise<LxSearchResult> {
  if (++retryNum > 3) throw new Error('KG search: try max num');
  const url = `https://songsearch.kugou.com/song_search_v2?keyword=${encodeURIComponent(str)}&page=${page}&pagesize=${limit}&userid=0&clientver=&platform=WebFilter&filter=2&iscorrection=1&privilege_filter=0&area_code=1`;
  const result = await httpGetJson(url);
  if (!result || result.error_code !== 0) return searchKg(str, page, limit, retryNum);
  const list = kgHandleResult(result.data.lists);
  if (list == null) return searchKg(str, page, limit, retryNum);
  const total = result.data.total;
  return {
    list,
    allPage: Math.ceil(total / limit),
    limit,
    total,
    source: 'kg',
  };
}

// ==================== TX (QQ音乐) Search ====================

function txHandleResult(rawList: any[]): LxSearchResultItem[] {
  if (!rawList || !Array.isArray(rawList)) return [];
  const list: LxSearchResultItem[] = [];
  rawList.forEach(rawItem => {
    const item = rawItem?.song || rawItem?.songInfo || rawItem?.musicInfo || rawItem?.item || rawItem?.doc?.song || rawItem?.doc || rawItem;
    if (!item || typeof item !== 'object') return;
    // 放宽过滤：仅要求 mid 或 id 存在即可（与 playlistImport.ts 的 parseTxSong 对齐）。
    // 原 media_mid 非空过滤过严：QQ 音乐响应中 file/media_mid 可能为空或缺失，
    // 导致搜索结果被全部静默过滤 → 列表为空（小秋搜索无法加载歌曲列表的根因）。
    const songmid = String(firstValue(item, ['mid', 'songmid', 'songMid', 'strMediaMid', 'mediaMid', 'mediamid', 'song_mid', 'songMID', 'id', 'songid']) || '');
    const songId = firstValue(item, ['id', 'songid', 'songId', 'songID']);
    if (!songmid && songId === undefined) return;
    const types: LxSearchResultItem['types'] = [];
    const _types: LxSearchResultItem['_types'] = {};
    const file = item.file || {};
    if (Number(file.size_128mp3) > 0) {
      const size = sizeFormate(file.size_128mp3);
      types.push({ type: '128k', size });
      _types['128k'] = { size };
    }
    if (Number(file.size_320mp3) > 0) {
      const size = sizeFormate(file.size_320mp3);
      types.push({ type: '320k', size });
      _types['320k'] = { size };
    }
    if (Number(file.size_flac) > 0) {
      const size = sizeFormate(file.size_flac);
      types.push({ type: 'flac', size });
      _types.flac = { size };
    }
    if (Number(file.size_hires) > 0) {
      const size = sizeFormate(file.size_hires);
      types.push({ type: 'flac24bit', size });
      _types.flac24bit = { size };
    }
    if (Number(file.size_master) > 0) {
      const size = sizeFormate(file.size_master);
      types.push({ type: 'master', size });
      _types.master = { size };
    }
    if (Number(file.size_atmos) > 0) {
      const size = sizeFormate(file.size_atmos);
      types.push({ type: 'atmos', size });
      _types.atmos = { size };
    }
    if (Number(file.size_dolby) > 0) {
      const size = sizeFormate(file.size_dolby);
      types.push({ type: 'dolby', size });
      _types.dolby = { size };
    }
    const album = item.album || item.albumInfo || item.album_info || {};
    const albumId = String(album.mid ?? firstValue(item, ['albumMid', 'albummid', 'album_mid', 'albumMID', 'albumid', 'albumId']) ?? '');
    const albumName = String(album.name ?? album.title ?? firstValue(item, ['albumName', 'albumname', 'album_name', 'albumTitle']) ?? '');
    const singer = item.singer ?? item.singers ?? item.singerList ?? item.singerName ?? item.singername ?? item.singer_name ?? '';
    const strMediaMid = file.media_mid ?? firstValue(item, ['strMediaMid', 'mediaMid', 'mediamid', 'media_mid', 'mediaMID']) ?? '';
    const interval = Number(firstValue(item, ['interval', 'duration', 'time_public']) || 0);
    const displayName = firstValue(item, ['title', 'name', 'songname', 'songName', 'song_name']) || '';
    list.push({
      singer: formatSingerName(singer, 'name'),
      name: decodeName(String(displayName).replace(/<[^>]*>/g, '')),
      albumName,
      albumId,
      source: 'tx',
      interval: formatPlayTime(interval),
      songId,
      albumMid: albumId,
      strMediaMid,
      songmid,
      img: (albumId === '' || albumId === '空')
        ? (Array.isArray(item.singer) && item.singer[0]?.mid ? `https://y.gtimg.cn/music/photo_new/T001R500x500M000${item.singer[0].mid}.jpg` : null)
        : `https://y.gtimg.cn/music/photo_new/T002R500x500M000${albumId}.jpg`,
      types,
      _types,
    });
  });
  return list;
}

function pickArrayFromTxNode(node: any): any[] {
  if (Array.isArray(node)) return node;
  if (!node || typeof node !== 'object') return [];
  const direct = node.list
    ?? node.songlist
    ?? node.itemlist
    ?? node.items
    ?? node.item_song
    ?? node.item_audio
    ?? node.grp
    ?? node.song
    ?? node.songInfo
    ?? node.musicInfo
    ?? node.item
    ?? node.docs
    ?? node.records
    ?? node.results
    ?? node.result
    ?? node.value
    ?? node.values
    ?? node.data;
  return Array.isArray(direct) ? direct : [];
}

// 从 direct_result / direct_result2 直达结果中提取歌曲列表。
// 该字段可能是对象（{ song:{list}, item_song:{list} }），也可能是数组（直接结果分组，
// 每组形如 { type:'song', grp:[...] }，仅歌曲类型分组内是真正可播放的歌曲）。
function pickTxDirectResultList(dr: any): any[] {
  if (!dr || typeof dr !== 'object') return [];
  const groups = Array.isArray(dr) ? dr : [dr];
  for (const g of groups) {
    if (!g || typeof g !== 'object') continue;
    const arr = pickArrayFromTxNode(g?.grp ?? g?.song ?? g?.item_song ?? g?.item_audio ?? g);
    if (arr.length > 0 && txHandleResult(arr).length > 0) return arr;
  }
  return [];
}

function findTxSongListDeep(root: any, maxDepth = 6): any[] {
  if (!root || typeof root !== 'object') return [];
  const seen = new WeakSet<object>();
  const queue: Array<{ node: any; depth: number }> = [{ node: root, depth: 0 }];

  while (queue.length > 0) {
    const { node, depth } = queue.shift()!;
    if (!node || typeof node !== 'object') continue;
    if (seen.has(node)) continue;
    seen.add(node);

    if (Array.isArray(node)) {
      if (node.length > 0 && txHandleResult(node).length > 0) return node;
      if (depth >= maxDepth) continue;
      for (const item of node.slice(0, 80)) {
        if (item && typeof item === 'object') queue.push({ node: item, depth: depth + 1 });
      }
      continue;
    }

    const direct = pickArrayFromTxNode(node);
    if (direct.length > 0 && txHandleResult(direct).length > 0) return direct;
    if (depth >= maxDepth) continue;

    const priorityKeys = [
      'song', 'songlist', 'item_song', 'item_audio', 'grp',
      'direct_result', 'direct_result2', 'musicInfo', 'songInfo',
      'list', 'items', 'data', 'docs', 'records', 'result',
    ];
    for (const key of priorityKeys) {
      const child = node[key];
      if (child && typeof child === 'object') queue.push({ node: child, depth: depth + 1 });
    }
    for (const child of Object.values(node)) {
      if (child && typeof child === 'object') queue.push({ node: child, depth: depth + 1 });
    }
  }

  return [];
}

function describeTxSearchBody(body: any): Record<string, string[] | null> | null {
  if (!body || typeof body !== 'object') return null;
  const pickKeys = (value: any) => (value && typeof value === 'object' ? Object.keys(value).slice(0, 30) : null);
  return {
    item_song: pickKeys(body.item_song),
    item_audio: pickKeys(body.item_audio),
    direct_result: pickKeys(body.direct_result),
    direct_result2: pickKeys(body.direct_result2),
    direct_result_item_song: pickKeys(body.direct_result?.item_song),
    direct_result2_item_song: pickKeys(body.direct_result2?.item_song),
  };
}

function pickTxSearchRawList(data: any): any[] {
  const body = data?.body;
  const candidates = [
    body?.song?.list,
    body?.song?.songlist,
    body?.song?.itemlist,
    body?.song?.items,
    body?.song?.item_song,
    body?.songlist?.list,
    body?.songlist?.songlist,
    body?.songlist?.itemlist,
    body?.songlist?.items,
    body?.songlist,
    body?.item_song?.list,
    body?.item_song,
    body?.item_audio?.list,
    body?.item_audio,
    body?.direct_result?.song?.list,
    body?.direct_result?.item_song?.list,
    body?.direct_result?.item_song,
    body?.direct_result2?.song?.list,
    body?.direct_result2?.item_song?.list,
    body?.direct_result2?.item_song,
    data?.song?.list,
    data?.song,
    data?.songlist?.list,
    data?.songlist,
    data?.item_song?.list,
    data?.item_song,
  ];

  for (const candidate of candidates) {
    const list = pickArrayFromTxNode(candidate);
    if (list.length > 0 && txHandleResult(list).length > 0) return list;
  }

  // direct_result / direct_result2 常以“直接结果分组数组”形式返回精确匹配的歌曲，
  // 此时常规候选（song.list / item_song 等）可能为空，需从分组里提取。
  const direct = pickTxDirectResultList(body?.direct_result)
    ?? pickTxDirectResultList(body?.direct_result2);
  if (direct.length > 0) return direct;
  const directTop = pickTxDirectResultList(data?.direct_result)
    ?? pickTxDirectResultList(data?.direct_result2);
  if (directTop.length > 0) return directTop;

  return findTxSongListDeep(body ?? data);
}

function getTxSearchTotal(data: any, fallbackCount: number, limit: number): number {
  const total = data?.meta?.estimate_sum
    ?? data?.body?.song?.totalnum
    ?? data?.body?.song?.total
    ?? data?.body?.song?.total_num
    ?? data?.body?.songlist?.totalnum
    ?? data?.body?.songlist?.total
    ?? data?.body?.songlist?.total_num
    ?? data?.body?.total
    ?? fallbackCount;
  const numericTotal = Number(total);
  if (Number.isFinite(numericTotal) && numericTotal > 0) return numericTotal;
  return fallbackCount || limit;
}

function createTxSearchRequestData(str: string, page: number, limit: number) {
  // 仅使用移动端接口（落雪官方验证有效）。需携带完整设备参数，
  // 否则会返回降级响应，常规 item_song 为空、歌曲只出现在 direct_result2 直达结果里。
  return {
    comm: {
      ct: '11', cv: '14090508', v: '14090508', tmeAppID: 'qqmusic',
      phonetype: 'EBG-AN10', deviceScore: '553.47', devicelevel: '50', newdevicelevel: '20',
      rom: 'HuaWei/EMOTION/EmotionUI_14.2.0', os_ver: '12',
      OpenUDID: '0', OpenUDID2: '0', QIMEI36: '0', udid: '0', chid: '0', aid: '0',
      oaid: '0', taid: '0', tid: '0', wid: '0', uid: '0', sid: '0',
      modeSwitch: '6', teenMode: '0', ui_mode: '2', nettype: '1020', v4ip: '',
    },
    req: {
      module: 'music.search.SearchCgiService',
      method: 'DoSearchForQQMusicMobile',
      param: {
        search_type: 0,
        searchid: Math.random().toString().slice(2),
        query: str,
        page_num: page,
        num_per_page: limit,
        highlight: 0, nqc_flag: 0, multi_zhida: 0, cat: 2, grp: 1, sin: 0, sem: 0,
      },
    },
  };
}

async function requestTxSearch(str: string, page: number, limit: number): Promise<any> {
  const requestData = createTxSearchRequestData(str, page, limit);
  const sign = await zzcSign(JSON.stringify(requestData));
  const url = `https://u.y.qq.com/cgi-bin/musics.fcg?sign=${sign}`;
  return httpPostJson(url, JSON.stringify(requestData), {
    'User-Agent': 'Mozilla/5.0 (Linux; Android 12; EBG-AN10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/107.0.5304.141 Mobile Safari/537.36',
    'Content-Type': 'application/json',
    'Referer': 'https://y.qq.com/',
  });
}

/** Desktop 接口随机 guid：32 位大写 hex */
function randomTxDeviceGuid(): string {
  let value = '';
  for (let i = 0; i < 32; i++) value += Math.floor(Math.random() * 16).toString(16).toUpperCase();
  return value;
}

/** Desktop 接口随机 wid：19 位数字（首位非零） */
function randomTxDeviceWid(): string {
  let value = String(Math.floor(Math.random() * 9) + 1);
  while (value.length < 19) value += Math.floor(Math.random() * 10);
  return value;
}

function createTxDesktopSearchRequestData(str: string, page: number, limit: number) {
  // Desktop 接口（DoSearchForQQMusicDesktop）按请求随机 guid/wid：
  // 与 Mobile 分属不同风控池，实测持续稳定；固定共享身份反而易被按设备维度限流。
  return {
    comm: {
      _channelid: '0',
      _os_version: '6.2.9200-2',
      ct: '19',
      cv: '2151',
      guid: randomTxDeviceGuid(),
      patch: '118',
      psrf_access_token_expiresAt: 0,
      psrf_qqaccess_token: '',
      psrf_qqopenid: '',
      psrf_qqunionid: '',
      tmeAppID: 'qqmusic',
      tmeLoginType: 0,
      uin: '0',
      wid: randomTxDeviceWid(),
    },
    req: {
      module: 'music.search.SearchCgiService',
      method: 'DoSearchForQQMusicDesktop',
      param: {
        grp: 1,
        num_per_page: limit,
        page_num: page,
        query: str,
        remoteplace: 'txt.newclient.top',
        search_type: 0,
        searchid: `${randomTxDeviceGuid()}${String(Math.floor(Math.random() * 100000)).padStart(5, '0')}`,
      },
    },
  };
}

async function requestTxSearchDesktop(str: string, page: number, limit: number): Promise<any> {
  const requestData = createTxDesktopSearchRequestData(str, page, limit);
  const sign = await zzcSign(JSON.stringify(requestData));
  const url = `https://u.y.qq.com/cgi-bin/musics.fcg?sign=${sign}`;
  return httpPostJson(url, JSON.stringify(requestData), {
    'User-Agent': 'QQMusic 14090508(android 12)',
    'Content-Type': 'application/json',
    'Referer': 'https://y.qq.com/',
  });
}

/** 经典 Web 搜索接口兜底：不依赖新签名(Mobile)风控体系，Mobile 被持续风控时使用 */
async function txSearchWebFallback(str: string, page: number, limit: number): Promise<LxSearchResult> {
  const url = `https://c.y.qq.com/soso/fcgi-bin/client_search_cp?format=json&inCharset=utf-8&outCharset=utf-8&cr=1&platform=h5&catZhida=0&w=${encodeURIComponent(str)}&p=${page}&n=${limit}`;
  const result = await httpGetJson(url, {
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1',
    'Referer': 'https://y.qq.com/',
  });
  const song = result?.data?.song;
  const rawList = song?.list || [];
  const items = txHandleResult(rawList);
  if (items.length === 0) throw new Error('TX web fallback: 无有效歌曲');
  const total = Number(song?.totalnum || song?.num || rawList.length) || items.length;
  return {
    list: items,
    allPage: Math.ceil(total / limit),
    limit,
    total,
    source: 'tx',
  };
}

function txBuildSearchResult(data: any, rawList: any[], limit: number): LxSearchResult {
  const list = txHandleResult(rawList);
  if (list.length === 0 && Array.isArray(rawList) && rawList.length > 0) {
    console.warn(`[LxMusicSdk] TX search: all ${rawList.length} items filtered out, sample:`, JSON.stringify(rawList[0]).slice(0, 300));
  }
  const total = getTxSearchTotal(data, list.length, limit);
  return {
    list,
    allPage: Math.ceil(total / limit),
    limit,
    total,
    source: 'tx',
  };
}

async function searchTx(str: string, page = 1, limit = 50): Promise<LxSearchResult> {
  // 主通道：签名 Desktop 接口。实测 Mobile 接口（DoSearchForQQMusicMobile）请求两次
  // 即累积风控（reqCode 2001，全列表恒空），而 Desktop 接口按请求随机 guid/wid，
  // 与 Mobile 分属不同风控池，持续稳定且不累积。
  try {
    const desktopBody = await requestTxSearchDesktop(str, page, limit);
    const desktopOk = desktopBody?.code === 0 && desktopBody?.req?.code === 0;
    const desktopRaw = desktopOk ? pickTxSearchRawList(desktopBody.req.data) : [];
    if (desktopRaw.length > 0) {
      return txBuildSearchResult(desktopBody.req.data, desktopRaw, limit);
    }
    console.warn('[LxMusicSdk] TX search: Desktop 接口失败/为空', {
      code: desktopBody?.code, reqCode: desktopBody?.req?.code,
    });
  } catch (e: any) {
    console.warn('[LxMusicSdk] TX search: Desktop 接口异常', e?.message || e);
  }

  // 备用：签名 Mobile 接口（落雪官方链路，未风控环境可用）。
  // 已被风控时恒 2001，不做重试退避——多轮重试只会加剧累积且白等十几秒。
  try {
    const mobileBody = await requestTxSearch(str, page, limit);
    const reqCode = mobileBody?.req?.code;
    const mobileOk = mobileBody?.code === 0 && reqCode === 0;
    const mobileRaw = mobileOk ? pickTxSearchRawList(mobileBody.req.data) : [];
    if (mobileRaw.length > 0) {
      return txBuildSearchResult(mobileBody.req.data, mobileRaw, limit);
    }
    console.warn('[LxMusicSdk] TX search: Mobile 接口失败/为空', {
      code: mobileBody?.code, reqCode,
      bodyKeys: mobileBody?.req?.data?.body ? Object.keys(mobileBody.req.data.body) : null,
      nested: describeTxSearchBody(mobileBody?.req?.data?.body),
    });
  } catch (e: any) {
    console.warn('[LxMusicSdk] TX search: Mobile 接口异常', e?.message || e);
  }

  // 兜底：经典 Web 接口（无签名，独立于 musics.fcg 风控体系）
  console.warn('[LxMusicSdk] TX search: Desktop/Mobile 均失败，走经典 Web 兜底接口');
  return txSearchWebFallback(str, page, limit);
}

/**
 * QQ 专辑搜索（签名 Desktop 接口，search_type=2）。
 * 返回腾讯原始专辑条目（albumID/albumMID/albumName/albumPic/publicTime/singerName），
 * 与 MusicFree QQ 插件 formatAlbumItem 的输入形状一致，供宿主对 QQ 插件的
 * 专辑搜索兜底使用。无签名 musicu.fcg 的搜索全类型（含 type=2）已被间歇风控
 * （reqCode 2001），签名 Desktop 接口独立稳定。
 */
export async function txSearchAlbumsRaw(
  keyword: string,
  page = 1,
  limit = 30,
): Promise<Array<Record<string, any>>> {
  return dispatchFallbackModule('lx_album', 'searchAlbums', { keyword, page, limit },
    () => txSearchAlbumsRawBuiltin(keyword, page, limit));
}

async function txSearchAlbumsRawBuiltin(
  keyword: string,
  page = 1,
  limit = 30,
): Promise<Array<Record<string, any>>> {
  const requestData = {
    comm: {
      _channelid: '0',
      _os_version: '6.2.9200-2',
      ct: '19',
      cv: '2151',
      guid: randomTxDeviceGuid(),
      patch: '118',
      psrf_access_token_expiresAt: 0,
      psrf_qqaccess_token: '',
      psrf_qqopenid: '',
      psrf_qqunionid: '',
      tmeAppID: 'qqmusic',
      tmeLoginType: 0,
      uin: '0',
      wid: randomTxDeviceWid(),
    },
    req: {
      module: 'music.search.SearchCgiService',
      method: 'DoSearchForQQMusicDesktop',
      param: {
        grp: 1,
        num_per_page: limit,
        page_num: page,
        query: keyword,
        remoteplace: 'txt.newclient.top',
        search_type: 2,
        searchid: `${randomTxDeviceGuid()}${String(Math.floor(Math.random() * 100000)).padStart(5, '0')}`,
      },
    },
  };
  const sign = await zzcSign(JSON.stringify(requestData));
  const resp = await httpPostJson(
    `https://u.y.qq.com/cgi-bin/musics.fcg?sign=${sign}`,
    JSON.stringify(requestData),
    {
      'User-Agent': 'QQMusic 14090508(android 12)',
      'Content-Type': 'application/json',
      'Referer': 'https://y.qq.com/',
    },
  );
  // Desktop 响应专辑在 body.album.list（Mobile/无签名接口才是 item_album）
  const list = resp?.req?.data?.body?.album?.list;
  return Array.isArray(list) ? list : [];
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

async function txBatchTrackIntervalBuiltin(
  songIds: Array<string | number>,
): Promise<Map<string, number>> {
  const durationMap = new Map<string, number>();
  const CHUNK_SIZE = 50;
  for (let i = 0; i < songIds.length; i += CHUNK_SIZE) {
    const chunk = songIds.slice(i, i + CHUNK_SIZE);
    const requestData = {
      comm: { ct: '19', cv: '1859', uin: '0' },
      req: {
        module: 'music.trackInfo.UniformRuleCtrl',
        method: 'CgiGetTrackInfo',
        param: { types: chunk.map(() => 1), ids: chunk.map(id => Number(id)), ctx: 0 },
      },
    };
    try {
      const resp = await httpPostJson(
        'https://u.y.qq.com/cgi-bin/musicu.fcg',
        JSON.stringify(requestData),
        {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/106.0.0.0 Safari/537.36',
          'Content-Type': 'application/json',
          'Referer': 'https://y.qq.com/',
          'Cookie': 'uin=',
        },
      );
      const tracks = resp?.req?.data?.tracks;
      if (Array.isArray(tracks)) {
        for (const track of tracks) {
          const interval = Number(track?.interval);
          if (track?.id && interval > 0) durationMap.set(String(track.id), interval);
        }
      }
    } catch { /* 单批失败不影响其余批次 */ }
  }
  return durationMap;
}

// ==================== WY (网易云) Search ====================

async function searchWy(str: string, page = 1, limit = 30, retryNum = 0): Promise<LxSearchResult> {
  if (++retryNum > 3) throw new Error('WY search: try max num');
  const offset = limit * (page - 1);
  const url = `https://music.163.com/api/search/get/web?s=${encodeURIComponent(str)}&type=1&offset=${offset}&limit=${limit}`;
  const result = await httpGetJson(url, {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/69.0.3497.100 Safari/537.36',
    'Referer': 'https://music.163.com',
    'Cookie': 'MUSIC_A=1',
  });
  if (!result || result.code !== 200) {
    console.warn('[LxMusicSdk] WY search failed, code:', result?.code, 'retrying...');
    return searchWy(str, page, limit, retryNum);
  }
  const rawSongs = result.result?.songs || [];
  const list = rawSongs.map((song: any) => {
    const types: LxSearchResultItem['types'] = [];
    const _types: LxSearchResultItem['_types'] = {};
    // 网易云搜索接口多数场景不返回 hq/sq 标志（旧版字段），若仅依赖它们，
    // _types 会只剩 128k，导致底部栏可选项与播放都只有最低档。
    // 网易云歌曲普遍提供 320k 与 flac（无损），在 hq/sq 之外补充声明，
    // 由探测/回退链路实测过滤出真正可用的档位。
    if (song.hq) { types.push({ type: '320k', size: null }); _types['320k'] = { size: null }; }
    if (song.sq) { types.push({ type: 'flac', size: null }); _types.flac = { size: null }; }
    types.push({ type: '128k', size: null }); _types['128k'] = { size: null };
    if (!song.hq) { types.push({ type: '320k', size: null }); _types['320k'] = { size: null }; }
    if (!song.sq) { types.push({ type: 'flac', size: null }); _types.flac = { size: null }; }
    // 高音质档位同样采用声明 + 探测回落策略：网易云黑胶曲库普遍提供 Hi-Res 与超清母带
    types.push({ type: 'flac24bit', size: null }); _types.flac24bit = { size: null };
    types.push({ type: 'master', size: null }); _types.master = { size: null };
    types.reverse();
    const ar = song.artists || [];
    const al = song.album || {};
    // 优先完整 picUrl（网易云返回 http://，统一转 https，避免走后端代理失败导致无封面）；
    // 其次可靠的字符串 picId（大整数 number 会丢精度，neteasePicIdToUrl 会拒绝），
    // 覆盖网易云 album 的 pic / pic_str / picId / picId_str 多种字段名。
    // 都没有则保持 null，交给 triggerCoverLoading → lxGetPic 走 song/detail
    const img =
      (al.picUrl && String(al.picUrl).replace(/^http:\/\//i, 'https://'))
      || neteasePicIdToUrl(al.picId_str || al.pic_str || al.picId || al.pic)
      || null;
    // 网易云搜索接口 artists[].img1v1Url 为歌手头像，提取供歌手搜索页使用；
    // 同时提取 artists[].id，img1v1Url 实为全局占位头像时靠 artistId 补真实头像
    const singerAvatars: Record<string, string> = {};
    const singerIds: Record<string, string> = {};
    for (const s of ar) {
      if (s && s.name && s.img1v1Url) {
        singerAvatars[s.name] = s.img1v1Url;
      }
      if (s && s.name && s.id != null) {
        singerIds[s.name] = String(s.id);
      }
    }
    return {
      singer: ar.map((s: any) => s.name).join('、'),
      name: song.name,
      albumName: al.name || '',
      albumId: al.id || '',
      source: 'wy' as const,
      interval: formatPlayTime((song.duration || 0) / 1000),
      songmid: String(song.id),
      img,
      singerAvatars: Object.keys(singerAvatars).length > 0 ? singerAvatars : undefined,
      singerIds: Object.keys(singerIds).length > 0 ? singerIds : undefined,
      types,
      _types,
    };
  });
  const total = result.result?.songCount || 0;
  return {
    list,
    allPage: Math.ceil(total / limit),
    limit,
    total,
    source: 'wy',
  };
}

// ==================== MG (咪咕) Search ====================

async function mgCreateSignature(time: string, str: string): Promise<{ sign: string; deviceId: string }> {
  return hostMiguSign(str, time);
}

function mgFilterData(rawData: any[][]): LxSearchResultItem[] {
  const list: LxSearchResultItem[] = [];
  const ids = new Set<string>();
  rawData.forEach(item => {
    item.forEach(data => {
      if (!data.songId || !data.copyrightId || ids.has(data.copyrightId)) return;
      ids.add(data.copyrightId);
      const types: LxSearchResultItem['types'] = [];
      const _types: LxSearchResultItem['_types'] = {};
      if (data.audioFormats) {
        data.audioFormats.forEach((type: any) => {
          let size: string | null;
          switch (type.formatType) {
            case 'PQ':
              size = sizeFormate(type.asize ?? type.isize);
              types.push({ type: '128k', size });
              _types['128k'] = { size };
              break;
            case 'HQ':
              size = sizeFormate(type.asize ?? type.isize);
              types.push({ type: '320k', size });
              _types['320k'] = { size };
              break;
            case 'SQ':
              size = sizeFormate(type.asize ?? type.isize);
              types.push({ type: 'flac', size });
              _types.flac = { size };
              break;
            case 'ZQ24':
              size = sizeFormate(type.asize ?? type.isize);
              types.push({ type: 'flac24bit', size });
              _types.flac24bit = { size };
              break;
          }
        });
      }
      let img: string | null = data.img3 || data.img2 || data.img1 || null;
      if (img && !/https?:/.test(img)) img = 'http://d.musicapp.migu.cn' + img;
      list.push({
        singer: formatSingerName(data.singerList),
        name: data.name,
        albumName: data.album,
        albumId: data.albumId,
        songmid: data.songId,
        copyrightId: data.copyrightId,
        source: 'mg',
        interval: formatPlayTime(data.duration),
        img,
        lrcUrl: data.lrcUrl,
        mrcUrl: data.mrcurl,
        trcUrl: data.trcUrl,
        types,
        _types,
      });
    });
  });
  return list;
}

async function searchMg(str: string, page = 1, limit = 20, retryNum = 0): Promise<LxSearchResult> {
  if (++retryNum > 3) throw new Error('MG search: try max num');
  const time = Date.now().toString();
  const signData = await mgCreateSignature(time, str);
  const url = `https://jadeite.migu.cn/music_search/v3/search/searchAll?isCorrect=0&isCopyright=1&searchSwitch=%7B%22song%22%3A1%2C%22album%22%3A0%2C%22singer%22%3A0%2C%22tagSong%22%3A1%2C%22mvSong%22%3A0%2C%22bestShow%22%3A1%2C%22songlist%22%3A0%2C%22lyricSong%22%3A0%7D&pageSize=${limit}&text=${encodeURIComponent(str)}&pageNo=${page}&sort=0&sid=USS`;
  const result = await httpGetJson(url, {
    uiVersion: 'A_music_3.6.1',
    deviceId: signData.deviceId,
    timestamp: time,
    sign: signData.sign,
    channel: '0146921',
    'User-Agent': 'Mozilla/5.0 (Linux; U; Android 11.0.0; zh-cn; MI 11 Build/OPR1.170623.032) AppleWebKit/534.30 (KHTML, like Gecko) Version/4.0 Mobile Safari/534.30',
  });
  if (!result || result.code !== '000000') throw new Error(result ? result.info : 'MG搜索失败');
  const songResultData = result.songResultData || { resultList: [], totalCount: 0 };
  const list = mgFilterData(songResultData.resultList);
  if (list == null) return searchMg(str, page, limit, retryNum);
  const total = parseInt(songResultData.totalCount);
  return {
    list,
    allPage: Math.ceil(total / limit),
    limit,
    total,
    source: 'mg',
  };
}

// ==================== Catalog Search ====================

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

function firstValue(item: any, keys: string[]): any {
  for (const key of keys) {
    const value = item?.[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
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

// ==================== LX 歌单搜索 Web 兜底 ====================

/**
 * TX 歌单搜索兜底：无签名 Desktop 通道（musicu.fcg DoSearchForQQMusicDesktop，
 * search_type=3 → req.data.body.songlist.list，字段 dissid/dissname/imgurl/
 * song_count/listennum/creator.name）。
 * 客户端签名(Mobile)通道被风控降级返回空时使用，实测无 sign 也稳定可用；
 * 经典 t=3 client_search_cp 接口已死（data 仅剩 zhida/taglist 空结构，不再返回歌单）。
 */
async function txSheetSearchDesktopFallback(keyword: string, page = 1, limit = 30): Promise<any[]> {
  const body = {
    comm: { ct: 19, cv: 1859, uin: '0' },
    req: {
      module: 'music.search.SearchCgiService',
      method: 'DoSearchForQQMusicDesktop',
      param: {
        search_type: 3,
        query: keyword,
        page_num: page,
        num_per_page: limit,
      },
    },
  };
  const data = await httpPostJson(
    'https://u.y.qq.com/cgi-bin/musicu.fcg',
    JSON.stringify(body),
    {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
      'Content-Type': 'application/json',
      Referer: 'https://y.qq.com/',
    },
  );
  const list = data?.req?.data?.body?.songlist?.list;
  if (!Array.isArray(list) || list.length === 0) {
    console.warn('[LxMusicSdk] TX 歌单 Desktop 兜底无结果');
    throw new Error('TX sheet desktop fallback: 无有效歌单');
  }
  return list;
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
