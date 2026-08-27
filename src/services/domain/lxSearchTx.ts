import { decodeName, formatSingerName } from '../../utils/musicFormat';
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
 * LX 平台搜索层 · TX (QQ音乐)：歌曲搜索（Mobile/Desktop/Web 三通道）、
 * TX 专辑搜索与歌曲时长内置、歌单搜索 Desktop 兜底。
 * 仅依赖 lxMusicSdkBase，作为叶子模块被 lxSearchPlatform 门面 re-export。
 */

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