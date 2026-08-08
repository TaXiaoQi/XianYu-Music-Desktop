import {
  buildKuwoAlbumCoverUrl,
  neteasePicIdToUrl,
  normalizeKuwoCoverUrl,
} from '../utils/coverUrl';
import { decodeName, formatSingerName } from '../utils/musicFormat';
import { tauriInvoke } from './tauri/invoke';
import type { LxUrlSongInfoContract } from './tauri/contracts';

/**
 * 将 LxSearchResultItem 转换为 Rust URL 解析器所需的合约类型
 */
export function toUrlSongInfo(item: LxSearchResultItem): LxUrlSongInfoContract {
  return {
    songmid: item.songmid,
    source: item.source,
    hash: item.hash,
    name: item.name,
    singer: item.singer,
    albumName: item.albumName,
    albumId: item.albumId,
    albumMid: item.albumMid,
    copyrightId: item.copyrightId,
    strMediaMid: item.strMediaMid,
    songId: item.songId,
    _types: item._types as Record<string, { size?: string | null; hash?: string }> | undefined,
  };
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
  types: { type: string; size: string | null; hash?: string }[];
  _types: Record<string, { size: string | null; hash?: string }>;
  // source-specific fields
  hash?: string; // kg
  strMediaMid?: string; // tx
  songId?: number; // tx
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
  return tauriInvoke('plugin_http_request', {
    method: options.method || 'GET',
    url,
    headers: options.headers || null,
    body: options.body || null,
  });
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

// ==================== Crypto: MD5 ====================

function md5(input: string): string {
  function safeAdd(x: number, y: number): number {
    const lsw = (x & 0xffff) + (y & 0xffff);
    const msw = (x >> 16) + (y >> 16) + (lsw >> 16);
    return (msw << 16) | (lsw & 0xffff);
  }
  function bitRotateLeft(num: number, cnt: number): number {
    return (num << cnt) | (num >>> (32 - cnt));
  }
  function md5cmn(q: number, a: number, b: number, x: number, s: number, t: number): number {
    return safeAdd(bitRotateLeft(safeAdd(safeAdd(a, q), safeAdd(x, t)), s), b);
  }
  function md5ff(a: number, b: number, c: number, d: number, x: number, s: number, t: number): number {
    return md5cmn((b & c) | (~b & d), a, b, x, s, t);
  }
  function md5gg(a: number, b: number, c: number, d: number, x: number, s: number, t: number): number {
    return md5cmn((b & d) | (c & ~d), a, b, x, s, t);
  }
  function md5hh(a: number, b: number, c: number, d: number, x: number, s: number, t: number): number {
    return md5cmn(b ^ c ^ d, a, b, x, s, t);
  }
  function md5ii(a: number, b: number, c: number, d: number, x: number, s: number, t: number): number {
    return md5cmn(c ^ (b | ~d), a, b, x, s, t);
  }
  function binlMD5(x: number[], len: number): number[] {
    x[len >> 5] |= 0x80 << (len % 32);
    x[(((len + 64) >>> 9) << 4) + 14] = len;
    let a = 1732584193, b = -271733879, c = -1732584194, d = 271733878;
    for (let i = 0; i < x.length; i += 16) {
      const olda = a, oldb = b, oldc = c, oldd = d;
      a = md5ff(a, b, c, d, x[i],      7, -680876936);
      d = md5ff(d, a, b, c, x[i + 1], 12, -389564586);
      c = md5ff(c, d, a, b, x[i + 2], 17,  606105819);
      b = md5ff(b, c, d, a, x[i + 3], 22, -1044525330);
      a = md5ff(a, b, c, d, x[i + 4],  7, -176418897);
      d = md5ff(d, a, b, c, x[i + 5], 12,  1200080426);
      c = md5ff(c, d, a, b, x[i + 6], 17, -1473231341);
      b = md5ff(b, c, d, a, x[i + 7], 22, -45705983);
      a = md5ff(a, b, c, d, x[i + 8],  7,  1770035416);
      d = md5ff(d, a, b, c, x[i + 9], 12, -1958414417);
      c = md5ff(c, d, a, b, x[i + 10],17, -42063);
      b = md5ff(b, c, d, a, x[i + 11],22, -1990404162);
      a = md5ff(a, b, c, d, x[i + 12], 7,  1804603682);
      d = md5ff(d, a, b, c, x[i + 13],12, -40341101);
      c = md5ff(c, d, a, b, x[i + 14],17, -1502002290);
      b = md5ff(b, c, d, a, x[i + 15],22,  1236535329);
      a = md5gg(a, b, c, d, x[i + 1],  5, -165796510);
      d = md5gg(d, a, b, c, x[i + 6],  9, -1069501632);
      c = md5gg(c, d, a, b, x[i + 11],14,  643717713);
      b = md5gg(b, c, d, a, x[i],      20, -373897302);
      a = md5gg(a, b, c, d, x[i + 5],  5, -701558691);
      d = md5gg(d, a, b, c, x[i + 10], 9,  38016083);
      c = md5gg(c, d, a, b, x[i + 15],14, -660478335);
      b = md5gg(b, c, d, a, x[i + 4], 20, -405537848);
      a = md5gg(a, b, c, d, x[i + 9],  5,  568446438);
      d = md5gg(d, a, b, c, x[i + 14], 9, -1019803690);
      c = md5gg(c, d, a, b, x[i + 3], 14, -187363961);
      b = md5gg(b, c, d, a, x[i + 8], 20,  1163531501);
      a = md5gg(a, b, c, d, x[i + 13], 5, -1444681467);
      d = md5gg(d, a, b, c, x[i + 2],  9, -51403784);
      c = md5gg(c, d, a, b, x[i + 7], 14,  1735328473);
      b = md5gg(b, c, d, a, x[i + 12],20, -1926607734);
      a = md5hh(a, b, c, d, x[i + 5],  4, -378558);
      d = md5hh(d, a, b, c, x[i + 8], 11, -2022574463);
      c = md5hh(c, d, a, b, x[i + 11],16,  1839030562);
      b = md5hh(b, c, d, a, x[i + 14],23, -35309556);
      a = md5hh(a, b, c, d, x[i + 1],  4, -1530992060);
      d = md5hh(d, a, b, c, x[i + 4], 11,  1272893353);
      c = md5hh(c, d, a, b, x[i + 7], 16, -155497632);
      b = md5hh(b, c, d, a, x[i + 10],23, -1094730640);
      a = md5hh(a, b, c, d, x[i + 13], 4,  681279174);
      d = md5hh(d, a, b, c, x[i],      11, -358537222);
      c = md5hh(c, d, a, b, x[i + 3], 16, -722521979);
      b = md5hh(b, c, d, a, x[i + 6], 23,  76029189);
      a = md5hh(a, b, c, d, x[i + 9],  4, -640364487);
      d = md5hh(d, a, b, c, x[i + 12],11, -421815835);
      c = md5hh(c, d, a, b, x[i + 15],16,  530742520);
      b = md5hh(b, c, d, a, x[i + 2], 23, -995338651);
      a = md5ii(a, b, c, d, x[i],      6, -198630844);
      d = md5ii(d, a, b, c, x[i + 7], 10,  1126891415);
      c = md5ii(c, d, a, b, x[i + 14],15, -1416354905);
      b = md5ii(b, c, d, a, x[i + 5], 21, -57434055);
      a = md5ii(a, b, c, d, x[i + 12], 6,  1700485571);
      d = md5ii(d, a, b, c, x[i + 3], 10, -1894986606);
      c = md5ii(c, d, a, b, x[i + 10],15, -1051523);
      b = md5ii(b, c, d, a, x[i + 1], 21, -2054922799);
      a = md5ii(a, b, c, d, x[i + 8],  6,  1873313359);
      d = md5ii(d, a, b, c, x[i + 15],10, -30611744);
      c = md5ii(c, d, a, b, x[i + 6], 15, -1560198380);
      b = md5ii(b, c, d, a, x[i + 13],21,  1309151649);
      a = md5ii(a, b, c, d, x[i + 4],  6, -145523070);
      d = md5ii(d, a, b, c, x[i + 11],10, -1120210379);
      c = md5ii(c, d, a, b, x[i + 2], 15,  718787259);
      b = md5ii(b, c, d, a, x[i + 9], 21, -343485551);
      a = safeAdd(a, olda); b = safeAdd(b, oldb); c = safeAdd(c, oldc); d = safeAdd(d, oldd);
    }
    return [a, b, c, d];
  }
  function binl2rstr(input: number[]): string {
    let output = '';
    for (let i = 0; i < input.length * 32; i += 8) {
      output += String.fromCharCode((input[i >> 5] >>> (i % 32)) & 0xff);
    }
    return output;
  }
  function rstr2binl(input: string): number[] {
    const output: number[] = [];
    for (let i = 0; i < input.length * 8; i += 32) { output[i >> 5] = 0; }
    for (let i = 0; i < input.length * 8; i += 8) {
      output[i >> 5] |= (input.charCodeAt(i / 8) & 0xff) << (i % 32);
    }
    return output;
  }
  function rstrMD5(s: string): string {
    return binl2rstr(binlMD5(rstr2binl(s), s.length * 8));
  }
  function rstr2hex(input: string): string {
    const hexTab = '0123456789abcdef';
    let output = '';
    for (let i = 0; i < input.length; i++) {
      const x = input.charCodeAt(i);
      output += hexTab.charAt((x >>> 4) & 0x0f) + hexTab.charAt(x & 0x0f);
    }
    return output;
  }
  const utf8 = unescape(encodeURIComponent(input));
  return rstr2hex(rstrMD5(utf8));
}

// ==================== Crypto: SHA1 (Web Crypto API) ====================

async function sha1(text: string): Promise<string> {
  const buffer = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-1', buffer);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ==================== TX (QQ音乐) Signing ====================

const TX_PART_1_INDEXES = [23, 14, 6, 36, 16, 40, 7, 19];
const TX_PART_2_INDEXES = [16, 1, 32, 12, 19, 27, 8, 5];
const TX_SCRAMBLE_VALUES = [89, 39, 179, 150, 218, 82, 58, 252, 177, 52, 186, 123, 120, 64, 242, 133, 143, 161, 121, 179];

function pickHashByIdx(hash: string, indexes: number[]): string {
  return indexes.map(idx => hash[idx]).join('');
}

async function zzcSign(text: string): Promise<string> {
  const hash = await sha1(text);
  const part1 = pickHashByIdx(hash, TX_PART_1_INDEXES);
  const part2 = pickHashByIdx(hash, TX_PART_2_INDEXES);
  const part3 = TX_SCRAMBLE_VALUES.map((value, i) => value ^ parseInt(hash.slice(i * 2, i * 2 + 2), 16));
  const b64Part = btoa(String.fromCharCode(...part3)).replace(/[\\/+=]/g, '');
  return `zzc${part1}${b64Part}${part2}`.toLowerCase();
}

// ==================== KW (酷我) Search ====================

const KW_MINFO_REGEX = /level:(\w+),bitrate:(\d+),format:(\w+),size:([\w.]+)/;

function kwHandleResult(rawData: any[]): LxSearchResultItem[] | null {
  const result: LxSearchResultItem[] = [];
  if (!rawData) return result;
  for (let i = 0; i < rawData.length; i++) {
    const info = rawData[i];
    const songId = info.MUSICRID.replace('MUSIC_', '');
    if (!info.N_MINFO) {
      console.log('[LxMusicSdk] KW: N_MINFO is undefined');
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
    // 搜索结果自带 web_albumpic_short，直接拼封面，避免再请求 artistpicserver
    const imgFromSearch = buildKuwoAlbumCoverUrl(info.web_albumpic_short) || null;
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
  rawList.forEach(item => {
    // 放宽过滤：仅要求 mid 或 id 存在即可（与 playlistImport.ts 的 parseTxSong 对齐）。
    // 原 media_mid 非空过滤过严：QQ 音乐响应中 file/media_mid 可能为空或缺失，
    // 导致搜索结果被全部静默过滤 → 列表为空（小秋搜索无法加载歌曲列表的根因）。
    if (!item.mid && !item.id) return;
    const types: LxSearchResultItem['types'] = [];
    const _types: LxSearchResultItem['_types'] = {};
    const file = item.file || {};
    if (file.size_128mp3 != 0) {
      const size = sizeFormate(file.size_128mp3);
      types.push({ type: '128k', size });
      _types['128k'] = { size };
    }
    if (file.size_320mp3 !== 0) {
      const size = sizeFormate(file.size_320mp3);
      types.push({ type: '320k', size });
      _types['320k'] = { size };
    }
    if (file.size_flac !== 0) {
      const size = sizeFormate(file.size_flac);
      types.push({ type: 'flac', size });
      _types.flac = { size };
    }
    if (file.size_hires !== 0) {
      const size = sizeFormate(file.size_hires);
      types.push({ type: 'flac24bit', size });
      _types.flac24bit = { size };
    }
    let albumId = '';
    let albumName = '';
    if (item.album) {
      albumName = item.album.name;
      albumId = item.album.mid;
    }
    list.push({
      singer: formatSingerName(item.singer, 'name'),
      name: item.title,
      albumName,
      albumId,
      source: 'tx',
      interval: formatPlayTime(item.interval),
      songId: item.id,
      albumMid: item.album?.mid ?? '',
      strMediaMid: file.media_mid ?? '',
      songmid: item.mid,
      img: (albumId === '' || albumId === '空')
        ? (item.singer?.length && item.singer[0].mid ? `https://y.gtimg.cn/music/photo_new/T001R500x500M000${item.singer[0].mid}.jpg` : null)
        : `https://y.gtimg.cn/music/photo_new/T002R500x500M000${albumId}.jpg`,
      types,
      _types,
    });
  });
  return list;
}

async function searchTx(str: string, page = 1, limit = 50, retryNum = 0): Promise<LxSearchResult> {
  if (retryNum > 5) throw new Error('TX search: 搜索失败');
  const requestData = {
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
  const sign = await zzcSign(JSON.stringify(requestData));
  const url = `https://u.y.qq.com/cgi-bin/musics.fcg?sign=${sign}`;
  const body = await httpPostJson(url, JSON.stringify(requestData), {
    'User-Agent': 'QQMusic 14090508(android 12)',
    'Content-Type': 'application/json',
  });
  if (!body || !body.req || body.code != 0 || body.req.code != 0) {
    console.warn('[LxMusicSdk] TX search API error', { bodyCode: body?.code, reqCode: body?.req?.code });
    return searchTx(str, page, limit, ++retryNum);
  }
  const data = body.req.data;
  const rawList = data?.body?.item_song;
  if (!Array.isArray(rawList) || rawList.length === 0) {
    console.warn('[LxMusicSdk] TX search: item_song missing/empty, data keys:', data ? Object.keys(data) : null);
  }
  const list = txHandleResult(rawList);
  if (list.length === 0 && Array.isArray(rawList) && rawList.length > 0) {
    console.warn(`[LxMusicSdk] TX search: all ${rawList.length} items filtered out, sample:`, JSON.stringify(rawList[0]).slice(0, 300));
  }
  const total = data.meta?.estimate_sum ?? 0;
  return {
    list,
    allPage: Math.ceil(total / limit),
    limit,
    total,
    source: 'tx',
  };
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
    if (song.hq) { types.push({ type: '320k', size: null }); _types['320k'] = { size: null }; }
    if (song.sq) { types.push({ type: 'flac', size: null }); _types.flac = { size: null }; }
    types.push({ type: '128k', size: null }); _types['128k'] = { size: null };
    types.reverse();
    const ar = song.artists || [];
    const al = song.album || {};
    // 优先 picUrl；其次可靠的 picId_str（大整数 number 会丢精度，neteasePicIdToUrl 会拒绝）
    // 都没有则保持 null，交给 triggerCoverLoading → lxGetPic 走 song/detail
    const img =
      al.picUrl
      || neteasePicIdToUrl(al.picId_str || al.pic_str || al.picId)
      || null;
    // 网易云搜索接口 artists[].img1v1Url 为歌手头像，提取供歌手搜索页使用
    const singerAvatars: Record<string, string> = {};
    for (const s of ar) {
      if (s && s.name && s.img1v1Url) {
        singerAvatars[s.name] = s.img1v1Url;
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

function mgCreateSignature(time: string, str: string): { sign: string; deviceId: string } {
  const deviceId = '963B7AA0D21511ED807EE5846EC87D20';
  const signatureMd5 = '6cdc72a439cef99a3418d2a78aa28c73';
  const sign = md5(`${str}${signatureMd5}yyapp2d16148780a1dcc7408e06336b98cfd50${deviceId}${time}`);
  return { sign, deviceId };
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
  const signData = mgCreateSignature(time, str);
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
        // 保存 source/songmid 供 lxCatalogSearch 异步补充头像（kw 源搜索结果无图片）
        rawData: { source: song.source, name, songmid: song.songmid },
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
      rawData: { source: song.source, id, name, artist: song.singer },
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
    let coverUrl = String(firstValue(raw, ['coverUrl', 'coverImgUrl', 'img', 'imgurl', 'pic', 'picUrl', 'PIC']) || '');
    if (coverUrl.startsWith('//')) coverUrl = `https:${coverUrl}`;
    else if (coverUrl.startsWith('http://')) coverUrl = coverUrl.replace('http://', 'https://');
    results.push({
      id: `${source}:playlist:${id}`,
      title: decodeName(String(titleValue).replace(/<[^>]*>/g, '')),
      coverUrl,
      artist: String(firstValue(raw, ['artist', 'author', 'nickname', 'uname', 'UNAME']) || creator?.name || creator?.nickname || ''),
      trackCount: Number(firstValue(raw, ['trackCount', 'trackcount', 'songCount', 'song_count', 'songnum', 'SONGNUM'])) || undefined,
      playCount: Number(firstValue(raw, ['playCount', 'playcount', 'play_count', 'listennum', 'LISTENNUM'])) || undefined,
      rawData: raw,
    });
  }

  return results;
}

async function searchLxPlaylists(source: LxSourceId, keyword: string, page: number, limit: number): Promise<LxPlaylistSearchResult[]> {
  if (source === 'kw') {
    // 优先用新 API，回退到旧 API
    try {
      const data = await httpGetJson(`http://www.kuwo.cn/api/www/search/searchPlayListBykeyWord?key=${encodeURIComponent(keyword)}&pn=${page}&rn=${limit}`, {
        csrf: 'ABCDEF',
        Cookie: 'kw_token=ABCDEF',
        Referer: 'http://www.kuwo.cn/',
      });
      const list = data?.data?.list || data?.data || [];
      if (Array.isArray(list) && list.length > 0) {
        return normalizeLxPlaylistResults(source, list);
      }
    } catch { /* 回退到旧 API */ }
    const data = await httpGetJson(`http://search.kuwo.cn/r.s?client=kt&all=${encodeURIComponent(keyword)}&pn=${page - 1}&rn=${limit}&ft=playlist&encoding=utf8&rformat=json`);
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
      comm: { ct: '11', cv: '14090508', v: '14090508', tmeAppID: 'qqmusic' },
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
    const sign = await zzcSign(JSON.stringify(requestData));
    const data = await httpPostJson(
      `https://u.y.qq.com/cgi-bin/musics.fcg?sign=${sign}`,
      JSON.stringify(requestData),
      { 'User-Agent': 'QQMusic 14090508(android 12)', 'Content-Type': 'application/json' },
    );
    const body = data?.req?.data?.body;
    return normalizeLxPlaylistResults(source, body?.item_songlist || body?.songlist?.list || body?.songlist || []);
  }

  const time = Date.now().toString();
  const signData = mgCreateSignature(time, keyword);
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
  if (type !== 'artist') return deriveLxAlbumResults(result.list);
  const artists = deriveLxArtistResults(result.list);
  // kw 源搜索结果无图片字段，用 songmid 调 artistpicserver 异步获取封面作为歌手头像
  if (source === 'kw') {
    await fillKwArtistAvatars(artists);
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

// ==================== Main Export ====================

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
        const requestData = {
          comm: { ct: '24', cv: '0' },
          req: {
            module: 'music.musichallSong.PlaySingerSongs',
            method: 'GetAlbumSongList',
            param: { albumMid: albumId, songBegin: (page - 1) * limit, songNum: limit },
          },
        };
        const sign = await zzcSign(JSON.stringify(requestData));
        const resp = await httpPostJson(
          `https://u.y.qq.com/cgi-bin/musics.fcg?sign=${sign}`,
          JSON.stringify(requestData),
          { 'User-Agent': 'QQMusic 14090508(android 12)', 'Content-Type': 'application/json' },
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
        const sign = await zzcSign(JSON.stringify(requestData));
        const resp = await httpPostJson(
          `https://u.y.qq.com/cgi-bin/musics.fcg?sign=${sign}`,
          JSON.stringify(requestData),
          { 'User-Agent': 'QQMusic 14090508(android 12)', 'Content-Type': 'application/json' },
        );
        const songlist: any[] = resp?.req?.data?.songlist || [];
        if (songlist.length === 0) console.warn(`[LxMusicSdk] TX playlist ${playlistId}: empty songlist`);
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
    const result = await tauriInvoke('get_lx_cover', {
      songInfo: toUrlSongInfo(songInfo),
    });
    return result ?? null;
  } catch (e: any) {
    console.warn(`[LxMusicSdk] getLxCover failed: ${e?.message || e}`);
    return null;
  }
}

// Note: LX 音乐 URL 解析已统一到 lxUrlResolver.ts（resolveLxUrl），
// 旧函数 lxGetMusicUrl 已删除。如需单次解析请使用 resolveLxUrl / resolveLxUrlViaRust。
