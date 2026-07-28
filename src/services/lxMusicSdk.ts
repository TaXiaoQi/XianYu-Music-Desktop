import { invoke } from '@tauri-apps/api/core';

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

function decodeName(str: string | undefined | null): string {
  if (!str) return '';
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function formatSingerName(singers: any[] | string | null | undefined, nameKey = 'name', join = '、'): string {
  if (Array.isArray(singers)) {
    const names: string[] = [];
    singers.forEach(item => {
      const name = item[nameKey];
      if (name) names.push(name);
    });
    return decodeName(names.join(join));
  }
  return decodeName(String(singers ?? ''));
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
  return invoke<HttpResponse>('plugin_http_request', {
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
    result.push({
      name: decodeName(info.SONGNAME),
      singer: decodeName(info.ARTIST).replace(/&/g, '、'),
      source: 'kw',
      songmid: songId,
      albumId: decodeName(info.ALBUMID || ''),
      interval: Number.isNaN(interval) ? '00:00' : formatPlayTime(interval),
      albumName: info.ALBUM ? decodeName(info.ALBUM) : '',
      img: null,
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
  return {
    singer: decodeName(formatSingerName(rawData.Singers, 'name')),
    name: decodeName(rawData.SongName),
    albumName: decodeName(rawData.AlbumName),
    albumId: rawData.AlbumID,
    songmid: rawData.Audioid,
    source: 'kg',
    interval: formatPlayTime(rawData.Duration),
    img: null,
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
    if (!item.file?.media_mid) return;
    const types: LxSearchResultItem['types'] = [];
    const _types: LxSearchResultItem['_types'] = {};
    const file = item.file;
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
      strMediaMid: item.file.media_mid,
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
    return searchTx(str, page, limit, ++retryNum);
  }
  const data = body.req.data;
  const list = txHandleResult(data.body?.item_song);
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
    return {
      singer: ar.map((s: any) => s.name).join('、'),
      name: song.name,
      albumName: al.name || '',
      albumId: al.id || '',
      source: 'wy' as const,
      interval: formatPlayTime((song.duration || 0) / 1000),
      songmid: String(song.id),
      img: al.picUrl || null,
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

/** Reverse mapping: display name -> source id */
export const LX_NAME_TO_SOURCE: Record<string, LxSourceId> = {
  '小蜗音乐': 'kw',
  '小枸音乐': 'kg',
  '小秋音乐': 'tx',
  '小芸音乐': 'wy',
  '小蜜音乐': 'mg',
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

// ==================== Get Cover Picture ====================

/**
 * 获取落雪 LX 音源的封面图片 URL
 * kw/kg 搜索结果 img=null，需要延迟获取
 */
export async function lxGetPic(songInfo: LxSearchResultItem): Promise<string | null> {
  const source = songInfo.source;

  // 如果搜索结果已有封面，直接返回
  if (songInfo.img) return songInfo.img;

  switch (source) {
    case 'kw': {
      try {
        const resp = await httpFetch(
          `http://artistpicserver.kuwo.cn/pic.web?corp=kuwo&type=rid_pic&pictype=500&size=500&rid=${songInfo.songmid}`,
          { method: 'GET' },
        );
        if (resp.status === 200 && /^http/.test(resp.body?.trim())) {
          return resp.body.trim().replace('https://', 'http://');
        }
      } catch { /* ignore */ }
      return null;
    }

    case 'kg': {
      try {
        const hash = songInfo._types['128k']?.hash || songInfo.hash || '';
        const albumId = songInfo.albumId || 0;
        const body = JSON.stringify({
          appid: 1001, area_code: '1', behavior: 'play', clientver: '9020',
          need_hash_offset: 1, relate: 1,
          resource: [{ album_audio_id: 0, album_id: albumId, hash, id: 0, name: songInfo.name, type: 'audio' }],
          token: '', userid: 2626431536, vip: 1,
        });
        const resp = await httpPostJson(
          'http://media.store.kugou.com/v1/get_res_privilege',
          body,
          {
            'KG-RC': '1',
            'KG-THash': 'expand_search_manager.cpp:852736169:451',
            'User-Agent': 'KuGou2012-9020-ExpandSearchManager',
            'Content-Type': 'application/json',
          },
        );
        if (resp?.error_code === 0 && resp.data?.[0]?.info) {
          const info = resp.data[0].info;
          const img = info.imgsize
            ? info.image.replace('{size}', info.imgsize[0])
            : info.image;
          return img || null;
        }
      } catch { /* ignore */ }
      return null;
    }

    case 'tx': {
      const albumId = songInfo.albumMid || songInfo.albumId;
      if (albumId) {
        return `https://y.gtimg.cn/music/photo_new/T002R500x500M000${albumId}.jpg`;
      }
      return null;
    }

    case 'wy': {
      try {
        const resp = await httpFetch(
          `https://music.163.com/api/song/detail/?id=${songInfo.songmid}&ids=%5B${songInfo.songmid}%5D`,
          { method: 'GET', headers: { 'Referer': 'https://music.163.com', 'Cookie': 'MUSIC_A=1' } },
        );
        if (resp.status === 200) {
          const body = JSON.parse(resp.body);
          const picUrl = body?.songs?.[0]?.album?.picUrl;
          if (picUrl) return picUrl;
        }
      } catch { /* ignore */ }
      return null;
    }

    case 'mg': {
      return null;
    }

    default:
      return null;
  }
}

// ==================== Get Music URL ====================

/**
 * 获取落雪 LX 音源的实际播放 URL
 * 使用公共 API 代理服务解析音频链接，与 lx-music-desktop 的 api-test.js 一致
 */
export async function lxGetMusicUrl(
  songInfo: LxSearchResultItem,
  type: string = '320k',
): Promise<{ type: string; url: string }> {
  const source = songInfo.source;
  let id: string;

  // 各音源使用不同的标识符（与 lx-music-desktop api-test.js 一致）
  switch (source) {
    case 'kw':
    case 'tx':
    case 'wy':
      id = songInfo.songmid;
      break;
    case 'kg':
      // KG 使用 hash 而非 songmid
      id = songInfo._types[type]?.hash || songInfo.hash || songInfo.songmid;
      break;
    case 'mg':
      // MG 使用 copyrightId 而非 songmid
      id = songInfo.copyrightId || songInfo.songmid;
      break;
    default:
      throw new Error(`Unsupported source: ${source}`);
  }

  const url = `https://lxmusicapi.onrender.com/url/${source}/${id}/${type}`;
  console.log(`[LxMusicSdk] getMusicUrl: ${url}`);

  try {
    const resp = await httpFetch(url, {
      method: 'GET',
      headers: { 'User-Agent': 'lx-music request' },
    });
    if (resp.status === 429) throw new Error('请求过于频繁，请稍后再试');
    const body = JSON.parse(resp.body);
    if (body.code === 0 && body.data) {
      return { type, url: body.data };
    }
    throw new Error(body.msg || `获取播放链接失败 (code=${body.code})`);
  } catch (e: any) {
    // 备用 API
    console.warn(`[LxMusicSdk] 主API失败，尝试备用: ${e.message}`);
    const fallbackUrl = `http://ts.tempmusics.tk/url/${source}/${id}/${type}`;
    try {
      const resp2 = await httpFetch(fallbackUrl, {
        method: 'GET',
        headers: { 'User-Agent': 'lx-music request' },
      });
      if (resp2.status === 429) throw new Error('请求过于频繁，请稍后再试');
      const body2 = JSON.parse(resp2.body);
      if (body2.code === 0 && body2.data) {
        return { type, url: body2.data };
      }
      throw new Error(body2.msg || `获取播放链接失败 (code=${body2.code})`);
    } catch (e2: any) {
      throw new Error(`获取播放链接失败: ${e2.message}`);
    }
  }
}

// ==================== Get Lyrics ====================

/**
 * 通过公共 LX API 获取歌词
 */
export async function lxGetLyric(songInfo: LxSearchResultItem): Promise<{ lyric: string; tlyric: string | null } | null> {
  const source = songInfo.source;
  let id: string;

  switch (source) {
    case 'kw':
    case 'tx':
    case 'wy':
      id = songInfo.songmid;
      break;
    case 'kg':
      id = songInfo.hash || songInfo.songmid;
      break;
    case 'mg':
      id = songInfo.copyrightId || songInfo.songmid;
      break;
    default:
      return null;
  }

  const url = `https://lxmusicapi.onrender.com/lrc/${source}/${id}`;
  console.log(`[LxMusicSdk] getLyric: ${url}`);

  try {
    const resp = await httpFetch(url, {
      method: 'GET',
      headers: { 'User-Agent': 'lx-music request' },
    });
    if (resp.status === 429) throw new Error('请求过于频繁');
    const body = JSON.parse(resp.body);
    if (body.code === 0 && body.data) {
      const data = body.data;
      return {
        lyric: data.lyric || data.lrc || '',
        tlyric: data.tlyric || data.translate || null,
      };
    }
    return null;
  } catch (e: any) {
    console.warn(`[LxMusicSdk] 歌词主API失败，尝试备用: ${e.message}`);
    const fallbackUrl = `http://ts.tempmusics.tk/lrc/${source}/${id}`;
    try {
      const resp2 = await httpFetch(fallbackUrl, {
        method: 'GET',
        headers: { 'User-Agent': 'lx-music request' },
      });
      if (resp2.status === 429) throw new Error('请求过于频繁');
      const body2 = JSON.parse(resp2.body);
      if (body2.code === 0 && body2.data) {
        const data = body2.data;
        return {
          lyric: data.lyric || data.lrc || '',
          tlyric: data.tlyric || data.translate || null,
        };
      }
      return null;
    } catch {
      return null;
    }
  }
}
