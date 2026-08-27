import {
  buildKuwoAlbumCoverUrl,
  neteasePicIdToUrl,
  normalizeKuwoCoverUrl,
} from '../../utils/coverUrl';
import { decodeName, formatSingerName } from '../../utils/musicFormat';
import { hostMiguSign } from '../tauri/hostCryptoApi';
import {
  firstValue,
  formatPlayTime,
  httpGetJson,
  httpPostJson,
  sizeFormate,
  zzcSign,
  type LxSearchResult,
  type LxSearchResultItem,
} from './lxMusicSdkBase';

/**
 * LX 平台搜索层：kw / kg / tx / wy / mg 五音源的搜索实现、TX 专辑/时长内置
 * 与歌单 Web 兜底。仅依赖 lxMusicSdkBase，作为叶子模块被 lxMusicSdk 门面消费。
 */

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

export function kgFilterData(rawData: any): LxSearchResultItem {
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

function kgItemQualityScore(item: LxSearchResultItem): number {
  // 音质档位权重：128k < 320k < flac < flac24bit。同一首歌的多个专辑版本里，
  // 保留最高音质档的那条，避免去重后留下低码率版本。
  const rank: Record<string, number> = { '128k': 1, '320k': 2, flac: 3, flac24bit: 4 };
  let score = 0;
  for (const t of item?.types || []) {
    if (t && rank[t.type]) score = Math.max(score, rank[t.type]);
  }
  return score;
}

function kgNormalKey(name: string): string {
  return (name || '').trim().toLowerCase().replace(/\s+/g, '');
}

function kgHandleResult(rawData: any[]): LxSearchResultItem[] {
  const rawList: LxSearchResultItem[] = [];
  rawData.forEach(item => {
    rawList.push(kgFilterData(item));
    if (item.Grp) {
      for (const childItem of item.Grp) rawList.push(kgFilterData(childItem));
    }
  });
  // 酷狗搜索常把同一首歌按不同专辑版本重复返回（同名同歌手、仅专辑不同），
  // 连带 Grp 一起展开后会出现成批重名的歌。这里按「歌名+歌手」去重并保留最高
  // 音质档的那条，既消除批量同名，又不误伤同名但不同歌手的歌曲。
  const best = new Map<string, LxSearchResultItem>();
  for (const item of rawList) {
    const key = `${kgNormalKey(item.name)}|${kgNormalKey(item.singer)}`;
    if (!kgNormalKey(item.name)) continue;
    const prev = best.get(key);
    if (!prev || kgItemQualityScore(item) >= kgItemQualityScore(prev)) {
      best.set(key, item);
    }
  }
  // 保持首次出现顺序，内容替换为最高音质版本
  const list: LxSearchResultItem[] = [];
  const seen = new Set<string>();
  for (const item of rawList) {
    const key = `${kgNormalKey(item.name)}|${kgNormalKey(item.singer)}`;
    if (!kgNormalKey(item.name) || seen.has(key)) continue;
    seen.add(key);
    list.push(best.get(key)!);
  }
  return list;
}

export async function searchKg(str: string, page = 1, limit = 30, retryNum = 0): Promise<LxSearchResult> {
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

export function txHandleResult(rawList: any[]): LxSearchResultItem[] {
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

export async function searchTx(str: string, page = 1, limit = 50): Promise<LxSearchResult> {
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

/** QQ 专辑搜索（签名 Desktop 接口，search_type=2）内置实现；dispatch 包装在 lxMusicSdk 门面 */
export async function txSearchAlbumsRawBuiltin(
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

/** 批量查询 QQ 歌曲时长内置实现；dispatch 包装在 lxMusicSdk 门面 */
export async function txBatchTrackIntervalBuiltin(
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

export async function searchWy(str: string, page = 1, limit = 30, retryNum = 0): Promise<LxSearchResult> {
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

export async function mgCreateSignature(time: string, str: string): Promise<{ sign: string; deviceId: string }> {
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

export async function searchMg(str: string, page = 1, limit = 20, retryNum = 0): Promise<LxSearchResult> {
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

// ==================== LX 歌单搜索 Web 兜底（TX） ====================

/**
 * TX 歌单搜索兜底：无签名 Desktop 通道（musicu.fcg DoSearchForQQMusicDesktop，
 * search_type=3 → req.data.body.songlist.list，字段 dissid/dissname/imgurl/
 * song_count/listennum/creator.name）。
 * 客户端签名(Mobile)通道被风控降级返回空时使用，实测无 sign 也稳定可用；
 * 经典 t=3 client_search_cp 接口已死（data 仅剩 zhida/taglist 空结构，不再返回歌单）。
 */
export async function txSheetSearchDesktopFallback(keyword: string, page = 1, limit = 30): Promise<any[]> {
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

export { searchKw };